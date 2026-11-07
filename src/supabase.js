import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabaseConfigured = Boolean(url && anonKey);

let rememberSession = true;
const authStorage = {
  getItem(key) {
    return window.sessionStorage.getItem(key) ?? window.localStorage.getItem(key);
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

export async function appSessionFromAuth(authSession) {
  if (!authSession?.user) return null;
  if (!supabase) return null;

  const { data: profile, error } = await supabase
    .from('staff_profiles')
    .select('full_name, role, assigned_class, assigned_section, status')
    .eq('user_id', authSession.user.id)
    .maybeSingle();

  if (error) throw error;
  if (!profile || profile.status !== 'active') return null;
  if (!['Director', 'Principal', 'Class Coordinator', 'Class Teacher'].includes(profile.role)) return null;

  return {
    id: authSession.user.id,
    email: authSession.user.email,
    name: profile.full_name,
    role: profile.role,
    assignedClass: profile.assigned_class,
    assignedSection: profile.assigned_section,
    signedInAt: authSession.created_at || new Date().toISOString(),
    authenticated: true,
  };
}

export async function academicStaffSessionFromAuth(authSession) {
  if (!authSession?.access_token || !authSession.user?.id || !supabase) return null;

  const { data: authResult, error: authError } = await supabase.auth.getUser(authSession.access_token);
  if (authError) throw authError;
  const user = authResult.user;
  if (!user || user.id !== authSession.user.id || !user.email) return null;

  const { data: profile, error } = await supabase
    .from('staff_profiles')
    .select('full_name, email, role, assigned_class, assigned_section, status')
    .eq('user_id', user.id)
    .maybeSingle();

  if (error) throw error;
  if (!profile || profile.status !== 'active'
    || !['Class Coordinator', 'Class Teacher'].includes(profile.role)
    || profile.email.toLowerCase() !== user.email.toLowerCase()
    || !Number.isInteger(profile.assigned_class)
    || profile.assigned_class < 1
    || profile.assigned_class > 12
    || (profile.role === 'Class Teacher' && !['A', 'B'].includes(profile.assigned_section))
    || (profile.role === 'Class Coordinator' && profile.assigned_section !== null)) return null;

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