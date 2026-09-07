import { jsonrepair } from "jsonrepair";

function stripFence(value: string) {
  return value.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
}

export class ModelJsonParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ModelJsonParseError";
  }
}

function balancedJsonCandidate(value: string, start: number) {
  const stack: string[] = [];
  let inString = false;
  let escaped = false;
  for (let index = start; index < value.length; index++) {
    const character = value[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') {
      inString = true;
      continue;
    }
    if (character === "{" || character === "[") stack.push(character);
    if (character === "}" || character === "]") {
      const expected = character === "}" ? "{" : "[";
      if (stack.pop() !== expected) return null;
      if (stack.length === 0) return value.slice(start, index + 1);
    }
  }
  return null;
}

function jsonCandidates(value: string) {
  const candidates: string[] = [];
  for (let index = 0; index < value.length; index++) {
    if (value[index] !== "{" && value[index] !== "[") continue;
    const candidate = balancedJsonCandidate(value, index);
    if (candidate) candidates.push(candidate);
  }
  return [...new Set(candidates)];
}

function parsedJsonValues(value: string) {
  const cleaned = stripFence(value);
  const values: unknown[] = [];
  const seen = new Set<string>();
  const add = (candidate: string, repair = false) => {
    try {
      const parsed = JSON.parse(repair ? jsonrepair(candidate) : candidate) as unknown;
      const key = JSON.stringify(parsed);
      if (!seen.has(key)) {
        seen.add(key);
        values.push(parsed);
      }
    } catch {}
  };

  add(cleaned);
  const candidates = jsonCandidates(cleaned);
  for (const candidate of candidates) add(candidate);

  // 修复阶段优先尝试信息量更大的片段，可避免说明文字里的 [a-z]
  // 被修成 ["a-z"] 后抢在真正的业务对象之前。
  for (const candidate of [...candidates].sort((left, right) => right.length - left.length)) {
    add(candidate, true);
  }
  add(cleaned, true);
  return values;
}

export function structuredJsonValues(value: string) {
  const expanded: unknown[] = [];
  const seen = new Set<string>();
  const queue = parsedJsonValues(value).map((item) => ({ item, depth: 0 }));
  while (queue.length) {
    const current = queue.shift();
    if (!current) break;
    let key: string | undefined;
    try {
      key = JSON.stringify(current.item);
    } catch {
      continue;
    }
    if (key === undefined || seen.has(key)) continue;
    seen.add(key);
    expanded.push(current.item);
    if (current.depth >= 3) continue;
    if (Array.isArray(current.item)) {
      const array = current.item;
      if (array.every((item) => typeof item === "string")) {
        queue.push({ item: array.join(""), depth: current.depth + 1 });
      }
      const pairs = array.filter(
        (item): item is [string, unknown] => Array.isArray(item) && item.length === 2 && typeof item[0] === "string",
      );
      if (pairs.length === array.length && pairs.length) {
        queue.push({ item: Object.fromEntries(pairs), depth: current.depth + 1 });
      }
      if (
        array.length >= 2
        && array.length % 2 === 0
        && array.every((item, index) => index % 2 === 1 || typeof item === "string")
      ) {
        const flatPairs = Array.from({ length: array.length / 2 }, (_, index) => [
          array[index * 2] as string,
          array[index * 2 + 1],
        ] as const);
        queue.push({ item: Object.fromEntries(flatPairs), depth: current.depth + 1 });
      }
      const objects = array.filter(
        (item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item),
      );
      if (objects.length) {
        queue.push({ item: Object.assign({}, ...objects), depth: current.depth + 1 });
        for (const keyName of ["key", "field", "name"] as const) {
          const keyed = objects.filter(
            (item) => typeof item[keyName] === "string" && "value" in item,
          );
          if (keyed.length === objects.length) {
            queue.push({
              item: Object.fromEntries(keyed.map((item) => [item[keyName] as string, item.value])),
              depth: current.depth + 1,
            });
          }
        }
      }
      for (const item of array) queue.push({ item, depth: current.depth + 1 });
      continue;
    }
    if (typeof current.item === "string") {
      const nested = current.item.trim();
      if (nested.startsWith("{") || nested.startsWith("[") || nested.startsWith("```")) {
        for (const item of parsedJsonValues(nested)) {
          queue.push({ item, depth: current.depth + 1 });
        }
      }
      continue;
    }
    if (!current.item || typeof current.item !== "object") continue;
    const record = current.item as Record<string, unknown>;
    for (const wrapper of ["data", "result", "output", "response", "content"]) {
      if (wrapper in record) queue.push({ item: record[wrapper], depth: current.depth + 1 });
    }
  }
  return expanded;
}

export function parseJson(value: string) {
  const values = parsedJsonValues(value);
  if (values.length) return values[0];
  const candidates = jsonCandidates(stripFence(value));
  throw new ModelJsonParseError(
    candidates.length
      ? `模型返回了 ${candidates.length} 个类似 JSON 的片段，但都无法解析`
      : "模型响应中没有完整 JSON 对象或数组",
  );
}

export function jsonParseFailure(value: string) {
  const cleaned = stripFence(value);
  const candidates = jsonCandidates(cleaned);
  return new ModelJsonParseError(
    candidates.length
      ? `模型返回了 ${candidates.length} 个类似 JSON 的片段，但都无法解析`
      : "模型响应中没有完整 JSON 对象或数组",
  );
}

export function structuredValueShape(value: unknown): string {
  if (Array.isArray(value)) return `array(${value.length})`;
  if (value === null) return "null";
  if (typeof value === "object") {
    const keys = Object.keys(value as Record<string, unknown>);
    return `object{${keys.slice(0, 8).join(",")}${keys.length > 8 ? ",…" : ""}}`;
  }
  return typeof value;
}

