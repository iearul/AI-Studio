import {
  storyGenerationResultSchema,
  storyPlanGenerationSchema,
  type AutomaticStoryProviderId,
  type StoryGenerationResult,
  type StoryProviderStatus,
} from "@ai-film-studio/contracts";
import type { ProjectRepository } from "@ai-film-studio/database";
import { buildStoryRequest } from "@ai-film-studio/film-engine";
import {
  TextProviderConfigurationError,
  TextProviderResponseError,
  TextProviderUnavailableError,
  type TextProvider,
} from "@ai-film-studio/providers";
import { z } from "zod";

import { NotFoundError, StoryGenerationBusyError } from "./errors.js";

export class StoryGenerationService {
  private readonly providers: Map<AutomaticStoryProviderId, TextProvider>;
  private readonly activeProjects = new Set<string>();

  constructor(
    private readonly projects: ProjectRepository,
    providers: TextProvider[],
  ) {
    this.providers = new Map(
      providers.map((provider) => [provider.id, provider]),
    );
  }

  getProviderStatuses(): Promise<StoryProviderStatus[]> {
    return Promise.all(
      [...this.providers.values()].map((provider) => provider.getStatus()),
    );
  }

  async generate(
    projectId: string,
    providerId: AutomaticStoryProviderId,
  ): Promise<StoryGenerationResult> {
    const project = this.projects.getById(projectId);
    if (!project) throw new NotFoundError("Project");
    const provider = this.providers.get(providerId);
    if (!provider) {
      throw new TextProviderConfigurationError(
        `Story provider ${providerId} is not configured.`,
      );
    }
    if (this.activeProjects.has(projectId))
      throw new StoryGenerationBusyError();

    const status = await provider.getStatus();
    if (!status.configured) {
      throw new TextProviderConfigurationError(status.message);
    }
    if (!status.available) {
      throw new TextProviderUnavailableError(status.message);
    }

    this.activeProjects.add(projectId);
    const startedAt = Date.now();
    try {
      const schema = z.toJSONSchema(storyPlanGenerationSchema, {
        target: "draft-7",
        unrepresentable: "throw",
      }) as Record<string, unknown>;
      const generated = await provider.generate({
        prompt: buildStoryRequest(project).prompt,
        schemaName: "film_story_plan",
        schema,
      });
      const parsed = storyPlanGenerationSchema.safeParse(generated.output);
      if (!parsed.success) {
        const issues = parsed.error.issues
          .slice(0, 3)
          .map(
            (issue) =>
              `${issue.path.join(".") || "response"}: ${issue.message}`,
          )
          .join(" ");
        throw new TextProviderResponseError(
          `The model returned a story plan that failed validation. ${issues}`,
        );
      }
      return storyGenerationResultSchema.parse({
        provider: provider.id,
        providerName: status.name,
        model: generated.model,
        generationTimeMs: Date.now() - startedAt,
        usage: generated.usage,
        plan: parsed.data,
      });
    } finally {
      this.activeProjects.delete(projectId);
    }
  }
}
