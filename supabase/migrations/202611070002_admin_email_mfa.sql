BEGIN;

ALTER TABLE public.staff_profiles
  ADD COLUMN google_login_allowed boolean NOT NULL DEFAULT false;

UPDATE public.staff_profiles AS profile
SET google_login_allowed = true
FROM auth.users AS account
WHERE account.id = profile.user_id
  AND account.raw_app_meta_data->>'role' = profile.role
  AND profile.role IN ('Director', 'Principal');

CREATE OR REPLACE FUNCTION public.handle_school_manager_auth_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.raw_app_meta_data->>'role' IN ('Director', 'Principal') AND NEW.email IS NOT NULL THEN
    INSERT INTO public.staff_profiles (
      user_id, full_name, email, role, google_login_allowed
    )
    VALUES (
      NEW.id,
      COALESCE(
        NULLIF(NEW.raw_app_meta_data->>'display_name', ''),
        NULLIF(NEW.raw_user_meta_data->>'full_name', ''),
        NEW.email
      ),
      lower(NEW.email),
      NEW.raw_app_meta_data->>'role',
      true
    )
    ON CONFLICT (user_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.authorize_google_admin_user_creation(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  target_email text := lower(event->'user'->>'email');
  target_provider text := event->'user'->'app_metadata'->>'provider';
BEGIN
  IF target_provider = 'google' AND (
    event->'user'->'user_metadata'->>'email_verified' IS DISTINCT FROM 'true'
    OR NOT EXISTS (
      SELECT 1
      FROM public.staff_profiles AS profile
      WHERE lower(profile.email) = target_email
        AND profile.role IN ('Director', 'Principal')
        AND profile.status = 'active'
        AND profile.google_login_allowed
    )
  ) THEN
    RETURN jsonb_build_object(
      'error', jsonb_build_object(
        'message', 'This Google account is not authorized for SCHOOL COMMAND.',
        'http_code', 403
      )
    );
  END IF;

  RETURN '{}'::jsonb;
END;
$$;

GRANT EXECUTE ON FUNCTION public.authorize_google_admin_user_creation(jsonb)
  TO supabase_auth_admin;
REVOKE EXECUTE ON FUNCTION public.authorize_google_admin_user_creation(jsonb)
  FROM authenticated, anon, public;

CREATE TABLE public.admin_email_mfa_challenges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  auth_session_id uuid NOT NULL,
  otp_hash text NOT NULL,
  attempts smallint NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  used_at timestamptz
);

CREATE INDEX admin_email_mfa_challenges_user_created_idx
  ON public.admin_email_mfa_challenges (user_id, created_at DESC);
CREATE INDEX admin_email_mfa_challenges_session_created_idx
  ON public.admin_email_mfa_challenges (auth_session_id, created_at DESC);

CREATE TABLE public.admin_email_mfa_sessions (
  auth_session_id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  verified_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz
);

CREATE TABLE public.academic_email_otp_sessions (
  auth_session_id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  verified_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz
);

ALTER TABLE public.admin_email_mfa_challenges ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_email_mfa_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.academic_email_otp_sessions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.admin_email_mfa_challenges,
  public.admin_email_mfa_sessions, public.academic_email_otp_sessions
  FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.admin_email_mfa_challenges,
  public.admin_email_mfa_sessions, public.academic_email_otp_sessions TO service_role;

CREATE FUNCTION public.issue_admin_email_mfa(
  target_user_id uuid,
  target_session_id uuid,
  target_otp_hash text
)
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  latest_created_at timestamptz;
  recent_issue_count integer;
  challenge_expiration timestamptz := now() + interval '5 minutes';
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(target_user_id::text, 0));

  IF NOT EXISTS (
    SELECT 1
    FROM public.staff_profiles AS profile
    WHERE profile.user_id = target_user_id
      AND profile.role IN ('Director', 'Principal')
      AND profile.status = 'active'
      AND profile.google_login_allowed
  ) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;

  SELECT challenge.created_at INTO latest_created_at
  FROM public.admin_email_mfa_challenges AS challenge
  WHERE challenge.auth_session_id = target_session_id
    AND challenge.user_id = target_user_id
  ORDER BY challenge.created_at DESC
  LIMIT 1;

  IF latest_created_at > now() - interval '60 seconds' THEN
    RAISE EXCEPTION 'cooldown' USING ERRCODE = 'P0001';
  END IF;

  SELECT count(*)::integer INTO recent_issue_count
  FROM public.admin_email_mfa_challenges AS challenge
  WHERE challenge.user_id = target_user_id
    AND challenge.created_at > now() - interval '30 minutes';

  IF recent_issue_count >= 5 THEN
    RAISE EXCEPTION 'rate_limited' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.admin_email_mfa_challenges
  SET used_at = COALESCE(used_at, now())
  WHERE auth_session_id = target_session_id
    AND user_id = target_user_id
    AND used_at IS NULL;

  INSERT INTO public.admin_email_mfa_challenges (
    user_id, auth_session_id, otp_hash, expires_at
  )
  VALUES (
    target_user_id, target_session_id, target_otp_hash, challenge_expiration
  );

  DELETE FROM public.admin_email_mfa_challenges
  WHERE created_at < now() - interval '1 day';

  RETURN challenge_expiration;
