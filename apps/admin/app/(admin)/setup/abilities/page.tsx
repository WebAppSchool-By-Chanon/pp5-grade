import { createClient } from "@pp5/database/server";
import { getCurrentUser } from "@pp5/database/queries";
import type { Database } from "@pp5/database";
import { Card, PageHeader } from "@pp5/ui";
import { Sparkles } from "lucide-react";
import Link from "next/link";
import { ABILITY_COLUMNS } from "@/lib/ability-eval";
import { getCurrentTerm } from "@/lib/current-term";
import { getTeacherScope } from "@/lib/teacher-scope";
import {
  FixedEvalGrid,
  type FixedStudentRow,
} from "../../_components/fixed-eval-grid";
import { DirectPrintButton } from "../../_components/direct-print-button";
import { abbreviateTitle } from "../score-structure/grading-utils";
import { CompetencySelector } from "../competency/selector";
import { FilterNavProvider } from "../_components/filter-nav-context";
import { FilterNavGate } from "../_components/filter-nav-gate";
import { saveAbilityScore, setAllAbilitiesForColumn } from "./actions";

export const metadata = { title: "ประเมินความสามารถของผู้เรียน" };

type Props = {
  searchParams: Promise<{ grade?: string; room?: string }>;
};

type ClassroomRow = {
  id: string;
  room_number: number;
  grade_level_id: string;
  grade_level: { id: string; name_short: string; sort_order: number; system: string } | null;
};
type EnrollmentRow = {
  student_number: number;
  student: { id: string; title: string | null; first_name: string; last_name: string } | null;
};
type AbilityRow = Pick<
  Database["public"]["Tables"]["ability_evaluations"]["Row"],
  "student_id" | (typeof ABILITY_COLUMNS)[number]["field"]
>;

