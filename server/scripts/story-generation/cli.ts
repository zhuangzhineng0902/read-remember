import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { ExamId } from "../../../client/src/types";
import {
  classicSourceIds,
  readerStageIds,
  sourceModes,
  storyInterestIds,
  type ClassicSourceId,
  type ReaderStageId,
  type StoryInterestId,
  type StorySourceMode,
} from "./catalog";
import type { StoryRunOptions } from "./pipeline";

type StoryConfigFile = Partial<StoryRunOptions> & { maxRetries?: number };

const defaultOptions: Omit<StoryRunOptions, "log"> = {
  databasePath: path.resolve("data/read-remember.sqlite"),
  ecdictPath: path.resolve("data/ecdict.sqlite"),
  baseUrl: "",
  apiPath: "/chat/completions",
  apiKey: "",
  model: "",
  reviewModel: "",
  structureRepairModel: "",
  interest: "tiger",
  customInterestName: "",
  customInterestSubtitle: "",
  customInterestEmoji: "✨",
  customInterestColor: "#55766D",
  customInterestPrompt: "",
  customActivityPrompt: "用一句英文记录本章最重要的发现，并预测下一集。",
  examId: "middle",
  sourceMode: "original",
  classicId: "",
  sourceTitle: "",
  sourceNotes: "",
  readerStage: "auto",
  episodes: 6,
  importNamespace: "",
  planCandidates: 3,
  episodeCandidates: 5,
  minLexicalCoverage: 0.95,
  temperature: 0.65,
  reviewTemperature: 0.15,
  timeoutMs: 120_000,
  rewriteTimeoutMs: 480_000,
  networkRetries: 2,
  structureRetries: 2,
  dryRun: false,
  force: false,
};

const helpText = `
连续兴趣故事生成器（OpenAI Chat Completions 兼容接口）

用法：
  npm run generate:story-series -- --config config/story-generation.json

参数：
  --interest <id>         支持全部内置栏目，也支持自定义小写 slug
  --interest-name <name>  自定义栏目中文名
  --interest-subtitle <text>
  --interest-emoji <emoji>
  --interest-color <#RRGGBB>
  --interest-prompt <text> 自定义栏目的故事方向（必填）
  --activity-prompt <text> 阅读后的互动任务
  --exam <middle|high|toefl|ielts|toeic>
  --source-mode <original|classic|favorite>
  --classic <${classicSourceIds.join("|")}>
  --source-title <name>   孩子喜欢的作品名或题材名，仅用于提取吸引力
  --source-notes <text>   喜欢的元素，例如魔法学校、伙伴闯关、幽默宠物
  --reader-stage <auto|starter|stage1|stage2|stage3|stage4|stage5|stage6>
  --episodes <2-30>
  --import-namespace <id> 导入 ID 命名空间，供后台定制任务隔离同名系列
  --database <path>
  --ecdict <path>         ECDICT SQLite，用于实测正文高频词覆盖率
  --plan-candidates <2-4> 候选季纲数量，默认 3
  --min-coverage <0.80-1> 最低高频词覆盖率，默认 0.95
  --base-url <url>
  --api-path <path>
  --api-key <key>
  --model <name>
  --review-model <name>   第二遍故事编辑模型，默认与生成模型相同
  --structure-repair-model <name> JSON 结构纠错优先模型；与原模型不同时自动切换
  --episode-candidates <3-5>  每集并行生成的首稿数量，默认 5；统一评分后以最高分稿为主骨架融合
  --timeout-ms <ms>       单次模型网络请求超时，默认 120000
  --rewrite-timeout-ms <ms> 完整正文重写超时，默认 480000
  --network-retries <1-3> 单次结构请求的网络尝试次数，默认 2
  --structure-retries <1-3> JSON 结构纠错次数，默认 2
  --dry-run               只输出故事策划提示，不调用模型或写数据库
  --force                 覆盖同系列、同集已有内容
`.trim();

function flagMap(argv: string[]) {
  const flags = new Map<string, string | true>();
  for (let index = 0; index < argv.length; index++) {
    const value = argv[index];
    if (!value.startsWith("--")) continue;
    const key = value.slice(2);
    const next = argv[index + 1];
    if (next && !next.startsWith("--")) {
      flags.set(key, next);
      index++;
    } else flags.set(key, true);
  }
  return flags;
}

