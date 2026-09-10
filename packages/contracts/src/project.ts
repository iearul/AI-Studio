import { z } from "zod";

export const projectTypes = ["reel", "video"] as const;
export const projectLanguages = ["bn", "en", "de", "other"] as const;
export const aspectRatios = ["9:16", "16:9", "1:1"] as const;
export const projectStyles = [
  "mystery",
  "horror",
  "historical",
  "mythological",
  "documentary",
  "cinematic",
  "custom",
] as const;
export const narrationModes = ["narrator", "dialogue", "both", "none"] as const;
export const projectStatuses = ["draft", "active", "archived"] as const;

const optionalShortText = z.string().trim().max(240).optional().nullable();

const projectInputSchema = z.object({
  title: z.string().trim().min(2).max(120),
  type: z.enum(projectTypes),
  topic: z.string().trim().min(3).max(500),
  language: z.enum(projectLanguages),
  customLanguage: optionalShortText,
  targetDurationSeconds: z.number().int().min(15).max(1500),
  aspectRatio: z.enum(aspectRatios),
  style: z.enum(projectStyles),
  customStyle: optionalShortText,
  narration: z.enum(narrationModes),
  targetAudience: optionalShortText,
  tone: optionalShortText,
  ageRating: optionalShortText,
  countryCulture: optionalShortText,
  visualStyle: optionalShortText,
  desiredEnding: optionalShortText,
});

function validateProjectInput(
  project: z.infer<typeof projectInputSchema>,
  context: z.RefinementCtx,
): void {
  if (project.language === "other" && !project.customLanguage) {
    context.addIssue({
      code: "custom",
      message: "Enter the custom language.",
      path: ["customLanguage"],
    });
  }
  if (project.style === "custom" && !project.customStyle) {
    context.addIssue({
      code: "custom",
      message: "Enter the custom style.",
      path: ["customStyle"],
    });
  }
  const maximumDuration = project.type === "reel" ? 90 : 1500;
  if (project.targetDurationSeconds > maximumDuration) {
    context.addIssue({
      code: "too_big",
      maximum: maximumDuration,
      origin: "number",
      inclusive: true,
      message:
        project.type === "reel"
          ? "Reels can be at most 90 seconds."
          : "Videos can be at most 25 minutes.",
      path: ["targetDurationSeconds"],
    });
  }
}

export const createProjectSchema =
  projectInputSchema.superRefine(validateProjectInput);

export const updateProjectSchema = projectInputSchema
  .omit({ type: true })
  .partial()
  .extend({ status: z.enum(projectStatuses).optional() });

export const projectSchema = projectInputSchema
  .extend({
    id: z.uuid(),
    slug: z.string(),
    status: z.enum(projectStatuses),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .superRefine(validateProjectInput);

export const projectListQuerySchema = z.object({
  type: z.enum(projectTypes).optional(),
  status: z.enum(projectStatuses).optional(),
  search: z.string().trim().max(120).optional(),
});

export const projectListSchema = z.object({
  items: z.array(projectSchema),
  total: z.number().int().nonnegative(),
});

export type Project = z.infer<typeof projectSchema>;
export type CreateProjectInput = z.infer<typeof createProjectSchema>;
export type UpdateProjectInput = z.infer<typeof updateProjectSchema>;
export type ProjectListQuery = z.infer<typeof projectListQuerySchema>;
