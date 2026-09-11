import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";

import type { FastifyInstance } from "fastify";
import { z } from "zod";

import {
  createCloudVideoSchema,
  videoReviewInputSchema,
} from "@ai-film-studio/contracts";
import { VideoAssetValidationError } from "@ai-film-studio/storage";

import { NotFoundError } from "../errors.js";
import type { Services } from "../services.js";

const projectParamsSchema = z.object({ id: z.uuid() });
const shotParamsSchema = projectParamsSchema.extend({ shotId: z.uuid() });
const attemptParamsSchema = projectParamsSchema.extend({
  attemptId: z.uuid(),
});
const assetParamsSchema = projectParamsSchema.extend({ assetId: z.uuid() });

export function registerVideoRoutes(
  app: FastifyInstance,
  services: Services,
): void {
  app.get<{ Params: { id: string } }>(
    "/projects/:id/video-workspace",
    (request) => {
      const { id } = projectParamsSchema.parse(request.params);
      return services.videoGenerations.workspace(id);
    },
  );

  app.post<{ Params: { id: string; shotId: string } }>(
    "/projects/:id/shots/:shotId/video-imports",
    { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const { id, shotId } = shotParamsSchema.parse(request.params);
      const upload = await request.file({
        limits: { files: 1, fileSize: 512 * 1024 * 1024, parts: 1 },
      });
      if (!upload) {
        throw new VideoAssetValidationError("A shot video is required.");
      }
      const attempt = await services.videoGenerations.importManual({
        projectId: id,
        shotId,
        originalFilename: upload.filename,
        declaredMimeType: upload.mimetype,
        stream: upload.file,
      });
      return reply.status(201).send(attempt);
    },
  );

  app.post<{ Params: { id: string; shotId: string } }>(
    "/projects/:id/shots/:shotId/video-generations",
    { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const { id, shotId } = shotParamsSchema.parse(request.params);
      const input = createCloudVideoSchema.parse(request.body);
      const attempt = await services.videoGenerations.submitCloud(
        id,
        shotId,
        input,
      );
      return reply.status(202).send(attempt);
    },
  );

  app.post<{ Params: { id: string; attemptId: string } }>(
    "/projects/:id/video-attempts/:attemptId/refresh",
    async (request) => {
      const { id, attemptId } = attemptParamsSchema.parse(request.params);
      return services.videoGenerations.refresh(id, attemptId);
    },
  );

  app.post<{ Params: { id: string; attemptId: string } }>(
    "/projects/:id/video-attempts/:attemptId/review",
    async (request) => {
      const { id, attemptId } = attemptParamsSchema.parse(request.params);
      const { decision } = videoReviewInputSchema.parse(request.body);
      return services.videoGenerations.review(id, attemptId, decision);
    },
  );

  app.get<{ Params: { id: string; assetId: string } }>(
    "/projects/:id/video-assets/:assetId/content",
    async (request, reply) => {
      const { id, assetId } = assetParamsSchema.parse(request.params);
      const asset = services.videos.getAsset(id, assetId);
      if (!asset) throw new NotFoundError("Video asset");
      const absolutePath = services.videoAssets.absolutePath(
        id,
        asset.relativePath,
      );
      let info;
      try {
        info = await stat(absolutePath);
      } catch {
        throw new NotFoundError("Video asset file");
      }
      const range = parseRange(request.headers.range, info.size);
      reply
        .type(asset.mimeType)
        .header("Accept-Ranges", "bytes")
        .header("Cache-Control", "private, max-age=3600, immutable")
        .header("Cross-Origin-Resource-Policy", "cross-origin");
      if (!range) {
        return reply
          .header("Content-Length", info.size)
          .send(createReadStream(absolutePath));
      }
      return reply
        .status(206)
        .header("Content-Length", range.end - range.start + 1)
        .header(
          "Content-Range",
          `bytes ${range.start}-${range.end}/${info.size}`,
        )
        .send(createReadStream(absolutePath, range));
    },
  );
}

function parseRange(
  value: string | undefined,
  size: number,
): { start: number; end: number } | undefined {
  if (!value) return undefined;
  const match = /^bytes=(\d+)-(\d*)$/.exec(value.trim());
  if (!match) throw new VideoAssetValidationError("Invalid video byte range.");
  const start = Number(match[1]);
  const requestedEnd = match[2] ? Number(match[2]) : size - 1;
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(requestedEnd) ||
    start < 0 ||
    requestedEnd < start ||
    start >= size
  ) {
    throw new VideoAssetValidationError("Invalid video byte range.");
  }
  return { start, end: Math.min(requestedEnd, size - 1) };
}
