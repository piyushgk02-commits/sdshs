CREATE TABLE public.academic_sections (
  class_number smallint NOT NULL CHECK (class_number BETWEEN 1 AND 12),
  section text NOT NULL CHECK (section IN ('A', 'B')),
  student_capacity smallint NOT NULL DEFAULT 60 CHECK (student_capacity BETWEEN 1 AND 200),
  PRIMARY KEY (class_number, section)
);

INSERT INTO public.academic_sections (class_number, section)
SELECT class_number, section
FROM generate_series(1, 12) AS grades(class_number)
CROSS JOIN (VALUES ('A'), ('B')) AS sections(section);

CREATE TABLE public.staff_profiles (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name text NOT NULL CHECK (length(trim(full_name)) BETWEEN 1 AND 120),
  email text NOT NULL UNIQUE,
  role text NOT NULL CHECK (role IN ('Director', 'Principal', 'Class Coordinator', 'Class Teacher')),
  assigned_class smallint,
  assigned_section text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (role IN ('Director', 'Principal') AND assigned_class IS NULL AND assigned_section IS NULL)
    OR (role = 'Class Coordinator' AND assigned_class IS NOT NULL AND assigned_class BETWEEN 1 AND 12 AND assigned_section IS NULL)
    OR (role = 'Class Teacher' AND assigned_class IS NOT NULL AND assigned_class BETWEEN 1 AND 12 AND assigned_section IN ('A', 'B'))
  ),
  FOREIGN KEY (assigned_class, assigned_section)
    REFERENCES public.academic_sections(class_number, section)
    MATCH SIMPLE
);

CREATE UNIQUE INDEX staff_profiles_one_active_coordinator_per_class
  ON public.staff_profiles (assigned_class)
  WHERE role = 'Class Coordinator' AND status = 'active';

CREATE UNIQUE INDEX staff_profiles_one_active_teacher_per_section
  ON public.staff_profiles (assigned_class, assigned_section)
  WHERE role = 'Class Teacher' AND status = 'active';

