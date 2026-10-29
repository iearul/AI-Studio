import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";
import type { Services } from "../src/services.js";
import { createServices } from "../src/services.js";

const projectInput = {
  title: "The Last Train",
  type: "reel",
  topic: "A station keeper sees a lost train return after twenty years.",
  language: "en",
  targetDurationSeconds: 60,
  aspectRatio: "9:16",
  style: "mystery",
  narration: "narrator",
};

describe("Phase 1 API", () => {
  let directory: string;
  let services: Services;
  let app: FastifyInstance;

  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), "ai-studio-api-"));
    process.env.DATABASE_PATH = path.join(directory, "ai-studio.sqlite");
    process.env.PROJECTS_PATH = path.join(directory, "projects");
    process.env.BACKUPS_PATH = path.join(directory, "backups");
    process.env.CACHE_PATH = path.join(directory, "cache");
    services = await createServices();
    app = await buildApp(
      {
        environment: "test",
        host: "127.0.0.1",
        port: 4100,
        webOrigins: new Set(["http://localhost:3000"]),
      },
      services,
    );
  });

  afterEach(async () => {
    await app.close();
    services.database.close();
    await rm(directory, { recursive: true, force: true });
  });

  it("creates, reopens, backs up, and restores a project", async () => {
    const create = await app.inject({
      method: "POST",
      url: "/api/v1/projects",
      payload: projectInput,
    });
    expect(create.statusCode).toBe(201);
    expect(create.headers["x-manifest-sync"]).toBe("synced");
    const project = create.json<{ id: string; title: string }>();

    const manifestFile = path.join(
      directory,
      "projects",
      project.id,
      "project.json",
    );
    const manifest = JSON.parse(await readFile(manifestFile, "utf8")) as {
      project: { title: string };
    };
    expect(manifest.project.title).toBe("The Last Train");

    const backupResponse = await app.inject({
      method: "POST",
      url: "/api/v1/backups",
    });
    expect(backupResponse.statusCode).toBe(201);
    const backup = backupResponse.json<{
      id: string;
      checksumSha256: string;
    }>();
    expect(backup.checksumSha256).toHaveLength(64);

    const update = await app.inject({
      method: "PATCH",
      url: `/api/v1/projects/${project.id}`,
      payload: { title: "Changed after backup" },
    });
    expect(update.statusCode).toBe(200);

    const restore = await app.inject({
      method: "POST",
      url: `/api/v1/backups/${backup.id}/restore`,
      payload: { confirmation: "RESTORE" },
    });
    expect(restore.statusCode).toBe(200);

    const reopened = await app.inject({
      method: "GET",
      url: `/api/v1/projects/${project.id}`,
    });
    expect(reopened.json<{ title: string }>().title).toBe("The Last Train");

    const backupsAfterRestore = await app.inject({
      method: "GET",
      url: "/api/v1/backups",
    });
    const restoredRecords = backupsAfterRestore.json<{
      items: Array<{ id: string; kind: string }>;
    }>().items;
    expect(restoredRecords).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: backup.id, kind: "manual" }),
        expect.objectContaining({ kind: "pre_restore" }),
      ]),
    );
  });

  it("returns field-level validation as problem details", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/projects",
      payload: { ...projectInput, title: "", targetDurationSeconds: 300 },
    });
    expect(response.statusCode).toBe(422);
    expect(response.headers["content-type"]).toContain(
      "application/problem+json",
    );
    expect(
      response.json<{ errors: Record<string, string[]> }>().errors,
    ).toHaveProperty("title");
    expect(
      response.json<{ errors: Record<string, string[]> }>().errors,
    ).toHaveProperty("targetDurationSeconds");
  });

  it("does not allow untrusted browser origins", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/health",
      headers: { origin: "https://attacker.example" },
    });
    expect(response.headers["access-control-allow-origin"]).toBeUndefined();
  });
});
