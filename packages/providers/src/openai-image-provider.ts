import {
  imageProviderStatusSchema,
  type ImageProviderModel,
  type ImageProviderStatus,
} from "@ai-studio/contracts";

import {
  ImageProviderConfigurationError,
  ImageProviderResponseError,
  ImageProviderUnavailableError,
  usdToMicros,
  type GeneratedImage,
  type ImageAspectRatio,
  type ImageGenerationInput,
  type ImageProvider,
} from "./image-provider.js";
import { positiveIntegerEnvironment } from "./text-provider.js";

export type OpenAiImageProviderConfig = {
  apiKey: string | null;
  defaultModel: string;
  timeoutMs: number;
};

type Dependencies = { fetch: typeof fetch };
type JsonObject = Record<string, unknown>;

// Official GPT Image token rates (USD per 1M tokens), shared by GPT Image 2 and 2.5.
const textInputUsdPerMillion = 5;
const imageInputUsdPerMillion = 8;
const imageOutputUsdPerMillion = 30;

// Exact-ratio sizes; every edge is a multiple of 16 as the API requires.
const sizes: Record<ImageAspectRatio, string> = {
  "9:16": "864x1536",
  "16:9": "1536x864",
  "1:1": "1024x1024",
  "4:5": "1024x1280",
};

const qualities = [
  { id: "low", label: "Draft", estimatedUsdPerImage: 0.01 },
  { id: "medium", label: "Standard", estimatedUsdPerImage: 0.02 },
  { id: "high", label: "High", estimatedUsdPerImage: 0.07 },
];

const knownModels = [
  { id: "gpt-image-2.5-sunburst", label: "GPT Image 2.5 Sunburst" },
  { id: "gpt-image-2.5-flare", label: "GPT Image 2.5 Flare" },
];

export function resolveOpenAiImageProviderConfig(): OpenAiImageProviderConfig {
  return {
    apiKey: process.env.OPENAI_API_KEY?.trim() || null,
    defaultModel:
      process.env.OPENAI_IMAGE_MODEL?.trim() || "gpt-image-2.5-sunburst",
    timeoutMs: positiveIntegerEnvironment(
      "OPENAI_IMAGE_TIMEOUT_MS",
      300_000,
      10_000,
      900_000,
    ),
  };
}

export class OpenAiImageProvider implements ImageProvider {
  readonly id = "openai" as const;
  readonly maxReferenceBytes = 40 * 1024 * 1024;

  constructor(
    readonly config: OpenAiImageProviderConfig,
    private readonly dependencies: Dependencies = { fetch },
  ) {}

  status(): ImageProviderStatus {
    const models = knownModels.some(
      (model) => model.id === this.config.defaultModel,
    )
      ? knownModels
      : [
          { id: this.config.defaultModel, label: this.config.defaultModel },
          ...knownModels,
        ];
    return imageProviderStatusSchema.parse({
      id: this.id,
      label: "OpenAI GPT Image",
      configured: Boolean(this.config.apiKey),
      message: this.config.apiKey
        ? "Ready. Images use separately billed OpenAI API tokens."
        : "Add OPENAI_API_KEY to .env.local and restart AI Studio.",
      defaultModel: this.config.defaultModel,
      models: models.map((model): ImageProviderModel => ({
        ...model,
        qualities,
        maxReferenceImages: 16,
        pricingMessage:
          "Billed by tokens: $5/M prompt text, $8/M reference photos, $30/M image output. Each reference photo adds roughly $0.01; the exact cost is recorded after generation.",
      })),
    });
  }

