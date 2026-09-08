export function narrativeCompletionTokenBudget(maximumWords: number) {
  // Word limits belong to content validation. Leave room for English
  // tokenization, quotes and JSON so the transport ceiling cannot cut off
  // an otherwise in-range chapter.
  return Math.min(4_096, Math.max(768, Math.ceil(maximumWords * 2) + 256));
}

export const storyEpisodeAttemptBudget = Object.freeze({
  candidateBatchesPerQueueAttempt: 1,
  synthesisDraftsPerQueueAttempt: 1,
  initialCandidates: storyGenerationPolicy.candidates.initial,
  supplementalCandidates: storyGenerationPolicy.candidates.supplemental,
  minimumCandidatePool: storyGenerationPolicy.candidates.minimumPool,
});
import { storyGenerationPolicy } from "./generation-policy";
