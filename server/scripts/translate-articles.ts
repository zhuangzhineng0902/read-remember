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
  reviewEnabled: boolean;
  reviewModel: string;
  reviewTemperature: number;
  jsonMode: boolean;
  headers: Record<string, string>;
  glossary: Record<string, string>;
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
  reviewEnabled: boolean;
  reviewModel: string;
  reviewTemperature: number;
  jsonMode: boolean;
  headers: Record<string, string>;
  glossary: Record<string, string>;
  articleId?: string;
  examId?: string;
  contentKind?: ContentKind;
  limit?: number;
  force: boolean;
  dryRun: boolean;
  log?: (message: string) => void;
};

type ArticleRow = {
  id: string;
  examId: string;
  contentKind: ContentKind;
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
  translationPolicy: string;
};

type ArticlePlan = {
  id: string;
  examId: string;
  contentKind: ContentKind;
  sourceHash: string;
  segments: Segment[];
  titleSegmentId: string;
  paragraphSegmentIds: string[];
};

type QualityIssue = {
  code: string;
  message: string;
  severity: "error" | "warning";
};

type ArticleQuality = {
  score: number;
  reviewed: boolean;
  issues: QualityIssue[];
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
  reviewedArticles: number;
  qualityWarnings: number;
  pendingCharacters: number;
  estimatedSourceTokens: number;
  usage: TokenUsage;
};

const defaultConfig: Omit<
  TranslationRunOptions,
  "databasePath" | "articleId" | "examId" | "contentKind" | "limit" | "log"
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
  reviewEnabled: true,
  reviewModel: "",
  reviewTemperature: 0,
  jsonMode: false,
  headers: {},
  glossary: {},
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
  --batch-size <n>         保留用于兼容旧配置；新版固定按整篇文章请求
  --concurrency <n>        并发请求数，默认 2
  --article <id>           仅翻译指定文章（供页面按需生成使用）
  --exam <id>              仅处理 toefl/ielts/toeic/middle/high
  --kind <exam|interest>   仅处理考试文章或兴趣文章
  --limit <n>              最多处理多少篇文章
  --force                  忽略已有段落缓存并重新翻译
  --dry-run                只统计，不调用模型、不写译文
  --json-mode              请求 response_format=json_object
  --no-json-mode           不发送 response_format（默认）
  --review                 启用第二遍译文审校（默认）
  --no-review              关闭第二遍译文审校
  --review-model <name>    审校模型；默认与翻译模型相同
  --help                   显示帮助

