import { z } from "zod";

export const storyIssueDomainSchema = z.enum([
  "narrative",
  "language",
  "lexical",
  "metadata",
  "questions",
  "transport",
]);
export const storyIssueSchema = z.object({
  code: z.string().trim().min(1).max(80),
  domain: storyIssueDomainSchema,
  field: z.string().trim().min(1).max(160).optional(),
  message: z.string().trim().min(1).max(1000),
  evidence: z.string().trim().min(1).max(1000).optional(),
});
export type StoryIssue = z.infer<typeof storyIssueSchema>;

export const localRepairAttemptsSchema = z.object({
  metadata: z.number().int().min(0).max(2),
  lexical: z.number().int().min(0).max(1),
});
export type LocalRepairAttempts = z.infer<typeof localRepairAttemptsSchema>;
export type RepairKind = "none" | "metadata" | "lexical" | "narrative";
type RepairQuality = {
  blockingIssues: string[];
  blockingIssueDetails?: StoryIssue[];
  lexicalCoverage: number | null;
  wordCount: number;
};

const metadataPatterns = [/^目标词/, /^地道英语表达/, /^五感描写证据/, /^因果证据/, /^第 \d+ 组因果/, /^线索 /, /^本集阻碍/, /^本集推进/];
export function onlyMetadataBlocks(quality: Pick<RepairQuality, "blockingIssues">) {
  const details = (quality as Pick<RepairQuality, "blockingIssues" | "blockingIssueDetails">).blockingIssueDetails;
  if (details?.length) {
    return details.every((issue) => issue.domain === "metadata");
  }
  // Compatibility for checkpoints written before structured issues existed.
  return quality.blockingIssues.length > 0 && quality.blockingIssues.every((issue) => metadataPatterns.some((pattern) => pattern.test(issue)));
}

export function lexicalFloorPassed(quality: Pick<RepairQuality, "lexicalCoverage" | "wordCount">, target: number) {
  return quality.lexicalCoverage === null || Math.max(0, Math.min(target, 0.9) - quality.lexicalCoverage) * quality.wordCount <= 1.0001;
}

export function chooseRepairKind(quality: RepairQuality, _target: number): RepairKind {
  const domains = new Set(
    quality.blockingIssueDetails?.map((issue) => issue.domain).filter((domain) => domain !== "lexical") ?? [],
  );
  if (domains.has("narrative") || domains.has("language")) return "narrative";
  if (domains.size) {
    return domains.size === 1 && domains.has("metadata") ? "metadata" : "narrative";
  }
  if (quality.blockingIssues.length && !onlyMetadataBlocks(quality)) return "narrative";
  return quality.blockingIssues.length ? "metadata" : "none";
}

export function canAttemptRepair(kind: RepairKind, attempts: LocalRepairAttempts, fullRewriteCount: number) {
  if (kind === "none") return false;
  if (kind === "narrative") return fullRewriteCount < 4;
  return attempts[kind] < (kind === "metadata" ? 2 : 1);
}
