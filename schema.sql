-- =====================================================================
-- ระบบ ปพ.5 (PP.5 School Grading System)
-- Database Schema for PostgreSQL / Supabase
-- =====================================================================
-- รองรับ: ระบบประถม (ป.1-ป.6) + ระบบมัธยม (ม.1-ม.6) แยกกัน
-- Architecture: 2 เว็บ (parent.school.com + admin.school.com) + DB เดียว
-- Auth: Username/Password (Supabase Auth)
-- RLS: ยังไม่ใส่ในไฟล์นี้ (จะเพิ่มก่อน production)
--
-- โครงสร้าง 7 โมดูล:
--   1. Core / Auth                  (โรงเรียน, users, parents)
--   2. Academic Structure           (ปีการศึกษา, ระดับชั้น, ห้อง)
--   3. People                       (ครู, นักเรียน, เชื่อมผู้ปกครอง)
--   4. Curriculum                   (วิชา, แผนการเรียน, การเปิดวิชา)
--   5. Assessment                   (โครงสร้างคะแนน, คะแนน, เวลาเรียน)
--   6. Curriculum Evaluation        (คุณลักษณะ/อ่านคิดเขียน/สมรรถนะ)
--   7. System Settings              (วันหยุด, เกณฑ์เกรด, ครูประจำชั้น)
-- =====================================================================


-- =====================================================================
-- EXTENSIONS
-- =====================================================================

-- UUID generation
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";


-- =====================================================================
-- ENUM TYPES
-- =====================================================================

-- ระบบการศึกษา
CREATE TYPE school_system AS ENUM ('primary', 'secondary');

-- บทบาทของ user (สำหรับ Admin + ครู — ผู้ปกครองอยู่อีก table)
CREATE TYPE user_role AS ENUM ('admin', 'teacher');

-- ประเภทวิชา
CREATE TYPE subject_category AS ENUM ('core', 'additional', 'activity');

-- โหมดการประเมิน
CREATE TYPE grading_mode AS ENUM ('numeric', 'pass_fail');

-- ช่วงการตัดเกรด (ประถม=รายปี, มัธยม=รายภาค)
CREATE TYPE grading_period AS ENUM ('semester', 'annual');

-- ผลการเรียน
CREATE TYPE pass_fail_result AS ENUM ('pass', 'fail');

-- สถานะห้องเรียน
CREATE TYPE classroom_status AS ENUM ('open', 'closed');

-- สถานะการมาเรียน
CREATE TYPE attendance_status AS ENUM ('present', 'absent', 'leave', 'sick');

-- ประเภทวันหยุด
CREATE TYPE holiday_type AS ENUM ('government', 'school');

-- บทบาทผู้ปกครอง
CREATE TYPE parent_relationship AS ENUM ('father', 'mother', 'guardian');

-- บทบาทครูประจำชั้น
CREATE TYPE homeroom_role AS ENUM ('primary', 'secondary');

-- เพศ
CREATE TYPE gender AS ENUM ('male', 'female');


-- =====================================================================
-- MODULE 1: CORE / AUTH
-- =====================================================================
-- ข้อมูลโรงเรียน + ผู้ใช้งาน (Admin/ครู + ผู้ปกครอง)
-- =====================================================================

