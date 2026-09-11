import { z } from "zod";

export const shotTypes = [
  "extreme-wide",
  "wide",
  "medium-wide",
  "medium",
  "medium-close-up",
  "close-up",
  "extreme-close-up",
  "over-the-shoulder",
  "pov",
  "insert",
  "reaction",
] as const;

export const cameraAngles = [
  "eye-level",
  "low-angle",
  "high-angle",
  "dutch-angle",
  "birds-eye",
  "ground-level",
] as const;

export const cameraMovements = [
  "static",
  "pan",
  "tilt",
  "dolly-in",
  "dolly-out",
  "tracking",
  "orbit",
  "crane",
  "handheld",
  "slow-push-in",
  "rack-focus",
] as const;

export const lenses = [
  "24mm",
  "35mm",
  "50mm",
  "85mm",
  "telephoto",
  "wide-angle",
  "macro",
] as const;

const optionalNarrativeText = z.string().trim().max(4000).nullable().optional();
const generatedNarrativeText = z.string().trim().max(4000).nullable();

export const storyInputSchema = z.object({
  title: z.string().trim().min(2).max(160),
  logline: z.string().trim().min(10).max(500),
  genre: z.string().trim().min(2).max(100),
  theme: z.string().trim().min(2).max(240),
  tone: z.string().trim().min(2).max(240),
  mainConflict: z.string().trim().min(5).max(1000),
  mainCharacter: z.string().trim().min(2).max(160),
  supportingCharacters: z.array(z.string().trim().min(1).max(160)).max(20),
  beginning: z.string().trim().min(10).max(4000),
  middle: z.string().trim().min(10).max(4000),
  climax: z.string().trim().min(10).max(4000),
  ending: z.string().trim().min(10).max(4000),
  audienceEmotion: z.string().trim().min(2).max(500),
  hook: optionalNarrativeText,
  twist: optionalNarrativeText,
  cliffhanger: optionalNarrativeText,
  retentionMoments: z.array(z.string().trim().min(2).max(500)).max(20),
});

export const scriptInputSchema = z.object({
  title: z.string().trim().min(2).max(160),
  notes: z.string().trim().max(4000).nullable().optional(),
});

export const shotInputSchema = z.object({
  code: z
    .string()
    .trim()
    .regex(/^SHOT_[0-9]{3,4}$/)
    .optional(),
  durationSeconds: z.number().min(0.5).max(30),
  characters: z.array(z.string().trim().min(1).max(160)).max(20),
  props: z.array(z.string().trim().min(1).max(160)).max(30).default([]),
  location: z.string().trim().min(1).max(240),
  shotType: z.enum(shotTypes),
  cameraAngle: z.enum(cameraAngles),
  lens: z.enum(lenses),
  cameraMovement: z.enum(cameraMovements),
  action: z.string().trim().min(3).max(2000),
  lighting: z.string().trim().min(2).max(1000),
  emotion: z.string().trim().min(2).max(500),
  status: z.enum(["draft", "approved"]).default("draft"),
});

export const sceneInputSchema = z.object({
  sceneNumber: z.number().int().min(1).max(999),
  location: z.string().trim().min(2).max(240),
  timeOfDay: z.string().trim().min(2).max(100),
  characters: z.array(z.string().trim().min(1).max(160)).max(20),
  action: z.string().trim().min(5).max(5000),
  narration: optionalNarrativeText,
  dialogue: optionalNarrativeText,
  estimatedDurationSeconds: z.number().min(1).max(600),
  emotionalPurpose: z.string().trim().min(2).max(1000),
  shots: z.array(shotInputSchema).min(1).max(100),
});

export const storyPlanInputSchema = z
  .object({
    story: storyInputSchema,
    script: scriptInputSchema,
    scenes: z.array(sceneInputSchema).min(1).max(200),
  })
  .superRefine(validateStoryPlan);

