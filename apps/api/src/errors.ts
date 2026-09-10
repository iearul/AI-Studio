import type { FastifyError, FastifyInstance } from "fastify";
import { ZodError } from "zod";

import {
  BackupIntegrityError,
  BackupNotFoundError,
} from "@ai-film-studio/storage";

export class NotFoundError extends Error {
  constructor(resource: string) {
    super(`${resource} was not found.`);
    this.name = "NotFoundError";
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
      error instanceof BackupNotFoundError
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
