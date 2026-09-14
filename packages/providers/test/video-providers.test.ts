import { describe, expect, it } from "vitest";

import { KlingVideoProvider } from "../src/kling-video-provider.js";
import { SeedanceVideoProvider } from "../src/seedance-video-provider.js";

const submission = {
  model: "kling-3.0",
  prompt: "A slow cinematic push in.",
  firstFrameDataUrl: "data:image/png;base64,aGVsbG8=",
  firstFrameMimeType: "image/png" as const,
  aspectRatio: "9:16" as const,
  durationSeconds: 5,
  resolution: "720p" as const,
  generateAudio: false,
  externalTaskId: "00000000-0000-4000-8000-000000000001",
};

describe("KlingVideoProvider", () => {
  it("submits the current Kling 3.0 image-to-video contract", async () => {
    let requestedUrl: string | URL | Request | undefined;
    let requestedInit: RequestInit | undefined;
    const request: typeof fetch = (input, init) => {
      requestedUrl = input;
      requestedInit = init;
      return Promise.resolve(
        Response.json({
          code: 0,
          data: { id: "kling-task-1", status: "submitted" },
        }),
      );
    };
    const provider = new KlingVideoProvider(
      {
        apiKey: "test-key",
        baseUrl: "https://api-singapore.klingai.com",
        defaultModel: "kling-3.0",
        requestTimeoutMs: 1000,
      },
      request,
    );

    await expect(provider.submit(submission)).resolves.toEqual({
      jobId: "kling-task-1",
    });
    expect(requestedUrl).toBe(
      "https://api-singapore.klingai.com/image-to-video/kling-3.0",
    );
    if (typeof requestedInit?.body !== "string") {
      throw new Error("Expected a JSON request body.");
    }
    const body = JSON.parse(requestedInit.body) as {
      contents: Array<{ type: string; url?: string }>;
      settings: { duration: number; multi_shot: boolean; audio: string };
    };
    expect(body.contents[1]).toMatchObject({
      type: "first_frame",
      url: submission.firstFrameDataUrl,
    });
    expect(body.settings).toMatchObject({
      duration: 5,
      multi_shot: false,
      audio: "off",
    });
  });

  it("submits Kling 2.5 Turbo with its approved first frame and no unsupported settings", async () => {
    let requestedUrl: string | URL | Request | undefined;
    let requestedInit: RequestInit | undefined;
    const request: typeof fetch = (input, init) => {
      requestedUrl = input;
      requestedInit = init;
      return Promise.resolve(
        Response.json({ code: 0, data: { id: "kling-task-25" } }),
      );
    };
    const provider = new KlingVideoProvider(
      {
        apiKey: "test-key",
        baseUrl: "https://api-singapore.klingai.com",
        defaultModel: "kling-3.0",
        requestTimeoutMs: 1000,
      },
      request,
    );

    await expect(
      provider.submit({ ...submission, model: "kling-2.5-turbo" }),
    ).resolves.toEqual({ jobId: "kling-task-25" });
    expect(requestedUrl).toBe(
      "https://api-singapore.klingai.com/image-to-video/kling-2.5-turbo",
    );
    if (typeof requestedInit?.body !== "string") {
      throw new Error("Expected a JSON request body.");
    }
    const body = JSON.parse(requestedInit.body) as {
      contents: Array<{ type: string; url?: string }>;
      settings: Record<string, unknown>;
    };
    expect(body.contents[1]).toEqual({
      type: "first_frame",
      url: submission.firstFrameDataUrl,
    });
    expect(body.settings).toEqual({ resolution: "720p", duration: 5 });
    expect(body.settings).not.toHaveProperty("audio");
    expect(body.settings).not.toHaveProperty("multi_shot");
  });

  it("reads video output and actual USD cash billing", async () => {
    const request: typeof fetch = () =>
      Promise.resolve(
        Response.json({
          code: 0,
          data: [
            {
              id: "kling-task-1",
              status: "succeeded",
              outputs: [
                { type: "video", url: "https://cdn.klingai.com/shot.mp4" },
              ],
              billing: [
                { charge_type: "cash", currency: "USD", amount: "1.25" },
              ],
            },
          ],
        }),
      );
    const provider = new KlingVideoProvider(
      {
        apiKey: "test-key",
        baseUrl: "https://api-singapore.klingai.com",
        defaultModel: "kling-3.0",
        requestTimeoutMs: 1000,
      },
      request,
    );

    await expect(provider.poll("kling-task-1")).resolves.toMatchObject({
      status: "succeeded",
      resultUrl: "https://cdn.klingai.com/shot.mp4",
      actualCostMicros: 1_250_000,
    });
  });
});

describe("SeedanceVideoProvider", () => {
  it("submits and polls the BytePlus Seedance task contract", async () => {
    const requests: Array<{
      input: string | URL | Request;
      init?: RequestInit;
    }> = [];
    const request: typeof fetch = (input, init) => {
      requests.push({ input, init });
      return Promise.resolve(
        requests.length === 1
          ? Response.json({ id: "seedance-task-1" })
          : Response.json({
              id: "seedance-task-1",
              status: "succeeded",
              content: { video_url: "https://result.volces.com/shot.mp4" },
            }),
      );
    };
    const provider = new SeedanceVideoProvider(
      {
        apiKey: "test-key",
        baseUrl:
          "https://operator.las.ap-southeast-1.bytepluses.com/api/v1/contents/generations/tasks",
        model: "dreamina-seedance-2-0-260128",
        requestTimeoutMs: 1000,
        estimatedUsdPerSecond: 0.303,
      },
      request,
    );

    await expect(
      provider.submit({ ...submission, model: "dreamina-seedance-2-0-260128" }),
    ).resolves.toEqual({
      jobId: "seedance-task-1",
    });
    const requestBody = requests[0]?.init?.body;
    if (typeof requestBody !== "string") {
      throw new Error("Expected a JSON request body.");
    }
    const firstBody = JSON.parse(requestBody) as {
      content: Array<{ role?: string; image_url?: { url: string } }>;
      ratio: string;
      resolution: string;
    };
    expect(firstBody.content[1]).toEqual({
      type: "image_url",
      image_url: { url: submission.firstFrameDataUrl },
      role: "first_frame",
    });
    expect(firstBody).toMatchObject({ ratio: "9:16", resolution: "720p" });

    await expect(provider.poll("seedance-task-1")).resolves.toMatchObject({
      status: "succeeded",
      resultUrl: "https://result.volces.com/shot.mp4",
    });
  });
});
