import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import type { DatabaseSync as DatabaseSyncType } from "node:sqlite";
import { articles, exams } from "../../client/src/data";
import {
  interestCategories,
  interestSourceGuides,
} from "../../client/src/interest-data";
import { contentFingerprint } from "./content-fingerprint";

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

    CREATE TABLE IF NOT EXISTS interest_categories (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      subtitle TEXT NOT NULL,
      emoji TEXT NOT NULL,
      color TEXT NOT NULL,
      activity_prompt TEXT NOT NULL,
      story_prompt TEXT NOT NULL DEFAULT '',
      built_in INTEGER NOT NULL DEFAULT 0 CHECK(built_in IN (0, 1)),
      active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0, 1)),
      sort_order INTEGER NOT NULL DEFAULT 1000,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS articles (
      id TEXT PRIMARY KEY,
      exam_id TEXT NOT NULL REFERENCES exams(id),
      year INTEGER NOT NULL,
      title TEXT NOT NULL,
      eyebrow TEXT NOT NULL,
      read_minutes INTEGER NOT NULL,
      difficulty INTEGER NOT NULL CHECK(difficulty BETWEEN 1 AND 5),
      content_kind TEXT NOT NULL DEFAULT 'exam' CHECK(content_kind IN ('exam', 'interest')),
      interest_id TEXT,
      series_title TEXT,
      episode_number INTEGER,
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
      UNIQUE(user_id, delivery_date, exam_id, slot)
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
      interests_json TEXT NOT NULL DEFAULT '[]',
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
      lexical_source TEXT NOT NULL DEFAULT '',
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

    CREATE TABLE IF NOT EXISTS translation_segments (
      source_hash TEXT NOT NULL,
      target_language TEXT NOT NULL,
      segment_kind TEXT NOT NULL CHECK(segment_kind IN ('title', 'paragraph')),
      source_text TEXT NOT NULL,
      translated_text TEXT NOT NULL,
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      translation_policy TEXT NOT NULL DEFAULT 'legacy',
      translated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY(source_hash, target_language)
    );

    CREATE TABLE IF NOT EXISTS article_translations (
      article_id TEXT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
      target_language TEXT NOT NULL,
      source_hash TEXT NOT NULL,
      translated_title TEXT NOT NULL,
      translated_paragraphs_json TEXT NOT NULL,
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      translation_policy TEXT NOT NULL DEFAULT 'legacy',
      quality_score REAL NOT NULL DEFAULT 0,
      reviewed INTEGER NOT NULL DEFAULT 0,
      quality_issues_json TEXT NOT NULL DEFAULT '[]',
      translated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY(article_id, target_language)
    );

    CREATE TABLE IF NOT EXISTS phrase_translation_cache (
      source_hash TEXT NOT NULL,
      context_hash TEXT NOT NULL,
      target_language TEXT NOT NULL,
      source_text TEXT NOT NULL,
      context_text TEXT NOT NULL,
      translated_text TEXT NOT NULL,
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      translated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY(source_hash, context_hash, target_language)
    );

    CREATE TABLE IF NOT EXISTS article_audio_cache (
      article_id TEXT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
      voice TEXT NOT NULL,
      source_hash TEXT NOT NULL,
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      format TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      filename TEXT NOT NULL,
      public_token TEXT NOT NULL UNIQUE,
      byte_size INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY(article_id, voice)
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

    CREATE TABLE IF NOT EXISTS interest_deliveries (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      article_id TEXT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
      delivery_date TEXT NOT NULL,
      opened_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY(user_id, article_id)
    );

    CREATE TABLE IF NOT EXISTS daily_choices (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      delivery_date TEXT NOT NULL,
      exam_id TEXT NOT NULL REFERENCES exams(id),
      article_id TEXT NOT NULL REFERENCES articles(id),
      selected_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY(user_id, delivery_date, exam_id)
    );

    CREATE TABLE IF NOT EXISTS admin_audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      action TEXT NOT NULL,
      detail_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_articles_exam ON articles(exam_id);
    CREATE INDEX IF NOT EXISTS idx_interest_categories_active ON interest_categories(active, created_at);
    CREATE INDEX IF NOT EXISTS idx_deliveries_user_date ON deliveries(user_id, delivery_date);
    CREATE INDEX IF NOT EXISTS idx_vocabulary_user_exam ON vocabulary(user_id, exam_id, saved_at DESC);
    CREATE INDEX IF NOT EXISTS idx_pronunciation_updated ON pronunciation_cache(updated_at);
    CREATE INDEX IF NOT EXISTS idx_user_push_user ON user_push_items(user_id, received_at DESC);
    CREATE INDEX IF NOT EXISTS idx_daily_auto_push_date ON daily_auto_pushes(delivery_date);
    CREATE INDEX IF NOT EXISTS idx_interest_deliveries_user_date ON interest_deliveries(user_id, delivery_date DESC);
    CREATE INDEX IF NOT EXISTS idx_daily_choices_user_date ON daily_choices(user_id, delivery_date DESC);
    CREATE INDEX IF NOT EXISTS idx_article_sources_content_hash ON article_sources(content_hash);
    CREATE INDEX IF NOT EXISTS idx_translation_segments_language ON translation_segments(target_language, translated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_article_translations_language ON article_translations(target_language, translated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_phrase_translation_source ON phrase_translation_cache(source_hash, translated_at DESC);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_article_audio_public_token ON article_audio_cache(public_token);
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
  ensureColumn("pronunciation_cache", "lexical_source", "lexical_source TEXT NOT NULL DEFAULT ''");
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
  ensureColumn("articles", "content_kind", "content_kind TEXT NOT NULL DEFAULT 'exam'");
  ensureColumn("articles", "interest_id", "interest_id TEXT");
  ensureColumn("articles", "series_title", "series_title TEXT");
  ensureColumn("articles", "episode_number", "episode_number INTEGER");
  ensureColumn(
    "translation_segments",
    "translation_policy",
    "translation_policy TEXT NOT NULL DEFAULT 'legacy'",
  );
  ensureColumn(
    "article_translations",
    "translation_policy",
    "translation_policy TEXT NOT NULL DEFAULT 'legacy'",
  );
  ensureColumn(
    "article_translations",
    "quality_score",
    "quality_score REAL NOT NULL DEFAULT 0",
  );
  ensureColumn(
    "article_translations",
    "reviewed",
    "reviewed INTEGER NOT NULL DEFAULT 0",
  );
  ensureColumn(
    "article_translations",
    "quality_issues_json",
    "quality_issues_json TEXT NOT NULL DEFAULT '[]'",
  );
  ensureColumn("user_preferences", "interests_json", "interests_json TEXT NOT NULL DEFAULT '[]'");
  ensureColumn("interest_categories", "story_prompt", "story_prompt TEXT NOT NULL DEFAULT ''");
  ensureColumn("interest_categories", "built_in", "built_in INTEGER NOT NULL DEFAULT 0");
  ensureColumn("interest_categories", "active", "active INTEGER NOT NULL DEFAULT 1");
  ensureColumn("interest_categories", "sort_order", "sort_order INTEGER NOT NULL DEFAULT 1000");
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_articles_interest
    ON articles(content_kind, interest_id, exam_id);
  `);

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
        UNIQUE(user_id, delivery_date, exam_id, slot)
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
        UNIQUE(user_id, delivery_date, exam_id, slot)
      );
      INSERT INTO deliveries(
        id, user_id, article_id, exam_id, delivery_date, slot, delivered_at
      )
      SELECT id, user_id, article_id, exam_id, delivery_date, slot, delivered_at
      FROM deliveries_goal_legacy;
      DROP TABLE deliveries_goal_legacy;
    `);
  }
  const deliveryRepeatConstraint = db
    .prepare(
      "SELECT sql FROM sqlite_schema WHERE type = 'table' AND name = 'deliveries'",
    )
    .get() as { sql: string } | undefined;
  if (
    deliveryRepeatConstraint?.sql.match(
      /UNIQUE\s*\(\s*user_id\s*,\s*article_id\s*\)/i,
    )
  ) {
    db.exec(`
      ALTER TABLE deliveries RENAME TO deliveries_repeat_legacy;
      CREATE TABLE deliveries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        article_id TEXT NOT NULL REFERENCES articles(id),
        exam_id TEXT NOT NULL REFERENCES exams(id),
        delivery_date TEXT NOT NULL,
        slot INTEGER NOT NULL CHECK(slot BETWEEN 1 AND 10),
        delivered_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, delivery_date, exam_id, slot)
      );
      INSERT INTO deliveries(
        id, user_id, article_id, exam_id, delivery_date, slot, delivered_at
      )
      SELECT id, user_id, article_id, exam_id, delivery_date, slot, delivered_at
      FROM deliveries_repeat_legacy;
      DROP TABLE deliveries_repeat_legacy;
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
      content_kind, interest_id, series_title, episode_number,
      paragraphs_json, questions_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      exam_id = excluded.exam_id,
      year = excluded.year,
      title = excluded.title,
      eyebrow = excluded.eyebrow,
      read_minutes = excluded.read_minutes,
      difficulty = excluded.difficulty,
      content_kind = excluded.content_kind,
      interest_id = excluded.interest_id,
      series_title = excluded.series_title,
      episode_number = excluded.episode_number,
      paragraphs_json = excluded.paragraphs_json,
      questions_json = excluded.questions_json
  `);
  const insertInterest = db.prepare(`
    INSERT INTO interest_categories(
      id, name, subtitle, emoji, color, activity_prompt, story_prompt,
      built_in, sort_order
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      subtitle = excluded.subtitle,
      emoji = excluded.emoji,
      color = excluded.color,
      activity_prompt = excluded.activity_prompt,
      built_in = 1,
      sort_order = excluded.sort_order,
      active = 1,
      updated_at = CURRENT_TIMESTAMP
  `);

  db.exec("BEGIN IMMEDIATE");
  try {
    for (const exam of exams) {
      insertExam.run(exam.id, exam.name, exam.subtitle, exam.level, exam.color);
    }
    for (const [index, category] of interestCategories.entries()) {
      insertInterest.run(
        category.id,
        category.name,
        category.subtitle,
        category.emoji,
        category.color,
        category.activityPrompt,
        category.storyPrompt ?? "",
        index,
      );
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
        article.contentKind ?? "exam",
        article.interestId ?? null,
        article.seriesTitle ?? null,
        article.episodeNumber ?? null,
        JSON.stringify(article.paragraphs),
        JSON.stringify(article.questions),
      );
    }
    const insertSource = db.prepare(`
      INSERT INTO article_sources(
        article_id, source_name, source_url, external_id, license_note, content_hash
      ) VALUES (?, ?, ?, ?, '基于教育主题原创撰写；正文、题目与解析均为原创', ?)
      ON CONFLICT(article_id) DO UPDATE SET
        source_name = excluded.source_name,
        source_url = excluded.source_url,
        external_id = excluded.external_id,
        license_note = excluded.license_note,
        content_hash = excluded.content_hash,
        synced_at = CURRENT_TIMESTAMP
    `);
    for (const article of articles.filter((item) => item.contentKind === "interest")) {
      const guide = interestSourceGuides[article.interestId!];
      const hash = contentFingerprint(article);
      insertSource.run(
        article.id,
        guide?.name ?? "拾词原创兴趣阅读",
        guide?.url ?? null,
        article.id,
        hash,
      );
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
