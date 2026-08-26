import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { AppDatabase } from "./database";
import { ApiError } from "./http";

type TranslationFileConfig = Partial<{
  baseUrl: string;
  apiPath: string;
  apiKey: string;
  model: string;
  timeoutMs: number;
  headers: Record<string, string>;
}>;

export type PhraseTranslationConfig = {
  baseUrl: string;
  apiPath: string;
  apiKey: string;
  model: string;
  timeoutMs: number;
  headers: Record<string, string>;
};

export type PhraseTranslationResult = {
  text: string;
  translation: string;
  targetLanguage: string;
  cached: boolean;
};

export type PhraseTranslationProvider = {
  readonly enabled: boolean;
  translate(
    text: string,
    context: string,
    targetLanguage?: string,
  ): Promise<PhraseTranslationResult>;
};

function endpointUrl(baseUrl: string, apiPath: string) {
  if (/^https?:\/\//i.test(apiPath)) return apiPath;
  return `${baseUrl.replace(/\/+$/, "")}/${apiPath.replace(/^\/+/, "")}`;
}

function positiveNumber(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function stringMap(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, String(item)]),
  );
}

function environmentHeaders() {
  const raw = process.env.PHRASE_TRANSLATION_HEADERS_JSON;
  if (!raw) return {};
  try {
    return stringMap(JSON.parse(raw));
  } catch {
    return {};
  }
}

export function loadPhraseTranslationConfig(): PhraseTranslationConfig {
  const configPath =
    process.env.PHRASE_TRANSLATION_CONFIG_PATH ??
    path.resolve(process.cwd(), "config/translation.json");
  let file: TranslationFileConfig = {};
  if (existsSync(configPath)) {
    try {
      file = JSON.parse(readFileSync(configPath, "utf8")) as TranslationFileConfig;
    } catch (error) {
      console.warn(
        `Phrase translation config ignored: ${error instanceof Error ? error.message : error}`,
      );
    }
  }
  return {
    baseUrl:
      process.env.PHRASE_TRANSLATION_LLM_BASE_URL ??
      process.env.TRANSLATION_LLM_BASE_URL ??
      file.baseUrl ??
      "",
    apiPath:
      process.env.PHRASE_TRANSLATION_LLM_API_PATH ??
      process.env.TRANSLATION_LLM_API_PATH ??
      file.apiPath ??
      "/chat/completions",
    apiKey:
      process.env.PHRASE_TRANSLATION_LLM_API_KEY ??
      process.env.TRANSLATION_LLM_API_KEY ??
      file.apiKey ??
      "",
    model:
      process.env.PHRASE_TRANSLATION_LLM_MODEL ??
      process.env.TRANSLATION_LLM_MODEL ??
      file.model ??
      "",
    timeoutMs: positiveNumber(
      process.env.PHRASE_TRANSLATION_TIMEOUT_MS ?? file.timeoutMs,
      45_000,
    ),
    headers: { ...stringMap(file.headers), ...environmentHeaders() },
  };
}

