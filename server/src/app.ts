import { randomUUID } from "node:crypto";
import path from "node:path";
import cors from "cors";
import express, { type Request, type Response } from "express";
import helmet from "helmet";
import { z } from "zod";
import { createAdminRouter } from "./admin";
import { currentUser, requireAuth } from "./auth";
import type { Config } from "./config";
import type { AppDatabase } from "./database";
import { ApiError, errorHandler, notFound, parse } from "./http";
import {
  articleSelect,
  serializeArticle,
  serializeArticleSummary,
  type ArticleRow,
} from "./serializers";
import type { Question } from "../../client/src/types";
import {
  lookupPronunciation,
  pronunciationAudio,
} from "./pronunciation";
import { ensureDailyPushForUser, localDateParts } from "./daily-push";
import { scheduleMemoryReview } from "../../client/src/memory";

const examIds = ["toefl", "ielts", "toeic", "middle", "high"] as const;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;

const articleFromId = (db: AppDatabase, id: string) =>
  db
    .prepare(`SELECT ${articleSelect} FROM articles a WHERE a.id = ?`)
    .get(id) as ArticleRow | undefined;

export function createApp(
  db: AppDatabase,
  config: Pick<Config, "corsOrigin" | "adminApiKey" | "syncAllowedHosts"> &
    Partial<
      Pick<
        Config,
        | "dailyPushEnabled"
        | "dailyPushHour"
        | "dailyPushTimeZone"
        | "webRoot"
      >
    >,
) {
  const app = express();
  app.disable("x-powered-by");
  app.use(helmet());
  app.use(
    cors({ origin: config.corsOrigin === "*" ? true : config.corsOrigin }),
  );
  app.use(express.json({ limit: "128kb" }));
  app.use(
    "/admin",
    express.static(path.resolve(process.cwd(), "public"), {
      index: "index.html",
    }),
  );

  app.get("/health", (_req, res) => {
    res.json({
      status: "ok",
      service: "read-remember-api",
      timestamp: new Date().toISOString(),
    });
  });

  app.get("/api/v1/exams", (_req, res) => {
    const rows = db
      .prepare(
        "SELECT id, name, subtitle, level, color FROM exams ORDER BY rowid",
      )
      .all();
    res.json({ data: rows });
  });

  const pronunciationParams = z.object({
    word: z.string().trim().toLowerCase().regex(/^[a-z][a-z'-]{0,79}$/),
  });
  const pronunciationQuery = z.object({
    accent: z.enum(["us", "uk"]).default("us"),
    context: z.string().trim().max(450).default(""),
    includeAudio: z
      .enum(["true", "false"])
      .default("false")
      .transform((value) => value === "true"),
  });

  app.get("/api/v1/pronunciations/:word", async (req, res, next) => {
    try {
      const { word } = parse(pronunciationParams, req.params);
      const { accent, context, includeAudio } = parse(
        pronunciationQuery,
        req.query,
      );
      const result = await lookupPronunciation(
        db,
        word,
        accent,
        context,
        includeAudio,
      );
      res.json({
        data: {
          ...result,
          audioPath: result.hasAudio
            ? `/pronunciations/${encodeURIComponent(word)}/audio?accent=${accent}`
            : null,
          fallback: "device-tts",
        },
      });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/v1/pronunciations/:word/audio", async (req, res, next) => {
    try {
      const { word } = parse(pronunciationParams, req.params);
      const { accent } = parse(pronunciationQuery, req.query);
      const audio = await pronunciationAudio(db, word, accent);
      res.setHeader("cross-origin-resource-policy", "cross-origin");
      res.setHeader("content-type", audio.mime);
      res.setHeader("cache-control", "public, max-age=2592000, immutable");
      res.send(Buffer.from(audio.data));
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/v1/auth/anonymous", (req, res) => {
    const body = parse(
      z.object({ deviceId: z.string().trim().min(6).max(128) }),
      req.body,
    );
    const existing = db
      .prepare(
        `SELECT id, token, exam_id AS examId FROM users WHERE device_id = ?`,
      )
      .get(body.deviceId) as
      { id: string; token: string; examId: string } | undefined;

    if (existing) {
      res.json({ data: existing });
      return;
    }

    const user = { id: randomUUID(), token: randomUUID(), examId: "toefl" };
    db.prepare(
      `INSERT INTO users(id, device_id, token, exam_id) VALUES (?, ?, ?, ?)`,
    ).run(user.id, body.deviceId, user.token, user.examId);
    res.status(201).json({ data: user });
  });

  const authenticated = express.Router();
  authenticated.use(requireAuth(db));

  authenticated.get("/users/me", (_req, res) => {
    res.json({ data: currentUser(res) });
  });

  authenticated.patch("/users/me/exam", (req, res) => {
    const body = parse(z.object({ examId: z.enum(examIds) }), req.body);
    const user = currentUser(res);
    db.prepare(
      `UPDATE users SET exam_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    ).run(body.examId, user.id);
    res.json({ data: { ...user, examId: body.examId } });
  });

  authenticated.get("/daily", (req, res) => {
    const query = parse(
      z.object({ date: z.string().regex(datePattern).optional() }),
      req.query,
    );
    const user = currentUser(res);
    const date = query.date ?? new Date().toISOString().slice(0, 10);
    const delivered = db.prepare(`
      SELECT ${articleSelect}
      FROM deliveries d
      JOIN articles a ON a.id = d.article_id
      WHERE d.user_id = ? AND d.delivery_date = ?
      ORDER BY d.slot
    `);

    let rows = delivered.all(user.id, date) as unknown as ArticleRow[];
    if (rows.length === 0) {
      db.exec("BEGIN IMMEDIATE");
      try {
        rows = db
          .prepare(
            `
          SELECT ${articleSelect}
          FROM articles a
          WHERE a.exam_id = ?
            AND NOT EXISTS (
              SELECT 1 FROM deliveries d
              WHERE d.user_id = ? AND d.article_id = a.id
            )
          ORDER BY a.year DESC, a.id ASC
          LIMIT 3
        `,
          )
          .all(user.examId, user.id) as unknown as ArticleRow[];

        const insert = db.prepare(`
          INSERT INTO deliveries(user_id, article_id, delivery_date, slot)
          VALUES (?, ?, ?, ?)
        `);
        rows.forEach((row, index) =>
          insert.run(user.id, row.id, date, index + 1),
        );
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    }

    res.json({
      data: {
        date,
        examId: user.examId,
        articles: rows.map(serializeArticleSummary),
        corpusExhausted: rows.length < 3,
      },
    });
  });

  authenticated.get("/pushes", (_req, res) => {
    const user = currentUser(res);
    const current = localDateParts(
      new Date(),
      config.dailyPushTimeZone ?? "Asia/Shanghai",
    );
    if (
      config.dailyPushEnabled !== false &&
      current.hour >= (config.dailyPushHour ?? 8)
    ) {
      ensureDailyPushForUser(db, user.id, current.date);
    }
    const rows = db
      .prepare(
        `
        SELECT
          up.batch_id AS batchId,
          up.received_at AS receivedAt,
          up.opened_at AS openedAt,
          p.completed_at AS completedAt,
          b.name AS pushName,
          b.message,
          ${articleSelect}
        FROM user_push_items up
        JOIN push_batches b ON b.id = up.batch_id
        JOIN articles a ON a.id = up.article_id
        LEFT JOIN article_progress p
          ON p.user_id = up.user_id AND p.article_id = up.article_id
        WHERE up.user_id = ?
        ORDER BY up.received_at DESC
        LIMIT 50
      `,
      )
      .all(user.id) as unknown as Array<
      ArticleRow & {
        batchId: string;
        receivedAt: string;
        openedAt: string | null;
        pushName: string;
        message: string;
        completedAt: string | null;
      }
    >;
    res.json({
      data: rows.map((row) => ({
        batchId: row.batchId,
        pushName: row.pushName,
        message: row.message,
        receivedAt: row.receivedAt,
        openedAt: row.openedAt,
        completedAt: row.completedAt,
        article: serializeArticleSummary(row),
      })),
    });
  });

  authenticated.get("/articles/:id", (req, res) => {
    const user = currentUser(res);
    const delivered = db
      .prepare("SELECT 1 FROM deliveries WHERE user_id = ? AND article_id = ?")
      .get(user.id, req.params.id);
    const manualPush = db
      .prepare(
        "SELECT 1 FROM user_push_items WHERE user_id = ? AND article_id = ?",
      )
      .get(user.id, req.params.id);
    if (!delivered && !manualPush)
      throw new ApiError(
        403,
        "ARTICLE_NOT_DELIVERED",
        "该文章尚未推送给当前用户",
      );
    if (manualPush) {
      db.prepare(
        `UPDATE user_push_items
         SET opened_at = COALESCE(opened_at, CURRENT_TIMESTAMP)
         WHERE user_id = ? AND article_id = ?`,
      ).run(user.id, req.params.id);
    }

    const row = articleFromId(db, req.params.id);
    if (!row) throw new ApiError(404, "ARTICLE_NOT_FOUND", "文章不存在");
    res.json({ data: serializeArticle(row) });
  });

  authenticated.post("/articles/:id/complete", (req, res) => {
    const body = parse(
      z.object({ answers: z.array(z.number().int().min(0).max(10)).max(50) }),
      req.body,
    );
    const user = currentUser(res);
    const delivered = db
      .prepare("SELECT 1 FROM deliveries WHERE user_id = ? AND article_id = ?")
      .get(user.id, req.params.id);
    const manualPush = db
      .prepare(
        "SELECT 1 FROM user_push_items WHERE user_id = ? AND article_id = ?",
      )
      .get(user.id, req.params.id);
    if (!delivered && !manualPush)
      throw new ApiError(
        403,
        "ARTICLE_NOT_DELIVERED",
        "该文章尚未推送给当前用户",
      );

    const row = articleFromId(db, req.params.id);
    if (!row) throw new ApiError(404, "ARTICLE_NOT_FOUND", "文章不存在");
    const questions = JSON.parse(row.questionsJson) as Question[];
    if (body.answers.length !== questions.length) {
      throw new ApiError(
        400,
        "ANSWER_COUNT_MISMATCH",
        `需要提交 ${questions.length} 道题的答案`,
      );
    }

    const results = questions.map((question, index) => ({
      questionId: index,
      selectedAnswer: body.answers[index],
      correctAnswer: question.answer,
      correct: body.answers[index] === question.answer,
      explanation: question.explanation,
    }));
    const score = results.filter((item) => item.correct).length;
    db.prepare(
      `
      INSERT INTO article_progress(user_id, article_id, answers_json, score, total)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(user_id, article_id) DO UPDATE SET
        answers_json = excluded.answers_json,
        score = excluded.score,
        total = excluded.total,
        completed_at = CURRENT_TIMESTAMP
    `,
    ).run(
      user.id,
      row.id,
      JSON.stringify(body.answers),
      score,
      questions.length,
    );

    res.json({
      data: { articleId: row.id, score, total: questions.length, results },
    });
  });

  authenticated.get("/history", (req, res) => {
    const query = parse(
      z.object({
        examId: z.enum(examIds).optional(),
        limit: z.coerce.number().int().min(1).max(100).default(30),
        offset: z.coerce.number().int().min(0).default(0),
      }),
      req.query,
    );
    const user = currentUser(res);
    const conditions = ["d.user_id = ?"];
    const params: (string | number)[] = [user.id];
    if (query.examId) {
      conditions.push("a.exam_id = ?");
      params.push(query.examId);
    }
    params.push(query.limit, query.offset);
    const rows = db
      .prepare(
        `
      SELECT
        d.delivery_date AS date,
        d.slot,
        ${articleSelect},
        p.score,
        p.total,
        p.completed_at AS completedAt
      FROM deliveries d
      JOIN articles a ON a.id = d.article_id
      LEFT JOIN article_progress p ON p.user_id = d.user_id AND p.article_id = d.article_id
      WHERE ${conditions.join(" AND ")}
      ORDER BY d.delivery_date DESC, d.slot ASC
      LIMIT ? OFFSET ?
    `,
      )
      .all(...params) as unknown as Array<
      ArticleRow & {
        date: string;
        slot: number;
        score: number | null;
        total: number | null;
        completedAt: string | null;
      }
    >;

    res.json({
      data: rows.map((row) => ({
        date: row.date,
        slot: row.slot,
        article: serializeArticleSummary(row),
        progress: row.completedAt
          ? { score: row.score, total: row.total, completedAt: row.completedAt }
          : null,
      })),
      pagination: {
        limit: query.limit,
        offset: query.offset,
        hasMore: rows.length === query.limit,
      },
    });
  });

  authenticated.get("/vocabulary", (req, res) => {
    const query = parse(
      z.object({
        examId: z.enum(examIds).optional(),
        search: z.string().trim().max(80).optional(),
      }),
      req.query,
    );
    const user = currentUser(res);
    const conditions = ["v.user_id = ?"];
    const params: string[] = [user.id];
    if (query.examId) {
      conditions.push("v.exam_id = ?");
      params.push(query.examId);
    }
    if (query.search) {
      conditions.push("v.word LIKE ?");
      params.push(`%${query.search.toLowerCase()}%`);
    }
    const rows = db
      .prepare(
        `
      SELECT
        v.word, v.phonetic, v.translation, v.definition_en AS definition,
        v.part_of_speech AS partOfSpeech, v.example_en AS example,
        v.example_zh AS exampleTranslation,
        v.exam_id AS examId,
        v.article_id AS articleId,
        v.saved_at AS savedAt,
        v.memory_stage AS memoryStage,
        v.next_review_at AS nextReviewAt,
        v.last_reviewed_at AS lastReviewedAt,
        v.review_count AS reviewCount,
        v.lapse_count AS lapseCount,
        a.title AS articleTitle
      FROM vocabulary v
      JOIN articles a ON a.id = v.article_id
      WHERE ${conditions.join(" AND ")}
      ORDER BY v.saved_at DESC, v.word ASC
    `,
      )
      .all(...params);
    res.json({ data: rows });
  });

  authenticated.put("/vocabulary/:word", (req, res) => {
    const body = parse(
      z.object({
        examId: z.enum(examIds),
        articleId: z.string().min(1).max(80),
        phonetic: z.string().trim().min(1).max(120),
        translation: z.string().trim().min(1).max(500),
        definition: z.string().trim().max(1000).default(""),
        partOfSpeech: z.string().trim().max(80).default(""),
        example: z.string().trim().max(1000).default(""),
        exampleTranslation: z.string().trim().max(1000).default(""),
      }),
      req.body,
    );
    const word = decodeURIComponent(req.params.word).trim().toLowerCase();
    if (!/^[a-z][a-z'-]{0,79}$/.test(word)) {
      throw new ApiError(400, "INVALID_WORD", "生词格式不合法");
    }
    const user = currentUser(res);
    const article = articleFromId(db, body.articleId);
    if (!article || article.examId !== body.examId) {
      throw new ApiError(400, "INVALID_ARTICLE", "文章与考试类型不匹配");
    }
    const delivered = db
      .prepare("SELECT 1 FROM deliveries WHERE user_id = ? AND article_id = ?")
      .get(user.id, body.articleId);
    if (!delivered)
      throw new ApiError(
        403,
        "ARTICLE_NOT_DELIVERED",
        "不能收藏尚未推送的文章生词",
      );

    db.prepare(
      `
      INSERT INTO vocabulary(
        user_id, exam_id, word, phonetic, translation, definition_en,
        part_of_speech, example_en, example_zh, article_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id, exam_id, word) DO UPDATE SET
        phonetic = excluded.phonetic,
        translation = excluded.translation,
        definition_en = excluded.definition_en,
        part_of_speech = excluded.part_of_speech,
        example_en = excluded.example_en,
        example_zh = excluded.example_zh,
        article_id = excluded.article_id,
        saved_at = CURRENT_TIMESTAMP
    `,
    ).run(
      user.id,
      body.examId,
      word,
      body.phonetic,
      body.translation,
      body.definition,
      body.partOfSpeech,
      body.example,
      body.exampleTranslation,
      body.articleId,
    );

    const saved = db
      .prepare(
        `
      SELECT word, phonetic, translation, definition_en AS definition,
        part_of_speech AS partOfSpeech, example_en AS example,
        example_zh AS exampleTranslation, exam_id AS examId,
        article_id AS articleId, saved_at AS savedAt,
        memory_stage AS memoryStage, next_review_at AS nextReviewAt,
        last_reviewed_at AS lastReviewedAt, review_count AS reviewCount,
        lapse_count AS lapseCount
      FROM vocabulary WHERE user_id = ? AND exam_id = ? AND word = ?
    `,
      )
      .get(user.id, body.examId, word);
    res.status(201).json({ data: saved });
  });

  authenticated.post("/vocabulary/:word/review", (req, res) => {
    const body = parse(
      z.object({
        examId: z.enum(examIds),
        rating: z.enum(["again", "hard", "good", "easy"]),
      }),
      req.body,
    );
    const word = decodeURIComponent(req.params.word).trim().toLowerCase();
    if (!/^[a-z][a-z'-]{0,79}$/.test(word)) {
      throw new ApiError(400, "INVALID_WORD", "生词格式不合法");
    }
    const user = currentUser(res);
    const current = db
      .prepare(
        `SELECT memory_stage AS memoryStage, review_count AS reviewCount,
          lapse_count AS lapseCount
         FROM vocabulary
         WHERE user_id = ? AND exam_id = ? AND word = ?`,
      )
      .get(user.id, body.examId, word) as
      | { memoryStage: number; reviewCount: number; lapseCount: number }
      | undefined;
    if (!current) {
      throw new ApiError(404, "WORD_NOT_FOUND", "生词不存在");
    }

    const schedule = scheduleMemoryReview(current.memoryStage, body.rating);
    db.prepare(
      `UPDATE vocabulary
       SET memory_stage = ?, next_review_at = ?, last_reviewed_at = ?,
         review_count = ?, lapse_count = ?
       WHERE user_id = ? AND exam_id = ? AND word = ?`,
    ).run(
      schedule.memoryStage,
      schedule.nextReviewAt,
      schedule.lastReviewedAt,
      current.reviewCount + 1,
      current.lapseCount + (body.rating === "again" ? 1 : 0),
      user.id,
      body.examId,
      word,
    );

    const reviewed = db
      .prepare(
        `SELECT word, phonetic, translation, definition_en AS definition,
          part_of_speech AS partOfSpeech, example_en AS example,
          example_zh AS exampleTranslation, exam_id AS examId,
          article_id AS articleId, saved_at AS savedAt,
          memory_stage AS memoryStage, next_review_at AS nextReviewAt,
          last_reviewed_at AS lastReviewedAt, review_count AS reviewCount,
          lapse_count AS lapseCount
         FROM vocabulary
         WHERE user_id = ? AND exam_id = ? AND word = ?`,
      )
      .get(user.id, body.examId, word);
    res.json({ data: reviewed });
  });

  authenticated.delete("/vocabulary/:word", (req, res) => {
    const query = parse(z.object({ examId: z.enum(examIds) }), req.query);
    const user = currentUser(res);
    const word = decodeURIComponent(req.params.word).trim().toLowerCase();
    const result = db
      .prepare(
        "DELETE FROM vocabulary WHERE user_id = ? AND exam_id = ? AND word = ?",
      )
      .run(user.id, query.examId, word);
    if (result.changes === 0)
      throw new ApiError(404, "WORD_NOT_FOUND", "生词不存在");
    res.status(204).send();
  });

  app.use("/api/v1/admin", createAdminRouter(db, config));
  app.use("/api/v1", authenticated);
  if (config.webRoot) {
    app.use(
      express.static(config.webRoot, {
        index: "index.html",
        maxAge: process.env.NODE_ENV === "production" ? "1h" : 0,
      }),
    );
  }
  app.use(notFound);
  app.use(errorHandler);
  return app;
}
