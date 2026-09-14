-- ============================================================
-- Migration: link daily attendance to subject attendance
-- Date:      2026-09-14
--
-- Adds recurring weekday settings per subject slot and optional date
-- overrides for make-up classes. Existing attendance rows are untouched.
-- Run once in Supabase Dashboard -> SQL Editor after updating the app.
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS subject_schedule_slots (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    offering_id         UUID NOT NULL REFERENCES subject_offerings(id) ON DELETE CASCADE,
    slot_in_week        SMALLINT NOT NULL CHECK (slot_in_week BETWEEN 1 AND 10),
    weekday             SMALLINT NOT NULL CHECK (weekday BETWEEN 1 AND 7),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(offering_id, slot_in_week)
);

CREATE INDEX IF NOT EXISTS idx_subject_schedule_slots_offering
    ON subject_schedule_slots(offering_id);

CREATE TABLE IF NOT EXISTS subject_schedule_overrides (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    offering_id         UUID NOT NULL REFERENCES subject_offerings(id) ON DELETE CASCADE,
    week                SMALLINT NOT NULL CHECK (week BETWEEN 1 AND 30),
    slot_in_week        SMALLINT NOT NULL CHECK (slot_in_week BETWEEN 1 AND 10),
    session_date        DATE NOT NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(offering_id, week, slot_in_week)
);

CREATE INDEX IF NOT EXISTS idx_subject_schedule_overrides_offering
    ON subject_schedule_overrides(offering_id);

COMMENT ON TABLE subject_schedule_slots IS
    'วันเรียนประจำต่อช่องของรายวิชา · ใช้จับคู่เช็กชื่อรายวัน';
COMMENT ON TABLE subject_schedule_overrides IS
    'วันเรียนชดเชย/ย้ายคาบเฉพาะสัปดาห์ · ไม่แก้ตารางประจำ';

DROP TRIGGER IF EXISTS set_updated_at_subject_schedule_slots ON subject_schedule_slots;
CREATE TRIGGER set_updated_at_subject_schedule_slots
    BEFORE UPDATE ON subject_schedule_slots
    FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

DROP TRIGGER IF EXISTS set_updated_at_subject_schedule_overrides ON subject_schedule_overrides;
CREATE TRIGGER set_updated_at_subject_schedule_overrides
    BEFORE UPDATE ON subject_schedule_overrides
    FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

ALTER TABLE subject_schedule_slots ENABLE ROW LEVEL SECURITY;
ALTER TABLE subject_schedule_overrides ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "subject_schedule_slots_staff_read" ON subject_schedule_slots;
CREATE POLICY "subject_schedule_slots_staff_read" ON subject_schedule_slots
    FOR SELECT USING (is_staff());

DROP POLICY IF EXISTS "subject_schedule_slots_teacher_write" ON subject_schedule_slots;
CREATE POLICY "subject_schedule_slots_teacher_write" ON subject_schedule_slots
    FOR ALL
    USING (is_teacher() AND teacher_teaches_offering(offering_id))
    WITH CHECK (is_teacher() AND teacher_teaches_offering(offering_id));

DROP POLICY IF EXISTS "subject_schedule_slots_admin_all" ON subject_schedule_slots;
CREATE POLICY "subject_schedule_slots_admin_all" ON subject_schedule_slots
    FOR ALL USING (is_admin()) WITH CHECK (is_admin());

DROP POLICY IF EXISTS "subject_schedule_overrides_staff_read" ON subject_schedule_overrides;
CREATE POLICY "subject_schedule_overrides_staff_read" ON subject_schedule_overrides
    FOR SELECT USING (is_staff());

DROP POLICY IF EXISTS "subject_schedule_overrides_teacher_write" ON subject_schedule_overrides;
CREATE POLICY "subject_schedule_overrides_teacher_write" ON subject_schedule_overrides
    FOR ALL
    USING (is_teacher() AND teacher_teaches_offering(offering_id))
    WITH CHECK (is_teacher() AND teacher_teaches_offering(offering_id));

DROP POLICY IF EXISTS "subject_schedule_overrides_admin_all" ON subject_schedule_overrides;
CREATE POLICY "subject_schedule_overrides_admin_all" ON subject_schedule_overrides
    FOR ALL USING (is_admin()) WITH CHECK (is_admin());

COMMIT;
