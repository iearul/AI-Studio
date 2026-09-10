import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type { StoryPlanInput } from "@ai-film-studio/contracts";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";
import { createServices, type Services } from "../src/services.js";

const planInput: StoryPlanInput = {
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
    hook: "A dead railway signal turns green by itself.",
    twist: "The voice inside the train belongs to Rahim.",
    cliffhanger: "A hand reaches out wearing Rahim's watch.",
    retentionMoments: ["Signal turns green", "Train number is revealed"],
  },
  script: { title: "The Last Train — Reel", notes: "Minimal dialogue." },
  scenes: [
    {
      sceneNumber: 1,
      location: "Abandoned railway platform",
      timeOfDay: "Night",
      characters: ["Rahim"],
      action: "Rahim locks the office as a dead railway signal wakes.",
      narration: "No train had stopped here for twenty years.",
      dialogue: null,
      estimatedDurationSeconds: 8,
      emotionalPurpose: "Hook with an impossible event",
      shots: [
        {
          code: "SHOT_001",
          durationSeconds: 4,
          characters: ["Rahim"],
          location: "Abandoned railway platform",
          shotType: "wide",
          cameraAngle: "eye-level",
          lens: "35mm",
          cameraMovement: "slow-push-in",
          action: "The dead signal changes from red to green behind Rahim.",
          lighting: "Cold moonlight and a single green signal",
          emotion: "Unease",
          status: "draft",
        },
        {
          code: "SHOT_002",
          durationSeconds: 4,
          characters: ["Rahim"],
          location: "Abandoned railway platform",
          shotType: "close-up",
          cameraAngle: "eye-level",
          lens: "85mm",
          cameraMovement: "static",
          action: "Rahim slowly looks up from the padlock.",
          lighting: "Soft blue edge light",
          emotion: "Disbelief",
          status: "draft",
        },
      ],
    },
  ],
};

describe("Phase 2 API", () => {
  let directory: string;
  let services: Services;
  let app: FastifyInstance;
  let projectId: string;

  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), "film-studio-story-api-"));
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
      },
    });
    projectId = project.json<{ id: string }>().id;
  });

  afterEach(async () => {
    await app.close();
    services.database.close();
    await rm(directory, { recursive: true, force: true });
  });

  it("exports a manual request, imports a plan, and enriches the manifest", async () => {
    const preflight = await app.inject({
      method: "OPTIONS",
      url: `/api/v1/projects/${projectId}/story-plan`,
      headers: {
        origin: "http://localhost:3000",
        "access-control-request-method": "PUT",
      },
    });
    expect(preflight.statusCode).toBe(204);
    expect(preflight.headers["access-control-allow-methods"]).toContain("PUT");

    const request = await app.inject({
      method: "GET",
      url: `/api/v1/projects/${projectId}/story-request`,
    });
    expect(request.statusCode).toBe(200);
    expect(request.json<{ prompt: string }>().prompt).toContain(
      "Return JSON only",
    );

    const save = await app.inject({
      method: "PUT",
      url: `/api/v1/projects/${projectId}/story-plan`,
      payload: planInput,
    });
    expect(save.statusCode).toBe(200);
    expect(save.headers["x-manifest-sync"]).toBe("synced");
    expect(save.json<{ totals: { shots: number } }>().totals.shots).toBe(2);

    const get = await app.inject({
      method: "GET",
      url: `/api/v1/projects/${projectId}/story-plan`,
    });
    expect(
      get.json<{ plan: { story: { hook: string } } }>().plan.story.hook,
    ).toContain("signal");

    const manifest = JSON.parse(
      await readFile(
        path.join(directory, "projects", projectId, "project.json"),
        "utf8",
      ),
    ) as { story: { title: string }; scenes: unknown[]; shots: unknown[] };
    expect(manifest.story.title).toBe("The Last Train");
    expect(manifest.scenes).toHaveLength(1);
    expect(manifest.shots).toHaveLength(2);
  });

  it("rejects duplicate shot codes during preview without changing state", async () => {
    const invalid = structuredClone(planInput);
    invalid.scenes[0]?.shots.push({
      ...invalid.scenes[0].shots[0]!,
      action: "A second action with a duplicated code.",
    });
    const response = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${projectId}/story-plan/validate`,
      payload: invalid,
    });
    expect(response.statusCode).toBe(422);

    const plan = await app.inject({
      method: "GET",
      url: `/api/v1/projects/${projectId}/story-plan`,
    });
    expect(plan.json<{ plan: unknown }>().plan).toBeNull();
  });
});
