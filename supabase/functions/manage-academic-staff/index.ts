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

  const callerClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: authData, error: authError } = await callerClient.auth.getUser();
  if (authError || !authData.user) return jsonResponse({ error: 'A valid signed-in account is required.' }, 401);

  const { data: callerProfile, error: profileError } = await adminClient
    .from('staff_profiles')
    .select('role, status')
    .eq('user_id', authData.user.id)
    .maybeSingle();
  if (profileError) return jsonResponse({ error: 'Unable to verify staff permissions.' }, 500);
  if (!callerProfile || callerProfile.status !== 'active' || !['Director', 'Principal'].includes(callerProfile.role)) {
    return jsonResponse({ error: 'Only active Directors and Principals may invite academic staff.' }, 403);
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'Request body must be valid JSON.' }, 400);
  }

  if (body.action !== 'invite') return jsonResponse({ error: 'Unsupported staff-management action.' }, 400);
  const fullName = typeof body.target_full_name === 'string' ? body.target_full_name.trim() : '';
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const role = body.target_role;
  const classNumber = Number(body.target_class);
  const section = body.target_section;
  if (!fullName || fullName.length > 120 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return jsonResponse({ error: 'Enter a valid staff name and email address.' }, 400);
  }
  if (!['Class Coordinator', 'Class Teacher'].includes(String(role))
    || !Number.isInteger(classNumber) || classNumber < 1 || classNumber > 12
    || (role === 'Class Coordinator' && section !== null)
    || (role === 'Class Teacher' && !['A', 'B'].includes(String(section)))) {
    return jsonResponse({ error: 'Choose a valid class, role, and section assignment.' }, 400);
  }

  const { data: existingStaff, error: staffError } = await callerClient.rpc('list_academic_staff');
  if (staffError) return jsonResponse({ error: 'Unable to check existing staff assignments.' }, 500);
  const targetAlreadyAssigned = (existingStaff || []).some((profile: { email: string }) => profile.email.toLowerCase() === email);
  if (targetAlreadyAssigned) return jsonResponse({ error: 'This email already has an academic staff profile. Edit its assignment instead.' }, 409);
  const assignmentOccupied = (existingStaff || []).some((profile: {
    role: string;
    assigned_class: number;
    assigned_section: string | null;
    status: string;
  }) => profile.status === 'active'
    && profile.role === role
    && profile.assigned_class === classNumber
    && (role === 'Class Coordinator' || profile.assigned_section === section));
  if (assignmentOccupied) return jsonResponse({ error: 'That class or section already has an active assignment. Edit or deactivate the current account first.' }, 409);

  const { data: existingProfile, error: existingProfileError } = await callerClient
    .from('staff_profiles')
    .select('user_id')
    .eq('email', email)
    .maybeSingle();
  if (existingProfileError) return jsonResponse({ error: 'Unable to verify whether this account already exists.' }, 500);
  if (existingProfile) return jsonResponse({ error: 'This email already belongs to a SCHOOL COMMAND account.' }, 409);

  const { data: existingAccounts, error: accountsError } = await callerClient.rpc('list_unassigned_staff_accounts');
  if (accountsError) return jsonResponse({ error: 'Unable to check existing Auth accounts.' }, 500);
  const existingAccount = (existingAccounts || []).find((account: { email: string }) => account.email.toLowerCase() === email);
  if (existingAccount) return jsonResponse({ error: 'This Auth account already exists. Select it from the existing-account list.' }, 409);

  const origin = request.headers.get('origin');
  if (!origin) return jsonResponse({ error: 'The application origin is required for staff invitations.' }, 400);
  let redirectTo: string;
  try {
    const parsedOrigin = new URL(origin);
    if (parsedOrigin.protocol !== 'https:' && parsedOrigin.hostname !== 'localhost') {
      return jsonResponse({ error: 'The application origin must use HTTPS.' }, 400);
    }
    redirectTo = new URL('/?flow=academic', parsedOrigin.origin).toString();
  } catch {
    return jsonResponse({ error: 'The application origin is invalid.' }, 400);
  }

  const { data: invitation, error: invitationError } = await adminClient.auth.admin.inviteUserByEmail(email, {
    data: { full_name: fullName },
    redirectTo,
  });
  if (invitationError || !invitation.user) {
    return jsonResponse({ error: invitationError?.message || 'The account invitation could not be created.' }, 400);
  }

  const { error: assignmentError } = await callerClient.rpc('assign_academic_staff', {
    target_user_id: invitation.user.id,
    target_full_name: fullName,
    target_role: role,
    target_class: classNumber,
    target_section: role === 'Class Teacher' ? section : null,
  });
  if (assignmentError) {
    return jsonResponse({
      error: `Invitation sent, but the staff assignment failed: ${assignmentError.message}. The account cannot access school records until an administrator assigns it.`,
    }, 409);
  }

  return jsonResponse({ invited: true });
});
