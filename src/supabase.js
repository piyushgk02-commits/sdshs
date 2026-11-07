import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabaseConfigured = Boolean(url && anonKey);

let rememberSession = true;
const authStorage = {
  getItem(key) {
    const temporarySession = window.sessionStorage.getItem(key);
    if (temporarySession !== null) {
      rememberSession = false;
      return temporarySession;
    }
    rememberSession = true;
    return window.localStorage.getItem(key);
  },
  setItem(key, value) {
    const storage = rememberSession ? window.localStorage : window.sessionStorage;
    storage.setItem(key, value);
  },
  removeItem(key) {
    window.localStorage.removeItem(key);
    window.sessionStorage.removeItem(key);
  },
};

export function setRememberSession(remember) {
  rememberSession = remember;
}

export const supabase = supabaseConfigured ? createClient(url, anonKey, {
  auth: { storage: authStorage },
}) : null;

function authMethodsFromToken(token) {
  try {
    const encoded = token.split('.')[1];
    if (!encoded) return [];
    const base64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
    const claims = JSON.parse(atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '=')));
    return Array.isArray(claims.amr) ? claims.amr.map((method) => method?.method) : [];
  } catch {
    return [];
  }
}

export async function sessionFromAuth(authSession) {
  if (!authSession?.access_token || !authSession.user?.id || !supabase) return null;

  const { data: authResult, error: authError } = await supabase.auth.getUser(authSession.access_token);
  if (authError) throw authError;
  const user = authResult.user;
  if (!user || user.id !== authSession.user.id || !user.email) return null;
  const authMethods = authMethodsFromToken(authSession.access_token);

  const { data: profile, error } = await supabase
    .from('staff_profiles')
    .select('full_name, email, role, assigned_class, assigned_section, status')
    .eq('user_id', user.id)
    .maybeSingle();

  if (error) throw error;
  if (!profile || profile.status !== 'active' || profile.email.toLowerCase() !== user.email.toLowerCase()) return null;

  if (['Director', 'Principal'].includes(profile.role)) {
    if (!user.email_confirmed_at || !authMethods.includes('password')) return null;

    const { data: mfaResult, error: mfaError } = await supabase.functions.invoke('admin-email-mfa', {
      body: { action: 'status' },
    });
    if (mfaError) throw mfaError;
    if (!mfaResult?.verified) return { pendingMfa: true };
  } else if (['Class Coordinator', 'Class Teacher'].includes(profile.role)) {
    if (!Number.isInteger(profile.assigned_class)
      || profile.assigned_class < 1
      || profile.assigned_class > 12
      || (profile.role === 'Class Teacher' && !['A', 'B'].includes(profile.assigned_section))
      || (profile.role === 'Class Coordinator' && profile.assigned_section !== null)
      || !user.email_confirmed_at
      || !authMethods.includes('password')) return null;

    const { data: passwordResult, error: passwordError } = await supabase.functions.invoke('admin-email-mfa', {
      body: { action: 'academic-password-status' },
    });
    if (passwordError) throw passwordError;
    if (!passwordResult?.verified) return null;
  } else {
    return null;
  }

  return {
    id: user.id,
    email: user.email,
    name: profile.full_name,
    role: profile.role,
    assignedClass: profile.assigned_class,
    assignedSection: profile.assigned_section,
    signedInAt: authSession.created_at || new Date().toISOString(),
    authenticated: true,
  };
}

export async function requestAdminEmailOtp() {
  if (!supabase) return 'Secure sign-in is unavailable until Supabase is configured.';
  const { data, error } = await supabase.functions.invoke('admin-email-mfa', {
    body: { action: 'send' },
  });
  if (error) {
    if (error.context instanceof Response) {
      try {
        const response = await error.context.json();
        return response.error || 'Unable to send a verification code. Please try again later.';
      } catch {
        return 'Unable to send a verification code. Please try again later.';
      }
    }
    return 'Unable to send a verification code. Please try again later.';
  }
  return data?.sent ? '' : 'Unable to send a verification code. Please try again later.';
}

export async function verifyAdminEmailOtp(code) {
  if (!supabase) return 'Secure sign-in is unavailable until Supabase is configured.';
  const { data, error } = await supabase.functions.invoke('admin-email-mfa', {
    body: { action: 'verify', code },
  });
  if (error) return 'Unable to verify the code. Please try again.';
  if (data?.verified) return '';
  if (data?.reason === 'expired') return 'This code has expired. Request a new code.';
  if (data?.reason === 'rate_limited') return 'Too many incorrect attempts. Request a new code later.';
  if (data?.reason === 'not_authorized') return 'This administrator account is no longer authorized.';
  return 'That code is incorrect. Check it or request a new code.';
}

export async function revokeAdminEmailSession() {
  if (!supabase) return '';
  const { error } = await supabase.functions.invoke('admin-email-mfa', {
    body: { action: 'logout' },
  });
  return error ? 'The administrator session could not be invalidated on the server.' : '';
}

export async function revokeAcademicPasswordSession() {
  if (!supabase) return '';
  const { error } = await supabase.functions.invoke('admin-email-mfa', {
    body: { action: 'academic-password-logout' },
  });
  return error ? 'The academic staff session could not be invalidated on the server.' : '';
}