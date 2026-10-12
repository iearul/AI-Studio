import { stat } from "node:fs/promises";

import type { FastifyInstance } from "fastify";
import { z } from "zod";

import {
  audioReviewInputSchema,
  createAudioGenerationSchema,
  saveVoiceProfileSchema,
} from "@ai-film-studio/contracts";
import { AudioAssetValidationError } from "@ai-film-studio/storage";

import { NotFoundError } from "../errors.js";
import { sendRangedFile } from "./ranged-file.js";
import type { Services } from "../services.js";

const projectParamsSchema = z.object({ id: z.uuid() });
const sceneParamsSchema = projectParamsSchema.extend({ sceneId: z.uuid() });
const shotParamsSchema = projectParamsSchema.extend({ shotId: z.uuid() });
const attemptParamsSchema = projectParamsSchema.extend({
  attemptId: z.uuid(),
});
const paidLimit = {
  config: { rateLimit: { max: 30, timeWindow: "1 minute" } },
};

export function registerAudioRoutes(
  app: FastifyInstance,
  services: Services,
): void {
  app.get("/providers/audio", () => ({
    provider: services.audioGenerations.status(),
  }));

  app.get("/providers/audio/voices", async () => ({
    voices: await services.audioGenerations.listVoices(),
  }));

  app.get<{ Params: { id: string } }>(
    "/projects/:id/sound-workspace",
    (request) => {
      const { id } = projectParamsSchema.parse(request.params);
      return services.audioGenerations.workspace(id);
    },
  );

  app.put<{ Params: { id: string } }>(
    "/projects/:id/voice-profiles",
    async (request) => {
      const { id } = projectParamsSchema.parse(request.params);
      return services.audioGenerations.saveVoiceProfile(
        id,
        saveVoiceProfileSchema.parse(request.body),
      );
    },
  );

  app.post<{ Params: { id: string; sceneId: string } }>(
    "/projects/:id/scenes/:sceneId/narration-generations",
    paidLimit,
    async (request, reply) => {
      const { id, sceneId } = sceneParamsSchema.parse(request.params);
      createAudioGenerationSchema.parse(request.body);
      return reply
        .status(202)
        .send(await services.audioGenerations.generateNarration(id, sceneId));
    },
  );

  app.post<{ Params: { id: string; sceneId: string } }>(
    "/projects/:id/scenes/:sceneId/dialogue-generations",
    paidLimit,
    async (request, reply) => {
      const { id, sceneId } = sceneParamsSchema.parse(request.params);
      createAudioGenerationSchema.parse(request.body);
      return reply
        .status(202)
        .send(await services.audioGenerations.generateDialogue(id, sceneId));
    },
  );

  app.post<{ Params: { id: string; shotId: string } }>(
    "/projects/:id/shots/:shotId/sound-effect-generations",
    paidLimit,
    async (request, reply) => {
      const { id, shotId } = shotParamsSchema.parse(request.params);
      createAudioGenerationSchema.parse(request.body);
      return reply
        .status(202)
        .send(await services.audioGenerations.generateSoundEffect(id, shotId));
    },
  );

  app.post<{ Params: { id: string } }>(
    "/projects/:id/music-generations",
    paidLimit,
    async (request, reply) => {
      const { id } = projectParamsSchema.parse(request.params);
      createAudioGenerationSchema.parse(request.body);
      return reply
        .status(202)
        .send(await services.audioGenerations.generateMusic(id));
    },
  );

  app.post<{ Params: { id: string; attemptId: string } }>(
    "/projects/:id/audio-attempts/:attemptId/review",
    async (request) => {
      const { id, attemptId } = attemptParamsSchema.parse(request.params);
      const { decision } = audioReviewInputSchema.parse(request.body);
      return services.audioGenerations.review(id, attemptId, decision);
    },
  );

  app.get<{ Params: { id: string; attemptId: string } }>(
    "/projects/:id/audio-attempts/:attemptId/content",
    async (request, reply) => {
      const { id, attemptId } = attemptParamsSchema.parse(request.params);
      const asset = services.audio.getAttempt(id, attemptId)?.asset;
      if (!asset) throw new NotFoundError("Audio");
      const absolutePath = services.audioAssets.absolutePath(
        id,
        asset.relativePath,
      );
      let info;
      try {
        info = await stat(absolutePath);
      } catch {
        throw new NotFoundError("Audio file");
      }
      return sendRangedFile(
        request,
        reply,
        { absolutePath, size: info.size, mimeType: asset.mimeType },
        () => new AudioAssetValidationError("Invalid audio byte range."),
      );
    },
  );
}
