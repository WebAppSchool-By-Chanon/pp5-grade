export function numericCoverResult(
  grade: number,
  status?: { is_incomplete: boolean | null; is_no_eligibility: boolean | null },
) {
  if (status?.is_no_eligibility) return { bucket: "ms", passed: false } as const;
  if (status?.is_incomplete) return { bucket: "rr", passed: false } as const;
  const buckets = { 4: "g4", 3.5: "g35", 3: "g3", 2.5: "g25", 2: "g2", 1.5: "g15", 1: "g1", 0: "g0" } as const;
  const bucket = buckets[grade as keyof typeof buckets] ?? "g0";
  return { bucket, passed: grade >= 1 && grade <= 4 };
}
