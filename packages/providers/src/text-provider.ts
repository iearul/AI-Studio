import type {
  AutomaticStoryProviderId,
  StoryGenerationUsage,
  StoryProviderStatus,
} from "@ai-studio/contracts";

export type TextEffort = "low" | "medium" | "high" | "xhigh" | "max";

/** Options shared by structured and prose requests; all are optional. */
export type TextRequestOptions = {
  /** Replaces the provider's default instruction. */
  system?: string;
  /** Stable context reused across calls; providers cache it when they can. */
  cachedContext?: string;
  /** Overrides the model configured in `.env.local`. */
  model?: string;
  /** Claude thinking effort; ignored by other providers. */
  effort?: TextEffort;
  maxOutputTokens?: number;
  /** Cancels the request; the provider throws TextProviderAbortedError. */
  signal?: AbortSignal;
};

export type TextGenerationRequest = TextRequestOptions & {
  prompt: string;
  schemaName: string;
  schema: Record<string, unknown>;
};

export type TextCompletionRequest = TextRequestOptions & { prompt: string };

export type TextUsage = StoryGenerationUsage & {
  cacheReadTokens?: number | null;
  cacheWriteTokens?: number | null;
};

export type GeneratedText = {
  output: unknown;
  model: string;
  usage: TextUsage;
};

export type GeneratedProse = {
  text: string;
  model: string;
  usage: TextUsage;
  /** The output limit cut the text off. */
  truncated: boolean;
};

export interface TextProvider {
  readonly id: AutomaticStoryProviderId;
  /** The model from `.env.local`, used when a request names none. */
  readonly defaultModel?: string | null;
  getStatus(): Promise<StoryProviderStatus>;
  generate(request: TextGenerationRequest): Promise<GeneratedText>;
  /** Free-form prose; used for long-form writing. */
  complete?(request: TextCompletionRequest): Promise<GeneratedProse>;
}

export class TextProviderConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TextProviderConfigurationError";
  }
}

export class TextProviderUnavailableError extends Error {
  /** Timeouts, rate limits, overload and 5xx are worth retrying. */
  readonly retryable: boolean;
  readonly retryAfterMs: number | null;
  readonly status: number | null;

  constructor(
    message: string,
    options: {
      retryable?: boolean;
      retryAfterMs?: number | null;
      status?: number | null;
    } = {},
  ) {
    super(message);
    this.name = "TextProviderUnavailableError";
    this.retryable = options.retryable ?? true;
    this.retryAfterMs = options.retryAfterMs ?? null;
    this.status = options.status ?? null;
  }
}

export class TextProviderAbortedError extends Error {
  constructor() {
    super("The request was cancelled.");
    this.name = "TextProviderAbortedError";
  }
}

/** Combines a caller's cancellation signal with the provider timeout. */
export function requestSignal(
  timeoutMs: number,
  signal: AbortSignal | undefined,
): { signal: AbortSignal; timeout: AbortSignal } {
  const timeout = AbortSignal.timeout(timeoutMs);
  return {
    signal: signal ? AbortSignal.any([timeout, signal]) : timeout,
    timeout,
  };
}

/** HTTP statuses that will not succeed on retry. */
export function isPermanentHttpStatus(status: number): boolean {
  return (
    status === 400 ||
    status === 401 ||
    status === 403 ||
    status === 404 ||
    status === 422
  );
}

export function parseRetryAfter(
  value: string | null | undefined,
): number | null {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(value);
  return Number.isNaN(date) ? null : Math.max(0, date - Date.now());
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
