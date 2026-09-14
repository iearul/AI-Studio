import { z } from "zod";

import { generatedAssetSchema, reviewStatuses } from "./generation.js";

export const videoProviders = ["manual", "kling", "seedance"] as const;
export const cloudVideoProviders = ["kling", "seedance"] as const;
export const videoAttemptStatuses = [
  "submitting",
  "submitted",
  "processing",
  "downloading",
  "succeeded",
  "failed",
  "cancelled",
] as const;
export const videoResolutions = ["720p", "1080p", "4k"] as const;
export const paidVideoConfirmation =
  "I AUTHORIZE THIS PAID GENERATION" as const;

const resolutionRateSchema = z.object({
  "720p": z.number().nonnegative().nullable(),
  "1080p": z.number().nonnegative().nullable(),
  "4k": z.number().nonnegative().nullable(),
});

export const videoProviderModelSchema = z.object({
  id: z.string().trim().min(1).max(120),
  label: z.string().trim().min(1).max(120),
  supportedResolutions: z.array(z.enum(videoResolutions)).min(1),
  supportedDurationsSeconds: z.array(z.number().int().positive()).min(1),
  supportsNativeAudio: z.boolean(),
  estimatedUsdPerSecond: z.object({
    withoutAudio: resolutionRateSchema,
    withAudio: resolutionRateSchema,
  }),
  pricingMessage: z.string(),
  continuityMessage: z.string(),
  warning: z.string().nullable(),
});

export const videoAssetSchema = z.object({
  id: z.uuid(),
  projectId: z.uuid(),
  shotId: z.uuid(),
  attemptId: z.uuid(),
  kind: z.literal("shot-video"),
  originalFilename: z.string().min(1).max(255),
  relativePath: z.string().min(1).max(1000),
  mimeType: z.enum(["video/mp4", "video/quicktime", "video/webm"]),
  byteSize: z.number().int().positive(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  createdAt: z.iso.datetime(),
});

export const videoAttemptSchema = z.object({
  id: z.uuid(),
  projectId: z.uuid(),
  shotId: z.uuid(),
  shotCode: z.string(),
  provider: z.enum(videoProviders),
  model: z.string().nullable(),
  prompt: z.string().min(1).max(30_000),
  sourceImageAsset: generatedAssetSchema.nullable(),
  providerJobId: z.string().nullable(),
  status: z.enum(videoAttemptStatuses),
  reviewStatus: z.enum(reviewStatuses),
  selected: z.boolean(),
  resolution: z.enum(videoResolutions),
  requestedDurationSeconds: z.number().int().min(1).max(30),
  generateAudio: z.boolean(),
  settings: z.record(z.string(), z.unknown()),
  errorMessage: z.string().nullable(),
  costMicros: z.number().int().nonnegative(),
  costIsEstimate: z.boolean(),
  currency: z.literal("USD"),
  resultExpiresAt: z.iso.datetime().nullable(),
  asset: videoAssetSchema.nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const videoHistorySchema = z.object({
  attempts: z.array(videoAttemptSchema),
  totals: z.object({
    attempts: z.number().int().nonnegative(),
    succeeded: z.number().int().nonnegative(),
    approved: z.number().int().nonnegative(),
    active: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
    costMicros: z.number().int().nonnegative(),
    currency: z.literal("USD"),
  }),
});

export const videoProviderStatusSchema = z.object({
  id: z.enum(cloudVideoProviders),
  label: z.string(),
  configured: z.boolean(),
  defaultModel: z.string(),
  models: z.array(videoProviderModelSchema).min(1),
});

export const videoShotPlanSchema = z.object({
  shotId: z.uuid(),
  shotCode: z.string(),
  action: z.string(),
  cameraMovement: z.string(),
  durationSeconds: z.number().positive(),
  prompt: z.string().min(1).max(30_000),
  sourceImageAsset: generatedAssetSchema.nullable(),
  attempts: z.array(videoAttemptSchema),
});

export const videoWorkspaceSchema = z.object({
  providers: z.array(videoProviderStatusSchema),
  shots: z.array(videoShotPlanSchema),
  totals: videoHistorySchema.shape.totals,
});

export const createCloudVideoSchema = z.object({
  provider: z.enum(cloudVideoProviders),
  model: z.string().trim().min(1).max(120),
  resolution: z.enum(videoResolutions),
  generateAudio: z.boolean().default(false),
  confirmation: z.literal(paidVideoConfirmation),
});

export const videoReviewInputSchema = z.object({
  decision: z.enum(["approve", "reject"]),
});

export type VideoProviderId = z.infer<typeof videoProviderStatusSchema>["id"];
export type VideoResolution = z.infer<
  typeof createCloudVideoSchema
>["resolution"];
export type VideoAsset = z.infer<typeof videoAssetSchema>;
export type VideoAttempt = z.infer<typeof videoAttemptSchema>;
export type VideoHistory = z.infer<typeof videoHistorySchema>;
export type VideoProviderStatus = z.infer<typeof videoProviderStatusSchema>;
export type VideoProviderModel = z.infer<typeof videoProviderModelSchema>;
export type VideoShotPlan = z.infer<typeof videoShotPlanSchema>;
export type VideoWorkspace = z.infer<typeof videoWorkspaceSchema>;
export type CreateCloudVideo = z.infer<typeof createCloudVideoSchema>;
