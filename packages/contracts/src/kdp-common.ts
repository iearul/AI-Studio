import { z } from "zod";

export const kdpLocalOwnerId = "local-owner";

export const kdpTasks = [
  "idea",
  "architect",
  "writer",
  "inspector",
  "reviewer",
  "proofreader",
  "metadata",
  "cover",
] as const;

export const kdpTaskLabels: Record<(typeof kdpTasks)[number], string> = {
  idea: "Idea generator",
  architect: "Story architect",
  writer: "Chapter writer",
  inspector: "Continuity inspector",
  reviewer: "Editorial reviewer",
  proofreader: "Proofreader",
  metadata: "Metadata generator",
  cover: "Cover prompt generator",
};

export const kdpTextProviderIds = ["anthropic", "openai", "ollama"] as const;
export const kdpEfforts = ["low", "medium", "high", "xhigh", "max"] as const;

export const kdpTaskRouteSchema = z.object({
  provider: z.enum(kdpTextProviderIds),
  /** `null` uses the provider's model from `.env.local`. */
  model: z.string().trim().min(1).max(120).nullable(),
  /** Claude only; ignored by other providers. */
  effort: z.enum(kdpEfforts).nullable(),
});

export const kdpModelPriceSchema = z.object({
  provider: z.enum(kdpTextProviderIds),
  model: z.string().trim().min(1).max(120),
  inputPerMTok: z.number().min(0).max(1000),
  outputPerMTok: z.number().min(0).max(1000),
  cacheReadPerMTok: z.number().min(0).max(1000),
  cacheWritePerMTok: z.number().min(0).max(1000),
  /** False until the user confirms the price against the provider's page. */
  verified: z.boolean(),
  source: z.string().trim().max(300).nullable(),
});

const routingShape = Object.fromEntries(
  kdpTasks.map((task) => [task, kdpTaskRouteSchema]),
) as Record<(typeof kdpTasks)[number], typeof kdpTaskRouteSchema>;

export const kdpRoutingSchema = z.object(routingShape);

export const kdpSettingsSchema = z.object({
  routing: kdpRoutingSchema,
  prices: z.array(kdpModelPriceSchema).max(60),
  /** Fallback price for a model missing from the table, used for budgets. */
  unknownModelPrice: z.object({
    inputPerMTok: z.number().min(0).max(1000),
    outputPerMTok: z.number().min(0).max(1000),
  }),
  defaultBudgetUsd: z.number().min(0).max(10_000),
  maxConcurrentRequestsPerProvider: z.number().int().min(1).max(8),
  maxRetries: z.number().int().min(0).max(6),
  defaultCraftProfile: z.string().trim().max(60),
});

export const updateKdpSettingsSchema = kdpSettingsSchema.partial();

export const kdpProviderHealthSchema = z.object({
  id: z.enum(kdpTextProviderIds),
  name: z.string(),
  configured: z.boolean(),
  available: z.boolean(),
  model: z.string().nullable(),
  message: z.string(),
  checkedAt: z.string(),
});

export type KdpTask = (typeof kdpTasks)[number];
export type KdpTextProviderId = (typeof kdpTextProviderIds)[number];
export type KdpEffort = (typeof kdpEfforts)[number];
export type KdpTaskRoute = z.infer<typeof kdpTaskRouteSchema>;
export type KdpModelPrice = z.infer<typeof kdpModelPriceSchema>;
export type KdpRouting = z.infer<typeof kdpRoutingSchema>;
export type KdpSettings = z.infer<typeof kdpSettingsSchema>;
export type UpdateKdpSettings = z.infer<typeof updateKdpSettingsSchema>;
export type KdpProviderHealth = z.infer<typeof kdpProviderHealthSchema>;