END;
$$;

CREATE FUNCTION public.verify_admin_email_mfa(
  target_user_id uuid,
  target_session_id uuid,
  target_otp_hash text
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  challenge public.admin_email_mfa_challenges%ROWTYPE;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.staff_profiles AS profile
    WHERE profile.user_id = target_user_id
      AND profile.role IN ('Director', 'Principal')
      AND profile.status = 'active'
      AND profile.google_login_allowed
  ) THEN
    RETURN 'not_authorized';
  END IF;

  SELECT * INTO challenge
  FROM public.admin_email_mfa_challenges
  WHERE user_id = target_user_id
    AND auth_session_id = target_session_id
    AND used_at IS NULL
  ORDER BY created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND OR challenge.expires_at <= now() THEN
    RETURN 'expired';
  END IF;
  IF challenge.attempts >= 5 THEN
    RETURN 'rate_limited';
  END IF;

  IF challenge.otp_hash <> target_otp_hash THEN
    UPDATE public.admin_email_mfa_challenges
    SET attempts = attempts + 1
    WHERE id = challenge.id;
    IF challenge.attempts + 1 >= 5 THEN
      RETURN 'rate_limited';
    END IF;
    RETURN 'invalid';
  END IF;

  UPDATE public.admin_email_mfa_challenges
  SET used_at = now()
  WHERE id = challenge.id;

  INSERT INTO public.admin_email_mfa_sessions (
    auth_session_id, user_id, verified_at, expires_at, revoked_at
  )
  VALUES (
    target_session_id, target_user_id, now(), now() + interval '12 hours', NULL
  )
  ON CONFLICT (auth_session_id) DO UPDATE SET
    user_id = EXCLUDED.user_id,
    verified_at = EXCLUDED.verified_at,
    expires_at = EXCLUDED.expires_at,
    revoked_at = NULL;

  RETURN 'verified';
END;
$$;

CREATE FUNCTION public.is_school_manager()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.staff_profiles AS profile
    JOIN public.admin_email_mfa_sessions AS mfa
      ON mfa.user_id = profile.user_id
     AND mfa.auth_session_id = ((SELECT auth.jwt())->>'session_id')::uuid
     AND mfa.expires_at > now()
     AND mfa.revoked_at IS NULL
    JOIN auth.users AS account
      ON account.id = profile.user_id
     AND lower(account.email) = lower(profile.email)
     AND account.email_confirmed_at IS NOT NULL
    WHERE profile.user_id = (SELECT auth.uid())
      AND profile.status = 'active'
      AND profile.google_login_allowed
      AND profile.role IN ('Director', 'Principal')
      AND EXISTS (
        SELECT 1
        FROM auth.identities AS google_identity
        WHERE google_identity.user_id = profile.user_id
          AND google_identity.provider = 'google'
          AND lower(google_identity.identity_data->>'email') = lower(profile.email)
          AND google_identity.identity_data->>'email_verified' = 'true'
      )
  );
$$;

CREATE FUNCTION public.is_academic_email_otp_session()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.academic_email_otp_sessions AS otp_session
    JOIN public.staff_profiles AS profile
      ON profile.user_id = otp_session.user_id
    JOIN auth.users AS account
      ON account.id = profile.user_id
     AND lower(account.email) = lower(profile.email)
     AND account.email_confirmed_at IS NOT NULL
    WHERE otp_session.user_id = (SELECT auth.uid())
      AND otp_session.auth_session_id = ((SELECT auth.jwt())->>'session_id')::uuid
      AND otp_session.expires_at > now()
      AND otp_session.revoked_at IS NULL
      AND profile.status = 'active'
      AND profile.role IN ('Class Coordinator', 'Class Teacher')
  );
