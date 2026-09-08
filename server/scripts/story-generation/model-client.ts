import { z } from "zod";
import { Agent, fetch } from "undici";
import { isTransientModelCapacityError } from "./model-errors";
import {
  jsonParseFailure,
  structuredJsonValues,
  structuredValueShape,
} from "./model-response";

export type StoryModelOptions = {
  baseUrl: string;
  apiPath: string;
  apiKey: string;
  model: string;
  reviewModel: string;
  structureRepairModel: string;
  temperature: number;
  reviewTemperature: number;
  timeoutMs: number;
  rewriteTimeoutMs: number;
  networkRetries: number;
  structureRetries: number;
  log: (message: string) => void;
};

function endpoint(options: StoryModelOptions) {
  if (/^https?:\/\//.test(options.apiPath)) return options.apiPath;
  return `${options.baseUrl.replace(/\/$/, "")}/${options.apiPath.replace(/^\//, "")}`;
}

export function modelRequestError(error: unknown) {
  if (!(error instanceof Error)) return String(error);
  const cause = error.cause as { code?: string; message?: string } | undefined;
  return [error.name, error.message, cause?.code, cause?.message]
    .filter(Boolean)
    .join(" · ")
    .slice(0, 500);
}

export type ModelCallPolicy = {
  timeoutMs?: number;
  networkRetries?: number;
  structureRetries?: number;
  maxCompletionTokens?: number;
  disableThinking?: boolean;
  recoverPartial?: (value: unknown, issues: string) => Promise<unknown | null>;
};

function schemaIssueCount<T>(result: z.ZodSafeParseResult<T>) {
  return result.success ? 0 : result.error.issues.length;
}

/**
 * Some OpenAI-compatible JSON-object providers emit a valid root object and
 * then place one omitted root array in a second JSON fragment. Reattach only
 * fragments that make the caller's actual Zod schema strictly closer to valid;
 * the schema, rather than field-name guesses, decides whether a merge is safe.
 */
export function recoverStructuredComposite<T>(values: unknown[], schema: z.ZodType<T>): T | null {
  const objects = values.filter(
    (value): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value),
  );
  const fragments = values.filter((value) => Array.isArray(value) || (value && typeof value === "object"));
  for (const source of objects) {
    let candidate: Record<string, unknown> = { ...source };
    let result = schema.safeParse(candidate);
    if (result.success) return result.data;
    for (let pass = 0; pass < 4; pass++) {
      const missingRootFields: string[] = result.error.issues.flatMap((issue): string[] =>
        issue.path.length === 1
        && typeof issue.path[0] === "string"
        && /received undefined/.test(issue.message)
          ? [issue.path[0]]
          : []
      );
      let best: { candidate: Record<string, unknown>; result: z.ZodSafeParseResult<T> } | null = null;
      for (const field of [...new Set<string>(missingRootFields)]) {
        for (const fragment of fragments) {
          if (fragment === source || fragment === candidate) continue;
          const trial: Record<string, unknown> = { ...candidate, [field]: fragment };
          const trialResult = schema.safeParse(trial);
          if (
            !best
            || schemaIssueCount(trialResult) < schemaIssueCount(best.result)
          ) {
            best = { candidate: trial, result: trialResult };
          }
        }
      }
      if (!best || schemaIssueCount(best.result) >= schemaIssueCount(result)) break;
      candidate = best.candidate;
      result = best.result;
      if (result.success) return result.data;
    }
  }
  return null;
}

export const modelTokenBudgets = {
  plan: 10240,
  episode: 8192,
  creativeEpisode: 16384,
  critique: 8192,
  questions: 2048,
} as const;

export function creativeDraftModelPolicy(
  options: Pick<StoryModelOptions, "rewriteTimeoutMs">,
): ModelCallPolicy {
  return {
    timeoutMs: options.rewriteTimeoutMs,
    networkRetries: 1,
    structureRetries: 2,
    maxCompletionTokens: modelTokenBudgets.episode,
    disableThinking: true,
  };
}

export function semanticRewriteModelPolicy(
  options: Pick<StoryModelOptions, "rewriteTimeoutMs">,
): ModelCallPolicy {
  return {
    timeoutMs: options.rewriteTimeoutMs,
    networkRetries: 2,
    structureRetries: 2,
    maxCompletionTokens: modelTokenBudgets.episode,
    disableThinking: true,
  };
}

