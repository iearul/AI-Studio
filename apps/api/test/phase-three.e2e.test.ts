import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";
import { createServices, type Services } from "../src/services.js";

const plan = {
  story: {
    title: "The Last Train",
    logline: "A station keeper sees a train that vanished twenty years ago.",
    genre: "Mystery horror",
    theme: "Grief refuses to follow a timetable.",
    tone: "Quiet and ominous",
    mainConflict: "Rahim must decide whether to board the impossible train.",
    mainCharacter: "Rahim",
    supportingCharacters: [],
    beginning: "Rahim closes an abandoned station at midnight.",
    middle: "A signal turns green and the lost train approaches.",
    climax: "The carriage door opens and his own voice calls from inside.",
    ending: "Rahim steps closer as the platform lights go black.",
    audienceEmotion: "Uneasy curiosity",
    retentionMoments: ["Signal turns green"],
  },
  script: { title: "The Last Train — Reel" },
  scenes: [
    {
      sceneNumber: 1,
      location: "Abandoned railway platform",
      timeOfDay: "Night",
      characters: ["Rahim"],
      action: "Rahim locks the office as a dead railway signal wakes.",
      estimatedDurationSeconds: 4,
      emotionalPurpose: "Hook with an impossible event",
      shots: [
        {
          code: "SHOT_001",
          durationSeconds: 4,
          characters: ["Rahim"],
          props: ["Signal key"],
          location: "Abandoned railway platform",
          shotType: "wide",
          cameraAngle: "eye-level",
          lens: "35mm",
          cameraMovement: "slow-push-in",
          action: "The signal changes from red to green behind Rahim.",
          lighting: "Cold moonlight and a single green signal",
          emotion: "Unease",
        },
      ],
    },
  ],
};

const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WlT5ZkAAAAASUVORK5CYII=",
  "base64",
);