export function storyOptionsFromCli(argv = process.argv.slice(2)): StoryRunOptions {
  const flags = flagMap(argv);
  if (flags.has("help")) {
    console.log(helpText);
    process.exit(0);
  }
  const configPath = String(flags.get("config") ?? "");
  const fileConfig: StoryConfigFile =
    configPath && existsSync(configPath)
      ? (JSON.parse(readFileSync(configPath, "utf8")) as StoryConfigFile)
      : {};
  const from = (flag: string, env: string, key: keyof StoryRunOptions) =>
    flags.get(flag) ?? process.env[env] ?? fileConfig[key];
  const interest = String(from("interest", "STORY_INTEREST", "interest") ?? defaultOptions.interest);
  const examId = String(from("exam", "STORY_EXAM_ID", "examId") ?? defaultOptions.examId);
  const sourceMode = String(from("source-mode", "STORY_SOURCE_MODE", "sourceMode") ?? defaultOptions.sourceMode);
  const classicId = String(from("classic", "STORY_CLASSIC_ID", "classicId") ?? defaultOptions.classicId);
  const sourceTitle = String(from("source-title", "STORY_SOURCE_TITLE", "sourceTitle") ?? defaultOptions.sourceTitle);
  const sourceNotes = String(from("source-notes", "STORY_SOURCE_NOTES", "sourceNotes") ?? defaultOptions.sourceNotes);
  const readerStage = String(from("reader-stage", "STORY_READER_STAGE", "readerStage") ?? defaultOptions.readerStage);
  const customInterestName = String(from("interest-name", "STORY_INTEREST_NAME", "customInterestName") ?? defaultOptions.customInterestName);
  const customInterestSubtitle = String(from("interest-subtitle", "STORY_INTEREST_SUBTITLE", "customInterestSubtitle") ?? defaultOptions.customInterestSubtitle);
  const customInterestEmoji = String(from("interest-emoji", "STORY_INTEREST_EMOJI", "customInterestEmoji") ?? defaultOptions.customInterestEmoji);
  const customInterestColor = String(from("interest-color", "STORY_INTEREST_COLOR", "customInterestColor") ?? defaultOptions.customInterestColor);
  const customInterestPrompt = String(from("interest-prompt", "STORY_INTEREST_PROMPT", "customInterestPrompt") ?? defaultOptions.customInterestPrompt);
  const customActivityPrompt = String(from("activity-prompt", "STORY_ACTIVITY_PROMPT", "customActivityPrompt") ?? defaultOptions.customActivityPrompt);
  if (!/^[a-z][a-z0-9-]{1,39}$/.test(interest)) throw new Error("interest 必须是 2-40 位小写 slug");
  const customInterest = !storyInterestIds.includes(interest as (typeof storyInterestIds)[number]);
  if (customInterest && (!customInterestName.trim() || !customInterestSubtitle.trim() || !customInterestPrompt.trim())) {
    throw new Error("自定义兴趣需要 --interest-name、--interest-subtitle 和 --interest-prompt");
  }
  if (!/^#[0-9a-f]{6}$/i.test(customInterestColor)) throw new Error("interest-color 必须是 #RRGGBB");
  if (!["middle", "high", "toefl", "ielts", "toeic"].includes(examId)) throw new Error(`不支持的考试阶段：${examId}`);
  if (!sourceModes.includes(sourceMode as StorySourceMode)) throw new Error(`不支持的选材模式：${sourceMode}`);
  if (!readerStageIds.includes(readerStage as ReaderStageId)) throw new Error(`不支持的分级档位：${readerStage}`);
  if (sourceMode === "classic" && !classicSourceIds.includes(classicId as ClassicSourceId)) {
    throw new Error(`classic 模式必须通过 --classic 选择：${classicSourceIds.join(", ")}`);
  }
  if (sourceMode === "favorite" && !sourceTitle.trim() && !sourceNotes.trim()) {
    throw new Error("favorite 模式至少需要 --source-title 或 --source-notes");
  }
  const episodes = Number(from("episodes", "STORY_EPISODES", "episodes") ?? defaultOptions.episodes);
  if (!Number.isInteger(episodes) || episodes < 2 || episodes > 30) throw new Error("episodes 必须为 2-30 的整数");
  const planCandidates = Number(
    from("plan-candidates", "STORY_PLAN_CANDIDATES", "planCandidates") ?? defaultOptions.planCandidates,
  );
  if (!Number.isInteger(planCandidates) || planCandidates < 2 || planCandidates > 4) {
    throw new Error("plan-candidates 必须为 2-4 的整数");
  }
  const episodeCandidates = Number(
    from("episode-candidates", "STORY_EPISODE_CANDIDATES", "episodeCandidates")
      ?? defaultOptions.episodeCandidates,
  );
  if (!Number.isInteger(episodeCandidates) || episodeCandidates < 3 || episodeCandidates > 5) {
    throw new Error("episode-candidates 必须为 3-5 的整数");
  }
  const timeoutMs = Number(from("timeout-ms", "STORY_TIMEOUT_MS", "timeoutMs") ?? defaultOptions.timeoutMs);
  if (!Number.isFinite(timeoutMs) || timeoutMs < 10_000 || timeoutMs > 600_000) {
    throw new Error("timeout-ms 必须为 10000-600000 之间的毫秒数");
  }
  const rewriteTimeoutMs = Number(
    from("rewrite-timeout-ms", "STORY_REWRITE_TIMEOUT_MS", "rewriteTimeoutMs") ?? defaultOptions.rewriteTimeoutMs,
  );
  if (!Number.isFinite(rewriteTimeoutMs) || rewriteTimeoutMs < 60_000 || rewriteTimeoutMs > 900_000) {
    throw new Error("rewrite-timeout-ms 必须为 60000-900000 之间的毫秒数");
  }
  const networkRetries = Number(
    from("network-retries", "STORY_NETWORK_RETRIES", "networkRetries")
      ?? fileConfig.maxRetries
      ?? defaultOptions.networkRetries,
  );
  if (!Number.isInteger(networkRetries) || networkRetries < 1 || networkRetries > 3) {
    throw new Error("network-retries 必须为 1-3 的整数");
  }
  const structureRetries = Number(
    from("structure-retries", "STORY_STRUCTURE_RETRIES", "structureRetries") ?? defaultOptions.structureRetries,
  );
  if (!Number.isInteger(structureRetries) || structureRetries < 1 || structureRetries > 3) {
    throw new Error("structure-retries 必须为 1-3 的整数");
  }
  const minLexicalCoverage = Number(
    from("min-coverage", "STORY_MIN_LEXICAL_COVERAGE", "minLexicalCoverage") ?? defaultOptions.minLexicalCoverage,
  );
  if (!Number.isFinite(minLexicalCoverage) || minLexicalCoverage < 0.8 || minLexicalCoverage > 1) {
    throw new Error("min-coverage 必须为 0.80-1 之间的小数");
  }
  return {
    ...defaultOptions,
    ...fileConfig,
    databasePath: path.resolve(String(from("database", "DATABASE_PATH", "databasePath") ?? defaultOptions.databasePath)),
    ecdictPath: path.resolve(String(from("ecdict", "ECDICT_PATH", "ecdictPath") ?? defaultOptions.ecdictPath)),
    baseUrl: String(from("base-url", "STORY_BASE_URL", "baseUrl") ?? ""),
    apiPath: String(from("api-path", "STORY_API_PATH", "apiPath") ?? defaultOptions.apiPath),
    apiKey: String(from("api-key", "STORY_API_KEY", "apiKey") ?? ""),
    model: String(from("model", "STORY_MODEL", "model") ?? ""),
    reviewModel: String(from("review-model", "STORY_REVIEW_MODEL", "reviewModel") ?? ""),
    structureRepairModel: String(from("structure-repair-model", "STORY_STRUCTURE_REPAIR_MODEL", "structureRepairModel") ?? ""),
    interest: interest as StoryInterestId,
    customInterestName,
    customInterestSubtitle,
    customInterestEmoji,
    customInterestColor,
    customInterestPrompt,
    customActivityPrompt,
    examId: examId as ExamId,
    sourceMode: sourceMode as StorySourceMode,
    classicId: classicId as ClassicSourceId | "",
    sourceTitle,
    sourceNotes,
    readerStage: readerStage as ReaderStageId,
    episodes,
    importNamespace: String(from("import-namespace", "STORY_IMPORT_NAMESPACE", "importNamespace") ?? defaultOptions.importNamespace),
    planCandidates,
    episodeCandidates,
    timeoutMs,
    rewriteTimeoutMs,
    networkRetries,
    structureRetries,
    minLexicalCoverage,
    dryRun: flags.has("dry-run") || fileConfig.dryRun === true,
    force: flags.has("force") || fileConfig.force === true,
    log: console.log,
  };
}
