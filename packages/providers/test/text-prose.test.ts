import { describe, expect, it, vi } from "vitest";

import { AnthropicTextProvider } from "../src/anthropic-text-provider.js";
import { OllamaTextProvider } from "../src/ollama-text-provider.js";
import { OpenAiTextProvider } from "../src/openai-text-provider.js";
import {
  TextProviderAbortedError,
  TextProviderUnavailableError,
} from "../src/text-provider.js";

function claudeStream(text: string, stopReason: string): Response {
  const events = [
    {
      type: "message_start",
      message: {
        id: "msg_prose",
        type: "message",
        role: "assistant",
        model: "claude-opus-5-5",
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: {
          input_tokens: 900,
          output_tokens: 1,
          cache_read_input_tokens: 12_000,
          cache_creation_input_tokens: 0,
        },
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
      usage: { output_tokens: 2_400 },
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

const claudeConfig = {
  apiKey: "test-key",
  model: "claude-opus-5-5",
  effort: "high",
  timeoutMs: 10_000,
} as const;

describe("prose completion", () => {
  it("sends Claude a cached book context, model and effort override", async () => {
    let body: Record<string, unknown> | undefined;
    const fetchMock = vi.fn<typeof fetch>((_input, init) => {
      body = JSON.parse(init?.body as string) as Record<string, unknown>;
      return Promise.resolve(claudeStream("She opened the door.", "end_turn"));
    });
    const provider = new AnthropicTextProvider(claudeConfig, {
      fetch: fetchMock,
    });
    const result = await provider.complete({
      system: "You are the novelist.",
      cachedContext: "Story bible …",
      prompt: "Write chapter 1.",
      model: "claude-sonnet-5-5",
      effort: "medium",
      maxOutputTokens: 20_000,
    });
    expect(body).toMatchObject({
      model: "claude-sonnet-5-5",
      max_tokens: 20_000,
      output_config: { effort: "medium" },
      system: [
        { type: "text", text: "You are the novelist." },
        {
          type: "text",
          text: "Story bible …",
          cache_control: { type: "ephemeral" },
        },
      ],
    });
    expect(body?.output_config).not.toHaveProperty("format");
    expect(result).toEqual({
      text: "She opened the door.",
      model: "claude-opus-5-5",
      truncated: false,
      usage: {
        inputTokens: 900,
        outputTokens: 2_400,
        cacheReadTokens: 12_000,
        cacheWriteTokens: 0,
      },
    });
  });

  it("reports truncated Claude prose", async () => {
    const provider = new AnthropicTextProvider(claudeConfig, {
      fetch: () =>
        Promise.resolve(claudeStream("Half a chapter", "max_tokens")),
    });
    const result = await provider.complete({ prompt: "Write." });
    expect(result.truncated).toBe(true);
  });

  it("marks Claude rate limits retryable and key errors permanent", async () => {
    const limited = new AnthropicTextProvider(claudeConfig, {
      fetch: () =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              type: "error",
              error: { type: "rate_limit_error", message: "slow down" },
            }),
            {
              status: 429,
              headers: {
                "content-type": "application/json",
                "retry-after": "7",
              },
            },
          ),
        ),
    });
    const controller = new AbortController();
    const error = await limited
      .complete({ prompt: "Write.", signal: controller.signal })
      .catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(TextProviderUnavailableError);
    expect(error).toMatchObject({
      retryable: true,
      status: 429,
      retryAfterMs: 7_000,
    });

    const rejected = new AnthropicTextProvider(claudeConfig, {
      fetch: () =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              type: "error",
              error: { type: "authentication_error", message: "bad key" },
            }),
            {
              status: 401,
              headers: { "content-type": "application/json" },
            },
          ),
        ),
    });
    await expect(
      rejected.complete({ prompt: "Write.", signal: controller.signal }),
    ).rejects.toMatchObject({ retryable: false, status: 401 });
  });

  it("throws an abort error when the caller cancels", async () => {
    const controller = new AbortController();
    const provider = new OpenAiTextProvider(
      { apiKey: "test-key", model: "gpt-5.4-mini", timeoutMs: 10_000 },
      {
        fetch: (_input, init) =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () =>
              reject(new DOMException("aborted", "AbortError")),
            );
          }),
      },
    );
    const pending = provider.complete({
      prompt: "Write.",
      signal: controller.signal,
    });
    controller.abort();
    await expect(pending).rejects.toBeInstanceOf(TextProviderAbortedError);
  });

  it("sends OpenAI instructions and splits cached tokens from input", async () => {
    let body: Record<string, unknown> | undefined;
    const provider = new OpenAiTextProvider(
      { apiKey: "test-key", model: "gpt-5.4-mini", timeoutMs: 10_000 },
      {
        fetch: (_input, init) => {
          body = JSON.parse(init?.body as string) as Record<string, unknown>;
          return Promise.resolve(
            Response.json({
              model: "gpt-5.4-mini-2026-03-01",
              status: "incomplete",
              incomplete_details: { reason: "max_output_tokens" },
              output_text: "Partial chapter",
              usage: {
                input_tokens: 5_000,
                output_tokens: 800,
                input_tokens_details: { cached_tokens: 4_000 },
              },
            }),
          );
        },
      },
    );
    const result = await provider.complete({
      system: "Rules",
      cachedContext: "Bible",
      prompt: "Write.",
    });
    expect(body).toMatchObject({
      instructions: "Rules\n\nBible",
      input: "Write.",
      store: false,
    });
    expect(body).not.toHaveProperty("text");
    expect(result).toEqual({
      text: "Partial chapter",
      model: "gpt-5.4-mini-2026-03-01",
      truncated: true,
      usage: {
        inputTokens: 1_000,
        outputTokens: 800,
        cacheReadTokens: 4_000,
        cacheWriteTokens: 0,
      },
    });
  });

  it("writes prose locally with Ollama without a JSON format", async () => {
    let body: Record<string, unknown> | undefined;
    const provider = new OllamaTextProvider(
      {
        baseUrl: "http://127.0.0.1:11434",
        model: "qwen3.5:9b-q4_K_M",
        timeoutMs: 10_000,
      },
      {
        fetch: (_input, init) => {
          body = JSON.parse(init?.body as string) as Record<string, unknown>;
          return Promise.resolve(
            Response.json({
              model: "qwen3.5:9b-q4_K_M",
              message: { role: "assistant", content: "Local prose." },
              done_reason: "stop",
              prompt_eval_count: 50,
              eval_count: 20,
            }),
          );
        },
      },
    );
    const result = await provider.complete({
      system: "Novelist",
      prompt: "Write.",
    });
    expect(body).not.toHaveProperty("format");
    expect(body?.messages).toEqual([
      { role: "system", content: "Novelist" },
      { role: "user", content: "Write." },
    ]);
    expect(result).toMatchObject({ text: "Local prose.", truncated: false });
  });
});
