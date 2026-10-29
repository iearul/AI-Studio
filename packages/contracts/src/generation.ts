import { z } from "zod";

import { referenceImageSchema, referenceViews } from "./bible.js";

export const generationProviders = [
  "comfyui",
  "manual",
  "openai",
  "gemini",
] as const;
export const cloudImageProviders = ["openai", "gemini"] as const;
export const paidImageConfirmation =
  "I AUTHORIZE THIS PAID GENERATION" as const;
export const generationStatuses = [
  "queued",
  "preparing",
  "generating",
  "downloading",
  "completed",
  "failed",
  "cancelled",
] as const;
export const attemptStatuses = [
  "queued",
  "generating",
  "succeeded",
  "failed",
  "cancelled",
] as const;
export const reviewStatuses = ["pending", "approved", "rejected"] as const;

export const generatedAssetSchema = z.object({
  id: z.uuid(),
  projectId: z.uuid(),
  shotId: z.uuid(),
  attemptId: z.uuid(),
  kind: z.literal("storyboard-image"),
  originalFilename: z.string().min(1).max(255),
  relativePath: z.string().min(1).max(1000),
  mimeType: z.enum(["image/jpeg", "image/png", "image/webp"]),
  byteSize: z.number().int().positive(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  width: z.number().int().positive().nullable(),
  height: z.number().int().positive().nullable(),
  createdAt: z.iso.datetime(),
});

export const generationJobSchema = z.object({
  id: z.uuid(),
  projectId: z.uuid(),
  shotId: z.uuid(),
  attemptId: z.uuid(),
  kind: z.literal("image"),
  provider: z.literal("comfyui"),
  status: z.enum(generationStatuses),
  progress: z.number().int().min(0).max(100),
  providerJobId: z.string().nullable(),
  errorMessage: z.string().nullable(),
  createdAt: z.iso.datetime(),
  startedAt: z.iso.datetime().nullable(),
  completedAt: z.iso.datetime().nullable(),
});

export const imageAttemptSchema = z.object({
  id: z.uuid(),
  projectId: z.uuid(),
  shotId: z.uuid(),
  shotCode: z.string(),
  provider: z.enum(generationProviders),
  model: z.string().nullable(),
  prompt: z.string().max(30000),
  negativePrompt: z.string().max(4000),
  references: z.array(referenceImageSchema),
  seed: z.number().int().nonnegative().nullable(),
  settings: z.record(z.string(), z.unknown()),
  status: z.enum(attemptStatuses),
  reviewStatus: z.enum(reviewStatuses),
  selected: z.boolean(),
  errorMessage: z.string().nullable(),
  costMicros: z.number().int().nonnegative(),
  currency: z.string().length(3),
  generationTimeMs: z.number().int().nonnegative().nullable(),
  asset: generatedAssetSchema.nullable(),
  job: generationJobSchema.nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const imageHistorySchema = z.object({
  attempts: z.array(imageAttemptSchema),
  totals: z.object({
    attempts: z.number().int().nonnegative(),
    succeeded: z.number().int().nonnegative(),
    approved: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
    costMicros: z.number().int().nonnegative(),
    currency: z.string().length(3),
  }),
});

export const imageReviewInputSchema = z.object({
  decision: z.enum(["approve", "reject"]),
});

export const imageQualitySchema = z.object({
  id: z.string().trim().min(1).max(40),
  label: z.string().trim().min(1).max(80),
  estimatedUsdPerImage: z.number().nonnegative(),
});

export const imageProviderModelSchema = z.object({
  id: z.string().trim().min(1).max(120),
  label: z.string().trim().min(1).max(120),
  qualities: z.array(imageQualitySchema).min(1),
  maxReferenceImages: z.number().int().nonnegative(),
  pricingMessage: z.string(),
});

export const imageProviderStatusSchema = z.object({
  id: z.enum(cloudImageProviders),
  label: z.string(),
  configured: z.boolean(),
  message: z.string(),
  defaultModel: z.string(),
  models: z.array(imageProviderModelSchema).min(1),
});

export const imageProviderListSchema = z.object({
  providers: z.array(imageProviderStatusSchema),
});

const cloudImageRequestFields = {
  provider: z.enum(cloudImageProviders),
  model: z.string().trim().min(1).max(120),
  quality: z.string().trim().min(1).max(40),
  confirmation: z.literal(paidImageConfirmation),
};

export const createCloudImageSchema = z.object(cloudImageRequestFields);

export const createCloudReferenceImageSchema = z.object({
  ...cloudImageRequestFields,
  view: z.enum(referenceViews),
});

export type GeneratedAsset = z.infer<typeof generatedAssetSchema>;
export type GenerationJob = z.infer<typeof generationJobSchema>;
export type ImageAttempt = z.infer<typeof imageAttemptSchema>;
export type ImageHistory = z.infer<typeof imageHistorySchema>;
export type ImageReviewInput = z.infer<typeof imageReviewInputSchema>;
export type CloudImageProviderId = z.infer<
  typeof imageProviderStatusSchema
>["id"];
export type ImageQuality = z.infer<typeof imageQualitySchema>;
export type ImageProviderModel = z.infer<typeof imageProviderModelSchema>;
export type ImageProviderStatus = z.infer<typeof imageProviderStatusSchema>;
export type CreateCloudImage = z.infer<typeof createCloudImageSchema>;
export type CreateCloudReferenceImage = z.infer<
  typeof createCloudReferenceImageSchema
>;
