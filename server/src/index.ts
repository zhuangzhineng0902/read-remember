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
const app = createApp(db, config, dictionary, articleAudio);
const server = createServer(app);
const dailyPushScheduler = startDailyPushScheduler(db, {
  enabled: config.dailyPushEnabled,
  hour: config.dailyPushHour,
  timeZone: config.dailyPushTimeZone,
});

server.listen(config.port, config.host, () => {
  console.log(
    `Read & Remember API listening on http://${config.host}:${config.port}`,
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
