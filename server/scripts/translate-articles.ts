import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { DatabaseSync as DatabaseSyncType } from "node:sqlite";

const { DatabaseSync } = createRequire(import.meta.url)(
  "node:sqlite",
) as typeof import("node:sqlite");

type SegmentKind = "title" | "paragraph";
type ContentKind = "exam" | "interest";

type TranslationConfigFile = Partial<{
  databasePath: string;
  baseUrl: string;
  apiPath: string;
  apiKey: string;
  model: string;
  targetLanguage: string;
  batchSize: number;
  concurrency: number;
  timeoutMs: number;
  maxRetries: number;
  temperature: number;
  jsonMode: boolean;
  headers: Record<string, string>;
}>;

export type TranslationRunOptions = {
  databasePath: string;
  baseUrl: string;
  apiPath: string;
  apiKey: string;
  model: string;
  targetLanguage: string;
  batchSize: number;
  concurrency: number;
  timeoutMs: number;
  maxRetries: number;
  temperature: number;
  jsonMode: boolean;
  headers: Record<string, string>;
  examId?: string;
  contentKind?: ContentKind;
  limit?: number;
  force: boolean;
  dryRun: boolean;
  log?: (message: string) => void;
};

type ArticleRow = {
  id: string;
  title: string;
  paragraphsJson: string;
};

type Segment = {
  id: string;
  kind: SegmentKind;
  source: string;
};

type CachedSegment = Segment & {
  translation: string;
  provider: string;
  model: string;
};

type ArticlePlan = {
  id: string;
  sourceHash: string;
  titleSegmentId: string;
  paragraphSegmentIds: string[];
};

type TokenUsage = {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
};

export type TranslationRunResult = {
  articles: number;
  uniqueSegments: number;
  cachedSegments: number;
  translatedSegments: number;
  failedSegments: number;
  materializedArticles: number;
  pendingCharacters: number;
  estimatedSourceTokens: number;
  usage: TokenUsage;
};

const defaultConfig: Omit<
  TranslationRunOptions,
  "databasePath" | "examId" | "contentKind" | "limit" | "log"
> = {
  baseUrl: "",
  apiPath: "/chat/completions",
  apiKey: "",
  model: "",
  targetLanguage: "zh-CN",
  batchSize: 8,
  concurrency: 2,
  timeoutMs: 120_000,
  maxRetries: 3,
  temperature: 0.1,
  jsonMode: false,
  headers: {},
  force: false,
  dryRun: false,
};

const helpText = `
文章翻译批处理（OpenAI Chat Completions 兼容接口）

用法：
  npm run translate:articles -- --config config/translation.json

常用参数：
  --config <path>          JSON 配置文件
  --database <path>        SQLite 路径
  --base-url <url>         例如 http://127.0.0.1:11434/v1
  --api-path <path>        默认 /chat/completions，也可填写完整 URL
  --api-key <key>          API 密钥，本地模型可留空
  --model <name>           自定义模型名称
  --target <language>      默认 zh-CN
  --batch-size <n>         每次请求的标题/段落数，默认 8
  --concurrency <n>        并发请求数，默认 2
  --exam <id>              仅处理 toefl/ielts/toeic/middle/high
  --kind <exam|interest>   仅处理考试文章或兴趣文章
  --limit <n>              最多处理多少篇文章
  --force                  忽略已有段落缓存并重新翻译
  --dry-run                只统计，不调用模型、不写译文
  --json-mode              请求 response_format=json_object
  --no-json-mode           不发送 response_format（默认）
  --help                   显示帮助

配置优先级：命令行 > 环境变量 > JSON 配置 > 默认值。
环境变量前缀为 TRANSLATION_，详见 config/translation.example.json。
`.trim();

function hashText(kind: SegmentKind, source: string) {
  return createHash("sha256")
    .update(`${kind}\0${source.trim()}`)
    .digest("hex");
}

