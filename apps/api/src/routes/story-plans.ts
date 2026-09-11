import type { FastifyInstance } from "fastify";

import {
  storyGenerationInputSchema,
  storyPlanInputSchema,
} from "@ai-film-studio/contracts";
import { buildStoryRequest } from "@ai-film-studio/film-engine";

import { NotFoundError } from "../errors.js";
import type { Services } from "../services.js";

export function registerStoryPlanRoutes(
  app: FastifyInstance,
  services: Services,
): void {
  app.get("/providers/stories", async () => ({
    providers: await services.storyGenerations.getProviderStatuses(),
  }));

  app.get<{ Params: { id: string } }>("/projects/:id/story-plan", (request) => {
    const project = services.projects.getById(request.params.id);
    if (!project) throw new NotFoundError("Project");
    return { plan: services.storyPlans.get(project.id) ?? null };
  });

  app.put<{ Params: { id: string } }>(
    "/projects/:id/story-plan",
    async (request, reply) => {
      const input = storyPlanInputSchema.parse(request.body);
      const plan = services.storyPlans.save(request.params.id, input);
      const sync = await services.manifestSynchronizer.drain();
      return reply
        .header("x-manifest-sync", sync.failed === 0 ? "synced" : "pending")
        .send(plan);
    },
  );

  app.post<{ Params: { id: string } }>(
    "/projects/:id/story-plan/validate",
    (request) => {
      const project = services.projects.getById(request.params.id);
      if (!project) throw new NotFoundError("Project");
      return {
        valid: true,
        plan: storyPlanInputSchema.parse(request.body),
      };
    },
  );

  app.get<{ Params: { id: string } }>(
    "/projects/:id/story-request",
    (request) => {
      const project = services.projects.getById(request.params.id);
      if (!project) throw new NotFoundError("Project");
      return buildStoryRequest(project);
    },
  );

  app.post<{ Params: { id: string } }>(
    "/projects/:id/story-plan/generate",
    { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } },
    async (request) => {
      const { provider } = storyGenerationInputSchema.parse(request.body);
      return services.storyGenerations.generate(request.params.id, provider);
    },
  );
}