export const storyPlanGenerationSchema = z
  .object({
    story: storyInputSchema.extend({
      hook: generatedNarrativeText,
      twist: generatedNarrativeText,
      cliffhanger: generatedNarrativeText,
    }),
    script: scriptInputSchema.extend({ notes: generatedNarrativeText }),
    scenes: z
      .array(
        sceneInputSchema.extend({
          narration: generatedNarrativeText,
          dialogue: generatedNarrativeText,
          shots: z
            .array(
              shotInputSchema.extend({
                code: z
                  .string()
                  .trim()
                  .regex(/^SHOT_[0-9]{3,4}$/),
                props: z.array(z.string().trim().min(1).max(160)).max(30),
                status: z.enum(["draft", "approved"]),
              }),
            )
            .min(1)
            .max(100),
        }),
      )
      .min(1)
      .max(200),
  })
  .superRefine(validateStoryPlan);

export const storySchema = storyInputSchema.extend({
  id: z.uuid(),
  projectId: z.uuid(),
  version: z.number().int().positive(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const scriptSchema = scriptInputSchema.extend({
  id: z.uuid(),
  projectId: z.uuid(),
  version: z.number().int().positive(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const shotSchema = shotInputSchema.extend({
  id: z.uuid(),
  projectId: z.uuid(),
  sceneId: z.uuid(),
  position: z.number().int().nonnegative(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const sceneSchema = sceneInputSchema.omit({ shots: true }).extend({
  id: z.uuid(),
  projectId: z.uuid(),
  scriptId: z.uuid(),
  position: z.number().int().nonnegative(),
  shots: z.array(shotSchema),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const storyPlanSchema = z.object({
  story: storySchema,
  script: scriptSchema,
  scenes: z.array(sceneSchema),
  totals: z.object({
    scenes: z.number().int().nonnegative(),
    shots: z.number().int().nonnegative(),
    shotDurationSeconds: z.number().nonnegative(),
  }),
});

export const storyPlanResponseSchema = z.object({
  plan: storyPlanSchema.nullable(),
});

export const storyRequestSchema = z.object({
  filename: z.string(),
  prompt: z.string(),
});

export type StoryInput = z.infer<typeof storyInputSchema>;
export type ScriptInput = z.infer<typeof scriptInputSchema>;
export type ShotInput = z.input<typeof shotInputSchema>;
export type SceneInput = z.input<typeof sceneInputSchema>;
export type StoryPlanInput = z.input<typeof storyPlanInputSchema>;
export type StoryPlanGeneration = z.infer<typeof storyPlanGenerationSchema>;
export type Story = z.infer<typeof storySchema>;
export type Script = z.infer<typeof scriptSchema>;
export type Shot = z.infer<typeof shotSchema>;
export type Scene = z.infer<typeof sceneSchema>;
export type StoryPlan = z.infer<typeof storyPlanSchema>;

function validateStoryPlan(
  plan: {
    scenes: Array<{
      sceneNumber: number;
      shots: Array<{ code?: string }>;
    }>;
  },
  context: z.RefinementCtx,
): void {
  const sceneNumbers = new Set<number>();
  const shotCodes = new Set<string>();
  let shotCount = 0;
  plan.scenes.forEach((scene, sceneIndex) => {
    if (sceneNumbers.has(scene.sceneNumber)) {
      context.addIssue({
        code: "custom",
        message: `Scene number ${scene.sceneNumber} is duplicated.`,
        path: ["scenes", sceneIndex, "sceneNumber"],
      });
    }
    sceneNumbers.add(scene.sceneNumber);
    scene.shots.forEach((shot, shotIndex) => {
      shotCount += 1;
      if (shot.code && shotCodes.has(shot.code)) {
        context.addIssue({
          code: "custom",
          message: `Shot code ${shot.code} is duplicated.`,
          path: ["scenes", sceneIndex, "shots", shotIndex, "code"],
        });
      }
      if (shot.code) shotCodes.add(shot.code);
    });
  });
  if (shotCount > 500) {
    context.addIssue({
      code: "custom",
      message: "A story plan can contain at most 500 shots.",
      path: ["scenes"],
    });
  }
}
