import { describe, expect, it, vi } from "vitest";

import { OllamaTextProvider } from "../src/ollama-text-provider.js";
import { OpenAiTextProvider } from "../src/openai-text-provider.js";

describe("story text providers", () => {
  it("sends a non-stored strict structured request to OpenAI Responses", async () => {
    let requestBody: Record<string, unknown> | undefined;
    const mockFetch = vi.fn<typeof fetch>((_input, init) => {
      if (typeof init?.body !== "string") {
        throw new Error("Expected an OpenAI JSON request body.");
      }
      requestBody = JSON.parse(init.body) as Record<string, unknown>;
      return Promise.resolve(
        Response.json({
          model: "gpt-5.4-mini-2026-03-17",
          output: [
            {
              content: [
                { type: "output_text", text: '{"story":{"title":"Test"}}' },
              ],
            },
          ],
          usage: { input_tokens: 120, output_tokens: 45 },
        }),
      );
    });
    const provider = new OpenAiTextProvider(
      { apiKey: "test-key", model: "gpt-5.4-mini", timeoutMs: 10_000 },
      { fetch: mockFetch },
    );

    const generated = await provider.generate({
      prompt: "Build a story",
      schemaName: "film_story_plan",
      schema: { type: "object" },
    });

    expect(requestBody).toMatchObject({
      model: "gpt-5.4-mini",
      store: false,
      input: "Build a story",
      text: {
        format: {
          type: "json_schema",
          name: "film_story_plan",
          strict: true,
          schema: { type: "object" },
        },
      },
    });
    expect(generated).toEqual({
      output: { story: { title: "Test" } },
      model: "gpt-5.4-mini-2026-03-17",
      usage: { inputTokens: 120, outputTokens: 45 },
    });
  });

  it("keeps Ollama generation local, disables thinking, and unloads afterward", async () => {
    let requestBody: Record<string, unknown> | undefined;
    const mockFetch = vi.fn<typeof fetch>((_input, init) => {
      if (typeof init?.body !== "string") {
        throw new Error("Expected an Ollama JSON request body.");
      }
      requestBody = JSON.parse(init.body) as Record<string, unknown>;
      return Promise.resolve(
        Response.json({
          model: "qwen3.5:9b-q4_K_M",
          message: { content: '```json\n{"story":{"title":"Local"}}\n```' },
          prompt_eval_count: 88,
          eval_count: 34,
        }),
      );
    });
    const provider = new OllamaTextProvider(
      {
        baseUrl: "http://127.0.0.1:11434",
        model: "qwen3.5:9b-q4_K_M",
        timeoutMs: 10_000,
      },
      { fetch: mockFetch },
    );

    const generated = await provider.generate({
      prompt: "Build a private story",
      schemaName: "film_story_plan",
      schema: { type: "object" },
    });

    expect(requestBody).toMatchObject({
      model: "qwen3.5:9b-q4_K_M",
      stream: false,
      think: false,
      keep_alive: 0,
      format: { type: "object" },
    });
    expect(generated.output).toEqual({ story: { title: "Local" } });
    expect(generated.usage).toEqual({ inputTokens: 88, outputTokens: 34 });
  });

  it("reports missing credentials without making network requests", async () => {
    const mockFetch = vi.fn<typeof fetch>();
    const provider = new OpenAiTextProvider(
      { apiKey: null, model: "gpt-5.4-mini", timeoutMs: 10_000 },
      { fetch: mockFetch },
    );

    await expect(provider.getStatus()).resolves.toMatchObject({
      configured: false,
      available: false,
      mode: "cloud-paid",
    });
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
