-- Annual eight-domain student ability assessment.
-- Run once for schools already installed; fresh installations use setup.sql.
CREATE TABLE IF NOT EXISTS public.ability_evaluations (
    id                       UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    student_id               UUID NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
    academic_year_id         UUID NOT NULL REFERENCES public.academic_years(id) ON DELETE CASCADE,
    art_score                INTEGER CHECK (art_score BETWEEN 0 AND 3),
    language_score           INTEGER CHECK (language_score BETWEEN 0 AND 3),
    music_score              INTEGER CHECK (music_score BETWEEN 0 AND 3),
    sports_score             INTEGER CHECK (sports_score BETWEEN 0 AND 3),
    computer_score           INTEGER CHECK (computer_score BETWEEN 0 AND 3),
    interpersonal_score      INTEGER CHECK (interpersonal_score BETWEEN 0 AND 3),
    self_understanding_score INTEGER CHECK (self_understanding_score BETWEEN 0 AND 3),
    nature_score             INTEGER CHECK (nature_score BETWEEN 0 AND 3),
    evaluated_by             UUID REFERENCES public.teachers(id),
    evaluated_at             TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(student_id, academic_year_id)
);

CREATE INDEX IF NOT EXISTS idx_ability_eval_student
    ON public.ability_evaluations(student_id);
COMMENT ON TABLE public.ability_evaluations IS 'ประเมินความสามารถของผู้เรียน 8 ด้าน รายปี';

ALTER TABLE public.ability_evaluations ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ability_evaluations TO authenticated;

DROP POLICY IF EXISTS "ability_eval_staff_read" ON public.ability_evaluations;
CREATE POLICY "ability_eval_staff_read" ON public.ability_evaluations
    FOR SELECT TO authenticated USING (public.is_staff());
DROP POLICY IF EXISTS "ability_eval_student_read_own" ON public.ability_evaluations;
CREATE POLICY "ability_eval_student_read_own" ON public.ability_evaluations
    FOR SELECT TO authenticated USING (student_id = public.current_student_id());
DROP POLICY IF EXISTS "ability_eval_homeroom_write" ON public.ability_evaluations;
CREATE POLICY "ability_eval_homeroom_write" ON public.ability_evaluations
    FOR ALL TO authenticated
    USING (
        public.is_teacher() AND EXISTS (
            SELECT 1 FROM public.enrollments e
            JOIN public.classrooms c ON c.id = e.classroom_id
            WHERE e.student_id = ability_evaluations.student_id
              AND c.academic_year_id = ability_evaluations.academic_year_id
              AND public.teacher_is_homeroom_of(c.id)
        )
    )
    WITH CHECK (
        public.is_teacher() AND EXISTS (
            SELECT 1 FROM public.enrollments e
            JOIN public.classrooms c ON c.id = e.classroom_id
            WHERE e.student_id = ability_evaluations.student_id
              AND c.academic_year_id = ability_evaluations.academic_year_id
              AND public.teacher_is_homeroom_of(c.id)
        )
    );
DROP POLICY IF EXISTS "ability_eval_admin_all" ON public.ability_evaluations;
CREATE POLICY "ability_eval_admin_all" ON public.ability_evaluations
    FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
