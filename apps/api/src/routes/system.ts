import { stat } from "node:fs/promises";

import type { FastifyInstance } from "fastify";

import {
  restoreBackupSchema,
  updateSettingsSchema,
} from "@ai-film-studio/contracts";

import type { Services } from "../services.js";

export function registerSystemRoutes(
  app: FastifyInstance,
  services: Services,
): void {
  app.get("/health", () => ({
    status: "ok",
    service: "ai-film-studio-api",
    time: new Date().toISOString(),
  }));

  app.get("/settings", () => services.settings.get());
  app.patch("/settings", (request) => {
    const input = updateSettingsSchema.parse(request.body);
    return services.settings.update(input);
  });

  app.get("/storage", async () => {
    const databaseInfo = await stat(services.storage.databasePath);
    return {
      databasePath: services.storage.databasePath,
      projectsPath: services.storage.projectsPath,
      backupsPath: services.storage.backupsPath,
      databaseSizeBytes: databaseInfo.size,
      pendingManifestWrites: services.manifestOutbox.count(),
    };
  });

  app.get("/backups", () => ({ items: services.backups.list() }));
  app.post("/backups", async (_request, reply) => {
    const backup = await services.backups.create("manual");
    return reply.status(201).send(backup);
  });
  app.post<{ Params: { id: string } }>(
    "/backups/:id/restore",
    async (request) => {
      restoreBackupSchema.parse(request.body);
      const backup = await services.backups.restore(request.params.id);
      return { restored: backup, restoredAt: new Date().toISOString() };
    },
  );

  app.get("/integrations/google-drive", () => {
    const folder = services.settings.get().googleDriveFolder;
    const configured = Boolean(
      process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET,
    );
    return {
      provider: "google-drive" as const,
      state: configured
        ? ("ready_to_connect" as const)
        : ("not_configured" as const),
      folder,
      message: configured
        ? "OAuth credentials are available. Connection flow will be enabled with the Drive adapter."
        : "Add Google OAuth credentials to .env.local. Local verified backups are active now.",
    };
  });
}