CREATE FUNCTION public.handle_school_manager_auth_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.raw_app_meta_data->>'role' IN ('Director', 'Principal') AND NEW.email IS NOT NULL THEN
    INSERT INTO public.staff_profiles (user_id, full_name, email, role)
    VALUES (
      NEW.id,
      COALESCE(
        NULLIF(NEW.raw_app_meta_data->>'display_name', ''),
        NULLIF(NEW.raw_user_meta_data->>'full_name', ''),
        NEW.email
      ),
      lower(NEW.email),
      NEW.raw_app_meta_data->>'role'
    )
    ON CONFLICT (user_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER school_manager_profile_on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_school_manager_auth_user();

CREATE TABLE public.academic_students (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admission_number text NOT NULL UNIQUE,
  full_name text NOT NULL,
  class_number smallint NOT NULL,
  section text NOT NULL,
  father_name text NOT NULL,
  mother_name text NOT NULL,
  admission_date date NOT NULL,
  annual_fee numeric(10, 2) NOT NULL CHECK (annual_fee >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (class_number, section, admission_number),
  FOREIGN KEY (class_number, section)
    REFERENCES public.academic_sections(class_number, section)
);

CREATE TABLE public.student_guardian_contacts (
  student_id uuid PRIMARY KEY REFERENCES public.academic_students(id) ON DELETE CASCADE,
  phone text NOT NULL,
  email text NOT NULL
);

CREATE TABLE public.academic_attendance (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  student_id uuid NOT NULL REFERENCES public.academic_students(id) ON DELETE CASCADE,
  attendance_date date NOT NULL,
  status text NOT NULL CHECK (status IN ('Present', 'Absent', 'Late')),
  UNIQUE (student_id, attendance_date)
);

CREATE TABLE public.academic_fee_payments (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  student_id uuid NOT NULL REFERENCES public.academic_students(id) ON DELETE CASCADE,
  paid_on date NOT NULL,
  amount numeric(10, 2) NOT NULL CHECK (amount > 0),
  method text NOT NULL CHECK (method IN ('UPI', 'Bank transfer', 'Cash')),
  reference text NOT NULL UNIQUE
);

CREATE FUNCTION public.enforce_academic_section_capacity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  section_capacity smallint;
  enrolled_count bigint;
BEGIN
  IF TG_OP = 'UPDATE'
    AND NEW.class_number = OLD.class_number
    AND NEW.section = OLD.section THEN
    RETURN NEW;
  END IF;

  SELECT section.student_capacity INTO section_capacity
  FROM public.academic_sections AS section
  WHERE section.class_number = NEW.class_number
    AND section.section = NEW.section
  FOR UPDATE;
  IF section_capacity IS NULL THEN
    RAISE EXCEPTION 'Academic section does not exist'
      USING ERRCODE = '23503';
  END IF;

  SELECT count(*) INTO enrolled_count
  FROM public.academic_students AS student
  WHERE student.class_number = NEW.class_number
    AND student.section = NEW.section
    AND (TG_OP <> 'UPDATE' OR student.id <> OLD.id);

  IF enrolled_count >= section_capacity THEN
    RAISE EXCEPTION 'Section capacity of % students has been reached', section_capacity
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION public.prevent_capacity_below_enrollment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  enrolled_count bigint;
BEGIN
  SELECT count(*) INTO enrolled_count
  FROM public.academic_students AS student
  WHERE student.class_number = OLD.class_number
    AND student.section = OLD.section;
  IF NEW.student_capacity < enrolled_count THEN
    RAISE EXCEPTION 'Capacity cannot be lower than the current enrollment of %', enrolled_count
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER academic_students_enforce_capacity
  BEFORE INSERT OR UPDATE OF class_number, section ON public.academic_students
  FOR EACH ROW EXECUTE FUNCTION public.enforce_academic_section_capacity();
CREATE TRIGGER academic_sections_prevent_capacity_reduction
  BEFORE UPDATE OF student_capacity ON public.academic_sections
  FOR EACH ROW EXECUTE FUNCTION public.prevent_capacity_below_enrollment();

CREATE INDEX academic_students_class_section_idx
  ON public.academic_students (class_number, section, admission_number);
CREATE INDEX academic_attendance_student_date_idx
  ON public.academic_attendance (student_id, attendance_date DESC);
CREATE INDEX academic_fee_payments_student_date_idx
  ON public.academic_fee_payments (student_id, paid_on DESC);

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
    WHERE profile.user_id = (SELECT auth.uid())
      AND profile.status = 'active'
      AND profile.role IN ('Director', 'Principal')
  );
$$;

CREATE FUNCTION public.can_view_academic_class(target_class smallint, target_section text DEFAULT NULL)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT public.is_school_manager()
    OR EXISTS (
      SELECT 1
      FROM public.staff_profiles AS profile
      WHERE profile.user_id = (SELECT auth.uid())
        AND profile.status = 'active'
        AND profile.assigned_class = target_class
        AND (
          (profile.role = 'Class Coordinator' AND target_section IN ('A', 'B'))
          OR (profile.role = 'Class Teacher' AND profile.assigned_section = target_section)
        )
    );
$$;

ALTER TABLE public.academic_sections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.academic_students ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.student_guardian_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.academic_attendance ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.academic_fee_payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY sections_read_assigned ON public.academic_sections
  FOR SELECT TO authenticated
  USING (
    public.is_school_manager()
    OR EXISTS (
      SELECT 1
      FROM public.staff_profiles AS profile
      WHERE profile.user_id = (SELECT auth.uid())
        AND profile.status = 'active'
        AND profile.assigned_class = class_number
        AND (profile.role = 'Class Coordinator' OR profile.assigned_section = section)
    )
  );
CREATE POLICY sections_manage_by_school_managers ON public.academic_sections
  FOR ALL TO authenticated
  USING (public.is_school_manager())
  WITH CHECK (public.is_school_manager());

CREATE POLICY profiles_read_self_or_managers ON public.staff_profiles
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()) OR public.is_school_manager());

CREATE POLICY students_read_assigned ON public.academic_students
  FOR SELECT TO authenticated
  USING (public.can_view_academic_class(class_number, section));
CREATE POLICY students_manage_by_school_managers ON public.academic_students
  FOR ALL TO authenticated
  USING (public.is_school_manager())
  WITH CHECK (public.is_school_manager());

CREATE POLICY contacts_read_coordinators_or_managers ON public.student_guardian_contacts
  FOR SELECT TO authenticated
  USING (
    public.is_school_manager()
    OR EXISTS (
      SELECT 1
      FROM public.academic_students AS student
      JOIN public.staff_profiles AS profile
        ON profile.assigned_class = student.class_number
      WHERE student.id = student_id
        AND profile.user_id = (SELECT auth.uid())
        AND profile.role = 'Class Coordinator'
        AND profile.status = 'active'
    )
  );
CREATE POLICY contacts_manage_by_school_managers ON public.student_guardian_contacts
  FOR ALL TO authenticated
  USING (public.is_school_manager())
  WITH CHECK (public.is_school_manager());

