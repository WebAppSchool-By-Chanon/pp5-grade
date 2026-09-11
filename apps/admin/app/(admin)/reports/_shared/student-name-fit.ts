/**
 * Keep short student names at the normal readable size, while giving long
 * Thai names progressively smaller classes so they fit the fixed-width
 * attendance table without being replaced by an ellipsis.
 */
export function attendanceStudentNameClass(label?: string | null): string {
  const length = Array.from((label ?? "").trim()).length;

  if (length >= 28) return "att-name att-name--xlong";
  if (length >= 22) return "att-name att-name--long";
  return "att-name";
}
