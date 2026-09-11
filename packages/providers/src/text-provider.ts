import type {
  AutomaticStoryProviderId,
  StoryGenerationUsage,
  StoryProviderStatus,
} from "@ai-film-studio/contracts";

export type TextGenerationRequest = {
  prompt: string;
  schemaName: string;
  schema: Record<string, unknown>;
};

export type GeneratedText = {
  output: unknown;
  model: string;
  usage: StoryGenerationUsage;
};

export interface TextProvider {
  readonly id: AutomaticStoryProviderId;
  getStatus(): Promise<StoryProviderStatus>;
  generate(request: TextGenerationRequest): Promise<GeneratedText>;
}

export class TextProviderConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TextProviderConfigurationError";
  }
}

export class TextProviderUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TextProviderUnavailableError";
  }
}

export class TextProviderResponseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TextProviderResponseError";
  }
}

export function parseGeneratedJson(value: string): unknown {
  const trimmed = value.trim();
  const unfenced = trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
  try {
    return JSON.parse(unfenced) as unknown;
  } catch {
    const start = unfenced.indexOf("{");
    const end = unfenced.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(unfenced.slice(start, end + 1)) as unknown;
      } catch {
        // Use the stable provider-facing error below.
      }
    }
    throw new TextProviderResponseError(
      "The model returned text that was not valid JSON. Try generating again.",
    );
  }
}

export function positiveIntegerEnvironment(
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new TextProviderConfigurationError(
      `${name} must be between ${minimum} and ${maximum}.`,
    );
  }
  return value;
}
