import { describe, expect, it, vi } from "vitest";

import { VeoVideoProvider } from "../src/veo-video-provider.js";
import { VideoProviderConfigurationError } from "../src/video-provider.js";

const config = {
  apiKey: "test-key",
  baseUrl: "https://generativelanguage.googleapis.com",
  defaultModel: "veo-3.1-fast-generate-preview",
  requestTimeoutMs: 10_000,
};
const operation = "models/veo-3.1-fast-generate-preview/operations/abc123";
const submission = {
  model: "veo-3.1-fast-generate-preview",
  prompt: "The signal turns green.",
  firstFrameDataUrl: "data:image/png;base64,iVBORw0KGgo=",
  firstFrameMimeType: "image/png" as const,
  aspectRatio: "9:16" as const,
  durationSeconds: 6,
  resolution: "720p" as const,
  generateAudio: true,
  externalTaskId: "attempt-1",
};

describe("Veo video provider", () => {
  it("starts an image-to-video operation from the approved frame", async () => {
    let url: string | undefined;
    let headers: Headers | undefined;
    let body: Record<string, unknown> | undefined;
    const provider = new VeoVideoProvider(
      config,
      vi.fn<typeof fetch>((input, init) => {
        url = input instanceof Request ? input.url : input.toString();
        headers = new Headers(init?.headers);
        body = JSON.parse(init?.body as string) as Record<string, unknown>;
        return Promise.resolve(Response.json({ name: operation }));
      }),
    );

    await expect(provider.submit(submission)).resolves.toEqual({
      jobId: operation,
    });
    expect(url).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/veo-3.1-fast-generate-preview:predictLongRunning",
    );
    expect(headers?.get("x-goog-api-key")).toBe("test-key");
    expect(body).toEqual({
      instances: [
        {
          prompt: "The signal turns green.",
          image: {
            inlineData: { mimeType: "image/png", data: "iVBORw0KGgo=" },
          },
        },
      ],
      parameters: {
        aspectRatio: "9:16",
        resolution: "720p",
        durationSeconds: "6",
        personGeneration: "allow_adult",
        numberOfVideos: 1,
      },
    });
  });

  it("refuses lengths Veo does not offer at a resolution", async () => {
    const request = vi.fn<typeof fetch>();
    const provider = new VeoVideoProvider(config, request);

    await expect(
      provider.submit({ ...submission, resolution: "1080p" }),
    ).rejects.toThrow(VideoProviderConfigurationError);
    await expect(
      provider.submit({ ...submission, aspectRatio: "1:1" }),
    ).rejects.toThrow("16:9 and 9:16");
    expect(request).not.toHaveBeenCalled();
  });

  it("reports processing, success, and safety blocks from the operation", async () => {
    const responses = [
      { name: operation, done: false },
      {
        name: operation,
        done: true,
        response: {
          generateVideoResponse: {
            generatedSamples: [
              {
                video: {
                  uri: "https://generativelanguage.googleapis.com/v1beta/files/xyz:download?alt=media",
                },
              },
            ],
          },
        },
      },
      {
        name: operation,
        done: true,
        response: {
          generateVideoResponse: {
            raiMediaFilteredReasons: ["The prompt was blocked."],
          },
        },
      },
    ];
    const provider = new VeoVideoProvider(
      config,
      vi.fn<typeof fetch>(() =>
        Promise.resolve(Response.json(responses.shift())),
      ),
    );

    await expect(provider.poll(operation)).resolves.toMatchObject({
      status: "processing",
    });
    await expect(provider.poll(operation)).resolves.toMatchObject({
      status: "succeeded",
      resultMimeType: "video/mp4",
      resultUrl:
        "https://generativelanguage.googleapis.com/v1beta/files/xyz:download?alt=media",
    });
    await expect(provider.poll(operation)).resolves.toMatchObject({
      status: "failed",
      errorMessage: "Veo blocked the clip: The prompt was blocked.",
    });
  });

  it("downloads with the key and follows only a trusted redirect without it", async () => {
    const calls: Array<{ url: string; key: string | null }> = [];
    const provider = new VeoVideoProvider(
      config,
      vi.fn<typeof fetch>((input, init) => {
        const url = input instanceof Request ? input.url : input.toString();
        calls.push({
          url,
          key: new Headers(init?.headers).get("x-goog-api-key"),
        });
        return Promise.resolve(
          calls.length === 1
            ? new Response(null, {
                status: 302,
                headers: {
                  location: "https://video.googleusercontent.com/clip.mp4",
                },
              })
            : new Response("video", {
                headers: { "content-type": "video/mp4" },
              }),
        );
      }),
    );

    const response = await provider.download(
      "https://generativelanguage.googleapis.com/v1beta/files/xyz:download?alt=media",
      AbortSignal.timeout(10_000),
    );

    expect(await response.text()).toBe("video");
    expect(calls).toEqual([
      {
        url: "https://generativelanguage.googleapis.com/v1beta/files/xyz:download?alt=media",
        key: "test-key",
      },
      { url: "https://video.googleusercontent.com/clip.mp4", key: null },
    ]);
  });

  it("rejects a redirect to an untrusted host", async () => {
    const provider = new VeoVideoProvider(
      config,
      vi.fn<typeof fetch>(() =>
        Promise.resolve(
          new Response(null, {
            status: 302,
            headers: { location: "https://example.com/clip.mp4" },
          }),
        ),
      ),
    );

    await expect(
      provider.download(
        "https://generativelanguage.googleapis.com/v1beta/files/xyz:download?alt=media",
        AbortSignal.timeout(10_000),
      ),
    ).rejects.toThrow("untrusted");
  });
});
