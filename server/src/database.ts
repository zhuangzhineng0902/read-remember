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
      username TEXT,
      password_hash TEXT,
      display_name TEXT NOT NULL DEFAULT '阅读学习者',
      email TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS deliveries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      article_id TEXT NOT NULL REFERENCES articles(id),
      exam_id TEXT NOT NULL REFERENCES exams(id),
      delivery_date TEXT NOT NULL,
      slot INTEGER NOT NULL CHECK(slot BETWEEN 1 AND 10),
      delivered_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, delivery_date, exam_id, slot),
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

    CREATE TABLE IF NOT EXISTS article_answer_states (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      article_id TEXT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
      answers_json TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY(user_id, article_id)
    );

    CREATE TABLE IF NOT EXISTS user_preferences (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      learning_json TEXT NOT NULL DEFAULT '{}',
      reader_json TEXT NOT NULL DEFAULT '{}',
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS article_reading_states (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      article_id TEXT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
      offset_y REAL NOT NULL DEFAULT 0,
      ratio REAL NOT NULL DEFAULT 0,
      reading_seconds INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY(user_id, article_id)
    );

    CREATE TABLE IF NOT EXISTS article_attempts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      article_id TEXT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
      answers_json TEXT NOT NULL,
      score INTEGER NOT NULL,
      total INTEGER NOT NULL,
      completed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS vocabulary (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      exam_id TEXT NOT NULL REFERENCES exams(id),
      word TEXT NOT NULL,
      phonetic TEXT NOT NULL,
      translation TEXT NOT NULL,
      definition_en TEXT NOT NULL DEFAULT '',
      part_of_speech TEXT NOT NULL DEFAULT '',
      example_en TEXT NOT NULL DEFAULT '',
      example_zh TEXT NOT NULL DEFAULT '',
      article_id TEXT NOT NULL REFERENCES articles(id),
      saved_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      memory_stage INTEGER NOT NULL DEFAULT 0,
      next_review_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      last_reviewed_at TEXT,
      review_count INTEGER NOT NULL DEFAULT 0,
      lapse_count INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY(user_id, exam_id, word)
    );

    CREATE TABLE IF NOT EXISTS pronunciation_cache (
      word TEXT NOT NULL,
      accent TEXT NOT NULL CHECK(accent IN ('us', 'uk')),
      phonetic TEXT NOT NULL DEFAULT '',
      actual_accent TEXT,
      source_url TEXT,
      license_name TEXT,
      license_url TEXT,
      audio_mime TEXT,
      audio_blob BLOB,
      status TEXT NOT NULL CHECK(status IN ('ready', 'tts_only')),
      definition_en TEXT NOT NULL DEFAULT '',
      translation_zh TEXT NOT NULL DEFAULT '',
      part_of_speech TEXT NOT NULL DEFAULT '',
      example_en TEXT NOT NULL DEFAULT '',
      example_zh TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY(word, accent)
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

    CREATE TABLE IF NOT EXISTS daily_auto_pushes (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      delivery_date TEXT NOT NULL,
      batch_id TEXT NOT NULL REFERENCES push_batches(id) ON DELETE CASCADE,
      article_id TEXT NOT NULL REFERENCES articles(id),
      exam_id TEXT NOT NULL REFERENCES exams(id),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY(user_id, delivery_date),
      UNIQUE(user_id, article_id)
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
    CREATE INDEX IF NOT EXISTS idx_pronunciation_updated ON pronunciation_cache(updated_at);
    CREATE INDEX IF NOT EXISTS idx_user_push_user ON user_push_items(user_id, received_at DESC);
    CREATE INDEX IF NOT EXISTS idx_daily_auto_push_date ON daily_auto_pushes(delivery_date);
    CREATE INDEX IF NOT EXISTS idx_progress_completed ON article_progress(completed_at DESC);
    CREATE INDEX IF NOT EXISTS idx_answer_states_updated ON article_answer_states(updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_reading_states_updated ON article_reading_states(updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_attempts_user_completed ON article_attempts(user_id, completed_at DESC);
  `);

  // CREATE TABLE IF NOT EXISTS does not add columns to an existing local DB.
  // Keep these additive migrations safe for projects upgraded in place.
  const ensureColumn = (table: string, column: string, sql: string) => {
    const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{
      name: string;
    }>;
    if (!columns.some((item) => item.name === column)) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${sql}`);
    }
  };
  ensureColumn("pronunciation_cache", "definition_en", "definition_en TEXT NOT NULL DEFAULT ''");
  ensureColumn("pronunciation_cache", "translation_zh", "translation_zh TEXT NOT NULL DEFAULT ''");
  ensureColumn("pronunciation_cache", "part_of_speech", "part_of_speech TEXT NOT NULL DEFAULT ''");
  ensureColumn("pronunciation_cache", "example_en", "example_en TEXT NOT NULL DEFAULT ''");
  ensureColumn("pronunciation_cache", "example_zh", "example_zh TEXT NOT NULL DEFAULT ''");
  ensureColumn("vocabulary", "definition_en", "definition_en TEXT NOT NULL DEFAULT ''");
  ensureColumn("vocabulary", "part_of_speech", "part_of_speech TEXT NOT NULL DEFAULT ''");
  ensureColumn("vocabulary", "example_en", "example_en TEXT NOT NULL DEFAULT ''");
  ensureColumn("vocabulary", "example_zh", "example_zh TEXT NOT NULL DEFAULT ''");
  ensureColumn("vocabulary", "memory_stage", "memory_stage INTEGER NOT NULL DEFAULT 0");
  ensureColumn("vocabulary", "next_review_at", "next_review_at TEXT NOT NULL DEFAULT ''");
  ensureColumn("vocabulary", "last_reviewed_at", "last_reviewed_at TEXT");
  ensureColumn("vocabulary", "review_count", "review_count INTEGER NOT NULL DEFAULT 0");
  ensureColumn("vocabulary", "lapse_count", "lapse_count INTEGER NOT NULL DEFAULT 0");
  ensureColumn("users", "username", "username TEXT");
  ensureColumn("users", "password_hash", "password_hash TEXT");
  ensureColumn(
    "users",
    "display_name",
    "display_name TEXT NOT NULL DEFAULT '阅读学习者'",
  );
  ensureColumn("users", "email", "email TEXT NOT NULL DEFAULT ''");

  const deliveryColumns = db.prepare("PRAGMA table_info(deliveries)").all() as Array<{
    name: string;
  }>;
  if (!deliveryColumns.some((item) => item.name === "exam_id")) {
    db.exec(`
      ALTER TABLE deliveries RENAME TO deliveries_legacy;
      CREATE TABLE deliveries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        article_id TEXT NOT NULL REFERENCES articles(id),
        exam_id TEXT NOT NULL REFERENCES exams(id),
        delivery_date TEXT NOT NULL,
        slot INTEGER NOT NULL CHECK(slot BETWEEN 1 AND 10),
        delivered_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, delivery_date, exam_id, slot),
        UNIQUE(user_id, article_id)
      );
      INSERT INTO deliveries(
        id, user_id, article_id, exam_id, delivery_date, slot, delivered_at
      )
      SELECT d.id, d.user_id, d.article_id, a.exam_id,
        d.delivery_date, d.slot, d.delivered_at
      FROM deliveries_legacy d
      JOIN articles a ON a.id = d.article_id;
      DROP TABLE deliveries_legacy;
    `);
  }
  const deliveryTable = db
    .prepare(
      "SELECT sql FROM sqlite_schema WHERE type = 'table' AND name = 'deliveries'",
    )
    .get() as { sql: string } | undefined;
  if (
    deliveryTable?.sql.match(
      /slot\s+INTEGER\s+NOT\s+NULL\s+CHECK\s*\(slot\s+BETWEEN\s+1\s+AND\s+3\)/i,
    )
  ) {
    db.exec(`
      ALTER TABLE deliveries RENAME TO deliveries_goal_legacy;
      CREATE TABLE deliveries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        article_id TEXT NOT NULL REFERENCES articles(id),
        exam_id TEXT NOT NULL REFERENCES exams(id),
        delivery_date TEXT NOT NULL,
        slot INTEGER NOT NULL CHECK(slot BETWEEN 1 AND 10),
        delivered_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, delivery_date, exam_id, slot),
        UNIQUE(user_id, article_id)
      );
      INSERT INTO deliveries(
        id, user_id, article_id, exam_id, delivery_date, slot, delivered_at
      )
      SELECT id, user_id, article_id, exam_id, delivery_date, slot, delivered_at
      FROM deliveries_goal_legacy;
      DROP TABLE deliveries_goal_legacy;
    `);
  }
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username
    ON users(username COLLATE NOCASE)
    WHERE username IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_deliveries_user_date_exam
    ON deliveries(user_id, delivery_date, exam_id);
  `);
  db.exec(`
    UPDATE vocabulary
    SET next_review_at = saved_at
    WHERE next_review_at = '' OR next_review_at IS NULL
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
