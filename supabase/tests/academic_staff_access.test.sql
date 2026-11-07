BEGIN;

SELECT plan(28);

INSERT INTO auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  created_at, updated_at, raw_app_meta_data, raw_user_meta_data
)
VALUES
  ('00000000-0000-4000-8000-000000000101', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rls-teacher-a@example.invalid', '', now(), now(), now(), '{}', '{"full_name":"Test Teacher A"}'),
  ('00000000-0000-4000-8000-000000000102', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rls-coordinator@example.invalid', '', now(), now(), now(), '{}', '{"full_name":"Test Coordinator"}'),
  ('00000000-0000-4000-8000-000000000103', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rls-director@example.invalid', '', now(), now(), now(), '{}', '{"full_name":"Test Director"}'),
  ('00000000-0000-4000-8000-000000000104', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rls-principal@example.invalid', '', now(), now(), now(), '{}', '{"full_name":"Test Principal"}'),
  ('00000000-0000-4000-8000-000000000105', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rls-inactive@example.invalid', '', now(), now(), now(), '{}', '{"full_name":"Inactive Teacher"}'),
  ('00000000-0000-4000-8000-000000000106', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rls-unassigned@example.invalid', '', now(), now(), now(), '{}', '{"full_name":"Unassigned Account"}');

INSERT INTO public.staff_profiles (
  user_id, full_name, email, role, assigned_class, assigned_section, status, google_login_allowed
)
VALUES
  ('00000000-0000-4000-8000-000000000101', 'Test Teacher A', 'rls-teacher-a@example.invalid', 'Class Teacher', 1, 'A', 'active', false),
  ('00000000-0000-4000-8000-000000000102', 'Test Coordinator', 'rls-coordinator@example.invalid', 'Class Coordinator', 1, NULL, 'active', false),
  ('00000000-0000-4000-8000-000000000103', 'Test Director', 'rls-director@example.invalid', 'Director', NULL, NULL, 'active', true),
  ('00000000-0000-4000-8000-000000000104', 'Test Principal', 'rls-principal@example.invalid', 'Principal', NULL, NULL, 'active', true),
  ('00000000-0000-4000-8000-000000000105', 'Inactive Teacher', 'rls-inactive@example.invalid', 'Class Teacher', 1, 'A', 'inactive', false);

INSERT INTO auth.identities (
  id, user_id, identity_data, provider, provider_id, created_at, updated_at
)
VALUES
  ('30000000-0000-4000-8000-000000000103', '00000000-0000-4000-8000-000000000103',
    '{"sub":"director-google-id","email":"rls-director@example.invalid","email_verified":true}',
    'google', 'director-google-id', now(), now()),
  ('30000000-0000-4000-8000-000000000104', '00000000-0000-4000-8000-000000000104',
    '{"sub":"principal-google-id","email":"rls-principal@example.invalid","email_verified":true}',
    'google', 'principal-google-id', now(), now());

INSERT INTO public.admin_email_mfa_sessions (
  auth_session_id, user_id, verified_at, expires_at
)
VALUES
  ('10000000-0000-4000-8000-000000000103', '00000000-0000-4000-8000-000000000103', now(), now() + interval '1 hour'),
  ('10000000-0000-4000-8000-000000000104', '00000000-0000-4000-8000-000000000104', now(), now() + interval '1 hour');

INSERT INTO public.academic_password_sessions (
  auth_session_id, user_id, verified_at, expires_at
)
VALUES
  ('20000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000000101', now(), now() + interval '1 hour'),
  ('20000000-0000-4000-8000-000000000102', '00000000-0000-4000-8000-000000000102', now(), now() + interval '1 hour');

INSERT INTO public.admin_email_mfa_challenges (
  user_id, auth_session_id, otp_hash, expires_at
)
VALUES (
  '00000000-0000-4000-8000-000000000103',
  '10000000-0000-4000-8000-000000000113',
  'fixture-hmac',
  now() + interval '5 minutes'
);

SELECT is(
  public.authorize_google_admin_user_creation(
    '{"user":{"email":"rls-director@example.invalid","app_metadata":{"provider":"google"},"user_metadata":{"email_verified":true}}}'::jsonb
  ),
  '{}'::jsonb,
  'Before-user-created hook permits an existing authorized administrator'
);
SELECT is(
  (public.authorize_google_admin_user_creation(
    '{"user":{"email":"rls-teacher-a@example.invalid","app_metadata":{"provider":"google"},"user_metadata":{"email_verified":true}}}'::jsonb
  )->'error'->>'http_code')::integer,
  403,
  'Before-user-created hook rejects Google sign-up for academic staff'
);
SELECT is(
  (public.authorize_google_admin_user_creation(
    '{"user":{"email":"rls-director@example.invalid","app_metadata":{"provider":"google"},"user_metadata":{"email_verified":false}}}'::jsonb
  )->'error'->>'http_code')::integer,
  403,
  'Before-user-created hook rejects unverified Google email identities'
);
SELECT is(
  public.verify_admin_email_mfa(
    '00000000-0000-4000-8000-000000000103',
    '10000000-0000-4000-8000-000000000113',
    'wrong-code'
  ),
  'invalid',
  'Administrator OTP rejects an incorrect code'
);
SELECT is(
  public.verify_admin_email_mfa(
    '00000000-0000-4000-8000-000000000103',
    '10000000-0000-4000-8000-000000000113',
    'fixture-hmac'
  ),
  'verified',
  'Administrator OTP accepts a valid code and creates a session grant'
);
SELECT is(
  (SELECT count(*) FROM public.admin_email_mfa_sessions
    WHERE auth_session_id = '10000000-0000-4000-8000-000000000113'
      AND user_id = '00000000-0000-4000-8000-000000000103'),
  1::bigint,
  'Administrator OTP grant is tied to its authenticated user and session'
);
SELECT is(
  public.verify_admin_email_mfa(
    '00000000-0000-4000-8000-000000000103',
    '10000000-0000-4000-8000-000000000113',
    'fixture-hmac'
  ),
  'expired',
  'Administrator OTP cannot be used a second time'
);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000101', true);
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000000101","amr":[{"method":"oauth"}],"session_id":"20000000-0000-4000-8000-000000000101"}', true);
SELECT is(
  (SELECT count(*) FROM public.academic_students WHERE class_number = 1 AND section = 'A'),
  0::bigint,
  'Google OAuth cannot be used to access an academic staff assignment'
);
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000000101","amr":[{"method":"password"}],"session_id":"20000000-0000-4000-8000-000000000101"}', true);
SELECT is(
  (SELECT count(*) FROM public.academic_students WHERE class_number = 1 AND section = 'A'),
  47::bigint,
  'Class 1-A teacher sees only the assigned section'
);
SELECT is(
  (SELECT count(*) FROM public.academic_students WHERE class_number = 1 AND section = 'B'),
  0::bigint,
  'Class 1-A teacher cannot see Class 1-B'
);
SELECT is(
  (SELECT count(*) FROM public.academic_students WHERE class_number = 2),
  0::bigint,
  'Class 1-A teacher cannot see another class'
);
SELECT is(
  (SELECT count(*) FROM public.student_guardian_contacts),
  0::bigint,
  'Class teachers cannot read parent contact details'
);
SELECT is(
  (SELECT count(*) FROM public.academic_fee_payments),
  0::bigint,
  'Class teachers cannot read payment history'
);
SELECT is(
  (SELECT count(*) FROM public.get_academic_fee_summaries()),
  47::bigint,
  'Class 1-A teacher can read fee totals for their section'
);
WITH changed AS (
  UPDATE public.academic_fee_payments
  SET amount = amount + 1
  WHERE reference = 'DEMO-2026-C01-A-001-FEE-1'
  RETURNING 1
)
SELECT is(
  (SELECT count(*) FROM changed),
  0::bigint,
  'Class teacher fee updates affect no rows'
);

SELECT set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000102', true);
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000000102","amr":[{"method":"password"}],"session_id":"20000000-0000-4000-8000-000000000102"}', true);
SELECT is(
  (SELECT count(*) FROM public.academic_students WHERE class_number = 1),
  105::bigint,
  'Class 1 coordinator sees Sections A and B'
);
SELECT is(
  (SELECT count(*) FROM public.academic_students WHERE class_number = 2),
  0::bigint,
  'Class 1 coordinator cannot see Class 2'
);
SELECT is(
  (SELECT count(*) FROM public.student_guardian_contacts),
  105::bigint,
  'Class coordinator can read parent contacts only for their class'
);
SELECT is(
  (SELECT count(*) FROM public.academic_fee_payments),
  315::bigint,
  'Class coordinator can read fee payment history only for their class'
);
WITH removed AS (
  DELETE FROM public.academic_students
  WHERE admission_number = 'DEMO-2026-C01-A-001'
  RETURNING 1
)
SELECT is(
  (SELECT count(*) FROM removed),
  0::bigint,
  'Class coordinator student deletes affect no rows'
);

SELECT set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000103', true);
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000000103","amr":[{"method":"oauth"}],"session_id":"10000000-0000-4000-8000-000000000999"}', true);
SELECT is(
  (SELECT count(*) FROM public.academic_students),
  0::bigint,
  'Director cannot read administrator records before email OTP verification'
);
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000000103","amr":[{"method":"password"}],"session_id":"10000000-0000-4000-8000-000000000103"}', true);
SELECT is(
  (SELECT count(*) FROM public.academic_students),
  1176::bigint,
  'Director retains full academic student access'
);
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000000103","amr":[{"method":"oauth"}],"session_id":"10000000-0000-4000-8000-000000000103"}', true);
SELECT is(
  (SELECT count(*) FROM public.academic_students),
  0::bigint,
  'Director cannot use a non-password session even with a valid MFA grant'
);

SELECT set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000104', true);
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000000104","amr":[{"method":"password"}],"session_id":"10000000-0000-4000-8000-000000000104"}', true);
SELECT is(
  (SELECT count(*) FROM public.academic_students),
  1176::bigint,
  'Principal retains full academic student access'
);

SELECT set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000105', true);
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000000105","amr":[{"method":"password"}],"session_id":"20000000-0000-4000-8000-000000000105"}', true);
SELECT is(
  (SELECT count(*) FROM public.academic_students),
  0::bigint,
  'Deactivated staff profile cannot read student records'
);
SELECT set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000106', true);
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000000106","amr":[{"method":"password"}],"session_id":"20000000-0000-4000-8000-000000000106"}', true);
SELECT is(
  (SELECT count(*) FROM public.academic_students),
  0::bigint,
  'Unassigned authenticated account cannot read student records'
);

RESET ROLE;
SET LOCAL ROLE anon;
SELECT throws_ok(
  $$SELECT count(*) FROM public.academic_students$$,
  '42501',
  NULL,
  'Unauthenticated visitors cannot query student records'
);
SELECT throws_ok(
  $$SELECT count(*) FROM public.admin_email_mfa_sessions$$,
  '42501',
  NULL,
  'Unauthenticated visitors cannot inspect administrator verification sessions'
);

RESET ROLE;
SELECT * FROM finish();
ROLLBACK;
