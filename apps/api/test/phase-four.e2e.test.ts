import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";
import { createServices, type Services } from "../src/services.js";

const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WlT5ZkAAAAASUVORK5CYII=",
  "base64",
);

function multipartImage(buffer: Buffer, mimeType = "image/png") {
  const boundary = "film-studio-storyboard-boundary";
  return {
    contentType: `multipart/form-data; boundary=${boundary}`,
    payload: Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="frame.png"\r\nContent-Type: ${mimeType}\r\n\r\n`,
      ),
      buffer,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]),
  };
}

describe("Phase 4 API", () => {
  let directory: string;
  let services: Services;
  let app: FastifyInstance;
  let projectId: string;
  let shotId: string;

  beforeEach(async () => {
    directory = await mkdtemp(
      path.join(tmpdir(), "film-studio-generation-api-"),
    );
    process.env.DATABASE_PATH = path.join(directory, "film-studio.sqlite");
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
    const projectResponse = await app.inject({
      method: "POST",
      url: "/api/v1/projects",
      payload: {
        title: "The Last Train",
        type: "reel",
        topic: "A lost train returns.",
        language: "en",
        targetDurationSeconds: 30,
        aspectRatio: "9:16",
        style: "mystery",
        narration: "narrator",
        visualStyle: "Naturalistic 35mm night photography",
      },
    });
    projectId = projectResponse.json<{ id: string }>().id;
    const planResponse = await app.inject({
      method: "PUT",
      url: `/api/v1/projects/${projectId}/story-plan`,
      payload: {
        story: {
          title: "The Last Train",
          logline: "A station keeper sees an impossible train.",
          genre: "Mystery",
          theme: "Grief",
          tone: "Ominous",
          mainConflict: "Rahim must choose whether to board.",
          mainCharacter: "Rahim",
          supportingCharacters: [],
          beginning: "A signal wakes.",
          middle: "A train arrives.",
          climax: "The door opens.",
          ending: "The lights fail.",
          audienceEmotion: "Unease",
          retentionMoments: [],
        },
        script: { title: "The Last Train" },
        scenes: [
          {
            sceneNumber: 1,
            location: "Abandoned platform",
            timeOfDay: "Night",
            characters: ["Rahim"],
            action: "A signal wakes.",
            estimatedDurationSeconds: 4,
            emotionalPurpose: "Hook",
            shots: [
              {
                code: "SHOT_001",
                durationSeconds: 4,
                characters: ["Rahim"],
                location: "Abandoned platform",
                shotType: "wide",
                cameraAngle: "eye-level",
                lens: "35mm",
                cameraMovement: "static",
                action: "The signal turns green.",
                lighting: "Moonlight",
                emotion: "Unease",
              },
            ],
          },
        ],
      },
    });
    shotId = planResponse.json<{
      scenes: Array<{ shots: Array<{ id: string }> }>;
    }>().scenes[0]!.shots[0]!.id;
  });

  afterEach(async () => {
    await app.close();
    services.database.close();
    await rm(directory, { recursive: true, force: true });
  });

  async function resolveShot() {
    await app.inject({
      method: "POST",
      url: `/api/v1/projects/${projectId}/characters`,
      payload: { name: "Rahim" },
    });
    await app.inject({
      method: "POST",
      url: `/api/v1/projects/${projectId}/locations`,
      payload: { name: "Abandoned platform" },
    });
  }

  it("imports, serves, approves, and manifests a storyboard image", async () => {
    await resolveShot();
    const multipart = multipartImage(png);
    const imported = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${projectId}/shots/${shotId}/image-imports`,
      headers: { "content-type": multipart.contentType },
      payload: multipart.payload,
    });
    expect(imported.statusCode).toBe(201);
    const attempt = imported.json<{
      id: string;
      status: string;
      provider: string;
      asset: { id: string; sha256: string };
    }>();
    expect(attempt).toMatchObject({ status: "succeeded", provider: "manual" });
    expect(attempt.asset.sha256).toHaveLength(64);

    const content = await app.inject({
      method: "GET",
      url: `/api/v1/projects/${projectId}/assets/${attempt.asset.id}/content`,
    });
    expect(content.statusCode).toBe(200);
    expect(content.rawPayload).toEqual(png);

    const review = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${projectId}/image-attempts/${attempt.id}/review`,
      payload: { decision: "approve" },
    });
    expect(review.json()).toMatchObject({
      reviewStatus: "approved",
      selected: true,
    });

    const manifest = JSON.parse(
      await readFile(
        path.join(directory, "projects", projectId, "project.json"),
        "utf8",
      ),
    ) as { assets: unknown[]; generationAttempts: unknown[] };
    expect(manifest.assets).toHaveLength(1);
    expect(manifest.generationAttempts).toHaveLength(1);
  });

  it("blocks imports for shots with unresolved continuity records", async () => {
    const unresolved = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${projectId}/shots/${shotId}/image-imports`,
      headers: { "content-type": multipartImage(png).contentType },
      payload: multipartImage(png).payload,
    });
    expect(unresolved.statusCode).toBe(409);
  });

  it("rejects spoofed manual images without leaving a successful attempt", async () => {
    await resolveShot();
    const spoofed = multipartImage(png, "image/jpeg");
    const response = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${projectId}/shots/${shotId}/image-imports`,
      headers: { "content-type": spoofed.contentType },
      payload: spoofed.payload,
    });
    expect(response.statusCode).toBe(422);
    const history = services.generations.listProject(projectId);
    expect(history.totals).toMatchObject({ attempts: 1, failed: 1 });
  });
});
