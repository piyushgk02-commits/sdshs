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

All records are fictional and stored in browser `localStorage`; records are not synchronized between devices. The dashboard is unavailable until Supabase Auth is configured and an authorized user signs in. Directors and Principals must use Google sign-in followed by a separately delivered administrator email code; invited academic staff use Supabase's invitation-only email one-time code. School records in the executive-management demo remain local and are not protected by Supabase Row Level Security. Do not enter real student, employee, financial, or other sensitive information. Clearing this browser's site data removes local changes.

Implemented demo workflows include the executive overview and record drill-downs, student and employee directories, student creation/editing, employee salary profiles and seeded payroll history, attendance summaries, leave submission and approval/rejection, financial transaction creation and reversal, vehicle and room directories, department summaries, inventory search/create/edit/export, school settings with Principal module permissions, reports, an audit list, and a deterministic assistant demo. Demo record changes are stored locally. This is not a complete school ERP: backend data authorization and RLS, a hosted database, private document storage, full payroll processing, procurement, compliance workflows, and detailed attendance/transport histories still need implementation.

## Supabase and secure accounts

Supabase Auth integration is included. The existing Director/Principal operational demo records remain in this browser's `localStorage`; they are not synchronized to the database. The academic staff directory described below uses a separate Supabase database schema with Row Level Security. The `VITE_SUPABASE_ANON_KEY` is a public client key, not a secret. Never put a service-role key in a `VITE_` variable or browser bundle.

1. Create a Supabase project. Copy `.env.example` to `.env.local`, set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` from its API settings, and keep the file out of Git. The anon/publishable key is public; never put a service-role key in a `VITE_` variable.
2. Leave public sign-ups disabled. Configure the Auth Site URL and allowed redirect URLs for your local Vite origin and deployed HTTPS app origin, including `/?flow=academic`. Set the email OTP length to six digits. In **Email Templates**, make the **Magic Link** template include `{{ .Token }}` for invited academic staff; keep `{{ .ConfirmationURL }}` in the **Invite user** template.
3. Configure **Authentication → Providers → Google** in Supabase with a Google OAuth client. Add the exact Supabase callback URL shown on that page (normally `https://PROJECT_REF.supabase.co/auth/v1/callback`) to the Google Cloud OAuth client's authorized redirect URIs. Do not enable other OAuth providers for this application.
4. Configure **Authentication → Hooks → Before User Created** to use `public.authorize_google_admin_user_creation`. The migration creates this hook function. It rejects new Google Auth users unless their email matches an existing, active, explicitly Google-authorized Director/Principal profile. Configure and enable this hook before enabling Google sign-in.
5. Apply both migrations and deploy the functions from the repository root:

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

   Generate the pepper locally with `openssl rand -hex 32`; do not share it in chat or commit it. The custom Edge Function uses Resend because Supabase's native MFA factors are TOTP and phone, not email. It stores only an HMAC of the admin code, expires codes after five minutes, permits one use, applies a 60-second resend cooldown and five-send/30-minute and five-attempt limits, and grants a 12-hour administrator session. Academic OTP sessions are also server-attested for 12 hours so refresh and logout remain enforceable in RLS.
7. Create the initial Director and Principal accounts from a local `.env.admin` copied from `.env.admin.example`, then run `npm run provision:users`. This service-role script assigns trusted `app_metadata.role` values. It does not expose credentials in the frontend or logs. Existing manager profiles are eligible for Google only when their trusted Auth role matches the database role. Link each account to the same verified email in Google; do not assign privileged roles from user-editable metadata.
8. Active invited Class Coordinators and Class Teachers continue to sign in with their invited email and Supabase OTP. Google sign-in is rejected for these roles, `shouldCreateUser: false` is used for OTP requests, and assignment-scoped RLS remains authoritative.
9. In Netlify, add only `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` under **Site configuration → Environment variables**, then deploy. Keep the service-role key, OTP pepper, Resend key, and sender configuration in Supabase Edge Function secrets.
10. Before using real records, move the executive demo's localStorage reads/writes to a hosted schema and implement/test RLS for every table and storage bucket. The current Director/Principal dashboard is a browser-local demo and is not a secure data store; hidden controls or frontend role checks are not a security boundary.

Manager access requires an active `staff_profiles` record, Google provider identity matching that profile's email, `google_login_allowed = true`, and a server-issued OTP verification grant. Manager roles are bootstrapped only from trusted `app_metadata.role` values; academic roles and assignments are managed through the secured Academic staff workspace. Keep public sign-up disabled in Supabase and use administrator-issued invitations. Supply Director and Principal emails and unique passwords only in the local `.env.admin` file before running the provisioning script.

If Supabase is not configured, the application stays on the login page and does not provide demo-role access. The temporary demonstration passwords from the brief are not embedded or accepted.

## Academic staff access and database setup

The academic dashboard is separate from the browser-local operational demo. Apply both `supabase/migrations/202611070001_academic_staff_access.sql` and `supabase/migrations/202611070002_admin_email_mfa.sql` before signing in. The migrations create:

