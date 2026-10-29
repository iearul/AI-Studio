import type { FastifyError, FastifyInstance } from "fastify";
import { ZodError } from "zod";

import {
  BibleConflictError,
  BibleEntityNotFoundError,
  BibleProjectNotFoundError,
  GenerationNotFoundError,
  GenerationStateError,
  KdpConflictError,
  KdpNotFoundError,
  StoryPlanDurationError,
  StoryPlanProjectNotFoundError,
} from "@ai-studio/database";
import {
  AudioProviderConfigurationError,
  AudioProviderResponseError,
  AudioProviderUnavailableError,
  ImageProviderConfigurationError,
  ImageProviderResponseError,
  ImageProviderUnavailableError,
  TextProviderConfigurationError,
  TextProviderResponseError,
  TextProviderUnavailableError,
  VideoProviderConfigurationError,
  VideoProviderResponseError,
  VideoProviderUnavailableError,
} from "@ai-studio/providers";
import {
  BackupIntegrityError,
  BackupNotFoundError,
  GoogleDriveConfigurationError,
  GoogleDriveResponseError,
  GoogleDriveUnavailableError,
  ReferenceImageValidationError,
  VideoAssetValidationError,
} from "@ai-studio/storage";

import {
  GoogleDriveOAuthStateError,
  GoogleDriveSyncBusyError,
} from "./google-drive-service.js";
import { KdpBudgetExceededError } from "./kdp/ai-router.js";
import {
  DictationBusyError,
  DictationInputError,
  DictationUnavailableError,
} from "./kdp/dictation.js";
import { KdpCoverValidationError } from "./kdp/kdp-service.js";

export class NotFoundError extends Error {
  constructor(resource: string) {
    super(`${resource} was not found.`);
    this.name = "NotFoundError";
  }
}

export class StoryGenerationBusyError extends Error {
  constructor() {
    super("A story is already being generated for this project.");
    this.name = "StoryGenerationBusyError";
  }
}

function validationErrors(error: ZodError): Record<string, string[]> {
  const errors: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const field = issue.path.join(".") || "request";
    errors[field] = [...(errors[field] ?? []), issue.message];
  }
  return errors;
}