配置优先级：命令行 > 环境变量 > JSON 配置 > 默认值。
环境变量前缀为 TRANSLATION_，详见 config/translation.example.json。
`.trim();

const TRANSLATION_POLICY_VERSION = "article-context-v2";

function translationPolicy(options: TranslationRunOptions) {
  return [
    TRANSLATION_POLICY_VERSION,
    options.model,
    options.reviewEnabled ? options.reviewModel || options.model : "no-review",
  ].join(":");
}

function hashText(context: string, kind: SegmentKind, index: number, source: string) {
  return createHash("sha256")
    .update(`${TRANSLATION_POLICY_VERSION}\0${context}\0${kind}\0${index}\0${source.trim()}`)
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
    CREATE INDEX IF NOT EXISTS idx_translation_segments_language
      ON translation_segments(target_language, translated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_article_translations_language
      ON article_translations(target_language, translated_at DESC);
  `);
  const ensureColumn = (table: string, name: string, definition: string) => {
    const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{
      name: string;
    }>;
    if (!columns.some((column) => column.name === name)) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${definition}`);
    }
  };
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

type ProtectedSegment = Segment & {
  protectedSource: string;
  protectedValues: Map<string, string>;
};

const protectedContentPattern =
  /(?:https?:\/\/|www\.)[^\s<>"']+|[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}|_{1,}(?:\s*\[[^\]\n]+\]\s*_{1,})?|<[^>\n]+>|\[[^\]\n]{1,40}\]|(?:[$£€¥]\s*)?\b\d[\d,.]*(?::\d{2})?\s*(?:%|km|cm|mm|kg|g|miles?|hours?|minutes?|seconds?|a\.m\.|p\.m\.)?\b/gi;

function protectSegment(segment: Segment): ProtectedSegment {
  const protectedValues = new Map<string, string>();
  let index = 0;
  const protectedSource = segment.source.replace(protectedContentPattern, (value) => {
    const token = `RRKEEP${String(index).padStart(4, "0")}TOKEN`;
    index += 1;
    protectedValues.set(token, value);
    return token;
  });
  return { ...segment, protectedSource, protectedValues };
}

function restoreProtectedText(segment: ProtectedSegment, translated: string) {
  let restored = translated;
  for (const [token, value] of segment.protectedValues) {
    const occurrences = restored.split(token).length - 1;
    if (occurrences !== 1) {
      throw new Error(
        `${segment.kind} ${segment.id.slice(0, 8)} 的保护标记 ${token} 出现 ${occurrences} 次`,
      );
    }
    restored = restored.replace(token, value);
  }
  if (/RRKEEP\d{4}TOKEN/.test(restored)) {
    throw new Error(`${segment.kind} ${segment.id.slice(0, 8)} 含未知保护标记`);
  }
  return restored.trim();
}

function chineseStyleGuidance(examId: string, contentKind: ContentKind) {
  const stage =
    examId === "middle"
      ? "Use clear, natural Chinese understandable to a junior-middle-school student. Prefer common textbook wording and short sentences."
      : examId === "high"
        ? "Use fluent high-school-level Chinese while preserving the source's logical and rhetorical structure."
        : examId === "toeic"
          ? "Use precise, natural business Chinese for emails, notices, advertisements, logistics, HR and finance. Keep document tone and terminology consistent."
          : examId === "toefl" || examId === "ielts"
            ? "Use accurate academic Chinese. Preserve qualifications, causal relations, technical terms and the author's degree of certainty."
            : "Use accurate, idiomatic Simplified Chinese appropriate for an English learner.";
  const content =
    contentKind === "exam"
      ? "This is exam material: preserve ambiguity, blanks, clues and difficulty. Never infer or insert an answer."
      : "This is interest reading: keep the Chinese lively and readable without rewriting facts, plot, tone or character relationships.";
  return `${stage} ${content}`;
}

function glossaryPrompt(glossary: Record<string, string>) {
  const entries = Object.entries(glossary);
  if (!entries.length) return "";
  return ` Use this mandatory terminology consistently: ${entries
    .map(([source, target]) => `${source} => ${target}`)
    .join("; ")}.`;
}

function translationSystemPrompt(
  plan: ArticlePlan,
  options: TranslationRunOptions,
) {
  return (
    `You are a senior English-to-Simplified-Chinese translator for a reading-learning app. ` +
    `Translate the complete article faithfully and idiomatically into ${options.targetLanguage}. ` +
    `${chineseStyleGuidance(plan.examId, plan.contentKind)} ` +
    `Read the title and all paragraphs as one coherent article before translating. Resolve pronouns and terminology from context. ` +
    `Do not omit, summarize, explain, embellish, soften, answer questions or fill blanks. ` +
    `Every uppercase token shaped like RRKEEP0000TOKEN is immutable: copy it exactly once in the corresponding translation. ` +
    `Preserve JSON ids and return one translation for every item. Titles should be concise and natural.` +
    glossaryPrompt(options.glossary) +
    ` Return JSON only: {"translations":[{"id":"...","translation":"..."}]}.`
  );
}

function qualityIssues(source: string, translation: string): QualityIssue[] {
  const issues: QualityIssue[] = [];
  const englishWords = source.match(/[A-Za-z]+(?:['’-][A-Za-z]+)*/g) ?? [];
  const chineseCharacters = translation.match(/[\u3400-\u9fff]/g) ?? [];
  if (!translation.trim()) {
    issues.push({ code: "empty", message: "译文为空", severity: "error" });
    return issues;
  }
  if (source.trim() === translation.trim() && englishWords.length >= 5) {
    issues.push({
      code: "untranslated",
      message: "译文与英文原文完全相同",
      severity: "error",
    });
  }
  if (
    englishWords.length >= 12 &&
    chineseCharacters.length < Math.max(4, Math.floor(englishWords.length * 0.22))
  ) {
    issues.push({
      code: "too-short",
      message: "中文长度异常，可能存在漏译",
      severity: "warning",
    });
  }
  const sourceHasNegation =
    /\b(?:no|not|never|neither|nor|without|cannot|can't|won't|isn't|aren't|don't|doesn't|didn't)\b/i.test(
      source,
    );
  if (
    sourceHasNegation &&
    !/[不无未没非勿否禁]|不能|不会|并非|从不|没有/.test(translation)
  ) {
    issues.push({
      code: "negation",
      message: "原文含否定表达，译文可能遗漏否定关系",
      severity: "warning",
    });
  }
  const remainingEnglish = translation
    .replace(/(?:https?:\/\/|www\.)\S+|[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, "")
    .match(/[A-Za-z]{4,}/g);
  if ((remainingEnglish?.length ?? 0) > Math.max(5, englishWords.length * 0.35)) {
    issues.push({
      code: "english-remains",
      message: "译文中残留较多英文，请检查是否漏译",
      severity: "warning",
    });
  }
  return issues;
}

function articleQuality(
  segments: Segment[],
  translations: Map<string, string>,
  reviewed: boolean,
): ArticleQuality {
  const issues = segments.flatMap((segment) =>
    qualityIssues(segment.source, translations.get(segment.id) ?? ""),
  );
  const score = Math.max(
    0,
    100 -
      issues.filter((item) => item.severity === "error").length * 30 -
      issues.filter((item) => item.severity === "warning").length * 8,
  );
  return { score, reviewed, issues };
}

async function callChatModel(
  system: string,
  user: unknown,
  model: string,
  temperature: number,
  options: TranslationRunOptions,
) {
  const url = endpointUrl(options.baseUrl, options.apiPath);
  const headers = new Headers(options.headers);
  headers.set("content-type", "application/json");
  headers.set("accept", "application/json");
  if (options.apiKey) headers.set("authorization", `Bearer ${options.apiKey}`);
  const body: Record<string, unknown> = {
    model,
    temperature,
    stream: false,
    messages: [
      { role: "system", content: system },
      { role: "user", content: JSON.stringify(user) },
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
    content: parseJsonContent(contentString(responsePayload)),
    usage: usageFrom(responsePayload),
  };
}

function addUsage(target: TokenUsage, value: TokenUsage) {
  target.promptTokens += value.promptTokens;
  target.completionTokens += value.completionTokens;
  target.totalTokens += value.totalTokens;
}

async function translateArticle(
  plan: ArticlePlan,
  options: TranslationRunOptions,
) {
  let lastError: unknown;
  for (let attempt = 0; attempt <= options.maxRetries; attempt += 1) {
    try {
      const protectedSegments = plan.segments.map(protectSegment);
      const requestItems = protectedSegments.map((item) => ({
        id: item.id,
        kind: item.kind,
        text: item.protectedSource,
      }));
      const usage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
      const translatedResponse = await callChatModel(
        translationSystemPrompt(plan, options),
        {
          articleId: plan.id,
          examId: plan.examId,
          contentKind: plan.contentKind,
          targetLanguage: options.targetLanguage,
          items: requestItems,
        },
        options.model,
        options.temperature,
        options,
      );
      addUsage(usage, translatedResponse.usage);
      let protectedTranslations = validateTranslations(
        translatedResponse.content,
        protectedSegments.map((item) => ({
          id: item.id,
          kind: item.kind,
          source: item.protectedSource,
        })),
      );
      let restored = new Map(
        protectedSegments.map((segment) => [
          segment.id,
          restoreProtectedText(segment, protectedTranslations.get(segment.id)!),
        ]),
      );
      const initialQuality = articleQuality(plan.segments, restored, false);
      let reviewed = false;
      if (options.reviewEnabled) {
        const reviewerModel = options.reviewModel || options.model;
        const reviewResponse = await callChatModel(
          `You are a meticulous senior bilingual editor. Compare every English source item with its draft Chinese translation in the context of one complete article. ` +
            `Correct mistranslation, omission, addition, awkward literal Chinese, inconsistent terminology, pronoun reference and tone. ` +
            `Preserve exam ambiguity and never solve blanks. Every RRKEEP token is immutable and must appear exactly once in its corresponding item. ` +
            `Return all items, including unchanged ones, as JSON only: {"translations":[{"id":"...","translation":"..."}]}.`,
          {
            articleId: plan.id,
            examId: plan.examId,
            contentKind: plan.contentKind,
            targetLanguage: options.targetLanguage,
            detectedIssues: initialQuality.issues,
            items: protectedSegments.map((segment) => ({
              id: segment.id,
              kind: segment.kind,
              source: segment.protectedSource,
              draft: protectedTranslations.get(segment.id),
            })),
          },
          reviewerModel,
          options.reviewTemperature,
          options,
        );
        addUsage(usage, reviewResponse.usage);
        protectedTranslations = validateTranslations(
          reviewResponse.content,
          protectedSegments.map((item) => ({
            id: item.id,
            kind: item.kind,
            source: item.protectedSource,
          })),
        );
        restored = new Map(
          protectedSegments.map((segment) => [
            segment.id,
            restoreProtectedText(segment, protectedTranslations.get(segment.id)!),
          ]),
        );
        reviewed = true;
      }
      const quality = articleQuality(plan.segments, restored, reviewed);
      const hardIssues = quality.issues.filter((item) => item.severity === "error");
      if (hardIssues.length) {
        throw new Error(
          `质量检查失败：${hardIssues.map((item) => item.message).join("；")}`,
        );
      }
      return {
        translations: restored,
        usage,
        quality,
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
  if (options.articleId) {
    conditions.push("id = ?");
    params.push(options.articleId);
  }
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
      `SELECT id, exam_id AS examId, content_kind AS contentKind,
        title, paragraphs_json AS paragraphsJson
       FROM articles ${where} ORDER BY id ${limit}`,
    )
    .all(...params) as unknown as ArticleRow[];
}

function buildPlans(rows: ArticleRow[]) {
  const segments = new Map<string, Segment>();
  const plans: ArticlePlan[] = [];
  for (const row of rows) {
    const paragraphs = (JSON.parse(row.paragraphsJson) as string[]).map((item) =>
      item.trim(),
    );
    const sourceHash = articleSourceHash(row.title, paragraphs);
    const context = `${row.id}\0${row.examId}\0${row.contentKind}\0${sourceHash}`;
    const articleSegments: Segment[] = [];
    const addSegment = (
      kind: SegmentKind,
      index: number,
      sourceValue: string,
    ) => {
      const source = sourceValue.trim();
      const id = hashText(context, kind, index, source);
      const segment = { id, kind, source } satisfies Segment;
      segments.set(id, segment);
      articleSegments.push(segment);
      return id;
    };
    const titleSegmentId = addSegment("title", 0, row.title);
    const paragraphSegmentIds = paragraphs.map((item, index) =>
      addSegment("paragraph", index, item),
    );
    plans.push({
      id: row.id,
      examId: row.examId,
      contentKind: row.contentKind,
      sourceHash,
      segments: articleSegments,
      titleSegmentId,
      paragraphSegmentIds,
    });
  }
  return { segments, plans };
}

function cachedTranslations(
  db: DatabaseSyncType,
  segments: Map<string, Segment>,
  targetLanguage: string,
  policy: string,
  force: boolean,
) {
  const values = new Map<string, CachedSegment>();
  if (force) return values;
  const find = db.prepare(
    `SELECT translated_text AS translation, provider, model,
       translation_policy AS translationPolicy
     FROM translation_segments
     WHERE source_hash = ? AND target_language = ? AND translation_policy = ?`,
  );
  for (const segment of segments.values()) {
    const row = find.get(segment.id, targetLanguage, policy) as
      | {
          translation: string;
          provider: string;
          model: string;
          translationPolicy: string;
        }
      | undefined;
    if (row?.translation.trim()) values.set(segment.id, { ...segment, ...row });
  }
  return values;
}

function saveArticleTranslationSegments(
  db: DatabaseSyncType,
  segments: Segment[],
  translations: Map<string, string>,
  options: TranslationRunOptions,
  resolved: Map<string, CachedSegment>,
) {
  const policy = translationPolicy(options);
  const model = options.reviewEnabled
    ? `${options.model}+review:${options.reviewModel || options.model}`
    : options.model;
  const upsert = db.prepare(
    `INSERT INTO translation_segments(
       source_hash, target_language, segment_kind, source_text,
       translated_text, provider, model, translation_policy, translated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(source_hash, target_language) DO UPDATE SET
       segment_kind = excluded.segment_kind,
       source_text = excluded.source_text,
       translated_text = excluded.translated_text,
       provider = excluded.provider,
       model = excluded.model,
       translation_policy = excluded.translation_policy,
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
        model,
        policy,
      );
      resolved.set(segment.id, {
        ...segment,
        translation,
        provider: options.baseUrl,
        model,
        translationPolicy: policy,
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
  options: TranslationRunOptions,
  qualityByArticle: Map<string, ArticleQuality>,
) {
  const policy = translationPolicy(options);
  const existingMetadata = db.prepare(
    `SELECT quality_score AS score, reviewed, quality_issues_json AS issuesJson
     FROM article_translations
     WHERE article_id = ? AND target_language = ? AND translation_policy = ?`,
  );
  const upsert = db.prepare(
    `INSERT INTO article_translations(
       article_id, target_language, source_hash, translated_title,
       translated_paragraphs_json, provider, model, translation_policy,
       quality_score, reviewed, quality_issues_json, translated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(article_id, target_language) DO UPDATE SET
       source_hash = excluded.source_hash,
       translated_title = excluded.translated_title,
       translated_paragraphs_json = excluded.translated_paragraphs_json,
       provider = excluded.provider,
       model = excluded.model,
       translation_policy = excluded.translation_policy,
       quality_score = excluded.quality_score,
       reviewed = excluded.reviewed,
       quality_issues_json = excluded.quality_issues_json,
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
      const existing = existingMetadata.get(
        plan.id,
        options.targetLanguage,
        policy,
      ) as { score: number; reviewed: number; issuesJson: string } | undefined;
      const quality =
        qualityByArticle.get(plan.id) ??
        (existing
          ? {
              score: existing.score,
              reviewed: Boolean(existing.reviewed),
              issues: JSON.parse(existing.issuesJson) as QualityIssue[],
            }
          : articleQuality(
              plan.segments,
              new Map(values.map((item) => [item.id, item.translation])),
              options.reviewEnabled,
            ));
      upsert.run(
        plan.id,
        options.targetLanguage,
        plan.sourceHash,
        title.translation,
        JSON.stringify(paragraphs.map((item) => item!.translation)),
        providers.join(","),
        models.join(","),
        policy,
        quality.score,
        quality.reviewed ? 1 : 0,
        JSON.stringify(quality.issues),
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
    const policy = translationPolicy(options);
    const resolved = cachedTranslations(
      db,
      segments,
      options.targetLanguage,
      policy,
      options.force,
    );
    const pendingPlans = plans.filter(
      (plan) =>
        options.force || plan.segments.some((segment) => !resolved.has(segment.id)),
    );
    const pendingSegments = pendingPlans.flatMap((plan) => plan.segments);
    const pendingCharacters = pendingSegments.reduce(
      (sum, item) => sum + item.source.length,
      0,
    );
    const result: TranslationRunResult = {
      articles: articles.length,
      uniqueSegments: segments.size,
      cachedSegments: resolved.size,
      translatedSegments: 0,
      failedSegments: 0,
      materializedArticles: 0,
      reviewedArticles: 0,
      qualityWarnings: 0,
      pendingCharacters,
      estimatedSourceTokens: Math.ceil(pendingCharacters / 4),
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    };
    log(
      `文章 ${articles.length} 篇；上下文标题/段落 ${segments.size} 个；缓存命中 ${resolved.size} 个；待整篇翻译 ${pendingPlans.length} 篇（${pendingSegments.length} 段）。`,
    );
    log(
      `待翻译英文约 ${pendingCharacters.toLocaleString()} 字符，正文输入约 ${result.estimatedSourceTokens.toLocaleString()} Token（不含提示词）。`,
    );
    if (options.dryRun) {
      log("Dry run 完成：没有调用模型，也没有写入译文。");
      return result;
    }
    if (pendingPlans.length && (!options.baseUrl || !options.model)) {
      throw new Error("待翻译内容不为空，请配置 baseUrl 和 model");
    }
    let cursor = 0;
    const errors: string[] = [];
    const qualityByArticle = new Map<string, ArticleQuality>();
    const workers = Array.from(
      {
        length: Math.min(
          options.concurrency,
          Math.max(1, pendingPlans.length),
        ),
      },
      async () => {
        while (cursor < pendingPlans.length) {
          const planIndex = cursor;
          cursor += 1;
          const plan = pendingPlans[planIndex];
          try {
            const translated = await translateArticle(plan, options);
            saveArticleTranslationSegments(
              db,
              plan.segments,
              translated.translations,
              options,
              resolved,
            );
            qualityByArticle.set(plan.id, translated.quality);
            result.translatedSegments += plan.segments.length;
            if (translated.quality.reviewed) result.reviewedArticles += 1;
            result.qualityWarnings += translated.quality.issues.filter(
              (item) => item.severity === "warning",
            ).length;
            addUsage(result.usage, translated.usage);
            log(
              `[${planIndex + 1}/${pendingPlans.length}] ${plan.id} 已完成整篇翻译${translated.quality.reviewed ? "与审校" : ""}，质量 ${translated.quality.score}，累计 ${result.translatedSegments}/${pendingSegments.length} 段`,
            );
          } catch (error) {
            result.failedSegments += plan.segments.length;
            const message = error instanceof Error ? error.message : String(error);
            errors.push(`文章 ${plan.id}: ${message}`);
            log(`[${planIndex + 1}/${pendingPlans.length}] ${plan.id} 失败：${message}`);
          }
        }
      },
    );
    await Promise.all(workers);
    result.materializedArticles = materializeArticles(
      db,
      plans,
      resolved,
      options,
      qualityByArticle,
    );
    log(
      `完成：新增/更新译文段 ${result.translatedSegments} 个，审校文章 ${result.reviewedArticles} 篇，质量警告 ${result.qualityWarnings} 个，已组装文章译文 ${result.materializedArticles}/${articles.length} 篇。`,
    );
    if (result.usage.totalTokens) {
      log(
        `模型报告 Token：输入 ${result.usage.promptTokens}，输出 ${result.usage.completionTokens}，合计 ${result.usage.totalTokens}。`,
      );
    }
    if (errors.length) {
      throw new Error(
        `${errors.length} 篇文章失败；已成功结果已经保存，可直接重跑续传。\n${errors
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

function jsonStringMap(value: string | undefined, name: string) {
  if (!value) return {};
  const parsed = JSON.parse(value) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${name} 必须是 JSON 对象`);
  }
  return Object.fromEntries(
    Object.entries(parsed).map(([key, mapValue]) => [key, String(mapValue)]),
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
  const cliReviewEnabled = flags.has("review")
    ? true
    : flags.has("no-review")
      ? false
      : undefined;
  const environmentGlossary = jsonStringMap(
    process.env.TRANSLATION_GLOSSARY_JSON,
    "TRANSLATION_GLOSSARY_JSON",
  );
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
    reviewEnabled:
      cliReviewEnabled ??
      boolValue(
        process.env.TRANSLATION_REVIEW_ENABLED ?? fileConfig.reviewEnabled,
        defaultConfig.reviewEnabled,
      ),
    reviewModel: String(
      from("review-model", "TRANSLATION_REVIEW_MODEL", "reviewModel") ?? "",
    ),
    reviewTemperature: numberValue(
      from(
        "review-temperature",
        "TRANSLATION_REVIEW_TEMPERATURE",
        "reviewTemperature",
      ),
      defaultConfig.reviewTemperature,
      "reviewTemperature",
      0,
    ),
    jsonMode:
      cliJsonMode ??
      boolValue(
        process.env.TRANSLATION_JSON_MODE ?? fileConfig.jsonMode,
        defaultConfig.jsonMode,
      ),
    headers: { ...configHeaders, ...environmentHeaders },
    glossary: { ...(fileConfig.glossary ?? {}), ...environmentGlossary },
    articleId: values.get("article") ?? process.env.TRANSLATION_ARTICLE_ID,
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
  /translate-articles\.(?:ts|js|mjs)$/i.test(process.argv[1]) &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isMain) {
  runArticleTranslation(translationOptionsFromCli(process.argv.slice(2))).catch(
    (error) => {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    },
  );
}
