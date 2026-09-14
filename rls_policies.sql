-- =====================================================================
-- ระบบ ปพ.5 - Row-Level Security (RLS) Policies
-- =====================================================================
-- ใช้กับ Supabase / PostgreSQL
-- รันหลังจาก schema.sql เสร็จแล้ว
--
-- กฎรวม:
--   - Admin       → เห็น/แก้ทุกอย่าง
--   - ครูทั่วไป   → เห็นข้อมูลทั้งโรงเรียน, แก้ได้เฉพาะวิชาตัวเอง
--   - ครูประจำชั้น → เพิ่มเติม: แก้เวลาเรียน + ประเมินคุณลักษณะ, ดูคะแนนทั้งห้อง read-only
--   - นักเรียน    → เห็นเฉพาะตัวเอง · เกรด/คุณลักษณะดูได้เฉพาะที่ finalized แล้ว
-- =====================================================================


-- =====================================================================
-- HELPER FUNCTIONS
-- =====================================================================
-- ฟังก์ชันช่วยเช็คบทบาท · ใช้ใน policies

-- 1. เช็คว่า user ปัจจุบันเป็น admin
CREATE OR REPLACE FUNCTION is_admin() RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM users
    WHERE auth_user_id = auth.uid()
    AND role = 'admin'
    AND is_active = TRUE
  );
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- 2. เช็คว่า user ปัจจุบันเป็นครู
CREATE OR REPLACE FUNCTION is_teacher() RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM users
    WHERE auth_user_id = auth.uid()
    AND role = 'teacher'
    AND is_active = TRUE
  );
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- 3. เช็คว่าเป็น admin หรือครู (= ใช้หลังบ้าน)
CREATE OR REPLACE FUNCTION is_staff() RETURNS BOOLEAN AS $$
  SELECT is_admin() OR is_teacher();
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- 4. ดึง teacher_id ของ user ปัจจุบัน
CREATE OR REPLACE FUNCTION current_teacher_id() RETURNS UUID AS $$
  SELECT t.id FROM teachers t
  JOIN users u ON u.id = t.user_id
  WHERE u.auth_user_id = auth.uid();
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- 5. ดึง student_id ของ user ปัจจุบัน (สำหรับ Portal)
CREATE OR REPLACE FUNCTION current_student_id() RETURNS UUID AS $$
  SELECT id FROM students WHERE auth_user_id = auth.uid();
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- 6. เช็คว่าครูปัจจุบันสอน offering นี้มั้ย
CREATE OR REPLACE FUNCTION teacher_teaches_offering(_offering_id UUID) RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM subject_offerings so
    WHERE so.id = _offering_id
    AND so.teacher_id = current_teacher_id()
  );
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- 7. เช็คว่าครูปัจจุบันเป็นครูประจำชั้นของห้องนี้มั้ย
CREATE OR REPLACE FUNCTION teacher_is_homeroom_of(_classroom_id UUID) RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM homeroom_assignments ha
    WHERE ha.classroom_id = _classroom_id
    AND ha.teacher_id = current_teacher_id()
  );
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- 8. เช็คว่าครูปัจจุบันเกี่ยวข้องกับห้องนี้มั้ย (สอน OR ประจำชั้น)
CREATE OR REPLACE FUNCTION teacher_involved_with_classroom(_classroom_id UUID) RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM subject_offerings so
    WHERE so.classroom_id = _classroom_id
    AND so.teacher_id = current_teacher_id()
  ) OR EXISTS (
    SELECT 1 FROM homeroom_assignments ha
    WHERE ha.classroom_id = _classroom_id
    AND ha.teacher_id = current_teacher_id()
  );
$$ LANGUAGE sql STABLE SECURITY DEFINER;


-- =====================================================================
-- ENABLE RLS ON ALL TABLES
-- =====================================================================

