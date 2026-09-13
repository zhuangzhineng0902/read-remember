import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { readerStageIds, type ReaderStageId } from "./catalog";

const profileSchema = z.object({
  readerStage: z.enum(readerStageIds),
  episodeCount: z.number().int().min(1).max(12),
  minWords: z.number().int().min(50),
  maxWords: z.number().int().min(80),
}).refine((profile) => profile.maxWords >= profile.minWords, "maxWords must be at least minWords");

export const classicManifestSchema = z.object({
  workId: z.string().regex(/^[a-z][a-z0-9-]*$/),
  unitId: z.string().regex(/^[a-z][a-z0-9-]*$/),
  title: z.string().min(1),
  unitTitle: z.string().min(1),
  author: z.string().min(1),
  language: z.string().min(1),
  edition: z.string().min(1),
  sourceUrl: z.string().url(),
  scope: z.string().min(1),
  usageBasis: z.string().min(1),
  sourceHash: z.string().regex(/^[a-f0-9]{64}$/),
  sourceVersion: z.string().min(1),
  baseVersion: z.string().min(1),
  description: z.string().min(1),
  supportedProfiles: z.array(profileSchema).min(1),
  defaultExample: z.string().min(1),
});

const baseSchema = z.object({
  baseVersion: z.string().min(1),
  sourceHash: z.string().regex(/^[a-f0-9]{64}$/),
  status: z.literal("verified"),
  checkedBy: z.string().min(1),
  checkedAt: z.string().datetime(),
  characters: z.array(z.object({ name: z.string().min(1), role: z.string().min(1) })).min(1),
  context: z.string().min(1),
  events: z.array(z.object({
    id: z.string().min(1),
    what: z.string().min(1),
    why: z.string().min(1),
    result: z.string().min(1),
    sourceParagraphs: z.array(z.string().regex(/^p\d+$/)).min(1),
  })).min(1),
  ending: z.string().min(1),
  mustKeep: z.array(z.string().min(1)).min(1),
  canOmit: z.array(z.string().min(1)),
});

export type ClassicManifest = z.infer<typeof classicManifestSchema>;
export type ClassicBase = z.infer<typeof baseSchema>;
export type ClassicProfile = z.infer<typeof profileSchema>;

const pendingClassicSchema = z.object({
  status: z.literal("pending_editorial_review"),
  workId: z.string().regex(/^[a-z][a-z0-9-]*$/),
  unitId: z.string().regex(/^[a-z][a-z0-9-]*$/),
  title: z.string().min(1),
  unitTitle: z.string().min(1),
  author: z.string().min(1),
  scope: z.string().min(1),
  sourceWorkUrl: z.string().url(),
  tags: z.array(z.string().min(1)),
});

export class ClassicPipelineError extends Error {
  constructor(
    readonly code: "REFERENCE_UNAVAILABLE" | "OUTPUT_PARSE" | "OUTPUT_SCHEMA" | "OUTPUT_TRUNCATED"
      | "SOURCE_CONFLICT" | "CONTENT_REJECTED" | "LEARNING_INVALID" | "MODEL_UNAVAILABLE",
    message: string,
  ) {
    super(`${code}: ${message}`);
    this.name = "ClassicPipelineError";
  }
}

function firstExisting(candidates: string[]) {
  return candidates.find(existsSync) ?? candidates[0];
}

export function classicDataRoot() {
  return firstExisting([
    path.resolve(process.cwd(), "data/classics"),
    path.resolve(process.cwd(), "server/data/classics"),
  ]);
}

export function projectReferencePath(filename: "story-bible.md" | "good-story-demo.md") {
  return firstExisting([
    path.resolve(process.cwd(), filename),
    path.resolve(process.cwd(), "..", filename),
    path.resolve(process.cwd(), "data/story-references", filename),
  ]);
}

export function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export type ClassicAsset = {
  manifest: ClassicManifest;
  base: ClassicBase;
  source: string;
  sourceParagraphIds: string[];
};

export function loadClassicAsset(workId: string, unitId: string): ClassicAsset {
  const directory = path.join(classicDataRoot(), workId, unitId);
  try {
    const source = readFileSync(path.join(directory, "source.txt"), "utf8");
    const manifest = classicManifestSchema.parse(JSON.parse(readFileSync(path.join(directory, "manifest.json"), "utf8")));
    const base = baseSchema.parse(JSON.parse(readFileSync(path.join(directory, "base.json"), "utf8")));
    if (manifest.workId !== workId || manifest.unitId !== unitId) {
      throw new Error("asset path and manifest identity differ");
    }
    const actualHash = sha256(source);
    if (manifest.sourceHash !== actualHash || base.sourceHash !== actualHash) {
      throw new Error("sourceHash does not match source.txt");
    }
    if (manifest.baseVersion !== base.baseVersion) throw new Error("baseVersion does not match manifest");
    const paragraphIds = [...source.matchAll(/^(p\d+)\t/gm)].map((match) => match[1]);
    const missing = base.events.flatMap((event) => event.sourceParagraphs)
      .filter((id) => !paragraphIds.includes(id));
    if (missing.length) throw new Error(`base references missing source paragraphs: ${[...new Set(missing)].join(", ")}`);
    return { manifest, base, source, sourceParagraphIds: paragraphIds };
  } catch (error) {
    throw new ClassicPipelineError(
      "REFERENCE_UNAVAILABLE",
      `${workId}/${unitId} is not a usable verified classic asset: ${error instanceof Error ? error.message : error}`,
    );
  }
}

export function resolveClassicProfile(asset: ClassicAsset, readerStage: ReaderStageId, episodeCount: number) {
  const resolvedStage = readerStage === "auto" ? "starter" : readerStage;
  const profile = asset.manifest.supportedProfiles.find(
    (item) => item.readerStage === resolvedStage && item.episodeCount === episodeCount,
  );
  if (!profile) {
    const choices = asset.manifest.supportedProfiles
      .map((item) => `${item.readerStage}/${item.episodeCount} chapters`)
      .join(", ");
    throw new ClassicPipelineError("CONTENT_REJECTED", `Unsupported reading profile. Available: ${choices}`);
  }
  return profile;
}

export function listClassicSources() {
  const root = classicDataRoot();
  if (!existsSync(root)) return [];
  const result: ClassicManifest[] = [];
  for (const workId of readdirSync(root)) {
    const workPath = path.join(root, workId);
    for (const unitId of existsSync(workPath) ? readdirSync(workPath) : []) {
      try {
        result.push(loadClassicAsset(workId, unitId).manifest);
      } catch {
        // Invalid or unverified assets are deliberately absent from the public catalog.
      }
    }
  }
  return result;
}

export function listPendingClassicSources() {
  const catalogPath = firstExisting([
    path.resolve(process.cwd(), "data/classics-staging/catalog.json"),
    path.resolve(process.cwd(), "server/data/classics-staging/catalog.json"),
  ]);
  if (!existsSync(catalogPath)) return [];
  try {
    return z.object({ units: z.array(z.unknown()) })
      .parse(JSON.parse(readFileSync(catalogPath, "utf8"))).units
      .flatMap((unit) => {
        const parsed = pendingClassicSchema.safeParse(unit);
        return parsed.success ? [parsed.data] : [];
      });
  } catch {
    return [];
  }
}
