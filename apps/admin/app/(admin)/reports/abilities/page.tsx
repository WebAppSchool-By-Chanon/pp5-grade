import { createClient } from "@pp5/database/server";
import { getCurrentUser } from "@pp5/database/queries";
import type { Database } from "@pp5/database";
import Link from "next/link";
import type { Metadata } from "next";
import {
  ABILITY_COLUMNS,
  abilityTotal,
  summarizeAbility,
} from "@/lib/ability-eval";
import type { EvalLabel } from "@/lib/curriculum-eval-utils";
import { getCurrentTerm } from "@/lib/current-term";
import { getTeacherScope } from "@/lib/teacher-scope";
import { abbreviateTitle } from "../../setup/score-structure/grading-utils";
import { PrintButton } from "../pp5/print-button";

type Props = {
  searchParams: Promise<{ classroom?: string; grade?: string; scope?: string; embed?: string }>;
};

type ReportRow = {
  id: string;
  number: number;
  roomNumber: number;
  name: string;
  gradeId: string;
  scores: Array<number | null>;
  total: number | null;
  result: EvalLabel | null;
};

type ClassroomRow = {
  id: string;
  room_number: number;
  grade_level_id: string;
  grade_level: { id: string; name_short: string; sort_order: number; system: string } | null;
};
type EnrollmentRow = {
  classroom_id: string;
  semester: number;
  student_number: number;
  student: { id: string; title: string | null; first_name: string; last_name: string } | null;
};
type AbilityRow = Pick<
  Database["public"]["Tables"]["ability_evaluations"]["Row"],
  "student_id" | (typeof ABILITY_COLUMNS)[number]["field"]
>;

const LEVELS: EvalLabel[] = ["ไม่ผ่าน", "ผ่าน", "ดี", "ดีเยี่ยม"];

export async function generateMetadata(): Promise<Metadata> {
  const term = await getCurrentTerm();
  return {
    title: `ผลการประเมินความสามารถของผู้เรียน ปีการศึกษา ${term?.yearBe ?? ""}`,
  };
}

function percent(count: number, total: number): string {
  return total ? `${((count / total) * 100).toFixed(1)}%` : "—";
}

function levelCounts(rows: ReportRow[]): number[] {
  return LEVELS.map((level) => rows.filter((row) => row.result === level).length);
}