CREATE POLICY attendance_read_assigned ON public.academic_attendance
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.academic_students AS student
      WHERE student.id = student_id
        AND public.can_view_academic_class(student.class_number, student.section)
    )
  );
CREATE POLICY attendance_manage_by_school_managers ON public.academic_attendance
  FOR ALL TO authenticated
  USING (public.is_school_manager())
  WITH CHECK (public.is_school_manager());

CREATE POLICY fee_payments_read_assigned ON public.academic_fee_payments
  FOR SELECT TO authenticated
  USING (
    public.is_school_manager()
    OR EXISTS (
      SELECT 1
      FROM public.academic_students AS student
      JOIN public.staff_profiles AS profile
        ON profile.assigned_class = student.class_number
      WHERE student.id = student_id
        AND profile.user_id = (SELECT auth.uid())
        AND profile.role = 'Class Coordinator'
        AND profile.status = 'active'
    )
  );
CREATE POLICY fee_payments_manage_by_school_managers ON public.academic_fee_payments
  FOR ALL TO authenticated
  USING (public.is_school_manager())
  WITH CHECK (public.is_school_manager());

REVOKE ALL ON FUNCTION public.is_school_manager() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_view_academic_class(smallint, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.enforce_academic_section_capacity() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.prevent_capacity_below_enrollment() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.handle_school_manager_auth_user() FROM PUBLIC, anon;
REVOKE ALL ON TABLE
  public.academic_sections, public.academic_students, public.student_guardian_contacts,
  public.academic_attendance, public.academic_fee_payments
  FROM PUBLIC, anon;
REVOKE ALL ON TABLE public.staff_profiles FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE public.academic_attendance_id_seq,
  public.academic_fee_payments_id_seq FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_school_manager() TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_view_academic_class(smallint, text) TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON
  public.academic_sections, public.academic_students, public.student_guardian_contacts,
  public.academic_attendance, public.academic_fee_payments
  TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.academic_attendance_id_seq,
  public.academic_fee_payments_id_seq TO authenticated;
GRANT SELECT ON public.staff_profiles TO authenticated;

CREATE FUNCTION public.get_academic_fee_summaries()
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
     profile.role IN ('Director', 'Principal')
     OR (
       profile.assigned_class = student.class_number
       AND (
         profile.role = 'Class Coordinator'
         OR (profile.role = 'Class Teacher' AND profile.assigned_section = student.section)
       )
     )
   )
  LEFT JOIN public.academic_fee_payments AS payment ON payment.student_id = student.id
  GROUP BY student.id, student.annual_fee;
$$;

INSERT INTO public.staff_profiles (user_id, full_name, email, role)
SELECT
  account.id,
  COALESCE(
    NULLIF(account.raw_app_meta_data->>'display_name', ''),
    NULLIF(account.raw_user_meta_data->>'full_name', ''),
    account.email
  ),
  lower(account.email),
  account.raw_app_meta_data->>'role'
FROM auth.users AS account
WHERE account.raw_app_meta_data->>'role' IN ('Director', 'Principal')
  AND account.email IS NOT NULL
ON CONFLICT (user_id) DO NOTHING;

CREATE FUNCTION public.list_unassigned_staff_accounts()
RETURNS TABLE (user_id uuid, full_name text, email text, created_at timestamptz)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT public.is_school_manager() THEN
    RAISE EXCEPTION 'Only active Directors and Principals may manage staff'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT account.id,
    COALESCE(
      NULLIF(account.raw_user_meta_data->>'full_name', ''),
      NULLIF(account.raw_app_meta_data->>'display_name', ''),
      account.email
    ),
    account.email::text,
    account.created_at
  FROM auth.users AS account
  LEFT JOIN public.staff_profiles AS profile ON profile.user_id = account.id
  WHERE profile.user_id IS NULL
    AND account.email IS NOT NULL
  ORDER BY account.created_at DESC;
END;
$$;

