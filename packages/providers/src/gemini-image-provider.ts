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
  type ImageGenerationInput,
  type ImageProvider,
} from "./image-provider.js";
import { positiveIntegerEnvironment } from "./text-provider.js";

export type GeminiImageProviderConfig = {
  apiKey: string | null;
  defaultModel: string;
  timeoutMs: number;
};

type Dependencies = { fetch: typeof fetch };
type JsonObject = Record<string, unknown>;

type GeminiModelPricing = {
  id: string;
  label: string;
  inputUsdPerMillion: number;
  imageUsd: { "1K": number; "2K": number };
  maxReferenceImages: number;
};

// Official paid-tier prices: output per image size plus input tokens.
const knownModels: GeminiModelPricing[] = [
  {
    id: "gemini-nano-banana-2.1",
    label: "Nano Banana 2.1",
    inputUsdPerMillion: 1.5,
    imageUsd: { "1K": 0.0336, "2K": 0.0504 },
    maxReferenceImages: 10,
  },
  {
    id: "gemini-3-pro-image",
    label: "Nano Banana Pro",
    inputUsdPerMillion: 2,
    imageUsd: { "1K": 0.134, "2K": 0.134 },
    maxReferenceImages: 6,
  },
];

const imageSizes = ["1K", "2K"] as const;

export function resolveGeminiImageProviderConfig(): GeminiImageProviderConfig {
  return {
    apiKey: process.env.GEMINI_API_KEY?.trim() || null,
    defaultModel:
      process.env.GEMINI_IMAGE_MODEL?.trim() || "gemini-nano-banana-2.1",
    timeoutMs: positiveIntegerEnvironment(
      "GEMINI_IMAGE_TIMEOUT_MS",
      300_000,
      10_000,
      900_000,
    ),
  };
}

export class GeminiImageProvider implements ImageProvider {
  readonly id = "gemini" as const;
  // Inline base64 grows by a third; this keeps the JSON body near 19 MB.
  readonly maxReferenceBytes = 14 * 1024 * 1024;

  constructor(
    readonly config: GeminiImageProviderConfig,
    private readonly dependencies: Dependencies = { fetch },
  ) {}

  status(): ImageProviderStatus {
    const models = knownModels.some(
      (model) => model.id === this.config.defaultModel,
    )
      ? knownModels
      : [unknownModel(this.config.defaultModel), ...knownModels];
    return imageProviderStatusSchema.parse({
      id: this.id,
      label: "Google Gemini",
      configured: Boolean(this.config.apiKey),
      message: this.config.apiKey
        ? "Ready. Images are billed to your Google AI Studio project."
        : "Add GEMINI_API_KEY from Google AI Studio to .env.local and restart AI Studio.",
      defaultModel: this.config.defaultModel,
      models: models.map((model): ImageProviderModel => ({
        id: model.id,
        label: model.label,
        qualities: [
          {
            id: "1K",
            label: "Standard (1K)",
            estimatedUsdPerImage: model.imageUsd["1K"],
          },
          {
            id: "2K",
            label: "High (2K)",
            estimatedUsdPerImage: model.imageUsd["2K"],
          },
        ],
        maxReferenceImages: model.maxReferenceImages,
        pricingMessage:
          model.imageUsd["1K"] > 0
            ? `Billed per image by size, plus $${model.inputUsdPerMillion}/M input tokens for the prompt and reference photos. The cost recorded after generation is an estimate; Google AI Studio shows the final bill.`
            : "Pricing for this model is not built in. Check Google AI Studio for the cost.",
      })),
    });
  }

