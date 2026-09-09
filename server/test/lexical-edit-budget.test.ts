import assert from "node:assert/strict";
import test from "node:test";
import { lexicalEditDriftIssues, lexicalEditWordBudget } from "../scripts/story-generation/edit-guards";

function narrative(words: number) {
  return { title: "Same story", paragraphs: Array.from({ length: 4 }, (_, index) =>
    Array.from({ length: Math.floor(words / 4) + (index < words % 4 ? 1 : 0) }, () => "friend").join(" ")) };
}

test("small explanatory expansion is accepted without weakening deletion protection", () => {
  for (const [original, edited] of [[244, 251], [288, 299]]) {
    const budget = lexicalEditWordBudget(original, 180, 310);
    assert.deepEqual(lexicalEditDriftIssues(narrative(original), narrative(edited), budget), []);
    assert.ok(lexicalEditDriftIssues(narrative(original), narrative(original - 20), budget).length);
  }
});

test("expansion still obeys both a relative bound and the publication cap", () => {
  assert.equal(lexicalEditWordBudget(305, 180, 310).maximumAdded, 5);
  assert.equal(lexicalEditWordBudget(310, 180, 310).maximumAdded, 0);
  assert.equal(lexicalEditWordBudget(180, 180, 310).maximumRemoved, 0);
  const budget = lexicalEditWordBudget(288, 180, 310);
  assert.ok(lexicalEditDriftIssues(narrative(288), narrative(311), budget).length);
  assert.ok(lexicalEditDriftIssues(narrative(288), narrative(53), budget).length);
});

test("allowing extra words does not disable paragraph drift detection", () => {
  const original = narrative(244);
  const changed = { title: original.title, paragraphs: Array(4).fill("Different events replace every original action with a brand new adventure.") };
  assert.match(lexicalEditDriftIssues(original, changed, lexicalEditWordBudget(244, 180, 310)).join(" "), /超出局部换词范围/);
});
