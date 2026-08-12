import { createServer } from "node:http";
import { createApp } from "./app";
import { getConfig } from "./config";
import { createDatabase } from "./database";
import { startDailyPushScheduler } from "./daily-push";

const config = getConfig();
const db = createDatabase(config.databasePath);
const app = createApp(db, config);
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
  console.log(`Database: ${config.databasePath}`);
});

function shutdown(signal: string) {
  console.log(`${signal} received, shutting down...`);
  dailyPushScheduler.stop();
  server.close(() => {
    db.close();
    process.exit(0);
  });
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
