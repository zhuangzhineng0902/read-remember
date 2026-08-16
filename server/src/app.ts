import { randomUUID } from "node:crypto";
import path from "node:path";
import cors from "cors";
import express, { type Request, type Response } from "express";
import helmet from "helmet";
import { z } from "zod";
import { createAdminRouter } from "./admin";
import {
  currentUser,
  hashPassword,
  requireAuth,
  requireRegistered,
  verifyPassword,
} from "./auth";
import type { Config } from "./config";
import type { AppDatabase } from "./database";
import { ApiError, errorHandler, notFound, parse } from "./http";
import {
  articleSelect,
  serializeArticle,
  serializeArticleSummary,
  type ArticleRow,
} from "./serializers";
import type {
  LearningSettings,
  Question,
  ReaderSettings,
} from "../../client/src/types";
import {
  lookupPronunciation,
  pronunciationAudio,
} from "./pronunciation";
import { ensureDailyPushForUser, localDateParts } from "./daily-push";
import { scheduleMemoryReview } from "../../client/src/memory";

const examIds = ["toefl", "ielts", "toeic", "middle", "high"] as const;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const usernamePattern = /^[a-zA-Z0-9_]{3,24}$/;

const defaultLearningSettings: LearningSettings = {
  dailyReminderEnabled: true,
  reminderTime: "20:30",
  pronunciationAccent: "us",
  dailyGoal: 3,
};
const defaultReaderSettings: ReaderSettings = {
  fontScale: 1,
  lineSpacing: "standard",
  fontFamily: "serif",
  pageTone: "paper",
  columnWidth: "standard",
};
const learningSettingsSchema = z.object({
  dailyReminderEnabled: z.boolean(),
  reminderTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  pronunciationAccent: z.enum(["us", "uk"]),
  dailyGoal: z.number().int().min(1).max(10),
});
const readerSettingsSchema = z.object({
  fontScale: z.number().min(0.8).max(1.4),
  lineSpacing: z.enum(["compact", "standard", "relaxed"]),
  fontFamily: z.enum(["serif", "sans"]),
  pageTone: z.enum(["paper", "white", "green"]),
  columnWidth: z.enum(["narrow", "standard", "wide"]),
});

const publicUserSelect = `
  id, device_id AS deviceId, token, exam_id AS examId,
  username, display_name AS displayName, email,
  CASE WHEN username IS NULL THEN 0 ELSE 1 END AS isRegistered
`;

const serializeSession = (row: {
  id: string;
  deviceId: string;
  token: string;
  examId: string;
  username: string | null;
  displayName: string;
  email: string;
  isRegistered: number;
}) => ({ ...row, isRegistered: Boolean(row.isRegistered) });

const articleFromId = (db: AppDatabase, id: string) =>
  db
    .prepare(`SELECT ${articleSelect} FROM articles a WHERE a.id = ?`)
    .get(id) as ArticleRow | undefined;

const hasArticleAccess = (db: AppDatabase, userId: string, articleId: string) =>
  Boolean(
    db
      .prepare(
        `SELECT 1 FROM deliveries WHERE user_id = ? AND article_id = ?
         UNION ALL
         SELECT 1 FROM user_push_items WHERE user_id = ? AND article_id = ?
         LIMIT 1`,
      )
      .get(userId, articleId, userId, articleId),
  );

const sqliteTimestampToIso = (value: string) =>
  new Date(`${value.replace(" ", "T")}Z`).toISOString();

function articleAnswerState(
  db: AppDatabase,
  userId: string,
  row: ArticleRow,
) {
  const questions = JSON.parse(row.questionsJson) as Question[];
  const completed = db
    .prepare(
      `SELECT answers_json AS answersJson, completed_at AS updatedAt
       FROM article_progress WHERE user_id = ? AND article_id = ?`,
    )
    .get(userId, row.id) as
    | { answersJson: string; updatedAt: string }
    | undefined;
  const draft = completed
    ? undefined
    : (db
        .prepare(
          `SELECT answers_json AS answersJson, updated_at AS updatedAt
           FROM article_answer_states WHERE user_id = ? AND article_id = ?`,
        )
        .get(userId, row.id) as
        | { answersJson: string; updatedAt: string }
        | undefined);
  const stored = completed ?? draft;
  const answers = stored
    ? (JSON.parse(stored.answersJson) as Array<number | null>)
    : questions.map(() => null);
  const results = completed
    ? questions.map((question, index) => ({
        questionId: index,
        selectedAnswer: answers[index] as number,
        correctAnswer: question.answer,
        correct: answers[index] === question.answer,
        explanation: question.explanation,
      }))
    : [];
  return {
    answers,
    submitted: Boolean(completed),
    results,
    updatedAt: stored
      ? sqliteTimestampToIso(stored.updatedAt)
      : new Date(0).toISOString(),
  };
}

