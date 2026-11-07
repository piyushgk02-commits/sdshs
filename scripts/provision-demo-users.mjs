import { createClient } from '@supabase/supabase-js';

const variableNames = [
  'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'DIRECTOR_EMAIL', 'DIRECTOR_PASSWORD',
  'PRINCIPAL_EMAIL', 'PRINCIPAL_PASSWORD',
];
const missing = variableNames.filter((name) => !process.env[name]);

if (missing.length) {
  console.error(`Missing required values in .env.admin: ${missing.join(', ')}`);
  process.exit(1);
}

if (process.env.DIRECTOR_PASSWORD.length < 10 || process.env.PRINCIPAL_PASSWORD.length < 10) {
  console.error('Use unique passwords with at least 10 characters for both accounts.');
  process.exit(1);
}

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const accounts = [
  { email: process.env.DIRECTOR_EMAIL, password: process.env.DIRECTOR_PASSWORD, role: 'Director', display_name: 'Glenn' },
  { email: process.env.PRINCIPAL_EMAIL, password: process.env.PRINCIPAL_PASSWORD, role: 'Principal', display_name: 'Glenda' },
];

for (const account of accounts) {
  const { error } = await supabase.auth.admin.createUser({
    email: account.email,
    password: account.password,
    email_confirm: true,
    app_metadata: { role: account.role, display_name: account.display_name },
  });
  if (error) {
    console.error(`${account.role} account was not created: ${error.message}`);
    process.exitCode = 1;
  } else {
    console.log(`${account.role} account created for ${account.email}.`);
  }
}