function normalized(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

function hash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function responseContent(payload: unknown) {
  const content = (payload as {
    choices?: Array<{ message?: { content?: string } }>;
  }).choices?.[0]?.message?.content;
  if (typeof content !== "string") {
    throw new ApiError(502, "PHRASE_TRANSLATION_INVALID", "短语翻译服务返回异常");
  }
  const cleaned = content
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .trim();
  try {
    const parsed = JSON.parse(cleaned) as { translation?: unknown };
    if (typeof parsed.translation === "string" && parsed.translation.trim()) {
      return parsed.translation.trim();
    }
  } catch {
    if (cleaned && !cleaned.startsWith("{")) return cleaned;
  }
  throw new ApiError(502, "PHRASE_TRANSLATION_INVALID", "短语翻译服务没有返回译文");
}

export class PhraseTranslationService implements PhraseTranslationProvider {
  private readonly pending = new Map<string, Promise<PhraseTranslationResult>>();

  constructor(
    private readonly db: AppDatabase,
    private readonly config: PhraseTranslationConfig,
  ) {}

  get enabled() {
    return Boolean(this.config.baseUrl && this.config.model);
  }

  translate(textValue: string, contextValue: string, targetLanguage = "zh-CN") {
    const text = normalized(textValue);
    const context = normalized(contextValue);
    const sourceHash = hash(text.toLowerCase());
    const contextHash = hash(context.toLowerCase());
    const key = `${sourceHash}:${contextHash}:${targetLanguage}`;
    const cached = this.db
      .prepare(
        `SELECT translated_text AS translation
         FROM phrase_translation_cache
         WHERE source_hash = ? AND context_hash = ? AND target_language = ?`,
      )
      .get(sourceHash, contextHash, targetLanguage) as
      | { translation: string }
      | undefined;
    if (cached?.translation) {
      return Promise.resolve({
        text,
        translation: cached.translation,
        targetLanguage,
        cached: true,
      });
    }
    if (!this.enabled) {
      return Promise.reject(
        new ApiError(503, "PHRASE_TRANSLATION_UNAVAILABLE", "短语翻译服务尚未配置"),
      );
    }
    const existing = this.pending.get(key);
    if (existing) return existing;
    const request = this.request(text, context, targetLanguage, sourceHash, contextHash)
      .finally(() => this.pending.delete(key));
    this.pending.set(key, request);
    return request;
  }

  private async request(
    text: string,
    context: string,
    targetLanguage: string,
    sourceHash: string,
    contextHash: string,
  ) {
    const headers = new Headers(this.config.headers);
    headers.set("content-type", "application/json");
    headers.set("accept", "application/json");
    if (this.config.apiKey) {
      headers.set("authorization", `Bearer ${this.config.apiKey}`);
    }
    let response: Response;
    try {
      response = await fetch(endpointUrl(this.config.baseUrl, this.config.apiPath), {
        method: "POST",
        headers,
        body: JSON.stringify({
          model: this.config.model,
          temperature: 0,
          stream: false,
          messages: [
            {
              role: "system",
              content:
                `Translate only the selected English phrase into concise, natural Simplified Chinese for an English-learning app. ` +
                `Use the sentence context only to disambiguate meaning. Do not translate the whole context, explain grammar, add examples or answer a question. ` +
                `Preserve names, numbers and the source degree of certainty. Return JSON only: {"translation":"..."}.`,
            },
            {
              role: "user",
              content: JSON.stringify({ text, context, targetLanguage }),
            },
          ],
        }),
        signal: AbortSignal.timeout(this.config.timeoutMs),
      });
    } catch (error) {
      throw new ApiError(
        502,
        "PHRASE_TRANSLATION_UNAVAILABLE",
        error instanceof Error ? `短语翻译暂时不可用：${error.message}` : "短语翻译暂时不可用",
      );
    }
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 300);
      throw new ApiError(
        502,
        "PHRASE_TRANSLATION_FAILED",
        `短语翻译失败 (${response.status})${detail ? `：${detail}` : ""}`,
      );
    }
    const translation = responseContent(await response.json());
    this.db
      .prepare(
        `INSERT INTO phrase_translation_cache(
           source_hash, context_hash, target_language, source_text,
           context_text, translated_text, provider, model, translated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(source_hash, context_hash, target_language) DO UPDATE SET
           source_text = excluded.source_text,
           context_text = excluded.context_text,
           translated_text = excluded.translated_text,
           provider = excluded.provider,
           model = excluded.model,
           translated_at = CURRENT_TIMESTAMP`,
      )
      .run(
        sourceHash,
        contextHash,
        targetLanguage,
        text,
        context,
        translation,
        this.config.baseUrl,
        this.config.model,
      );
    return { text, translation, targetLanguage, cached: false };
  }
}
