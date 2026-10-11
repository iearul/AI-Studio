import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type { ImageProviderStatus } from "@ai-film-studio/contracts";
import {
  ImageProviderUnavailableError,
  type GeneratedImage,
  type ImageGenerationInput,
  type ImageProvider,
} from "@ai-film-studio/providers";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";
import { createServices, type Services } from "../src/services.js";

const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WlT5ZkAAAAASUVORK5CYII=",
  "base64",
);
const confirmation = "I AUTHORIZE THIS PAID GENERATION";

class FakeImageProvider implements ImageProvider {
  readonly id = "openai" as const;
  readonly maxReferenceBytes = 1024 * 1024;
  readonly requests: ImageGenerationInput[] = [];
  failWith: Error | undefined;
  private gate: Promise<void> | undefined;

  /** Keeps generations pending until the returned function is called. */
  hold(): () => void {
    let release!: () => void;
    this.gate = new Promise((resolve) => {
      release = resolve;
    });
    return release;
  }

  status(): ImageProviderStatus {
    return {
      id: this.id,
      label: "Fake OpenAI",
      configured: true,
      message: "Ready",
      defaultModel: "fake-model",
      models: [
        {
          id: "fake-model",
          label: "Fake model",
          qualities: [
            { id: "medium", label: "Standard", estimatedUsdPerImage: 0.02 },
          ],
          maxReferenceImages: 4,
          pricingMessage: "",
        },
      ],
    };
  }

  async generate(input: ImageGenerationInput): Promise<GeneratedImage> {
    this.requests.push(input);
    await this.gate;
    if (this.failWith) throw this.failWith;
    return { data: png, model: "fake-model", costMicros: 30_500 };
  }
}

