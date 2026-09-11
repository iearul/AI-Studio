import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";

import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";

import {
  characterInputSchema,
  locationInputSchema,
  propInputSchema,
  referenceViews,
  type ReferenceOwnerType,
} from "@ai-film-studio/contracts";
import {
  buildCharacterReferencePrompt,
  buildReferenceCoverage,
} from "@ai-film-studio/film-engine";
import { ReferenceImageValidationError } from "@ai-film-studio/storage";

import { NotFoundError } from "../errors.js";
import type { Services } from "../services.js";

const projectParamsSchema = z.object({ id: z.uuid() });
const entityParamsSchema = projectParamsSchema.extend({ entityId: z.uuid() });
const referenceParamsSchema = projectParamsSchema.extend({
  referenceId: z.uuid(),
});
const referenceOwnerParamsSchema = entityParamsSchema.extend({
  ownerType: z.enum(["characters", "locations", "props"]),
});
const uploadQuerySchema = z.object({ view: z.enum(referenceViews) });

function ownerType(
  value: "characters" | "locations" | "props",
): ReferenceOwnerType {
  return value === "characters"
    ? "character"
    : value === "locations"
      ? "location"
      : "prop";
}

async function syncManifest(
  services: Services,
  reply: FastifyReply,
): Promise<void> {
  const sync = await services.manifestSynchronizer.drain();
  void reply.header(
    "x-manifest-sync",
    sync.failed === 0 ? "synced" : "pending",
  );
}

export function registerBibleRoutes(
  app: FastifyInstance,
  services: Services,
): void {
  app.get<{ Params: { id: string } }>("/projects/:id/bible", (request) => {
    const { id } = projectParamsSchema.parse(request.params);
    return services.bible.list(id);
  });

  app.get<{ Params: { id: string } }>(
    "/projects/:id/reference-coverage",
    (request) => {
      const { id } = projectParamsSchema.parse(request.params);
      const project = services.projects.getById(id);
      if (!project) throw new NotFoundError("Project");
      return buildReferenceCoverage(
        project,
        services.storyPlans.get(id),
        services.bible.list(id),
      );
    },
  );

  app.get<{ Params: { id: string; entityId: string } }>(
    "/projects/:id/characters/:entityId/reference-prompt",
    (request) => {
      const { id, entityId } = entityParamsSchema.parse(request.params);
      const project = services.projects.getById(id);
      if (!project) throw new NotFoundError("Project");
      const character = services.bible
        .list(id)
        .characters.find((candidate) => candidate.id === entityId);
      if (!character) throw new NotFoundError("Character");
      return buildCharacterReferencePrompt(project, character);
    },
  );

  app.post<{ Params: { id: string } }>(
    "/projects/:id/characters",
    async (request, reply) => {
      const { id } = projectParamsSchema.parse(request.params);
      const character = services.bible.createCharacter(
        id,
        characterInputSchema.parse(request.body),
      );
      await syncManifest(services, reply);
      return reply.status(201).send(character);
    },
  );

  app.put<{ Params: { id: string; entityId: string } }>(
    "/projects/:id/characters/:entityId",
    async (request, reply) => {
      const { id, entityId } = entityParamsSchema.parse(request.params);
      const character = services.bible.updateCharacter(
        id,
        entityId,
        characterInputSchema.parse(request.body),
      );
      await syncManifest(services, reply);
      return character;
    },
  );

  app.post<{ Params: { id: string } }>(
    "/projects/:id/locations",
    async (request, reply) => {
      const { id } = projectParamsSchema.parse(request.params);
      const location = services.bible.createLocation(
        id,
        locationInputSchema.parse(request.body),
      );
      await syncManifest(services, reply);
      return reply.status(201).send(location);
    },
  );

  app.put<{ Params: { id: string; entityId: string } }>(
    "/projects/:id/locations/:entityId",
    async (request, reply) => {
      const { id, entityId } = entityParamsSchema.parse(request.params);
      const location = services.bible.updateLocation(
        id,
        entityId,
        locationInputSchema.parse(request.body),
      );
      await syncManifest(services, reply);
      return location;
    },
  );

  app.post<{ Params: { id: string } }>(
    "/projects/:id/props",
    async (request, reply) => {
      const { id } = projectParamsSchema.parse(request.params);
      const prop = services.bible.createProp(
        id,
        propInputSchema.parse(request.body),
      );
      await syncManifest(services, reply);
      return reply.status(201).send(prop);
    },
  );

  app.put<{ Params: { id: string; entityId: string } }>(
    "/projects/:id/props/:entityId",
    async (request, reply) => {
      const { id, entityId } = entityParamsSchema.parse(request.params);
      const prop = services.bible.updateProp(
        id,
        entityId,
        propInputSchema.parse(request.body),
      );
      await syncManifest(services, reply);
      return prop;
    },
  );

  app.post<{
    Params: {
      id: string;
      ownerType: "characters" | "locations" | "props";
      entityId: string;
    };
    Querystring: { view: string };
  }>(
    "/projects/:id/:ownerType/:entityId/references",
    { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const params = referenceOwnerParamsSchema.parse(request.params);
      const query = uploadQuerySchema.parse(request.query);
      const upload = await request.file({
        limits: { files: 1, fileSize: 8 * 1024 * 1024, parts: 1 },
      });
      if (!upload) {
        throw new ReferenceImageValidationError(
          "A reference image is required.",
        );
      }
      const buffer = await upload.toBuffer();
      const type = ownerType(params.ownerType);
      const stored = await services.referenceImages.save({
        projectId: params.id,
        ownerType: type,
        ownerId: params.entityId,
        originalFilename: upload.filename,
        declaredMimeType: upload.mimetype,
        buffer,
      });
      try {
        const reference = services.bible.addReference(params.id, {
          ownerType: type,
          ownerId: params.entityId,
          view: query.view,
          ...stored,
        });
        await syncManifest(services, reply);
        return reply.status(201).send(reference);
      } catch (error) {
        await services.referenceImages.remove(params.id, stored.relativePath);
        throw error;
      }
    },
  );

  app.get<{ Params: { id: string; referenceId: string } }>(
    "/projects/:id/references/:referenceId/content",
    async (request, reply) => {
      const { id, referenceId } = referenceParamsSchema.parse(request.params);
      const reference = services.bible.getReference(id, referenceId);
      if (!reference) throw new NotFoundError("Reference image");
      const absolutePath = services.referenceImages.absolutePath(
        id,
        reference.relativePath,
      );
      try {
        await stat(absolutePath);
      } catch {
        throw new NotFoundError("Reference image file");
      }
      return reply
        .type(reference.mimeType)
        .header("Content-Length", reference.byteSize)
        .header("Cache-Control", "private, max-age=3600")
        .header("Cross-Origin-Resource-Policy", "cross-origin")
        .send(createReadStream(absolutePath));
    },
  );
}