ALTER TABLE schools ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE parents ENABLE ROW LEVEL SECURITY;
ALTER TABLE academic_years ENABLE ROW LEVEL SECURITY;
ALTER TABLE grade_levels ENABLE ROW LEVEL SECURITY;
ALTER TABLE classrooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE teachers ENABLE ROW LEVEL SECURITY;
ALTER TABLE students ENABLE ROW LEVEL SECURITY;
ALTER TABLE enrollments ENABLE ROW LEVEL SECURITY;
ALTER TABLE parent_student_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE homeroom_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE learning_areas ENABLE ROW LEVEL SECURITY;
ALTER TABLE subjects ENABLE ROW LEVEL SECURITY;
ALTER TABLE study_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE study_plan_subjects ENABLE ROW LEVEL SECURITY;
ALTER TABLE subject_offerings ENABLE ROW LEVEL SECURITY;
ALTER TABLE score_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE grades ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance ENABLE ROW LEVEL SECURITY;
ALTER TABLE workdays ENABLE ROW LEVEL SECURITY;
ALTER TABLE subject_attendance ENABLE ROW LEVEL SECURITY;
ALTER TABLE subject_schedule_slots ENABLE ROW LEVEL SECURITY;
ALTER TABLE subject_schedule_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE characteristics ENABLE ROW LEVEL SECURITY;
ALTER TABLE characteristic_evaluations ENABLE ROW LEVEL SECURITY;
ALTER TABLE reading_thinking_evaluations ENABLE ROW LEVEL SECURITY;
ALTER TABLE competency_evaluations ENABLE ROW LEVEL SECURITY;
ALTER TABLE holidays ENABLE ROW LEVEL SECURITY;
ALTER TABLE grade_scales ENABLE ROW LEVEL SECURITY;
ALTER TABLE announcements ENABLE ROW LEVEL SECURITY;


-- =====================================================================
-- MODULE 1: CORE / AUTH
-- =====================================================================

-- SCHOOLS: ทุกคนอ่านได้ · admin แก้ได้
CREATE POLICY "schools_read_all" ON schools
    FOR SELECT USING (TRUE);

CREATE POLICY "schools_admin_write" ON schools
    FOR ALL USING (is_admin()) WITH CHECK (is_admin());


-- USERS: admin แก้ได้ทุกคน · user ดูตัวเองได้
CREATE POLICY "users_admin_all" ON users
    FOR ALL USING (is_admin()) WITH CHECK (is_admin());

CREATE POLICY "users_self_read" ON users
    FOR SELECT USING (auth_user_id = auth.uid());

CREATE POLICY "users_self_update" ON users
    FOR UPDATE USING (auth_user_id = auth.uid())
    WITH CHECK (auth_user_id = auth.uid() AND role = (SELECT role FROM users WHERE auth_user_id = auth.uid()));


-- PARENTS: admin/ครูดูได้ · นักเรียนดูเฉพาะของตัวเอง
CREATE POLICY "parents_staff_all" ON parents
    FOR ALL USING (is_staff()) WITH CHECK (is_admin());

CREATE POLICY "parents_student_read_own" ON parents
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM parent_student_links psl
            WHERE psl.parent_id = parents.id
            AND psl.student_id = current_student_id()
        )
    );


-- =====================================================================
-- MODULE 2: ACADEMIC STRUCTURE
-- =====================================================================

-- ACADEMIC_YEARS: ทุกคนอ่านได้ · admin แก้
CREATE POLICY "years_read_all" ON academic_years FOR SELECT USING (TRUE);
CREATE POLICY "years_admin_write" ON academic_years
    FOR ALL USING (is_admin()) WITH CHECK (is_admin());


-- GRADE_LEVELS: master data · ทุกคนอ่าน · admin แก้
CREATE POLICY "grade_levels_read_all" ON grade_levels FOR SELECT USING (TRUE);
CREATE POLICY "grade_levels_admin_write" ON grade_levels
    FOR ALL USING (is_admin()) WITH CHECK (is_admin());


