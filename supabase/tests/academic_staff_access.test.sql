BEGIN;

SELECT plan(16);

INSERT INTO auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  created_at, updated_at, raw_app_meta_data, raw_user_meta_data
)
VALUES
  ('00000000-0000-4000-8000-000000000101', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rls-teacher-a@example.invalid', '', now(), now(), now(), '{}', '{"full_name":"Test Teacher A"}'),
  ('00000000-0000-4000-8000-000000000102', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rls-coordinator@example.invalid', '', now(), now(), now(), '{}', '{"full_name":"Test Coordinator"}'),
  ('00000000-0000-4000-8000-000000000103', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rls-director@example.invalid', '', now(), now(), now(), '{}', '{"full_name":"Test Director"}'),
  ('00000000-0000-4000-8000-000000000104', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rls-principal@example.invalid', '', now(), now(), now(), '{}', '{"full_name":"Test Principal"}'),
  ('00000000-0000-4000-8000-000000000105', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rls-inactive@example.invalid', '', now(), now(), now(), '{}', '{"full_name":"Inactive Teacher"}');

INSERT INTO public.staff_profiles (user_id, full_name, email, role, assigned_class, assigned_section, status)
VALUES
  ('00000000-0000-4000-8000-000000000101', 'Test Teacher A', 'rls-teacher-a@example.invalid', 'Class Teacher', 1, 'A', 'active'),
  ('00000000-0000-4000-8000-000000000102', 'Test Coordinator', 'rls-coordinator@example.invalid', 'Class Coordinator', 1, NULL, 'active'),
  ('00000000-0000-4000-8000-000000000103', 'Test Director', 'rls-director@example.invalid', 'Director', NULL, NULL, 'active'),
  ('00000000-0000-4000-8000-000000000104', 'Test Principal', 'rls-principal@example.invalid', 'Principal', NULL, NULL, 'active'),
  ('00000000-0000-4000-8000-000000000105', 'Inactive Teacher', 'rls-inactive@example.invalid', 'Class Teacher', 1, 'A', 'inactive');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000101', true);
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
SELECT is(
  (WITH changed AS (
    UPDATE public.academic_fee_payments
    SET amount = amount + 1
    WHERE reference = 'DEMO-2026-C01-A-001-FEE-1'
    RETURNING 1
  ) SELECT count(*) FROM changed),
  0::bigint,
  'Class teacher fee updates affect no rows'
);

SELECT set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000102', true);
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
SELECT is(
  (WITH removed AS (
    DELETE FROM public.academic_students
    WHERE admission_number = 'DEMO-2026-C01-A-001'
    RETURNING 1
  ) SELECT count(*) FROM removed),
  0::bigint,
  'Class coordinator student deletes affect no rows'
);

SELECT set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000103', true);
SELECT is(
  (SELECT count(*) FROM public.academic_students),
  1176::bigint,
  'Director retains full academic student access'
);

SELECT set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000104', true);
SELECT is(
  (SELECT count(*) FROM public.academic_students),
  1176::bigint,
  'Principal retains full academic student access'
);

SELECT set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000105', true);
SELECT is(
  (SELECT count(*) FROM public.academic_students),
  0::bigint,
  'Deactivated staff profile cannot read student records'
);

RESET ROLE;
SET LOCAL ROLE anon;
SELECT throws_ok(
  $$SELECT count(*) FROM public.academic_students$$,
  '42501',
  'Unauthenticated visitors cannot query student records'
);

RESET ROLE;
SELECT * FROM finish();
ROLLBACK;
