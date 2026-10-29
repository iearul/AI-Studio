import type {
  CloudImageProviderId,
  ImageProviderStatus,
} from "@ai-studio/contracts";

export type ImageAspectRatio = "9:16" | "16:9" | "1:1" | "4:5";

export type ImageReferenceInput = {
  filename: string;
  mimeType: "image/jpeg" | "image/png" | "image/webp";
  data: Buffer;
};

export type ImageGenerationInput = {
  model: string;
  quality: string;
  prompt: string;
  aspectRatio: ImageAspectRatio;
  references: ImageReferenceInput[];
};

export type GeneratedImage = {
  data: Buffer;
  model: string;
  costMicros: number;
};

export interface ImageProvider {
  readonly id: CloudImageProviderId;
  /** Largest combined size of reference photos sent in one request. */
  readonly maxReferenceBytes: number;
  status(): ImageProviderStatus;
  generate(input: ImageGenerationInput): Promise<GeneratedImage>;
}

export class ImageProviderConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImageProviderConfigurationError";
  }
}

export class ImageProviderUnavailableError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ImageProviderUnavailableError";
  }
}

export class ImageProviderResponseError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ImageProviderResponseError";
  }
}

export function usdToMicros(usd: number): number {
  return Math.max(0, Math.round(usd * 1_000_000));
}
