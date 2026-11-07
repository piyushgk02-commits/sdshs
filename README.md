# SCHOOL COMMAND

Executive-management demo for St Dominic Savio's High School.

## Run locally

Requirements: Node.js 20 or newer and npm.

```sh
npm install
npm run dev
```

Vite prints a local URL (normally `http://localhost:5173`). Create a production bundle with `npm run build`; preview it with `npm run preview`.

## Demo data and limitations

All records are fictional and stored in browser `localStorage`; records are not synchronized between devices. The dashboard is unavailable until Supabase Auth is configured and an authorized user signs in. Directors and Principals sign in with email/password followed by a separately delivered administrator email code. Invited Coordinators and Teachers sign in with email/password. School records in the executive-management demo remain local and are not protected by Supabase Row Level Security. Do not enter real student, employee, financial, or other sensitive information. Clearing this browser's site data removes local changes.

Implemented demo workflows include the executive overview and record drill-downs, student and employee directories, student creation/editing, employee salary profiles and seeded payroll history, attendance summaries, leave submission and approval/rejection, financial transaction creation and reversal, vehicle and room directories, department summaries, inventory search/create/edit/export, school settings with Principal module permissions, reports, an audit list, and a deterministic assistant demo. Demo record changes are stored locally. This is not a complete school ERP: backend data authorization and RLS, a hosted database, private document storage, full payroll processing, procurement, compliance workflows, and detailed attendance/transport histories still need implementation.

## Supabase and secure accounts

Supabase Auth integration is included. The existing Director/Principal operational demo records remain in this browser's `localStorage`; they are not synchronized to the database. The academic staff directory described below uses a separate Supabase database schema with Row Level Security. The `VITE_SUPABASE_ANON_KEY` is a public client key, not a secret. Never put a service-role key in a `VITE_` variable or browser bundle.

