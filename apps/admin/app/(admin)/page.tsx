import { getCurrentUser } from "@pp5/database/queries";
import { createClient } from "@pp5/database/server";
import { headers } from "next/headers";
import { ACCESS_HEADER, TRIAL_DAYS_HEADER } from "../../proxy";
import { Card } from "@pp5/ui";
import {
  Activity,
  AlertTriangle,
  Brain,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  GraduationCap,
  Heart,
  School,
  Users,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { VersionStatus } from "./_components/version-status";

type StatCardProps = {
  label: string;
  value: string;
  hint?: string;
  href?: string;
  icon: LucideIcon;
  /** Tailwind classes for the icon container (matches the section's signature color). */
  iconBg: string;
  /** Vertical accent bar at the top of the card. */
  accentBg: string;
};

function StatCard({
  label,
  value,
  hint,
  href,
  icon: Icon,
  iconBg,
  accentBg,
}: StatCardProps) {
  const inner = (
    <Card
      padding={false}
      className="group h-full overflow-hidden shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
    >
      <div className={`h-1 w-full ${accentBg}`} aria-hidden />
      <div className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
              {label}
            </p>
            <p className="mt-2 text-3xl font-bold text-zinc-900">{value}</p>
            {hint && <p className="mt-1 text-xs text-zinc-500">{hint}</p>}
          </div>
          <div
            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${iconBg}`}
          >
            <Icon className="h-5 w-5" aria-hidden />
          </div>
        </div>
      </div>
    </Card>
  );
  return href ? (
    <Link href={href} className="block">
      {inner}
    </Link>
  ) : (
    inner
  );
}

/** One collapsible section in the "ค้างประเมิน" widget. Uses native
 *  `<details>`/`<summary>` so collapse/expand works without any client
 *  JS — keeps this page a pure Server Component. The summary row shows
 *  the rolled-up % (weighted by classroom size: total_filled /
 *  total_expected); the body lists every classroom with its own % so
 *  the admin can see at a glance which rooms are 100% vs. still
 *  pending. Each row in the body links to the setup page filtered to
 *  that grade+room. */
type EvalStat = {
  classroomId: string;
  gradeId: string;
  label: string;
  sortKey: number;
  studentCount: number;
  homeroomNames: string[];
  filled: number;
  expected: number;
};

function PendingEvalSection({
  title,
  icon: Icon,
  href,
  stats,
}: {
  title: string;
  icon: LucideIcon;
  /** Base setup URL — per-classroom rows append `?grade=X&room=Y`. */
  href: string;
  stats: EvalStat[];
}) {
  const totalFilled = stats.reduce((s, c) => s + c.filled, 0);
  const totalExpected = stats.reduce((s, c) => s + c.expected, 0);
  const percent =
    totalExpected > 0 ? Math.round((totalFilled / totalExpected) * 100) : 100;
  const isComplete = percent === 100;
  const bar = isComplete
    ? "bg-emerald-500"
    : percent >= 75
      ? "bg-lime-500"
      : percent >= 40
        ? "bg-amber-500"
        : "bg-rose-500";

  return (
    <details className="group border-b border-zinc-200 last:border-b-0 [&_summary]:list-none">
      <summary className="flex cursor-pointer items-center gap-3 px-4 py-3 transition hover:bg-zinc-50">
        <span
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
            isComplete
              ? "bg-emerald-100 text-emerald-700"
              : "bg-amber-100 text-amber-700"
          }`}
        >
          {isComplete ? (
            <CheckCircle2 className="h-5 w-5" aria-hidden />
          ) : (
            <Icon className="h-5 w-5" aria-hidden />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-zinc-900">{title}</p>
          <div className="mt-1 flex items-center gap-2">
            <div className="h-1.5 w-32 overflow-hidden rounded-full bg-zinc-200">
              <div
                className={`h-full transition-all ${bar}`}
                style={{ width: `${percent}%` }}
              />
            </div>
            <p className="text-xs text-zinc-600">
              <span className="font-sans font-semibold tabular-nums text-zinc-900">
                {percent}%
              </span>
            </p>
          </div>
        </div>
        <ChevronDown
          className="h-4 w-4 shrink-0 text-zinc-400 transition-transform group-open:rotate-180"
          aria-hidden
        />
      </summary>
      <div className="border-t border-zinc-100 bg-zinc-50/50">
        {stats.length === 0 ? (
          <p className="px-4 py-3 text-center text-xs text-zinc-500">
            ไม่มีห้องเรียนที่มีนักเรียนในภาคปัจจุบัน
          </p>
        ) : (
          <ul className="divide-y divide-zinc-100">
            {stats.map((s) => {
              const cPct =
                s.expected > 0
                  ? Math.round((s.filled / s.expected) * 100)
                  : 100;
              const cDone = cPct === 100;
              const url = `${href}?grade=${s.gradeId}&room=${s.classroomId}`;
              return (
                <li key={s.classroomId}>
                  <Link
                    href={url}
                    className="flex items-center gap-3 px-4 py-2 text-sm transition hover:bg-white"
                  >
                    <span
                      className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs ${
                        cDone
                          ? "bg-emerald-100 text-emerald-700"
                          : "bg-amber-100 text-amber-700"
                      }`}
                      aria-hidden
                    >
                      {cDone ? "✓" : "!"}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium text-zinc-800">
                        {s.label}
                      </p>
                      {s.homeroomNames.length > 0 && (
                        <p className="truncate text-xs text-zinc-500">
                          {s.homeroomNames.join(" · ")}
                        </p>
                      )}
                    </div>
                    <span
                      className={`w-12 text-right font-sans text-xs font-semibold tabular-nums ${
                        cDone ? "text-emerald-700" : "text-amber-700"
                      }`}
                    >
                      {cPct}%
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </details>
  );
}

export default async function Dashboard() {
  // Defensive — proxy.ts should already redirect
  const auth = await getCurrentUser();
  if (!auth) redirect("/login");

  const headersList = await headers();
  const accessLevel = headersList.get(ACCESS_HEADER);
  const trialDaysStr = headersList.get(TRIAL_DAYS_HEADER);

  const isAdmin = auth.profile.role === "admin";
  const supabase = await createClient();

  // Parallel queries — keep this fast
  const [yearResult, teachersResult, classroomsResult] = await Promise.all([
    supabase
      .from("academic_years")
      .select("id, year_be, current_semester, start_date, end_date")
      .eq("is_current", true)
      .maybeSingle(),
    supabase
      .from("users")
      .select("id, is_active")
      .eq("role", "teacher"),
    supabase
      .from("classrooms")
      .select(
        `
        id,
        room_number,
        grade_level_id,
        academic_year_id,
        enrollments (id, student_id, semester),
        grade_level:grade_levels!grade_level_id (id, name_short, sort_order, system),
        homeroom_assignments (
          role,
          teacher:teachers!teacher_id (
            user:users!user_id (full_name, title)
          )
        )
      `,
      ),
  ]);

  const currentYear = yearResult.data;
  const allTeachers = teachersResult.data ?? [];
  const activeTeacherCount = allTeachers.filter((t) => t.is_active).length;
  const inactiveTeacherCount = allTeachers.length - activeTeacherCount;

  const currentClassrooms = currentYear
    ? (classroomsResult.data ?? []).filter(
        (c) => c.academic_year_id === currentYear.id,
      )
    : [];

  // Per-classroom student count uses the right semester scope so
  // secondary students aren't double-counted. Each secondary classroom
  // has TWO enrollment rows per student (sem 1 + sem 2); only the
  // current-semester rows count toward the dashboard total. Primary
  // classrooms have a single annual row (semester=0). Classrooms with
  // ZERO in-scope students don't count toward the classroom total —
  // matches the "current semester" framing user spec 2026-05-22:
  // "ห้องเรียน ให้นับตามภาคเรียนเช่นกัน".
  const studentCountSemester = currentYear?.current_semester as 1 | 2 | undefined;
  const classroomScopes = currentClassrooms.map((c) => {
    const isPrimary = c.grade_level?.system === "primary";
    const sem: 0 | 1 | 2 = isPrimary ? 0 : (studentCountSemester ?? 1);
    const studentsInScope = (c.enrollments ?? []).filter(
      (e) => e.semester === sem,
    ).length;
    return { id: c.id, studentsInScope };
  });
  const studentCount = classroomScopes.reduce(
    (sum, c) => sum + c.studentsInScope,
    0,
  );
  const classroomCount = classroomScopes.filter(
    (c) => c.studentsInScope > 0,
  ).length;

  // Pending-evaluations widget data —
  // For each classroom in current year, compute (filled, expected) per
  // eval type so the widget can display % completion AND list every
  // classroom's individual % when expanded. Semester scope follows
  // classroom system (primary=0, secondary=current_semester).
  // "Complete" definitions:
  //   - chars: rows count = students × active-char count
  //   - reading-thinking: rows count = students (all 3 fields non-null)
  //   - competency: rows count = students (all 5 fields non-null)
  // Uses count + head=true so we don't pull row payloads — just integers.
  // Admin-only; teachers see no widget (homeroom-scoped version later).
  type ClassroomEvalStat = {
    classroomId: string;
    gradeId: string;
    label: string;
    sortKey: number;
    studentCount: number;
    /** Names of homeroom teacher(s) for this classroom — surfaced in
     *  the widget so admin can see who's expected to fill the eval for
     *  each row (2 names if the room has two homerooms; equal status). */
    homeroomNames: string[];
    filled: number;
    expected: number;
  };
  let charsStats: ClassroomEvalStat[] = [];
  let rtStats: ClassroomEvalStat[] = [];
  let compStats: ClassroomEvalStat[] = [];
  let widgetReady = false;
  if (isAdmin && currentYear && classroomCount > 0) {
    const { data: activeChars } = await supabase
      .from("characteristics")
      .select("id")
      .eq("is_active", true);
    const activeCharCount = activeChars?.length ?? 0;
    const currentSem = currentYear.current_semester as 1 | 2;

    // Smart classroom label — show "ป.1/1" when the grade has multiple
    // rooms in the current year; just "ป.1" when there's only one room
    // (avoids "ป.1/1" noise when the room number is the only option).
    const roomCountByGrade = new Map<string, number>();
    for (const c of currentClassrooms) {
      roomCountByGrade.set(
        c.grade_level_id,
        (roomCountByGrade.get(c.grade_level_id) ?? 0) + 1,
      );
    }
    const labelFor = (c: (typeof currentClassrooms)[number]) => {
      const short = c.grade_level?.name_short ?? "?";
      return (roomCountByGrade.get(c.grade_level_id) ?? 1) > 1
        ? `${short}/${c.room_number}`
        : short;
    };

    type CheckResult = {
      kind: "chars" | "rt" | "comp";
      stat: ClassroomEvalStat;
    };

    // For each (classroom × eval type) fire a count query in parallel.
    // ~10-15 classrooms × 3 types ≈ 30-45 head queries — fast.
    const checks = await Promise.all<CheckResult>(
      currentClassrooms.flatMap((c): Array<Promise<CheckResult>> => {
        const isPrimary = c.grade_level?.system === "primary";
        const semester: 0 | 1 | 2 = isPrimary ? 0 : currentSem;
        const studentIds = (c.enrollments ?? [])
          .filter((e) => e.semester === semester)
          .map((e) => e.student_id);

        if (studentIds.length === 0) return [];

        // Sort homerooms by role so the "primary" homeroom slot comes
        // first when both are filled (equal status per user spec but
        // displaying in a stable order avoids the names jittering).
        const homeroomNames = (c.homeroom_assignments ?? [])
          .filter((h) => h.teacher?.user)
          .sort((a, b) => (a.role ?? "").localeCompare(b.role ?? ""))
          .map(
            (h) =>
              `${h.teacher!.user!.title ?? ""}${h.teacher!.user!.full_name}`,
          );

        const baseStat = {
          classroomId: c.id,
          gradeId: c.grade_level?.id ?? "",
          label: labelFor(c),
          // Sort: grade_level.sort_order ↑ then room_number ↑
          sortKey:
            (c.grade_level?.sort_order ?? 999) * 100 + (c.room_number ?? 0),
          studentCount: studentIds.length,
          homeroomNames,
        };

        return [
          (async () => {
            const { count } = await supabase
              .from("characteristic_evaluations")
              .select("*", { count: "exact", head: true })
              .eq("academic_year_id", currentYear.id)
              .eq("semester", semester)
              .in("student_id", studentIds);
            return {
              kind: "chars" as const,
              stat: {
                ...baseStat,
                filled: count ?? 0,
                expected: studentIds.length * activeCharCount,
              },
            };
          })(),
          (async () => {
            const { count } = await supabase
              .from("reading_thinking_evaluations")
              .select("*", { count: "exact", head: true })
              .eq("academic_year_id", currentYear.id)
              .eq("semester", semester)
              .in("student_id", studentIds)
              .not("reading_score", "is", null)
              .not("thinking_score", "is", null)
              .not("writing_score", "is", null);
            return {
              kind: "rt" as const,
              stat: {
                ...baseStat,
                filled: count ?? 0,
                expected: studentIds.length,
              },
            };
          })(),
          (async () => {
            const { count } = await supabase
              .from("competency_evaluations")
              .select("*", { count: "exact", head: true })
              .eq("academic_year_id", currentYear.id)
              .eq("semester", semester)
              .in("student_id", studentIds)
              .not("communication_score", "is", null)
              .not("thinking_score", "is", null)
              .not("problem_solving_score", "is", null)
              .not("life_skills_score", "is", null)
              .not("technology_score", "is", null);
            return {
              kind: "comp" as const,
              stat: {
                ...baseStat,
                filled: count ?? 0,
                expected: studentIds.length,
              },
            };
          })(),
        ];
      }),
    );

    const sortStats = (arr: ClassroomEvalStat[]) =>
      arr.slice().sort((a, b) => a.sortKey - b.sortKey);

    charsStats = sortStats(
      checks.filter((r) => r.kind === "chars").map((r) => r.stat),
    );
    rtStats = sortStats(
      checks.filter((r) => r.kind === "rt").map((r) => r.stat),
    );
    compStats = sortStats(
      checks.filter((r) => r.kind === "comp").map((r) => r.stat),
    );
    widgetReady = true;
  }

  return (
    <>
      {/* Hero header with gradient — adds visual interest, less plain */}
      <div className="mb-6 overflow-hidden rounded-xl bg-gradient-to-br from-primary-600 via-primary-500 to-primary-700 p-6 text-white shadow-sm">
        <div className="flex items-baseline justify-between gap-4">
          <div>
            <h2 className="text-2xl font-bold">ภาพรวม</h2>
            <p className="mt-1 text-sm text-primary-50">
              สวัสดี, {auth.profile.title}
              {auth.profile.full_name}
            </p>
          </div>
          {currentYear && (
            <div className="text-right">
              <p className="text-xs uppercase tracking-wide text-primary-100">
                ปีการศึกษาปัจจุบัน
              </p>
              <p className="text-2xl font-bold">
                ภาคเรียนที่ {currentYear.current_semester} ปีการศึกษา{" "}
                <span className="font-mono">{currentYear.year_be}</span>
              </p>
            </div>
          )}
        </div>

        {/* License badge */}
        <div className="mt-4 flex justify-end">
          {accessLevel === "full" ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-white/20 px-3 py-1 text-xs font-medium text-white backdrop-blur-sm">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-300" />
              ลิขสิทธิ์ถาวร
            </span>
          ) : accessLevel === "trial" && trialDaysStr ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-400/30 px-3 py-1 text-xs font-medium text-amber-100 backdrop-blur-sm">
              <span className="h-1.5 w-1.5 rounded-full bg-amber-300" />
              ทดลองใช้ · เหลืออีก {trialDaysStr} วัน
            </span>
          ) : null}
        </div>
      </div>

      {!currentYear && (
        <Card variant="warning" padding="sm" className="mb-6 text-sm text-amber-900">
          <p className="font-semibold">⚠️ ยังไม่ได้ตั้งค่าปีปัจจุบัน</p>
          <p className="mt-1">
            ตัวเลขด้านล่างอาจเป็น 0 จนกว่าจะเลือกปีปัจจุบัน ·{" "}
            {isAdmin && (
              <Link
                href="/setup/academic-years"
                className="font-medium underline"
              >
                ไปตั้งค่าปีการศึกษา
              </Link>
            )}
            {!isAdmin && "ติดต่อ admin"}
          </p>
        </Card>
      )}

      <section className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard
          label="ปีปัจจุบัน"
          value={currentYear ? `${currentYear.year_be}` : "—"}
          hint={
            currentYear
              ? `พ.ศ. · ภาคเรียนที่ ${currentYear.current_semester}`
              : "ยังไม่ตั้งค่า"
          }
          href={isAdmin ? "/setup/academic-years" : undefined}
          icon={CalendarDays}
          iconBg="bg-purple-100 text-purple-700"
          accentBg="bg-purple-500"
        />
        <StatCard
          label="นักเรียน"
          value={studentCount.toString()}
          hint={currentYear ? "ในปีปัจจุบัน" : "ต้องมีปีปัจจุบัน"}
          href={isAdmin ? "/setup/students" : undefined}
          icon={GraduationCap}
          iconBg="bg-sky-100 text-sky-700"
          accentBg="bg-sky-500"
        />
        <StatCard
          label="ครู"
          value={activeTeacherCount.toString()}
          hint={
            inactiveTeacherCount > 0
              ? `+ ${inactiveTeacherCount} ปิดใช้งาน`
              : "ใช้งานอยู่"
          }
          href={isAdmin ? "/setup/teachers" : undefined}
          icon={Users}
          iconBg="bg-emerald-100 text-emerald-700"
          accentBg="bg-emerald-500"
        />
        <StatCard
          label="ห้องเรียน"
          value={classroomCount.toString()}
          hint={currentYear ? "ในปีปัจจุบัน" : "ต้องมีปีปัจจุบัน"}
          href={isAdmin ? "/setup/classrooms" : undefined}
          icon={School}
          iconBg="bg-pink-100 text-pink-700"
          accentBg="bg-pink-500"
        />
      </section>

      {widgetReady && (
        <section className="mb-8">
          <Card padding={false} className="overflow-hidden">
            <div className="flex flex-wrap items-center gap-2 border-b border-zinc-200 bg-amber-50 px-4 py-2.5">
              <AlertTriangle
                className="h-4 w-4 text-amber-700"
                aria-hidden
              />
              <h3 className="text-sm font-semibold text-amber-900">
                ความคืบหน้าการประเมิน
              </h3>
              {currentYear && (
                <span className="text-xs text-amber-800">
                  · ภาคเรียนที่{" "}
                  <span className="font-mono">
                    {currentYear.current_semester}
                  </span>{" "}
                  · ปีการศึกษา{" "}
                  <span className="font-mono">{currentYear.year_be}</span>
                </span>
              )}
              <span className="ml-auto text-xs text-amber-700">
                คลิกแถวเพื่อดูรายห้อง
              </span>
            </div>
            <PendingEvalSection
              title="คุณลักษณะอันพึงประสงค์"
              icon={Heart}
              href="/setup/characteristics"
              stats={charsStats}
            />
            <PendingEvalSection
              title="การอ่าน คิด เขียน"
              icon={Brain}
              href="/setup/reading-thinking"
              stats={rtStats}
            />
            <PendingEvalSection
              title="สมรรถนะสำคัญ"
              icon={Activity}
              href="/setup/competency"
              stats={compStats}
            />
          </Card>
        </section>
      )}

      {isAdmin && currentYear && (
        <section className="mb-8 rounded-xl border border-blue-200 bg-blue-50 p-4">
          <h2 className="font-semibold text-blue-900">ความคืบหน้าการบันทึกเวลาเรียน</h2>
          <p className="mt-1 text-sm text-blue-800">ดูสรุปรายวันและรายวิชา ระบบจะโหลดข้อมูลเมื่อกดดูเท่านั้น</p>
          <Link
            href="/attendance-progress"
            prefetch={false}
            className="mt-3 inline-flex rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
          >
            ดูความคืบหน้าการบันทึกเวลาเรียน
          </Link>
        </section>
      )}
      {/* Version check streams independently of the dashboard. */}
      <Suspense fallback={null}>
        <VersionStatus />
      </Suspense>
    </>
  );
}
