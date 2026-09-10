import { z } from "zod";

import { referenceImageSchema } from "./bible.js";

export const generationProviders = ["comfyui", "manual"] as const;
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

export const imageGenerationInputSchema = z.object({
  provider: z.literal("comfyui").default("comfyui"),
  negativePrompt: z.string().trim().max(4000).default(""),
  seed: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
  width: z.number().int().min(256).max(4096).multipleOf(8).default(1024),
  height: z.number().int().min(256).max(4096).multipleOf(8).default(1024),
});

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

export const imageProviderStatusSchema = z.object({
  id: z.literal("comfyui"),
  name: z.string(),
  configured: z.boolean(),
  available: z.boolean(),
  baseUrl: z.string(),
  workflowPath: z.string().nullable(),
  model: z.string().nullable(),
  message: z.string(),
});

export type ImageGenerationInput = z.input<typeof imageGenerationInputSchema>;
export type GeneratedAsset = z.infer<typeof generatedAssetSchema>;
export type GenerationJob = z.infer<typeof generationJobSchema>;
export type ImageAttempt = z.infer<typeof imageAttemptSchema>;
export type ImageHistory = z.infer<typeof imageHistorySchema>;
export type ImageReviewInput = z.infer<typeof imageReviewInputSchema>;
export type ImageProviderStatus = z.infer<typeof imageProviderStatusSchema>;