-- CLASSROOMS: staff ทุกคนอ่านได้ · นักเรียนดูเฉพาะของตัวเอง · admin แก้
CREATE POLICY "classrooms_staff_read" ON classrooms FOR SELECT USING (is_staff());
CREATE POLICY "classrooms_student_read_own" ON classrooms
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM enrollments e
            WHERE e.classroom_id = classrooms.id
            AND e.student_id = current_student_id()
        )
    );
CREATE POLICY "classrooms_admin_write" ON classrooms
    FOR ALL USING (is_admin()) WITH CHECK (is_admin());


-- =====================================================================
-- MODULE 3: PEOPLE
-- =====================================================================

-- TEACHERS: staff ทุกคนอ่าน · นักเรียนดูครูที่สอน · admin แก้
CREATE POLICY "teachers_staff_read" ON teachers FOR SELECT USING (is_staff());
CREATE POLICY "teachers_student_read_relevant" ON teachers
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM subject_offerings so
            JOIN enrollments e ON e.classroom_id = so.classroom_id
            WHERE so.teacher_id = teachers.id
            AND e.student_id = current_student_id()
        )
    );
CREATE POLICY "teachers_admin_write" ON teachers
    FOR ALL USING (is_admin()) WITH CHECK (is_admin());


-- STUDENTS: staff ทุกคนอ่าน (ทั้งโรงเรียน) · นักเรียนดูตัวเอง · admin แก้
CREATE POLICY "students_staff_read" ON students FOR SELECT USING (is_staff());
CREATE POLICY "students_self_read" ON students
    FOR SELECT USING (auth_user_id = auth.uid());
CREATE POLICY "students_admin_write" ON students
    FOR ALL USING (is_admin()) WITH CHECK (is_admin());


-- ENROLLMENTS: staff อ่าน · นักเรียนดูของตัวเอง · admin แก้
CREATE POLICY "enrollments_staff_read" ON enrollments FOR SELECT USING (is_staff());
CREATE POLICY "enrollments_student_read_own" ON enrollments
    FOR SELECT USING (student_id = current_student_id());
CREATE POLICY "enrollments_admin_write" ON enrollments
    FOR ALL USING (is_admin()) WITH CHECK (is_admin());


-- PARENT_STUDENT_LINKS: staff อ่าน · นักเรียนดูของตัวเอง · admin แก้
CREATE POLICY "links_staff_read" ON parent_student_links FOR SELECT USING (is_staff());
CREATE POLICY "links_student_read_own" ON parent_student_links
    FOR SELECT USING (student_id = current_student_id());
CREATE POLICY "links_admin_write" ON parent_student_links
    FOR ALL USING (is_admin()) WITH CHECK (is_admin());


-- HOMEROOM_ASSIGNMENTS: ทุกคน staff อ่านได้ · admin แก้
CREATE POLICY "homeroom_staff_read" ON homeroom_assignments FOR SELECT USING (is_staff());
CREATE POLICY "homeroom_admin_write" ON homeroom_assignments
    FOR ALL USING (is_admin()) WITH CHECK (is_admin());


-- =====================================================================
-- MODULE 4: CURRICULUM
-- =====================================================================

-- LEARNING_AREAS: master data · ทุกคนอ่าน · admin แก้
CREATE POLICY "areas_read_all" ON learning_areas FOR SELECT USING (TRUE);
CREATE POLICY "areas_admin_write" ON learning_areas
    FOR ALL USING (is_admin()) WITH CHECK (is_admin());


-- SUBJECTS: staff อ่าน · นักเรียนอ่าน (ทุกวิชาในระบบ) · admin แก้
CREATE POLICY "subjects_read_all" ON subjects FOR SELECT USING (TRUE);
CREATE POLICY "subjects_admin_write" ON subjects
    FOR ALL USING (is_admin()) WITH CHECK (is_admin());


