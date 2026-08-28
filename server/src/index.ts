import { createServer } from "node:http";
import { existsSync } from "node:fs";
import path from "node:path";
import { loadEnvFile } from "node:process";
import { createApp } from "./app";
import { getConfig } from "./config";
import { createDatabase } from "./database";
import { startDailyPushScheduler } from "./daily-push";
import { openEcdict } from "./ecdict";
import { ArticleAudioService } from "./article-audio";
import {
  loadPhraseTranslationConfig,
  PhraseTranslationService,
} from "./phrase-translation";
import { ArticleTranslationService } from "./article-translation";
import { translationOptionsFromCli } from "../scripts/translate-articles";
import { storyOptionsFromCli } from "../scripts/generate-story-series";
import { CustomStoryService } from "./custom-story";

const localEnvFile = path.resolve(process.cwd(), ".env");
if (existsSync(localEnvFile)) loadEnvFile(localEnvFile);

const config = getConfig();
const db = createDatabase(config.databasePath);
const dictionary = openEcdict(config.ecdictPath);
const articleAudio = new ArticleAudioService(db, {
  baseUrl: config.kokoroBaseUrl,
  apiPath: config.kokoroApiPath,
  apiKey: config.kokoroApiKey,
  model: config.kokoroModel,
  format: config.kokoroFormat,
  audioRoot: config.kokoroAudioRoot,
  timeoutMs: config.kokoroTimeoutMs,
  maxInputCharacters: config.kokoroMaxInputCharacters,
  defaultVoice: config.kokoroDefaultVoice,
  voices: config.kokoroVoices,
});
const phraseTranslation = new PhraseTranslationService(
  db,
  loadPhraseTranslationConfig(),
);
const articleTranslationConfigPath =
  process.env.ARTICLE_TRANSLATION_CONFIG_PATH ??
  process.env.PHRASE_TRANSLATION_CONFIG_PATH ??
  path.resolve(process.cwd(), "config/translation.json");
const articleTranslation = new ArticleTranslationService(
  db,
  translationOptionsFromCli([
    ...(existsSync(articleTranslationConfigPath)
      ? ["--config", articleTranslationConfigPath]
      : []),
    "--database",
    config.databasePath,
  ]),
);
const customStoryConfigPath =
  process.env.CUSTOM_STORY_CONFIG_PATH ??
  process.env.STORY_GENERATION_CONFIG_PATH ??
  path.resolve(process.cwd(), "config/story-generation.json");
const customStories = new CustomStoryService(
  db,
  storyOptionsFromCli([
    ...(existsSync(customStoryConfigPath)
      ? ["--config", customStoryConfigPath]
      : []),
    "--database",
    config.databasePath,
    "--ecdict",
    config.ecdictPath,
  ]),
);
const app = createApp(
  db,
  config,
  dictionary,
  articleAudio,
  phraseTranslation,
  articleTranslation,
  customStories,
);
const server = createServer(app);
const dailyPushScheduler = startDailyPushScheduler(db, {
  enabled: config.dailyPushEnabled,
  hour: config.dailyPushHour,
  timeZone: config.dailyPushTimeZone,
});
customStories.resume();

server.listen(config.port, config.host, () => {
  console.log(
    `Read & Remember API listening on http://${config.host}:${config.port}`,
  );
  console.log(
    customStories.enabled
      ? "Custom story generation: ready"
      : "Custom story generation unavailable: configure story-generation.json",
  );
  console.log(
    articleAudio.enabled
      ? `Kokoro article audio: ${config.kokoroBaseUrl}`
      : "Kokoro article audio unavailable: set KOKORO_BASE_URL",
  );
  console.log(`Database: ${config.databasePath}`);
  console.log(
    dictionary
      ? `ECDICT: ${config.ecdictPath}`
      : `ECDICT unavailable: ${config.ecdictPath} (run npm run setup:ecdict)`,
  );
  console.log(
    phraseTranslation.enabled
      ? "Phrase translation: ready"
      : "Phrase translation unavailable: configure translation.json",
  );
  console.log(
    articleTranslation.enabled
      ? "Article translation: ready"
      : "Article translation unavailable: configure translation.json",
  );
});

function shutdown(signal: string) {
  console.log(`${signal} received, shutting down...`);
  dailyPushScheduler.stop();
  server.close(() => {
    db.close();
    dictionary?.close();
    process.exit(0);
  });
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
