import { z } from "zod";

import { reviewStatuses } from "./generation.js";

export const audioKinds = ["narration", "dialogue", "sfx", "music"] as const;
export const audioProviders = ["elevenlabs"] as const;
export const audioAttemptStatuses = [
  "generating",
  "succeeded",
  "failed",
] as const;
export const voiceRoles = ["narrator", "character"] as const;
export const paidAudioConfirmation =
  "I AUTHORIZE THIS PAID GENERATION" as const;

export const voiceSchema = z.object({
  voiceId: z.string().min(1).max(200),
  name: z.string().min(1).max(200),
  category: z.string().nullable(),
  description: z.string().nullable(),
  labels: z.record(z.string(), z.string()),
  previewUrl: z.string().nullable(),
});

export const voiceListSchema = z.object({ voices: z.array(voiceSchema) });

export const voiceProfileSchema = z.object({
  id: z.uuid(),
  projectId: z.uuid(),
  role: z.enum(voiceRoles),
  characterId: z.uuid().nullable(),
  provider: z.enum(audioProviders),
  voiceId: z.string().min(1).max(200),
  voiceName: z.string().min(1).max(200),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const saveVoiceProfileSchema = z
  .object({
    role: z.enum(voiceRoles),
    characterId: z.uuid().nullable().default(null),
    voiceId: z.string().trim().min(1).max(200),
    voiceName: z.string().trim().min(1).max(200),
  })
  .refine(
    (value) => (value.role === "narrator") === (value.characterId === null),
    "A narrator voice has no character; a character voice needs one.",
  );

export const audioAssetSchema = z.object({
  relativePath: z.string().min(1).max(1000),
  mimeType: z.literal("audio/mpeg"),
  byteSize: z.number().int().positive(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
});

export const audioAttemptSchema = z.object({
  id: z.uuid(),
  projectId: z.uuid(),
  kind: z.enum(audioKinds),
  targetKey: z.string().min(1).max(200),
  sceneId: z.uuid().nullable(),
  shotId: z.uuid().nullable(),
  provider: z.enum(audioProviders),
  model: z.string().min(1).max(120),
  text: z.string().max(30_000),
  settings: z.record(z.string(), z.unknown()),
  status: z.enum(audioAttemptStatuses),
  reviewStatus: z.enum(reviewStatuses),
  selected: z.boolean(),
  errorMessage: z.string().nullable(),
  costMicros: z.number().int().nonnegative(),
  currency: z.literal("USD"),
  generationTimeMs: z.number().int().nonnegative().nullable(),
  asset: audioAssetSchema.nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const audioProviderStatusSchema = z.object({
  id: z.enum(audioProviders),
  label: z.string(),
  configured: z.boolean(),
  message: z.string(),
  speechModel: z.string(),
  soundEffectModel: z.string(),
  musicModel: z.string(),
  estimatedUsd: z.object({
    speechPer1kCharacters: z.number().nonnegative(),
    soundEffectPerMinute: z.number().nonnegative(),
    musicPerMinute: z.number().nonnegative(),
  }),
});

export const dialogueLineSchema = z.object({
  speaker: z.string(),
  characterId: z.uuid().nullable(),
  text: z.string(),
});

const attemptList = z.array(audioAttemptSchema);

export const audioWorkspaceSchema = z.object({
  provider: audioProviderStatusSchema,
  languageCode: z.string().nullable(),
  narrator: voiceProfileSchema.nullable(),
  characters: z.array(
    z.object({
      characterId: z.uuid(),
      code: z.string(),
      name: z.string(),
      voiceDescription: z.string(),
      profile: voiceProfileSchema.nullable(),
    }),
  ),
  music: z.object({
    prompt: z.string(),
    durationSeconds: z.number().positive(),
    attempts: attemptList,
  }),
  scenes: z.array(
    z.object({
      sceneId: z.uuid(),
      sceneNumber: z.number().int().positive(),
      location: z.string(),
      narration: z.object({
        text: z.string().nullable(),
        attempts: attemptList,
      }),
      dialogue: z.object({
        lines: z.array(dialogueLineSchema),
        missingVoices: z.array(z.string()),
        attempts: attemptList,
      }),
      shots: z.array(
        z.object({
          shotId: z.uuid(),
          shotCode: z.string(),
          action: z.string(),
          soundEffects: z.object({
            prompt: z.string(),
            durationSeconds: z.number().positive(),
            attempts: attemptList,
          }),
        }),
      ),
    }),
  ),
  totals: z.object({
    attempts: z.number().int().nonnegative(),
    succeeded: z.number().int().nonnegative(),
    approved: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
    costMicros: z.number().int().nonnegative(),
    currency: z.literal("USD"),
  }),
});

export const createAudioGenerationSchema = z.object({
  confirmation: z.literal(paidAudioConfirmation),
});

export const audioReviewInputSchema = z.object({
  decision: z.enum(["approve", "reject"]),
});

export type AudioKind = (typeof audioKinds)[number];
export type Voice = z.infer<typeof voiceSchema>;
export type VoiceProfile = z.infer<typeof voiceProfileSchema>;
export type SaveVoiceProfile = z.infer<typeof saveVoiceProfileSchema>;
export type AudioAsset = z.infer<typeof audioAssetSchema>;
export type AudioAttempt = z.infer<typeof audioAttemptSchema>;
export type AudioProviderStatus = z.infer<typeof audioProviderStatusSchema>;
export type DialogueLine = z.infer<typeof dialogueLineSchema>;
export type AudioWorkspace = z.infer<typeof audioWorkspaceSchema>;