-- STUDY_PLANS: ทุกคนอ่าน · admin แก้
CREATE POLICY "plans_read_all" ON study_plans FOR SELECT USING (TRUE);
CREATE POLICY "plans_admin_write" ON study_plans
    FOR ALL USING (is_admin()) WITH CHECK (is_admin());


-- STUDY_PLAN_SUBJECTS: ทุกคนอ่าน · admin แก้
CREATE POLICY "plan_subjects_read_all" ON study_plan_subjects FOR SELECT USING (TRUE);
CREATE POLICY "plan_subjects_admin_write" ON study_plan_subjects
    FOR ALL USING (is_admin()) WITH CHECK (is_admin());


-- SUBJECT_OFFERINGS: staff อ่านทั้งหมด · นักเรียนดูเฉพาะวิชาตัวเอง · admin แก้
CREATE POLICY "offerings_staff_read" ON subject_offerings FOR SELECT USING (is_staff());
CREATE POLICY "offerings_student_read_own" ON subject_offerings
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM enrollments e
            WHERE e.classroom_id = subject_offerings.classroom_id
            AND e.student_id = current_student_id()
        )
    );
CREATE POLICY "offerings_admin_write" ON subject_offerings
    FOR ALL USING (is_admin()) WITH CHECK (is_admin());


-- =====================================================================
-- MODULE 5: ASSESSMENT
-- =====================================================================

-- SCORE_CATEGORIES:
--   - staff อ่านทั้งหมด
--   - ครูแก้ได้เฉพาะ offering ตัวเอง
--   - admin แก้ทั้งหมด
CREATE POLICY "categories_staff_read" ON score_categories FOR SELECT USING (is_staff());

CREATE POLICY "categories_teacher_write_own" ON score_categories
    FOR ALL
    USING (is_teacher() AND teacher_teaches_offering(offering_id))
    WITH CHECK (is_teacher() AND teacher_teaches_offering(offering_id));

CREATE POLICY "categories_admin_all" ON score_categories
    FOR ALL USING (is_admin()) WITH CHECK (is_admin());


-- SCORES:
--   - staff อ่านทั้งหมด (ครูประจำชั้นเห็นทุกวิชาของห้องตัวเอง)
--   - ครูแก้ได้เฉพาะ offering ตัวเอง
--   - admin แก้ทั้งหมด
--   - นักเรียน: ❌ ไม่ให้เห็น scores ดิบ (ดูเฉพาะ grade ที่สรุปแล้ว)
CREATE POLICY "scores_staff_read" ON scores FOR SELECT USING (is_staff());

CREATE POLICY "scores_teacher_write_own" ON scores
    FOR ALL
    USING (
        is_teacher() AND
        EXISTS (
            SELECT 1 FROM score_categories sc
            WHERE sc.id = scores.category_id
            AND teacher_teaches_offering(sc.offering_id)
        )
    )
    WITH CHECK (
        is_teacher() AND
        EXISTS (
            SELECT 1 FROM score_categories sc
            WHERE sc.id = scores.category_id
            AND teacher_teaches_offering(sc.offering_id)
        )
    );

CREATE POLICY "scores_admin_all" ON scores
    FOR ALL USING (is_admin()) WITH CHECK (is_admin());


-- GRADES:
--   - staff อ่านทั้งหมด
--   - ครูแก้ได้เฉพาะ offering ตัวเอง
--   - นักเรียนอ่านเฉพาะของตัวเองและ finalized แล้ว
CREATE POLICY "grades_staff_read" ON grades FOR SELECT USING (is_staff());

CREATE POLICY "grades_student_read_finalized" ON grades
    FOR SELECT
    USING (
        student_id = current_student_id()
        AND finalized_at IS NOT NULL
    );

CREATE POLICY "grades_teacher_write_own" ON grades
    FOR ALL
    USING (is_teacher() AND teacher_teaches_offering(offering_id))
    WITH CHECK (is_teacher() AND teacher_teaches_offering(offering_id));

CREATE POLICY "grades_admin_all" ON grades
    FOR ALL USING (is_admin()) WITH CHECK (is_admin());


