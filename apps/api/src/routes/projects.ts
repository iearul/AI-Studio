import type { FastifyInstance } from "fastify";

import {
  createProjectSchema,
  projectListQuerySchema,
  updateProjectSchema,
} from "@ai-studio/contracts";

import { NotFoundError } from "../errors.js";
import type { Services } from "../services.js";

export function registerProjectRoutes(
  app: FastifyInstance,
  services: Services,
): void {
  app.get("/projects", (request) => {
    const query = projectListQuerySchema.parse(request.query);
    const items = services.projects.list(query);
    return { items, total: items.length };
  });

  app.get<{ Params: { id: string } }>("/projects/:id", (request) => {
    const project = services.projects.getById(request.params.id);
    if (!project) throw new NotFoundError("Project");
    return project;
  });

  app.post(
    "/projects",
    { config: { rateLimit: { max: 30 } } },
    async (request, reply) => {
      const input = createProjectSchema.parse(request.body);
      const project = services.projects.create(input);
      const sync = await services.manifestSynchronizer.drain();
      return reply
        .header("x-manifest-sync", sync.failed === 0 ? "synced" : "pending")
        .status(201)
        .send(project);
    },
  );

  app.patch<{ Params: { id: string } }>(
    "/projects/:id",
    async (request, reply) => {
      const input = updateProjectSchema.parse(request.body);
      const project = services.projects.update(request.params.id, input);
      if (!project) throw new NotFoundError("Project");
      const sync = await services.manifestSynchronizer.drain();
      return reply
        .header("x-manifest-sync", sync.failed === 0 ? "synced" : "pending")
        .send(project);
    },
  );
}