export function semanticPlanningModelPolicy(
  options: Pick<StoryModelOptions, "rewriteTimeoutMs">,
): ModelCallPolicy {
  return {
    timeoutMs: options.rewriteTimeoutMs,
    networkRetries: 2,
    structureRetries: 2,
    maxCompletionTokens: modelTokenBudgets.episode,
    disableThinking: true,
  };
}

class ModelContentError extends Error {
  constructor(
    message: string,
    readonly retryableAsStructure: boolean,
    readonly finishReason = "unknown",
    readonly reasoningTail = "",
  ) {
    super(message);
    this.name = "ModelContentError";
  }
}

class ModelHttpError extends Error {
  constructor(message: string, readonly retryable: boolean) {
    super(message);
    this.name = "ModelHttpError";
  }
}

export function structureModelForAttempt(
  options: Pick<StoryModelOptions, "model" | "reviewModel" | "structureRepairModel">,
  initialModel: string,
  attempt: number,
) {
  if (attempt > 1 && options.structureRepairModel) {
    return options.structureRepairModel;
  }
  const sequence = [
    initialModel,
    options.structureRepairModel,
    initialModel === options.model ? options.reviewModel : options.model,
    options.reviewModel,
    options.model,
  ].filter((candidate, index, candidates) => Boolean(candidate) && candidates.indexOf(candidate) === index);
  return sequence[(Math.max(1, attempt) - 1) % sequence.length] || initialModel;
}

function modelContentText(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value.map((part) => {
      if (typeof part === "string") return part;
      if (!part || typeof part !== "object") return "";
      const record = part as Record<string, unknown>;
      return typeof record.text === "string"
        ? record.text
        : typeof record.content === "string"
          ? record.content
          : "";
    }).join("");
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return typeof record.text === "string" ? record.text : "";
  }
  return "";
}

function modelDispatcher(timeoutMs: number) {
  const transportTimeoutMs = timeoutMs + 30_000;
  return new Agent({
    headersTimeout: transportTimeoutMs,
    bodyTimeout: transportTimeoutMs,
  });
}

