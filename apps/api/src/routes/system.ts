import { stat } from "node:fs/promises";

import type { FastifyInstance } from "fastify";
import { z } from "zod";

import {
  restoreBackupSchema,
  updateSettingsSchema,
} from "@ai-studio/contracts";

import type { Services } from "../services.js";

const googleCallbackSchema = z.object({
  code: z.string().min(1).optional(),
  state: z.string().min(20).optional(),
  error: z.string().optional(),
});

export function registerSystemRoutes(
  app: FastifyInstance,
  services: Services,
): void {
  app.get("/health", () => ({
    status: "ok",
    service: "ai-studio-api",
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
    const drive = await services.googleDrive.uploadBackup(backup);
    return reply.status(201).send({ ...backup, drive });
  });
  app.post<{ Params: { id: string } }>(
    "/backups/:id/restore",
    async (request) => {
      restoreBackupSchema.parse(request.body);
      const backup = await services.backups.restore(request.params.id);
      return { restored: backup, restoredAt: new Date().toISOString() };
    },
  );

  app.get("/integrations/google-drive", () => services.googleDrive.status());
  app.get("/integrations/google-drive/connect", (_request, reply) => {
    return reply.redirect(services.googleDrive.beginAuthorization());
  });
  app.get("/integrations/google-drive/callback", async (request, reply) => {
    const query = googleCallbackSchema.parse(request.query);
    if (query.error) {
      return reply
        .type("text/html; charset=utf-8")
        .status(400)
        .send(
          oauthResultPage(
            false,
            `Google declined the connection: ${query.error}`,
          ),
        );
    }
    if (!query.code || !query.state) {
      return reply
        .type("text/html; charset=utf-8")
        .status(422)
        .send(
          oauthResultPage(
            false,
            "Google did not return the required OAuth data.",
          ),
        );
    }
    try {
      await services.googleDrive.completeAuthorization(query.state, query.code);
      return reply
        .type("text/html; charset=utf-8")
        .send(
          oauthResultPage(
            true,
            "Google Drive is connected. The visible OSPO folder is ready.",
          ),
        );
    } catch (error) {
      request.log.warn({ err: error }, "Google Drive OAuth callback failed");
      return reply
        .type("text/html; charset=utf-8")
        .status(400)
        .send(
          oauthResultPage(
            false,
            error instanceof Error ? error.message : "Connection failed.",
          ),
        );
    }
  });
  app.post("/integrations/google-drive/sync", async () => {
    return services.googleDrive.syncWorkspace();
  });
  app.post("/integrations/google-drive/disconnect", async () => {
    await services.googleDrive.disconnect();
    return { disconnected: true };
  });
}

function oauthResultPage(success: boolean, message: string): string {
  const safeMessage = message
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Google Drive ${success ? "connected" : "connection failed"}</title><style>body{margin:0;display:grid;place-items:center;min-height:100vh;background:#f7f6f1;color:#171714;font:16px system-ui}.card{max-width:520px;margin:24px;padding:32px;border:1px solid #e6e4dd;border-radius:18px;background:#fffefa;box-shadow:0 18px 55px #25221914}h1{font:500 32px Georgia,serif}p{color:#6f6f67;line-height:1.6}</style></head><body><main class="card"><h1>${success ? "Google Drive connected" : "Connection failed"}</h1><p>${safeMessage}</p><p>You can close this tab and return to AI Studio Settings.</p></main></body></html>`;
}
