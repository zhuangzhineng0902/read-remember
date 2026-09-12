import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createDatabase } from "../src/database";
import { importArticles } from "../src/content-import";

test("story version and episode stay idempotent when the display title changes", () => {
  const db = createDatabase(":memory:");
  const article = (seriesTitle: string, title: string) => ({
    externalId: `legacy-${seriesTitle}-1`,
    year: 2026,
    title,
    eyebrow: "READING",
    readMinutes: 3,
    difficulty: 2,
    contentKind: "interest" as const,
    interestId: "tiger",
    seriesTitle,
    seriesKey: "stable-version",
    episodeNumber: 1,
    paragraphs: [`${title} has enough complete words to form a valid testing paragraph.`],
    questions: [{ prompt: "What happened?", options: ["A", "B"], answer: 0, explanation: "A happened." }],
  });
  const payload = (seriesTitle: string, title: string) => ({
    examId: "middle" as const,
    sourceName: "Test story source",
    sourceUrl: null,
    licenseNote: "Original test content with confirmed rights.",
    rightsConfirmed: true as const,
    articles: [article(seriesTitle, title)],
  });
  const first = importArticles(db, payload("Old Name", "First Draft"));
  const second = importArticles(db, payload("New Name", "Revised Draft"));
  assert.deepEqual(second, first);
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM articles WHERE series_key = 'stable-version'").get() as { n: number }).n, 1);
  const saved = db.prepare("SELECT title, series_title AS seriesTitle FROM articles WHERE id = ?").get(first[0]) as { title: string; seriesTitle: string };
  assert.equal(saved.title, "Revised Draft");
  assert.equal(saved.seriesTitle, "New Name");
  db.close();
});

test("database migration separates renamed story versions without deleting articles or progress", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "read-remember-series-version-"));
  const filename = path.join(directory, "story.sqlite");
  const requestId = "story-version-1";
  try {
    const db = createDatabase(filename);
    db.exec("DROP INDEX idx_articles_story_version_episode");
    db.prepare("INSERT INTO users(id, device_id, token, exam_id) VALUES ('u', 'd', 't', 'middle')").run();
    db.prepare(
      `INSERT INTO custom_story_requests(id, user_id, exam_id, status, idea, episode_count, series_title, article_ids_json)
       VALUES (?, 'u', 'middle', 'failed', 'wolves', 3, 'New Story', '["old-1","old-2","new-1"]')`,
    ).run(requestId);
    const insert = db.prepare(
      `INSERT INTO articles(id, exam_id, year, title, eyebrow, read_minutes, difficulty,
       content_kind, interest_id, series_title, series_key, episode_number, paragraphs_json, questions_json)
       VALUES (?, 'middle', 2026, ?, 'READING', 3, 2, 'interest', 'custom-story', ?, ?, ?, '["A complete paragraph for testing."]', '[{"prompt":"Question?","options":["A","B"],"answer":0,"explanation":"A"}]')`,
    );
    insert.run("old-1", "Old One", "Old Story", requestId, 1);
    insert.run("old-2", "Old Two", "Old Story", requestId, 2);
    insert.run("new-1", "New One", "New Story", requestId, 1);
    db.prepare("INSERT INTO article_progress(user_id, article_id, answers_json, score, total) VALUES ('u', 'old-1', '[]', 1, 1)").run();
    db.close();

    const migrated = createDatabase(filename);
    const rows = migrated.prepare(
      "SELECT id, series_key AS seriesKey FROM articles WHERE id IN ('old-1','old-2','new-1') ORDER BY id",
    ).all() as Array<{ id: string; seriesKey: string }>;
    assert.equal(rows.length, 3);
    assert.equal(rows.find((row) => row.id === "new-1")?.seriesKey, requestId);
    const oldKeys = rows.filter((row) => row.id.startsWith("old-")).map((row) => row.seriesKey);
    assert.equal(new Set(oldKeys).size, 1);
    assert.match(oldKeys[0], /^story-version-1:legacy:/);
    assert.equal(
      (migrated.prepare("SELECT article_ids_json AS ids FROM custom_story_requests WHERE id = ?").get(requestId) as { ids: string }).ids,
      '["new-1"]',
    );
    assert.equal((migrated.prepare("SELECT COUNT(*) AS n FROM article_progress WHERE article_id = 'old-1'").get() as { n: number }).n, 1);
    assert.throws(
      () => migrated.prepare("UPDATE articles SET series_key = ? WHERE id = 'old-1'").run(requestId),
      /UNIQUE constraint failed/,
    );
    migrated.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
