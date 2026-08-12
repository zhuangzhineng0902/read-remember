import { randomUUID, timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import express from "express";
import { z } from "zod";
import type { Config } from "./config";
import type { AppDatabase } from "./database";
import {
  fetchAuthorizedFeed,
  importArticles,
  importPayloadSchema,
} from "./content-import";
import { ApiError, parse } from "./http";

function safeKeyMatch(actual: string, expected: string) {
  const left = Buffer.from(actual);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function requireAdmin(expectedKey: string) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const key = req.header("x-admin-key") ?? "";
    if (!safeKeyMatch(key, expectedKey)) {
      next(new ApiError(401, "ADMIN_UNAUTHORIZED", "管理员密钥无效"));
      return;
    }
    next();
  };
}

export function createAdminRouter(
  db: AppDatabase,
  config: Pick<Config, "adminApiKey" | "syncAllowedHosts">,
) {
  const router = express.Router();
  router.use(requireAdmin(config.adminApiKey));

  router.get("/overview", (_req, res) => {
    const metrics = db
      .prepare(
        `
      SELECT
        (SELECT COUNT(*) FROM users) AS users,
        (SELECT COUNT(*) FROM articles) AS articles,
        (SELECT COUNT(*) FROM deliveries) +
          (SELECT COUNT(*) FROM user_push_items) AS pushedArticles,
        (SELECT COUNT(*) FROM article_progress) AS readArticles,
        (SELECT COUNT(*) FROM vocabulary) AS savedWords,
        (SELECT COUNT(*) FROM push_batches) AS pushBatches
    `,
      )
      .get();
    const recent = db
      .prepare(
        `
      SELECT action, detail_json AS detailJson, created_at AS createdAt
      FROM admin_audit_logs ORDER BY id DESC LIMIT 8
    `,
      )
      .all()
      .map((row) => {
        const item = row as {
          action: string;
          detailJson: string;
          createdAt: string;
        };
        return {
          action: item.action,
          detail: JSON.parse(item.detailJson),
          createdAt: item.createdAt,
        };
      });
    res.json({ data: { metrics, recent } });
  });

  router.get("/articles", (req, res) => {
    const query = parse(
      z.object({
        examId: z
          .enum(["toefl", "ielts", "toeic", "middle", "high"])
          .optional(),
        search: z.string().trim().max(100).optional(),
        eyebrow: z.string().trim().max(120).optional(),
        limit: z.coerce.number().int().min(1).max(500).default(50),
        offset: z.coerce.number().int().min(0).default(0),
      }),
      req.query,
    );
    const conditions = ["1 = 1"];
    const params: (string | number)[] = [];
    if (query.examId) {
      conditions.push("a.exam_id = ?");
      params.push(query.examId);
    }
    if (query.search) {
      conditions.push("(a.title LIKE ? OR a.eyebrow LIKE ?)");
      params.push(`%${query.search}%`, `%${query.search}%`);
    }
    if (query.eyebrow) {
      conditions.push("a.eyebrow = ?");
      params.push(query.eyebrow);
    }
    const count = db
      .prepare(
        `SELECT COUNT(*) AS total FROM articles a WHERE ${conditions.join(" AND ")}`,
      )
      .get(...params) as { total: number };
    const rows = db
      .prepare(
        `
      SELECT
        a.id, a.exam_id AS examId, a.year, a.title, a.eyebrow,
        a.read_minutes AS readMinutes, a.difficulty,
        json_array_length(a.questions_json) AS questionCount,
        COALESCE(s.source_name, '内置示例') AS sourceName,
        s.source_url AS sourceUrl,
        s.license_note AS licenseNote,
        a.created_at AS createdAt
      FROM articles a
      LEFT JOIN article_sources s ON s.article_id = a.id
      WHERE ${conditions.join(" AND ")}
      ORDER BY a.created_at DESC, a.year DESC
      LIMIT ? OFFSET ?
    `,
      )
      .all(...params, query.limit, query.offset);
    res.json({
      data: rows,
      pagination: {
        total: count.total,
        limit: query.limit,
        offset: query.offset,
      },
    });
  });

  router.get("/article-types", (req, res) => {
    const query = parse(
      z.object({
        examId: z
          .enum(["toefl", "ielts", "toeic", "middle", "high"])
          .optional(),
      }),
      req.query,
    );
    const rows = query.examId
      ? db
          .prepare(
            `SELECT eyebrow, COUNT(*) AS count FROM articles
             WHERE exam_id = ? GROUP BY eyebrow ORDER BY count DESC, eyebrow`,
          )
          .all(query.examId)
      : db
          .prepare(
            `SELECT eyebrow, COUNT(*) AS count FROM articles
             GROUP BY eyebrow ORDER BY count DESC, eyebrow`,
          )
          .all();
    res.json({ data: rows });
  });

  router.post("/articles/import", (req, res) => {
    const payload = parse(importPayloadSchema, req.body);
    const ids = importArticles(db, payload);
    audit(db, "articles.import", {
      count: ids.length,
      sourceName: payload.sourceName,
      examId: payload.examId,
    });
    res.status(201).json({ data: { imported: ids.length, articleIds: ids } });
  });

  router.post("/articles/sync", async (req, res, next) => {
    try {
      const requestBody = parse(
        z.object({
          url: z.string().url(),
          examId: z.enum(["toefl", "ielts", "toeic", "middle", "high"]),
          sourceName: z.string().trim().min(2).max(120),
          licenseNote: z.string().trim().min(5).max(1000),
          rightsConfirmed: z.literal(true),
        }),
        req.body,
      );
      const feed = await fetchAuthorizedFeed(
        requestBody.url,
        config.syncAllowedHosts,
      );
      const articles = z
        .object({ articles: z.array(z.unknown()).min(1).max(500) })
        .parse(feed).articles;
      const payload = parse(importPayloadSchema, {
        ...requestBody,
        sourceUrl: requestBody.url,
        articles,
      });
      const ids = importArticles(db, payload);
      audit(db, "articles.sync", {
        count: ids.length,
        url: requestBody.url,
        examId: requestBody.examId,
      });
      res.status(201).json({ data: { imported: ids.length, articleIds: ids } });
    } catch (error) {
      next(error);
    }
  });

  router.get("/users", (_req, res) => {
    const rows = db
      .prepare(
        `
      SELECT
        u.id, u.device_id AS deviceId, u.exam_id AS examId,
        u.created_at AS createdAt,
        (SELECT COUNT(*) FROM deliveries d WHERE d.user_id = u.id) +
          (SELECT COUNT(*) FROM user_push_items up WHERE up.user_id = u.id) AS pushedArticles,
        (SELECT COUNT(*) FROM article_progress p WHERE p.user_id = u.id) AS readArticles,
        COALESCE((
          SELECT SUM(json_array_length(a.questions_json))
          FROM deliveries d JOIN articles a ON a.id = d.article_id
          WHERE d.user_id = u.id
        ), 0) + COALESCE((
          SELECT SUM(json_array_length(a.questions_json))
          FROM user_push_items up JOIN articles a ON a.id = up.article_id
          WHERE up.user_id = u.id
        ), 0) AS pushedQuestions,
        COALESCE((SELECT SUM(p.total) FROM article_progress p WHERE p.user_id = u.id), 0) AS answeredQuestions,
        (SELECT COUNT(*) FROM vocabulary v WHERE v.user_id = u.id) AS savedWords,
        (SELECT MAX(p.completed_at) FROM article_progress p WHERE p.user_id = u.id) AS lastReadAt
      FROM users u
      ORDER BY COALESCE(lastReadAt, u.created_at) DESC
    `,
      )
      .all();
    res.json({ data: rows });
  });

  router.get("/pushes", (_req, res) => {
    const rows = db
      .prepare(
        `
      SELECT
        b.id, b.name, b.message, b.target_type AS targetType,
        b.created_at AS createdAt,
        COUNT(DISTINCT up.user_id) AS userCount,
        COUNT(DISTINCT pi.article_id) AS articleCount,
        SUM(CASE WHEN up.opened_at IS NOT NULL THEN 1 ELSE 0 END) AS openedCount
      FROM push_batches b
      LEFT JOIN push_items pi ON pi.batch_id = b.id
      LEFT JOIN user_push_items up ON up.batch_id = b.id AND up.article_id = pi.article_id
      GROUP BY b.id
      ORDER BY b.created_at DESC
      LIMIT 50
    `,
      )
      .all();
    res.json({ data: rows });
  });

  router.post("/pushes", (req, res) => {
    const body = parse(
      z
        .object({
          name: z.string().trim().min(2).max(120),
          message: z.string().trim().min(2).max(500),
          articleIds: z.array(z.string().min(1)).min(1).max(20),
          userIds: z.array(z.string().uuid()).min(1).max(5000).optional(),
          allUsers: z.boolean().default(false),
        })
        .refine((value) => value.allUsers !== Boolean(value.userIds?.length), {
          message: "必须选择指定用户或全部用户，且不能同时选择",
        }),
      req.body,
    );
    const articleIds = [...new Set(body.articleIds)];
    const validArticles = db
      .prepare(
        `SELECT id FROM articles WHERE id IN (${articleIds.map(() => "?").join(",")})`,
      )
      .all(...articleIds) as Array<{ id: string }>;
    if (validArticles.length !== articleIds.length) {
      throw new ApiError(400, "INVALID_ARTICLE_IDS", "包含不存在的文章");
    }
    const users = body.allUsers
      ? (db.prepare("SELECT id FROM users").all() as Array<{ id: string }>)
      : (db
          .prepare(
            `SELECT id FROM users WHERE id IN (${body.userIds!.map(() => "?").join(",")})`,
          )
          .all(...body.userIds!) as Array<{ id: string }>);
    if (body.userIds && users.length !== new Set(body.userIds).size) {
      throw new ApiError(400, "INVALID_USER_IDS", "包含不存在的用户");
    }
    if (users.length === 0)
      throw new ApiError(400, "NO_TARGET_USERS", "没有可推送的目标用户");

    const batchId = randomUUID();
    db.exec("BEGIN IMMEDIATE");
    try {
      db.prepare(
        `
        INSERT INTO push_batches(id, name, message, target_type) VALUES (?, ?, ?, ?)
      `,
      ).run(
        batchId,
        body.name,
        body.message,
        body.allUsers ? "all" : "selected",
      );
      const addItem = db.prepare(
        "INSERT INTO push_items(batch_id, article_id) VALUES (?, ?)",
      );
      const deliver = db.prepare(`
        INSERT INTO user_push_items(batch_id, article_id, user_id) VALUES (?, ?, ?)
      `);
      for (const articleId of articleIds) {
        addItem.run(batchId, articleId);
        for (const user of users) deliver.run(batchId, articleId, user.id);
      }
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    audit(db, "pushes.create", {
      batchId,
      articleCount: articleIds.length,
      userCount: users.length,
    });
    res.status(201).json({
      data: {
        batchId,
        articleCount: articleIds.length,
        userCount: users.length,
        deliveries: articleIds.length * users.length,
      },
    });
  });

  return router;
}

function audit(db: AppDatabase, action: string, detail: unknown) {
  db.prepare(
    "INSERT INTO admin_audit_logs(action, detail_json) VALUES (?, ?)",
  ).run(action, JSON.stringify(detail));
}
