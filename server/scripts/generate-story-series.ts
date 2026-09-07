export * from "./story-generation/pipeline";
export * from "./story-generation/generation-policy";
export { storyOptionsFromCli } from "./story-generation/cli";

import { storyOptionsFromCli } from "./story-generation/cli";
import { runStoryGeneration } from "./story-generation/pipeline";

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