export async function readStreamingModelContent(response: Awaited<ReturnType<typeof fetch>>, log?: (message: string) => void) {
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("text/event-stream")) {
    let payload: {
      choices?: Array<{ message?: { content?: unknown }; text?: unknown; finish_reason?: string | null }>;
      output_sensitive?: boolean;
      base_resp?: { status_code?: number; status_msg?: string };
    };
    try {
      payload = await response.json() as typeof payload;
    } catch {
      throw new ModelContentError("模型返回了无法解析的非流式 JSON", true);
    }
    if (payload.base_resp?.status_code && payload.base_resp.status_code !== 0) {
      throw new ModelContentError(
        `模型业务响应失败（status=${payload.base_resp.status_code}:${payload.base_resp.status_msg || "empty"}）`,
        false,
      );
    }
    const choice = payload.choices?.[0];
    const content = modelContentText(choice?.message?.content) || modelContentText(choice?.text);
    if (choice?.finish_reason === "length") log?.(`模型输出触及 Token 上限（finish=length，正文字符 ${content.length}），进入结构和内容完整性检查。`);
    if (!content) {
      const filtered = payload.output_sensitive || choice?.finish_reason === "content_filter";
      throw new ModelContentError(
        `模型响应中没有文本内容（finish=${choice?.finish_reason ?? "unknown"}，`
        + `status=${payload.base_resp?.status_code ?? "unknown"}:${payload.base_resp?.status_msg || "empty"}）`,
        !filtered,
      );
    }
    return content;
  }
  if (!response.body) throw new ModelContentError("模型流式响应中没有可读取内容", true);

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let content = "";
  let reasoningCharacters = 0;
  let reasoningTail = "";
  let eventCount = 0;
  let finishReason = "unknown";
  let statusCode: number | string = "unknown";
  let statusMessage = "";
  let outputSensitive = false;
  const consumeEvent = (event: string) => {
    const data = event
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trim())
      .join("\n");
    if (!data || data === "[DONE]") return;
    let payload: {
      choices?: Array<{
        delta?: { content?: unknown; text?: unknown; reasoning_content?: unknown; reasoning_details?: unknown };
        message?: { content?: unknown };
        text?: unknown;
        finish_reason?: string | null;
      }>;
      output_sensitive?: boolean;
      base_resp?: { status_code?: number; status_msg?: string };
      error?: { code?: string | number; message?: string };
    };
    try {
      payload = JSON.parse(data) as typeof payload;
    } catch {
      throw new ModelContentError("模型返回了无法解析的 SSE 数据事件", true);
    }
    eventCount += 1;
    outputSensitive ||= payload.output_sensitive === true;
    statusCode = payload.base_resp?.status_code ?? statusCode;
    statusMessage = payload.error?.message ?? payload.base_resp?.status_msg ?? statusMessage;
    const choice = payload.choices?.[0];
    if (choice?.finish_reason) finishReason = choice.finish_reason;
    content += modelContentText(choice?.delta?.content)
      || modelContentText(choice?.delta?.text)
      || modelContentText(choice?.message?.content)
      || modelContentText(choice?.text);
    const reasoningParts = [modelContentText(choice?.delta?.reasoning_content)];
    if (Array.isArray(choice?.delta?.reasoning_details)) {
      reasoningParts.push(...choice.delta.reasoning_details.map(modelContentText));
    }
    for (const reasoningPart of reasoningParts) {
      reasoningCharacters += reasoningPart.length;
      if (reasoningPart) reasoningTail = `${reasoningTail}${reasoningPart}`.slice(-16_000);
    }
  };

  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    buffer += decoder.decode(chunk.value, { stream: true });
    const events = buffer.split(/\r?\n\r?\n/);
    buffer = events.pop() ?? "";
    for (const event of events) consumeEvent(event);
  }
  buffer += decoder.decode();
  if (buffer.trim()) consumeEvent(buffer);
  if (typeof statusCode === "number" && statusCode !== 0) {
    throw new ModelContentError(
      `模型业务响应失败（status=${statusCode}:${statusMessage || "empty"}）`,
      false,
    );
  }
  if (!content) {
    throw new ModelContentError(
      `模型流式响应中没有文本内容（finish=${finishReason}，events=${eventCount}，`
      + `reasoningChars=${reasoningCharacters}，status=${statusCode}:${statusMessage || "empty"}）`,
      !outputSensitive && finishReason !== "content_filter",
      finishReason,
      reasoningTail,
    );
  }
  if (finishReason === "length") log?.(`模型输出触及 Token 上限（finish=length，正文字符 ${content.length}，events=${eventCount}），进入结构和内容完整性检查。`);
  return content;
}

async function callModelText(
  options: StoryModelOptions,
  system: string,
  user: string,
  model = options.model,
  temperature = options.temperature,
  timeoutMs = options.timeoutMs,
  networkRetries = options.networkRetries,
  maxCompletionTokens: number = modelTokenBudgets.episode,
  disableThinking = false,
) {
  let lastError: unknown;
  let capacityRetries = 0;
  for (let attempt = 1; attempt <= networkRetries; attempt++) {
    const dispatcher = modelDispatcher(timeoutMs);
    try {
      const response = await fetch(endpoint(options), {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(options.apiKey ? { authorization: `Bearer ${options.apiKey}` } : {}),
        },
        body: JSON.stringify({
          model,
          temperature,
          response_format: { type: "json_object" },
          stream: true,
          stream_options: { include_usage: true },
          reasoning_split: true,
          ...(disableThinking ? { thinking: { type: "disabled" } } : {}),
          max_completion_tokens: maxCompletionTokens,
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
        }),
        signal: AbortSignal.timeout(timeoutMs),
        dispatcher,
      });
      if (!response.ok) {
        const responseText = (await response.text()).slice(0, 1000);
        throw new ModelHttpError(
          `模型接口返回 ${response.status}: ${responseText}`,
          [408, 409, 425, 429, 500, 502, 503, 504, 529].includes(response.status),
        );
      }
      return await readStreamingModelContent(response, options.log);
    } catch (error) {
      lastError = error;
      if (error instanceof ModelHttpError && /(?:\b429\b|\b529\b)/.test(error.message) && capacityRetries < 2) {
        capacityRetries += 1;
        options.log(`模型容量不足，保留当前请求输入，等待 ${capacityRetries * 5} 秒后恢复（容量重试 ${capacityRetries}/2，不占质量重试）。`);
        await new Promise((resolve) => setTimeout(resolve, capacityRetries * 5_000));
        attempt -= 1;
        continue;
      }
      const contentFailure = error instanceof ModelContentError;
      const retryableHttp = !(error instanceof ModelHttpError) || error.retryable;
      const willRetry = !contentFailure && retryableHttp && attempt < networkRetries;
      options.log(
        `${contentFailure ? "模型内容响应待恢复" : `模型网络请求 ${attempt}/${networkRetries} 失败`}`
        + `（model=${model}，thinking=${disableThinking ? "disabled" : "enabled"}，maxTokens=${maxCompletionTokens}）：`
        + `${modelRequestError(error)}`
        + (willRetry ? "；正在重试…" : ""),
      );
      if (contentFailure || !retryableHttp) throw error;
      if (willRetry) await new Promise((resolve) => setTimeout(resolve, attempt * 800));
    } finally {
      await dispatcher.close().catch(() => undefined);
    }
  }
  throw lastError;
}

