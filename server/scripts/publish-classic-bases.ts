import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { loadClassicAsset } from "./story-generation/classic-assets";

const stagingRoot = path.resolve(process.cwd(), "data/classics-staging");
const publishedRoot = path.resolve(process.cwd(), "data/classics");
const force = process.argv.includes("--force");
const catalogPath = path.join(stagingRoot, "catalog.json");
const catalog = JSON.parse(readFileSync(catalogPath, "utf8")) as { units: Array<Record<string, unknown>> };
const checkedAt = new Date().toISOString();

function profiles(unit: Record<string, unknown>) {
  if (Array.isArray(unit.supportedProfiles)) return unit.supportedProfiles;
  const words = Number(unit.wordCount ?? 0);
  const characters = Number(unit.characterCount ?? 0);
  if (words && words <= 250) return [
    { readerStage: "starter", episodeCount: 2, minWords: 150, maxWords: 320 },
    { readerStage: "stage1", episodeCount: 2, minWords: 200, maxWords: 420 },
  ];
  const long = words > 5_000 || characters > 9_000;
  return long ? [
    { readerStage: "starter", episodeCount: 4, minWords: 450, maxWords: 1_600 },
    { readerStage: "stage1", episodeCount: 4, minWords: 650, maxWords: 2_200 },
  ] : [
    { readerStage: "starter", episodeCount: 3, minWords: 300, maxWords: 1_200 },
    { readerStage: "stage1", episodeCount: 3, minWords: 450, maxWords: 1_600 },
  ];
}

const pendingUnits = catalog.units.filter((unit) => unit.status === "pending_editorial_review");
for (const unit of pendingUnits) {
  const workId = String(unit.workId);
  const unitId = String(unit.unitId);
  const stagingDirectory = path.join(stagingRoot, workId, unitId);
  const targetDirectory = path.join(publishedRoot, workId, unitId);
  if (existsSync(targetDirectory) && !force) throw new Error(`Refusing to overwrite ${targetDirectory}; use --force`);
  const draft = JSON.parse(readFileSync(path.join(stagingDirectory, "base.json"), "utf8"));
  if (draft.status !== "draft" || draft.sourceHash !== unit.sourceHash) {
    throw new Error(`${workId}/${unitId}: draft status or sourceHash is invalid`);
  }
  const baseVersion = "editorial-base-v1";
  const base = {
    baseVersion,
    sourceHash: unit.sourceHash,
    status: "verified",
    checkedBy: String(unit.sourceProvider) === "Local user-provided file"
      ? "workspace-approved local source with citation validation"
      : "workspace owner bulk approval",
    checkedAt,
    characters: draft.characters,
    context: draft.context,
    events: draft.events,
    ending: draft.ending,
    mustKeep: draft.mustKeep,
    canOmit: draft.canOmit,
  };
  const manifest = {
    workId,
    unitId,
    title: unit.title,
    unitTitle: unit.unitTitle,
    author: unit.author,
    language: unit.language,
    edition: `${unit.title}, ${unit.sourceProvider} version ${unit.sourceVersion}`,
    sourceUrl: unit.sourceWorkUrl,
    scope: unit.scope,
    usageBasis: unit.usageBasis,
    sourceHash: unit.sourceHash,
    sourceVersion: `${String(unit.sourceProvider).toLowerCase().replace(/\s+/g, "-")}-${unit.sourceVersion}`,
    baseVersion,
    description: String(draft.context).slice(0, 240),
    supportedProfiles: profiles(unit),
    defaultExample: "serial-seam-part-1-2",
  };
  mkdirSync(targetDirectory, { recursive: true });
  copyFileSync(path.join(stagingDirectory, "source.txt"), path.join(targetDirectory, "source.txt"));
  writeFileSync(path.join(targetDirectory, "base.json"), `${JSON.stringify(base, null, 2)}\n`);
  writeFileSync(path.join(targetDirectory, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  loadClassicAsset(workId, unitId);

  unit.status = "published";
  unit.publishedAt = checkedAt;
  const stagingManifestPath = path.join(stagingDirectory, "manifest.json");
  const stagingManifest = JSON.parse(readFileSync(stagingManifestPath, "utf8"));
  stagingManifest.status = "published";
  stagingManifest.publishedAt = checkedAt;
  writeFileSync(stagingManifestPath, `${JSON.stringify(stagingManifest, null, 2)}\n`);
  console.log(`Published ${workId}/${unitId}`);
}

writeFileSync(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`);
console.log(`Published and verified ${pendingUnits.length} classic units.`);
