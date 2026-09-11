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
    if (!this.config.apiKey) {
      throw new TextProviderConfigurationError(
        "OPENAI_API_KEY is required for OpenAI story generation.",
      );
    }
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
            model: this.config.model,
            store: false,
            input: request.prompt,
            max_output_tokens: 32_768,
            text: {
              format: {
                type: "json_schema",
                name: request.schemaName,
                strict: true,
                schema: request.schema,
              },
            },
          }),
          signal: AbortSignal.timeout(this.config.timeoutMs),
        },
      );
    } catch (error) {
      throw new TextProviderUnavailableError(
        error instanceof DOMException && error.name === "TimeoutError"
          ? "OpenAI story generation timed out."
          : "OpenAI could not be reached.",
      );
    }
    if (!response.ok) {
      throw new TextProviderUnavailableError(
        openAiHttpMessage(response.status, "generation"),
      );
    }
    const body = asObject(await safeJson(response));
    if (!body) {
      throw new TextProviderResponseError(
        "OpenAI returned an invalid response.",
      );
    }
    const outputText = responseOutputText(body);
    if (!outputText) {
      throw new TextProviderResponseError(
        "OpenAI completed without returning a story plan.",
      );
    }
    const usage = asObject(body.usage);
    return {
      output: parseGeneratedJson(outputText),
      model: typeof body.model === "string" ? body.model : this.config.model,
      usage: {
        inputTokens: integerProperty(usage, "input_tokens"),
        outputTokens: integerProperty(usage, "output_tokens"),
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
