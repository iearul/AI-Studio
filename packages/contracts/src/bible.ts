import { z } from "zod";

const shortText = z.string().trim().max(240).default("");
const descriptiveText = z.string().trim().max(4000).default("");
const textList = z.array(z.string().trim().min(1).max(240)).max(50).default([]);
const generatedShortText = z.string().trim().max(240);
const generatedDescriptiveText = z.string().trim().max(4000);
const generatedTextList = z.array(z.string().trim().min(1).max(240)).max(50);

export const referenceOwnerTypes = ["character", "location", "prop"] as const;
export const referenceViews = [
  "front",
  "three-quarter",
  "profile",
  "full-body",
  "neutral",
  "expression",
  "exterior-day",
  "exterior-night",
  "interior",
  "detail",
  "other",
] as const;

export const characterInputSchema = z.object({
  name: z.string().trim().min(2).max(160),
  age: z.number().int().min(0).max(150).nullable().default(null),
  gender: shortText,
  culturalAppearance: descriptiveText,
  faceDescription: descriptiveText,
  hair: descriptiveText,
  eyes: descriptiveText,
  skin: descriptiveText,
  height: shortText,
  bodyType: shortText,
  defaultClothing: textList,
  alternativeClothing: textList,
  accessories: textList,
  personality: descriptiveText,
  voice: descriptiveText,
  speechStyle: descriptiveText,
});

export const locationInputSchema = z.object({
  name: z.string().trim().min(2).max(200),
  countryCulture: shortText,
  type: shortText,
  description: descriptiveText,
  architecture: descriptiveText,
  materials: textList,
  furniture: textList,
  defaultLighting: descriptiveText,
  colorPalette: textList,
  nearbyEnvironment: descriptiveText,
  periodDetails: descriptiveText,
});

export const propInputSchema = z.object({
  name: z.string().trim().min(2).max(200),
  description: descriptiveText,
  materials: textList,
  colors: textList,
  significance: descriptiveText,
  continuityNotes: descriptiveText,
});

export const characterGenerationInputSchema = z.object({
  name: z.string().trim().min(2).max(160),
  age: z.number().int().min(0).max(150).nullable(),
  gender: generatedShortText,
  culturalAppearance: generatedDescriptiveText,
  faceDescription: generatedDescriptiveText,
  hair: generatedDescriptiveText,
  eyes: generatedDescriptiveText,
  skin: generatedDescriptiveText,
  height: generatedShortText,
  bodyType: generatedShortText,
  defaultClothing: generatedTextList,
  alternativeClothing: generatedTextList,
  accessories: generatedTextList,
  personality: generatedDescriptiveText,
  voice: generatedDescriptiveText,
  speechStyle: generatedDescriptiveText,
});

export const locationGenerationInputSchema = z.object({
  name: z.string().trim().min(2).max(200),
  countryCulture: generatedShortText,
  type: generatedShortText,
  description: generatedDescriptiveText,
  architecture: generatedDescriptiveText,
  materials: generatedTextList,
  furniture: generatedTextList,
  defaultLighting: generatedDescriptiveText,
  colorPalette: generatedTextList,
  nearbyEnvironment: generatedDescriptiveText,
  periodDetails: generatedDescriptiveText,
});

export const propGenerationInputSchema = z.object({
  name: z.string().trim().min(2).max(200),
  description: generatedDescriptiveText,
  materials: generatedTextList,
  colors: generatedTextList,
  significance: generatedDescriptiveText,
  continuityNotes: generatedDescriptiveText,
});

export const storyVisualBibleInputSchema = z.object({
  characters: z.array(characterInputSchema).max(50).default([]),
  locations: z.array(locationInputSchema).max(100).default([]),
  props: z.array(propInputSchema).max(150).default([]),
});

export const storyVisualBibleGenerationSchema = z.object({
  characters: z.array(characterGenerationInputSchema).max(50),
  locations: z.array(locationGenerationInputSchema).max(100),
  props: z.array(propGenerationInputSchema).max(150),
});

