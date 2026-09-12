export function narrativeCompletionTokenBudget(maximumWords: number) {
  // Some OpenAI-compatible relays count hidden reasoning against the output
  // ceiling even when thinking is disabled. Keep prose length enforcement in
  // content validation and leave enough transport room for JSON plus relay use.
  return Math.min(16_384, Math.max(8_192, Math.ceil(maximumWords * 4) + 2_048));
}

export const storyEpisodeAttemptBudget = Object.freeze({
  candidateBatchesPerQueueAttempt: 1,
  synthesisDraftsPerQueueAttempt: 1,
  initialCandidates: storyGenerationPolicy.candidates.initial,
  supplementalCandidates: storyGenerationPolicy.candidates.supplemental,
  minimumCandidatePool: storyGenerationPolicy.candidates.minimumPool,
});
import { storyGenerationPolicy } from "./generation-policy";
