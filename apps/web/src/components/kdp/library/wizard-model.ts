import type {
  CreateBookInput,
  LengthPresetId,
  PointOfView,
  StoryBrief,
} from "@ai-studio/contracts";
import {
  getLengthPreset,
  presetForWords,
  suggestChapterCount,
} from "@ai-studio/book-engine";

import { parseNumber } from "./form-errors";

export const customGenreValue = "__custom";

export const genreOptions = [
  "Psychological thriller",
  "Mystery",
  "Detective mystery",
  "Cozy mystery",
  "Supernatural horror",
  "Gothic horror",
  "Domestic thriller",
  "Romantic suspense",
  "Contemporary romance",
  "Literary fiction",
  "Fantasy",
  "Science fiction",
];

export const toneOptions = [
  "dark",
  "disturbing",
  "emotional",
  "suspenseful",
  "humorous",
  "romantic",
  "melancholic",
  "hopeful",
  "eerie",
];
export const maxTones = 8;

export const povLabels: Record<PointOfView, string> = {
  "first-person": "First person",
  "third-limited": "Third person, close",
  "third-omniscient": "Third person, omniscient",
  "multiple-pov": "Multiple viewpoints",
  "second-person": "Second person",
};
export const tenseLabels: Record<StoryBrief["tense"], string> = {
  past: "Past",
  present: "Present",
};
export const sensualityLabels: Record<StoryBrief["sensuality"], string> = {
  none: "None",
  mild: "Mild",
  suggestive: "Suggestive",
  "fade-to-black": "Fade to black",
};
export const endingLabels: Record<StoryBrief["ending"], string> = {
  happy: "Happy",
  tragic: "Tragic",
  bittersweet: "Bittersweet",
  ambiguous: "Ambiguous",
  twist: "Twist",
};
export const pacingLabels: Record<StoryBrief["pacing"], string> = {
  "slow-burn": "Slow burn",
  balanced: "Balanced",
  fast: "Fast",
};
export const levelWords = [
  "None",
  "Faint",
  "Light",
  "Moderate",
  "Strong",
  "Intense",
];

export type WizardForm = {
  theme: string;
  genreChoice: string;
  customGenre: string;
  subgenre: string;
  audience: string;
  workingTitle: string;
  subtitle: string;
  lengthPreset: LengthPresetId;
  targetWords: string;
  pacing: StoryBrief["pacing"];
  chaptersEdited: boolean;
  chapterCount: string;
  pointOfView: PointOfView;
  tense: StoryBrief["tense"];
  tones: string[];
  suspense: number;
  horror: number;
  romance: number;
  violence: number;
  sensuality: StoryBrief["sensuality"];
  ending: StoryBrief["ending"];
  setting: string;
  timePeriod: string;
  mainCharacter: string;
  supportingCharacters: string;
  centralConflict: string;
  specialInstructions: string;
  forbidden: string;
  mandatoryElements: string;
  referenceMaterial: string;
  customBrief: string;
  craftProfile: string;
  budgetUsd: string;
  authorProfileId: string;
  language: string;
  isSeries: boolean;
  seriesName: string;
  seriesNumber: string;
};

export const defaultWizardForm: WizardForm = {
  theme: "",
  genreChoice: "Psychological thriller",
  customGenre: "",
  subgenre: "",
  audience: "",
  workingTitle: "",
  subtitle: "",
  lengthPreset: "novella",
  targetWords: "24000",
  pacing: "balanced",
  chaptersEdited: false,
  chapterCount: "",
  pointOfView: "third-limited",
  tense: "past",
  tones: [],
  suspense: 3,
  horror: 0,
  romance: 0,
  violence: 1,
  sensuality: "none",
  ending: "bittersweet",
  setting: "",
  timePeriod: "",
  mainCharacter: "",
  supportingCharacters: "",
  centralConflict: "",
  specialInstructions: "",
  forbidden: "",
  mandatoryElements: "",
  referenceMaterial: "",
  customBrief: "",
  craftProfile: "",
  budgetUsd: "",
  authorProfileId: "",
  language: "en",
  isSeries: false,
  seriesName: "",
  seriesNumber: "1",
};

