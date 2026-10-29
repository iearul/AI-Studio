import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  paidVideoConfirmation,
  type VideoProviderStatus,
} from "@ai-studio/contracts";
import type {
  VideoProvider,
  VideoProviderResult,
  VideoSubmission,
} from "@ai-studio/providers";

import { buildApp } from "../src/app.js";
import { createServices, type Services } from "../src/services.js";

const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WlT5ZkAAAAASUVORK5CYII=",
  "base64",
);
const mp4 = Buffer.concat([
  Buffer.from([0, 0, 0, 24]),
  Buffer.from("ftypisom", "ascii"),
  Buffer.from("0000000000000000", "ascii"),
]);

function multipart(
  buffer: Buffer,
  filename: string,
  mimeType: string,
  boundary: string,
) {
  return {
    contentType: `multipart/form-data; boundary=${boundary}`,
    payload: Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${mimeType}\r\n\r\n`,
      ),
      buffer,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]),
  };
}

class MockKlingProvider implements VideoProvider {
  readonly id = "kling" as const;
  submission?: VideoSubmission;

  status(): VideoProviderStatus {
    return {
      id: "kling",
      label: "Kling test",
      configured: true,
      defaultModel: "kling-test",
      models: [
        {
          id: "kling-test",
          label: "Kling test model",
          supportedResolutions: ["720p"],
          supportedDurationsSeconds: [
            3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15,
          ],
          supportsNativeAudio: true,
          estimatedUsdPerSecond: {
            withoutAudio: { "720p": 0.2, "1080p": null, "4k": null },
            withAudio: { "720p": 0.2, "1080p": null, "4k": null },
          },
          pricingMessage: "Test estimate",
          continuityMessage: "Approved frame is attached.",
          warning: null,
        },
        {
          id: "kling-2.5-turbo",
          label: "Kling 2.5 Turbo",
          supportedResolutions: ["720p", "1080p"],
          supportedDurationsSeconds: [5, 10],
          supportsNativeAudio: false,
          estimatedUsdPerSecond: {
            withoutAudio: { "720p": 0.042, "1080p": 0.07, "4k": null },
            withAudio: { "720p": null, "1080p": null, "4k": null },
          },
          pricingMessage: "Turbo test estimate",
          continuityMessage: "Approved frame is attached as first_frame.",
          warning: "No native audio.",
        },
      ],
    };
  }

  submit(input: VideoSubmission): Promise<{ jobId: string }> {
    this.submission = input;
    return Promise.resolve({ jobId: "provider-job-1" });
  }

  poll(): Promise<VideoProviderResult> {
    return Promise.resolve({
      status: "succeeded",
      resultUrl: "https://cdn.klingai.com/shot.mp4",
      resultMimeType: "video/mp4",
      errorMessage: null,
      resultExpiresAt: "2026-10-11T10:00:00.000Z",
      actualCostMicros: 950_000,
    });
  }
}

describe("Phase 6 video API", () => {
  let directory: string;
  let services: Services;
  let app: FastifyInstance;
  let projectId: string;
  let shotId: string;
  let provider: MockKlingProvider;

  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), "ai-studio-video-api-"));
    process.env.DATABASE_PATH = path.join(directory, "ai-studio.sqlite");
    process.env.PROJECTS_PATH = path.join(directory, "projects");
    process.env.BACKUPS_PATH = path.join(directory, "backups");
    process.env.CACHE_PATH = path.join(directory, "cache");
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          new Response(mp4, {
            status: 200,
            headers: { "content-type": "video/mp4" },
          }),
        ),
      ),
    );
    provider = new MockKlingProvider();
    services = await createServices({ videoProviders: [provider] });
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
        topic: "A lost train returns.",
        language: "en",
        targetDurationSeconds: 30,
        aspectRatio: "9:16",
        style: "mystery",
        narration: "narrator",
      },
    });
    projectId = project.json<{ id: string }>().id;
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
          beginning: "A signal wakes in the dark station.",
          middle: "An impossible train rolls into view.",
          climax: "The sealed carriage door slowly opens.",
          ending: "Rahim steps back as every light fails.",
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
            action: "A railway signal wakes in the darkness.",
            estimatedDurationSeconds: 5,
            emotionalPurpose: "Hook",
            shots: [
              {
                code: "SHOT_001",
                durationSeconds: 5,
                characters: ["Rahim"],
                location: "Abandoned platform",
                shotType: "wide",
                cameraAngle: "eye-level",
                lens: "35mm",
                cameraMovement: "slow-push-in",
                action: "Rahim looks toward the green signal.",
                lighting: "Cold moonlight",
                emotion: "Unease",
              },
            ],
          },
        ],
      },
    });
    shotId = plan.json<{ scenes: Array<{ shots: Array<{ id: string }> }> }>()
      .scenes[0]!.shots[0]!.id;

    const imageUpload = multipart(
      png,
      "frame.png",
      "image/png",
      "video-source-boundary",
    );
    const image = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${projectId}/shots/${shotId}/image-imports`,
      headers: { "content-type": imageUpload.contentType },
      payload: imageUpload.payload,
    });
    const imageAttempt = image.json<{ id: string }>();
    await app.inject({
      method: "POST",
      url: `/api/v1/projects/${projectId}/image-attempts/${imageAttempt.id}/review`,
      payload: { decision: "approve" },
    });
  });

  afterEach(async () => {
    await app.close();
    services.database.close();
    vi.unstubAllGlobals();
    await rm(directory, { recursive: true, force: true });
  });

  it("imports, serves, and approves a manual shot video", async () => {
    const upload = multipart(
      mp4,
      "finished.mp4",
      "video/mp4",
      "manual-video-boundary",
    );
    const imported = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${projectId}/shots/${shotId}/video-imports`,
      headers: { "content-type": upload.contentType },
      payload: upload.payload,
    });
    expect(imported.statusCode).toBe(201);
    const attempt = imported.json<{
      id: string;
      asset: { id: string };
    }>();
    const content = await app.inject({
      method: "GET",
      url: `/api/v1/projects/${projectId}/video-assets/${attempt.asset.id}/content`,
      headers: { range: "bytes=4-11" },
    });
    expect(content.statusCode).toBe(206);
    expect(content.rawPayload).toEqual(mp4.subarray(4, 12));

    const reviewed = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${projectId}/video-attempts/${attempt.id}/review`,
      payload: { decision: "approve" },
    });
    expect(reviewed.json()).toMatchObject({
      reviewStatus: "approved",
      selected: true,
    });
  });

  it("requires paid confirmation, submits the approved frame, and saves output", async () => {
    const denied = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${projectId}/shots/${shotId}/video-generations`,
      payload: {
        provider: "kling",
        model: "kling-test",
        resolution: "720p",
        generateAudio: false,
        confirmation: "yes",
      },
    });
    expect(denied.statusCode).toBe(422);

    const submitted = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${projectId}/shots/${shotId}/video-generations`,
      payload: {
        provider: "kling",
        model: "kling-test",
        resolution: "720p",
        generateAudio: false,
        confirmation: paidVideoConfirmation,
      },
    });
    expect(submitted.statusCode).toBe(202);
    const attempt = submitted.json<{ id: string }>();
    expect(provider.submission?.firstFrameDataUrl).toMatch(
      /^data:image\/png;base64,/,
    );
    expect(provider.submission?.model).toBe("kling-test");

    const refreshed = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${projectId}/video-attempts/${attempt.id}/refresh`,
    });
    expect(refreshed.json()).toMatchObject({
      status: "succeeded",
      costMicros: 950_000,
      costIsEstimate: false,
      asset: { mimeType: "video/mp4" },
    });
    const manifest = JSON.parse(
      await readFile(
        path.join(directory, "projects", projectId, "project.json"),
        "utf8",
      ),
    ) as { videoAssets: unknown[]; videoAttempts: unknown[] };
    expect(manifest.videoAssets).toHaveLength(1);
    expect(manifest.videoAttempts).toHaveLength(1);
  });

  it("selects Kling 2.5 Turbo per shot and enforces its no-audio contract", async () => {
    const invalid = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${projectId}/shots/${shotId}/video-generations`,
      payload: {
        provider: "kling",
        model: "kling-2.5-turbo",
        resolution: "1080p",
        generateAudio: true,
        confirmation: paidVideoConfirmation,
      },
    });
    expect(invalid.statusCode).toBe(409);

    const submitted = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${projectId}/shots/${shotId}/video-generations`,
      payload: {
        provider: "kling",
        model: "kling-2.5-turbo",
        resolution: "1080p",
        generateAudio: false,
        confirmation: paidVideoConfirmation,
      },
    });
    expect(submitted.statusCode).toBe(202);
    expect(submitted.json()).toMatchObject({
      model: "kling-2.5-turbo",
      requestedDurationSeconds: 5,
      costMicros: 350_000,
      costIsEstimate: true,
      settings: {
        continuityInput: "first_frame",
        additionalReferencesSent: false,
      },
    });
    expect(provider.submission).toMatchObject({
      model: "kling-2.5-turbo",
      resolution: "1080p",
      durationSeconds: 5,
      generateAudio: false,
    });
  });
});
