export function narrativeCompletionTokenBudget(maximumWords: number) {
  // M3 direct output was routinely filling the old 670-token allowance with
  // 350-500 English words for a 310-word request. A tighter prose allowance
  // still leaves JSON-closing headroom but applies useful pressure before the
  // model writes an overlong draft that would need lossy compression.
  return Math.min(2_048, Math.max(440, Math.ceil(maximumWords * 1.28) + 90));
}

export const storyEpisodeAttemptBudget = Object.freeze({
  candidateBatchesPerQueueAttempt: 1,
  synthesisDraftsPerQueueAttempt: 1,
  initialCandidates: storyGenerationPolicy.candidates.initial,
  supplementalCandidates: storyGenerationPolicy.candidates.supplemental,
  minimumCandidatePool: storyGenerationPolicy.candidates.minimumPool,
});
import { storyGenerationPolicy } from "./generation-policy";
