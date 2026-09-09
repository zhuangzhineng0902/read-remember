import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { EcdictDictionary } from "../src/ecdict";

test("writing bank uses frequency and exact vocabulary tags, not arbitrary easy-word guesses", () => {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE stardict(word TEXT, frq INTEGER, bnc INTEGER, tag TEXT, exchange TEXT)");
  const insert = db.prepare("INSERT INTO stardict VALUES (?, ?, ?, ?, NULL)");
  for (const row of [
    ["move", 100, 0, ""], ["floor", 4000, 5000, "zk gk"],
    ["hubcap", 19000, 0, "gk"], ["wrong", 4000, 0, "notzk"],
    ["space", 0, 400, ""], ["two words", 100, 0, "zk"],
  ] as const) insert.run(...row);
  const dictionary = new EcdictDictionary(db, ":memory:");
  try {
    const bank = dictionary.familiarWordBank(1200, ["zk"]);
    assert.deepEqual(new Set(bank), new Set(["move", "floor", "space"]));
    assert.equal(dictionary.familiarWordBank(1200, ["zk"], 1).length, 1);
    for (const word of bank) assert.ok((dictionary.frequencyRank(word) ?? Infinity) <= 1200 || dictionary.hasVocabularyTag(word, ["zk"]));
  } finally { dictionary.close(); }
});