-- ATTENDANCE:
--   - staff อ่านทั้งหมด
--   - ครูประจำชั้นแก้ได้เฉพาะห้องตัวเอง
--   - นักเรียนอ่านเฉพาะของตัวเอง
CREATE POLICY "attendance_staff_read" ON attendance FOR SELECT USING (is_staff());

CREATE POLICY "attendance_student_read_own" ON attendance
    FOR SELECT USING (student_id = current_student_id());

CREATE POLICY "attendance_homeroom_write" ON attendance
    FOR ALL
    USING (is_teacher() AND teacher_is_homeroom_of(classroom_id))
    WITH CHECK (is_teacher() AND teacher_is_homeroom_of(classroom_id));

CREATE POLICY "attendance_admin_all" ON attendance
    FOR ALL USING (is_admin()) WITH CHECK (is_admin());


-- WORKDAYS:
--   - staff อ่าน
--   - ครูประจำชั้นแก้ได้เฉพาะห้องตัวเอง
CREATE POLICY "workdays_staff_read" ON workdays FOR SELECT USING (is_staff());

CREATE POLICY "workdays_homeroom_write" ON workdays
    FOR ALL
    USING (is_teacher() AND teacher_is_homeroom_of(classroom_id))
    WITH CHECK (is_teacher() AND teacher_is_homeroom_of(classroom_id));

CREATE POLICY "workdays_admin_all" ON workdays
    FOR ALL USING (is_admin()) WITH CHECK (is_admin());


-- SUBJECT_ATTENDANCE: (เวลาเรียนรายวิชา — ปพ.5 มัธยม)
--   - staff อ่านทั้งหมด
--   - ครูที่สอนวิชานั้นเขียนได้ (teacher_teaches_offering)
--   - admin เต็ม
-- NOTE: 20260517d ใส่ไว้แค่ admin_all — teacher policies เพิ่มใน 20260518b.
CREATE POLICY "subject_attendance_staff_read" ON subject_attendance
    FOR SELECT USING (is_staff());

CREATE POLICY "subject_attendance_teacher_write" ON subject_attendance
    FOR ALL
    USING (is_teacher() AND teacher_teaches_offering(offering_id))
    WITH CHECK (is_teacher() AND teacher_teaches_offering(offering_id));

CREATE POLICY "subject_attendance_admin_all" ON subject_attendance
    FOR ALL USING (is_admin()) WITH CHECK (is_admin());


-- SUBJECT_SCHEDULE: staff อ่าน · ครูผู้สอนแก้ตารางของวิชาตัวเอง · admin เต็ม
CREATE POLICY "subject_schedule_slots_staff_read" ON subject_schedule_slots
    FOR SELECT USING (is_staff());

CREATE POLICY "subject_schedule_slots_teacher_write" ON subject_schedule_slots
    FOR ALL
    USING (is_teacher() AND teacher_teaches_offering(offering_id))
    WITH CHECK (is_teacher() AND teacher_teaches_offering(offering_id));

CREATE POLICY "subject_schedule_slots_admin_all" ON subject_schedule_slots
    FOR ALL USING (is_admin()) WITH CHECK (is_admin());

CREATE POLICY "subject_schedule_overrides_staff_read" ON subject_schedule_overrides
    FOR SELECT USING (is_staff());

CREATE POLICY "subject_schedule_overrides_teacher_write" ON subject_schedule_overrides
    FOR ALL
    USING (is_teacher() AND teacher_teaches_offering(offering_id))
    WITH CHECK (is_teacher() AND teacher_teaches_offering(offering_id));

CREATE POLICY "subject_schedule_overrides_admin_all" ON subject_schedule_overrides
    FOR ALL USING (is_admin()) WITH CHECK (is_admin());


-- =====================================================================
-- MODULE 6: CURRICULUM EVALUATION
-- =====================================================================

