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

All records are fictional and stored in browser `localStorage`; records are not synchronized between devices. The dashboard is unavailable until Supabase Auth is configured and an authorized user signs in. Director and Principal login uses email/password and password recovery; academic staff use an invitation-only email one-time code. School records remain local demo data in the browser and are not protected by Supabase Row Level Security. Do not enter real student, employee, financial, or other sensitive information. Clearing this browser's site data removes local changes.

Implemented demo workflows include the executive overview and record drill-downs, student and employee directories, student creation/editing, employee salary profiles and seeded payroll history, attendance summaries, leave submission and approval/rejection, financial transaction creation and reversal, vehicle and room directories, department summaries, inventory search/create/edit/export, school settings with Principal module permissions, reports, an audit list, and a deterministic assistant demo. Demo record changes are stored locally. This is not a complete school ERP: backend data authorization and RLS, a hosted database, private document storage, full payroll processing, procurement, compliance workflows, and detailed attendance/transport histories still need implementation.

## Supabase and secure accounts

Supabase Auth integration is included. The existing Director/Principal operational demo records remain in this browser's `localStorage`; they are not synchronized to the database. The academic staff directory described below uses a separate Supabase database schema with Row Level Security. The `VITE_SUPABASE_ANON_KEY` is a public client key, not a secret. Never put a service-role key in a `VITE_` variable or browser bundle.

1. Create a Supabase project.
2. Copy `.env.example` to `.env.local` and set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` from the project's API settings. Keep `.env.local` out of Git.
3. Configure Supabase Auth's Site URL and redirect URL allow-list for the local Vite origin and your Netlify HTTPS site URL.
4. To create the initial accounts, copy `.env.admin.example` to `.env.admin` and fill it with the project URL, service-role key, two account emails, and unique passwords of at least 10 characters. Keep this file local; the Git ignore rules exclude it. Run `npm run provision:users`. The script assigns trusted server-controlled `app_metadata.role` values (`Director` and `Principal`) and never prints passwords or the service-role key. Do not reuse the temporary passwords from the original brief.
5. In Supabase Auth, leave public sign-ups disabled. Set the email OTP length to six digits. Under **Email Templates**, configure the **Magic Link** template to include `{{ .Token }}` as the six-digit code and explain that it must be entered on the SCHOOL COMMAND Academic Staff Login screen. Keep the **Invite user** template's `{{ .ConfirmationURL }}` link; accepting it confirms the invited address and redirects to the app but does not grant dashboard access. Configure your Auth Site URL and allow the local Vite origin and deployed HTTPS app URL (including the `/?flow=academic` redirect path).
6. Restart Vite after setting `.env.local`. Directors and Principals sign in with the account emails and passwords set in Supabase Auth; active invited Class Coordinators and Class Teachers use their registered email and a one-time code. Password recovery remains available for administrators. Without these values, the app remains on the login page and does not provide demo-role access.
7. In Netlify, add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` under **Site configuration → Environment variables**, then trigger a new deploy. The anon key is public; do not add `SUPABASE_SERVICE_ROLE_KEY` to Netlify or any `VITE_` variable.
8. Before using any real records, design the database schema, implement RLS for every table/storage bucket, move record reads/writes off localStorage, and verify authorization on the server/database. Current permission-driven navigation is not a security boundary.

Manager access requires an active `staff_profiles` record. Manager roles are bootstrapped from trusted `app_metadata.role` values; academic roles and their assignments are managed through the secured Academic staff workspace. Keep public sign-up disabled in Supabase and use administrator-issued invitations. Supply Director and Principal emails and unique passwords only in the local `.env.admin` file before running the provisioning script.

If Supabase is not configured, the application stays on the login page and does not provide demo-role access. The temporary demonstration passwords from the brief are not embedded or accepted.

## Academic staff access and database setup

The academic dashboard is separate from the browser-local operational demo. Apply `supabase/migrations/202611070001_academic_staff_access.sql` to the Supabase project before signing academic staff in. It creates:

