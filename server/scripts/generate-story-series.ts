export * from "./story-generation/pipeline";
export * from "./story-generation/generation-policy";
export { storyOptionsFromCli } from "./story-generation/cli";
export * from "./story-generation/classic-assets";
export * from "./story-generation/classic-pipeline";

import type { StoryRunOptions } from "./story-generation/pipeline";
import { runStoryGeneration as runOriginalStoryGeneration } from "./story-generation/pipeline";
import { runClassicAdaptation, type ClassicRunOptions } from "./story-generation/classic-pipeline";

/** The public generation dispatch: classic-v1 never enters the original workflow. */
export function runStoryGeneration(options: StoryRunOptions) {
  if (options.sourceMode !== "classic") return runOriginalStoryGeneration(options);
  if (!options.classicUnitId) throw new Error("REFERENCE_UNAVAILABLE: classicUnitId is required");
  return runClassicAdaptation(options as ClassicRunOptions);
}

export const runConfiguredStoryGeneration = runStoryGeneration;

import { storyOptionsFromCli } from "./story-generation/cli";

if (/generate-story-series\.(?:ts|js)$/.test(process.argv[1] ?? "")) {
  runStoryGeneration(storyOptionsFromCli())
    .then((result) => console.log(
      `完成：${result.seriesTitle || "dry-run"}，生成 ${result.generated} 集，导入 ${result.imported} 集。`,
    ))
    .catch((error) => {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    });
}