export default async function AbilitiesPage({ searchParams }: Props) {
  const params = await searchParams;
  const [term, auth, scope] = await Promise.all([
    getCurrentTerm(),
    getCurrentUser(),
    getTeacherScope(),
  ]);
  const supabase = await createClient();

  if (!term) {
    return (
      <>
        <PageHeader icon={Sparkles} iconBg="bg-violet-100 text-violet-700" title="ประเมินความสามารถของผู้เรียน" />
        <Card variant="warning" padding="sm">
          ยังไม่มีปีการศึกษาปัจจุบัน · <Link href="/setup/academic-years" className="underline">ตั้งค่าปีการศึกษา</Link>
        </Card>
      </>
    );
  }

  const { data: classroomRows, error: classroomError } = await supabase
    .from("classrooms")
    .select("id, room_number, grade_level_id, grade_level:grade_levels!grade_level_id(id, name_short, sort_order, system)")
    .eq("academic_year_id", term.yearId);
  if (classroomError) throw new Error(classroomError.message);

  // A teacher sees only their homerooms; a missing teacher row grants none.
  const classrooms = ((classroomRows ?? []) as ClassroomRow[]).filter((room) =>
    auth?.profile.role === "admin" || scope?.homeroomClassroomIds.has(room.id),
  );
  const gradeMap = new Map<string, { id: string; label: string; order: number }>();
  for (const room of classrooms) {
    const grade = room.grade_level;
    if (grade && !gradeMap.has(grade.id)) {
      gradeMap.set(grade.id, {
        id: grade.id,
        label: grade.name_short,
        order: grade.sort_order,
      });
    }
  }
  const grades = [...gradeMap.values()].sort((a, b) => a.order - b.order);
  const selectedGrade = grades.find((grade) => grade.id === params.grade);
  const rooms = selectedGrade
    ? classrooms
        .filter((room) => room.grade_level_id === selectedGrade.id)
        .sort((a, b) => a.room_number - b.room_number)
    : [];
  const selectedRoom = params.room
    ? rooms.find((room) => room.id === params.room)
    : rooms.length === 1
      ? rooms[0]
      : undefined;

  let students: FixedStudentRow[] = [];
  let loadError: string | null = null;
  if (selectedRoom) {
    const enrollmentSemester = selectedRoom.grade_level?.system === "secondary" ? term.semester : 0;
    const { data: enrollments, error: enrollmentError } = await supabase
      .from("enrollments")
      .select("student_number, student:students!student_id(id, title, first_name, last_name)")
      .eq("classroom_id", selectedRoom.id)
      .eq("semester", enrollmentSemester)
      .order("student_number");
    if (enrollmentError) throw new Error(enrollmentError.message);
    const roster = ((enrollments ?? []) as EnrollmentRow[]).filter((row) => row.student);
    const ids = roster.map((row) => row.student!.id);
    const { data: evaluations, error: evaluationsError } = ids.length
      ? await supabase
          .from("ability_evaluations")
          .select("student_id, art_score, language_score, music_score, sports_score, computer_score, interpersonal_score, self_understanding_score, nature_score")
          .eq("academic_year_id", term.yearId)
          .in("student_id", ids)
      : { data: [], error: null };
    if (evaluationsError) {
      loadError = evaluationsError.message;
    } else {
      const scoresByStudent = new Map(((evaluations ?? []) as AbilityRow[]).map((row) => [row.student_id, row]));
      students = roster.map((row) => {
        const student = row.student!;
        const saved = scoresByStudent.get(student.id);
        return {
          id: student.id,
          student_number: row.student_number,
          full_label: `${abbreviateTitle(student.title)}${student.first_name} ${student.last_name}`,
          scores: Object.fromEntries(
            ABILITY_COLUMNS.map((column) => [column.field, saved?.[column.field] ?? null]),
          ),
        };
      });
    }
  }

  return (
    <>
      <PageHeader
        icon={Sparkles}
        iconBg="bg-violet-100 text-violet-700"
        title="ประเมินความสามารถของผู้เรียน"
        description={`8 ด้าน · ปีการศึกษา ${term.yearBe} · ประเมินรายปี`}
      />
      {auth?.profile.role === "admin" ? (
        <div className="mb-4 text-right">
          <Link href="/reports/abilities?scope=school" className="text-sm font-medium text-violet-700 underline">
            ดูสรุปทั้งโรงเรียน
          </Link>
        </div>
      ) : null}
      <p className="mb-3 text-sm text-zinc-600">
        ให้คะแนนด้านละ 0–3 · ประเมินครบ 8 ด้านจึงสรุปผล · ถ้าด้านใดได้ 0 ผลเป็นไม่ผ่าน
      </p>
      <FilterNavProvider>
        <Card padding="sm" className="mb-4">
          <CompetencySelector
            basePath="/setup/abilities"
            grades={grades.map((grade) => ({ id: grade.id, label: grade.label }))}
            selectedGradeId={selectedGrade?.id ?? ""}
            rooms={rooms.map((room) => ({ id: room.id, label: `${selectedGrade?.label}/${room.room_number}` }))}
            selectedRoomId={selectedRoom?.id ?? ""}
          />
        </Card>
        <FilterNavGate
          fallback={<Card variant="dashed" className="p-12 text-center text-sm text-zinc-500">กำลังโหลดข้อมูล…</Card>}
        >
          {!selectedGrade ? (
            <Card variant="dashed" className="p-12 text-center text-sm text-zinc-500">เลือกระดับชั้นก่อน</Card>
          ) : !selectedRoom ? (
            <Card variant="dashed" className="p-12 text-center text-sm text-zinc-500">เลือกห้องเรียนก่อน</Card>
          ) : loadError ? (
            <Card variant="warning" padding="sm" className="text-sm text-amber-900">
              โหลดผลประเมินไม่สำเร็จ · หากโรงเรียนติดตั้งระบบไว้ก่อนหน้านี้ ให้รันไฟล์
              <code className="mx-1">migrations/20261006_student_abilities.sql</code>
              ใน Supabase SQL Editor · {loadError}
            </Card>
          ) : students.length === 0 ? (
            <Card variant="dashed" className="p-12 text-center text-sm text-zinc-500">ห้องนี้ยังไม่มีนักเรียน</Card>
          ) : (
            <Card padding={false} className="overflow-hidden">
              <div className="flex items-center justify-between border-b border-zinc-200 bg-zinc-50 px-4 py-2.5 text-sm text-zinc-700">
                <span>{selectedGrade.label}/{selectedRoom.room_number} · {students.length} คน</span>
                <DirectPrintButton
                  url={`/reports/abilities?classroom=${selectedRoom.id}&embed=1`}
                  title="พิมพ์รายงานความสามารถของผู้เรียน"
                />
              </div>
              <div className="p-3">
                <FixedEvalGrid
                  students={students}
                  columns={[...ABILITY_COLUMNS]}
                  classroomId={selectedRoom.id}
                  yearId={term.yearId}
                  semester={0}
                  summaryRule="ability"
                  showTotal
                  saveAction={saveAbilityScore}
                  bulkAction={setAllAbilitiesForColumn}
                />
              </div>
            </Card>
          )}
        </FilterNavGate>
      </FilterNavProvider>
    </>
  );
}
