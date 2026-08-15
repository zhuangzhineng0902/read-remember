import type { MemoryRating } from "./types";

const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;

export const MEMORY_INTERVALS_MS = [
  10 * MINUTE,
  DAY,
  2 * DAY,
  4 * DAY,
  7 * DAY,
  15 * DAY,
  30 * DAY,
  60 * DAY,
  120 * DAY,
] as const;

export function nextMemoryStage(currentStage: number, rating: MemoryRating) {
  const current = Math.max(0, Math.min(currentStage, MEMORY_INTERVALS_MS.length - 1));
  if (rating === "again") return 0;
  if (rating === "hard") return current;
  if (rating === "good") return Math.min(current + 1, MEMORY_INTERVALS_MS.length - 1);
  return Math.min(current + 2, MEMORY_INTERVALS_MS.length - 1);
}

export function scheduleMemoryReview(
  currentStage: number,
  rating: MemoryRating,
  now = new Date(),
) {
  const memoryStage = nextMemoryStage(currentStage, rating);
  return {
    memoryStage,
    lastReviewedAt: now.toISOString(),
    nextReviewAt: new Date(
      now.getTime() + MEMORY_INTERVALS_MS[memoryStage],
    ).toISOString(),
  };
}

export function isReviewDue(nextReviewAt?: string, now = Date.now()) {
  if (!nextReviewAt) return true;
  const timestamp = Date.parse(nextReviewAt);
  return !Number.isFinite(timestamp) || timestamp <= now;
}

export function reviewIntervalLabel(currentStage: number, rating: MemoryRating) {
  const interval = MEMORY_INTERVALS_MS[nextMemoryStage(currentStage, rating)];
  if (interval < DAY) return `${Math.round(interval / MINUTE)}分钟`;
  const days = Math.round(interval / DAY);
  return days < 30 ? `${days}天` : `${Math.round(days / 30)}个月`;
}