function userPreferences(db: AppDatabase, userId: string) {
  const row = db
    .prepare(
      `SELECT learning_json AS learningJson, reader_json AS readerJson,
        updated_at AS updatedAt FROM user_preferences WHERE user_id = ?`,
    )
    .get(userId) as
    | { learningJson: string; readerJson: string; updatedAt: string }
    | undefined;
  return {
    learning: row
      ? { ...defaultLearningSettings, ...JSON.parse(row.learningJson) }
      : defaultLearningSettings,
    reader: row
      ? { ...defaultReaderSettings, ...JSON.parse(row.readerJson) }
      : defaultReaderSettings,
    updatedAt: row
      ? sqliteTimestampToIso(row.updatedAt)
      : new Date(0).toISOString(),
  };
}

function ensureDailyDeliveries(
  db: AppDatabase,
  userId: string,
  examId: string,
  date: string,
  requestedGoal: number,
) {
  const goal = Math.min(10, Math.max(1, Math.trunc(requestedGoal)));
  const delivered = db.prepare(`
    SELECT ${articleSelect}
    FROM deliveries d
    JOIN articles a ON a.id = d.article_id
    WHERE d.user_id = ? AND d.delivery_date = ? AND d.exam_id = ?
    ORDER BY d.slot
  `);

  db.exec("BEGIN IMMEDIATE");
  try {
    let rows = delivered.all(userId, date, examId) as unknown as ArticleRow[];
    if (rows.length < goal) {
      const missingCount = goal - rows.length;
      const nextSlot =
        (db
          .prepare(
            `SELECT COALESCE(MAX(slot), 0) AS maxSlot FROM deliveries
             WHERE user_id = ? AND delivery_date = ? AND exam_id = ?`,
          )
          .get(userId, date, examId) as { maxSlot: number }).maxSlot + 1;
      const additions = db
        .prepare(
          `SELECT ${articleSelect}
           FROM articles a
           WHERE a.exam_id = ?
             AND NOT EXISTS (
               SELECT 1 FROM deliveries d
               WHERE d.user_id = ? AND d.article_id = a.id
             )
           ORDER BY a.year DESC, a.id ASC
           LIMIT ?`,
        )
        .all(examId, userId, missingCount) as unknown as ArticleRow[];
      const insert = db.prepare(`
        INSERT INTO deliveries(user_id, article_id, exam_id, delivery_date, slot)
        VALUES (?, ?, ?, ?, ?)
      `);
      additions.forEach((row, index) =>
        insert.run(userId, row.id, examId, date, nextSlot + index),
      );
      rows = delivered.all(userId, date, examId) as unknown as ArticleRow[];
    }
    db.exec("COMMIT");
    return rows.slice(0, goal);
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

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
        `SELECT ${publicUserSelect} FROM users WHERE device_id = ?`,
      )
      .get(body.deviceId) as Parameters<typeof serializeSession>[0] | undefined;

    if (existing) {
      if (existing.username) {
        throw new ApiError(
          401,
          "PASSWORD_LOGIN_REQUIRED",
          "该设备已绑定正式账号，请使用用户名密码登录",
        );
      }
      res.json({ data: serializeSession(existing) });
      return;
    }

    const user = {
      id: randomUUID(),
      deviceId: body.deviceId,
      token: randomUUID(),
      examId: "toefl",
      username: null,
      displayName: "阅读学习者",
      email: "",
      isRegistered: false,
    };
    db.prepare(
      `INSERT INTO users(id, device_id, token, exam_id) VALUES (?, ?, ?, ?)`,
    ).run(user.id, body.deviceId, user.token, user.examId);
    res.status(201).json({ data: user });
  });

  app.post("/api/v1/auth/register", async (req, res) => {
    const body = parse(
      z.object({
        deviceId: z.string().trim().min(6).max(128),
        username: z.string().trim().regex(usernamePattern),
        password: z.string().min(8).max(72),
        displayName: z.string().trim().min(1).max(30),
        email: z.string().trim().email().max(120).or(z.literal("")).default(""),
      }),
      req.body,
    );
    const username = body.username.toLowerCase();
    const usernameExists = db
      .prepare("SELECT 1 FROM users WHERE username = ? COLLATE NOCASE")
      .get(username);
    if (usernameExists) {
      throw new ApiError(409, "USERNAME_TAKEN", "该用户名已被使用");
    }

    const deviceUser = db
      .prepare(`SELECT ${publicUserSelect} FROM users WHERE device_id = ?`)
      .get(body.deviceId) as Parameters<typeof serializeSession>[0] | undefined;
    if (deviceUser?.username) {
      throw new ApiError(409, "DEVICE_REGISTERED", "该设备已注册，请直接登录");
    }

    const passwordHash = await hashPassword(body.password);
    if (deviceUser) {
      db.prepare(
        `UPDATE users
         SET username = ?, password_hash = ?, display_name = ?, email = ?,
           updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
      ).run(username, passwordHash, body.displayName, body.email, deviceUser.id);
    } else {
      db.prepare(
        `INSERT INTO users(
          id, device_id, token, exam_id, username, password_hash,
          display_name, email
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        randomUUID(),
        body.deviceId,
        randomUUID(),
        "toefl",
        username,
        passwordHash,
        body.displayName,
        body.email,
      );
    }
    const row = db
      .prepare(`SELECT ${publicUserSelect} FROM users WHERE username = ?`)
      .get(username) as Parameters<typeof serializeSession>[0];
    res.status(201).json({ data: serializeSession(row) });
  });

  app.post("/api/v1/auth/login", async (req, res) => {
    const body = parse(
      z.object({
        username: z.string().trim().regex(usernamePattern),
        password: z.string().min(8).max(72),
      }),
      req.body,
    );
    const row = db
      .prepare(
        `SELECT ${publicUserSelect}, password_hash AS passwordHash
         FROM users WHERE username = ? COLLATE NOCASE`,
      )
      .get(body.username) as
      | (Parameters<typeof serializeSession>[0] & { passwordHash: string | null })
      | undefined;
    if (
      !row?.passwordHash ||
      !(await verifyPassword(body.password, row.passwordHash))
    ) {
      throw new ApiError(401, "INVALID_CREDENTIALS", "用户名或密码不正确");
    }
    const { passwordHash: _passwordHash, ...session } = row;
    res.json({ data: serializeSession(session) });
  });

  const authenticated = express.Router();
  authenticated.use(requireAuth(db));

  authenticated.get("/users/me", (_req, res) => {
    res.json({ data: currentUser(res) });
  });

  authenticated.use(requireRegistered);

  authenticated.get("/users/me/preferences", (_req, res) => {
    const user = currentUser(res);
    res.json({ data: userPreferences(db, user.id) });
  });

  authenticated.patch("/users/me/preferences", (req, res) => {
    const body = parse(
      z.object({
        learning: learningSettingsSchema.optional(),
        reader: readerSettingsSchema.optional(),
      }),
      req.body,
    );
    const user = currentUser(res);
    const current = userPreferences(db, user.id);
    const learning = body.learning ?? current.learning;
    const reader = body.reader ?? current.reader;
    db.prepare(
      `INSERT INTO user_preferences(user_id, learning_json, reader_json)
       VALUES (?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         learning_json = excluded.learning_json,
         reader_json = excluded.reader_json,
         updated_at = CURRENT_TIMESTAMP`,
    ).run(user.id, JSON.stringify(learning), JSON.stringify(reader));
    if (
      body.learning &&
      learning.dailyGoal !== current.learning.dailyGoal
    ) {
      const today = localDateParts(
        new Date(),
        config.dailyPushTimeZone ?? "Asia/Shanghai",
      ).date;
      ensureDailyDeliveries(
        db,
        user.id,
        user.examId,
        today,
        learning.dailyGoal,
      );
    }
    res.json({ data: userPreferences(db, user.id) });
  });

  authenticated.get("/users/me/stats", (_req, res) => {
    const user = currentUser(res);
    const totals = db
      .prepare(
        `SELECT COUNT(*) AS completedArticles,
          COUNT(DISTINCT date(p.completed_at)) AS learningDays,
          COALESCE(SUM(p.total), 0) AS answeredQuestions,
          COALESCE(SUM(p.score), 0) AS correctAnswers,
          COALESCE(SUM(CASE
            WHEN COALESCE(r.reading_seconds, 0) > 0 THEN r.reading_seconds
            ELSE a.read_minutes * 60
          END), 0) AS readingSeconds
         FROM article_progress p
         JOIN articles a ON a.id = p.article_id
         LEFT JOIN article_reading_states r
           ON r.user_id = p.user_id AND r.article_id = p.article_id
         WHERE p.user_id = ?`,
      )
      .get(user.id) as {
      completedArticles: number;
      learningDays: number;
      answeredQuestions: number;
      correctAnswers: number;
      readingSeconds: number;
    };
    const vocabulary = db
      .prepare(
        `SELECT COUNT(*) AS savedWords,
          SUM(CASE WHEN datetime(next_review_at) <= CURRENT_TIMESTAMP THEN 1 ELSE 0 END) AS dueWords
         FROM vocabulary WHERE user_id = ?`,
      )
      .get(user.id) as { savedWords: number; dueWords: number | null };
    const activityDates = db
      .prepare(
        `SELECT DISTINCT date(completed_at) AS date
         FROM article_progress WHERE user_id = ? ORDER BY date DESC`,
      )
      .all(user.id) as Array<{ date: string }>;
    const activeDates = new Set(activityDates.map((item) => item.date));
    const cursor = new Date();
    const today = cursor.toISOString().slice(0, 10);
    if (!activeDates.has(today)) cursor.setUTCDate(cursor.getUTCDate() - 1);
    let streakDays = 0;
    while (activeDates.has(cursor.toISOString().slice(0, 10))) {
      streakDays += 1;
      cursor.setUTCDate(cursor.getUTCDate() - 1);
    }
    res.json({
      data: {
        ...totals,
        streakDays,
        savedWords: vocabulary.savedWords,
        dueWords: vocabulary.dueWords ?? 0,
      },
    });
  });

  authenticated.patch("/users/me/exam", (req, res) => {
    const body = parse(z.object({ examId: z.enum(examIds) }), req.body);
    const user = currentUser(res);
    db.prepare(
      `UPDATE users SET exam_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    ).run(body.examId, user.id);
    res.json({ data: { ...user, examId: body.examId } });
  });

  authenticated.patch("/users/me", (req, res) => {
    const body = parse(
      z.object({
        username: z.string().trim().regex(usernamePattern),
        displayName: z.string().trim().min(1).max(30),
        email: z.string().trim().email().max(120).or(z.literal("")),
      }),
      req.body,
    );
    const user = currentUser(res);
    if (!user.isRegistered) {
      throw new ApiError(403, "REGISTRATION_REQUIRED", "请先注册正式账号");
    }
    const normalizedUsername = body.username.toLowerCase();
    const conflict = db
      .prepare(
        "SELECT 1 FROM users WHERE username = ? COLLATE NOCASE AND id <> ?",
      )
      .get(normalizedUsername, user.id);
    if (conflict) {
      throw new ApiError(409, "USERNAME_TAKEN", "该用户名已被使用");
    }
    db.prepare(
      `UPDATE users SET username = ?, display_name = ?, email = ?,
        updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    ).run(normalizedUsername, body.displayName, body.email, user.id);
    res.json({
      data: {
        ...user,
        username: normalizedUsername,
        displayName: body.displayName,
        email: body.email,
      },
    });
  });

  authenticated.patch("/users/me/password", async (req, res) => {
    const body = parse(
      z.object({
        currentPassword: z.string().min(8).max(72),
        newPassword: z.string().min(8).max(72),
      }),
      req.body,
    );
    const user = currentUser(res);
    const row = db
      .prepare("SELECT password_hash AS passwordHash FROM users WHERE id = ?")
      .get(user.id) as { passwordHash: string | null };
    if (
      !row.passwordHash ||
      !(await verifyPassword(body.currentPassword, row.passwordHash))
    ) {
      throw new ApiError(401, "INVALID_PASSWORD", "当前密码不正确");
    }
    db.prepare(
      `UPDATE users SET password_hash = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
    ).run(await hashPassword(body.newPassword), user.id);
    res.status(204).send();
  });

  authenticated.get("/daily", (req, res) => {
    const query = parse(
      z.object({ date: z.string().regex(datePattern).optional() }),
      req.query,
    );
    const user = currentUser(res);
    const date =
      query.date ??
      localDateParts(
        new Date(),
        config.dailyPushTimeZone ?? "Asia/Shanghai",
      ).date;
    const goal = userPreferences(db, user.id).learning.dailyGoal;
    const rows = ensureDailyDeliveries(db, user.id, user.examId, date, goal);

    res.json({
      data: {
        date,
        examId: user.examId,
        articles: rows.map(serializeArticleSummary),
        corpusExhausted: rows.length < goal,
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

  authenticated.get("/articles/:id/reading-state", (req, res) => {
    const user = currentUser(res);
    if (!hasArticleAccess(db, user.id, req.params.id)) {
      throw new ApiError(403, "ARTICLE_NOT_DELIVERED", "该文章尚未推送给当前用户");
    }
    const state = db
      .prepare(
        `SELECT offset_y AS offsetY, ratio, reading_seconds AS readingSeconds,
          updated_at AS updatedAt
         FROM article_reading_states WHERE user_id = ? AND article_id = ?`,
      )
      .get(user.id, req.params.id) as
      | { offsetY: number; ratio: number; readingSeconds: number; updatedAt: string }
      | undefined;
    res.json({
      data: state
        ? { ...state, updatedAt: sqliteTimestampToIso(state.updatedAt) }
        : {
            offsetY: 0,
            ratio: 0,
            readingSeconds: 0,
            updatedAt: new Date(0).toISOString(),
          },
    });
  });

  authenticated.put("/articles/:id/reading-state", (req, res) => {
    const body = parse(
      z.object({
        offsetY: z.number().min(0).max(1_000_000),
        ratio: z.number().min(0).max(1),
        sessionSeconds: z.number().int().min(0).max(3600).default(0),
      }),
      req.body,
    );
    const user = currentUser(res);
    if (!hasArticleAccess(db, user.id, req.params.id)) {
      throw new ApiError(403, "ARTICLE_NOT_DELIVERED", "该文章尚未推送给当前用户");
    }
    db.prepare(
      `INSERT INTO article_reading_states(
        user_id, article_id, offset_y, ratio, reading_seconds
       ) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(user_id, article_id) DO UPDATE SET
         offset_y = excluded.offset_y,
         ratio = excluded.ratio,
         reading_seconds = article_reading_states.reading_seconds + excluded.reading_seconds,
         updated_at = CURRENT_TIMESTAMP`,
    ).run(user.id, req.params.id, body.offsetY, body.ratio, body.sessionSeconds);
    const state = db
      .prepare(
        `SELECT offset_y AS offsetY, ratio, reading_seconds AS readingSeconds,
          updated_at AS updatedAt
         FROM article_reading_states WHERE user_id = ? AND article_id = ?`,
      )
      .get(user.id, req.params.id) as {
      offsetY: number;
      ratio: number;
      readingSeconds: number;
      updatedAt: string;
    };
    res.json({ data: { ...state, updatedAt: sqliteTimestampToIso(state.updatedAt) } });
  });

  authenticated.get("/articles/:id/answers", (req, res) => {
    const user = currentUser(res);
    if (!hasArticleAccess(db, user.id, req.params.id)) {
      throw new ApiError(
        403,
        "ARTICLE_NOT_DELIVERED",
        "该文章尚未推送给当前用户",
      );
    }
    const row = articleFromId(db, req.params.id);
    if (!row) throw new ApiError(404, "ARTICLE_NOT_FOUND", "文章不存在");
    res.json({ data: articleAnswerState(db, user.id, row) });
  });

  authenticated.put("/articles/:id/answers", (req, res) => {
    const body = parse(
      z.object({
        answers: z.array(z.number().int().min(0).max(10).nullable()).max(50),
      }),
      req.body,
    );
    const user = currentUser(res);
    if (!hasArticleAccess(db, user.id, req.params.id)) {
      throw new ApiError(
        403,
        "ARTICLE_NOT_DELIVERED",
        "该文章尚未推送给当前用户",
      );
    }
    const row = articleFromId(db, req.params.id);
    if (!row) throw new ApiError(404, "ARTICLE_NOT_FOUND", "文章不存在");
    const questions = JSON.parse(row.questionsJson) as Question[];
    if (body.answers.length !== questions.length) {
      throw new ApiError(
        400,
        "ANSWER_COUNT_MISMATCH",
        `需要保存 ${questions.length} 道题的答题状态`,
      );
    }
    const invalidAnswer = body.answers.some(
      (answer, index) => answer !== null && answer >= questions[index].options.length,
    );
    if (invalidAnswer) {
      throw new ApiError(400, "INVALID_ANSWER", "答案选项超出有效范围");
    }

    const completed = db
      .prepare(
        "SELECT 1 FROM article_progress WHERE user_id = ? AND article_id = ?",
      )
      .get(user.id, row.id);
    if (!completed) {
      db.prepare(
        `INSERT INTO article_answer_states(user_id, article_id, answers_json)
         VALUES (?, ?, ?)
         ON CONFLICT(user_id, article_id) DO UPDATE SET
           answers_json = excluded.answers_json,
           updated_at = CURRENT_TIMESTAMP`,
      ).run(user.id, row.id, JSON.stringify(body.answers));
    }
    res.json({ data: articleAnswerState(db, user.id, row) });
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
      `INSERT INTO article_attempts(
        user_id, article_id, answers_json, score, total
       ) VALUES (?, ?, ?, ?, ?)`,
    ).run(
      user.id,
      row.id,
      JSON.stringify(body.answers),
      score,
      questions.length,
    );
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
    db.prepare(
      `INSERT INTO article_answer_states(user_id, article_id, answers_json)
       VALUES (?, ?, ?)
       ON CONFLICT(user_id, article_id) DO UPDATE SET
         answers_json = excluded.answers_json,
         updated_at = CURRENT_TIMESTAMP`,
    ).run(user.id, row.id, JSON.stringify(body.answers));

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
        p.completed_at AS completedAt,
        r.ratio AS readingRatio,
        r.reading_seconds AS readingSeconds
      FROM deliveries d
      JOIN articles a ON a.id = d.article_id
      LEFT JOIN article_progress p ON p.user_id = d.user_id AND p.article_id = d.article_id
      LEFT JOIN article_reading_states r ON r.user_id = d.user_id AND r.article_id = d.article_id
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
        readingRatio: number | null;
        readingSeconds: number | null;
      }
    >;

    res.json({
      data: rows.map((row) => ({
        date: row.date,
        slot: row.slot,
        article: serializeArticleSummary(row),
        progress: row.completedAt
          ? {
              score: row.score,
              total: row.total,
              completedAt: row.completedAt,
              readingRatio: row.readingRatio ?? 0,
              readingSeconds: row.readingSeconds ?? 0,
            }
          : null,
      })),
      pagination: {
        limit: query.limit,
        offset: query.offset,
        hasMore: rows.length === query.limit,
      },
    });
  });

  authenticated.get("/mistakes", (req, res) => {
    const user = currentUser(res);
    const rows = db
      .prepare(
        `SELECT ${articleSelect}, p.answers_json AS answersJson,
          p.completed_at AS completedAt
         FROM article_progress p
         JOIN articles a ON a.id = p.article_id
         WHERE p.user_id = ?
         ORDER BY p.completed_at DESC`,
      )
      .all(user.id) as unknown as Array<
      ArticleRow & { answersJson: string; completedAt: string }
    >;
    const mistakes = rows.flatMap((row) => {
      const questions = JSON.parse(row.questionsJson) as Question[];
      const answers = JSON.parse(row.answersJson) as number[];
      return questions.flatMap((question, questionId) =>
        answers[questionId] === question.answer
          ? []
          : [
              {
                id: `${row.id}:${questionId}`,
                article: serializeArticleSummary(row),
                questionId,
                prompt: question.prompt,
                options: question.options,
                selectedAnswer: answers[questionId],
                correctAnswer: question.answer,
                explanation: question.explanation,
                completedAt: sqliteTimestampToIso(row.completedAt),
              },
            ],
      );
    });
    res.json({ data: mistakes });
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
