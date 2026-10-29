import type { StoryBrief } from "@ai-film-studio/contracts";

const minimumChapterWords = 300;

/** Small, deterministic variation so chapters never come out identical. */
function variation(index: number, count: number): number {
  const value = Math.sin((index + 1) * 12.9898 + count * 78.233) * 43758.5453;
  return (value - Math.floor(value) - 0.5) * 0.12;
}

function pacingWeight(
  position: number,
  count: number,
  pacing: StoryBrief["pacing"],
): number {
  if (count === 1) return 1;
  const progress = position / (count - 1);
  let weight = 1;
  // Openings hook fast; endings resolve rather than sprawl.
  if (position === 0) weight *= 0.9;
  if (position === count - 1) weight *= 0.85;
  // The midpoint turn and the run-up to the climax carry more scene work.
  weight *= 1 + 0.08 * Math.exp(-((progress - 0.5) ** 2) / 0.02);
  const climax = Math.exp(-((progress - 0.85) ** 2) / 0.01);
  if (pacing === "fast") {
    // Fast books shorten chapters as tension rises.
    weight *= 1.08 - 0.22 * progress;
    weight *= 1 - 0.08 * climax;
  } else if (pacing === "slow-burn") {
    weight *= 1.05 + 0.05 * Math.sin(progress * Math.PI);
    weight *= 1 + 0.1 * climax;
  } else {
    weight *= 1 + 0.05 * climax;
  }
  return Math.max(0.4, weight * (1 + variation(position, count)));
}

/**
 * Splits a word target across chapters following the pacing curve. Values are
 * rounded to 50 words and always sum to the target.
 */
export function planChapterWords(
  targetWords: number,
  chapterCount: number,
  pacing: StoryBrief["pacing"],
  sceneCounts?: number[],
): number[] {
  const count = Math.max(1, Math.floor(chapterCount));
  const averageScenes =
    sceneCounts && sceneCounts.length === count
      ? sceneCounts.reduce((sum, value) => sum + value, 0) / count
      : 0;
  const weights = Array.from({ length: count }, (_, index) => {
    const scenes = sceneCounts?.[index];
    const sceneFactor =
      averageScenes > 0 && scenes !== undefined
        ? 0.75 + 0.25 * (scenes / averageScenes)
        : 1;
    return pacingWeight(index, count, pacing) * sceneFactor;
  });
  const total = weights.reduce((sum, value) => sum + value, 0);
  const plan = weights.map((weight) =>
    Math.max(
      Math.min(minimumChapterWords, targetWords),
      Math.round((targetWords * weight) / total / 50) * 50,
    ),
  );
  let difference = targetWords - plan.reduce((sum, value) => sum + value, 0);
  // Put the rounding remainder on the longest chapters first.
  const order = plan
    .map((value, index) => ({ value, index }))
    .sort((a, b) => b.value - a.value);
  let cursor = 0;
  while (difference !== 0 && order.length > 0) {
    const entry = order[cursor % order.length]!;
    const step =
      Math.abs(difference) >= 50 ? Math.sign(difference) * 50 : difference;
    if (
      plan[entry.index]! + step >=
      Math.min(minimumChapterWords, targetWords)
    ) {
      plan[entry.index]! += step;
      difference -= step;
    }
    cursor += 1;
    if (cursor > order.length * 400) break;
  }
  return plan;
}

/** Long chapters are drafted scene by scene, then joined with a coherence pass. */
export function shouldDraftByScene(targetWords: number, sceneCount: number) {
  return targetWords > 3_000 && sceneCount > 1;
}

/** Splits a chapter target across its scenes, weighting later scenes slightly. */
export function planSceneWords(targetWords: number, sceneCount: number) {
  const count = Math.max(1, sceneCount);
  const weights = Array.from(
    { length: count },
    (_, index) => 1 + (count > 2 && index === count - 1 ? 0.1 : 0),
  );
  const total = weights.reduce((sum, value) => sum + value, 0);
  return weights.map((weight) =>
    Math.max(200, Math.round((targetWords * weight) / total / 50) * 50),
  );
}

/** True when a draft is short enough that expansion should run. */
export function needsExpansion(actualWords: number, targetWords: number) {
  return actualWords < targetWords * 0.75;
}
