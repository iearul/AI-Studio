import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";

import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { imageReviewInputSchema } from "@ai-film-studio/contracts";
import { StoryboardAssetValidationError } from "@ai-film-studio/storage";

import { NotFoundError } from "../errors.js";
import type { Services } from "../services.js";

const projectParamsSchema = z.object({ id: z.uuid() });
const shotParamsSchema = projectParamsSchema.extend({ shotId: z.uuid() });
const attemptParamsSchema = projectParamsSchema.extend({
  attemptId: z.uuid(),
});
const assetParamsSchema = projectParamsSchema.extend({ assetId: z.uuid() });

export function registerGenerationRoutes(
  app: FastifyInstance,
  services: Services,
): void {
  app.get<{ Params: { id: string } }>(
    "/projects/:id/image-history",
    (request) => {
      const { id } = projectParamsSchema.parse(request.params);
      return services.imageGenerations.getHistory(id);
    },
  );

  app.post<{ Params: { id: string; shotId: string } }>(
    "/projects/:id/shots/:shotId/image-imports",
    { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const { id, shotId } = shotParamsSchema.parse(request.params);
      const upload = await request.file({
        limits: { files: 1, fileSize: 8 * 1024 * 1024, parts: 1 },
      });
      if (!upload) {
        throw new StoryboardAssetValidationError(
          "A storyboard image is required.",
        );
      }
      const attempt = await services.imageGenerations.importManual({
        projectId: id,
        shotId,
        originalFilename: upload.filename,
        declaredMimeType: upload.mimetype,
        buffer: await upload.toBuffer(),
      });
      return reply.status(201).send(attempt);
    },
  );

  app.post<{ Params: { id: string; attemptId: string } }>(
    "/projects/:id/image-attempts/:attemptId/review",
    async (request) => {
      const { id, attemptId } = attemptParamsSchema.parse(request.params);
      const { decision } = imageReviewInputSchema.parse(request.body);
      return services.imageGenerations.review(id, attemptId, decision);
    },
  );

  app.get<{ Params: { id: string; assetId: string } }>(
    "/projects/:id/assets/:assetId/content",
    async (request, reply) => {
      const { id, assetId } = assetParamsSchema.parse(request.params);
      const asset = services.generations.getAsset(id, assetId);
      if (!asset) throw new NotFoundError("Storyboard asset");
      const absolutePath = services.storyboardAssets.absolutePath(
        id,
        asset.relativePath,
      );
      try {
        await stat(absolutePath);
      } catch {
        throw new NotFoundError("Storyboard asset file");
      }
      return reply
        .type(asset.mimeType)
        .header("Content-Length", asset.byteSize)
        .header("Cache-Control", "private, max-age=3600, immutable")
        .header("Cross-Origin-Resource-Policy", "cross-origin")
        .send(createReadStream(absolutePath));
    },
  );
}
