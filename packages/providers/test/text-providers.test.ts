import { describe, expect, it, vi } from "vitest";

import { AnthropicTextProvider } from "../src/anthropic-text-provider.js";
import { OllamaTextProvider } from "../src/ollama-text-provider.js";
import { OpenAiTextProvider } from "../src/openai-text-provider.js";

const claudeConfig = {
  apiKey: "test-key",
  model: "claude-opus-5-5",
  effort: "high",
  timeoutMs: 10_000,
} as const;

function claudeStream(text: string, stopReason: string): Response {
  const events = [
    {
      type: "message_start",
      message: {
        id: "msg_test",
        type: "message",
        role: "assistant",
        model: "claude-opus-5-5",
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 120, output_tokens: 1 },
      },
    },
    {
      type: "content_block_start",
      index: 0,
      content_block: { type: "text", text: "" },
    },
    {
      type: "content_block_delta",
      index: 0,
      delta: { type: "text_delta", text },
    },
    { type: "content_block_stop", index: 0 },
    {
      type: "message_delta",
      delta: { stop_reason: stopReason, stop_sequence: null },
      usage: { output_tokens: 45 },
    },
    { type: "message_stop" },
  ];
  return new Response(
    events
      .map(
        (event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`,
      )
      .join(""),
    { headers: { "content-type": "text/event-stream" } },
  );
}

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
      usage: {
        inputTokens: 120,
        outputTokens: 45,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      },
    });
  });

  it("streams a Claude structured request with refusal fallback and a Claude-compatible schema", async () => {
    let requestUrl: string | undefined;
    let requestHeaders: Headers | undefined;
    let requestBody: Record<string, unknown> | undefined;
    const mockFetch = vi.fn<typeof fetch>((input, init) => {
      if (typeof init?.body !== "string") {
        throw new Error("Expected a Claude JSON request body.");
      }
      requestUrl = input instanceof Request ? input.url : input.toString();
      requestHeaders = new Headers(init.headers);
      requestBody = JSON.parse(init.body) as Record<string, unknown>;
      return Promise.resolve(
        claudeStream('{"story":{"title":"Test"}}', "end_turn"),
      );
    });
    const provider = new AnthropicTextProvider(claudeConfig, {
      fetch: mockFetch,
    });

    const generated = await provider.generate({
      prompt: "Build a story",
      schemaName: "film_story_plan",
      schema: {
        $schema: "http://json-schema.org/draft-07/schema#",
        type: "object",
        properties: {
          title: { type: "string", minLength: 2, maxLength: 160 },
          tone: { type: "string", enum: ["warm", "tense"] },
          shots: {
            type: "array",
            minItems: 1,
            maxItems: 200,
            items: { type: "string", pattern: "^SHOT_[0-9]{3,4}$" },
          },
          pattern: {
            type: "integer",
            description: "Field named like a keyword.",
            minimum: 1,
          },
        },
        required: ["title", "tone", "shots", "pattern"],
        additionalProperties: false,
      },
    });

    expect(requestUrl).toBe("https://api.anthropic.com/v1/messages?beta=true");
    expect(requestHeaders?.get("x-api-key")).toBe("test-key");
    expect(requestHeaders?.get("anthropic-beta")).toBe(
      "server-side-fallback-2026-07-01",
    );
    expect(requestBody).toEqual({
      model: "claude-opus-5-5",
      max_tokens: 64_000,
      stream: true,
      thinking: { type: "adaptive" },
      fallbacks: "default",
      messages: [{ role: "user", content: "Build a story" }],
      output_config: {
        effort: "high",
        format: {
          type: "json_schema",
          schema: {
            type: "object",
            properties: {
              title: {
                type: "string",
                description: "Limits: minLength 2, maxLength 160.",
              },
              tone: { type: "string", enum: ["warm", "tense"] },
              shots: {
                type: "array",
                minItems: 1,
                items: {
                  type: "string",
                  description: 'Limits: pattern "^SHOT_[0-9]{3,4}$".',
                },
                description: "Limits: maxItems 200.",
              },
              pattern: {
                type: "integer",
                description: "Field named like a keyword. Limits: minimum 1.",
              },
            },
            required: ["title", "tone", "shots", "pattern"],
            additionalProperties: false,
          },
        },
      },
    });
    expect(generated).toEqual({
      output: { story: { title: "Test" } },
      model: "claude-opus-5-5",
      usage: {
        inputTokens: 120,
        outputTokens: 45,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      },
    });
  });

  it("reports a Claude refusal instead of parsing its output", async () => {
    const provider = new AnthropicTextProvider(claudeConfig, {
      fetch: vi.fn<typeof fetch>(() =>
        Promise.resolve(claudeStream("", "refusal")),
      ),
    });

    await expect(
      provider.generate({
        prompt: "Build a story",
        schemaName: "film_story_plan",
        schema: { type: "object" },
      }),
    ).rejects.toThrow("Claude declined");
  });

  it("explains a rejected Claude API key in the provider status", async () => {
    const provider = new AnthropicTextProvider(claudeConfig, {
      fetch: vi.fn<typeof fetch>(() =>
        Promise.resolve(
          Response.json(
            {
              type: "error",
              error: {
                type: "authentication_error",
                message: "invalid x-api-key",
              },
            },
            { status: 401 },
          ),
        ),
      ),
    });

    await expect(provider.getStatus()).resolves.toMatchObject({
      id: "anthropic",
      configured: true,
      available: false,
      message:
        "Anthropic rejected the configured API key or workspace permissions.",
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
      schema: {
        type: "object",
        properties: {
          title: {
            type: "string",
            minLength: 2,
            maxLength: 160,
            pattern: "^[A-Z]",
          },
        },
        required: ["title"],
        additionalProperties: false,
      },
    });

    expect(requestBody).toMatchObject({
      model: "qwen3.5:9b-q4_K_M",
      stream: false,
      think: false,
      keep_alive: 0,
      format: {
        type: "object",
        properties: { title: { type: "string" } },
        required: ["title"],
        additionalProperties: false,
      },
    });
    expect(generated.output).toEqual({ story: { title: "Local" } });
    expect(generated.usage).toEqual({
      inputTokens: 88,
      outputTokens: 34,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    });
  });

  it("turns Ollama grammar failures into an actionable error", async () => {
    const provider = new OllamaTextProvider(
      {
        baseUrl: "http://127.0.0.1:11434",
        model: "qwen3.5:9b-q4_K_M",
        timeoutMs: 10_000,
      },
      {
        fetch: vi.fn<typeof fetch>(() =>
          Promise.resolve(
            Response.json(
              {
                error: JSON.stringify({
                  error: {
                    message:
                      "Failed to initialize samplers: failed to parse grammar",
                  },
                }),
              },
              { status: 400 },
            ),
          ),
        ),
      },
    );

    await expect(
      provider.generate({
        prompt: "Build a private story",
        schemaName: "film_story_plan",
        schema: { type: "object" },
      }),
    ).rejects.toThrow("structured story format");
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

  it("reports missing Claude credentials without making network requests", async () => {
    const mockFetch = vi.fn<typeof fetch>();
    const provider = new AnthropicTextProvider(
      { ...claudeConfig, apiKey: null },
      { fetch: mockFetch },
    );

    await expect(provider.getStatus()).resolves.toMatchObject({
      id: "anthropic",
      configured: false,
      available: false,
      mode: "cloud-paid",
    });
    await expect(
      provider.generate({
        prompt: "Build a story",
        schemaName: "film_story_plan",
        schema: { type: "object" },
      }),
    ).rejects.toThrow("ANTHROPIC_API_KEY is required");
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
