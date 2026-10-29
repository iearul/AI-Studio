import Anthropic from "@anthropic-ai/sdk";
import {
  storyProviderStatusSchema,
  type StoryProviderStatus,
} from "@ai-studio/contracts";

import {
  isPermanentHttpStatus,
  parseGeneratedJson,
  parseRetryAfter,
  positiveIntegerEnvironment,
  requestSignal,
  TextProviderAbortedError,
  TextProviderConfigurationError,
  TextProviderResponseError,
  TextProviderUnavailableError,
  type GeneratedProse,
  type GeneratedText,
  type TextCompletionRequest,
  type TextGenerationRequest,
  type TextProvider,
  type TextRequestOptions,
  type TextUsage,
} from "./text-provider.js";

const anthropicEfforts = ["low", "medium", "high", "xhigh", "max"] as const;

export type AnthropicEffort = (typeof anthropicEfforts)[number];

export type AnthropicTextProviderConfig = {
  apiKey: string | null;
  model: string;
  effort: AnthropicEffort;
  timeoutMs: number;
};

type Dependencies = { fetch: typeof fetch };
type JsonObject = Record<string, unknown>;

export function resolveAnthropicTextProviderConfig(): AnthropicTextProviderConfig {
  const effort = process.env.ANTHROPIC_STORY_EFFORT?.trim() || "high";
  if (!isAnthropicEffort(effort)) {
    throw new TextProviderConfigurationError(
      `ANTHROPIC_STORY_EFFORT must be one of ${anthropicEfforts.join(", ")}.`,
    );
  }
  return {
    apiKey: process.env.ANTHROPIC_API_KEY?.trim() || null,
    model: process.env.ANTHROPIC_STORY_MODEL?.trim() || "claude-opus-5-5",
    effort,
    timeoutMs: positiveIntegerEnvironment(
      "ANTHROPIC_STORY_TIMEOUT_MS",
      600_000,
      10_000,
      1_800_000,
    ),
  };
}

export class AnthropicTextProvider implements TextProvider {
  readonly id = "anthropic" as const;

  get defaultModel(): string | null {
    return this.config.model;
  }

  constructor(
    readonly config: AnthropicTextProviderConfig,
    private readonly dependencies: Dependencies = { fetch },
  ) {}

  async getStatus(): Promise<StoryProviderStatus> {
    if (!this.config.apiKey) {
      return this.status(
        false,
        false,
        "Add ANTHROPIC_API_KEY to .env.local to enable paid automatic generation.",
      );
    }
    try {
      await this.client(this.config.apiKey).models.retrieve(
        this.config.model,
        null,
        { timeout: 5_000, maxRetries: 0 },
      );
      return this.status(
        true,
        true,
        "Claude is ready. Generating uses separately billed API tokens.",
      );
    } catch (error) {
      const status = apiErrorStatus(error);
      return this.status(
        true,
        false,
        status === undefined
          ? "Claude is configured but could not be reached."
          : anthropicHttpMessage(status, "status check"),
      );
    }
  }

  async generate(request: TextGenerationRequest): Promise<GeneratedText> {
    const message = await this.send(request, {
      type: "json_schema",
      schema: toClaudeSchema(request.schema),
    });
    if (message.stop_reason === "max_tokens") {
      throw new TextProviderResponseError(
        "Claude ran out of output tokens before finishing the response.",
      );
    }
    const outputText = textOf(message);
    if (!outputText) {
      throw new TextProviderResponseError(
        "Claude completed without returning a result.",
      );
    }
    return {
      output: parseGeneratedJson(outputText),
      model: message.model,
      usage: usageOf(message),
    };
  }

  async complete(request: TextCompletionRequest): Promise<GeneratedProse> {
    const message = await this.send(request, null);
    const text = textOf(message);
    if (!text) {
      throw new TextProviderResponseError("Claude completed without text.");
    }
    return {
      text,
      model: message.model,
      usage: usageOf(message),
      truncated: message.stop_reason === "max_tokens",
    };
  }

