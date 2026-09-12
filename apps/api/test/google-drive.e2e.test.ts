import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";
import type { Services } from "../src/services.js";
import { createServices } from "../src/services.js";

describe("Google Drive API", () => {
  let directory: string;
  let services: Services;
  let app: FastifyInstance;

  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), "film-studio-drive-api-"));
    process.env.DATABASE_PATH = path.join(directory, "film-studio.sqlite");
    process.env.PROJECTS_PATH = path.join(directory, "projects");
    process.env.BACKUPS_PATH = path.join(directory, "backups");
    process.env.CACHE_PATH = path.join(directory, "cache");
    process.env.SECRETS_PATH = path.join(directory, "secrets");
    process.env.GOOGLE_CLIENT_ID = "test-client-id";
    process.env.GOOGLE_CLIENT_SECRET = "test-client-secret";
    delete process.env.GOOGLE_REFRESH_TOKEN;
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
    delete process.env.SECRETS_PATH;
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
  });

  it("reports configured credentials honestly before account consent", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/integrations/google-drive",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      provider: "google-drive",
      state: "ready_to_connect",
      folder: "OSPO",
      scope: "drive.file",
      redirectUri:
        "http://127.0.0.1:4100/api/v1/integrations/google-drive/callback",
      connectedAt: null,
    });
  });

  it("redirects to Google with a CSRF state and drive.file scope", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/integrations/google-drive/connect",
    });

    expect(response.statusCode).toBe(302);
    const location = new URL(response.headers.location!);
    expect(location.origin).toBe("https://accounts.google.com");
    expect(location.searchParams.get("scope")).toBe(
      "https://www.googleapis.com/auth/drive.file",
    );
    expect(location.searchParams.get("state")).toHaveLength(43);
  });

  it("rejects a callback whose OAuth state was not issued by this process", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/integrations/google-drive/callback?code=test-code&state=untrusted-state-value-1234",
    });

    expect(response.statusCode).toBe(400);
    expect(response.body).toContain("expired or its state did not match");
  });

  it("keeps a verified local backup when Drive is not connected", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/backups",
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      kind: "manual",
      drive: {
        state: "not_connected",
        message: "Local backup created; Google Drive is not connected.",
      },
    });
  });
});