export async function callStructured<T>(
  options: StoryModelOptions,
  schema: z.ZodType<T>,
  system: string,
  user: string,
  model = options.model,
  temperature = options.temperature,
  policy: ModelCallPolicy = {},
) {
  let prompt = user;
  let lastError: Error | null = null;
  let lastShape = "无候选";
  const structureRetries = policy.structureRetries ?? options.structureRetries;
  structureAttempt: for (let attempt = 1; attempt <= structureRetries; attempt++) {
    const correctionModel = structureModelForAttempt(
      options,
      model,
      attempt,
    );
    const correctionTemperature = attempt === 1
      ? temperature
      : Math.min(temperature, options.reviewTemperature, 0.2);
    let content = "";
    let recoveryPrompt = prompt;
    for (let recoveryAttempt = 0; recoveryAttempt <= 2; recoveryAttempt++) {
      const recoveringEmptyContent = recoveryAttempt > 0;
      const requestModel = recoveringEmptyContent
        ? options.structureRepairModel || options.reviewModel || correctionModel
        : correctionModel;
      const requestTemperature = recoveringEmptyContent
        ? Math.min(options.reviewTemperature, 0.15)
        : correctionTemperature;
      const requestMaxTokens = recoveringEmptyContent
        ? Math.min(policy.maxCompletionTokens ?? modelTokenBudgets.episode, 12_288)
        : policy.maxCompletionTokens ?? modelTokenBudgets.episode;
      try {
        content = await callModelText(
          options,
          system,
          recoveryPrompt,
          requestModel,
          requestTemperature,
          policy.timeoutMs ?? options.timeoutMs,
          recoveringEmptyContent ? 1 : policy.networkRetries ?? options.networkRetries,
          requestMaxTokens,
          policy.disableThinking || attempt > 1 || recoveringEmptyContent,
        );
        break;
      } catch (error) {
        if (!(error instanceof ModelContentError) || !error.retryableAsStructure) throw error;
        lastError = error;
        if (recoveryAttempt < 2) {
          const reasoningHint = error.reasoningTail
            ? `\n\n上一次推理的末尾如下，仅作为未完成草稿参考，不得原样复述：\n${error.reasoningTail}`
            : "";
          const fallbackModel = options.structureRepairModel || options.reviewModel || correctionModel;
          options.log(
            `模型只产生推理且未返回正文（finish=${error.finishReason}），`
            + `已自动切换到 ${fallbackModel} 的直接输出模式`
            + `（恢复 ${recoveryAttempt + 1}/2）…`,
          );
          recoveryPrompt = `${prompt}${reasoningHint}\n\n上一次已完成分析但没有留下最终文本。现在禁止继续分析；立即根据原任务输出一份字段完整、内容精炼的最终 JSON 对象。只输出 JSON，不要 Markdown、解释或第二个对象。`;
          continue;
        }
        if (attempt < structureRetries) {
          options.log(
            `模型内容恢复已用完，进入第 ${attempt + 1}/${structureRetries} 次结构重建…`,
          );
          prompt = `${user}\n\n前一轮响应只产生了推理或空增量。请直接重建并返回一份完整紧凑的 JSON 对象。`;
          continue structureAttempt;
        }
        throw new Error(`模型连续只返回推理而无最终文本，自动直输恢复已用完：${error.message}`);
      }
    }
    const values = structuredJsonValues(content);
    lastShape = values.slice(0, 8).map(structuredValueShape).join(" → ") || "无候选";
    if (!values.length) {
      lastError = jsonParseFailure(content);
      if (attempt < structureRetries) {
        options.log(
          `模型结构输出 ${attempt}/${structureRetries} 无法解析，下一次切换到 `
          + `${structureModelForAttempt(options, model, attempt + 1)} 重新输出严格 JSON…`,
        );
      }
      prompt = `${user}\n\n上一次响应无法作为 JSON 解析：${lastError.message}。请重新输出一份完整 JSON：只能有一个顶层对象，键名和字符串必须使用英文双引号，数组必须填真实值；禁止输出 Markdown、解释、正则示例（如 [a-z]）、JSON Schema、注释或第二个对象。`;
      continue;
    }

    const attempts = values.map((value) => ({ value, result: schema.safeParse(value) }));
    const valid = attempts.find((entry) => entry.result.success);
    if (valid?.result.success) return valid.result.data;
    const composite = recoverStructuredComposite(values, schema);
    if (composite) {
      options.log("模型把根对象和字段数组拆成了多个 JSON 片段；已按业务 Schema 在本地无损拼合，不占用结构重试。");
      return composite;
    }
    const objectAttempts = attempts.filter(
      (entry) => Boolean(entry.value) && typeof entry.value === "object" && !Array.isArray(entry.value),
    );
    const closestPool = objectAttempts.length ? objectAttempts : attempts;
    const closest = closestPool.reduce((best, entry) => {
      const issueCount = entry.result.success ? 0 : entry.result.error.issues.length;
      const bestIssueCount = best.result.success ? 0 : best.result.error.issues.length;
      return issueCount < bestIssueCount ? entry : best;
    });
    if (closest.result.success) return closest.result.data;
    lastError = closest.result.error;
    const issues = closest.result.error.issues
      .slice(0, 12)
      .map((issue) => `${issue.path.join(".") || "root"}: ${issue.message}`)
      .join("；");
    if (attempt === structureRetries && policy.recoverPartial) {
      try {
        const recoveredValue = await policy.recoverPartial(closest.value, issues);
        if (recoveredValue !== null) {
          const recovered = schema.safeParse(recoveredValue);
          if (recovered.success) return recovered.data;
          lastError = recovered.error;
          options.log(
            `模型局部结果已补全，但合并后的结构仍不合法：${recovered.error.issues
              .slice(0, 8)
              .map((issue) => `${issue.path.join(".") || "root"}: ${issue.message}`)
              .join("；")}`,
          );
        }
      } catch (error) {
        // A partial JSON value can be perfectly recoverable while the small
        // follow-up request fails because the provider is overloaded. Do not
        // relabel that infrastructure failure as a schema failure: callers
        // need the original 429/529 signal to stop retries and preserve the
        // current checkpoint.
        if (isTransientModelCapacityError(error)) throw error;
        lastError = new Error(`正文局部恢复失败：${modelRequestError(error)}`);
        options.log(lastError.message);
      }
    }
    const previousValue = JSON.stringify(closest.value).slice(0, 16_000);
    if (attempt < structureRetries) {
      options.log(
        `模型结构输出 ${attempt}/${structureRetries} 不完整，下一次切换到 `
        + `${structureModelForAttempt(options, model, attempt + 1)} 并携带字段错误自动修正：${issues}`,
      );
    }
    const rootReminder = Array.isArray(closest.value)
      ? "最外层类型错误：第一个非空字符必须是 {，最后一个非空字符必须是 }；禁止用 [ 和 ] 包住结果。"
      : "最外层必须保持为一个 JSON 对象。";
    prompt = `${user}\n\n你上一次实际返回的是：\n${previousValue}\n\n结构校验错误：${issues}。${rootReminder} 请以这份实际返回为基础，补齐并修正所有字段。不要使用省略号或占位值；只返回一份完整合法 JSON 对象。`;
  }
  if (lastError) {
    throw new Error(
      `模型连续 ${structureRetries} 次未通过所需对象结构或内容约束（候选形状：${lastShape}）：${lastError.message}`,
    );
  }
  throw new Error("模型没有返回符合结构的 JSON");
}