  async generate(input: ImageGenerationInput): Promise<GeneratedImage> {
    if (!this.config.apiKey) {
      throw new ImageProviderConfigurationError(
        "OPENAI_API_KEY is required for OpenAI image generation.",
      );
    }
    const fields = {
      model: input.model,
      prompt: input.prompt,
      size: sizes[input.aspectRatio],
      quality: input.quality,
      n: "1",
      output_format: "png",
    };
    let response: Response;
    try {
      if (input.references.length === 0) {
        response = await this.dependencies.fetch(
          "https://api.openai.com/v1/images/generations",
          {
            method: "POST",
            headers: {
              authorization: `Bearer ${this.config.apiKey}`,
              "content-type": "application/json",
            },
            body: JSON.stringify({ ...fields, n: 1 }),
            signal: AbortSignal.timeout(this.config.timeoutMs),
          },
        );
      } else {
        // Reference photos go to the edits endpoint as repeated image[] parts.
        const form = new FormData();
        for (const [name, value] of Object.entries(fields)) {
          form.append(name, value);
        }
        for (const reference of input.references) {
          form.append(
            "image[]",
            new Blob([new Uint8Array(reference.data)], {
              type: reference.mimeType,
            }),
            reference.filename,
          );
        }
        response = await this.dependencies.fetch(
          "https://api.openai.com/v1/images/edits",
          {
            method: "POST",
            headers: { authorization: `Bearer ${this.config.apiKey}` },
            body: form,
            signal: AbortSignal.timeout(this.config.timeoutMs),
          },
        );
      }
    } catch (error) {
      throw new ImageProviderUnavailableError(
        error instanceof DOMException && error.name === "TimeoutError"
          ? "OpenAI image generation timed out."
          : "OpenAI could not be reached.",
      );
    }
    if (!response.ok) {
      throw new ImageProviderUnavailableError(
        await openAiImageHttpMessage(response),
      );
    }
    const body = asObject(await safeJson(response));
    const first = Array.isArray(body?.data) ? asObject(body.data[0]) : null;
    if (!body || typeof first?.b64_json !== "string") {
      throw new ImageProviderResponseError(
        "OpenAI completed without returning an image.",
      );
    }
    return {
      data: Buffer.from(first.b64_json, "base64"),
      model: typeof body.model === "string" ? body.model : input.model,
      costMicros: costFromUsage(asObject(body.usage)) ?? fallbackCost(input),
    };
  }
}

function costFromUsage(usage: JsonObject | undefined): number | null {
  const outputTokens = tokenCount(usage, "output_tokens");
  if (outputTokens === null) return null;
  const details = asObject(usage?.input_tokens_details);
  const imageTokens = tokenCount(details, "image_tokens") ?? 0;
  const textTokens =
    tokenCount(details, "text_tokens") ??
    Math.max(0, (tokenCount(usage, "input_tokens") ?? 0) - imageTokens);
  return usdToMicros(
    (textTokens * textInputUsdPerMillion +
      imageTokens * imageInputUsdPerMillion +
      outputTokens * imageOutputUsdPerMillion) /
      1_000_000,
  );
}

function fallbackCost(input: ImageGenerationInput): number {
  const quality = qualities.find((candidate) => candidate.id === input.quality);
  return usdToMicros(
    (quality?.estimatedUsdPerImage ?? 0) + input.references.length * 0.01,
  );
}

async function openAiImageHttpMessage(response: Response): Promise<string> {
  if (response.status === 401 || response.status === 403) {
    return "OpenAI rejected the configured API key or project permissions.";
  }
  if (response.status === 429) {
    return "OpenAI rate limits or API billing quota prevented image generation.";
  }
  const error = asObject(asObject(await safeJson(response))?.error);
  if (error?.code === "moderation_blocked") {
    return "OpenAI's safety system rejected this prompt or a reference photo. Adjust the description and try again.";
  }
  if (response.status === 404) {
    return "The selected OpenAI image model is not available to this API project.";
  }
  if (response.status === 400 && typeof error?.message === "string") {
    return `OpenAI rejected the image request: ${error.message.slice(0, 300)}`;
  }
  return `OpenAI image generation returned HTTP ${response.status}.`;
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

function tokenCount(
  object: JsonObject | undefined,
  name: string,
): number | null {
  const value = object?.[name];
  return typeof value === "number" && Number.isInteger(value) && value >= 0
    ? value
    : null;
}