export const referenceImageSchema = z.object({
  id: z.uuid(),
  projectId: z.uuid(),
  ownerType: z.enum(referenceOwnerTypes),
  ownerId: z.uuid(),
  view: z.enum(referenceViews),
  originalFilename: z.string().min(1).max(255),
  relativePath: z.string().min(1).max(1000),
  mimeType: z.enum(["image/jpeg", "image/png", "image/webp"]),
  byteSize: z.number().int().positive(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  createdAt: z.iso.datetime(),
});

const bibleRecordFields = {
  id: z.uuid(),
  projectId: z.uuid(),
  code: z.string().regex(/^[A-Z]+_[A-Z0-9_]+_[0-9]{3}$/),
  references: z.array(referenceImageSchema),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
};

export const characterSchema = characterInputSchema.extend(bibleRecordFields);
export const locationSchema = locationInputSchema.extend(bibleRecordFields);
export const propSchema = propInputSchema.extend(bibleRecordFields);

export const bibleSchema = z.object({
  characters: z.array(characterSchema),
  locations: z.array(locationSchema),
  props: z.array(propSchema),
});

export const createReferenceImageSchema = z.object({
  ownerType: z.enum(referenceOwnerTypes),
  ownerId: z.uuid(),
  view: z.enum(referenceViews),
  originalFilename: z.string().trim().min(1).max(255),
  relativePath: z.string().min(1).max(1000),
  mimeType: z.enum(["image/jpeg", "image/png", "image/webp"]),
  byteSize: z.number().int().positive(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
});

export const unresolvedReferenceSchema = z.object({
  ownerType: z.enum(referenceOwnerTypes),
  value: z.string(),
});

export const resolvedBibleEntitySchema = z.object({
  id: z.uuid(),
  code: z.string(),
  name: z.string(),
  references: z.array(referenceImageSchema),
});

export const shotReferenceContextSchema = z.object({
  shotId: z.uuid(),
  shotCode: z.string(),
  ready: z.boolean(),
  characters: z.array(resolvedBibleEntitySchema),
  location: resolvedBibleEntitySchema.nullable(),
  props: z.array(resolvedBibleEntitySchema),
  unresolved: z.array(unresolvedReferenceSchema),
  warnings: z.array(z.string()),
  prompt: z.string(),
});

export const referenceCoverageSchema = z.object({
  shots: z.array(shotReferenceContextSchema),
  totals: z.object({
    shots: z.number().int().nonnegative(),
    ready: z.number().int().nonnegative(),
    unresolved: z.number().int().nonnegative(),
    withoutImages: z.number().int().nonnegative(),
  }),
});

export const characterReferencePromptSchema = z.object({
  characterId: z.uuid(),
  characterCode: z.string(),
  view: z.enum(referenceViews),
  filename: z.string().min(1).max(255),
  prompt: z.string().min(1).max(30000),
  ready: z.boolean(),
  missingDetails: z.array(z.string()),
});

export type CharacterInput = z.input<typeof characterInputSchema>;
export type LocationInput = z.input<typeof locationInputSchema>;
export type PropInput = z.input<typeof propInputSchema>;
export type StoryVisualBibleInput = z.input<typeof storyVisualBibleInputSchema>;
export type Character = z.infer<typeof characterSchema>;
export type Location = z.infer<typeof locationSchema>;
export type Prop = z.infer<typeof propSchema>;
export type ReferenceOwnerType = z.infer<
  typeof referenceImageSchema
>["ownerType"];
export type ReferenceView = z.infer<typeof referenceImageSchema>["view"];
export type ReferenceImage = z.infer<typeof referenceImageSchema>;
export type CreateReferenceImage = z.infer<typeof createReferenceImageSchema>;
export type Bible = z.infer<typeof bibleSchema>;
export type ShotReferenceContext = z.infer<typeof shotReferenceContextSchema>;
export type ReferenceCoverage = z.infer<typeof referenceCoverageSchema>;
export type CharacterReferencePrompt = z.infer<
  typeof characterReferencePromptSchema
>;
