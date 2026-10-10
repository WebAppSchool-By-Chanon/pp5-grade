/** Recording completion, not presence rate. Empty scopes are not 100%. */
export function recordingProgress(
  studentIds: string[],
  dueKeys: Iterable<string>,
  cells: Map<string, Map<string, unknown>>,
) {
  const students = new Set(studentIds);
  const keys = new Set(dueKeys);
  let filled = 0;
  for (const id of students) {
    for (const key of keys) {
      if (cells.get(id)?.get(key) != null) filled++;
    }
  }
  return { filled, expected: students.size * keys.size };
}

export function progressPercent(filled: number, expected: number) {
  if (expected === 0) return null;
  // Reserve 100% for genuinely complete scopes.
  return filled >= expected ? 100 : Math.floor(filled / expected * 100);
}
