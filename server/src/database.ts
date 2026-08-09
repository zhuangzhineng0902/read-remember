import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import type { DatabaseSync as DatabaseSyncType } from "node:sqlite";
import { articles, exams } from "../../client/src/data";

// Some bundlers do not yet recognize node:sqlite as a built-in module and
// rewrite it to a non-existent `sqlite` package. createRequire preserves the
// exact runtime specifier in production bundles.
const { DatabaseSync } = createRequire(import.meta.url)(
  "node:sqlite",
) as typeof import("node:sqlite");

export type AppDatabase = DatabaseSyncType;

export function createDatabase(filename: string): AppDatabase {
  if (filename !== ":memory:") {
    mkdirSync(path.dirname(filename), { recursive: true });
  }

  const db = new DatabaseSync(filename);
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS exams (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      subtitle TEXT NOT NULL,
      level TEXT NOT NULL,
      color TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS articles (
      id TEXT PRIMARY KEY,
      exam_id TEXT NOT NULL REFERENCES exams(id),
      year INTEGER NOT NULL,
      title TEXT NOT NULL,
      eyebrow TEXT NOT NULL,
      read_minutes INTEGER NOT NULL,
      difficulty INTEGER NOT NULL CHECK(difficulty BETWEEN 1 AND 5),
      paragraphs_json TEXT NOT NULL,
      questions_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      device_id TEXT NOT NULL UNIQUE,
      token TEXT NOT NULL UNIQUE,
      exam_id TEXT NOT NULL REFERENCES exams(id),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS deliveries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      article_id TEXT NOT NULL REFERENCES articles(id),
      delivery_date TEXT NOT NULL,
      slot INTEGER NOT NULL CHECK(slot BETWEEN 1 AND 3),
      delivered_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, delivery_date, slot),
      UNIQUE(user_id, article_id)
    );

    CREATE TABLE IF NOT EXISTS article_progress (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      article_id TEXT NOT NULL REFERENCES articles(id),
      answers_json TEXT NOT NULL,
      score INTEGER NOT NULL,
      total INTEGER NOT NULL,
      completed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY(user_id, article_id)
    );

    CREATE TABLE IF NOT EXISTS vocabulary (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      exam_id TEXT NOT NULL REFERENCES exams(id),
      word TEXT NOT NULL,
      phonetic TEXT NOT NULL,
      translation TEXT NOT NULL,
      article_id TEXT NOT NULL REFERENCES articles(id),
      saved_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY(user_id, exam_id, word)
    );

    CREATE TABLE IF NOT EXISTS article_sources (
      article_id TEXT PRIMARY KEY REFERENCES articles(id) ON DELETE CASCADE,
      source_name TEXT NOT NULL,
      source_url TEXT,
      external_id TEXT,
      license_note TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      synced_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(source_url, external_id)
    );

    CREATE TABLE IF NOT EXISTS push_batches (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      message TEXT NOT NULL,
      target_type TEXT NOT NULL CHECK(target_type IN ('all', 'selected')),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS push_items (
      batch_id TEXT NOT NULL REFERENCES push_batches(id) ON DELETE CASCADE,
      article_id TEXT NOT NULL REFERENCES articles(id),
      PRIMARY KEY(batch_id, article_id)
    );

    CREATE TABLE IF NOT EXISTS user_push_items (
      batch_id TEXT NOT NULL REFERENCES push_batches(id) ON DELETE CASCADE,
      article_id TEXT NOT NULL REFERENCES articles(id),
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      received_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      opened_at TEXT,
      PRIMARY KEY(batch_id, article_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS admin_audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      action TEXT NOT NULL,
      detail_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_articles_exam ON articles(exam_id);
    CREATE INDEX IF NOT EXISTS idx_deliveries_user_date ON deliveries(user_id, delivery_date);
    CREATE INDEX IF NOT EXISTS idx_vocabulary_user_exam ON vocabulary(user_id, exam_id, saved_at DESC);
    CREATE INDEX IF NOT EXISTS idx_user_push_user ON user_push_items(user_id, received_at DESC);
    CREATE INDEX IF NOT EXISTS idx_progress_completed ON article_progress(completed_at DESC);
  `);

  seedContent(db);
  return db;
}

function seedContent(db: AppDatabase) {
  const insertExam = db.prepare(`
    INSERT INTO exams(id, name, subtitle, level, color)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      subtitle = excluded.subtitle,
      level = excluded.level,
      color = excluded.color
  `);
  const insertArticle = db.prepare(`
    INSERT INTO articles(
      id, exam_id, year, title, eyebrow, read_minutes, difficulty,
      paragraphs_json, questions_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      exam_id = excluded.exam_id,
      year = excluded.year,
      title = excluded.title,
      eyebrow = excluded.eyebrow,
      read_minutes = excluded.read_minutes,
      difficulty = excluded.difficulty,
      paragraphs_json = excluded.paragraphs_json,
      questions_json = excluded.questions_json
  `);

  db.exec("BEGIN IMMEDIATE");
  try {
    for (const exam of exams) {
      insertExam.run(exam.id, exam.name, exam.subtitle, exam.level, exam.color);
    }
    for (const article of articles) {
      insertArticle.run(
        article.id,
        article.examId,
        article.year,
        article.title,
        article.eyebrow,
        article.readMinutes,
        article.difficulty,
        JSON.stringify(article.paragraphs),
        JSON.stringify(article.questions),
      );
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
