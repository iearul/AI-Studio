import {
  storyProviderStatusSchema,
  type StoryProviderStatus,
} from "@ai-film-studio/contracts";

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

export type OpenAiTextProviderConfig = {
  apiKey: string | null;
  model: string;
  timeoutMs: number;
};

type Dependencies = { fetch: typeof fetch };
type JsonObject = Record<string, unknown>;

export function resolveOpenAiTextProviderConfig(): OpenAiTextProviderConfig {
  return {
    apiKey: process.env.OPENAI_API_KEY?.trim() || null,
    model: process.env.OPENAI_STORY_MODEL?.trim() || "gpt-5.4-mini",
    timeoutMs: positiveIntegerEnvironment(
      "OPENAI_STORY_TIMEOUT_MS",
      180_000,
      10_000,
      600_000,
    ),
  };
}

export class OpenAiTextProvider implements TextProvider {
  readonly id = "openai" as const;

  get defaultModel(): string | null {
    return this.config.model;
  }

  constructor(
    readonly config: OpenAiTextProviderConfig,
    private readonly dependencies: Dependencies = { fetch },
  ) {}

  async getStatus(): Promise<StoryProviderStatus> {
    if (!this.config.apiKey) {
      return this.status(
        false,
        false,
        "Add OPENAI_API_KEY to .env.local to enable paid automatic generation.",
      );
    }
    try {
      const response = await this.dependencies.fetch(
        `https://api.openai.com/v1/models/${encodeURIComponent(this.config.model)}`,
        {
          headers: { authorization: `Bearer ${this.config.apiKey}` },
          signal: AbortSignal.timeout(5_000),
        },
      );
      if (response.ok) {
        return this.status(
          true,
          true,
          "OpenAI is ready. Generating uses separately billed API tokens.",
        );
      }
      return this.status(
        true,
        false,
        openAiHttpMessage(response.status, "status check"),
      );
    } catch {
      return this.status(
        true,
        false,
        "OpenAI is configured but could not be reached.",
      );
    }
  }

  async generate(request: TextGenerationRequest): Promise<GeneratedText> {
    const body = await this.send(request, {
      format: {
        type: "json_schema",
        name: request.schemaName,
        strict: true,
        schema: request.schema,
      },
    });
    const outputText = responseOutputText(body);
    if (!outputText) {
      throw new TextProviderResponseError(
        "OpenAI completed without returning a result.",
      );
    }
    return {
      output: parseGeneratedJson(outputText),
      model: this.modelOf(body, request),
      usage: usageOf(body),
    };
  }

  async complete(request: TextCompletionRequest): Promise<GeneratedProse> {
    const body = await this.send(request, null);
    const text = responseOutputText(body);
    if (!text) {
      throw new TextProviderResponseError("OpenAI completed without text.");
    }
    const details = asObject(body.incomplete_details);
    return {
      text,
      model: this.modelOf(body, request),
      usage: usageOf(body),
      truncated:
        body.status === "incomplete" && details?.reason === "max_output_tokens",
    };
  }

  private modelOf(body: JsonObject, request: TextRequestOptions): string {
    return typeof body.model === "string"
      ? body.model
      : (request.model ?? this.config.model);
  }

  private async send(
    request: TextRequestOptions & { prompt: string },
    text: JsonObject | null,
  ): Promise<JsonObject> {
    if (!this.config.apiKey) {
      throw new TextProviderConfigurationError(
        "OPENAI_API_KEY is required for OpenAI generation.",
      );
    }
    // The stable context goes first so OpenAI's automatic prefix cache can
    // reuse it across chapters.
    const instructions = [request.system, request.cachedContext]
      .filter(Boolean)
      .join("\n\n");
    const { signal, timeout } = requestSignal(
      this.config.timeoutMs,
      request.signal,
    );
    let response: Response;
    try {
      response = await this.dependencies.fetch(
        "https://api.openai.com/v1/responses",
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${this.config.apiKey}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            model: request.model ?? this.config.model,
            store: false,
            ...(instructions ? { instructions } : {}),
            input: request.prompt,
            max_output_tokens: request.maxOutputTokens ?? 32_768,
            ...(text ? { text } : {}),
          }),
          signal,
        },
      );
    } catch {
      if (request.signal?.aborted) throw new TextProviderAbortedError();
      throw new TextProviderUnavailableError(
        timeout.aborted
          ? "OpenAI generation timed out."
          : "OpenAI could not be reached.",
      );
    }
    if (!response.ok) {
      throw new TextProviderUnavailableError(
        openAiHttpMessage(response.status, "generation"),
        {
          status: response.status,
          retryable: !isPermanentHttpStatus(response.status),
          retryAfterMs: parseRetryAfter(response.headers.get("retry-after")),
        },
      );
    }
    const body = asObject(await safeJson(response));
    if (!body) {
      throw new TextProviderResponseError(
        "OpenAI returned an invalid response.",
      );
    }
    return body;
  }

  private status(
    configured: boolean,
    available: boolean,
    message: string,
  ): StoryProviderStatus {
    return storyProviderStatusSchema.parse({
      id: this.id,
      name: "OpenAI API",
      mode: "cloud-paid",
      configured,
      available,
      model: this.config.model,
      message,
    });
  }
}

function openAiHttpMessage(status: number, action: string): string {
  if (status === 401 || status === 403) {
    return "OpenAI rejected the configured API key or project permissions.";
  }
  if (status === 404) {
    return "The configured OpenAI story model is not available to this API project.";
  }
  if (status === 429) {
    return "OpenAI rate limits or API billing quota prevented story generation.";
  }
  return `OpenAI ${action} returned HTTP ${status}.`;
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

function integerProperty(
  object: JsonObject | undefined,
  name: string,
): number | null {
  const value = object?.[name];
  return typeof value === "number" && Number.isInteger(value) && value >= 0
    ? value
    : null;
}

function usageOf(body: JsonObject): TextUsage {
  const usage = asObject(body.usage);
  const input = integerProperty(usage, "input_tokens");
  const cached = integerProperty(
    asObject(usage?.input_tokens_details),
    "cached_tokens",
  );
  return {
    // OpenAI counts cached tokens inside input_tokens; split them for pricing.
    inputTokens: input === null ? null : input - (cached ?? 0),
    outputTokens: integerProperty(usage, "output_tokens"),
    cacheReadTokens: cached ?? 0,
    cacheWriteTokens: 0,
  };
}

function responseOutputText(body: JsonObject): string | undefined {
  if (typeof body.output_text === "string") return body.output_text;
  if (!Array.isArray(body.output)) return undefined;
  const parts: string[] = [];
  for (const output of body.output) {
    const item = asObject(output);
    if (!item || !Array.isArray(item.content)) continue;
    for (const content of item.content) {
      const part = asObject(content);
      if (part?.type === "output_text" && typeof part.text === "string") {
        parts.push(part.text);
      }
    }
  }
  return parts.length > 0 ? parts.join("") : undefined;
}
