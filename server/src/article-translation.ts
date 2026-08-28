import { createHash } from "node:crypto";
import type { AppDatabase } from "./database";
import { ApiError } from "./http";
import {
  serializeArticleTranslation,
  type ArticleTranslationRow,
} from "./serializers";
import {
  runArticleTranslation,
  type TranslationRunOptions,
} from "../scripts/translate-articles";

type TranslationCacheRow = ArticleTranslationRow & { sourceHash: string };

export type ArticleTranslationMetadata = ReturnType<
  typeof serializeArticleTranslation
> & { cached: boolean };

export type ArticleTranslationProvider = {
  readonly enabled: boolean;
  metadata(articleId: string, targetLanguage?: string): ArticleTranslationMetadata | null;
  ensure(
    articleId: string,
    targetLanguage?: string,
  ): Promise<ArticleTranslationMetadata>;
};

function sourceHash(title: string, paragraphs: string[]) {
  return createHash("sha256")
    .update(
      JSON.stringify([
        title.trim(),
        ...paragraphs.map((paragraph) => paragraph.trim()),
      ]),
    )
    .digest("hex");
}

export class ArticleTranslationService implements ArticleTranslationProvider {
  private readonly pending = new Map<
    string,
    Promise<ArticleTranslationMetadata>
  >();

  constructor(
    private readonly db: AppDatabase,
    private readonly options: TranslationRunOptions,
  ) {}

  get enabled() {
    return Boolean(this.options.baseUrl && this.options.model);
  }

  private article(articleId: string) {
    const row = this.db
      .prepare(
        `SELECT title, paragraphs_json AS paragraphsJson
         FROM articles WHERE id = ?`,
      )
      .get(articleId) as
      | { title: string; paragraphsJson: string }
      | undefined;
    if (!row) throw new ApiError(404, "ARTICLE_NOT_FOUND", "文章不存在");
    const paragraphs = JSON.parse(row.paragraphsJson) as string[];
    return {
      ...row,
      paragraphs,
      sourceHash: sourceHash(row.title, paragraphs),
    };
  }

  metadata(articleId: string, targetLanguage = "zh-CN") {
    const article = this.article(articleId);
    const row = this.db
      .prepare(
        `SELECT article_id AS articleId, target_language AS targetLanguage,
          source_hash AS sourceHash, translated_title AS title,
          translated_paragraphs_json AS paragraphsJson,
          provider, model, translated_at AS translatedAt
         FROM article_translations
         WHERE article_id = ? AND target_language = ?`,
      )
      .get(articleId, targetLanguage) as TranslationCacheRow | undefined;
    if (!row || row.sourceHash !== article.sourceHash) return null;
    return {
      ...serializeArticleTranslation(row),
      cached: true,
    };
  }

  ensure(articleId: string, targetLanguage = "zh-CN") {
    const cached = this.metadata(articleId, targetLanguage);
    if (cached) return Promise.resolve(cached);
    if (!this.enabled) {
      return Promise.reject(
        new ApiError(
          503,
          "ARTICLE_TRANSLATION_NOT_CONFIGURED",
          "整篇文章翻译服务尚未配置",
        ),
      );
    }
    const key = `${articleId}:${targetLanguage}`;
    const existing = this.pending.get(key);
    if (existing) return existing;
    const job = this.generate(articleId, targetLanguage).finally(() =>
      this.pending.delete(key),
    );
    this.pending.set(key, job);
    return job;
  }

  private async generate(articleId: string, targetLanguage: string) {
    try {
      await runArticleTranslation({
        ...this.options,
        articleId,
        targetLanguage,
        examId: undefined,
        contentKind: undefined,
        limit: undefined,
        concurrency: 1,
        force: false,
        dryRun: false,
        log: () => undefined,
      });
    } catch (error) {
      throw new ApiError(
        502,
        "ARTICLE_TRANSLATION_FAILED",
        error instanceof Error
          ? `文章翻译失败：${error.message}`
          : "文章翻译暂时不可用",
      );
    }
    const value = this.metadata(articleId, targetLanguage);
    if (!value) {
      throw new ApiError(
        502,
        "ARTICLE_TRANSLATION_INVALID",
        "翻译模型未生成可用的整篇译文",
      );
    }
    return { ...value, cached: false };
  }
}
