import type { LengthPresetId, StoryBrief } from "@ai-studio/contracts";

export type LengthPreset = {
  id: LengthPresetId;
  label: string;
  minWords: number;
  maxWords: number;
  defaultWords: number;
  /** Typical chapter length for this form before pacing adjustments. */
  wordsPerChapter: number;
};

// Approximate editorial ranges, not Amazon classifications.
export const lengthPresets: LengthPreset[] = [
  {
    id: "flash-fiction",
    label: "Flash fiction",
    minWords: 500,
    maxWords: 1_500,
    defaultWords: 1_000,
    wordsPerChapter: 1_500,
  },
  {
    id: "short-story",
    label: "Short story",
    minWords: 3_000,
    maxWords: 8_000,
    defaultWords: 5_000,
    wordsPerChapter: 2_500,
  },
  {
    id: "novelette",
    label: "Novelette",
    minWords: 8_000,
    maxWords: 15_000,
    defaultWords: 12_000,
    wordsPerChapter: 2_000,
  },
  {
    id: "novella",
    label: "Novella",
    minWords: 15_000,
    maxWords: 30_000,
    defaultWords: 24_000,
    wordsPerChapter: 2_000,
  },
  {
    id: "short-novel",
    label: "Short novel",
    minWords: 30_000,
    maxWords: 50_000,
    defaultWords: 40_000,
    wordsPerChapter: 2_300,
  },
  {
    id: "novel",
    label: "Full novel",
    minWords: 50_000,
    maxWords: 90_000,
    defaultWords: 70_000,
    wordsPerChapter: 2_600,
  },
  {
    id: "long-novel",
    label: "Long novel",
    minWords: 90_000,
    maxWords: 120_000,
    defaultWords: 100_000,
    wordsPerChapter: 3_000,
  },
  {
    id: "custom",
    label: "Custom",
    minWords: 300,
    maxWords: 200_000,
    defaultWords: 20_000,
    wordsPerChapter: 2_200,
  },
];

export const maxTargetWords = 200_000;

export function getLengthPreset(id: LengthPresetId): LengthPreset {
  return lengthPresets.find((preset) => preset.id === id) ?? lengthPresets[7]!;
}

export function presetForWords(words: number): LengthPreset {
  return (
    lengthPresets.find(
      (preset) =>
        preset.id !== "custom" &&
        words >= preset.minWords &&
        words <= preset.maxWords,
    ) ?? getLengthPreset("custom")
  );
}

const pacingChapterFactor: Record<StoryBrief["pacing"], number> = {
  fast: 0.8,
  balanced: 1,
  "slow-burn": 1.25,
};

/** Suggests a chapter count; short thrillers get shorter, punchier chapters. */
export function suggestChapterCount(
  targetWords: number,
  pacing: StoryBrief["pacing"],
  genre = "",
): number {
  if (targetWords <= 1_500) return 1;
  const preset = presetForWords(targetWords);
  const thrillerLike = /thrill|suspense|mystery|crime|horror/i.test(genre);
  const perChapter =
    preset.wordsPerChapter *
    pacingChapterFactor[pacing] *
    (thrillerLike ? 0.9 : 1);
  return Math.min(120, Math.max(1, Math.round(targetWords / perChapter)));
}

type GenreExpectation = {
  pattern: RegExp;
  label: string;
  novelRange: [number, number];
  shortFormNote: string;
};

// Common market expectations for novel-length releases in each genre.
const genreExpectations: GenreExpectation[] = [
  {
    pattern: /romantic suspense/i,
    label: "Romantic suspense",
    novelRange: [60_000, 100_000],
    shortFormNote: "romance readers usually expect a complete relationship arc",
  },
  {
    pattern: /psychological|domestic thriller/i,
    label: "Psychological thrillers",
    novelRange: [65_000, 100_000],
    shortFormNote:
      "label a shorter book as a novella so readers know the length",
  },
  {
    pattern: /thrill/i,
    label: "Thrillers",
    novelRange: [65_000, 100_000],
    shortFormNote:
      "label a shorter book as a novella so readers know the length",
  },
  {
    pattern: /cozy/i,
    label: "Cozy mysteries",
    novelRange: [55_000, 75_000],
    shortFormNote: "series readers often accept novellas between full books",
  },
  {
    pattern: /myster|detective|crime/i,
    label: "Mysteries",
    novelRange: [60_000, 90_000],
    shortFormNote: "a fair-play puzzle needs room for clues and suspects",
  },
  {
    pattern: /horror|gothic|supernatural/i,
    label: "Horror",
    novelRange: [60_000, 95_000],
    shortFormNote: "horror novellas sell well when the cover and title say so",
  },
  {
    pattern: /romance/i,
    label: "Romance",
    novelRange: [50_000, 90_000],
    shortFormNote: "shorter romances are common; say so in the description",
  },
  {
    pattern: /fantasy/i,
    label: "Fantasy",
    novelRange: [80_000, 130_000],
    shortFormNote: "fantasy readers expect substantial world-building",
  },
  {
    pattern: /science fiction|sci-fi|scifi/i,
    label: "Science fiction",
    novelRange: [70_000, 120_000],
    shortFormNote: "shorter science fiction is usually sold as a novella",
  },
  {
    pattern: /literary/i,
    label: "Literary fiction",
    novelRange: [60_000, 100_000],
    shortFormNote: "literary novellas are a recognized form",
  },
];

export type LengthWarning = { level: "info" | "warning"; message: string };

export function lengthWarnings(
  genre: string,
  targetWords: number,
  chapterCount: number,
): LengthWarning[] {
  const warnings: LengthWarning[] = [];
  const expectation = genreExpectations.find((item) =>
    item.pattern.test(genre),
  );
  if (expectation) {
    const [low, high] = expectation.novelRange;
    if (targetWords < low * 0.6) {
      warnings.push({
        level: "info",
        message: `${expectation.label} sold as novels usually run ${low.toLocaleString("en-US")}–${high.toLocaleString("en-US")} words. At ${targetWords.toLocaleString("en-US")} words, ${expectation.shortFormNote}.`,
      });
    } else if (targetWords < low) {
      warnings.push({
        level: "warning",
        message: `${targetWords.toLocaleString("en-US")} words is short for a full-length ${expectation.label.toLowerCase()} novel (${low.toLocaleString("en-US")}–${high.toLocaleString("en-US")} is typical).`,
      });
    } else if (targetWords > high * 1.25) {
      warnings.push({
        level: "warning",
        message: `${targetWords.toLocaleString("en-US")} words is long for ${expectation.label.toLowerCase()}; readers and pricing usually expect ${low.toLocaleString("en-US")}–${high.toLocaleString("en-US")}.`,
      });
    }
  }
  const perChapter = targetWords / Math.max(1, chapterCount);
  if (chapterCount > 1 && perChapter < 700) {
    warnings.push({
      level: "warning",
      message: `About ${Math.round(perChapter)} words per chapter leaves little room for a full scene; consider fewer chapters.`,
    });
  }
  if (perChapter > 7_000) {
    warnings.push({
      level: "warning",
      message: `About ${Math.round(perChapter).toLocaleString("en-US")} words per chapter is long for eBook readers; consider more chapters.`,
    });
  }
  return warnings;
}
