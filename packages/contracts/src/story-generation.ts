import { z } from "zod";

import { storyPlanGenerationSchema } from "./story-plan.js";

export const automaticStoryProviderIds = ["openai", "ollama"] as const;

export const storyProviderStatusSchema = z.object({
  id: z.enum(automaticStoryProviderIds),
  name: z.string(),
  mode: z.enum(["cloud-paid", "local-free"]),
  configured: z.boolean(),
  available: z.boolean(),
  model: z.string().nullable(),
  message: z.string(),
});

export const storyProviderListSchema = z.object({
  providers: z.array(storyProviderStatusSchema),
});

export const storyGenerationInputSchema = z.object({
  provider: z.enum(automaticStoryProviderIds),
});

export const storyGenerationUsageSchema = z.object({
  inputTokens: z.number().int().nonnegative().nullable(),
  outputTokens: z.number().int().nonnegative().nullable(),
});

export const storyGenerationResultSchema = z.object({
  provider: z.enum(automaticStoryProviderIds),
  providerName: z.string(),
  model: z.string(),
  generationTimeMs: z.number().int().nonnegative(),
  usage: storyGenerationUsageSchema,
  plan: storyPlanGenerationSchema,
});

export type AutomaticStoryProviderId = z.infer<
  typeof storyGenerationInputSchema
>["provider"];
export type StoryProviderStatus = z.infer<typeof storyProviderStatusSchema>;
export type StoryGenerationUsage = z.infer<typeof storyGenerationUsageSchema>;
export type StoryGenerationResult = z.infer<typeof storyGenerationResultSchema>;