- Trusted `staff_profiles` for Directors, Principals, Class Coordinators, and Class Teachers. Existing Director/Principal accounts with trusted `app_metadata.role` values are bootstrapped; newly created manager accounts with those trusted values are also profiled automatically.
- Classes 1–12, Sections A/B, and configurable section capacities (default 60).
- Fictional student, attendance, and fee-payment records for all 24 sections (40–58 students per section), plus fictional parent contacts using reserved `.invalid` email addresses and `555` phone numbers.
- Assignment-scoped RLS: Coordinators can read both sections in their assigned class; Teachers can read only their assigned section. Teachers do not have parent-contact or payment-history access. Only active Directors/Principals may change academic records. Staff accounts cannot change their own roles or assignments.
- Secure SQL functions for fee summaries and administrator-only staff account listing, assignment, and activation/deactivation.
- A Google before-user-created hook, restricted administrator OTP challenge/session tables, and RLS checks that require a live MFA grant for administrator-only actions.

Use the Supabase CLI against the intended project:

```sh
supabase link --project-ref YOUR_PROJECT_REF
supabase db push
supabase functions deploy manage-academic-staff
supabase functions deploy admin-email-mfa
```

The existing Directors/Principals can use the **Academic staff** workspace to invite an account by email or assign an existing Supabase Auth account. Invitations are sent by the Edge Function; its service-role key stays in the server-side Supabase environment. Never set that key in `.env.local`, a `VITE_` variable, or frontend code. The function redirects invitees to `/?flow=academic`; after accepting the invitation, the app clears the invitation session and requires the invitee to request a six-digit OTP with their registered email. The user must then verify that code before an active, assigned academic profile is allowed into the dashboard. Add both local and deployed app URLs (including this academic-flow path) to Supabase Auth's allowed redirect URLs. In the **Invite user** email template, retain `{{ .ConfirmationURL }}` as the link for accepting the invitation; in the **Magic Link** template, include `{{ .Token }}` so the OTP email contains the code. Supabase does not need a service-role key in the browser.

The manager workspace reports coverage toward 12 active Coordinators and 24 active Teachers. Assign a Coordinator to a class without a section, and a Teacher to exactly one class and section. Active duplicate assignments are rejected by database constraints; inactive accounts do not retain an active slot. Section capacity can be changed by an active Director/Principal in SQL, for example:

```sql
UPDATE public.academic_sections
SET student_capacity = 65
WHERE class_number = 1 AND section = 'A';
```

For isolated local validation, run `supabase start`, then `supabase db reset` and `supabase test db`. **Do not run `supabase db reset` against a linked or production database**; it recreates the local database. The pgTAP tests in `supabase/tests/academic_staff_access.test.sql` check the signup hook, OTP rejection/replay protection, session-bound administrator MFA gating, class/section filters, parent-contact and fee-history restrictions, write denial, deactivation, and unauthenticated denial.

An inactive academic account may still authenticate with Supabase Auth, but the app rejects its session after checking its trusted profile, and RLS denies all assigned student records. Deactivation is therefore enforced at the database for every data request, not just by hidden controls. Director/Principal access to the pre-existing demo dashboards remains browser-local; this migration secures only the new academic tables and does not convert the legacy demo dataset to cloud storage.

## Deployment

Deploy this Vite + React application with Netlify:

1. In Netlify, choose **Add new site → Import an existing project** and connect the Git repository.
2. Set the build command to `npm run build` and the publish directory to `dist`.
3. Add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` under **Site configuration → Environment variables**. These are build-time variables; never add a service-role key to Netlify frontend variables.
4. Deploy the site. For later changes, push to the connected Git repository to let Netlify build and publish automatically. Check the Netlify deploy log if a build fails.
5. In Supabase Auth, set the Site URL to your Netlify site URL and add your local and Netlify URLs to the redirect URL allow-list, including the academic invitation redirect `/?flow=academic`. Configure the Google provider, before-user-created hook, and Edge Function secrets described above.

Vite uses `/` as its base path, as expected for a Netlify site served from its domain root. No GitHub Pages workflow or Vercel configuration is used. Production deployment and remote migration execution must be performed against the intended hosted projects; this change has not deployed the application or run migrations against a hosted database.

The manifest and service worker provide basic PWA installation support in compatible browsers after deployment over HTTPS (or on localhost). Use the browser's install/Add to Home Screen action. The service worker does not provide cloud data synchronization.

## Integrations still required

- Supabase record schema, migrations, RLS, and private Storage.
- Google OAuth provider, before-user-created hook, Resend sender, and server-side MFA secrets.
- Migration and Edge Function deployment to the intended Supabase project.
- Server-enforced authorization and record storage/synchronization.
- Complete student/employee history, payroll, procurement, compliance, and transport/facilities workflows.
- Automated browser, mobile, authorization, and data-integrity tests.
- Production hosting configuration and deployment verification.
