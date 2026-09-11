import type { FastifyError, FastifyInstance } from "fastify";
import { ZodError } from "zod";

import {
  BibleConflictError,
  BibleEntityNotFoundError,
  BibleProjectNotFoundError,
  GenerationNotFoundError,
  GenerationStateError,
  StoryPlanDurationError,
  StoryPlanProjectNotFoundError,
} from "@ai-film-studio/database";
import {
  TextProviderConfigurationError,
  TextProviderResponseError,
  TextProviderUnavailableError,
} from "@ai-film-studio/providers";
import {
  BackupIntegrityError,
  BackupNotFoundError,
  ReferenceImageValidationError,
} from "@ai-film-studio/storage";

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
      type: "https://ai-film-studio.local/problems/not-found",
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
          type: "https://ai-film-studio.local/problems/validation",
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
      error instanceof StoryPlanProjectNotFoundError
    ) {
      void reply.status(404).type("application/problem+json").send({
        type: "https://ai-film-studio.local/problems/not-found",
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
        type: "https://ai-film-studio.local/problems/generation-state",
        title: "Generation state conflict",
        status: 409,
        detail: error.message,
        instance: request.url,
      });
      return;
    }
    if (error instanceof TextProviderConfigurationError) {
      void reply.status(422).type("application/problem+json").send({
        type: "https://ai-film-studio.local/problems/provider-configuration",
        title: "Provider is not configured",
        status: 422,
        detail: error.message,
        instance: request.url,
      });
      return;
    }
    if (error instanceof TextProviderUnavailableError) {
      void reply.status(503).type("application/problem+json").send({
        type: "https://ai-film-studio.local/problems/provider-unavailable",
        title: "Provider is unavailable",
        status: 503,
        detail: error.message,
        instance: request.url,
      });
      return;
    }
    if (error instanceof TextProviderResponseError) {
      void reply.status(502).type("application/problem+json").send({
        type: "https://ai-film-studio.local/problems/provider-response",
        title: "Provider returned an invalid response",
        status: 502,
        detail: error.message,
        instance: request.url,
      });
      return;
    }
    if (error instanceof BibleConflictError) {
      void reply.status(409).type("application/problem+json").send({
        type: "https://ai-film-studio.local/problems/conflict",
        title: "Record already exists",
        status: 409,
        detail: error.message,
        instance: request.url,
      });
      return;
    }
    if (error instanceof StoryPlanDurationError) {
      void reply.status(422).type("application/problem+json").send({
        type: "https://ai-film-studio.local/problems/plan-duration",
        title: "Shot plan is too long",
        status: 422,
        detail: error.message,
        instance: request.url,
      });
      return;
    }
    if (error instanceof BackupIntegrityError) {
      void reply.status(409).type("application/problem+json").send({
        type: "https://ai-film-studio.local/problems/backup-integrity",
        title: "Backup integrity check failed",
        status: 409,
        detail: error.message,
        instance: request.url,
      });
      return;
    }
    if (error instanceof ReferenceImageValidationError) {
      void reply.status(422).type("application/problem+json").send({
        type: "https://ai-film-studio.local/problems/reference-image",
        title: "Invalid reference image",
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
          type: "https://ai-film-studio.local/problems/request",
          title: status === 413 ? "Upload is too large" : "Invalid request",
          status,
          detail:
            status === 413
              ? "Images may be at most 8 MB."
              : "The request could not be processed.",
          instance: request.url,
        });
      return;
    }

    request.log.error({ err: error }, "Unhandled request error");
    void reply.status(500).type("application/problem+json").send({
      type: "https://ai-film-studio.local/problems/internal",
      title: "Internal server error",
      status: 500,
      detail: "The operation could not be completed.",
      instance: request.url,
    });
  });
}