-- ตารางโรงเรียน (ตอนนี้มีแค่ 1 record - ระบบ single tenant)
CREATE TABLE schools (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name_th         VARCHAR(255) NOT NULL,
    name_en         VARCHAR(255),
    affiliation     VARCHAR(255),                       -- สังกัด เช่น "สพป. เขต 1"
    address         TEXT,
    district        VARCHAR(100),                       -- อำเภอ · ใช้ในหน้าปก ปพ.5
    province        VARCHAR(100),                       -- จังหวัด · ใช้ในหน้าปก ปพ.5
    phone           VARCHAR(20),
    logo_url        TEXT,
    director_name             VARCHAR(255),                       -- ชื่อ ผอ. (ใช้ใน ปพ.5)
    director_title            VARCHAR(100) DEFAULT 'ผู้อำนวยการ',
    deputy_director_name      VARCHAR(255),                       -- ชื่อ รอง ผอ. (ถ้ามี)
    academic_head_name        VARCHAR(255),                       -- ชื่อหัวหน้าฝ่ายวิชาการ (ใช้ใน ปพ.5 รวมห้อง)
    assessment_officer_name   VARCHAR(255),                       -- ชื่อหัวหน้างานวัดผล (ใช้ใน ปพ.5)
    license_key     TEXT,                                       -- JWT license key (กรอกผ่านหน้า /license)
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE schools IS 'ข้อมูลโรงเรียน (single tenant - มี 1 record)';


-- ผู้ใช้ระบบหลังบ้าน (Admin + ครู)
-- Note: Supabase Auth จัดการ password เอง - ตารางนี้เก็บ profile data
CREATE TABLE users (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    auth_user_id    UUID UNIQUE,                        -- link ไป auth.users ของ Supabase
    username        VARCHAR(50) UNIQUE NOT NULL,
    full_name       VARCHAR(255) NOT NULL,
    title           VARCHAR(50),                        -- คำนำหน้า (นาย, นาง, นางสาว, ดร.)
    email           VARCHAR(255),
    phone           VARCHAR(20),
    role            user_role NOT NULL,                 -- 'admin' หรือ 'teacher'
    is_active       BOOLEAN DEFAULT TRUE,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_users_username ON users(username);
CREATE INDEX idx_users_role ON users(role);

COMMENT ON TABLE users IS 'ผู้ใช้หลังบ้าน (Admin + ครู)';
COMMENT ON COLUMN users.auth_user_id IS 'link ไปยัง Supabase auth.users';


-- ผู้ปกครอง (เก็บ contact info เท่านั้น - ไม่มี login)
-- Note: ผู้ปกครอง login ผ่าน account ของนักเรียน (1 student = 1 account)
CREATE TABLE parents (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    full_name       VARCHAR(255) NOT NULL,
    title           VARCHAR(50),
    phone           VARCHAR(20),
    email           VARCHAR(255),
    line_id         VARCHAR(100),
    is_active       BOOLEAN DEFAULT TRUE,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE parents IS 'ข้อมูลผู้ปกครอง (contact info) · ไม่ใช่ account · login ผ่าน students';


-- =====================================================================
-- MODULE 2: ACADEMIC STRUCTURE
-- =====================================================================
-- ปีการศึกษา · ระดับชั้น (master) · ห้องเรียน
-- =====================================================================

-- ปีการศึกษา (เช่น 2568, 2569)
CREATE TABLE academic_years (
    id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    year_be           INTEGER NOT NULL UNIQUE,          -- ปี พ.ศ. เช่น 2568
    is_current        BOOLEAN DEFAULT FALSE,            -- ปีปัจจุบัน (true ได้แค่ 1 record)
    -- Phase 2.6: ภาคเรียนที่กำลังทำงาน (1 หรือ 2) · default = 1
    -- admin เปลี่ยนเพื่อ lock/unlock ภาคเรียน:
    --   past (sem < current_semester) → readonly
    --   current                          → editable
    --   future (sem > current_semester)  → disabled
    current_semester  SMALLINT NOT NULL DEFAULT 1
                      CHECK (current_semester IN (1, 2)),
    start_date        DATE,                             -- วันเปิดเทอม
    end_date          DATE,                             -- วันปิดเทอม
    created_at        TIMESTAMPTZ DEFAULT NOW(),
    updated_at        TIMESTAMPTZ DEFAULT NOW()
);

-- ensure only one current year
CREATE UNIQUE INDEX idx_academic_years_one_current
    ON academic_years(is_current)
    WHERE is_current = TRUE;

COMMENT ON TABLE academic_years IS 'ปีการศึกษา - มี is_current ได้ 1 record';
COMMENT ON COLUMN academic_years.current_semester IS
    'ภาคเรียนที่กำลังทำงาน (1 หรือ 2). admin เปลี่ยนเพื่อ lock/unlock ภาคเรียน';


-- ระดับชั้น (master table - แชร์ทั้งระบบ)
CREATE TABLE grade_levels (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    code            VARCHAR(10) UNIQUE NOT NULL,        -- 'p1', 'p2', ..., 'm6'
    name_th         VARCHAR(50) NOT NULL,               -- "ประถมศึกษาปีที่ 1"
    name_short      VARCHAR(10) NOT NULL,               -- "ป.1"
    system          school_system NOT NULL,             -- 'primary' / 'secondary'
    sort_order      INTEGER NOT NULL,                   -- ลำดับ (1-12)
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_grade_levels_system ON grade_levels(system);

COMMENT ON TABLE grade_levels IS 'ระดับชั้น ป.1-ป.6, ม.1-ม.6 (master data)';

-- Seed ระดับชั้นทั้งหมด
INSERT INTO grade_levels (code, name_th, name_short, system, sort_order) VALUES
    ('p1', 'ประถมศึกษาปีที่ 1', 'ป.1', 'primary', 1),
    ('p2', 'ประถมศึกษาปีที่ 2', 'ป.2', 'primary', 2),
    ('p3', 'ประถมศึกษาปีที่ 3', 'ป.3', 'primary', 3),
    ('p4', 'ประถมศึกษาปีที่ 4', 'ป.4', 'primary', 4),
    ('p5', 'ประถมศึกษาปีที่ 5', 'ป.5', 'primary', 5),
    ('p6', 'ประถมศึกษาปีที่ 6', 'ป.6', 'primary', 6),
    ('m1', 'มัธยมศึกษาปีที่ 1', 'ม.1', 'secondary', 7),
    ('m2', 'มัธยมศึกษาปีที่ 2', 'ม.2', 'secondary', 8),
    ('m3', 'มัธยมศึกษาปีที่ 3', 'ม.3', 'secondary', 9),
    ('m4', 'มัธยมศึกษาปีที่ 4', 'ม.4', 'secondary', 10),
    ('m5', 'มัธยมศึกษาปีที่ 5', 'ม.5', 'secondary', 11),
    ('m6', 'มัธยมศึกษาปีที่ 6', 'ม.6', 'secondary', 12);


-- ห้องเรียน (1 record = 1 ห้อง ต่อปีการศึกษา)
CREATE TABLE classrooms (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    academic_year_id    UUID NOT NULL REFERENCES academic_years(id) ON DELETE RESTRICT,
    grade_level_id      UUID NOT NULL REFERENCES grade_levels(id) ON DELETE RESTRICT,
    room_number         INTEGER NOT NULL,               -- 1, 2, 3
    study_plan_id       UUID,                           -- FK ใส่ทีหลังเมื่อสร้างตาราง study_plans
    number_mode         TEXT DEFAULT 'code',            -- เรียงเลขที่: code | male_first | female_first
    status              classroom_status DEFAULT 'open',
    created_at          TIMESTAMPTZ DEFAULT NOW(),
    updated_at          TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(academic_year_id, grade_level_id, room_number)
);

CREATE INDEX idx_classrooms_year ON classrooms(academic_year_id);
CREATE INDEX idx_classrooms_grade ON classrooms(grade_level_id);

COMMENT ON TABLE classrooms IS 'ห้องเรียน · ใช้ smart naming: 1 ห้อง = "ป.3" / หลายห้อง = "ป.3/1"';
COMMENT ON COLUMN classrooms.room_number IS 'หมายเลขห้อง 1, 2, 3 - แสดง /1 /2 เมื่อมีหลายห้อง';
COMMENT ON COLUMN classrooms.number_mode IS 'การเรียงเลขที่นักเรียน: code=ตามรหัส, male_first=ชาย-หญิง, female_first=หญิง-ชาย';


-- =====================================================================
-- MODULE 3: PEOPLE
-- =====================================================================
-- ครู · นักเรียน · เชื่อมโยงผู้ปกครอง-นักเรียน
-- =====================================================================

-- ครู (extended จาก users — สำหรับ user_role='teacher' เท่านั้น)
CREATE TABLE teachers (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id             UUID UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    teacher_code        VARCHAR(20) UNIQUE,             -- รหัสครู (อาจไม่มี)
    position            VARCHAR(100),                   -- ตำแหน่ง เช่น "ครู คศ.2"
    subject_specialty   VARCHAR(255),                   -- ความถนัด เช่น "คณิตศาสตร์, วิทยาศาสตร์"
    department          VARCHAR(100),                   -- กลุ่มสาระ เช่น "คณิตศาสตร์"
    is_department_head  BOOLEAN DEFAULT FALSE,          -- หัวหน้ากลุ่มสาระ
    is_academic_head    BOOLEAN DEFAULT FALSE,          -- ครูวิชาการ (ลงนาม ปพ.5 รวมห้อง)
    created_at          TIMESTAMPTZ DEFAULT NOW(),
    updated_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_teachers_user ON teachers(user_id);
CREATE INDEX idx_teachers_department ON teachers(department);

COMMENT ON TABLE teachers IS 'ข้อมูลครู - extend จาก users สำหรับ role=teacher';


-- นักเรียน
CREATE TABLE students (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    student_code        VARCHAR(20) UNIQUE NOT NULL,    -- เลขประจำตัวนักเรียน (ใช้ login)
    national_id         VARCHAR(13) UNIQUE,             -- เลขบัตรประชาชน 13 หลัก
    title               VARCHAR(50),                    -- เด็กชาย/เด็กหญิง/นาย/นางสาว
    first_name          VARCHAR(100) NOT NULL,
    last_name           VARCHAR(100) NOT NULL,
    gender              gender,
    birth_date          DATE,
    auth_user_id        UUID UNIQUE,                    -- link ไป auth.users (1 student = 1 login account)
    -- หมายเหตุ: account นี้ใช้สำหรับ portal ผู้ปกครอง · ครอบครัวแชร์ password กัน

    created_at          TIMESTAMPTZ DEFAULT NOW(),
    updated_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_students_code ON students(student_code);
CREATE INDEX idx_students_name ON students(first_name, last_name);

COMMENT ON TABLE students IS 'ข้อมูลนักเรียน · เน้นข้อมูลที่ใช้ใน ปพ.5 · ระบบทะเบียนแยกต่างหาก';
COMMENT ON COLUMN students.student_code IS 'เลขประจำตัวนักเรียน - ใช้เป็น username สำหรับ portal ผู้ปกครอง';
COMMENT ON COLUMN students.auth_user_id IS 'link ไปยัง Supabase auth.users · 1 student = 1 account';


-- การลงทะเบียนนักเรียนเข้าห้อง
--
-- semester: 0 = ทั้งปี (ประถม · default · backward-compat)
--           1/2 = เฉพาะภาคเรียน (มัธยม — ตัดเกรดรายภาค)
-- มัธยม: ปกติจะมี 2 row ต่อ (นักเรียน, ห้อง) — 1 ต่อภาคเรียน
-- หมายเหตุ: ระบบนี้เน้นที่ ปพ.5 - ไม่ track ประวัติย้ายเข้า-ออก
CREATE TABLE enrollments (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    student_id          UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    classroom_id        UUID NOT NULL REFERENCES classrooms(id) ON DELETE CASCADE,
    student_number      INTEGER NOT NULL,               -- เลขที่ในห้อง 1, 2, 3, ...
    semester            SMALLINT NOT NULL DEFAULT 0
                        CHECK (semester IN (0, 1, 2)),
    created_at          TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(student_id, classroom_id, semester),         -- 1 นักเรียน × 1 ห้อง × 1 ภาคเรียน = 1 record
    UNIQUE(classroom_id, semester, student_number)      -- เลขที่ไม่ซ้ำใน (ห้อง, ภาคเรียน)
);

CREATE INDEX idx_enrollments_student ON enrollments(student_id);
CREATE INDEX idx_enrollments_classroom ON enrollments(classroom_id);

COMMENT ON TABLE enrollments IS 'นักเรียนในห้อง · เพิ่ม/ลบได้ตลอด · ระบบทะเบียนแยกจัดการประวัติ';


-- เชื่อมผู้ปกครองกับนักเรียน (1 parent → N students, 1 student → N parents)
CREATE TABLE parent_student_links (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    parent_id           UUID NOT NULL REFERENCES parents(id) ON DELETE CASCADE,
    student_id          UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    relationship        parent_relationship,
    is_primary          BOOLEAN DEFAULT FALSE,          -- ผู้ปกครองหลัก (สำหรับติดต่อ)
    created_at          TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(parent_id, student_id)
);

CREATE INDEX idx_parent_links_parent ON parent_student_links(parent_id);
CREATE INDEX idx_parent_links_student ON parent_student_links(student_id);

COMMENT ON TABLE parent_student_links IS 'ความสัมพันธ์ผู้ปกครอง-นักเรียน · 1 ผู้ปกครองอาจดูแลลูกหลายคน';


-- ครูประจำชั้น (1-2 คน/ห้อง)
CREATE TABLE homeroom_assignments (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    classroom_id        UUID NOT NULL REFERENCES classrooms(id) ON DELETE CASCADE,
    teacher_id          UUID NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
    role                homeroom_role NOT NULL DEFAULT 'primary',   -- หลัก/รอง
    assigned_at         TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(classroom_id, role),                         -- 1 ห้อง มีหลัก 1 + รอง 1
    UNIQUE(classroom_id, teacher_id)                    -- 1 ครู ไม่ซ้ำในห้องเดียวกัน
);

CREATE INDEX idx_homeroom_classroom ON homeroom_assignments(classroom_id);
CREATE INDEX idx_homeroom_teacher ON homeroom_assignments(teacher_id);

COMMENT ON TABLE homeroom_assignments IS 'ครูประจำชั้น 1-2 คน/ห้อง (หลัก + รอง)';


-- =====================================================================
-- MODULE 4: CURRICULUM
-- =====================================================================
-- วิชา · แผนการเรียน · การเปิดวิชา (subject_offerings)
-- =====================================================================

-- กลุ่มสาระการเรียนรู้ (8 กลุ่มตามหลักสูตรแกนกลาง 2551)
CREATE TABLE learning_areas (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    code            VARCHAR(10) UNIQUE NOT NULL,        -- 'thai', 'math', 'science', ...
    name_th         VARCHAR(100) NOT NULL,              -- "ภาษาไทย"
    sort_order      INTEGER NOT NULL
);

INSERT INTO learning_areas (code, name_th, sort_order) VALUES
    ('thai',          'ภาษาไทย',                    1),
    ('math',          'คณิตศาสตร์',                 2),
    ('science',       'วิทยาศาสตร์และเทคโนโลยี',     3),
    ('social',        'สังคมศึกษา ศาสนา และวัฒนธรรม', 4),
    ('health',        'สุขศึกษาและพลศึกษา',          5),
    ('arts',          'ศิลปะ',                      6),
    ('career',        'การงานอาชีพ',                 7),
    ('foreign',       'ภาษาต่างประเทศ',              8),
    ('activity',      'กิจกรรมพัฒนาผู้เรียน',         9);


-- วิชา (master table - ใช้ร่วมระหว่างปีการศึกษา)
CREATE TABLE subjects (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    code                VARCHAR(20) NOT NULL,           -- ค13101, ก13901 — unique within (year, semester)
    name_th             VARCHAR(255) NOT NULL,          -- "คณิตศาสตร์"
    learning_area_id    UUID REFERENCES learning_areas(id),
    grade_level_id      UUID NOT NULL REFERENCES grade_levels(id),

    -- Scope: ประถม = ต่อปี (semester=0) · มัธยม = ต่อ (ปี, ภาคเรียน)
    academic_year_id    UUID NOT NULL REFERENCES academic_years(id),
    semester            SMALLINT NOT NULL DEFAULT 0
                        CHECK (semester IN (0, 1, 2)),

    category            subject_category NOT NULL,      -- core / additional / activity
    grading_mode        grading_mode NOT NULL,          -- numeric / pass_fail

    credit_hours        DECIMAL(3,1),                   -- หน่วยกิต (core/additional เท่านั้น)
    hours_per_week      INTEGER,                        -- ชั่วโมง/สัปดาห์ (legacy · ไม่ใช้ใน UI แล้ว)
    hours_per_year      INTEGER,                        -- ชั่วโมง/ปี (activity เท่านั้น)

    is_active           BOOLEAN DEFAULT TRUE,
    created_at          TIMESTAMPTZ DEFAULT NOW(),
    updated_at          TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE (code, academic_year_id, semester),

    -- ถ้าเป็นกิจกรรม → credit_hours = null และ grading_mode = pass_fail
    CHECK (
        (category = 'activity' AND grading_mode = 'pass_fail')
        OR
        (category IN ('core', 'additional') AND grading_mode = 'numeric')
    )
);

CREATE INDEX idx_subjects_code ON subjects(code);
CREATE INDEX idx_subjects_grade ON subjects(grade_level_id);
CREATE INDEX idx_subjects_category ON subjects(category);

COMMENT ON TABLE subjects IS 'รายวิชาในหลักสูตร · 3 ประเภท: core/additional/activity';


-- แผนการเรียน (study plan) — โรงเรียนอาจมีหลายแผน เช่น "ทั่วไป", "EP", "วิทย์-คณิต"
CREATE TABLE study_plans (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    grade_level_id      UUID NOT NULL REFERENCES grade_levels(id),
    name                VARCHAR(100) NOT NULL,          -- "ทั่วไป", "EP"
    description         TEXT,
    is_default          BOOLEAN DEFAULT FALSE,          -- แผน default ของระดับชั้นนั้น
    created_at          TIMESTAMPTZ DEFAULT NOW(),
    updated_at          TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(grade_level_id, name)
);

-- ห้องใดเป็นแผน default ของระดับชั้น (มีได้ 1 ต่อระดับชั้น)
CREATE UNIQUE INDEX idx_study_plans_one_default_per_grade
    ON study_plans(grade_level_id)
    WHERE is_default = TRUE;

CREATE INDEX idx_study_plans_grade ON study_plans(grade_level_id);

COMMENT ON TABLE study_plans IS 'แผนการเรียน · ระดับชั้นเดียวกันมีหลายแผนได้';


-- เพิ่ม FK ของ classrooms.study_plan_id (ตอนนี้สร้าง study_plans แล้ว)
-- SET NULL: ลบ study_plan → ห้องยังอยู่ แค่ไม่มี plan
ALTER TABLE classrooms
    ADD CONSTRAINT fk_classrooms_study_plan
    FOREIGN KEY (study_plan_id) REFERENCES study_plans(id) ON DELETE SET NULL;


-- รายวิชาในแต่ละแผนการเรียน (วิชาไหนสอนในแผนไหน)
CREATE TABLE study_plan_subjects (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    study_plan_id       UUID NOT NULL REFERENCES study_plans(id) ON DELETE CASCADE,
    subject_id          UUID NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
    sort_order          INTEGER,

    UNIQUE(study_plan_id, subject_id)
);

CREATE INDEX idx_sps_plan ON study_plan_subjects(study_plan_id);
CREATE INDEX idx_sps_subject ON study_plan_subjects(subject_id);

COMMENT ON TABLE study_plan_subjects IS 'วิชาในแผนการเรียน (M:M)';


-- การเปิดวิชาในแต่ละห้อง/ภาค (subject_offering)
-- 1 record = วิชา 1 วิชา × ห้อง 1 ห้อง × ภาค 1 ภาค × ครูผู้สอน
CREATE TABLE subject_offerings (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    classroom_id        UUID NOT NULL REFERENCES classrooms(id) ON DELETE CASCADE,
    subject_id          UUID NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
    -- NULL allowed: admin บันทึกคะแนน/เวลาเรียนได้ก่อนจัดครู ·
    -- teaching page UPDATE teacher_id ทีหลังเมื่อจัด
    teacher_id          UUID REFERENCES teachers(id) ON DELETE CASCADE,
    semester            INTEGER NOT NULL CHECK (semester IN (1, 2)),
    created_at          TIMESTAMPTZ DEFAULT NOW(),
    updated_at          TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(classroom_id, subject_id, semester)          -- 1 วิชา × 1 ห้อง × 1 ภาค = 1 record
);

CREATE INDEX idx_offerings_classroom ON subject_offerings(classroom_id);
CREATE INDEX idx_offerings_subject ON subject_offerings(subject_id);
CREATE INDEX idx_offerings_teacher ON subject_offerings(teacher_id);
CREATE INDEX idx_offerings_semester ON subject_offerings(semester);

COMMENT ON TABLE subject_offerings IS 'การเปิดวิชาในห้อง × ภาค × ครู (เป็น key ของระบบคะแนน)';


-- =====================================================================
-- MODULE 5: ASSESSMENT
-- =====================================================================
-- โครงสร้างคะแนน · คะแนน · เวลาเรียน
-- =====================================================================

-- หมวดคะแนน (เก็บก่อนกลาง, กลางภาค, เก็บหลังกลาง, ปลายภาค)
-- ผูกกับ subject_offering แต่ละอัน
CREATE TABLE score_categories (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    offering_id         UUID NOT NULL REFERENCES subject_offerings(id) ON DELETE CASCADE,
    name                VARCHAR(100) NOT NULL,          -- "คะแนนเก็บครั้งที่ 1", "ปลายภาค"
    max_score           DECIMAL(5,2) NOT NULL,          -- คะแนนเต็ม
    sort_order          INTEGER NOT NULL,
    is_final            BOOLEAN DEFAULT FALSE,          -- ปลายภาคหรือไม่
    is_midterm          BOOLEAN DEFAULT FALSE,          -- กลางภาคหรือไม่ (มัธยม)
    created_at          TIMESTAMPTZ DEFAULT NOW(),
    updated_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_categories_offering ON score_categories(offering_id);
CREATE INDEX idx_categories_order ON score_categories(offering_id, sort_order);

COMMENT ON TABLE score_categories IS 'หมวดคะแนน · ผูกกับ offering แต่ละอัน · ครูปรับเองได้';


-- คะแนนรายคน (1 row ต่อ นักเรียน × วิชา × หมวดคะแนน)
CREATE TABLE scores (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    student_id          UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    category_id         UUID NOT NULL REFERENCES score_categories(id) ON DELETE CASCADE,
    score               DECIMAL(5,2),                   -- คะแนนที่ได้ (null = ยังไม่กรอก)

    recorded_by         UUID REFERENCES teachers(id),   -- ครูที่กรอก
    recorded_at         TIMESTAMPTZ DEFAULT NOW(),
    updated_at          TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(student_id, category_id)
);

CREATE INDEX idx_scores_student ON scores(student_id);
CREATE INDEX idx_scores_category ON scores(category_id);

COMMENT ON TABLE scores IS 'คะแนนรายคนต่อหมวดคะแนน';


-- ผลการเรียนสรุป (เกรดสุดท้ายของวิชา)
-- ระบบประถม: 1 record/ปี (grading_period='annual')   - รวมภาค 1 + 2
-- ระบบมัธยม: 1 record/ภาค (grading_period='semester') - แยกแต่ละภาค
CREATE TABLE grades (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    student_id          UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    offering_id         UUID NOT NULL REFERENCES subject_offerings(id) ON DELETE CASCADE,

    -- ช่วงการตัดเกรด - แยกประถม/มัธยม
    grading_period      grading_period NOT NULL,        -- 'semester' (มัธยม) / 'annual' (ประถม)

    -- สำหรับวิชา numeric (พื้นฐาน + เพิ่มเติม)
    total_score         DECIMAL(5,2),                   -- คะแนนรวม
    grade               DECIMAL(2,1),                   -- 0, 0.5, 1, 1.5, ..., 4

    -- สำหรับวิชา pass_fail (กิจกรรม)
    pass_fail           pass_fail_result,

    -- กรณีพิเศษ
    is_incomplete       BOOLEAN DEFAULT FALSE,          -- ร (รอประเมิน)
    is_no_eligibility   BOOLEAN DEFAULT FALSE,          -- มส (ไม่มีสิทธิ์สอบ - เวลาเรียน < 80%)
    manual_override     BOOLEAN DEFAULT FALSE,          -- ครูแก้เกรดเอง

    finalized_at        TIMESTAMPTZ,
    updated_at          TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(student_id, offering_id, grading_period),

    -- numeric ต้องมี grade, pass_fail ต้องมี pass_fail
    CHECK (
        (grade IS NOT NULL AND pass_fail IS NULL)
        OR
        (grade IS NULL AND pass_fail IS NOT NULL)
        OR
        (is_incomplete = TRUE OR is_no_eligibility = TRUE)
    ),

    -- เกรดต้องเป็นค่ามาตรฐาน 0, 0.5, 1, ..., 4
    CHECK (grade IS NULL OR grade IN (0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4))
);

CREATE INDEX idx_grades_student ON grades(student_id);
CREATE INDEX idx_grades_offering ON grades(offering_id);
CREATE INDEX idx_grades_period ON grades(grading_period);

COMMENT ON TABLE grades IS 'ผลการเรียนสรุป · มัธยม=รายภาค (semester) / ประถม=รายปี (annual)';
COMMENT ON COLUMN grades.grading_period IS 'semester=มัธยม (1 record/ภาค) / annual=ประถม (1 record/ปี)';


-- การมาเรียน (รายวัน)
-- 1 record = นักเรียน 1 คน × วัน 1 วัน
CREATE TABLE attendance (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    student_id          UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    classroom_id        UUID NOT NULL REFERENCES classrooms(id) ON DELETE CASCADE,
    date                DATE NOT NULL,
    status              attendance_status NOT NULL,     -- present/absent/leave/sick

    recorded_by         UUID REFERENCES teachers(id),
    recorded_at         TIMESTAMPTZ DEFAULT NOW(),
    notes               TEXT,

    UNIQUE(student_id, date)
);

CREATE INDEX idx_attendance_student_date ON attendance(student_id, date);
CREATE INDEX idx_attendance_classroom_date ON attendance(classroom_id, date);
CREATE INDEX idx_attendance_date ON attendance(date);              -- สำหรับ query ทั้งโรงเรียนรายวัน

COMMENT ON TABLE attendance IS 'การมาเรียนรายวัน · ครูประจำชั้นบันทึก';


-- วันทำการ (ครูประจำชั้นเลือกวันไหนเป็นวันทำการ)
-- 1 record = ห้อง 1 ห้อง × วัน 1 วัน
CREATE TABLE workdays (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    classroom_id        UUID NOT NULL REFERENCES classrooms(id) ON DELETE CASCADE,
    date                DATE NOT NULL,
    is_workday          BOOLEAN DEFAULT TRUE,           -- TRUE = เป็นวันทำการ (เปิดให้กรอก)

    created_at          TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(classroom_id, date)
);

CREATE INDEX idx_workdays_classroom_date ON workdays(classroom_id, date);

COMMENT ON TABLE workdays IS 'วันทำการของแต่ละห้อง · ครูประจำชั้นติ๊กเปิด/ปิด · เผื่อเรียนชดเชย';


-- การมาเรียน (รายวิชา · per-subject)
-- 1 record = นักเรียน 1 คน × offering (วิชา×ห้อง×ภาค) × สัปดาห์ × ช่อง
-- ใช้กับมัธยม (มาตรฐาน ปพ.5) — จำนวนช่อง/สัปดาห์ = หน่วยกิต × 2
-- เช่น 0.5 หน่วยกิต → 1 ช่อง/สัปดาห์, 1.0 → 2 ช่อง, 1.5 → 3 ช่อง
-- 20 สัปดาห์/ภาค (อนุญาตถึง 30 เผื่อกรณีพิเศษ)
CREATE TABLE subject_attendance (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    offering_id         UUID NOT NULL REFERENCES subject_offerings(id) ON DELETE CASCADE,
    student_id          UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    week                SMALLINT NOT NULL CHECK (week BETWEEN 1 AND 30),
    slot_in_week        SMALLINT NOT NULL CHECK (slot_in_week BETWEEN 1 AND 10),
    status              attendance_status NOT NULL,   -- UI ใช้ 3 ค่า: present/absent/leave

    recorded_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    recorded_by         UUID REFERENCES teachers(id) ON DELETE SET NULL,

    UNIQUE(offering_id, student_id, week, slot_in_week)
);

CREATE INDEX idx_subject_attendance_offering ON subject_attendance(offering_id);
CREATE INDEX idx_subject_attendance_student ON subject_attendance(student_id);

COMMENT ON TABLE subject_attendance IS 'เวลาเรียนต่อวิชาแบบ ปพ.5 มัธยม · 1 row ต่อ (offering, student, week, slot)';


-- =====================================================================
-- MODULE 6: CURRICULUM EVALUATION
-- =====================================================================
-- คุณลักษณะอันพึงประสงค์ · อ่านคิดเขียน · สมรรถนะสำคัญ
-- =====================================================================

-- หัวข้อคุณลักษณะอันพึงประสงค์ (ตั้งค่าได้ — default 8 ข้อตาม สพฐ.)
CREATE TABLE characteristics (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name            VARCHAR(255) NOT NULL,              -- "รักชาติ ศาสน์ กษัตริย์"
    sort_order      INTEGER NOT NULL,
    source          VARCHAR(20) DEFAULT 'obec',         -- 'obec' (สพฐ.) / 'school' (โรงเรียนเพิ่มเอง)
    is_active       BOOLEAN DEFAULT TRUE,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_characteristics_order ON characteristics(sort_order) WHERE is_active = TRUE;

COMMENT ON TABLE characteristics IS 'หัวข้อคุณลักษณะอันพึงประสงค์ · ค่าเริ่มต้น 8 ข้อ สพฐ.';

-- Seed คุณลักษณะ 8 ข้อตาม สพฐ.
INSERT INTO characteristics (name, sort_order, source) VALUES
    ('รักชาติ ศาสน์ กษัตริย์',         1, 'obec'),
    ('ซื่อสัตย์สุจริต',                 2, 'obec'),
    ('มีวินัย',                         3, 'obec'),
    ('ใฝ่เรียนรู้',                     4, 'obec'),
    ('อยู่อย่างพอเพียง',                5, 'obec'),
    ('มุ่งมั่นในการทำงาน',              6, 'obec'),
    ('รักความเป็นไทย',                  7, 'obec'),
    ('มีจิตสาธารณะ',                    8, 'obec');


-- การประเมินคุณลักษณะรายคน
-- 1 record = นักเรียน 1 คน × หัวข้อคุณลักษณะ 1 ข้อ × ปีการศึกษา
CREATE TABLE characteristic_evaluations (
    id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    student_id              UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    academic_year_id        UUID NOT NULL REFERENCES academic_years(id) ON DELETE CASCADE,
    semester                INTEGER NOT NULL CHECK (semester IN (0, 1, 2)),
    characteristic_id       UUID NOT NULL REFERENCES characteristics(id) ON DELETE CASCADE,
    score                   INTEGER CHECK (score >= 0 AND score <= 3),  -- 0/1/2/3

    evaluated_by            UUID REFERENCES teachers(id),
    evaluated_at            TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(student_id, academic_year_id, semester, characteristic_id)
);

CREATE INDEX idx_char_eval_student ON characteristic_evaluations(student_id);
CREATE INDEX idx_char_eval_year ON characteristic_evaluations(academic_year_id, semester);

COMMENT ON TABLE characteristic_evaluations IS 'การประเมินคุณลักษณะรายข้อ · 0=ไม่ผ่าน, 1=ผ่าน, 2=ดี, 3=ดีเยี่ยม';


-- การประเมินอ่านคิดวิเคราะห์เขียน (3 ด้านตายตัว)
CREATE TABLE reading_thinking_evaluations (
    id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    student_id              UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    academic_year_id        UUID NOT NULL REFERENCES academic_years(id) ON DELETE CASCADE,
    semester                INTEGER NOT NULL CHECK (semester IN (0, 1, 2)),

    reading_score           INTEGER CHECK (reading_score >= 0 AND reading_score <= 3),    -- การอ่าน
    thinking_score          INTEGER CHECK (thinking_score >= 0 AND thinking_score <= 3),  -- คิดวิเคราะห์
    writing_score           INTEGER CHECK (writing_score >= 0 AND writing_score <= 3),    -- การเขียน

    evaluated_by            UUID REFERENCES teachers(id),
    evaluated_at            TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(student_id, academic_year_id, semester)
);

CREATE INDEX idx_rt_eval_student ON reading_thinking_evaluations(student_id);

COMMENT ON TABLE reading_thinking_evaluations IS 'ประเมินอ่าน-คิดวิเคราะห์-เขียน 3 ด้านตายตัว';


-- การประเมินสมรรถนะสำคัญ (5 ด้านตายตัว)
CREATE TABLE competency_evaluations (
    id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    student_id              UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    academic_year_id        UUID NOT NULL REFERENCES academic_years(id) ON DELETE CASCADE,
    semester                INTEGER NOT NULL CHECK (semester IN (0, 1, 2)),

    communication_score     INTEGER CHECK (communication_score >= 0 AND communication_score <= 3),  -- สื่อสาร
    thinking_score          INTEGER CHECK (thinking_score >= 0 AND thinking_score <= 3),            -- คิด
    problem_solving_score   INTEGER CHECK (problem_solving_score >= 0 AND problem_solving_score <= 3), -- แก้ปัญหา
    life_skills_score       INTEGER CHECK (life_skills_score >= 0 AND life_skills_score <= 3),      -- ทักษะชีวิต
    technology_score        INTEGER CHECK (technology_score >= 0 AND technology_score <= 3),        -- เทคโนโลยี

    evaluated_by            UUID REFERENCES teachers(id),
    evaluated_at            TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(student_id, academic_year_id, semester)
);

CREATE INDEX idx_comp_eval_student ON competency_evaluations(student_id);

COMMENT ON TABLE competency_evaluations IS 'ประเมินสมรรถนะสำคัญ 5 ด้านตายตัว';


-- =====================================================================
-- MODULE 7: SYSTEM SETTINGS
-- =====================================================================
-- วันหยุด · เกณฑ์เกรด · ประกาศ
-- =====================================================================

-- วันหยุด (ราชการ + โรงเรียน)
CREATE TABLE holidays (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    date            DATE NOT NULL,
    name            VARCHAR(255) NOT NULL,
    type            holiday_type NOT NULL,              -- government / school
    academic_year_id UUID REFERENCES academic_years(id),

    created_at      TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(date, type)
);

CREATE INDEX idx_holidays_date ON holidays(date);
CREATE INDEX idx_holidays_year ON holidays(academic_year_id);

COMMENT ON TABLE holidays IS 'วันหยุด · ดึงจาก BOT API + admin เพิ่มเอง';


-- เกณฑ์เกรด (คะแนน → เกรด)
CREATE TABLE grade_scales (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    min_score       DECIMAL(5,2) NOT NULL,              -- คะแนนต่ำสุด
    max_score       DECIMAL(5,2) NOT NULL,              -- คะแนนสูงสุด
    grade           DECIMAL(2,1) NOT NULL,              -- เกรดที่ได้

    sort_order      INTEGER NOT NULL,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Seed เกณฑ์เกรดมาตรฐาน
INSERT INTO grade_scales (min_score, max_score, grade, sort_order) VALUES
    (80, 100, 4.0, 1),
    (75, 79,  3.5, 2),
    (70, 74,  3.0, 3),
    (65, 69,  2.5, 4),
    (60, 64,  2.0, 5),
    (55, 59,  1.5, 6),
    (50, 54,  1.0, 7),
    (0,  49,  0.0, 8);

COMMENT ON TABLE grade_scales IS 'เกณฑ์ตัดเกรด · default 8 ระดับมาตรฐาน · ปรับได้';


-- ประกาศจากครูประจำชั้น (Phase 2 - เผื่อไว้)
CREATE TABLE announcements (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    classroom_id    UUID REFERENCES classrooms(id) ON DELETE CASCADE,
    teacher_id      UUID REFERENCES teachers(id),
    title           VARCHAR(255) NOT NULL,
    content         TEXT,
    is_active       BOOLEAN DEFAULT TRUE,
    posted_at       TIMESTAMPTZ DEFAULT NOW(),
    expires_at      TIMESTAMPTZ
);

CREATE INDEX idx_announcements_classroom ON announcements(classroom_id);
CREATE INDEX idx_announcements_active ON announcements(is_active) WHERE is_active = TRUE;

COMMENT ON TABLE announcements IS 'ประกาศจากครูประจำชั้น (Phase 2)';


-- =====================================================================
-- VIEWS & HELPER FUNCTIONS
-- =====================================================================

-- View: ชื่อห้องแบบ smart naming (ป.3 หรือ ป.3/1)
CREATE OR REPLACE VIEW v_classroom_names AS
SELECT
    c.id,
    c.academic_year_id,
    c.grade_level_id,
    c.room_number,
    gl.name_short                                       AS grade_short,
    -- ถ้ามีห้องเดียวในระดับชั้นนั้น = "ป.3", หลายห้อง = "ป.3/1"
    CASE
        WHEN room_count.total = 1 THEN gl.name_short
        ELSE gl.name_short || '/' || c.room_number
    END                                                 AS display_name
FROM classrooms c
JOIN grade_levels gl ON gl.id = c.grade_level_id
JOIN (
    SELECT
        academic_year_id,
        grade_level_id,
        COUNT(*) AS total
    FROM classrooms
    WHERE status = 'open'
    GROUP BY academic_year_id, grade_level_id
) room_count
    ON room_count.academic_year_id = c.academic_year_id
   AND room_count.grade_level_id = c.grade_level_id
WHERE c.status = 'open';

COMMENT ON VIEW v_classroom_names IS 'ชื่อห้องแบบ smart: 1 ห้อง="ป.3", หลายห้อง="ป.3/1"';


-- Function: คำนวณสรุปคุณลักษณะ/อ่านคิดเขียน/สมรรถนะ ตามสูตร สพฐ. 2551
-- Input: array ของ scores (เช่น [3,3,2,3,2,3,3,2]) + threshold (เช่น 5 สำหรับ 8 ข้อ)
-- Output: 0=ไม่ผ่าน, 1=ผ่าน, 2=ดี, 3=ดีเยี่ยม
CREATE OR REPLACE FUNCTION summarize_evaluation(scores INTEGER[], threshold INTEGER)
RETURNS INTEGER AS $$
DECLARE
    count_3 INTEGER;
    count_2 INTEGER;
BEGIN
    -- มี 0 → ไม่ผ่าน
    IF 0 = ANY(scores) THEN
        RETURN 0;
    END IF;

    count_3 := array_length(array_positions(scores, 3), 1);
    count_2 := array_length(array_positions(scores, 2), 1);
    count_3 := COALESCE(count_3, 0);
    count_2 := COALESCE(count_2, 0);

    -- ดีเยี่ยม ≥ threshold → ดีเยี่ยม
    IF count_3 >= threshold THEN
        RETURN 3;
    END IF;

    -- ดีเยี่ยม + ดี ≥ threshold → ดี
    IF (count_3 + count_2) >= threshold THEN
        RETURN 2;
    END IF;

    -- ที่เหลือ → ผ่าน
    RETURN 1;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

COMMENT ON FUNCTION summarize_evaluation IS 'สูตร สพฐ. 2551: คุณลักษณะ 8→threshold=5 / อ่านคิดเขียน 3→threshold=3 / สมรรถนะ 5→threshold=3';


-- =====================================================================
-- TRIGGERS: AUTO-UPDATE updated_at
-- =====================================================================

CREATE OR REPLACE FUNCTION trigger_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply to tables with updated_at column
CREATE TRIGGER set_updated_at_schools BEFORE UPDATE ON schools FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();
CREATE TRIGGER set_updated_at_users BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();
CREATE TRIGGER set_updated_at_parents BEFORE UPDATE ON parents FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();
CREATE TRIGGER set_updated_at_academic_years BEFORE UPDATE ON academic_years FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();
CREATE TRIGGER set_updated_at_classrooms BEFORE UPDATE ON classrooms FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();
CREATE TRIGGER set_updated_at_teachers BEFORE UPDATE ON teachers FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();
CREATE TRIGGER set_updated_at_students BEFORE UPDATE ON students FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();
CREATE TRIGGER set_updated_at_subjects BEFORE UPDATE ON subjects FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();
CREATE TRIGGER set_updated_at_study_plans BEFORE UPDATE ON study_plans FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();
CREATE TRIGGER set_updated_at_offerings BEFORE UPDATE ON subject_offerings FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();
CREATE TRIGGER set_updated_at_categories BEFORE UPDATE ON score_categories FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();
CREATE TRIGGER set_updated_at_scores BEFORE UPDATE ON scores FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();
CREATE TRIGGER set_updated_at_grades BEFORE UPDATE ON grades FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();


-- =====================================================================
-- END OF SCHEMA
-- =====================================================================
-- BUSINESS RULES ที่ application ต้อง enforce (schema บังคับไม่ได้):
--
-- 1. ระบบประถม vs มัธยม:
--    - subject.grade_level.system='primary'  → grades.grading_period='annual'
--    - subject.grade_level.system='secondary' → grades.grading_period='semester'
--
-- 2. คะแนนเก็บไม่ควรเกิน max_score ของ category:
--    - UI highlight สีแดงเมื่อ score > max_score (ไม่ block ตามที่ user ตกลง)
--
-- 3. เกณฑ์เกรด (grade_scales) ไม่ควรทับซ้อน:
--    - เช็คตอน admin บันทึก ไม่ใช้ DB constraint
--
-- 4. UI ต้องเตือนก่อนลบ (เพราะ ON DELETE CASCADE):
--    - ลบนักเรียน → ลบ scores/grades/attendance/evaluations
--    - ลบครู → ลบ subject_offerings ที่ครูสอน
--    - ลบห้องเรียน → ลบ enrollments/offerings/attendance ของห้องนั้น
--
-- 5. การย้ายห้องกลางภาค:
--    - ระบบไม่เก็บประวัติ - ครู/admin ลบ enrollment เก่า + สร้างใหม่
--    - คะแนนที่บันทึกไว้ใน offering เดิม จะไม่ย้ายไปด้วย (ต้อง re-record)
--
-- 6. การเปลี่ยนครูผู้สอนกลางภาค:
--    - แก้ subject_offerings.teacher_id ตรงๆ
--    - ระบบไม่เก็บประวัติว่าครูคนเก่าเคยสอน
--
-- TODO ก่อน production:
--   1. เพิ่ม Row-Level Security (RLS) policies
--   2. สร้าง storage buckets สำหรับ ปพ.5 PDF + โลโก้
--   3. ตั้งค่า Supabase Auth (Username/Password)
--   4. Seed ข้อมูลโรงเรียน (schools) + admin คนแรก
-- =====================================================================