$$;

CREATE OR REPLACE FUNCTION public.can_view_academic_class(target_class smallint, target_section text DEFAULT NULL)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT public.is_school_manager()
    OR (
      public.is_academic_email_otp_session()
      AND EXISTS (
        SELECT 1
        FROM public.staff_profiles AS profile
        WHERE profile.user_id = (SELECT auth.uid())
          AND profile.status = 'active'
          AND profile.assigned_class = target_class
          AND (
            (profile.role = 'Class Coordinator' AND target_section IN ('A', 'B'))
            OR (profile.role = 'Class Teacher' AND profile.assigned_section = target_section)
          )
      )
    );
$$;

DROP POLICY sections_read_assigned ON public.academic_sections;
CREATE POLICY sections_read_assigned ON public.academic_sections
  FOR SELECT TO authenticated
  USING (
    public.is_school_manager()
    OR (
      public.is_academic_email_otp_session()
      AND EXISTS (
        SELECT 1
        FROM public.staff_profiles AS profile
        WHERE profile.user_id = (SELECT auth.uid())
          AND profile.status = 'active'
          AND profile.assigned_class = class_number
          AND (profile.role = 'Class Coordinator' OR profile.assigned_section = section)
      )
    )
  );

DROP POLICY profiles_read_self_or_managers ON public.staff_profiles;
CREATE POLICY profiles_read_self_or_managers ON public.staff_profiles
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()) OR public.is_school_manager());

DROP POLICY contacts_read_coordinators_or_managers ON public.student_guardian_contacts;
CREATE POLICY contacts_read_coordinators_or_managers ON public.student_guardian_contacts
  FOR SELECT TO authenticated
  USING (
    public.is_school_manager()
    OR (
      public.is_academic_email_otp_session()
      AND EXISTS (
        SELECT 1
        FROM public.academic_students AS student
        JOIN public.staff_profiles AS profile
          ON profile.assigned_class = student.class_number
        WHERE student.id = student_id
          AND profile.user_id = (SELECT auth.uid())
          AND profile.role = 'Class Coordinator'
          AND profile.status = 'active'
      )
    )
  );

DROP POLICY fee_payments_read_assigned ON public.academic_fee_payments;
CREATE POLICY fee_payments_read_assigned ON public.academic_fee_payments
  FOR SELECT TO authenticated
  USING (
    public.is_school_manager()
    OR (
      public.is_academic_email_otp_session()
      AND EXISTS (
        SELECT 1
        FROM public.academic_students AS student
        JOIN public.staff_profiles AS profile
          ON profile.assigned_class = student.class_number
        WHERE student.id = student_id
          AND profile.user_id = (SELECT auth.uid())
          AND profile.role = 'Class Coordinator'
          AND profile.status = 'active'
      )
    )
  );

CREATE OR REPLACE FUNCTION public.get_academic_fee_summaries()
RETURNS TABLE (
  student_id uuid,
  total_fees numeric,
  fees_paid numeric,
  balance numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT student.id,
    student.annual_fee,
    COALESCE(sum(payment.amount), 0)::numeric,
    student.annual_fee - COALESCE(sum(payment.amount), 0)::numeric
  FROM public.academic_students AS student
  JOIN public.staff_profiles AS profile
    ON profile.user_id = (SELECT auth.uid())
   AND profile.status = 'active'
   AND (
     (profile.role IN ('Director', 'Principal') AND public.is_school_manager())
     OR (
       profile.role IN ('Class Coordinator', 'Class Teacher')
       AND public.is_academic_email_otp_session()
       AND profile.assigned_class = student.class_number
       AND (
         profile.role = 'Class Coordinator'
         OR profile.assigned_section = student.section
       )
     )
   )
  LEFT JOIN public.academic_fee_payments AS payment ON payment.student_id = student.id
  GROUP BY student.id, student.annual_fee;
$$;

REVOKE ALL ON FUNCTION public.issue_admin_email_mfa(uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.verify_admin_email_mfa(uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.is_academic_email_otp_session()
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.issue_admin_email_mfa(uuid, uuid, text)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.verify_admin_email_mfa(uuid, uuid, text)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.is_academic_email_otp_session()
  TO authenticated;

COMMIT;
