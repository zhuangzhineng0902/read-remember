import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { callStructured, type StoryModelOptions } from "./story-generation/model-client";

const root = path.resolve(process.cwd(), "data/classics-staging");
const checkOnly = process.argv.includes("--check");
const force = process.argv.includes("--force");
const configArg = process.argv.indexOf("--config");
const configPath = path.resolve(configArg >= 0 ? process.argv[configArg + 1] : "config/story-generation.json");

const eventSchema = z.object({
  what: z.string().min(1),
  why: z.string().min(1),
  result: z.string().min(1),
  sourceParagraphs: z.array(z.string().regex(/^p\d{3}$/)).min(1),
});

const editableBaseSchema = z.object({
  characters: z.array(z.object({ name: z.string().min(1), role: z.string().min(1) })).min(1).max(20),
  context: z.string().min(1),
  events: z.array(eventSchema).min(2).max(16),
  ending: z.string().min(1),
  mustKeep: z.array(z.string().min(1)).min(1).max(20),
  canOmit: z.array(z.string().min(1)).max(20),
});

const savedDraftSchema = editableBaseSchema.extend({
  baseVersion: z.literal("model-draft-v1"),
  sourceHash: z.string().regex(/^[a-f0-9]{64}$/),
  status: z.literal("draft"),
  generatedBy: z.string().min(1),
  generatedAt: z.string().datetime(),
  events: z.array(eventSchema.extend({ id: z.string().regex(/^E\d+$/) })).min(2).max(16),
});

type CatalogUnit = {
  status: "pending_editorial_review";
  workId: string;
  unitId: string;
  title: string;
  unitTitle: string;
  author: string;
  language: string;
  scope: string;
  sourceHash: string;
};

const catalogFile = z.object({
  units: z.array(z.object({
    status: z.string(),
    workId: z.string(), unitId: z.string(), title: z.string(), unitTitle: z.string(),
    author: z.string(), language: z.string(), scope: z.string(), sourceHash: z.string(),
  })),
}).parse(JSON.parse(readFileSync(path.join(root, "catalog.json"), "utf8")));
const catalog = {
  units: catalogFile.units.filter((unit): unit is CatalogUnit => unit.status === "pending_editorial_review"),
};

function paragraphNumber(id: string) {
  return Number(id.slice(1));
}

function schemaForSource(source: string) {
  const allowed = new Set([...source.matchAll(/^(p\d{3})\t/gm)].map((match) => match[1]));
  return editableBaseSchema.superRefine((value, context) => {
    let previous = 0;
    value.events.forEach((event, eventIndex) => {
      for (const paragraph of event.sourceParagraphs) {
        if (!allowed.has(paragraph)) context.addIssue({
          code: "custom", path: ["events", eventIndex, "sourceParagraphs"],
          message: `${paragraph} does not exist in source.txt`,
        });
      }
      const first = Math.min(...event.sourceParagraphs.map(paragraphNumber));
      if (first < previous) context.addIssue({
        code: "custom", path: ["events", eventIndex, "sourceParagraphs"],
        message: "events must follow source paragraph order",
      });
      previous = first;
    });
  });
}

function validateSavedDraft(unit: CatalogUnit) {
  const directory = path.join(root, unit.workId, unit.unitId);
  const source = readFileSync(path.join(directory, "source.txt"), "utf8");
  const draft = savedDraftSchema.parse(JSON.parse(readFileSync(path.join(directory, "base.json"), "utf8")));
  if (draft.sourceHash !== unit.sourceHash) throw new Error(`${unit.workId}/${unit.unitId}: sourceHash mismatch`);
  schemaForSource(source).parse(draft);
}

if (checkOnly) {
  for (const unit of catalog.units) validateSavedDraft(unit);
  console.log(`Checked ${catalog.units.length} classic base drafts.`);
  process.exit(0);
}

