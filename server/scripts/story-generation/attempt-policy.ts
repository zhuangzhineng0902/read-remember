export function narrativeCompletionTokenBudget(maximumWords: number) {
  // MiniMax's English token/word ratio is close enough to 1 that the former
  // 1.28x allowance still let 310-word requests expand to 350-410 words. Keep
  // enough room for JSON punctuation and the title, but make the server-side
  // ceiling reinforce the prompt instead of silently permitting a long essay.
  return Math.min(2_048, Math.max(340, Math.ceil(maximumWords * 1.12) + 50));
}

export const storyEpisodeAttemptBudget = Object.freeze({
  candidateBatchesPerQueueAttempt: 1,
  synthesisDraftsPerQueueAttempt: 1,
  initialCandidates: storyGenerationPolicy.candidates.initial,
  supplementalCandidates: storyGenerationPolicy.candidates.supplemental,
  minimumCandidatePool: storyGenerationPolicy.candidates.minimumPool,
});
import { storyGenerationPolicy } from "./generation-policy";
