import { z } from "zod";

export const localRepairAttemptsSchema = z.object({
  metadata: z.number().int().min(0).max(1),
  lexical: z.number().int().min(0).max(1),
});
export type LocalRepairAttempts = z.infer<typeof localRepairAttemptsSchema>;
export type RepairKind = "none" | "metadata" | "lexical" | "narrative";
type RepairQuality = { blockingIssues: string[]; lexicalCoverage: number | null; wordCount: number };

const metadataPatterns = [/^目标词/, /^地道英语表达/, /^五感描写证据/, /^因果证据/, /^第 \d+ 组因果/, /^线索 /, /^本集阻碍/, /^本集推进/];
export function onlyMetadataBlocks(quality: Pick<RepairQuality, "blockingIssues">) {
  return quality.blockingIssues.length > 0 && quality.blockingIssues.every((issue) => metadataPatterns.some((pattern) => pattern.test(issue)));
}

export function lexicalFloorPassed(quality: Pick<RepairQuality, "lexicalCoverage" | "wordCount">, target: number) {
  return quality.lexicalCoverage === null || Math.max(0, Math.min(target, 0.9) - quality.lexicalCoverage) * quality.wordCount <= 1.0001;
}

export function chooseRepairKind(quality: RepairQuality, target: number): RepairKind {
  if (quality.blockingIssues.length && !onlyMetadataBlocks(quality)) return "narrative";
  // Fix prose before regenerating metadata derived from that prose.
  if (!lexicalFloorPassed(quality, target)) return "lexical";
  return quality.blockingIssues.length ? "metadata" : "none";
}

export function canAttemptRepair(kind: RepairKind, attempts: LocalRepairAttempts, fullRewriteCount: number) {
  if (kind === "none") return false;
  return kind === "narrative" ? fullRewriteCount < 4 : attempts[kind] < 1;
}