export const wizardSteps = [
  { id: "idea", label: "Idea" },
  { id: "length", label: "Length" },
  { id: "style", label: "Style" },
  { id: "story", label: "Story" },
  { id: "author", label: "Pen name" },
  { id: "review", label: "Review" },
] as const;

export const genreOf = (form: WizardForm) =>
  (form.genreChoice === customGenreValue
    ? form.customGenre
    : form.genreChoice
  ).trim();

export function wordsOf(form: WizardForm): number {
  const value = Number(form.targetWords);
  return Number.isFinite(value) ? Math.round(value) : 0;
}

export function suggestedChapters(form: WizardForm): number {
  return suggestChapterCount(
    Math.max(300, wordsOf(form)),
    form.pacing,
    genreOf(form),
  );
}

/** The chapter count in effect: the suggestion until the user edits it. */
export function chaptersOf(form: WizardForm): number {
  if (!form.chaptersEdited) return suggestedChapters(form);
  const value = Math.round(Number(form.chapterCount));
  return Number.isFinite(value) && value >= 1
    ? Math.min(150, value)
    : suggestedChapters(form);
}

export function withPreset(form: WizardForm, id: LengthPresetId): WizardForm {
  if (id === "custom") return { ...form, lengthPreset: id };
  return {
    ...form,
    lengthPreset: id,
    targetWords: String(getLengthPreset(id).defaultWords),
  };
}

export function withWords(form: WizardForm, text: string): WizardForm {
  const value = Number(text);
  const lengthPreset =
    form.lengthPreset === "custom" || !Number.isFinite(value)
      ? form.lengthPreset
      : presetForWords(value).id;
  return { ...form, targetWords: text, lengthPreset };
}

export type FieldErrors = Partial<Record<keyof WizardForm, string>>;

/** Blocking problems on one step; optional steps only check their limits. */
export function stepErrors(form: WizardForm, step: number): FieldErrors {
  const errors: FieldErrors = {};
  switch (wizardSteps[step]?.id) {
    case "idea": {
      if (form.theme.trim().length < 3)
        errors.theme = "Describe the idea in at least a few words.";
      if (genreOf(form).length < 2)
        errors.customGenre = "Type the genre, or pick one from the list.";
      break;
    }
    case "length": {
      const words = Number(form.targetWords);
      if (!Number.isInteger(words) || words < 300 || words > 200_000)
        errors.targetWords = "Enter a whole number from 300 to 200,000.";
      if (
        form.chaptersEdited &&
        parseNumber(form.chapterCount, { min: 1, max: 150, integer: true }) ===
          undefined
      )
        errors.chapterCount = "Enter 1 to 150 chapters.";
      break;
    }
    case "story": {
      if (
        form.budgetUsd.trim() !== "" &&
        parseNumber(form.budgetUsd, { min: 0, max: 10_000 }) === undefined
      )
        errors.budgetUsd = "Enter an amount from 0 to 10,000, or leave empty.";
      break;
    }
    case "author": {
      if (!form.authorProfileId) errors.authorProfileId = "Choose a pen name.";
      if (form.language.trim().length < 2)
        errors.language = "Choose a language.";
      if (form.isSeries && !form.seriesName.trim())
        errors.seriesName = "Name the series, or choose Standalone.";
      if (
        form.isSeries &&
        parseNumber(form.seriesNumber, { min: 1, max: 999, integer: true }) ===
          undefined
      )
        errors.seriesNumber = "Enter a number from 1 to 999.";
      break;
    }
    default:
      break;
  }
  return errors;
}

const optional = (value: string) => value.trim() || null;

