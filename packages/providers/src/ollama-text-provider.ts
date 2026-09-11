import {
  storyProviderStatusSchema,
  type StoryProviderStatus,
} from "@ai-film-studio/contracts";

import {
  parseGeneratedJson,
  positiveIntegerEnvironment,
  TextProviderConfigurationError,
  TextProviderResponseError,
  TextProviderUnavailableError,
  type GeneratedText,
  type TextGenerationRequest,
  type TextProvider,
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
    if (!this.config.model) {
      throw new TextProviderConfigurationError(
        "OLLAMA_STORY_MODEL is required for local story generation.",
      );
    }
    let response: Response;
    try {
      response = await this.dependencies.fetch(
        `${this.config.baseUrl}/api/chat`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            model: this.config.model,
            stream: false,
            think: false,
            keep_alive: 0,
            format: request.schema,
            messages: [
              {
                role: "system",
                content:
                  "Return only the requested JSON object. Follow the schema exactly.",
              },
              { role: "user", content: request.prompt },
            ],
            options: { temperature: 0.35, num_ctx: 32_768 },
          }),
          signal: AbortSignal.timeout(this.config.timeoutMs),
        },
      );
    } catch (error) {
      throw new TextProviderUnavailableError(
        error instanceof DOMException && error.name === "TimeoutError"
          ? "Local story generation timed out."
          : "Ollama could not be reached.",
      );
    }
    if (!response.ok) {
      throw new TextProviderUnavailableError(
        `Ollama story generation returned HTTP ${response.status}.`,
      );
    }
    const body = asObject(await safeJson(response));
    const message = asObject(body?.message);
    if (!body || typeof message?.content !== "string") {
      throw new TextProviderResponseError(
        "Ollama completed without returning a story plan.",
      );
    }
    return {
      output: parseGeneratedJson(message.content),
      model: typeof body.model === "string" ? body.model : this.config.model,
      usage: {
        inputTokens: integerProperty(body, "prompt_eval_count"),
        outputTokens: integerProperty(body, "eval_count"),
      },
    };
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

function integerProperty(object: JsonObject, name: string): number | null {
  const value = object[name];
  return typeof value === "number" && Number.isInteger(value) && value >= 0
    ? value
    : null;
}
