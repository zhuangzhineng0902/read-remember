import { existsSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";
import type { DatabaseSync as DatabaseSyncType } from "node:sqlite";
import {
  ArticleAudioService,
  type ArticleAudioConfig,
} from "../src/article-audio";
import { getConfig } from "../src/config";

const { DatabaseSync } = createRequire(import.meta.url)(
  "node:sqlite",
) as typeof import("node:sqlite");

type ContentKind = "exam" | "interest";

export type ArticleAudioGenerationOptions = ArticleAudioConfig & {
  databasePath: string;
  voiceIds: string[];
  concurrency: number;
  maxRetries: number;
  examId?: string;
  contentKind?: ContentKind;
  limit?: number;
  dryRun: boolean;
  progressEvery: number;
  shouldStop?: () => boolean;
  log?: (message: string) => void;
};

export type ArticleAudioGenerationResult = {
  articles: number;
  voices: number;
  tasks: number;
  generated: number;
  cached: number;
  failed: number;
  pending: number;
  interrupted: boolean;
  elapsedMs: number;
};

type ArticleTask = { articleId: string; title: string; voice: string };

const helpText = `
文章整篇朗读批处理（Kokoro + SQLite/音频文件缓存）

用法：
  npm run generate:article-audio

常用参数：
  --database <path>        SQLite 路径，默认读取 DATABASE_PATH
  --audio-root <path>      音频目录，默认读取 KOKORO_AUDIO_ROOT
  --voice <id>             只生成一个音色，默认 KOKORO_DEFAULT_VOICE
  --voices <ids|all>       逗号分隔多个音色；all 表示配置中的全部音色
  --exam <id>              仅处理 toefl/ielts/toeic/middle/high
  --kind <exam|interest>   仅处理考试文章或兴趣文章
  --limit <n>              最多选择多少篇文章
  --concurrency <n>        并发数，CPU 模式建议保持 1
  --retries <n>            单篇失败后的重试次数，默认 2
  --progress-every <n>     每处理多少个任务输出一次进度，默认 10
  --dry-run                只统计缓存和待生成数量，不调用 Kokoro
  --help                   显示帮助

脚本默认只生成一个默认音色。已有有效缓存会跳过，可随时中断并重新运行续传。
`.trim();

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

function integerValue(
  value: string | undefined,
  fallback: number,
  name: string,
  minimum: number,
) {
  if (value === undefined || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum) {
    throw new Error(`${name} 必须是不小于 ${minimum} 的整数`);
  }
  return parsed;
}

function selectedVoiceIds(
  requested: string | undefined,
  fallback: string,
  voices: ArticleAudioConfig["voices"],
) {
  const ids = requested === "all"
    ? voices.map((voice) => voice.id)
    : (requested || fallback)
        .split(",")
        .map((voice) => voice.trim())
        .filter(Boolean);
  const uniqueIds = [...new Set(ids)];
  const configured = new Set(voices.map((voice) => voice.id));
  const invalid = uniqueIds.filter((voice) => !configured.has(voice));
  if (invalid.length) {
    throw new Error(`未配置的 Kokoro 音色：${invalid.join(", ")}`);
  }
  if (!uniqueIds.length) throw new Error("至少需要选择一个 Kokoro 音色");
  return uniqueIds;
}

export function articleAudioOptionsFromCli(
  argv: string[],
): ArticleAudioGenerationOptions {
  const { values, flags } = parsedCli(argv);
  if (flags.has("help")) {
    console.log(helpText);
    process.exit(0);
  }
  const config = getConfig();
  const contentKind = values.get("kind") as ContentKind | undefined;
  if (contentKind && contentKind !== "exam" && contentKind !== "interest") {
    throw new Error("--kind 只能是 exam 或 interest");
  }
  const requestedVoices = values.get("voices") ?? values.get("voice");
  return {
    databasePath: path.resolve(values.get("database") ?? config.databasePath),
    baseUrl: values.get("base-url") ?? config.kokoroBaseUrl,
    apiPath: values.get("api-path") ?? config.kokoroApiPath,
    apiKey: values.get("api-key") ?? config.kokoroApiKey,
    model: values.get("model") ?? config.kokoroModel,
    format: config.kokoroFormat,
    audioRoot: path.resolve(values.get("audio-root") ?? config.kokoroAudioRoot),
    timeoutMs: integerValue(
      values.get("timeout-ms"),
      config.kokoroTimeoutMs,
      "timeout-ms",
      1_000,
    ),
    maxInputCharacters: config.kokoroMaxInputCharacters,
    defaultVoice: config.kokoroDefaultVoice,
    voices: config.kokoroVoices,
    voiceIds: selectedVoiceIds(
      requestedVoices,
      config.kokoroDefaultVoice,
      config.kokoroVoices,
    ),
    concurrency: integerValue(values.get("concurrency"), 1, "concurrency", 1),
    maxRetries: integerValue(values.get("retries"), 2, "retries", 0),
    examId: values.get("exam"),
    contentKind,
    limit: values.has("limit")
      ? integerValue(values.get("limit"), 0, "limit", 1)
      : undefined,
    dryRun: flags.has("dry-run"),
    progressEvery: integerValue(
      values.get("progress-every"),
      10,
      "progress-every",
      1,
    ),
  };
}

function selectedArticles(
  db: DatabaseSyncType,
  options: ArticleAudioGenerationOptions,
) {
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
    .prepare(`SELECT id, title FROM articles ${where} ORDER BY id ${limit}`)
    .all(...params) as unknown as Array<{ id: string; title: string }>;
}

function durationLabel(milliseconds: number) {
  const seconds = Math.max(0, Math.round(milliseconds / 1_000));
  const hours = Math.floor(seconds / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  const rest = seconds % 60;
  return hours
    ? `${hours}小时${String(minutes).padStart(2, "0")}分`
    : minutes
      ? `${minutes}分${String(rest).padStart(2, "0")}秒`
      : `${rest}秒`;
}

function wait(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function generateWithRetry(
  service: ArticleAudioService,
  task: ArticleTask,
  maxRetries: number,
) {
  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      return await service.ensure(task.articleId, task.voice);
    } catch (error) {
      lastError = error;
      if (attempt < maxRetries) await wait(Math.min(8_000, 750 * 2 ** attempt));
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

export async function runArticleAudioGeneration(
  options: ArticleAudioGenerationOptions,
): Promise<ArticleAudioGenerationResult> {
  const log = options.log ?? console.log;
  if (!existsSync(options.databasePath)) {
    throw new Error(`数据库不存在：${options.databasePath}`);
  }
  mkdirSync(options.audioRoot, { recursive: true });
  const db = new DatabaseSync(options.databasePath);
  const startedAt = Date.now();
  try {
    db.exec("PRAGMA foreign_keys = ON");
    db.exec("PRAGMA busy_timeout = 10000");
    const articles = selectedArticles(db, options);
    const tasks = articles.flatMap((article) =>
      options.voiceIds.map((voice) => ({
        articleId: article.id,
        title: article.title,
        voice,
      })),
    );
    const service = new ArticleAudioService(db, options);
    const result: ArticleAudioGenerationResult = {
      articles: articles.length,
      voices: options.voiceIds.length,
      tasks: tasks.length,
      generated: 0,
      cached: 0,
      failed: 0,
      pending: 0,
      interrupted: false,
      elapsedMs: 0,
    };
    log(
      `已选择 ${articles.length} 篇文章 × ${options.voiceIds.length} 个音色，共 ${tasks.length} 个朗读任务。`,
    );
    log(`音色：${options.voiceIds.join(", ")}；并发：${options.concurrency}。`);

    if (options.dryRun) {
      for (const task of tasks) {
        try {
          if (service.metadata(task.articleId, task.voice)) result.cached += 1;
          else result.pending += 1;
        } catch (error) {
          result.failed += 1;
          log(
            `无法检查 ${task.articleId} (${task.voice})：${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
      result.elapsedMs = Date.now() - startedAt;
      log(
        `Dry run：缓存 ${result.cached}，待生成 ${result.pending}，无法处理 ${result.failed}。`,
      );
      return result;
    }
    if (!service.enabled) {
      throw new Error("Kokoro 尚未配置，请设置 KOKORO_BASE_URL");
    }

    let cursor = 0;
    let completed = 0;
    const errors: string[] = [];
    const progress = () => {
      const elapsed = Date.now() - startedAt;
      const remaining = tasks.length - completed;
      const eta = completed ? (elapsed / completed) * remaining : 0;
      log(
        `[${completed}/${tasks.length}] 新生成 ${result.generated}，缓存命中 ${result.cached}，失败 ${result.failed}` +
          (remaining ? `，预计剩余 ${durationLabel(eta)}` : ""),
      );
    };
    const workers = Array.from(
      { length: Math.min(options.concurrency, Math.max(1, tasks.length)) },
      async () => {
        while (cursor < tasks.length) {
          if (options.shouldStop?.()) {
            result.interrupted = true;
            return;
          }
          const taskIndex = cursor;
          cursor += 1;
          const task = tasks[taskIndex];
          try {
            const audio = await generateWithRetry(
              service,
              task,
              options.maxRetries,
            );
            if (audio.cached) result.cached += 1;
            else result.generated += 1;
          } catch (error) {
            result.failed += 1;
            const message = error instanceof Error ? error.message : String(error);
            errors.push(`${task.articleId} (${task.voice}): ${message}`);
            log(`失败：${task.title} [${task.voice}]：${message}`);
          } finally {
            completed += 1;
            if (
              completed === tasks.length ||
              completed % options.progressEvery === 0
            ) {
              progress();
            }
          }
        }
      },
    );
    await Promise.all(workers);
    result.pending = Math.max(0, tasks.length - completed);
    result.elapsedMs = Date.now() - startedAt;
    if (result.interrupted) {
      log(`已安全停止，剩余 ${result.pending} 个任务；重新运行即可续传。`);
    } else {
      log(
        `完成：新生成 ${result.generated}，缓存命中 ${result.cached}，失败 ${result.failed}，耗时 ${durationLabel(result.elapsedMs)}。`,
      );
    }
    if (errors.length) {
      throw new Error(
        `${errors.length} 个任务失败；成功音频已保存，可直接重跑。\n${errors
          .slice(0, 10)
          .join("\n")}`,
      );
    }
    return result;
  } finally {
    db.close();
  }
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isMain) {
  const localEnvFile = path.resolve(process.cwd(), ".env");
  if (existsSync(localEnvFile)) loadEnvFile(localEnvFile);
  let stopRequested = false;
  let interruptCount = 0;
  process.on("SIGINT", () => {
    interruptCount += 1;
    if (interruptCount > 1) process.exit(130);
    stopRequested = true;
    console.log("\n收到停止请求：当前任务结束后保存进度。再次按 Ctrl+C 将立即退出。");
  });
  try {
    const options = articleAudioOptionsFromCli(process.argv.slice(2));
    options.shouldStop = () => stopRequested;
    runArticleAudioGeneration(options).catch((error) => {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    });
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
