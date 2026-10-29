import {
  storyProviderStatusSchema,
  type StoryProviderStatus,
} from "@ai-studio/contracts";

import {
  parseGeneratedJson,
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

export type OllamaTextProviderConfig = {
  baseUrl: string;
  model: string | null;
  timeoutMs: number;
};

type Dependencies = { fetch: typeof fetch };
type JsonObject = Record<string, unknown>;

export function resolveOllamaTextProviderConfig(): OllamaTextProviderConfig {
  const baseUrl = new URL(
    process.env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434",
  );
  if (
    baseUrl.protocol !== "http:" ||
    baseUrl.username ||
    baseUrl.password ||
    !["127.0.0.1", "localhost", "::1", "[::1]"].includes(baseUrl.hostname)
  ) {
    throw new TextProviderConfigurationError(
      "OLLAMA_BASE_URL must use HTTP on a loopback host.",
    );
  }
  return {
    baseUrl: baseUrl.toString().replace(/\/$/, ""),
    model: process.env.OLLAMA_STORY_MODEL?.trim() || null,
    timeoutMs: positiveIntegerEnvironment(
      "OLLAMA_STORY_TIMEOUT_MS",
      600_000,
      10_000,
      3_600_000,
    ),
  };
}

export class OllamaTextProvider implements TextProvider {
  readonly id = "ollama" as const;

  get defaultModel(): string | null {
    return this.config.model;
  }

  constructor(
    readonly config: OllamaTextProviderConfig,
    private readonly dependencies: Dependencies = { fetch },
  ) {}

  async getStatus(): Promise<StoryProviderStatus> {
    if (!this.config.model) {
      return this.status(
        false,
        false,
        "Set OLLAMA_STORY_MODEL to enable free local story generation.",
      );
    }
    try {
      const response = await this.dependencies.fetch(
        `${this.config.baseUrl}/api/tags`,
        { signal: AbortSignal.timeout(3_000) },
      );
      if (!response.ok) {
        return this.status(
          true,
          false,
          `Ollama health check returned HTTP ${response.status}.`,
        );
      }
      const body = asObject(await response.json());
      const installed = Array.isArray(body?.models)
        ? body.models.some((value) => {
            const model = asObject(value);
            return (
              model?.name === this.config.model ||
              model?.model === this.config.model
            );
          })
        : false;
      return installed
        ? this.status(
            true,
            true,
            "Ollama is ready for private, zero-token-cost generation.",
          )
        : this.status(
            true,
            false,
            `Ollama is running, but ${this.config.model} is not installed.`,
          );
    } catch {
      return this.status(
        true,
        false,
        "Ollama is configured but is not reachable.",
      );
    }
  }

  async generate(request: TextGenerationRequest): Promise<GeneratedText> {
    const { body, content } = await this.chat(request, {
      format: toOllamaSchema(request.schema),
      system:
        "Return only the requested JSON object. Follow the schema exactly.",
      temperature: 0.35,
    });
    return {
      output: parseGeneratedJson(content),
      model: this.modelOf(body, request),
      usage: usageOf(body),
    };
  }

  async complete(request: TextCompletionRequest): Promise<GeneratedProse> {
    const { body, content } = await this.chat(request, {
      format: null,
      system: null,
      temperature: 0.8,
    });
    return {
      text: content,
      model: this.modelOf(body, request),
      usage: usageOf(body),
      truncated: body.done_reason === "length",
    };
  }

  private modelOf(body: JsonObject, request: TextRequestOptions): string {
    return typeof body.model === "string"
      ? body.model
      : (request.model ?? this.config.model ?? "");
  }

  private async chat(
    request: TextRequestOptions & { prompt: string },
    options: {
      format: unknown;
      system: string | null;
      temperature: number;
    },
  ): Promise<{ body: JsonObject; content: string }> {
    const model = request.model ?? this.config.model;
    if (!model) {
      throw new TextProviderConfigurationError(
        "OLLAMA_STORY_MODEL is required for local generation.",
      );
    }
    const system = [request.system ?? options.system, request.cachedContext]
      .filter(Boolean)
      .join("\n\n");
    const { signal, timeout } = requestSignal(
      this.config.timeoutMs,
      request.signal,
    );
    let response: Response;
    try {
      response = await this.dependencies.fetch(
        `${this.config.baseUrl}/api/chat`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            model,
            stream: false,
            think: false,
            keep_alive: 0,
            ...(options.format ? { format: options.format } : {}),
            messages: [
              ...(system ? [{ role: "system", content: system }] : []),
              { role: "user", content: request.prompt },
            ],
            options: {
              temperature: options.temperature,
              num_ctx: 32_768,
              ...(request.maxOutputTokens
                ? { num_predict: request.maxOutputTokens }
                : {}),
            },
          }),
          signal,
        },
      );
    } catch {
      if (request.signal?.aborted) throw new TextProviderAbortedError();
      throw new TextProviderUnavailableError(
        timeout.aborted
          ? "Local generation timed out."
          : "Ollama could not be reached.",
      );
    }
    if (!response.ok) {
      throw new TextProviderUnavailableError(
        await ollamaHttpMessage(response),
        { status: response.status, retryable: response.status >= 500 },
      );
    }
    const body = asObject(await safeJson(response));
    const message = asObject(body?.message);
    if (!body || typeof message?.content !== "string") {
      throw new TextProviderResponseError(
        "Ollama completed without returning a result.",
      );
    }
    return { body, content: message.content };
  }

  private status(
    configured: boolean,
    available: boolean,
    message: string,
  ): StoryProviderStatus {
    return storyProviderStatusSchema.parse({
      id: this.id,
      name: "Local Ollama",
      mode: "local-free",
      configured,
      available,
      model: this.config.model,
      message,
    });
  }
}