function SummaryTable({
  rows,
  grades,
  schoolScope,
}: {
  rows: ReportRow[];
  grades: Array<{ id: string; label: string }>;
  schoolScope: boolean;
}) {
  const groups = schoolScope
    ? grades.map((grade) => ({ id: grade.id, label: grade.label, rows: rows.filter((row) => row.gradeId === grade.id) }))
    : [];
  groups.push({ id: "", label: schoolScope ? "รวมทั้งโรงเรียน" : "รวมที่เลือก", rows });
  return (
    <section className="mt-6 break-inside-avoid">
      <h2 className="mb-2 text-base font-semibold">สรุปผลการประเมินรายชั้น</h2>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr className="bg-zinc-100">
              <th className="border p-2 text-left">ระดับชั้น</th>
              <th className="border p-2">นักเรียนทั้งหมด</th>
              <th className="border p-2">ประเมินครบ</th>
              {LEVELS.map((level) => <th key={level} className="border p-2">{level}</th>)}
              <th className="border p-2">ดีขึ้นไป</th>
              <th className="border p-2">ร้อยละดีขึ้นไป</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((group) => {
              const counts = levelCounts(group.rows);
              const goodUp = counts[2] + counts[3];
              return (
                <tr key={group.label} className={group.rows === rows ? "bg-zinc-50 font-semibold" : ""}>
                  <td className="border p-2">
                    {schoolScope && group.id ? (
                      <Link href={`/reports/abilities?scope=grade&grade=${group.id}`} className="underline print:no-underline">
                        {group.label}
                      </Link>
                    ) : group.label}
                  </td>
                  <td className="border p-2 text-center">{group.rows.length}</td>
                  <td className="border p-2 text-center">{counts.reduce((sum, n) => sum + n, 0)}</td>
                  {counts.map((count, i) => <td key={LEVELS[i]} className="border p-2 text-center">{count}</td>)}
                  <td className="border p-2 text-center">{goodUp}</td>
                  <td className="border p-2 text-center">{percent(goodUp, group.rows.length)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function DomainTable({ rows }: { rows: ReportRow[] }) {
  return (
    <section className="mt-6 break-inside-avoid">
      <h2 className="mb-2 text-base font-semibold">สรุปผลแยกตามความสามารถ</h2>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr className="bg-zinc-100">
              <th className="border p-2 text-left">ความสามารถ</th>
              <th className="border p-2">นักเรียนทั้งหมด</th>
              <th className="border p-2">มีคะแนน</th>
              {LEVELS.map((level) => <th key={level} className="border p-2">{level}</th>)}
              <th className="border p-2">ดีขึ้นไป</th>
              <th className="border p-2">ร้อยละดีขึ้นไป</th>
            </tr>
          </thead>
          <tbody>
            {ABILITY_COLUMNS.map((column, index) => {
              const scores = rows.map((row) => row.scores[index]);
              const counts = [0, 1, 2, 3].map((level) => scores.filter((score) => score === level).length);
              const goodUp = counts[2] + counts[3];
              return (
                <tr key={column.field}>
                  <td className="border p-2">{index + 1}. {column.label}</td>
                  <td className="border p-2 text-center">{rows.length}</td>
                  <td className="border p-2 text-center">{counts.reduce((sum, n) => sum + n, 0)}</td>
                  {counts.map((count, i) => <td key={LEVELS[i]} className="border p-2 text-center">{count}</td>)}
                  <td className="border p-2 text-center">{goodUp}</td>
                  <td className="border p-2 text-center">{percent(goodUp, rows.length)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-zinc-600">ร้อยละคำนวณจากจำนวนนักเรียนทั้งหมดในรายงานนี้</p>
    </section>
  );
}

export default async function AbilitiesReportPage({ searchParams }: Props) {
  const params = await searchParams;
  const [term, auth, scope] = await Promise.all([
    getCurrentTerm(),
    getCurrentUser(),
    getTeacherScope(),
  ]);
  if (!term || !auth) return <p className="p-8">ไม่พบปีการศึกษาปัจจุบันหรือไม่ได้เข้าสู่ระบบ</p>;

  const schoolScope = params.scope === "school";
  const gradeScope = params.scope === "grade";
  if ((schoolScope || gradeScope) && auth.profile.role !== "admin") {
    return <p className="p-8">รายงานสรุปชั้นและโรงเรียนสำหรับผู้ดูแลระบบเท่านั้น</p>;
  }
  if (!schoolScope && !gradeScope && !params.classroom) {
    return <p className="p-8">กรุณาเลือกห้องเรียนก่อนเปิดรายงาน</p>;
  }

  const supabase = await createClient();
  const [{ data: school }, { data: allClassrooms, error: classroomError }] = await Promise.all([
    supabase.from("schools").select("name_th").limit(1).maybeSingle(),
    supabase
      .from("classrooms")
      .select("id, room_number, grade_level_id, grade_level:grade_levels!grade_level_id(id, name_short, sort_order, system)")
      .eq("academic_year_id", term.yearId),
  ]);
  if (classroomError) throw new Error(classroomError.message);
  const classrooms = ((allClassrooms ?? []) as ClassroomRow[])
    .filter((room) => schoolScope || (gradeScope ? room.grade_level_id === params.grade : room.id === params.classroom))
    .filter((room) => auth.profile.role === "admin" || scope?.homeroomClassroomIds.has(room.id))
    .sort((a, b) => (a.grade_level?.sort_order ?? 0) - (b.grade_level?.sort_order ?? 0) || a.room_number - b.room_number);
  if (classrooms.length === 0) return <p className="p-8">ไม่พบห้องเรียนที่มีสิทธิ์ดู</p>;
  const roomMap = new Map(classrooms.map((room) => [room.id, room]));
  const roomIds = classrooms.map((room) => room.id);

  const enrollmentRows: EnrollmentRow[] = [];
  // PostgREST limits rows per response; paginate so school-wide totals do
  // not silently omit students at larger schools.
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await supabase
      .from("enrollments")
      .select("classroom_id, semester, student_number, student:students!student_id(id, title, first_name, last_name)")
      .in("classroom_id", roomIds)
      .order("id")
      .range(offset, offset + 999);
    if (error) throw new Error(error.message);
    const page = (data ?? []) as EnrollmentRow[];
    enrollmentRows.push(...page);
    if (page.length < 1000) break;
  }
  const roster = enrollmentRows
    .filter((row) => row.student && roomMap.has(row.classroom_id))
    .filter((row) => row.semester === (roomMap.get(row.classroom_id)?.grade_level?.system === "secondary" ? term.semester : 0));
  const studentIds = [...new Set(roster.map((row) => row.student!.id))];
  const evaluations: AbilityRow[] = [];
  for (let offset = 0; offset < studentIds.length; offset += 200) {
    const { data, error } = await supabase
      .from("ability_evaluations")
      .select("student_id, art_score, language_score, music_score, sports_score, computer_score, interpersonal_score, self_understanding_score, nature_score")
      .eq("academic_year_id", term.yearId)
      .in("student_id", studentIds.slice(offset, offset + 200));
    if (error) throw new Error(error.message);
    evaluations.push(...((data ?? []) as AbilityRow[]));
  }
  const byStudent = new Map(evaluations.map((evaluation) => [evaluation.student_id, evaluation]));
  const uniqueRows = new Map<string, ReportRow>();
  for (const enrollment of roster) {
    const student = enrollment.student!;
    const room = roomMap.get(enrollment.classroom_id)!;
    const saved = byStudent.get(student.id);
    const scores = ABILITY_COLUMNS.map((column) => saved?.[column.field] ?? null);
    uniqueRows.set(student.id, {
      id: student.id,
      number: enrollment.student_number,
      roomNumber: room.room_number,
      name: `${abbreviateTitle(student.title)}${student.first_name} ${student.last_name}`,
      gradeId: room.grade_level_id,
      scores,
      total: abilityTotal(scores),
      result: summarizeAbility(scores),
    });
  }
  const rows = [...uniqueRows.values()].sort((a, b) => a.roomNumber - b.roomNumber || a.number - b.number || a.name.localeCompare(b.name, "th"));
  const grades = [...new Map(classrooms.map((room) => [room.grade_level_id, {
    id: room.grade_level_id,
    label: room.grade_level?.name_short ?? "—",
    order: room.grade_level?.sort_order ?? 0,
  }])).values()].sort((a, b) => a.order - b.order);
  const room = schoolScope ? null : classrooms[0];

  return (
    <main className="ability-report mx-auto max-w-6xl bg-white px-5 py-6 text-zinc-900">
      <style>{`
        @media print {
          @page { size: A4 landscape; margin: 12mm; }
          .ability-report { max-width: none; padding: 0; }
          .ability-report .no-print { display: none !important; }
          .ability-report table { page-break-inside: auto; }
          .ability-report tr { page-break-inside: avoid; }
        }
      `}</style>
      {params.embed === "1" ? null : (
        <div className="no-print mb-5 flex items-center justify-between">
          <Link href="/setup/abilities" className="text-sm text-violet-700 underline">← กลับหน้าประเมิน</Link>
          <PrintButton />
        </div>
      )}
      <header className="mb-5 text-center">
        <h1 className="text-xl font-bold">ผลการประเมินความสามารถของผู้เรียน</h1>
        <p className="mt-1 text-sm">{school?.name_th ?? ""} · ปีการศึกษา {term.yearBe}</p>
        <p className="text-sm">
          {schoolScope
            ? "รวมทั้งโรงเรียน"
            : gradeScope
              ? `ชั้น${classrooms[0]?.grade_level?.name_short ?? ""} ทุกห้อง`
              : `ชั้น${room?.grade_level?.name_short ?? ""}/${room?.room_number ?? ""}`}
        </p>
      </header>

      {!schoolScope ? (
        <section>
          <div className="overflow-x-auto">
            <table className="w-full table-fixed border-collapse text-[11px]">
              <colgroup>
                {gradeScope ? <col style={{ width: "6%" }} /> : null}
                <col style={{ width: "4%" }} />
                <col style={{ width: gradeScope ? "14%" : "20%" }} />
                {ABILITY_COLUMNS.map((column) => <col key={column.field} style={{ width: "7.5%" }} />)}
                <col style={{ width: "6%" }} />
                <col style={{ width: "10%" }} />
              </colgroup>
              <thead>
                <tr className="bg-zinc-100">
                  {gradeScope ? <th className="border p-1">ห้อง</th> : null}
                  <th className="border p-1">ที่</th>
                  <th className="border p-1 text-left">ชื่อ – สกุล</th>
                  {ABILITY_COLUMNS.map((column) => <th key={column.field} className="border p-1 break-words">{column.label}</th>)}
                  <th className="border p-1">รวม</th>
                  <th className="border p-1">ผล</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((student) => (
                  <tr key={student.id}>
                    {gradeScope ? <td className="border p-1 text-center">{student.roomNumber}</td> : null}
                    <td className="border p-1 text-center">{student.number}</td>
                    <td className="border p-1">{student.name}</td>
                    {student.scores.map((score, index) => <td key={ABILITY_COLUMNS[index].field} className="border p-1 text-center">{score ?? "—"}</td>)}
                    <td className="border p-1 text-center">{student.total ?? "—"}</td>
                    <td className="border p-1 text-center">{student.result ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      <SummaryTable rows={rows} grades={grades} schoolScope={schoolScope} />
      <DomainTable rows={rows} />
      <p className="mt-4 text-xs text-zinc-600">
        เกณฑ์สรุป: ประเมินครบ 8 ด้านก่อน · มีคะแนน 0 ด้านใด = ไม่ผ่าน ·
        คะแนนรวม 1–8 = ผ่าน, 9–14 = ดี, ตั้งแต่ 15 = ดีเยี่ยม
      </p>
    </main>
  );
}
