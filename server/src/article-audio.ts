import { createHash, randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import type { AppDatabase } from "./database";
import { ApiError } from "./http";

export type KokoroVoice = { id: string; label: string };

export type ArticleAudioConfig = {
  baseUrl: string;
  apiPath: string;
  apiKey: string;
  model: string;
  format: "mp3" | "wav" | "opus" | "flac";
  audioRoot: string;
  timeoutMs: number;
  maxInputCharacters: number;
  defaultVoice: string;
  voices: KokoroVoice[];
};

type AudioCacheRow = {
  articleId: string;
  voice: string;
  sourceHash: string;
  provider: string;
  model: string;
  format: ArticleAudioConfig["format"];
  mimeType: string;
  filename: string;
  publicToken: string;
  byteSize: number;
  createdAt: string;
};

export type ArticleAudioMetadata = {
  articleId: string;
  voice: string;
  voiceLabel: string;
  format: string;
  byteSize: number;
  audioPath: string;
  cached: boolean;
};

const formatMime: Record<ArticleAudioConfig["format"], string> = {
  mp3: "audio/mpeg",
  wav: "audio/wav",
  opus: "audio/ogg",
  flac: "audio/flac",
};

function endpointUrl(baseUrl: string, apiPath: string) {
  if (/^https?:\/\//i.test(apiPath)) return apiPath;
  return `${baseUrl.replace(/\/+$/, "")}/${apiPath.replace(/^\/+/, "")}`;
}

function sourceHash(title: string, paragraphs: string[]) {
  return createHash("sha256")
    .update(JSON.stringify([title, ...paragraphs]))
    .digest("hex");
}

function cacheFilename(
  articleHash: string,
  voice: string,
  model: string,
  format: string,
) {
  const hash = createHash("sha256")
    .update(`${articleHash}\0${voice}\0${model}\0${format}`)
    .digest("hex");
  return `${hash}.${format}`;
}

function rowMetadata(row: AudioCacheRow, voices: KokoroVoice[], cached: boolean) {
  return {
    articleId: row.articleId,
    voice: row.voice,
    voiceLabel: voices.find((item) => item.id === row.voice)?.label ?? row.voice,
    format: row.format,
    byteSize: row.byteSize,
    audioPath: `/article-audio/files/${row.publicToken}`,
    cached,
  } satisfies ArticleAudioMetadata;
}

export class ArticleAudioService {
  private readonly pending = new Map<string, Promise<ArticleAudioMetadata>>();

  constructor(
    private readonly db: AppDatabase,
    readonly config: ArticleAudioConfig,
  ) {
    mkdirSync(config.audioRoot, { recursive: true });
  }

  get enabled() {
    return Boolean(this.config.baseUrl && this.config.model);
  }

  publicConfig() {
    return {
      enabled: this.enabled,
      provider: "kokoro",
      defaultVoice: this.config.defaultVoice,
      voices: this.config.voices,
      playbackSpeeds: [0.8, 1, 1.2],
    };
  }

  private validateVoice(voice: string) {
    if (!this.config.voices.some((item) => item.id === voice)) {
      throw new ApiError(400, "KOKORO_VOICE_INVALID", "不支持所选朗读音色");
    }
  }

  private article(articleId: string) {
    const row = this.db
      .prepare(
        `SELECT title, paragraphs_json AS paragraphsJson
         FROM articles WHERE id = ?`,
      )
      .get(articleId) as { title: string; paragraphsJson: string } | undefined;
    if (!row) throw new ApiError(404, "ARTICLE_NOT_FOUND", "文章不存在");
    const paragraphs = JSON.parse(row.paragraphsJson) as string[];
    const text = `${row.title.trim()}.\n\n${paragraphs.join("\n\n")}`;
    if (text.length > this.config.maxInputCharacters) {
      throw new ApiError(
        413,
        "ARTICLE_AUDIO_INPUT_TOO_LONG",
        `文章超过朗读服务单次限制（${this.config.maxInputCharacters} 字符）`,
      );
    }
    return { ...row, paragraphs, text, sourceHash: sourceHash(row.title, paragraphs) };
  }

  private cachedRow(articleId: string, voice: string) {
    return this.db
      .prepare(
        `SELECT article_id AS articleId, voice, source_hash AS sourceHash,
          provider, model, format, mime_type AS mimeType, filename,
          public_token AS publicToken, byte_size AS byteSize,
          created_at AS createdAt
         FROM article_audio_cache WHERE article_id = ? AND voice = ?`,
      )
      .get(articleId, voice) as AudioCacheRow | undefined;
  }

  private isUsable(row: AudioCacheRow | undefined, articleHash: string) {
    return Boolean(
      row &&
        row.sourceHash === articleHash &&
        row.provider === this.config.baseUrl &&
        row.model === this.config.model &&
        row.format === this.config.format &&
        existsSync(path.join(this.config.audioRoot, row.filename)),
    );
  }

  metadata(articleId: string, requestedVoice?: string) {
    const voice = requestedVoice || this.config.defaultVoice;
    this.validateVoice(voice);
    const article = this.article(articleId);
    const row = this.cachedRow(articleId, voice);
    return this.isUsable(row, article.sourceHash)
      ? rowMetadata(row!, this.config.voices, true)
      : null;
  }

  ensure(articleId: string, requestedVoice?: string) {
    const voice = requestedVoice || this.config.defaultVoice;
    this.validateVoice(voice);
    if (!this.enabled) {
      throw new ApiError(
        503,
        "KOKORO_NOT_CONFIGURED",
        "整篇朗读服务尚未配置",
      );
    }
    const key = `${articleId}:${voice}`;
    const existing = this.pending.get(key);
    if (existing) return existing;
    const job = this.generate(articleId, voice).finally(() => this.pending.delete(key));
    this.pending.set(key, job);
    return job;
  }

  private async generate(articleId: string, voice: string) {
    const article = this.article(articleId);
    const prior = this.cachedRow(articleId, voice);
    if (this.isUsable(prior, article.sourceHash)) {
      return rowMetadata(prior!, this.config.voices, true);
    }

    const headers = new Headers({
      accept: "audio/*",
      "content-type": "application/json",
    });
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
          input: article.text,
          voice,
          response_format: this.config.format,
          speed: 1,
        }),
        signal: AbortSignal.timeout(this.config.timeoutMs),
      });
    } catch (error) {
      throw new ApiError(
        502,
        "KOKORO_UNAVAILABLE",
        error instanceof Error ? `朗读服务不可用：${error.message}` : "朗读服务不可用",
      );
    }
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 500);
      throw new ApiError(
        502,
        "KOKORO_GENERATION_FAILED",
        `朗读生成失败 (${response.status})${detail ? `：${detail}` : ""}`,
      );
    }
    const audio = new Uint8Array(await response.arrayBuffer());
    if (audio.byteLength === 0 || audio.byteLength > 50_000_000) {
      throw new ApiError(502, "KOKORO_AUDIO_INVALID", "朗读服务返回了无效音频");
    }

    const filename = cacheFilename(
      article.sourceHash,
      voice,
      this.config.model,
      this.config.format,
    );
    const target = path.join(this.config.audioRoot, filename);
    const temporary = path.join(
      this.config.audioRoot,
      `.${filename}.${randomUUID()}.tmp`,
    );
    writeFileSync(temporary, audio);
    renameSync(temporary, target);
    const publicToken = randomUUID();
    const mimeType =
      response.headers.get("content-type")?.split(";")[0] ||
      formatMime[this.config.format];
    this.db
      .prepare(
        `INSERT INTO article_audio_cache(
           article_id, voice, source_hash, provider, model, format,
           mime_type, filename, public_token, byte_size, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(article_id, voice) DO UPDATE SET
           source_hash = excluded.source_hash,
           provider = excluded.provider,
           model = excluded.model,
           format = excluded.format,
           mime_type = excluded.mime_type,
           filename = excluded.filename,
           public_token = excluded.public_token,
           byte_size = excluded.byte_size,
           created_at = CURRENT_TIMESTAMP`,
      )
      .run(
        articleId,
        voice,
        article.sourceHash,
        this.config.baseUrl,
        this.config.model,
        this.config.format,
        mimeType,
        filename,
        publicToken,
        audio.byteLength,
      );
    if (prior?.filename && prior.filename !== filename) {
      const oldFile = path.join(this.config.audioRoot, path.basename(prior.filename));
      if (oldFile.startsWith(`${path.resolve(this.config.audioRoot)}${path.sep}`)) {
        rmSync(oldFile, { force: true });
      }
    }
    const saved = this.cachedRow(articleId, voice)!;
    return rowMetadata(saved, this.config.voices, false);
  }

  file(publicToken: string) {
    const row = this.db
      .prepare(
        `SELECT mime_type AS mimeType, filename, byte_size AS byteSize
         FROM article_audio_cache WHERE public_token = ?`,
      )
      .get(publicToken) as
      | { mimeType: string; filename: string; byteSize: number }
      | undefined;
    if (!row) return null;
    const filename = path.basename(row.filename);
    const absolutePath = path.resolve(this.config.audioRoot, filename);
    if (
      !absolutePath.startsWith(`${path.resolve(this.config.audioRoot)}${path.sep}`) ||
      !existsSync(absolutePath)
    ) {
      return null;
    }
    return {
      path: absolutePath,
      mimeType: row.mimeType,
      byteSize: statSync(absolutePath).size,
    };
  }
}
