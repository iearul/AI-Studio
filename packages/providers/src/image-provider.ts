import type { ImageProviderStatus } from "@ai-film-studio/contracts";

export type ImageProviderReference = {
  filename: string;
  mimeType: string;
  buffer: Buffer;
};

export type ImageProviderRequest = {
  prompt: string;
  negativePrompt: string;
  seed: number;
  width: number;
  height: number;
  filenamePrefix: string;
  references: ImageProviderReference[];
};

export type ImageProviderProgress = {
  status: "preparing" | "generating" | "downloading";
  progress: number;
  providerJobId?: string;
};

export type GeneratedImage = {
  buffer: Buffer;
  filename: string;
  mimeType: string;
  providerJobId: string;
};

export interface ImageProvider {
  getStatus(): Promise<ImageProviderStatus>;
  generate(
    request: ImageProviderRequest,
    onProgress: (progress: ImageProviderProgress) => void | Promise<void>,
  ): Promise<GeneratedImage>;
}

export class ImageProviderConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImageProviderConfigurationError";
  }
}

export class ImageProviderUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImageProviderUnavailableError";
  }
}
