function readableError(error: unknown) {
  if (!(error instanceof Error)) return String(error);
  const cause = error.cause as { code?: string; message?: string } | undefined;
  return [error.name, error.message, cause?.code, cause?.message]
    .filter(Boolean)
    .join(" · ");
}

export function isTransientModelCapacityError(error: unknown) {
  return /(?:\b429\b|\b529\b|overloaded|服务器短暂繁忙|模型服务(?:当前)?繁忙|负载较高|限流|\(2064\)|ECONNRESET|ETIMEDOUT|UND_ERR_|fetch failed|\bterminated\b)/i.test(readableError(error));
}