function multipartImage(buffer: Buffer) {
  const boundary = "film-studio-image-api-boundary";
  return {
    contentType: `multipart/form-data; boundary=${boundary}`,
    payload: Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="rahim.png"\r\nContent-Type: image/png\r\n\r\n`,
      ),
      buffer,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]),
  };
}

describe("image API generation", () => {
  let directory: string;
  let services: Services;
  let app: FastifyInstance;
  let provider: FakeImageProvider;
  let projectId: string;
  let shotId: string;
  let characterId: string;

  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), "film-studio-image-api-"));
    process.env.DATABASE_PATH = path.join(directory, "film-studio.sqlite");
    process.env.PROJECTS_PATH = path.join(directory, "projects");
    process.env.BACKUPS_PATH = path.join(directory, "backups");
    process.env.CACHE_PATH = path.join(directory, "cache");
    provider = new FakeImageProvider();
    services = await createServices({ imageProviders: [provider] });
    app = await buildApp(
      {
        environment: "test",
        host: "127.0.0.1",
        port: 4100,
        webOrigins: new Set(["http://localhost:3000"]),
      },
      services,
    );
    projectId = (
      await app.inject({
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
        },
      })
    ).json<{ id: string }>().id;
    const plan = await app.inject({
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
    shotId = plan.json<{
      scenes: Array<{ shots: Array<{ id: string }> }>;
    }>().scenes[0]!.shots[0]!.id;
    characterId = (
      await app.inject({
        method: "GET",
        url: `/api/v1/projects/${projectId}/bible`,
      })
    ).json<{ characters: Array<{ id: string }> }>().characters[0]!.id;
    const upload = multipartImage(png);
    const reference = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${projectId}/characters/${characterId}/references?view=three-quarter`,
      headers: { "content-type": upload.contentType },
      payload: upload.payload,
    });
    expect(reference.statusCode).toBe(201);
  });

  afterEach(async () => {
    await services.imageGenerations.settle();
    await app.close();
    services.database.close();
    await rm(directory, { recursive: true, force: true });
  });

  it("lists the configured image providers", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/providers/images",
    });
    expect(response.json()).toMatchObject({
      providers: [{ id: "openai", configured: true }],
    });
  });

  it("generates a storyboard frame in the background with the shot's reference photos", async () => {
    const release = provider.hold();
    const started = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${projectId}/shots/${shotId}/image-generations`,
      payload: {
        provider: "openai",
        model: "fake-model",
        quality: "medium",
        confirmation,
      },
    });
    expect(started.statusCode).toBe(202);
    expect(started.json()).toMatchObject({
      provider: "openai",
      status: "generating",
    });

    const duplicate = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${projectId}/shots/${shotId}/image-generations`,
      payload: {
        provider: "openai",
        model: "fake-model",
        quality: "medium",
        confirmation,
      },
    });
    expect(duplicate.statusCode).toBe(409);

    release();
    await services.imageGenerations.settle();
    const [attempt] = services.generations.listProject(projectId).attempts;
    expect(attempt).toMatchObject({
      status: "succeeded",
      provider: "openai",
      model: "fake-model",
      costMicros: 30_500,
      currency: "USD",
    });
    expect(attempt?.asset?.sha256).toHaveLength(64);
    expect(provider.requests).toHaveLength(1);
    expect(provider.requests[0]).toMatchObject({
      aspectRatio: "9:16",
      quality: "medium",
    });
    expect(provider.requests[0]?.references).toHaveLength(1);
    expect(provider.requests[0]?.prompt).toMatch(
      /^ATTACHED REFERENCE IMAGES, IN ORDER:\n1\. Rahim/,
    );
  });

  it("records a provider failure on the attempt", async () => {
    provider.failWith = new ImageProviderUnavailableError(
      "OpenAI could not be reached.",
    );
    await app.inject({
      method: "POST",
      url: `/api/v1/projects/${projectId}/shots/${shotId}/image-generations`,
      payload: {
        provider: "openai",
        model: "fake-model",
        quality: "medium",
        confirmation,
      },
    });
    await services.imageGenerations.settle();
    expect(
      services.generations.listProject(projectId).attempts[0],
    ).toMatchObject({
      status: "failed",
      errorMessage: "OpenAI could not be reached.",
      asset: null,
    });
  });

  it("refuses paid generation without the confirmation", async () => {
    const response = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${projectId}/shots/${shotId}/image-generations`,
      payload: { provider: "openai", model: "fake-model", quality: "medium" },
    });
    expect(response.statusCode).toBe(422);
    expect(provider.requests).toHaveLength(0);
  });

  it("generates a character reference photo from the existing views", async () => {
    const response = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${projectId}/characters/${characterId}/reference-generations`,
      payload: {
        provider: "openai",
        model: "fake-model",
        quality: "medium",
        view: "front",
        confirmation,
      },
    });
    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      ownerType: "character",
      ownerId: characterId,
      view: "front",
      originalFilename: "rahim-front-reference-openai.png",
    });
    expect(provider.requests[0]).toMatchObject({ aspectRatio: "4:5" });
    expect(provider.requests[0]?.references).toHaveLength(1);
    const bible = services.bible.list(projectId);
    expect(bible.characters[0]?.references.map((item) => item.view)).toEqual(
      expect.arrayContaining(["three-quarter", "front"]),
    );
  });

  it("builds and generates a wide location reference photo", async () => {
    const locationId = services.bible.list(projectId).locations[0]!.id;
    const prompt = await app.inject({
      method: "GET",
      url: `/api/v1/projects/${projectId}/locations/${locationId}/reference-prompt?view=exterior-night`,
    });
    expect(prompt.json()).toMatchObject({
      ownerType: "location",
      ownerId: locationId,
      view: "exterior-night",
    });

    const wrongView = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${projectId}/locations/${locationId}/reference-generations`,
      payload: {
        provider: "openai",
        model: "fake-model",
        quality: "medium",
        view: "full-body",
        confirmation,
      },
    });
    expect(wrongView.statusCode).toBe(422);
    expect(provider.requests).toHaveLength(0);

    const response = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${projectId}/locations/${locationId}/reference-generations`,
      payload: {
        provider: "openai",
        model: "fake-model",
        quality: "medium",
        view: "exterior-night",
        confirmation,
      },
    });
    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      ownerType: "location",
      view: "exterior-night",
    });
    expect(provider.requests[0]).toMatchObject({
      aspectRatio: "16:9",
      references: [],
    });
    expect(provider.requests[0]?.prompt).toContain("LOCATION IDENTITY");
  });
});