function multipartImage(buffer: Buffer, mimeType = "image/png") {
  const boundary = "film-studio-test-boundary";
  return {
    contentType: `multipart/form-data; boundary=${boundary}`,
    payload: Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="reference.png"\r\nContent-Type: ${mimeType}\r\n\r\n`,
      ),
      buffer,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]),
  };
}

describe("Phase 3 API", () => {
  let directory: string;
  let services: Services;
  let app: FastifyInstance;
  let projectId: string;

  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), "film-studio-bible-api-"));
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
    const project = await app.inject({
      method: "POST",
      url: "/api/v1/projects",
      payload: {
        title: "The Last Train",
        type: "reel",
        topic: "A lost train returns after twenty years.",
        language: "en",
        targetDurationSeconds: 60,
        aspectRatio: "9:16",
        style: "mystery",
        narration: "narrator",
        visualStyle: "Naturalistic 35mm night photography",
      },
    });
    projectId = project.json<{ id: string }>().id;
    const story = await app.inject({
      method: "PUT",
      url: `/api/v1/projects/${projectId}/story-plan`,
      payload: plan,
    });
    expect(story.statusCode).toBe(200);
  });

  afterEach(async () => {
    await app.close();
    services.database.close();
    await rm(directory, { recursive: true, force: true });
  });

  async function createCharacter() {
    const character = services.bible
      .list(projectId)
      .characters.find((candidate) => candidate.name === "Rahim")!;
    return app.inject({
      method: "PUT",
      url: `/api/v1/projects/${projectId}/characters/${character.id}`,
      payload: {
        name: "Rahim",
        age: 34,
        faceDescription: "Long face with a short trimmed beard",
        hair: "Short black hair",
        defaultClothing: ["beige shirt", "brown leather watch"],
      },
    });
  }

  it("resolves each shot against character, location, and prop bibles", async () => {
    const before = await app.inject({
      method: "GET",
      url: `/api/v1/projects/${projectId}/reference-coverage`,
    });
    expect(
      before.json<{ totals: { unresolved: number } }>().totals.unresolved,
    ).toBe(0);

    expect((await createCharacter()).statusCode).toBe(200);
    const locationId = services.bible
      .list(projectId)
      .locations.find(
        (candidate) => candidate.name === "Abandoned railway platform",
      )!.id;
    const location = await app.inject({
      method: "PUT",
      url: `/api/v1/projects/${projectId}/locations/${locationId}`,
      payload: {
        name: "Abandoned railway platform",
        type: "Rural railway station",
        materials: ["weathered brick", "rusted steel"],
      },
    });
    expect(location.statusCode).toBe(200);
    const propId = services.bible
      .list(projectId)
      .props.find((candidate) => candidate.name === "Signal key")!.id;
    const prop = await app.inject({
      method: "PUT",
      url: `/api/v1/projects/${projectId}/props/${propId}`,
      payload: {
        name: "Signal key",
        description: "A worn brass key on a red cord",
      },
    });
    expect(prop.statusCode).toBe(200);

    const duplicate = await createCharacter();
    expect(duplicate.statusCode).toBe(200);
    const actualDuplicate = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${projectId}/characters`,
      payload: { name: "rahim" },
    });
    expect(actualDuplicate.statusCode).toBe(409);

    const after = await app.inject({
      method: "GET",
      url: `/api/v1/projects/${projectId}/reference-coverage`,
    });
    const coverage = after.json<{
      totals: { ready: number; unresolved: number };
      shots: Array<{ prompt: string }>;
    }>();
    expect(coverage.totals).toMatchObject({ ready: 1, unresolved: 0 });
    expect(coverage.shots[0]?.prompt).toContain("CHAR_RAHIM_001");
    expect(coverage.shots[0]?.prompt).toContain("weathered brick");
    expect(coverage.shots[0]?.prompt).toContain("worn brass key");

    const manifest = JSON.parse(
      await readFile(
        path.join(directory, "projects", projectId, "project.json"),
        "utf8",
      ),
    ) as { characters: unknown[]; locations: unknown[]; props: unknown[] };
    expect(manifest.characters).toHaveLength(1);
    expect(manifest.locations).toHaveLength(1);
    expect(manifest.props).toHaveLength(1);
  });

  it("uploads verified reference bytes and serves only the recorded file", async () => {
    const character = await createCharacter();
    const characterId = character.json<{ id: string }>().id;
    const multipart = multipartImage(png);
    const upload = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${projectId}/characters/${characterId}/references?view=front`,
      headers: { "content-type": multipart.contentType },
      payload: multipart.payload,
    });
    expect(upload.statusCode).toBe(201);
    const reference = upload.json<{
      id: string;
      mimeType: string;
      sha256: string;
      relativePath: string;
    }>();
    expect(reference.mimeType).toBe("image/png");
    expect(reference.sha256).toHaveLength(64);
    expect(reference.relativePath).toMatch(/^references\/characters\//);

    const content = await app.inject({
      method: "GET",
      url: `/api/v1/projects/${projectId}/references/${reference.id}/content`,
    });
    expect(content.statusCode).toBe(200);
    expect(content.headers["content-type"]).toBe("image/png");
    expect(content.rawPayload).toEqual(png);

    const spoofed = multipartImage(png, "image/jpeg");
    const rejected = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${projectId}/characters/${characterId}/references?view=profile`,
      headers: { "content-type": spoofed.contentType },
      payload: spoofed.payload,
    });
    expect(rejected.statusCode).toBe(422);
    expect(
      services.bible.list(projectId).characters[0]?.references,
    ).toHaveLength(1);
  });

  it("returns a detailed ChatGPT-ready character reference prompt", async () => {
    const character = await createCharacter();
    const characterId = character.json<{ id: string }>().id;
    const response = await app.inject({
      method: "GET",
      url: `/api/v1/projects/${projectId}/characters/${characterId}/reference-prompt?view=profile`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      characterId,
      characterCode: "CHAR_RAHIM_001",
      view: "profile",
      filename: "rahim-profile-reference.png",
      ready: false,
    });
    expect(response.json<{ prompt: string }>().prompt).toContain(
      "Exact 90-degree left-side profile",
    );
    expect(response.json<{ prompt: string }>().prompt).toContain(
      "Long face with a short trimmed beard",
    );
  });
});
