import assert from "node:assert/strict";
import test from "node:test";
import { chooseRepairKind, canAttemptRepair, localRepairAttemptsSchema, lexicalFloorPassed } from "../scripts/story-generation/repair-routing";

const mixed = { wordCount: 276, lexicalCoverage: 0.88, blockingIssues: ["五感描写证据未逐字出现在正文"] };
test("mixed lexical and metadata defects fix prose first, then derived evidence", () => {
  assert.equal(chooseRepairKind(mixed, 0.95), "lexical");
  assert.equal(chooseRepairKind({ ...mixed, lexicalCoverage: 0.94 }, 0.95), "metadata");
  assert.equal(chooseRepairKind({ ...mixed, lexicalCoverage: 0.94, blockingIssues: [] }, 0.95), "none");
  assert.equal(chooseRepairKind({ ...mixed, blockingIssues: ["正文过长"] }, 0.95), "narrative");
});
test("local repairs do not depend on exhausted full rewrite budget and remain bounded after restart", () => {
  const attempts = { metadata: 0, lexical: 0 };
  assert.ok(canAttemptRepair("lexical", attempts, 4));
  assert.ok(canAttemptRepair("metadata", attempts, 4));
  assert.equal(canAttemptRepair("narrative", attempts, 4), false);
  attempts.lexical++;
  const restored = localRepairAttemptsSchema.parse(JSON.parse(JSON.stringify(attempts)));
  assert.equal(canAttemptRepair("lexical", restored, 0), false);
  assert.ok(canAttemptRepair("metadata", restored, 4));
  restored.metadata++;
  assert.equal(canAttemptRepair("metadata", restored, 0), false);
});
test("repair routing uses exactly the publication lexical floor and tolerance", () => {
  assert.equal(lexicalFloorPassed(mixed, 0.95), false);
  assert.equal(lexicalFloorPassed({ ...mixed, lexicalCoverage: 0.897 }, 0.95), true);
  assert.equal(chooseRepairKind({ ...mixed, lexicalCoverage: null }, 0.95), "metadata");
});
