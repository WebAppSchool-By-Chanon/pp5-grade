import assert from "node:assert/strict";
import test from "node:test";
import { numericCoverResult } from "./pp5-subject-cover.ts";

test("ร overrides passing numeric grade and counts as failed only", () => {
  assert.deepEqual(numericCoverResult(1, { is_incomplete: true, is_no_eligibility: false }), { bucket: "rr", passed: false });
  assert.deepEqual(numericCoverResult(4, { is_incomplete: true, is_no_eligibility: false }), { bucket: "rr", passed: false });
});
test("มส overrides grade, including conflicting legacy flags", () => {
  assert.deepEqual(numericCoverResult(3, { is_incomplete: false, is_no_eligibility: true }), { bucket: "ms", passed: false });
  assert.deepEqual(numericCoverResult(3, { is_incomplete: true, is_no_eligibility: true }), { bucket: "ms", passed: false });
});
test("every grade 1–4 passes, grade zero fails, cleared status restores grade", () => {
  for (const grade of [1, 1.5, 2, 2.5, 3, 3.5, 4]) assert.equal(numericCoverResult(grade).passed, true);
  assert.deepEqual(numericCoverResult(0), { bucket: "g0", passed: false });
  assert.deepEqual(numericCoverResult(1, { is_incomplete: false, is_no_eligibility: false }), { bucket: "g1", passed: true });
});
test("mixed roster counts each student once: pass + fail equals roster size", () => {
  const outcomes = [numericCoverResult(4), numericCoverResult(1), numericCoverResult(0), numericCoverResult(1, { is_incomplete: true, is_no_eligibility: false }), numericCoverResult(4, { is_incomplete: false, is_no_eligibility: true })];
  assert.equal(outcomes.filter(r => r.passed).length, 2);
  assert.equal(outcomes.filter(r => !r.passed).length, 3);
  assert.deepEqual(outcomes.map(r => r.bucket), ["g4", "g1", "g0", "rr", "ms"]);
});
