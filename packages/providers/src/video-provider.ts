import type {
  VideoProviderId,
  VideoProviderStatus,
  VideoResolution,
} from "@ai-film-studio/contracts";

export type VideoSubmission = {
  prompt: string;
  firstFrameDataUrl: string;
  firstFrameMimeType: "image/jpeg" | "image/png" | "image/webp";
  aspectRatio: "9:16" | "16:9" | "1:1";
  durationSeconds: number;
  resolution: VideoResolution;
  generateAudio: boolean;
  externalTaskId: string;
};

export type VideoProviderResult = {
  status: "submitted" | "processing" | "succeeded" | "failed";
  resultUrl: string | null;
  resultMimeType: "video/mp4" | "video/quicktime" | "video/webm" | null;
  errorMessage: string | null;
  resultExpiresAt: string | null;
  actualCostMicros: number | null;
};

export interface VideoProvider {
  readonly id: VideoProviderId;
  status(): VideoProviderStatus;
  submit(input: VideoSubmission): Promise<{ jobId: string }>;
  poll(jobId: string): Promise<VideoProviderResult>;
}

export class VideoProviderConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VideoProviderConfigurationError";
  }
}

export class VideoProviderUnavailableError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "VideoProviderUnavailableError";
  }
}

export class VideoProviderResponseError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "VideoProviderResponseError";
  }
}
