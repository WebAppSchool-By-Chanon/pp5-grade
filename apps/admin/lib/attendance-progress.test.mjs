import assert from "node:assert/strict";
import test from "node:test";
import { recordingProgress, progressPercent } from "./attendance-progress.ts";

test("all statuses count as recorded; future and unenrolled cells do not", () => {
  const cells = new Map([
    ["a", new Map([["today", "absent"], ["future", "present"]])],
    ["b", new Map([["today", "leave"]])],
    ["old", new Map([["today", "present"]])],
  ]);
  assert.deepEqual(recordingProgress(["a", "b", "c"], ["today"], cells), { filled: 2, expected: 3 });
});
test("empty scopes are not complete; missing cells cannot round up to 100%", () => {
  assert.equal(progressPercent(0, 0), null);
  assert.equal(progressPercent(999, 1000), 99);
  assert.equal(progressPercent(1000, 1000), 100);
});
test("deduplicates students and sessions; uses effective inherited or manual cells", () => {
  const cells = new Map([["a", new Map([["1|1", "present"], ["1|2", "leave"]])]]);
  assert.deepEqual(recordingProgress(["a", "a"], ["1|1", "1|1", "1|2"], cells), { filled: 2, expected: 2 });
});