- Trusted `staff_profiles` for Directors, Principals, Class Coordinators, and Class Teachers. Existing Director/Principal accounts with trusted `app_metadata.role` values are bootstrapped; newly created manager accounts with those trusted values are also profiled automatically.
- Classes 1–12, Sections A/B, and configurable section capacities (default 60).
- Fictional student, attendance, and fee-payment records for all 24 sections (40–58 students per section), plus fictional parent contacts using reserved `.invalid` email addresses and `555` phone numbers.
- Assignment-scoped RLS: Coordinators can read both sections in their assigned class; Teachers can read only their assigned section. Teachers do not have parent-contact or payment-history access. Only active Directors/Principals may change academic records. Staff accounts cannot change their own roles or assignments.
- Secure SQL functions for fee summaries and administrator-only staff account listing, assignment, and activation/deactivation.

Use the Supabase CLI against the intended project:

```sh
supabase link --project-ref YOUR_PROJECT_REF
supabase db push
supabase functions deploy manage-academic-staff
```

The existing Directors/Principals can use the **Academic staff** workspace to invite an account by email or assign an existing Supabase Auth account. Invitations are sent by the Edge Function; its service-role key stays in the server-side Supabase environment. Never set that key in `.env.local`, a `VITE_` variable, or frontend code. The function redirects invitees to `/?flow=academic`; after accepting the invitation, the app clears the invitation session and requires the invitee to request a six-digit OTP with their registered email. The user must then verify that code before an active, assigned academic profile is allowed into the dashboard. Add both local and deployed app URLs (including this academic-flow path) to Supabase Auth's allowed redirect URLs. In the **Invite user** email template, retain `{{ .ConfirmationURL }}` as the link for accepting the invitation; in the **Magic Link** template, include `{{ .Token }}` so the OTP email contains the code. Supabase does not need a service-role key in the browser.

The manager workspace reports coverage toward 12 active Coordinators and 24 active Teachers. Assign a Coordinator to a class without a section, and a Teacher to exactly one class and section. Active duplicate assignments are rejected by database constraints; inactive accounts do not retain an active slot. Section capacity can be changed by an active Director/Principal in SQL, for example:

```sql
UPDATE public.academic_sections
SET student_capacity = 65
WHERE class_number = 1 AND section = 'A';
```

For isolated local validation, run `supabase start`, then `supabase db reset` and `supabase test db`. **Do not run `supabase db reset` against a linked or production database**; it recreates the local database. The pgTAP tests in `supabase/tests/academic_staff_access.test.sql` check the class/section filters, parent-contact and fee-history restrictions, write denial, administrator access, deactivation, and unauthenticated denial.

An inactive academic account may still authenticate with Supabase Auth, but the app rejects its session after checking its trusted profile, and RLS denies all assigned student records. Deactivation is therefore enforced at the database for every data request, not just by hidden controls. Director/Principal access to the pre-existing demo dashboards remains browser-local; this migration secures only the new academic tables and does not convert the legacy demo dataset to cloud storage.

## Deployment

Deploy this Vite + React application with Netlify:

1. In Netlify, choose **Add new site → Import an existing project** and connect the Git repository.
2. Set the build command to `npm run build` and the publish directory to `dist`.
3. Add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` under **Site configuration → Environment variables**. These are build-time variables; never add a service-role key to Netlify frontend variables.
4. Deploy the site. For later changes, push to the connected Git repository to let Netlify build and publish automatically. Check the Netlify deploy log if a build fails.
5. In Supabase Auth, set the Site URL to your Netlify site URL and add your local and Netlify URLs to the redirect URL allow-list, including the academic invitation redirect `/?flow=academic`.

Vite uses `/` as its base path, as expected for a Netlify site served from its domain root. No GitHub Pages workflow or Vercel configuration is used. Production deployment and remote migration execution must be performed against the intended hosted projects; this change has not deployed the application or run migrations against a hosted database.

The manifest and service worker provide basic PWA installation support in compatible browsers after deployment over HTTPS (or on localhost). Use the browser's install/Add to Home Screen action. The service worker does not provide cloud data synchronization.

## Integrations still required

- Supabase record schema, migrations, RLS, and private Storage.
- Trusted account provisioning for the Director and Principal roles.
- Server-enforced authorization and record storage/synchronization.
- Complete student/employee history, payroll, procurement, compliance, and transport/facilities workflows.
- Automated browser, mobile, authorization, and data-integrity tests.
- Production hosting configuration and deployment verification.
