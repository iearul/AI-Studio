import { z } from "zod";

import { kdpRoutingSchema } from "./kdp-common.js";

const text = (max: number) => z.string().trim().max(max);
const optionalText = (max: number) =>
  z.string().trim().max(max).nullable().default(null);

// --- Author profiles -------------------------------------------------------

export const authorLinkSchema = z.object({
  label: text(60).min(1),
  url: z.url().max(500),
});

export const authorProfileInputSchema = z.object({
  penName: text(120).min(2),
  genres: z.array(text(60).min(1)).max(12).default([]),
  defaultLanguage: text(20).min(2).default("en"),
  defaultStyle: optionalText(2000),
  biography: optionalText(4000),
  shortBiography: optionalText(600),
  website: z.url().max(500).nullable().default(null),
  links: z.array(authorLinkSchema).max(10).default([]),
  dedication: optionalText(1000),
  contentNotice: optionalText(2000),
  aboutAuthor: optionalText(4000),
  callToAction: optionalText(2000),
  nextBookPreview: optionalText(20_000),
  copyrightNotice: optionalText(2000),
  coverBranding: optionalText(1000),
  contentPreferences: optionalText(2000),
  isDefault: z.boolean().default(false),
  /** A provisional name has not been checked for legal or trademark use. */
  provisional: z.boolean().default(true),
});