1. Create a Supabase project. Copy `.env.example` to `.env.local`, set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` from its API settings, and keep the file out of Git. The anon/publishable key is public; never put a service-role key in a `VITE_` variable.
2. Keep public sign-ups disabled (also set `enable_signup = false` in local Supabase config). Enable email/password Auth and email confirmation. Configure the Auth Site URL and allowed redirect URLs for the local Vite origin and deployed HTTPS app origin, including `/?flow=academic-password` and `/?flow=password-reset`. Set a strong minimum password length in Supabase Auth (the app requires at least 10 characters for password setup). Keep `{{ .ConfirmationURL }}` in the **Invite user** email template.
3. Google OAuth is not required. The application does not create Auth accounts from the login screen, and role access comes only from the trusted `staff_profiles` record—not user input or user-editable metadata.
4. **Deployment is currently blocked by migration 002.** It uses `CREATE FUNCTION public.is_school_manager()` even though migration 001 already creates that function, so a fresh local migration run fails on the duplicate definition. Migration 001 and 002 were intentionally left unchanged. Resolve this migration-history blocker before applying migration 003 or deploying the updated functions.

   Once the migration history is corrected and reviewed, apply migrations 001, 002, and 003 in order, then deploy the functions from the repository root only after reviewing the target project:

   ```sh
   supabase link --project-ref YOUR_PROJECT_REF
   supabase db push
   supabase functions deploy manage-academic-staff
   supabase functions deploy admin-email-mfa
   ```

6. Configure the server-only secrets for the administrator email factor. Verify a sender domain with Resend, generate a random 32-byte value for the OTP HMAC pepper, then set the values in Supabase (never in `.env.local` or Netlify):

   ```sh
   supabase secrets set MFA_OTP_SECRET=YOUR_RANDOM_32_BYTE_SECRET RESEND_API_KEY=YOUR_RESEND_API_KEY MFA_EMAIL_FROM="SCHOOL COMMAND <no-reply@your-verified-domain>"
   ```

   Do not run these deployment commands without approval. The MFA Edge Function uses Resend to deliver the second factor. It stores only an HMAC of the code, expires codes after five minutes, allows one use, applies a 60-second resend cooldown and five-send/30-minute and five-attempt limits, and grants a 12-hour administrator session.
5. Configure the server-only MFA secrets in Supabase Edge Function secrets. Verify a sender domain with Resend and generate a random 32-byte HMAC pepper locally:

   ```sh
   openssl rand -hex 32
   supabase secrets set MFA_OTP_SECRET=YOUR_RANDOM_32_BYTE_SECRET RESEND_API_KEY=YOUR_RESEND_API_KEY MFA_EMAIL_FROM="SCHOOL COMMAND <no-reply@your-verified-domain>"
   ```

   Do not paste or commit these values, or put them in `.env.local`, Netlify, or frontend code.
6. Create the initial Director and Principal Auth accounts using the local `.env.admin` setup and `npm run provision:users`. That server-side script sets trusted `app_metadata.role`; it never accepts role choices from the login UI. For an existing account, use Supabase's password reset/invitation flow to set a password rather than trying to create a duplicate account.
7. Active Coordinators and Teachers are invited by an active, MFA-verified Director or Principal through the **Academic staff** workspace. The invite link leads to a password setup screen. Subsequent staff sign-ins use email/password; access is still constrained by the active profile and class/section assignment in RLS.
8. In Netlify, add only `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` under **Site configuration → Environment variables**. Keep the service-role key, OTP pepper, Resend key, and sender configuration in Supabase Edge Function secrets.
9. Before using real records, move the executive demo's localStorage reads/writes to a hosted schema and implement/test RLS for every table and storage bucket. The current Director/Principal dashboard is a browser-local demo and is not a secure data store; hidden controls or frontend role checks are not a security boundary.

Manager access requires a confirmed matching email, an active `staff_profiles` record, a password-authenticated session, and a server-issued OTP verification grant. Academic access requires a confirmed matching email, an active assigned profile, and a server-attested password session. These checks are enforced by the Edge Function and RLS, not just the frontend. The legacy `google_login_allowed` column is no longer an authorization requirement. Manager roles are bootstrapped only from trusted `app_metadata.role` values; academic roles and assignments are managed through the secured Academic staff workspace. Keep public sign-up disabled and use administrator-issued invitations.

If Supabase is not configured, the application stays on the login page and does not provide demo-role access. The temporary demonstration passwords from the brief are not embedded or accepted.

## Academic staff access and database setup

The academic dashboard is separate from the browser-local operational demo. Apply migrations `202611070001_academic_staff_access.sql`, `202611070002_admin_email_mfa.sql`, and `202611070003_password_auth.sql` before signing in. Migration 003 changes authorization/session checks only; it does not alter or delete student, attendance, fee-payment, or guardian data. The migrations create:

- Trusted `staff_profiles` for Directors, Principals, Class Coordinators, and Class Teachers. Existing Director/Principal accounts with trusted `app_metadata.role` values are bootstrapped; newly created manager accounts with those trusted values are also profiled automatically.
- Classes 1–12, Sections A/B, and configurable section capacities (default 60).
- Fictional student, attendance, and fee-payment records for all 24 sections (40–58 students per section), plus fictional parent contacts using reserved `.invalid` email addresses and `555` phone numbers.
- Assignment-scoped RLS: Coordinators can read both sections in their assigned class; Teachers can read only their assigned section. Teachers do not have parent-contact or payment-history access. Only active Directors/Principals may change academic records. Staff accounts cannot change their own roles or assignments.
- Secure SQL functions for fee summaries and administrator-only staff account listing, assignment, and activation/deactivation.
- Restricted administrator OTP challenge/session tables and RLS checks that require password authentication and a live MFA grant for administrator-only actions. Academic staff password sessions are separately attested server-side.

Use the Supabase CLI against the intended project:

```sh
supabase link --project-ref YOUR_PROJECT_REF
supabase db push
supabase functions deploy manage-academic-staff
supabase functions deploy admin-email-mfa
```

An active, MFA-verified Director or Principal can use the **Academic staff** workspace to invite an account by email or assign an existing Supabase Auth account. The server-side Edge Function sends invitations and redirects invitees to `/?flow=academic-password`, where they set their own password; the assigned role and class/section remain controlled by the administrator. Add local and deployed app URLs (including this invite path and `/?flow=password-reset`) to Supabase Auth's allowed redirect URLs. Keep `{{ .ConfirmationURL }}` in the **Invite user** template. Supabase does not need a service-role key in the browser.

The manager workspace reports coverage toward 12 active Coordinators and 24 active Teachers. Assign a Coordinator to a class without a section, and a Teacher to exactly one class and section. Active duplicate assignments are rejected by database constraints; inactive accounts do not retain an active slot. Section capacity can be changed by an active Director/Principal in SQL, for example:

```sql
UPDATE public.academic_sections
SET student_capacity = 65
WHERE class_number = 1 AND section = 'A';
```

For isolated local validation, run `supabase start`, then `supabase db reset` and `supabase test db`. **Do not run `supabase db reset` against a linked or production database**; it recreates the local database. The pgTAP tests in `supabase/tests/academic_staff_access.test.sql` check administrator OTP rejection/replay protection, password- and session-bound access for Directors and Principals, teacher assignment filters, parent-contact and fee-history restrictions, write denial, deactivation, and unauthenticated denial.

An inactive academic account may still authenticate with Supabase Auth, but the app rejects its session after checking its trusted profile, and RLS denies all assigned student records. Deactivation is therefore enforced at the database for every data request, not just by hidden controls. Director/Principal access to the pre-existing demo dashboards remains browser-local; this migration secures only the new academic tables and does not convert the legacy demo dataset to cloud storage.

## Deployment

Deploy this Vite + React application with Netlify:

1. In Netlify, choose **Add new site → Import an existing project** and connect the Git repository.
2. Set the build command to `npm run build` and the publish directory to `dist`.
3. Add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` under **Site configuration → Environment variables**. These are build-time variables; never add a service-role key to Netlify frontend variables.
4. Deploy the site. For later changes, push to the connected Git repository to let Netlify build and publish automatically. Check the Netlify deploy log if a build fails.
5. In Supabase Auth, set the Site URL to your Netlify site URL and add your local and Netlify URLs to the redirect URL allow-list, including `/?flow=academic-password` and `/?flow=password-reset`. Keep public sign-up disabled and configure the email provider and server-only Edge Function secrets described above.

Vite uses `/` as its base path, as expected for a Netlify site served from its domain root. No GitHub Pages workflow or Vercel configuration is used. Production deployment and remote migration execution must be performed against the intended hosted projects; this change has not deployed the application or run migrations against a hosted database.

The manifest and service worker provide basic PWA installation support in compatible browsers after deployment over HTTPS (or on localhost). Use the browser's install/Add to Home Screen action. The service worker does not provide cloud data synchronization.

## Integrations still required

- Supabase record schema, migrations, RLS, and private Storage.
- Email/password provider, Resend sender, and server-side MFA secrets.
- Migration and Edge Function deployment to the intended Supabase project.
- Server-enforced authorization and record storage/synchronization.
- Complete student/employee history, payroll, procurement, compliance, and transport/facilities workflows.
- Automated browser, mobile, authorization, and data-integrity tests.
- Production hosting configuration and deployment verification.
