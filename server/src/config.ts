import path from "node:path";

export type Config = {
  port: number;
  host: string;
  databasePath: string;
  ecdictPath: string;
  corsOrigin: string;
  adminApiKey: string;
  syncAllowedHosts: string[];
  webRoot: string;
  dailyPushEnabled: boolean;
  dailyPushHour: number;
  dailyPushTimeZone: string;
};

export function getConfig(overrides: Partial<Config> = {}): Config {
  const configuredDailyPushHour = Number(process.env.DAILY_PUSH_HOUR ?? 8);
  return {
    port: Number(process.env.PORT ?? 4000),
    host: process.env.HOST ?? "0.0.0.0",
    databasePath:
      process.env.DATABASE_PATH ??
      path.resolve(process.cwd(), "data/read-remember.sqlite"),
    ecdictPath:
      process.env.ECDICT_PATH ?? path.resolve(process.cwd(), "data/ecdict.sqlite"),
    corsOrigin: process.env.CORS_ORIGIN ?? "*",
    adminApiKey: process.env.ADMIN_API_KEY ?? "dev-admin-change-me",
    syncAllowedHosts: (process.env.SYNC_ALLOWED_HOSTS ?? "")
      .split(",")
      .map((host) => host.trim().toLowerCase())
      .filter(Boolean),
    webRoot:
      process.env.WEB_ROOT ?? path.resolve(process.cwd(), "../client/dist"),
    dailyPushEnabled: process.env.DAILY_PUSH_ENABLED !== "false",
    dailyPushHour: Number.isFinite(configuredDailyPushHour)
      ? Math.min(23, Math.max(0, configuredDailyPushHour))
      : 8,
    dailyPushTimeZone: process.env.DAILY_PUSH_TIME_ZONE ?? "Asia/Shanghai",
    ...overrides,
  };
}