function articleSourceHash(title: string, paragraphs: string[]) {
  return createHash("sha256")
    .update(JSON.stringify([title.trim(), ...paragraphs.map((item) => item.trim())]))
    .digest("hex");
}

function ensureTranslationSchema(db: DatabaseSyncType) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS translation_segments (
      source_hash TEXT NOT NULL,
      target_language TEXT NOT NULL,
      segment_kind TEXT NOT NULL CHECK(segment_kind IN ('title', 'paragraph')),
      source_text TEXT NOT NULL,
      translated_text TEXT NOT NULL,
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
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
      translated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY(article_id, target_language)
    );
    CREATE INDEX IF NOT EXISTS idx_translation_segments_language
      ON translation_segments(target_language, translated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_article_translations_language
      ON article_translations(target_language, translated_at DESC);
  `);
}

function endpointUrl(baseUrl: string, apiPath: string) {
  if (/^https?:\/\//i.test(apiPath)) return apiPath;
  return `${baseUrl.replace(/\/+$/, "")}/${apiPath.replace(/^\/+/, "")}`;
}

function contentString(payload: unknown) {
  const value = payload as {
    choices?: Array<{
      message?: { content?: string | Array<{ type?: string; text?: string }> };
    }>;
  };
  const content = value.choices?.[0]?.message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map((item) => item.text ?? "").join("");
  }
  throw new Error("模型响应缺少 choices[0].message.content");
}

function parseJsonContent(content: string) {
  const withoutFence = content
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .trim();
  try {
    return JSON.parse(withoutFence) as unknown;
  } catch {
    const start = Math.min(
      ...[withoutFence.indexOf("{"), withoutFence.indexOf("[")].filter(
        (index) => index >= 0,
      ),
    );
    const objectEnd = withoutFence.lastIndexOf("}");
    const arrayEnd = withoutFence.lastIndexOf("]");
    const end = Math.max(objectEnd, arrayEnd);
    if (!Number.isFinite(start) || end <= start) {
      throw new Error("模型没有返回有效 JSON");
    }
    return JSON.parse(withoutFence.slice(start, end + 1)) as unknown;
  }
}

function parsedTranslations(payload: unknown) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== "object") return [];
  const object = payload as Record<string, unknown>;
  const list = object.translations ?? object.items ?? object.data;
  if (Array.isArray(list)) return list;
  return Object.entries(object).map(([id, translation]) => ({ id, translation }));
}

function validateTranslations(payload: unknown, segments: Segment[]) {
  const requested = new Set(segments.map((item) => item.id));
  const translated = new Map<string, string>();
  for (const rawItem of parsedTranslations(payload)) {
    if (!rawItem || typeof rawItem !== "object") continue;
    const item = rawItem as Record<string, unknown>;
    const id = String(item.id ?? item.key ?? "");
    const value = item.translation ?? item.text ?? item.translatedText;
    if (!requested.has(id) || typeof value !== "string" || !value.trim()) {
      continue;
    }
    translated.set(id, value.trim());
  }
  const missing = segments.filter((item) => !translated.has(item.id));
  if (missing.length) {
    throw new Error(
      `模型返回不完整，缺少 ${missing.length} 项：${missing
        .slice(0, 3)
        .map((item) => item.id.slice(0, 8))
        .join(", ")}`,
    );
  }
  return translated;
}

function usageFrom(payload: unknown): TokenUsage {
  const usage = (payload as {
    usage?: {
      prompt_tokens?: number;
      completion_tokens?: number;
      total_tokens?: number;
    };
  }).usage;
  return {
    promptTokens: usage?.prompt_tokens ?? 0,
    completionTokens: usage?.completion_tokens ?? 0,
    totalTokens:
      usage?.total_tokens ??
      (usage?.prompt_tokens ?? 0) + (usage?.completion_tokens ?? 0),
  };
}

function wait(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function translateBatch(
  segments: Segment[],
  options: TranslationRunOptions,
) {
  const url = endpointUrl(options.baseUrl, options.apiPath);
  let lastError: unknown;
  for (let attempt = 0; attempt <= options.maxRetries; attempt += 1) {
    try {
      const headers = new Headers(options.headers);
      headers.set("content-type", "application/json");
      headers.set("accept", "application/json");
      if (options.apiKey) headers.set("authorization", `Bearer ${options.apiKey}`);
      const body: Record<string, unknown> = {
        model: options.model,
        temperature: options.temperature,
        stream: false,
        messages: [
          {
            role: "system",
            content:
              `You are a professional English-to-Simplified-Chinese translator for a reading-learning app. ` +
              `Translate faithfully into ${options.targetLanguage}. Preserve names, numbers, paragraph meaning, ` +
              `exam terminology and JSON ids. Titles should be concise. Do not explain or answer the article. ` +
              `Return JSON only: {"translations":[{"id":"...","translation":"..."}]}.`,
          },
          {
            role: "user",
            content: JSON.stringify({
              targetLanguage: options.targetLanguage,
              items: segments.map((item) => ({
                id: item.id,
                kind: item.kind,
                text: item.source,
              })),
            }),
          },
        ],
      };
      if (options.jsonMode) body.response_format = { type: "json_object" };
      const response = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(options.timeoutMs),
      });
      if (!response.ok) {
        const detail = (await response.text()).slice(0, 800);
        throw new Error(`模型接口 ${response.status}: ${detail}`);
      }
      const responsePayload = (await response.json()) as unknown;
      return {
        translations: validateTranslations(
          parseJsonContent(contentString(responsePayload)),
          segments,
        ),
        usage: usageFrom(responsePayload),
      };
    } catch (error) {
      lastError = error;
      if (attempt < options.maxRetries) {
        await wait(Math.min(8_000, 750 * 2 ** attempt));
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

function selectedArticles(db: DatabaseSyncType, options: TranslationRunOptions) {
  const conditions: string[] = [];
  const params: Array<string | number> = [];
  if (options.examId) {
    conditions.push("exam_id = ?");
    params.push(options.examId);
  }
  if (options.contentKind) {
    conditions.push("content_kind = ?");
    params.push(options.contentKind);
  }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const limit = options.limit ? "LIMIT ?" : "";
  if (options.limit) params.push(options.limit);
  return db
    .prepare(
      `SELECT id, title, paragraphs_json AS paragraphsJson
       FROM articles ${where} ORDER BY id ${limit}`,
    )
    .all(...params) as unknown as ArticleRow[];
}

function buildPlans(rows: ArticleRow[]) {
  const segments = new Map<string, Segment>();
  const plans: ArticlePlan[] = [];
  const addSegment = (kind: SegmentKind, sourceValue: string) => {
    const source = sourceValue.trim();
    const id = hashText(kind, source);
    if (!segments.has(id)) segments.set(id, { id, kind, source });
    return id;
  };
  for (const row of rows) {
    const paragraphs = (JSON.parse(row.paragraphsJson) as string[]).map((item) =>
      item.trim(),
    );
    plans.push({
      id: row.id,
      sourceHash: articleSourceHash(row.title, paragraphs),
      titleSegmentId: addSegment("title", row.title),
      paragraphSegmentIds: paragraphs.map((item) => addSegment("paragraph", item)),
    });
  }
  return { segments, plans };
}

function cachedTranslations(
  db: DatabaseSyncType,
  segments: Map<string, Segment>,
  targetLanguage: string,
  force: boolean,
) {
  const values = new Map<string, CachedSegment>();
  if (force) return values;
  const find = db.prepare(
    `SELECT translated_text AS translation, provider, model
     FROM translation_segments WHERE source_hash = ? AND target_language = ?`,
  );
  for (const segment of segments.values()) {
    const row = find.get(segment.id, targetLanguage) as
      | { translation: string; provider: string; model: string }
      | undefined;
    if (row?.translation.trim()) values.set(segment.id, { ...segment, ...row });
  }
  return values;
}

function saveBatch(
  db: DatabaseSyncType,
  segments: Segment[],
  translations: Map<string, string>,
  options: TranslationRunOptions,
  resolved: Map<string, CachedSegment>,
) {
  const upsert = db.prepare(
    `INSERT INTO translation_segments(
       source_hash, target_language, segment_kind, source_text,
       translated_text, provider, model, translated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(source_hash, target_language) DO UPDATE SET
       segment_kind = excluded.segment_kind,
       source_text = excluded.source_text,
       translated_text = excluded.translated_text,
       provider = excluded.provider,
       model = excluded.model,
       translated_at = CURRENT_TIMESTAMP`,
  );
  db.exec("BEGIN IMMEDIATE");
  try {
    for (const segment of segments) {
      const translation = translations.get(segment.id)!;
      upsert.run(
        segment.id,
        options.targetLanguage,
        segment.kind,
        segment.source,
        translation,
        options.baseUrl,
        options.model,
      );
      resolved.set(segment.id, {
        ...segment,
        translation,
        provider: options.baseUrl,
        model: options.model,
      });
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function materializeArticles(
  db: DatabaseSyncType,
  plans: ArticlePlan[],
  resolved: Map<string, CachedSegment>,
  targetLanguage: string,
) {
  const upsert = db.prepare(
    `INSERT INTO article_translations(
       article_id, target_language, source_hash, translated_title,
       translated_paragraphs_json, provider, model, translated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(article_id, target_language) DO UPDATE SET
       source_hash = excluded.source_hash,
       translated_title = excluded.translated_title,
       translated_paragraphs_json = excluded.translated_paragraphs_json,
       provider = excluded.provider,
       model = excluded.model,
       translated_at = CURRENT_TIMESTAMP`,
  );
  let completed = 0;
  db.exec("BEGIN IMMEDIATE");
  try {
    for (const plan of plans) {
      const title = resolved.get(plan.titleSegmentId);
      const paragraphs = plan.paragraphSegmentIds.map((id) => resolved.get(id));
      if (!title || paragraphs.some((item) => !item)) continue;
      const values = [title, ...(paragraphs as CachedSegment[])];
      const providers = [...new Set(values.map((item) => item.provider))].sort();
      const models = [...new Set(values.map((item) => item.model))].sort();
      upsert.run(
        plan.id,
        targetLanguage,
        plan.sourceHash,
        title.translation,
        JSON.stringify(paragraphs.map((item) => item!.translation)),
        providers.join(","),
        models.join(","),
      );
      completed += 1;
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return completed;
}

export async function runArticleTranslation(
  options: TranslationRunOptions,
): Promise<TranslationRunResult> {
  const log = options.log ?? console.log;
  if (!existsSync(options.databasePath)) {
    throw new Error(`数据库不存在：${options.databasePath}`);
  }
  const db = new DatabaseSync(options.databasePath);
  try {
    db.exec("PRAGMA foreign_keys = ON");
    ensureTranslationSchema(db);
    const articles = selectedArticles(db, options);
    const { segments, plans } = buildPlans(articles);
    const resolved = cachedTranslations(
      db,
      segments,
      options.targetLanguage,
      options.force,
    );
    const pending = [...segments.values()].filter((item) => !resolved.has(item.id));
    const pendingCharacters = pending.reduce((sum, item) => sum + item.source.length, 0);
    const result: TranslationRunResult = {
      articles: articles.length,
      uniqueSegments: segments.size,
      cachedSegments: resolved.size,
      translatedSegments: 0,
      failedSegments: 0,
      materializedArticles: 0,
      pendingCharacters,
      estimatedSourceTokens: Math.ceil(pendingCharacters / 4),
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    };
    log(
      `文章 ${articles.length} 篇；唯一标题/段落 ${segments.size} 个；缓存命中 ${resolved.size} 个；待翻译 ${pending.length} 个。`,
    );
    log(
      `待翻译英文约 ${pendingCharacters.toLocaleString()} 字符，正文输入约 ${result.estimatedSourceTokens.toLocaleString()} Token（不含提示词）。`,
    );
    if (options.dryRun) {
      log("Dry run 完成：没有调用模型，也没有写入译文。");
      return result;
    }
    if (pending.length && (!options.baseUrl || !options.model)) {
      throw new Error("待翻译内容不为空，请配置 baseUrl 和 model");
    }
    const batches: Segment[][] = [];
    for (let index = 0; index < pending.length; index += options.batchSize) {
      batches.push(pending.slice(index, index + options.batchSize));
    }
    let cursor = 0;
    const errors: string[] = [];
    const workers = Array.from(
      { length: Math.min(options.concurrency, Math.max(1, batches.length)) },
      async () => {
        while (cursor < batches.length) {
          const batchIndex = cursor;
          cursor += 1;
          const batch = batches[batchIndex];
          try {
            const translated = await translateBatch(batch, options);
            saveBatch(db, batch, translated.translations, options, resolved);
            result.translatedSegments += batch.length;
            result.usage.promptTokens += translated.usage.promptTokens;
            result.usage.completionTokens += translated.usage.completionTokens;
            result.usage.totalTokens += translated.usage.totalTokens;
            log(
              `[${batchIndex + 1}/${batches.length}] 已翻译 ${batch.length} 项，累计 ${result.translatedSegments}/${pending.length}`,
            );
          } catch (error) {
            result.failedSegments += batch.length;
            const message = error instanceof Error ? error.message : String(error);
            errors.push(`批次 ${batchIndex + 1}: ${message}`);
            log(`[${batchIndex + 1}/${batches.length}] 失败：${message}`);
          }
        }
      },
    );
    await Promise.all(workers);
    result.materializedArticles = materializeArticles(
      db,
      plans,
      resolved,
      options.targetLanguage,
    );
    log(
      `完成：新增/更新译文段 ${result.translatedSegments} 个，已组装文章译文 ${result.materializedArticles}/${articles.length} 篇。`,
    );
    if (result.usage.totalTokens) {
      log(
        `模型报告 Token：输入 ${result.usage.promptTokens}，输出 ${result.usage.completionTokens}，合计 ${result.usage.totalTokens}。`,
      );
    }
    if (errors.length) {
      throw new Error(
        `${errors.length} 个批次失败；已成功结果已经保存，可直接重跑续传。\n${errors
          .slice(0, 5)
          .join("\n")}`,
      );
    }
    return result;
  } finally {
    db.close();
  }
}

function parsedCli(argv: string[]) {
  const values = new Map<string, string>();
  const flags = new Set<string>();
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument.startsWith("--")) throw new Error(`无法识别参数：${argument}`);
    const equalAt = argument.indexOf("=");
    if (equalAt >= 0) {
      values.set(argument.slice(2, equalAt), argument.slice(equalAt + 1));
      continue;
    }
    const key = argument.slice(2);
    const next = argv[index + 1];
    if (next && !next.startsWith("--")) {
      values.set(key, next);
      index += 1;
    } else {
      flags.add(key);
    }
  }
  return { values, flags };
}

function numberValue(value: unknown, fallback: number, name: string, min: number) {
  if (value === undefined || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < min) {
    throw new Error(`${name} 必须是不小于 ${min} 的数字`);
  }
  return parsed;
}

function boolValue(value: unknown, fallback: boolean) {
  if (value === undefined || value === "") return fallback;
  if (typeof value === "boolean") return value;
  return ["1", "true", "yes", "on"].includes(String(value).toLowerCase());
}

function jsonHeaders(value: string | undefined) {
  if (!value) return {};
  const parsed = JSON.parse(value) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("TRANSLATION_LLM_HEADERS_JSON 必须是 JSON 对象");
  }
  return Object.fromEntries(
    Object.entries(parsed).map(([key, headerValue]) => [key, String(headerValue)]),
  );
}

export function translationOptionsFromCli(argv: string[]): TranslationRunOptions {
  const { values, flags } = parsedCli(argv);
  if (flags.has("help")) {
    console.log(helpText);
    process.exit(0);
  }
  const configPath = values.get("config");
  const fileConfig: TranslationConfigFile = configPath
    ? JSON.parse(readFileSync(path.resolve(configPath), "utf8"))
    : {};
  const from = (cli: string, env: string, fileKey: keyof TranslationConfigFile) =>
    values.get(cli) ?? process.env[env] ?? fileConfig[fileKey];
  const databasePath = path.resolve(
    String(
      from("database", "TRANSLATION_DATABASE_PATH", "databasePath") ??
        process.env.DATABASE_PATH ??
        "data/read-remember.sqlite",
    ),
  );
  const contentKind = values.get("kind") as ContentKind | undefined;
  if (contentKind && !["exam", "interest"].includes(contentKind)) {
    throw new Error("--kind 只能是 exam 或 interest");
  }
  const configHeaders = fileConfig.headers ?? {};
  const environmentHeaders = jsonHeaders(process.env.TRANSLATION_LLM_HEADERS_JSON);
  const cliJsonMode = flags.has("json-mode")
    ? true
    : flags.has("no-json-mode")
      ? false
      : undefined;
  return {
    ...defaultConfig,
    databasePath,
    baseUrl: String(from("base-url", "TRANSLATION_LLM_BASE_URL", "baseUrl") ?? ""),
    apiPath: String(
      from("api-path", "TRANSLATION_LLM_API_PATH", "apiPath") ??
        defaultConfig.apiPath,
    ),
    apiKey: String(from("api-key", "TRANSLATION_LLM_API_KEY", "apiKey") ?? ""),
    model: String(from("model", "TRANSLATION_LLM_MODEL", "model") ?? ""),
    targetLanguage: String(
      from("target", "TRANSLATION_TARGET_LANGUAGE", "targetLanguage") ??
        defaultConfig.targetLanguage,
    ),
    batchSize: Math.trunc(
      numberValue(
        from("batch-size", "TRANSLATION_BATCH_SIZE", "batchSize"),
        defaultConfig.batchSize,
        "batchSize",
        1,
      ),
    ),
    concurrency: Math.trunc(
      numberValue(
        from("concurrency", "TRANSLATION_CONCURRENCY", "concurrency"),
        defaultConfig.concurrency,
        "concurrency",
        1,
      ),
    ),
    timeoutMs: Math.trunc(
      numberValue(
        from("timeout-ms", "TRANSLATION_TIMEOUT_MS", "timeoutMs"),
        defaultConfig.timeoutMs,
        "timeoutMs",
        1_000,
      ),
    ),
    maxRetries: Math.trunc(
      numberValue(
        from("retries", "TRANSLATION_MAX_RETRIES", "maxRetries"),
        defaultConfig.maxRetries,
        "maxRetries",
        0,
      ),
    ),
    temperature: numberValue(
      from("temperature", "TRANSLATION_TEMPERATURE", "temperature"),
      defaultConfig.temperature,
      "temperature",
      0,
    ),
    jsonMode:
      cliJsonMode ??
      boolValue(
        process.env.TRANSLATION_JSON_MODE ?? fileConfig.jsonMode,
        defaultConfig.jsonMode,
      ),
    headers: { ...configHeaders, ...environmentHeaders },
    examId: values.get("exam") ?? process.env.TRANSLATION_EXAM_ID,
    contentKind,
    limit: values.has("limit")
      ? Math.trunc(numberValue(values.get("limit"), 0, "limit", 1))
      : undefined,
    force: flags.has("force"),
    dryRun: flags.has("dry-run"),
  };
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isMain) {
  runArticleTranslation(translationOptionsFromCli(process.argv.slice(2))).catch(
    (error) => {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    },
  );
}
