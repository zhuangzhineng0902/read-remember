import path from "node:path";
import type { KokoroVoice } from "./article-audio";

const defaultKokoroVoices: KokoroVoice[] = [
  { id: "af_heart", label: "温和女声 · 美音" },
  { id: "am_michael", label: "沉稳男声 · 美音" },
  { id: "bf_emma", label: "自然女声 · 英音" },
  { id: "bm_george", label: "沉稳男声 · 英音" },
];

function configuredKokoroVoices(value?: string) {
  if (!value?.trim()) return defaultKokoroVoices;
  const voices = value
    .split(",")
    .map((entry) => {
      const [id, label] = entry.split("|").map((item) => item.trim());
      return id ? { id, label: label || id } : null;
    })
    .filter((item): item is KokoroVoice => Boolean(item));
  return voices.length ? voices : defaultKokoroVoices;
}

function kokoroFormat(value?: string): Config["kokoroFormat"] {
  const format = value?.trim().toLowerCase();
  return format === "wav" ||
    format === "opus" ||
    format === "flac"
    ? format
    : "mp3";
}

function positiveNumber(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export type Config = {
  port: number;
  host: string;
  databasePath: string;
  ecdictPath: string;
  kokoroBaseUrl: string;
  kokoroApiPath: string;
  kokoroApiKey: string;
  kokoroModel: string;
  kokoroFormat: "mp3" | "wav" | "opus" | "flac";
  kokoroAudioRoot: string;
  kokoroTimeoutMs: number;
  kokoroMaxInputCharacters: number;
  kokoroDefaultVoice: string;
  kokoroVoices: KokoroVoice[];
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
  const kokoroVoices = configuredKokoroVoices(process.env.KOKORO_VOICES);
  const requestedDefaultVoice =
    process.env.KOKORO_DEFAULT_VOICE?.trim() || "af_heart";
  const base: Config = {
    port: Number(process.env.PORT ?? 4000),
    host: process.env.HOST ?? "0.0.0.0",
    databasePath:
      process.env.DATABASE_PATH ??
      path.resolve(process.cwd(), "data/read-remember.sqlite"),
    ecdictPath:
      process.env.ECDICT_PATH ?? path.resolve(process.cwd(), "data/ecdict.sqlite"),
    kokoroBaseUrl: process.env.KOKORO_BASE_URL ?? "",
    kokoroApiPath: process.env.KOKORO_API_PATH ?? "/audio/speech",
    kokoroApiKey: process.env.KOKORO_API_KEY ?? "",
    kokoroModel: process.env.KOKORO_MODEL ?? "kokoro",
    kokoroFormat: kokoroFormat(process.env.KOKORO_FORMAT),
    kokoroAudioRoot:
      process.env.KOKORO_AUDIO_ROOT ??
      path.resolve(process.cwd(), "data/article-audio"),
    kokoroTimeoutMs: positiveNumber(process.env.KOKORO_TIMEOUT_MS, 300_000),
    kokoroMaxInputCharacters: positiveNumber(
      process.env.KOKORO_MAX_INPUT_CHARACTERS,
      12_000,
    ),
    kokoroDefaultVoice: kokoroVoices.some(
      (voice) => voice.id === requestedDefaultVoice,
    )
      ? requestedDefaultVoice
      : kokoroVoices[0].id,
    kokoroVoices,
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
  };
  return { ...base, ...overrides };
}