-- CHARACTERISTICS: master data · ทุกคนอ่าน · admin แก้
CREATE POLICY "characteristics_read_all" ON characteristics FOR SELECT USING (TRUE);
CREATE POLICY "characteristics_admin_write" ON characteristics
    FOR ALL USING (is_admin()) WITH CHECK (is_admin());


-- CHARACTERISTIC_EVALUATIONS:
--   - staff อ่านทั้งหมด
--   - ครูประจำชั้นแก้ได้เฉพาะนักเรียนในห้องตัวเอง
--   - นักเรียนอ่านเฉพาะของตัวเอง
-- หมายเหตุ: ใช้ student → enrollment → classroom เพื่อเช็คว่านักเรียนอยู่ห้องไหน
CREATE POLICY "char_eval_staff_read" ON characteristic_evaluations
    FOR SELECT USING (is_staff());

CREATE POLICY "char_eval_student_read_own" ON characteristic_evaluations
    FOR SELECT USING (student_id = current_student_id());

CREATE POLICY "char_eval_homeroom_write" ON characteristic_evaluations
    FOR ALL
    USING (
        is_teacher() AND
        EXISTS (
            SELECT 1 FROM enrollments e
            JOIN classrooms c ON c.id = e.classroom_id
            WHERE e.student_id = characteristic_evaluations.student_id
            AND c.academic_year_id = characteristic_evaluations.academic_year_id
            AND teacher_is_homeroom_of(c.id)
        )
    )
    WITH CHECK (
        is_teacher() AND
        EXISTS (
            SELECT 1 FROM enrollments e
            JOIN classrooms c ON c.id = e.classroom_id
            WHERE e.student_id = characteristic_evaluations.student_id
            AND c.academic_year_id = characteristic_evaluations.academic_year_id
            AND teacher_is_homeroom_of(c.id)
        )
    );

CREATE POLICY "char_eval_admin_all" ON characteristic_evaluations
    FOR ALL USING (is_admin()) WITH CHECK (is_admin());


-- READING_THINKING_EVALUATIONS: เหมือน characteristic_evaluations
CREATE POLICY "rt_eval_staff_read" ON reading_thinking_evaluations
    FOR SELECT USING (is_staff());

CREATE POLICY "rt_eval_student_read_own" ON reading_thinking_evaluations
    FOR SELECT USING (student_id = current_student_id());

CREATE POLICY "rt_eval_homeroom_write" ON reading_thinking_evaluations
    FOR ALL
    USING (
        is_teacher() AND
        EXISTS (
            SELECT 1 FROM enrollments e
            JOIN classrooms c ON c.id = e.classroom_id
            WHERE e.student_id = reading_thinking_evaluations.student_id
            AND c.academic_year_id = reading_thinking_evaluations.academic_year_id
            AND teacher_is_homeroom_of(c.id)
        )
    )
    WITH CHECK (
        is_teacher() AND
        EXISTS (
            SELECT 1 FROM enrollments e
            JOIN classrooms c ON c.id = e.classroom_id
            WHERE e.student_id = reading_thinking_evaluations.student_id
            AND c.academic_year_id = reading_thinking_evaluations.academic_year_id
            AND teacher_is_homeroom_of(c.id)
        )
    );

CREATE POLICY "rt_eval_admin_all" ON reading_thinking_evaluations
    FOR ALL USING (is_admin()) WITH CHECK (is_admin());


-- COMPETENCY_EVALUATIONS: เหมือน characteristic_evaluations
CREATE POLICY "comp_eval_staff_read" ON competency_evaluations
    FOR SELECT USING (is_staff());

CREATE POLICY "comp_eval_student_read_own" ON competency_evaluations
    FOR SELECT USING (student_id = current_student_id());