export function buildPayload(form: WizardForm): CreateBookInput {
  return {
    authorProfileId: form.authorProfileId,
    title: null,
    subtitle: optional(form.subtitle),
    seriesName: form.isSeries ? optional(form.seriesName) : null,
    seriesNumber: form.isSeries ? Number(form.seriesNumber) : null,
    language: form.language,
    brief: {
      theme: form.theme.trim(),
      genre: genreOf(form),
      subgenre: optional(form.subgenre),
      audience: optional(form.audience),
      workingTitle: optional(form.workingTitle),
      setting: optional(form.setting),
      timePeriod: optional(form.timePeriod),
      mainCharacter: optional(form.mainCharacter),
      supportingCharacters: optional(form.supportingCharacters),
      centralConflict: optional(form.centralConflict),
      specialInstructions: optional(form.specialInstructions),
      pointOfView: form.pointOfView,
      tense: form.tense,
      tones: form.tones.slice(0, maxTones),
      suspense: form.suspense,
      horror: form.horror,
      romance: form.romance,
      violence: form.violence,
      sensuality: form.sensuality,
      ending: form.ending,
      pacing: form.pacing,
      isSeries: form.isSeries,
      lengthPreset: form.lengthPreset,
      targetWords: wordsOf(form),
      chapterCount: chaptersOf(form),
      forbidden: optional(form.forbidden),
      mandatoryElements: optional(form.mandatoryElements),
      referenceMaterial: optional(form.referenceMaterial),
      customBrief: optional(form.customBrief),
      craftProfile: optional(form.craftProfile),
    },
    settings: {
      budgetUsd: form.budgetUsd.trim() === "" ? null : Number(form.budgetUsd),
      routing: {},
    },
  };
}

/** API field paths shown with the wizard's own field names. */
export const payloadLabels: Record<string, string> = {
  authorProfileId: "Pen name",
  language: "Language",
  subtitle: "Subtitle",
  seriesName: "Series name",
  seriesNumber: "Number in series",
  "brief.theme": "Story idea",
  "brief.genre": "Genre",
  "brief.subgenre": "Subgenre",
  "brief.audience": "Audience",
  "brief.workingTitle": "Working title",
  "brief.setting": "Setting",
  "brief.timePeriod": "Time period",
  "brief.mainCharacter": "Main character",
  "brief.supportingCharacters": "Supporting characters",
  "brief.centralConflict": "Central conflict",
  "brief.specialInstructions": "Special instructions",
  "brief.tones": "Tone",
  "brief.targetWords": "Target length",
  "brief.chapterCount": "Chapters",
  "brief.forbidden": "Things to avoid",
  "brief.mandatoryElements": "Must include",
  "brief.referenceMaterial": "Reference material",
  "brief.customBrief": "Full custom brief",
  "brief.craftProfile": "Craft profile",
  "settings.budgetUsd": "AI budget",
};

// --- Draft kept on this device ---------------------------------------------

const storageKey = "kdp-new-story-draft-v1";

export function loadDraft(): { form: WizardForm; step: number } | null {
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as {
      form?: Partial<WizardForm>;
      step?: number;
    };
    if (!parsed.form || typeof parsed.form !== "object") return null;
    const form = { ...defaultWizardForm, ...parsed.form };
    if (!Array.isArray(form.tones)) form.tones = [];
    const step =
      typeof parsed.step === "number" &&
      parsed.step >= 0 &&
      parsed.step < wizardSteps.length
        ? Math.floor(parsed.step)
        : 0;
    return { form, step };
  } catch {
    return null;
  }
}

export function saveDraft(form: WizardForm, step: number): void {
  try {
    window.localStorage.setItem(storageKey, JSON.stringify({ form, step }));
  } catch {
    // Storage full or blocked: the wizard keeps working without a draft.
  }
}

export function clearDraft(): void {
  try {
    window.localStorage.removeItem(storageKey);
  } catch {
    // Nothing to clear.
  }
}

/** True once the user has typed something worth keeping. */
export function hasContent(form: WizardForm): boolean {
  return JSON.stringify(form) !== JSON.stringify(defaultWizardForm);
}
