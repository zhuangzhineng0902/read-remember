import { z } from "zod";
import type { ExamId } from "../../client/src/types";
import type { AppDatabase } from "./database";
import { contentFingerprint } from "./content-fingerprint";
import { ApiError } from "./http";

const questionSchema = z
  .object({
    prompt: z.string().trim().min(3).max(2000),
    options: z.array(z.string().trim().min(1).max(1000)).min(2).max(8),
    answer: z.number().int().min(0).max(7),
    explanation: z.string().trim().min(1).max(5000),
  })
  .refine((question) => question.answer < question.options.length, {
    message: "answer 必须对应一个有效选项",
  });

const interestIdSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z][a-z0-9-]{1,39}$/);

export const importedArticleSchema = z
  .object({
    externalId: z.string().trim().min(1).max(160),
    year: z.number().int().min(1980).max(2100),
    title: z.string().trim().min(3).max(300),
    eyebrow: z.string().trim().min(2).max(80).default("READING"),
    readMinutes: z.number().int().min(1).max(60).default(8),
    difficulty: z.number().int().min(1).max(5),
    contentKind: z.enum(["exam", "interest"]).default("exam"),
    interestId: interestIdSchema.nullable().optional(),
    seriesTitle: z.string().trim().min(2).max(160).nullable().optional(),
    episodeNumber: z.number().int().min(1).max(999).nullable().optional(),
    paragraphs: z.array(z.string().trim().min(10).max(20000)).min(1).max(30),
    questions: z.array(questionSchema).min(1).max(50),
  })
  .refine(
    (article) => article.contentKind !== "interest" || Boolean(article.interestId),
    { message: "兴趣文章必须选择 interestId", path: ["interestId"] },
  );

export const importPayloadSchema = z.object({
  examId: z.enum(["toefl", "ielts", "toeic", "middle", "high"]),
  sourceName: z.string().trim().min(2).max(120),
  sourceUrl: z.string().url().max(2000).nullable().optional(),
  licenseNote: z.string().trim().min(5).max(1000),
  rightsConfirmed: z.literal(true),
  articles: z.array(importedArticleSchema).min(1).max(500),
});

export type ImportPayload = z.infer<typeof importPayloadSchema>;

export function importArticles(db: AppDatabase, payload: ImportPayload) {
  const requestedInterests = [
    ...new Set(
      payload.articles.flatMap((article) =>
        article.contentKind === "interest" && article.interestId
          ? [article.interestId]
          : [],
      ),
    ),
  ];
  if (requestedInterests.length) {
    const placeholders = requestedInterests.map(() => "?").join(",");
    const available = db
      .prepare(
        `SELECT COUNT(*) AS count FROM interest_categories
         WHERE active = 1 AND id IN (${placeholders})`,
      )
      .get(...requestedInterests) as { count: number };
    if (available.count !== requestedInterests.length) {
      throw new ApiError(
        400,
        "INVALID_INTEREST",
        "兴趣文章引用了不存在或已停用的兴趣分类",
      );
    }
  }
  const existingSource = db.prepare(`
    SELECT article_id AS articleId
    FROM article_sources
    WHERE source_url IS ? AND external_id = ?
  `);
  const existingContent = db.prepare(`
    SELECT s.article_id AS articleId
    FROM article_sources s
    JOIN articles a ON a.id = s.article_id
    WHERE a.exam_id = ? AND s.content_hash = ?
    LIMIT 1
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
  const insertSource = db.prepare(`
    INSERT INTO article_sources(
      article_id, source_name, source_url, external_id, license_note, content_hash
    ) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(article_id) DO UPDATE SET
      source_name = excluded.source_name,
      source_url = excluded.source_url,
      external_id = excluded.external_id,
      license_note = excluded.license_note,
      content_hash = excluded.content_hash,
      synced_at = CURRENT_TIMESTAMP
  `);

  const imported: string[] = [];
  db.exec("BEGIN IMMEDIATE");
  try {
    for (const article of payload.articles) {
      const hash = contentFingerprint(article);
      const prior = existingSource.get(
        payload.sourceUrl ?? null,
        article.externalId,
      ) as { articleId: string } | undefined;
      const duplicate = existingContent.get(payload.examId, hash) as
        | { articleId: string }
        | undefined;
      if (duplicate && duplicate.articleId !== prior?.articleId) {
        imported.push(duplicate.articleId);
        continue;
      }
      const id =
        prior?.articleId ?? `${payload.examId}-sync-${hash.slice(0, 18)}`;
      insertArticle.run(
        id,
        payload.examId,
        article.year,
        article.title,
        article.eyebrow,
        article.readMinutes,
        article.difficulty,
        article.contentKind,
        article.contentKind === "interest" ? article.interestId ?? null : null,
        article.seriesTitle ?? null,
        article.episodeNumber ?? null,
        JSON.stringify(article.paragraphs),
        JSON.stringify(article.questions),
      );
      insertSource.run(
        id,
        payload.sourceName,
        payload.sourceUrl ?? null,
        article.externalId,
        payload.licenseNote,
        hash,
      );
      imported.push(id);
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return imported;
}

export async function fetchAuthorizedFeed(
  urlValue: string,
  allowedHosts: string[],
): Promise<unknown> {
  let url: URL;
  try {
    url = new URL(urlValue);
  } catch {
    throw new ApiError(400, "INVALID_SYNC_URL", "同步地址格式不正确");
  }
  if (url.protocol !== "https:") {
    throw new ApiError(400, "HTTPS_REQUIRED", "同步地址必须使用 HTTPS");
  }
  if (!allowedHosts.includes(url.hostname.toLowerCase())) {
    throw new ApiError(
      403,
      "SYNC_HOST_NOT_ALLOWED",
      "该域名未加入 SYNC_ALLOWED_HOSTS 白名单",
    );
  }

  const response = await fetch(url, {
    headers: { accept: "application/json" },
    redirect: "error",
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) {
    throw new ApiError(
      502,
      "SYNC_SOURCE_ERROR",
      `数据源返回 ${response.status}`,
    );
  }
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    throw new ApiError(400, "JSON_FEED_REQUIRED", "数据源必须返回 JSON");
  }
  const text = await response.text();
  if (text.length > 5_000_000) {
    throw new ApiError(413, "SYNC_PAYLOAD_TOO_LARGE", "同步内容不能超过 5 MB");
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new ApiError(400, "INVALID_SYNC_JSON", "数据源返回的 JSON 无法解析");
  }
}