const unsupportedGrammarKeywords = new Set([
  "exclusiveMaximum",
  "exclusiveMinimum",
  "format",
  "maxItems",
  "maxLength",
  "maximum",
  "minItems",
  "minLength",
  "minimum",
  "multipleOf",
  "pattern",
]);

function toOllamaSchema(
  schema: Record<string, unknown>,
): Record<string, unknown> {
  return simplifySchemaValue(schema) as Record<string, unknown>;
}

function simplifySchemaValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(simplifySchemaValue);
  const object = asObject(value);
  if (!object) return value;
  return Object.fromEntries(
    Object.entries(object)
      .filter(([key]) => !unsupportedGrammarKeywords.has(key))
      .map(([key, child]) => [key, simplifySchemaValue(child)]),
  );
}

async function ollamaHttpMessage(response: Response): Promise<string> {
  const body = asObject(await safeJson(response));
  const detail = nestedErrorMessage(body?.error);
  if (detail?.toLowerCase().includes("failed to parse grammar")) {
    return "Ollama could not apply the structured story format. Restart AI Studio and try again.";
  }
  if (detail?.toLowerCase().includes("memory")) {
    return "Ollama does not have enough free memory for story generation. Close memory-heavy applications and try again.";
  }
  if (
    detail?.toLowerCase().includes("model") &&
    detail.toLowerCase().includes("not found")
  ) {
    return "The configured Ollama story model is no longer installed.";
  }
  return `Ollama story generation returned HTTP ${response.status}.`;
}

function nestedErrorMessage(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  try {
    const outer = asObject(JSON.parse(value) as unknown);
    const error = asObject(outer?.error);
    return typeof error?.message === "string" ? error.message : value;
  } catch {
    return value;
  }
}

async function safeJson(response: Response): Promise<unknown> {
  try {
    return (await response.json()) as unknown;
  } catch {
    return undefined;
  }
}

function asObject(value: unknown): JsonObject | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as JsonObject)
    : undefined;
}

function usageOf(body: JsonObject): TextUsage {
  return {
    inputTokens: integerProperty(body, "prompt_eval_count"),
    outputTokens: integerProperty(body, "eval_count"),
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  };
}

function integerProperty(object: JsonObject, name: string): number | null {
  const value = object[name];
  return typeof value === "number" && Number.isInteger(value) && value >= 0
    ? value
    : null;
}