const rawConfig = JSON.parse(readFileSync(configPath, "utf8")) as Partial<StoryModelOptions>;
if (!rawConfig.baseUrl || !rawConfig.model) throw new Error(`Missing baseUrl/model in ${configPath}`);
const options: StoryModelOptions = {
  baseUrl: rawConfig.baseUrl,
  apiPath: rawConfig.apiPath ?? "/chat/completions",
  apiKey: rawConfig.apiKey ?? "",
  model: rawConfig.model,
  reviewModel: rawConfig.reviewModel || rawConfig.model,
  structureRepairModel: rawConfig.structureRepairModel || rawConfig.model,
  temperature: 0.15,
  reviewTemperature: 0.1,
  timeoutMs: rawConfig.timeoutMs ?? 300_000,
  rewriteTimeoutMs: rawConfig.rewriteTimeoutMs ?? 480_000,
  networkRetries: rawConfig.networkRetries ?? 2,
  structureRetries: rawConfig.structureRetries ?? 2,
  log: (message) => console.log(`[base-draft] ${message}`),
};

let next = 0;
const failures: string[] = [];
async function worker() {
  while (next < catalog.units.length) {
    const unit = catalog.units[next++];
    const directory = path.join(root, unit.workId, unit.unitId);
    const outputPath = path.join(directory, "base.json");
    if (!force && existsSync(outputPath)) {
      try {
        validateSavedDraft(unit);
        console.log(`[base-draft] skip valid ${unit.workId}/${unit.unitId}`);
        continue;
      } catch {
        // Replace an incomplete draft; verified assets never live in this staging directory.
      }
    }
    try {
      const source = readFileSync(path.join(directory, "source.txt"), "utf8");
      console.log(`[base-draft] generating ${unit.workId}/${unit.unitId}`);
      const editable = await callStructured(
        options,
        schemaForSource(source),
        "You prepare faithful editorial story-base drafts from authorized, public-domain, or user-provided source text. Return only the allowed JSON fields. Never claim that a draft was human-verified.",
        `Create a concise English story-base draft for later human verification.\n\nWork: ${unit.title}\nUnit: ${unit.unitTitle}\nAuthor: ${unit.author}\nScope: ${unit.scope}\nSource language: ${unit.language}\n\nRules:\n- Use only facts supported by the supplied source.\n- Cover the complete selected unit in chronological order, including its actual ending.\n- Return 4-12 chronological events, at most 12 mustKeep items, and at most 12 canOmit items.\n- Each event needs what, why, result, and one or more exact pNNN citations.\n- A heading alone is not evidence.\n- Explain mustKeep as factual obligations, not prescribed prose.\n- Put expendable descriptions or side incidents in canOmit.\n- Do not return id, status, hashes, versions, reviewer names, timestamps, or commentary.\n\nReturn this complete root object:\n{"characters":[{"name":"...","role":"..."}],"context":"...","events":[{"what":"...","why":"...","result":"...","sourceParagraphs":["p001"]}],"ending":"...","mustKeep":["..."],"canOmit":["..."]}\n\nSOURCE:\n${source}`,
        options.model,
        0.15,
        { maxCompletionTokens: 4096, disableThinking: true, networkRetries: 2, structureRetries: 2 },
      );
      const draft = savedDraftSchema.parse({
        baseVersion: "model-draft-v1",
        sourceHash: unit.sourceHash,
        status: "draft",
        generatedBy: options.model,
        generatedAt: new Date().toISOString(),
        ...editable,
        events: editable.events.map((event, index) => ({ id: `E${index + 1}`, ...event })),
      });
      writeFileSync(outputPath, `${JSON.stringify(draft, null, 2)}\n`);
      validateSavedDraft(unit);
      console.log(`[base-draft] saved ${unit.workId}/${unit.unitId}`);
    } catch (error) {
      const message = `${unit.workId}/${unit.unitId}: ${error instanceof Error ? error.message : error}`;
      failures.push(message);
      console.error(`[base-draft] failed ${message}`);
    }
  }
}

await Promise.all([worker(), worker()]);
if (failures.length) throw new Error(`Failed ${failures.length}/${catalog.units.length}:\n${failures.join("\n")}`);
console.log(`Generated and checked ${catalog.units.length} classic base drafts.`);