  async generate(input: ImageGenerationInput): Promise<GeneratedImage> {
    if (!this.config.apiKey) {
      throw new ImageProviderConfigurationError(
        "GEMINI_API_KEY is required for Gemini image generation.",
      );
    }
    const imageSize = imageSizes.find((size) => size === input.quality);
    if (!imageSize) {
      throw new ImageProviderConfigurationError(
        `Gemini image size must be one of ${imageSizes.join(", ")}.`,
      );
    }
    let response: Response;
    try {
      response = await this.dependencies.fetch(
        "https://generativelanguage.googleapis.com/v1beta/interactions",
        {
          method: "POST",
          headers: {
            "x-goog-api-key": this.config.apiKey,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            model: input.model,
            input: [
              { type: "text", text: input.prompt },
              ...input.references.map((reference) => ({
                type: "image",
                mime_type: reference.mimeType,
                data: reference.data.toString("base64"),
              })),
            ],
            response_format: {
              type: "image",
              mime_type: "image/png",
              aspect_ratio: input.aspectRatio,
              image_size: imageSize,
            },
            // Keep prompts and reference photos out of Google's interaction store.
            store: false,
          }),
          signal: AbortSignal.timeout(this.config.timeoutMs),
        },
      );
    } catch (error) {
      throw new ImageProviderUnavailableError(
        error instanceof DOMException && error.name === "TimeoutError"
          ? "Gemini image generation timed out."
          : "Gemini could not be reached.",
      );
    }
    if (!response.ok) {
      throw new ImageProviderUnavailableError(
        await geminiHttpMessage(response),
      );
    }
    const body = asObject(await safeJson(response));
    if (!body) {
      throw new ImageProviderResponseError(
        "Gemini returned an invalid response.",
      );
    }
    if (typeof body.status === "string" && body.status !== "completed") {
      throw new ImageProviderResponseError(
        `Gemini image generation ended as ${body.status}.${errorDetail(body)}`,
      );
    }
    const { image, text } = outputContent(body);
    if (!image) {
      throw new ImageProviderResponseError(
        `Gemini returned no image; it may have declined the prompt or a reference photo.${text ? ` Gemini said: ${text.slice(0, 300)}` : ""}`,
      );
    }
    return {
      data: Buffer.from(image, "base64"),
      model: typeof body.model === "string" ? body.model : input.model,
      costMicros: estimateCost(input.model, imageSize, asObject(body.usage)),
    };
  }
}

function unknownModel(id: string): GeminiModelPricing {
  return {
    id,
    label: id,
    inputUsdPerMillion: 0,
    imageUsd: { "1K": 0, "2K": 0 },
    maxReferenceImages: 6,
  };
}

function estimateCost(
  model: string,
  imageSize: (typeof imageSizes)[number],
  usage: JsonObject | undefined,
): number {
  const pricing = knownModels.find((candidate) => candidate.id === model);
  if (!pricing) return 0;
  const inputTokens = usage?.total_input_tokens;
  return usdToMicros(
    pricing.imageUsd[imageSize] +
      (typeof inputTokens === "number" && inputTokens > 0
        ? (inputTokens * pricing.inputUsdPerMillion) / 1_000_000
        : 0),
  );
}

function outputContent(body: JsonObject): { image?: string; text?: string } {
  let image: string | undefined;
  const texts: string[] = [];
  for (const step of Array.isArray(body.steps) ? body.steps : []) {
    const stepObject = asObject(step);
    if (stepObject?.type !== "model_output") continue;
    for (const block of Array.isArray(stepObject.content)
      ? stepObject.content
      : []) {
      const content = asObject(block);
      // Later images replace interim ones; the final image is the result.
      if (content?.type === "image" && typeof content.data === "string") {
        image = content.data;
      } else if (content?.type === "text" && typeof content.text === "string") {
        texts.push(content.text);
      }
    }
  }
  const outputImage = asObject(body.output_image);
  if (!image && typeof outputImage?.data === "string") {
    image = outputImage.data;
  }
  return { image, text: texts.join(" ").trim() || undefined };
}

function errorDetail(body: JsonObject): string {
  const first = Array.isArray(body.errors) ? asObject(body.errors[0]) : null;
  return typeof first?.message === "string"
    ? ` ${first.message.slice(0, 300)}`
    : "";
}

async function geminiHttpMessage(response: Response): Promise<string> {
  const error = asObject(asObject(await safeJson(response))?.error);
  const message = typeof error?.message === "string" ? error.message : "";
  if (
    response.status === 401 ||
    response.status === 403 ||
    message.toLowerCase().includes("api key")
  ) {
    return "Google rejected the configured GEMINI_API_KEY or its project permissions.";
  }
  if (response.status === 404) {
    return "The selected Gemini image model is not available to this API key.";
  }
  if (response.status === 429) {
    return "Gemini rate limits or billing quota prevented image generation.";
  }
  if (response.status === 400 && message) {
    return `Gemini rejected the image request: ${message.slice(0, 300)}`;
  }
  return `Gemini image generation returned HTTP ${response.status}.`;
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
