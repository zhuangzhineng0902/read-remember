export const storyGenerationPolicy = Object.freeze({
  clues: {
    maximumHardActionsPerEpisode: 2,
  },
  candidates: {
    initial: 3,
    supplemental: 2,
    minimumPool: 3,
  },
  review: {
    minimumDimension: 7,
    minimumAverage: 7.5,
    borderlineAverage: 7.25,
    maximumDimensionDropFromFirst: 1,
    maximumAverageDropFromFirst: 0.5,
    skipOptionalOptimizationAtAverage: 8,
  },
  length: {
    severeSentenceExtraWords: 9,
    tinyOverflowWords: 3,
  },
  retry: {
    automaticPerEpisode: 3,
  },
} as const);

export type StoryFailureDomain = "narrative" | "language" | "metadata" | "lexical" | "questions" | "infrastructure";
export type StoryRetryScope = "same_text" | "top_candidate" | "new_candidates" | "manual";

export class StoryGenerationFailure extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly domain: StoryFailureDomain,
    readonly retryScope: StoryRetryScope,
  ) {
    super(message);
    this.name = "StoryGenerationFailure";
  }
}