CREATE POLICY "comp_eval_homeroom_write" ON competency_evaluations
    FOR ALL
    USING (
        is_teacher() AND
        EXISTS (
            SELECT 1 FROM enrollments e
            JOIN classrooms c ON c.id = e.classroom_id
            WHERE e.student_id = competency_evaluations.student_id
            AND c.academic_year_id = competency_evaluations.academic_year_id
            AND teacher_is_homeroom_of(c.id)
        )
    )
    WITH CHECK (
        is_teacher() AND
        EXISTS (
            SELECT 1 FROM enrollments e
            JOIN classrooms c ON c.id = e.classroom_id
            WHERE e.student_id = competency_evaluations.student_id
            AND c.academic_year_id = competency_evaluations.academic_year_id
            AND teacher_is_homeroom_of(c.id)
        )
    );

CREATE POLICY "comp_eval_admin_all" ON competency_evaluations
    FOR ALL USING (is_admin()) WITH CHECK (is_admin());


-- =====================================================================
-- MODULE 7: SYSTEM SETTINGS
-- =====================================================================

-- HOLIDAYS: ทุกคนอ่าน · admin แก้
CREATE POLICY "holidays_read_all" ON holidays FOR SELECT USING (TRUE);
CREATE POLICY "holidays_admin_write" ON holidays
    FOR ALL USING (is_admin()) WITH CHECK (is_admin());


-- GRADE_SCALES: ทุกคนอ่าน · admin แก้
CREATE POLICY "scales_read_all" ON grade_scales FOR SELECT USING (TRUE);
CREATE POLICY "scales_admin_write" ON grade_scales
    FOR ALL USING (is_admin()) WITH CHECK (is_admin());


-- ANNOUNCEMENTS: ทุกคนอ่าน · ครูประจำชั้นโพสต์ของห้องตัวเอง · admin แก้ทั้งหมด
CREATE POLICY "announcements_read_all" ON announcements
    FOR SELECT USING (TRUE);

CREATE POLICY "announcements_homeroom_write" ON announcements
    FOR ALL
    USING (
        is_teacher() AND
        classroom_id IS NOT NULL AND
        teacher_is_homeroom_of(classroom_id)
    )
    WITH CHECK (
        is_teacher() AND
        classroom_id IS NOT NULL AND
        teacher_is_homeroom_of(classroom_id)
    );

CREATE POLICY "announcements_admin_all" ON announcements
    FOR ALL USING (is_admin()) WITH CHECK (is_admin());


-- =====================================================================
-- GRANT EXECUTE ON HELPER FUNCTIONS
-- =====================================================================
-- ให้ทุก authenticated user เรียก helper functions ได้

GRANT EXECUTE ON FUNCTION is_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION is_teacher() TO authenticated;
GRANT EXECUTE ON FUNCTION is_staff() TO authenticated;
GRANT EXECUTE ON FUNCTION current_teacher_id() TO authenticated;
GRANT EXECUTE ON FUNCTION current_student_id() TO authenticated;
GRANT EXECUTE ON FUNCTION teacher_teaches_offering(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION teacher_is_homeroom_of(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION teacher_involved_with_classroom(UUID) TO authenticated;


-- =====================================================================
-- END OF RLS POLICIES
-- =====================================================================
-- TESTING:
--   1. สร้าง test users (admin, teacher, student) ใน Supabase Auth
--   2. INSERT records ใน users, teachers, students (link auth_user_id)
--   3. Login เป็น user แต่ละบทบาท แล้ว query เทียบกัน
--
-- IMPORTANT NOTES:
--   1. helper functions ใช้ SECURITY DEFINER → ทำงานด้วย privilege ของผู้สร้าง
--      ระวังอย่าให้ user แก้ users.role เป็น 'admin' เองได้
--      (มี policy users_self_update บล็อกการเปลี่ยน role แล้ว)
--   2. grades.finalized_at = NULL → นักเรียนไม่เห็น (ตามที่ user ตกลง)
--      ครู finalize เกรด → set finalized_at = NOW() → นักเรียนเห็น
--   3. ถ้าเพิ่มตารางใหม่ → อย่าลืม ENABLE RLS + เขียน policies
-- =====================================================================