  private async send(
    request: TextRequestOptions & { prompt: string },
    format: { type: "json_schema"; schema: JsonObject } | null,
  ): Promise<Anthropic.Beta.BetaMessage> {
    if (!this.config.apiKey) {
      throw new TextProviderConfigurationError(
        "ANTHROPIC_API_KEY is required for Claude generation.",
      );
    }
    // The SDK timeout only covers the wait for response headers; this signal
    // also bounds the streamed body.
    const { signal, timeout } = requestSignal(
      this.config.timeoutMs,
      request.signal,
    );
    const system: Anthropic.Beta.BetaTextBlockParam[] = [];
    if (request.system) system.push({ type: "text", text: request.system });
    if (request.cachedContext) {
      // Stable book context: later chapters read it from the prompt cache.
      system.push({
        type: "text",
        text: request.cachedContext,
        cache_control: { type: "ephemeral" },
      });
    }
    let message: Anthropic.Beta.BetaMessage;
    try {
      message = await this.client(this.config.apiKey)
        .beta.messages.stream(
          {
            model: request.model ?? this.config.model,
            max_tokens: request.maxOutputTokens ?? 64_000,
            thinking: { type: "adaptive" },
            output_config: {
              effort: request.effort ?? this.config.effort,
              ...(format ? { format } : {}),
            },
            ...(system.length > 0 ? { system } : {}),
            // Re-runs a safety-classifier decline on Anthropic's recommended
            // fallback model inside the same request.
            betas: ["server-side-fallback-2026-07-01"],
            fallbacks: "default",
            messages: [{ role: "user", content: request.prompt }],
          },
          { signal, maxRetries: request.signal ? 0 : 2 },
        )
        .finalMessage();
    } catch (error) {
      if (request.signal?.aborted) throw new TextProviderAbortedError();
      if (timeout.aborted) {
        throw new TextProviderUnavailableError("Claude generation timed out.");
      }
      const status = apiErrorStatus(error);
      throw new TextProviderUnavailableError(
        status === undefined
          ? "Claude could not be reached."
          : anthropicHttpMessage(status, "generation"),
        {
          status: status ?? null,
          retryable: status === undefined || !isPermanentHttpStatus(status),
          retryAfterMs:
            error instanceof Anthropic.APIError
              ? parseRetryAfter(
                  (error.headers as Headers | undefined)?.get("retry-after"),
                )
              : null,
        },
      );
    }
    if (message.stop_reason === "refusal") {
      throw new TextProviderResponseError(
        "Claude declined this request. Revise the brief or choose another model.",
      );
    }
    return message;
  }

  private client(apiKey: string): Anthropic {
    return new Anthropic({ apiKey, fetch: this.dependencies.fetch });
  }

  private status(
    configured: boolean,
    available: boolean,
    message: string,
  ): StoryProviderStatus {
    return storyProviderStatusSchema.parse({
      id: this.id,
      name: "Claude API",
      mode: "cloud-paid",
      configured,
      available,
      model: this.config.model,
      message,
    });
  }
}

function textOf(message: Anthropic.Beta.BetaMessage): string {
  return message.content
    .flatMap((block) => (block.type === "text" ? [block.text] : []))
    .join("");
}

function usageOf(message: Anthropic.Beta.BetaMessage): TextUsage {
  return {
    inputTokens: message.usage.input_tokens,
    outputTokens: message.usage.output_tokens,
    cacheReadTokens: message.usage.cache_read_input_tokens ?? 0,
    cacheWriteTokens: message.usage.cache_creation_input_tokens ?? 0,
  };
}

function isAnthropicEffort(value: string): value is AnthropicEffort {
  return (anthropicEfforts as readonly string[]).includes(value);
}

function apiErrorStatus(error: unknown): number | undefined {
  if (!(error instanceof Anthropic.APIError)) return undefined;
  const status: unknown = error.status;
  return typeof status === "number" ? status : undefined;
}

function anthropicHttpMessage(status: number, action: string): string {
  if (status === 401 || status === 403) {
    return "Anthropic rejected the configured API key or workspace permissions.";
  }
  if (status === 404) {
    return "The configured Claude story model is not available to this API key.";
  }
  if (status === 429) {
    return "Anthropic rate limits or spend limits prevented story generation.";
  }
  if (status === 529) {
    return "Claude is temporarily overloaded. Try again in a few minutes.";
  }
  return `Claude ${action} returned HTTP ${status}.`;
}

// Claude structured outputs reject numeric, length, pattern and most array-size
// keywords. They are folded into the field description so the model still sees
// them; the server-side Zod validation enforces them. The SDK's own transform
// would also demote `enum`, which Claude supports, so it is not used here.
const unsupportedSchemaKeywords = new Set([
  "exclusiveMaximum",
  "exclusiveMinimum",
  "maxItems",
  "maxLength",
  "maximum",
  "minLength",
  "minimum",
  "multipleOf",
  "pattern",
]);

function toClaudeSchema(schema: Record<string, unknown>): JsonObject {
  return toClaudeSchemaNode(schema) as JsonObject;
}

function toClaudeSchemaNode(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(toClaudeSchemaNode);
  const object = asObject(node);
  if (!object) return node;
  const schema: JsonObject = {};
  const limits: string[] = [];
  for (const [key, value] of Object.entries(object)) {
    if (key === "$schema") continue;
    if (key === "properties" || key === "$defs" || key === "definitions") {
      schema[key] = Object.fromEntries(
        Object.entries(asObject(value) ?? {}).map(([name, child]) => [
          name,
          toClaudeSchemaNode(child),
        ]),
      );
    } else if (
      unsupportedSchemaKeywords.has(key) ||
      (key === "minItems" && value !== 0 && value !== 1)
    ) {
      limits.push(`${key} ${JSON.stringify(value)}`);
    } else {
      schema[key] = toClaudeSchemaNode(value);
    }
  }
  if (limits.length > 0) {
    const description =
      typeof schema.description === "string" ? `${schema.description} ` : "";
    schema.description = `${description}Limits: ${limits.join(", ")}.`;
  }
  return schema;
}

function asObject(value: unknown): JsonObject | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as JsonObject)
    : undefined;
}