export const authorProfileSchema = authorProfileInputSchema.extend({
  id: z.uuid(),
  ownerId: z.string(),
  photoPath: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const updateAuthorProfileSchema = authorProfileInputSchema.partial();

// --- Story brief -----------------------------------------------------------

export const lengthPresetIds = [
  "flash-fiction",
  "short-story",
  "novelette",
  "novella",
  "short-novel",
  "novel",
  "long-novel",
  "custom",
] as const;
export const pointsOfView = [
  "first-person",
  "third-limited",
  "third-omniscient",
  "multiple-pov",
  "second-person",
] as const;
export const narrativeTenses = ["past", "present"] as const;
export const sensualityLevels = [
  "none",
  "mild",
  "suggestive",
  "fade-to-black",
] as const;
export const endingPreferences = [
  "happy",
  "tragic",
  "bittersweet",
  "ambiguous",
  "twist",
] as const;
export const pacingOptions = ["slow-burn", "balanced", "fast"] as const;

const intensity = (min: number, fallback: number) =>
  z.number().int().min(min).max(5).default(fallback);

export const storyBriefSchema = z.object({
  theme: text(4000).min(3),
  genre: text(80).min(2),
  subgenre: optionalText(80),
  audience: optionalText(200),
  workingTitle: optionalText(200),
  setting: optionalText(1000),
  timePeriod: optionalText(200),
  mainCharacter: optionalText(2000),
  supportingCharacters: optionalText(4000),
  centralConflict: optionalText(2000),
  specialInstructions: optionalText(4000),
  pointOfView: z.enum(pointsOfView).default("third-limited"),
  tense: z.enum(narrativeTenses).default("past"),
  tones: z.array(text(40).min(1)).max(8).default([]),
  suspense: intensity(1, 3),
  horror: intensity(0, 0),
  romance: intensity(0, 0),
  violence: intensity(0, 1),
  sensuality: z.enum(sensualityLevels).default("none"),
  ending: z.enum(endingPreferences).default("bittersweet"),
  pacing: z.enum(pacingOptions).default("balanced"),
  isSeries: z.boolean().default(false),
  lengthPreset: z.enum(lengthPresetIds).default("novella"),
  targetWords: z.number().int().min(300).max(200_000),
  chapterCount: z.number().int().min(1).max(150),
  forbidden: optionalText(4000),
  mandatoryElements: optionalText(4000),
  referenceMaterial: optionalText(20_000),
  /** An advanced user's complete brief; it overrides conflicting fields. */
  customBrief: optionalText(20_000),
  craftProfile: optionalText(60),
});

// --- Books -----------------------------------------------------------------

export const bookStatuses = [
  "draft",
  "ready",
  "published",
  "archived",
] as const;
export const bookStages = [
  "brief",
  "concepts",
  "bible",
  "outline",
  "drafting",
  "editing",
  "publishing",
] as const;

export const backMatterKinds = [
  "about-author",
  "next-book-preview",
  "call-to-action",
] as const;

/** Front and back matter choices; texts default to the pen name profile. */
export const bookMatterSchema = z.object({
  dedication: optionalText(1000),
  includeContentNotice: z.boolean().default(false),
  contentNotice: optionalText(2000),
  includeToc: z.boolean().default(true),
  backMatter: z.array(z.enum(backMatterKinds)).max(3).default(["about-author"]),
  /** KDP takes the cover separately; embedding it is only for other stores. */
  embedCoverInEpub: z.boolean().default(false),
});

export const bookSettingsSchema = z.object({
  /** `null` uses the studio default from KDP settings. */
  budgetUsd: z.number().min(0).max(10_000).nullable().default(null),
  routing: kdpRoutingSchema.partial().default({}),
  matter: bookMatterSchema.prefault({}),
});

export const createBookSchema = z.object({
  authorProfileId: z.uuid(),
  title: text(200).min(1).nullable().default(null),
  subtitle: optionalText(200),
  seriesName: optionalText(200),
  seriesNumber: z.number().int().min(1).max(999).nullable().default(null),
  language: text(20).min(2),
  brief: storyBriefSchema,
  settings: bookSettingsSchema.prefault({}),
});

export const updateBookSchema = z.object({
  authorProfileId: z.uuid().optional(),
  title: text(200).min(1).optional(),
  subtitle: z.string().trim().max(200).nullable().optional(),
  seriesName: z.string().trim().max(200).nullable().optional(),
  seriesNumber: z.number().int().min(1).max(999).nullable().optional(),
  language: text(20).min(2).optional(),
  status: z.enum(bookStatuses).optional(),
  brief: storyBriefSchema.optional(),
  settings: bookSettingsSchema.optional(),
});

export const bookSchema = z.object({
  id: z.uuid(),
  ownerId: z.string(),
  authorProfileId: z.uuid().nullable(),
  title: z.string(),
  subtitle: z.string().nullable(),
  seriesName: z.string().nullable(),
  seriesNumber: z.number().int().nullable(),
  language: z.string(),
  genre: z.string(),
  subgenre: z.string().nullable(),
  status: z.enum(bookStatuses),
  stage: z.enum(bookStages),
  brief: storyBriefSchema,
  settings: bookSettingsSchema,
  selectedConceptId: z.uuid().nullable(),
  currentCoverId: z.uuid().nullable(),
  manuscriptApprovedAt: z.string().nullable(),
  listingApprovedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  deletedAt: z.string().nullable(),
});

export const bookActiveJobSchema = z.object({
  id: z.uuid(),
  kind: z.string(),
  status: z.string(),
  progress: z.number(),
  progressLabel: z.string().nullable(),
});

export const bookSummarySchema = bookSchema.extend({
  penName: z.string().nullable(),
  actualWords: z.number().int(),
  chaptersPlanned: z.number().int(),
  chaptersDrafted: z.number().int(),
  chaptersApproved: z.number().int(),
  spentMicros: z.number().int(),
  activeJob: bookActiveJobSchema.nullable(),
  lastExportAt: z.string().nullable(),
  coverThumbnail: z.string().nullable(),
});

export const bookListQuerySchema = z.object({
  search: z.string().trim().max(200).optional(),
  status: z.enum(bookStatuses).optional(),
  authorProfileId: z.uuid().optional(),
  genre: z.string().trim().max(80).optional(),
  series: z.string().trim().max(200).optional(),
  includeDeleted: z
    .enum(["true", "false"])
    .transform((value) => value === "true")
    .optional(),
  sort: z
    .enum(["updated", "created", "title", "words", "status"])
    .default("updated"),
});

export type AuthorLink = z.infer<typeof authorLinkSchema>;
export type AuthorProfileInput = z.input<typeof authorProfileInputSchema>;
export type AuthorProfile = z.infer<typeof authorProfileSchema>;
export type UpdateAuthorProfile = z.infer<typeof updateAuthorProfileSchema>;
export type LengthPresetId = (typeof lengthPresetIds)[number];
export type PointOfView = (typeof pointsOfView)[number];
export type StoryBrief = z.infer<typeof storyBriefSchema>;
export type StoryBriefInput = z.input<typeof storyBriefSchema>;
export type BookStatus = (typeof bookStatuses)[number];
export type BookStage = (typeof bookStages)[number];
export type BookSettings = z.infer<typeof bookSettingsSchema>;
export type BookMatter = z.infer<typeof bookMatterSchema>;
export type BackMatterKind = (typeof backMatterKinds)[number];
export type CreateBookInput = z.input<typeof createBookSchema>;
export type CreateBook = z.infer<typeof createBookSchema>;
export type UpdateBook = z.infer<typeof updateBookSchema>;
export type Book = z.infer<typeof bookSchema>;
export type BookSummary = z.infer<typeof bookSummarySchema>;
export type BookListQuery = z.infer<typeof bookListQuerySchema>;