CREATE FUNCTION public.list_academic_staff()
RETURNS TABLE (
  user_id uuid,
  full_name text,
  email text,
  role text,
  assigned_class smallint,
  assigned_section text,
  status text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT public.is_school_manager() THEN
    RAISE EXCEPTION 'Only active Directors and Principals may manage staff'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT profile.user_id, profile.full_name, profile.email, profile.role,
    profile.assigned_class, profile.assigned_section, profile.status
  FROM public.staff_profiles AS profile
  WHERE profile.role IN ('Class Coordinator', 'Class Teacher')
  ORDER BY profile.assigned_class, profile.role, profile.assigned_section;
END;
$$;

CREATE FUNCTION public.assign_academic_staff(
  target_user_id uuid,
  target_full_name text,
  target_role text,
  target_class smallint,
  target_section text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  target_email text;
  affected_rows integer;
BEGIN
  IF NOT public.is_school_manager() THEN
    RAISE EXCEPTION 'Only active Directors and Principals may manage staff'
      USING ERRCODE = '42501';
  END IF;
  IF target_user_id = (SELECT auth.uid()) THEN
    RAISE EXCEPTION 'Managers cannot change their own staff assignment'
      USING ERRCODE = '42501';
  END IF;
  IF target_role IS NULL
    OR target_role NOT IN ('Class Coordinator', 'Class Teacher')
    OR target_full_name IS NULL
    OR length(trim(target_full_name)) NOT BETWEEN 1 AND 120
    OR target_class IS NULL
    OR target_class NOT BETWEEN 1 AND 12
    OR (target_role = 'Class Coordinator' AND target_section IS NOT NULL)
    OR (target_role = 'Class Teacher' AND (target_section IS NULL OR target_section NOT IN ('A', 'B'))) THEN
    RAISE EXCEPTION 'Invalid academic staff assignment'
      USING ERRCODE = '22023';
  END IF;

  SELECT lower(account.email) INTO target_email
  FROM auth.users AS account
  WHERE account.id = target_user_id AND account.email IS NOT NULL;
  IF target_email IS NULL THEN
    RAISE EXCEPTION 'The invited account was not found'
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.staff_profiles AS existing_profile (
    user_id, full_name, email, role, assigned_class, assigned_section, status
  )
  VALUES (
    target_user_id, trim(target_full_name), target_email, target_role,
    target_class, target_section, 'active'
  )
  ON CONFLICT (user_id) DO UPDATE SET
    full_name = EXCLUDED.full_name,
    email = EXCLUDED.email,
    role = EXCLUDED.role,
    assigned_class = EXCLUDED.assigned_class,
    assigned_section = EXCLUDED.assigned_section,
    status = 'active',
    updated_at = now()
  WHERE existing_profile.role IN ('Class Coordinator', 'Class Teacher');

  GET DIAGNOSTICS affected_rows = ROW_COUNT;
  IF affected_rows = 0 THEN
    RAISE EXCEPTION 'Director and Principal profiles cannot be changed here'
      USING ERRCODE = '42501';
  END IF;
END;
$$;

CREATE FUNCTION public.set_academic_staff_status(target_user_id uuid, target_status text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  affected_rows integer;
BEGIN
  IF NOT public.is_school_manager() THEN
    RAISE EXCEPTION 'Only active Directors and Principals may manage staff'
      USING ERRCODE = '42501';
  END IF;
  IF target_user_id = (SELECT auth.uid()) THEN
    RAISE EXCEPTION 'Managers cannot change their own staff status'
      USING ERRCODE = '42501';
  END IF;
  IF target_status IS NULL OR target_status NOT IN ('active', 'inactive') THEN
    RAISE EXCEPTION 'Invalid account status'
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.staff_profiles
  SET status = target_status, updated_at = now()
  WHERE user_id = target_user_id
    AND role IN ('Class Coordinator', 'Class Teacher');
  GET DIAGNOSTICS affected_rows = ROW_COUNT;
  IF affected_rows = 0 THEN
    RAISE EXCEPTION 'Academic staff account was not found'
      USING ERRCODE = '22023';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.list_unassigned_staff_accounts() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.list_academic_staff() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.assign_academic_staff(uuid, text, text, smallint, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.set_academic_staff_status(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_academic_fee_summaries() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_unassigned_staff_accounts() TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_academic_staff() TO authenticated;
GRANT EXECUTE ON FUNCTION public.assign_academic_staff(uuid, text, text, smallint, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_academic_staff_status(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_academic_fee_summaries() TO authenticated;

DO $$
DECLARE
  first_names text[] := ARRAY[
    'Aarav', 'Anaya', 'Ishaan', 'Mira', 'Kabir', 'Sana', 'Dev', 'Ira', 'Rohan', 'Tara',
    'Neel', 'Asha', 'Arjun', 'Leela', 'Vikram', 'Nisha', 'Kiran', 'Riya', 'Aditya', 'Meera',
    'Vihaan', 'Diya', 'Rehan', 'Aditi', 'Samar', 'Myra', 'Neil', 'Kavya', 'Aryan', 'Ishita'
  ];
  last_names text[] := ARRAY[
    'Sharma', 'Patel', 'Rao', 'Nair', 'Mehta', 'Das', 'Kapoor', 'Iyer', 'Gupta', 'Sen',
    'Malik', 'Joshi', 'Menon', 'Bose', 'Reddy', 'Verma', 'Khan', 'Pillai', 'Roy', 'Shah',
    'Dutta', 'Jain', 'Thomas', 'Saxena', 'Bhat', 'Gill', 'Mishra', 'Chawla', 'Kulkarni', 'Suri'
  ];
  class_value integer;
  section_value text;
  section_index integer;
  student_number integer;
  students_in_section integer;
  student_id uuid;
  admission_number text;
  student_name text;
  father_name_value text;
  mother_name_value text;
  annual_fee_value numeric;
  paid_value numeric;
  first_payment numeric;
  second_payment numeric;
  day_value date;
  contact_number integer;
BEGIN
  FOR class_value IN 1..12 LOOP
    FOREACH section_value IN ARRAY ARRAY['A', 'B'] LOOP
      section_index := CASE section_value WHEN 'A' THEN 0 ELSE 1 END;
      students_in_section := 40 + ((class_value * 7 + section_index * 11) % 21);

      FOR student_number IN 1..students_in_section LOOP
        admission_number := format(
          'DEMO-2026-C%s-%s-%s',
          lpad(class_value::text, 2, '0'),
          section_value,
          lpad(student_number::text, 3, '0')
        );
        student_name := first_names[((class_value * 13 + section_index * 7 + student_number * 3) % array_length(first_names, 1)) + 1]
          || ' '
          || last_names[((class_value * 11 + section_index * 5 + student_number * 7) % array_length(last_names, 1)) + 1];
        father_name_value := first_names[((class_value * 5 + student_number * 9 + 2) % array_length(first_names, 1)) + 1]
          || ' '
          || last_names[((class_value * 3 + student_number * 11 + 4) % array_length(last_names, 1)) + 1];
        mother_name_value := first_names[((class_value * 7 + student_number * 13 + 8) % array_length(first_names, 1)) + 1]
          || ' '
          || last_names[((class_value * 9 + student_number * 3 + 6) % array_length(last_names, 1)) + 1];
        annual_fee_value := 24000 + class_value * 800;
        paid_value := 9000 + ((student_number * 337 + class_value * 113) % (12000 + class_value * 500));
        contact_number := 1000 + (class_value - 1) * 120 + section_index * 60 + student_number;

        INSERT INTO public.academic_students (
          admission_number, full_name, class_number, section, father_name,
          mother_name, admission_date, annual_fee
        )
        VALUES (
          admission_number,
          student_name,
          class_value,
          section_value,
          father_name_value,
          mother_name_value,
          make_date(2023 + (student_number % 4), 6, 1 + (student_number % 27)),
          annual_fee_value
        )
        RETURNING id INTO student_id;

        INSERT INTO public.student_guardian_contacts (student_id, phone, email)
        VALUES (
          student_id,
          '+1-202-555-' || lpad(contact_number::text, 4, '0'),
          format('guardian%s@example.invalid', contact_number)
        );

        FOR day_value IN
          SELECT DATE '2026-09-01' + offsets.day_offset
          FROM generate_series(0, 55) AS offsets(day_offset)
          WHERE extract(isodow FROM DATE '2026-09-01' + offsets.day_offset) BETWEEN 1 AND 5
        LOOP
          INSERT INTO public.academic_attendance (student_id, attendance_date, status)
          VALUES (
            student_id,
            day_value,
            CASE
              WHEN (student_number * 7 + extract(doy FROM day_value)::integer) % 19 = 0 THEN 'Absent'
              WHEN (student_number * 11 + extract(doy FROM day_value)::integer) % 17 = 0 THEN 'Late'
              ELSE 'Present'
            END
          );
        END LOOP;

        first_payment := floor(paid_value * 0.4);
        second_payment := floor(paid_value * 0.35);
        INSERT INTO public.academic_fee_payments (student_id, paid_on, amount, method, reference)
        VALUES
          (student_id, DATE '2026-07-15', first_payment, 'UPI', admission_number || '-FEE-1'),
          (student_id, DATE '2026-09-18', second_payment, 'Bank transfer', admission_number || '-FEE-2'),
          (student_id, DATE '2026-10-25', paid_value - first_payment - second_payment, 'Cash', admission_number || '-FEE-3');
      END LOOP;
    END LOOP;
  END LOOP;
END;
$$;