export function registerErrorHandler(app: FastifyInstance): void {
  app.setNotFoundHandler((request, reply) => {
    void reply.status(404).type("application/problem+json").send({
      type: "https://ai-studio.local/problems/not-found",
      title: "Not found",
      status: 404,
      detail: "The requested endpoint does not exist.",
      instance: request.url,
    });
  });

  app.setErrorHandler((error: FastifyError | Error, request, reply) => {
    if (error instanceof ZodError) {
      void reply
        .status(422)
        .type("application/problem+json")
        .send({
          type: "https://ai-studio.local/problems/validation",
          title: "Validation failed",
          status: 422,
          detail: "One or more request fields are invalid.",
          instance: request.url,
          errors: validationErrors(error),
        });
      return;
    }
    if (
      error instanceof NotFoundError ||
      error instanceof BackupNotFoundError ||
      error instanceof BibleProjectNotFoundError ||
      error instanceof BibleEntityNotFoundError ||
      error instanceof GenerationNotFoundError ||
      error instanceof StoryPlanProjectNotFoundError ||
      error instanceof KdpNotFoundError
    ) {
      void reply.status(404).type("application/problem+json").send({
        type: "https://ai-studio.local/problems/not-found",
        title: "Not found",
        status: 404,
        detail: error.message,
        instance: request.url,
      });
      return;
    }
    if (
      error instanceof GenerationStateError ||
      error instanceof StoryGenerationBusyError
    ) {
      void reply.status(409).type("application/problem+json").send({
        type: "https://ai-studio.local/problems/generation-state",
        title: "Generation state conflict",
        status: 409,
        detail: error.message,
        instance: request.url,
      });
      return;
    }
    if (error instanceof KdpConflictError) {
      void reply.status(409).type("application/problem+json").send({
        type: "https://ai-studio.local/problems/kdp-conflict",
        title: "The book changed or the action is not allowed now",
        status: 409,
        detail: error.message,
        instance: request.url,
      });
      return;
    }
    if (error instanceof KdpBudgetExceededError) {
      void reply.status(409).type("application/problem+json").send({
        type: "https://ai-studio.local/problems/kdp-budget",
        title: "Budget limit reached",
        status: 409,
        detail: error.message,
        instance: request.url,
      });
      return;
    }
    if (error instanceof KdpCoverValidationError) {
      void reply.status(422).type("application/problem+json").send({
        type: "https://ai-studio.local/problems/kdp-cover",
        title: "Invalid cover image",
        status: 422,
        detail: error.message,
        instance: request.url,
      });
      return;
    }
    if (error instanceof DictationInputError) {
      void reply.status(422).type("application/problem+json").send({
        type: "https://ai-studio.local/problems/dictation-input",
        title: "Invalid recording",
        status: 422,
        detail: error.message,
        instance: request.url,
      });
      return;
    }
    if (error instanceof DictationBusyError) {
      void reply.status(409).type("application/problem+json").send({
        type: "https://ai-studio.local/problems/dictation-busy",
        title: "Transcription is busy",
        status: 409,
        detail: error.message,
        instance: request.url,
      });
      return;
    }
    if (error instanceof DictationUnavailableError) {
      void reply.status(503).type("application/problem+json").send({
        type: "https://ai-studio.local/problems/dictation-unavailable",
        title: "Voice input is unavailable",
        status: 503,
        detail: error.message,
        instance: request.url,
      });
      return;
    }
    if (error instanceof GoogleDriveSyncBusyError) {
      void reply.status(409).type("application/problem+json").send({
        type: "https://ai-studio.local/problems/google-drive-sync",
        title: "Google Drive sync is already running",
        status: 409,
        detail: error.message,
        instance: request.url,
      });
      return;
    }
    if (
      error instanceof GoogleDriveConfigurationError ||
      error instanceof GoogleDriveOAuthStateError
    ) {
      void reply.status(422).type("application/problem+json").send({
        type: "https://ai-studio.local/problems/google-drive-configuration",
        title: "Google Drive is not ready",
        status: 422,
        detail: error.message,
        instance: request.url,
      });
      return;
    }
    if (error instanceof GoogleDriveUnavailableError) {
      void reply.status(503).type("application/problem+json").send({
        type: "https://ai-studio.local/problems/google-drive-unavailable",
        title: "Google Drive is unavailable",
        status: 503,
        detail: error.message,
        instance: request.url,
      });
      return;
    }
    if (error instanceof GoogleDriveResponseError) {
      void reply.status(502).type("application/problem+json").send({
        type: "https://ai-studio.local/problems/google-drive-response",
        title: "Google Drive returned an invalid response",
        status: 502,
        detail: error.message,
        instance: request.url,
      });
      return;
    }
    if (error instanceof TextProviderConfigurationError) {
      void reply.status(422).type("application/problem+json").send({
        type: "https://ai-studio.local/problems/provider-configuration",
        title: "Provider is not configured",
        status: 422,
        detail: error.message,
        instance: request.url,
      });
      return;
    }
    if (error instanceof AudioProviderConfigurationError) {
      void reply.status(422).type("application/problem+json").send({
        type: "https://ai-studio.local/problems/audio-provider-configuration",
        title: "Audio provider is not configured",
        status: 422,
        detail: error.message,
        instance: request.url,
      });
      return;
    }
    if (error instanceof AudioProviderUnavailableError) {
      void reply.status(503).type("application/problem+json").send({
        type: "https://ai-studio.local/problems/audio-provider-unavailable",
        title: "Audio provider is unavailable",
        status: 503,
        detail: error.message,
        instance: request.url,
      });
      return;
    }
    if (error instanceof AudioProviderResponseError) {
      void reply.status(502).type("application/problem+json").send({
        type: "https://ai-studio.local/problems/audio-provider-response",
        title: "Audio provider returned an invalid response",
        status: 502,
        detail: error.message,
        instance: request.url,
      });
      return;
    }
    if (error instanceof ImageProviderConfigurationError) {
      void reply.status(422).type("application/problem+json").send({
        type: "https://ai-studio.local/problems/image-provider-configuration",
        title: "Image provider is not configured",
        status: 422,
        detail: error.message,
        instance: request.url,
      });
      return;
    }
    if (error instanceof ImageProviderUnavailableError) {
      void reply.status(503).type("application/problem+json").send({
        type: "https://ai-studio.local/problems/image-provider-unavailable",
        title: "Image provider is unavailable",
        status: 503,
        detail: error.message,
        instance: request.url,
      });
      return;
    }
    if (error instanceof ImageProviderResponseError) {
      void reply.status(502).type("application/problem+json").send({
        type: "https://ai-studio.local/problems/image-provider-response",
        title: "Image provider returned an invalid response",
        status: 502,
        detail: error.message,
        instance: request.url,
      });
      return;
    }
    if (error instanceof VideoProviderConfigurationError) {
      void reply.status(422).type("application/problem+json").send({
        type: "https://ai-studio.local/problems/video-provider-configuration",
        title: "Video provider is not configured",
        status: 422,
        detail: error.message,
        instance: request.url,
      });
      return;
    }
    if (error instanceof TextProviderUnavailableError) {
      void reply.status(503).type("application/problem+json").send({
        type: "https://ai-studio.local/problems/provider-unavailable",
        title: "Provider is unavailable",
        status: 503,
        detail: error.message,
        instance: request.url,
      });
      return;
    }
    if (error instanceof VideoProviderUnavailableError) {
      void reply.status(503).type("application/problem+json").send({
        type: "https://ai-studio.local/problems/video-provider-unavailable",
        title: "Video provider is unavailable",
        status: 503,
        detail: error.message,
        instance: request.url,
      });
      return;
    }
    if (error instanceof TextProviderResponseError) {
      void reply.status(502).type("application/problem+json").send({
        type: "https://ai-studio.local/problems/provider-response",
        title: "Provider returned an invalid response",
        status: 502,
        detail: error.message,
        instance: request.url,
      });
      return;
    }
    if (error instanceof VideoProviderResponseError) {
      void reply.status(502).type("application/problem+json").send({
        type: "https://ai-studio.local/problems/video-provider-response",
        title: "Video provider returned an invalid response",
        status: 502,
        detail: error.message,
        instance: request.url,
      });
      return;
    }
    if (error instanceof BibleConflictError) {
      void reply.status(409).type("application/problem+json").send({
        type: "https://ai-studio.local/problems/conflict",
        title: "Record already exists",
        status: 409,
        detail: error.message,
        instance: request.url,
      });
      return;
    }
    if (error instanceof StoryPlanDurationError) {
      void reply.status(422).type("application/problem+json").send({
        type: "https://ai-studio.local/problems/plan-duration",
        title: "Shot plan is too long",
        status: 422,
        detail: error.message,
        instance: request.url,
      });
      return;
    }
    if (error instanceof BackupIntegrityError) {
      void reply.status(409).type("application/problem+json").send({
        type: "https://ai-studio.local/problems/backup-integrity",
        title: "Backup integrity check failed",
        status: 409,
        detail: error.message,
        instance: request.url,
      });
      return;
    }
    if (
      error instanceof ReferenceImageValidationError ||
      error instanceof VideoAssetValidationError
    ) {
      void reply
        .status(422)
        .type("application/problem+json")
        .send({
          type: "https://ai-studio.local/problems/reference-image",
          title:
            error instanceof VideoAssetValidationError
              ? "Invalid video asset"
              : "Invalid reference image",
          status: 422,
          detail: error.message,
          instance: request.url,
        });
      return;
    }
    if (
      "statusCode" in error &&
      typeof error.statusCode === "number" &&
      error.statusCode >= 400 &&
      error.statusCode < 500
    ) {
      const status = error.statusCode;
      void reply
        .status(status)
        .type("application/problem+json")
        .send({
          type: "https://ai-studio.local/problems/request",
          title: status === 413 ? "Upload is too large" : "Invalid request",
          status,
          detail:
            status === 413
              ? "The uploaded file exceeds this route's size limit."
              : "The request could not be processed.",
          instance: request.url,
        });
      return;
    }

    request.log.error({ err: error }, "Unhandled request error");
    void reply.status(500).type("application/problem+json").send({
      type: "https://ai-studio.local/problems/internal",
      title: "Internal server error",
      status: 500,
      detail: "The operation could not be completed.",
      instance: request.url,
    });
  });
}
