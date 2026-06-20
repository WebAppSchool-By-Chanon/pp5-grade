import { createAdminClient } from "@pp5/database/admin";

/**
 * Shared classroom-renumbering helper.
 *
 * SINGLE source of truth for assigning student_number within a classroom.
 * Every flow that adds/removes/moves an enrollment (create, re-enroll, edit,
 * import-from-previous, Excel import, delete) calls THIS — so the ordering
 * stays consistent everywhere.
 *
 * The ordering mode is read from `classrooms.number_mode` so callers never
 * have to pass it. To CHANGE the mode (the "เรียงเลขที่ใหม่" pill selector),
 * write `classrooms.number_mode` first, then call this.
 */

/**
 * How to order student numbers within a classroom.
 *   'code'         — by student_code only (original behaviour)
 *   'male_first'   — boys (เด็กชาย/นาย/ด.ช.) before girls, then by code
 *   'female_first' — girls before boys, then by code
 */
export type NumberMode = "code" | "male_first" | "female_first";

const MALE_TITLES = ["เด็กชาย", "ด.ช.", "นาย"];
const FEMALE_TITLES = ["เด็กหญิง", "ด.ญ.", "นางสาว", "นาง"];

function genderOrder(
  title: string | null,
  mode: "male_first" | "female_first",
): number {
  const t = title ?? "";
  const isMale = MALE_TITLES.some((p) => t.startsWith(p));
  const isFemale = FEMALE_TITLES.some((p) => t.startsWith(p));
  if (mode === "male_first") return isMale ? 0 : isFemale ? 1 : 2;
  return isFemale ? 0 : isMale ? 1 : 2;
}

/**
 * Re-number student_number sequentially (1, 2, 3, …) in a classroom,
 * ordered per the classroom's saved `number_mode`.
 *
 * @param semester  When provided, scope to a single semester (primary = 0,
 *                  secondary = 1|2). When omitted, renumber the whole room
 *                  across all semesters (used by the delete flow, which
 *                  doesn't track which semester an enrollment belonged to).
 *
 * 2-phase update avoids UNIQUE(classroom_id, student_number) conflicts:
 *   Phase 1: negative temps  (-1, -2, …)
 *   Phase 2: final positives ( 1,  2, …)
 */
export async function renumberClassroom(
  admin: ReturnType<typeof createAdminClient>,
  classroomId: string,
  semester?: 0 | 1 | 2,
) {
  // Read the saved ordering mode for this classroom
  const { data: room } = await admin
    .from("classrooms")
    .select("number_mode")
    .eq("id", classroomId)
    .maybeSingle();
  const mode = (room?.number_mode ?? "code") as NumberMode;

  let query = admin
    .from("enrollments")
    .select("id, student:students!student_id (student_code, title)")
    .eq("classroom_id", classroomId);
  if (semester !== undefined) {
    query = query.eq("semester", semester);
  }
  const { data: enrollments, error } = await query;
  if (error || !enrollments) return;

  const sorted = enrollments
    .filter((e) => e.student?.student_code)
    .sort((a, b) => {
      if (mode !== "code") {
        const ga = genderOrder(a.student!.title ?? null, mode);
        const gb = genderOrder(b.student!.title ?? null, mode);
        if (ga !== gb) return ga - gb;
      }
      return a.student!.student_code.localeCompare(
        b.student!.student_code,
        "th",
      );
    });

  // Phase 1: temp negative values (guaranteed unique within the scope)
  for (let i = 0; i < sorted.length; i++) {
    await admin
      .from("enrollments")
      .update({ student_number: -(i + 1) })
      .eq("id", sorted[i].id);
  }
  // Phase 2: final positive values
  for (let i = 0; i < sorted.length; i++) {
    await admin
      .from("enrollments")
      .update({ student_number: i + 1 })
      .eq("id", sorted[i].id);
  }
}
