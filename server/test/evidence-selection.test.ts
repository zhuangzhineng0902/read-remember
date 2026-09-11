import assert from "node:assert/strict";
import test from "node:test";
import { evidenceCandidates, evidenceSelectionSchema, phraseQuoteSchema, passageQuoteSchema } from "../scripts/story-generation/evidence-selection";

test("all candidate quotes are original bounded spans including dialogue punctuation", () => {
  const paragraphs = ['“Wait, I can help!” she said. He stopped; then they lifted the box together.', 'Long words and small words '.repeat(40)];
  for (const phrase of [true, false]) {
    const candidates = evidenceCandidates(paragraphs, phrase);
    assert.ok(candidates.length > 0);
    for (const candidate of candidates) {
      assert.ok(paragraphs[candidate.paragraph - 1].includes(candidate.quote));
      assert.ok((phrase ? phraseQuoteSchema : passageQuoteSchema).safeParse(candidate.quote).success);
    }
    assert.equal(new Set(candidates.map((item) => item.quote)).size, candidates.length);
  }
});

test("selection validates field and candidate identity, accepts numeric strings and explicit absence", () => {
  const choices = [evidenceCandidates(['They carried the box home.'], false), evidenceCandidates(['Hold on!'], true)];
  const schema = evidenceSelectionSchema(choices);
  assert.equal(schema.parse({ replacements: [{ index: "0", candidateId: "0" }, { index: 1, candidateId: null }] }).replacements[0].candidateId, 0);
  for (const replacements of [
    [{ index: 0, candidateId: 0 }],
    [{ index: 0, candidateId: 0 }, { index: 0, candidateId: 0 }],
    [{ index: 0, candidateId: 99999 }, { index: 1, candidateId: 0 }],
    [{ index: 0, quote: "invented" }, { index: 1, candidateId: 0 }],
    [{ index: 0, candidateId: true }, { index: 1, candidateId: 0 }],
  ]) assert.equal(schema.safeParse({ replacements }).success, false);
});

test("short idioms use their own limits and no candidates are fabricated", () => {
  assert.ok(evidenceCandidates(['Hold on!'], true).some((item) => item.quote === 'Hold on!'));
  assert.deepEqual(evidenceCandidates(['a'], false), []);
  assert.equal(phraseQuoteSchema.safeParse('x'.repeat(101)).success, false);
  assert.equal(passageQuoteSchema.safeParse('x'.repeat(301)).success, false);
});
