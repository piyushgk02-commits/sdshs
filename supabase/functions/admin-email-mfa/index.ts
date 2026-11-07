import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.119.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const jsonResponse = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

const isUuid = (value: unknown): value is string =>
  typeof value === 'string'
  && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

function claimsFromJwt(token: string): Record<string, unknown> | null {
  try {
    const encoded = token.split('.')[1];
    if (!encoded) return null;
    const base64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '=')));
  } catch {
    return null;
  }
}

function createCode(): string {
  const digits: string[] = [];
  const byte = new Uint8Array(1);
  while (digits.length < 6) {
    crypto.getRandomValues(byte);
    if (byte[0] < 250) digits.push(String(byte[0] % 10));
  }
  return digits.join('');
}

async function hashCode(code: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(code));
  return Array.from(new Uint8Array(signature), (value) => value.toString(16).padStart(2, '0')).join('');
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return jsonResponse({ error: 'Method not allowed.' }, 405);

  const authorization = request.headers.get('Authorization');
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!authorization?.startsWith('Bearer ') || !supabaseUrl || !anonKey || !serviceRoleKey) {
    return jsonResponse({ error: 'Authentication or server configuration is unavailable.' }, 401);
  }

  const accessToken = authorization.slice('Bearer '.length);
  const tokenClaims = claimsFromJwt(accessToken);
  const authSessionId = tokenClaims?.session_id;
  if (!isUuid(authSessionId)) return jsonResponse({ error: 'A valid signed-in session is required.' }, 401);

  const callerClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: authData, error: authError } = await callerClient.auth.getUser(accessToken);
  const authMethods = tokenClaims?.amr;
  const usedPassword = Array.isArray(authMethods)
    && authMethods.some((method: { method?: string }) => method?.method === 'password');
  if (authError || !authData.user || tokenClaims?.sub !== authData.user.id
    || !authData.user.email || !authData.user.email_confirmed_at) {
    return jsonResponse({ error: 'A verified SCHOOL COMMAND staff session is required.' }, 403);
  }

  const { data: profile, error: profileError } = await adminClient
    .from('staff_profiles')
    .select('email, role, status, assigned_class, assigned_section')
    .eq('user_id', authData.user.id)
    .maybeSingle();
  if (profileError) return jsonResponse({ error: 'Unable to verify staff access.' }, 500);

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'Request body must be valid JSON.' }, 400);
  }

  const adminActions = ['status', 'send', 'verify', 'logout'];
  const academicActions = ['academic-password-status', 'academic-password-logout'];
  if (![...adminActions, ...academicActions].includes(String(body.action))) {
    return jsonResponse({ error: 'Unsupported verification action.' }, 400);
  }

  if (!profile || profile.status !== 'active'
    || profile.email.toLowerCase() !== authData.user.email.toLowerCase()) {
    return jsonResponse({ error: 'This account is not active or assigned to SCHOOL COMMAND.' }, 403);
  }

  if (adminActions.includes(String(body.action))) {
    if (!usedPassword || !['Director', 'Principal'].includes(profile.role)) {
      return jsonResponse({ error: 'This account is not authorized for administrator access.' }, 403);
    }
  } else if (!['Class Coordinator', 'Class Teacher'].includes(profile.role)
    || !usedPassword
    || !Number.isInteger(profile.assigned_class)
    || profile.assigned_class < 1
    || profile.assigned_class > 12
    || (profile.role === 'Class Teacher' && !['A', 'B'].includes(profile.assigned_section))
    || (profile.role === 'Class Coordinator' && profile.assigned_section !== null)) {
    return jsonResponse({ error: 'This account is not authorized for academic staff access.' }, 403);
  }

  if (body.action === 'academic-password-status') {
    if (usedPassword) {
      const { error } = await adminClient.from('academic_password_sessions').upsert({
        auth_session_id: authSessionId,
        user_id: authData.user.id,
        verified_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString(),
      }, { onConflict: 'auth_session_id', ignoreDuplicates: true });
      if (error) return jsonResponse({ error: 'Unable to verify academic staff sign-in.' }, 500);
    }

    const { data: grant, error } = await adminClient
      .from('academic_password_sessions')
      .select('expires_at')
      .eq('auth_session_id', authSessionId)
      .eq('user_id', authData.user.id)
      .is('revoked_at', null)
      .gt('expires_at', new Date().toISOString())
      .maybeSingle();
    if (error) return jsonResponse({ error: 'Unable to verify academic staff sign-in.' }, 500);
    return jsonResponse({ verified: Boolean(grant) });
  }

  if (body.action === 'academic-password-logout') {
    const { error } = await adminClient
      .from('academic_password_sessions')
      .update({ revoked_at: new Date().toISOString() })
      .eq('auth_session_id', authSessionId)
      .eq('user_id', authData.user.id)
      .is('revoked_at', null);
    if (error) return jsonResponse({ error: 'Unable to invalidate the academic staff session.' }, 500);
    return jsonResponse({ logged_out: true });
  }

  if (body.action === 'status') {
    const { data: grant, error } = await adminClient
      .from('admin_email_mfa_sessions')
      .select('expires_at')
      .eq('auth_session_id', authSessionId)
      .eq('user_id', authData.user.id)
      .is('revoked_at', null)
      .gt('expires_at', new Date().toISOString())
      .maybeSingle();
    if (error) return jsonResponse({ error: 'Unable to verify administrator sign-in.' }, 500);
    if (grant) return jsonResponse({ verified: true, pending: false });

    const { data: challenge, error: challengeError } = await adminClient
      .from('admin_email_mfa_challenges')
      .select('id')
      .eq('auth_session_id', authSessionId)
      .eq('user_id', authData.user.id)
      .is('used_at', null)
      .gt('expires_at', new Date().toISOString())
      .limit(1)
      .maybeSingle();
    if (challengeError) return jsonResponse({ error: 'Unable to verify administrator sign-in.' }, 500);
    return jsonResponse({ verified: false, pending: Boolean(challenge) });
  }

  if (body.action === 'logout') {
    const { error } = await adminClient
      .from('admin_email_mfa_sessions')
      .update({ revoked_at: new Date().toISOString() })
      .eq('auth_session_id', authSessionId)
      .eq('user_id', authData.user.id)
      .is('revoked_at', null);
    if (error) return jsonResponse({ error: 'Unable to invalidate the administrator session.' }, 500);
    return jsonResponse({ logged_out: true });
  }

  if (body.action === 'send') {
    const pepper = Deno.env.get('MFA_OTP_SECRET');
    const resendApiKey = Deno.env.get('RESEND_API_KEY');
    const emailFrom = Deno.env.get('MFA_EMAIL_FROM');
    if (!pepper || !resendApiKey || !emailFrom) {
      return jsonResponse({ error: 'Administrator email verification is not configured.' }, 503);
    }

    const code = createCode();
    const codeHash = await hashCode(code, pepper);
    const { error: issueError } = await adminClient.rpc('issue_admin_email_mfa', {
      target_user_id: authData.user.id,
      target_session_id: authSessionId,
      target_otp_hash: codeHash,
    });
    if (issueError) {
      if (issueError.message.includes('cooldown')) {
        return jsonResponse({ error: 'Please wait before requesting another code.' }, 429);
      }
      if (issueError.message.includes('rate_limited')) {
        return jsonResponse({ error: 'Too many verification codes were requested. Try again later.' }, 429);
      }
      return jsonResponse({ error: 'Unable to issue an administrator verification code.' }, 403);
    }

    let emailResponse: Response;
    try {
      emailResponse = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${resendApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: emailFrom,
          to: [authData.user.email],
          subject: 'Your SCHOOL COMMAND verification code',
          text: `Your SCHOOL COMMAND administrator verification code is ${code}. It expires in five minutes. If you did not request it, ignore this email.`,
        }),
        signal: AbortSignal.timeout(10000),
      });
    } catch {
      return jsonResponse({ error: 'The verification email could not be delivered. Please try again later.' }, 502);
    }
    if (!emailResponse.ok) return jsonResponse({ error: 'The verification email could not be delivered. Please try again later.' }, 502);
    return jsonResponse({ sent: true, expires_in: 300, cooldown_seconds: 60 });
  }

  const code = typeof body.code === 'string' ? body.code : '';
  const pepper = Deno.env.get('MFA_OTP_SECRET');
  if (!/^\d{6}$/.test(code)) return jsonResponse({ error: 'Enter the six-digit verification code.' }, 400);
  if (!pepper) return jsonResponse({ error: 'Administrator email verification is not configured.' }, 503);

  const codeHash = await hashCode(code, pepper);
  const { data: outcome, error: verifyError } = await adminClient.rpc('verify_admin_email_mfa', {
    target_user_id: authData.user.id,
    target_session_id: authSessionId,
    target_otp_hash: codeHash,
  });
  if (verifyError) return jsonResponse({ error: 'Unable to verify the code. Please try again.' }, 500);
  if (outcome !== 'verified') {
    return jsonResponse({ verified: false, reason: outcome }, 200);
  }
  return jsonResponse({ verified: true });
});
