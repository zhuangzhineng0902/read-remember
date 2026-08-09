import path from "node:path";

export type Config = {
  port: number;
  host: string;
  databasePath: string;
  corsOrigin: string;
  adminApiKey: string;
  syncAllowedHosts: string[];
};

export function getConfig(overrides: Partial<Config> = {}): Config {
  return {
    port: Number(process.env.PORT ?? 4000),
    host: process.env.HOST ?? "0.0.0.0",
    databasePath:
      process.env.DATABASE_PATH ??
      path.resolve(process.cwd(), "data/read-remember.sqlite"),
    corsOrigin: process.env.CORS_ORIGIN ?? "*",
    adminApiKey: process.env.ADMIN_API_KEY ?? "dev-admin-change-me",
    syncAllowedHosts: (process.env.SYNC_ALLOWED_HOSTS ?? "")
      .split(",")
      .map((host) => host.trim().toLowerCase())
      .filter(Boolean),
    ...overrides,
  };
}
