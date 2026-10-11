import { describe, expect, it, vi } from "vitest";

import { GeminiImageProvider } from "../src/gemini-image-provider.js";
import {
  ImageProviderConfigurationError,
  ImageProviderResponseError,
} from "../src/image-provider.js";
import { OpenAiImageProvider } from "../src/openai-image-provider.js";

const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WlT5ZkAAAAASUVORK5CYII=",
  "base64",
);
const openAiConfig = {
  apiKey: "test-key",
  defaultModel: "gpt-image-2.5-sunburst",
  timeoutMs: 10_000,
};
const geminiConfig = {
  apiKey: "test-key",
  defaultModel: "gemini-nano-banana-2.1",
  timeoutMs: 10_000,
};
const reference = {
  filename: "rahim-front.png",
  mimeType: "image/png" as const,
  data: png,
};

describe("image providers", () => {
  it("generates an OpenAI image from text and prices it from token usage", async () => {
    let url: string | undefined;
    let body: Record<string, unknown> | undefined;
    const provider = new OpenAiImageProvider(openAiConfig, {
      fetch: vi.fn<typeof fetch>((input, init) => {
        url = input instanceof Request ? input.url : input.toString();
        body = JSON.parse(init?.body as string) as Record<string, unknown>;
        return Promise.resolve(
          Response.json({
            data: [{ b64_json: png.toString("base64") }],
            usage: {
              input_tokens: 100,
              output_tokens: 1000,
              input_tokens_details: { text_tokens: 100, image_tokens: 0 },
            },
          }),
        );
      }),
    });

    const image = await provider.generate({
      model: "gpt-image-2.5-sunburst",
      quality: "medium",
      prompt: "A moonlit platform",
      aspectRatio: "9:16",
      references: [],
    });

    expect(url).toBe("https://api.openai.com/v1/images/generations");
    expect(body).toEqual({
      model: "gpt-image-2.5-sunburst",
      prompt: "A moonlit platform",
      size: "864x1536",
      quality: "medium",
      n: 1,
      output_format: "png",
    });
    expect(image.data).toEqual(png);
    // 100 text tokens at $5/M plus 1000 output tokens at $30/M.
    expect(image.costMicros).toBe(30_500);
  });

  it("sends OpenAI reference photos as repeated image[] parts to the edits endpoint", async () => {
    let url: string | undefined;
    let form: FormData | undefined;
    const provider = new OpenAiImageProvider(openAiConfig, {
      fetch: vi.fn<typeof fetch>((input, init) => {
        url = input instanceof Request ? input.url : input.toString();
        form = init?.body as FormData;
        return Promise.resolve(
          Response.json({ data: [{ b64_json: png.toString("base64") }] }),
        );
      }),
    });

    const image = await provider.generate({
      model: "gpt-image-2.5-sunburst",
      quality: "high",
      prompt: "Rahim on the platform",
      aspectRatio: "16:9",
      references: [reference, { ...reference, filename: "platform.png" }],
    });

    expect(url).toBe("https://api.openai.com/v1/images/edits");
    expect(form?.get("size")).toBe("1536x864");
    expect(form?.get("quality")).toBe("high");
    const images = form?.getAll("image[]") as File[];
    expect(images.map((file) => file.name)).toEqual([
      "rahim-front.png",
      "platform.png",
    ]);
    expect(images[0]?.type).toBe("image/png");
    // Without usage, the estimate is the quality price plus $0.01 per photo.
    expect(image.costMicros).toBe(90_000);
  });

  it("explains an OpenAI safety rejection", async () => {
    const provider = new OpenAiImageProvider(openAiConfig, {
      fetch: vi.fn<typeof fetch>(() =>
        Promise.resolve(
          Response.json(
            { error: { code: "moderation_blocked", message: "Rejected" } },
            { status: 400 },
          ),
        ),
      ),
    });

    await expect(
      provider.generate({
        model: "gpt-image-2.5-sunburst",
        quality: "low",
        prompt: "x",
        aspectRatio: "1:1",
        references: [],
      }),
    ).rejects.toThrow("safety system");
  });

  it("sends a Gemini interaction without storing it and reads the final image", async () => {
    let headers: Headers | undefined;
    let body: Record<string, unknown> | undefined;
    const provider = new GeminiImageProvider(geminiConfig, {
      fetch: vi.fn<typeof fetch>((_input, init) => {
        headers = new Headers(init?.headers);
        body = JSON.parse(init?.body as string) as Record<string, unknown>;
        return Promise.resolve(
          Response.json({
            id: "interaction-1",
            status: "completed",
            model: "gemini-nano-banana-2.1",
            steps: [
              { type: "thought", summary: [] },
              {
                type: "model_output",
                content: [
                  { type: "text", text: "Here is the frame." },
                  {
                    type: "image",
                    mime_type: "image/png",
                    data: "aW50ZXJpbQ==",
                  },
                  {
                    type: "image",
                    mime_type: "image/png",
                    data: png.toString("base64"),
                  },
                ],
              },
            ],
            usage: { total_input_tokens: 2000, total_output_tokens: 1120 },
          }),
        );
      }),
    });

    const image = await provider.generate({
      model: "gemini-nano-banana-2.1",
      quality: "1K",
      prompt: "Rahim on the platform",
      aspectRatio: "9:16",
      references: [reference],
    });

    expect(headers?.get("x-goog-api-key")).toBe("test-key");
    expect(body).toEqual({
      model: "gemini-nano-banana-2.1",
      input: [
        { type: "text", text: "Rahim on the platform" },
        {
          type: "image",
          mime_type: "image/png",
          data: png.toString("base64"),
        },
      ],
      response_format: {
        type: "image",
        mime_type: "image/png",
        aspect_ratio: "9:16",
        image_size: "1K",
      },
      store: false,
    });
    expect(image.data).toEqual(png);
    // $0.0336 for a 1K image plus 2000 input tokens at $1.50/M.
    expect(image.costMicros).toBe(36_600);
  });

  it("reports a Gemini response without an image", async () => {
    const provider = new GeminiImageProvider(geminiConfig, {
      fetch: vi.fn<typeof fetch>(() =>
        Promise.resolve(
          Response.json({
            status: "completed",
            steps: [
              {
                type: "model_output",
                content: [{ type: "text", text: "I can't create that." }],
              },
            ],
          }),
        ),
      ),
    });

    const result = provider.generate({
      model: "gemini-nano-banana-2.1",
      quality: "2K",
      prompt: "x",
      aspectRatio: "1:1",
      references: [],
    });
    await expect(result).rejects.toThrow(ImageProviderResponseError);
    await expect(result).rejects.toThrow("I can't create that.");
  });

  it("reports missing keys without making network requests", async () => {
    const mockFetch = vi.fn<typeof fetch>();
    const openAi = new OpenAiImageProvider(
      { ...openAiConfig, apiKey: null },
      { fetch: mockFetch },
    );
    const gemini = new GeminiImageProvider(
      { ...geminiConfig, apiKey: null },
      { fetch: mockFetch },
    );

    expect(openAi.status()).toMatchObject({ id: "openai", configured: false });
    expect(gemini.status()).toMatchObject({ id: "gemini", configured: false });
    await expect(
      gemini.generate({
        model: "gemini-nano-banana-2.1",
        quality: "1K",
        prompt: "x",
        aspectRatio: "1:1",
        references: [],
      }),
    ).rejects.toThrow(ImageProviderConfigurationError);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
