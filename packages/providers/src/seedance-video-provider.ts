import type { VideoProviderStatus } from "@ai-film-studio/contracts";

import {
  type VideoProvider,
  VideoProviderConfigurationError,
  VideoProviderResponseError,
  VideoProviderUnavailableError,
  type VideoProviderResult,
  type VideoSubmission,
} from "./video-provider.js";

export type SeedanceVideoProviderConfig = {
  apiKey?: string;
  baseUrl: string;
  model: string;
  requestTimeoutMs: number;
  estimatedUsdPerSecond: number;
};

export function resolveSeedanceVideoProviderConfig(): SeedanceVideoProviderConfig {
  return {
    apiKey:
      process.env.SEEDANCE_API_KEY?.trim() ||
      process.env.LAS_API_KEY?.trim() ||
      undefined,
    baseUrl:
      process.env.SEEDANCE_BASE_URL?.trim() ||
      "https://operator.las.ap-southeast-1.bytepluses.com/api/v1/contents/generations/tasks",
    model:
      process.env.SEEDANCE_VIDEO_MODEL?.trim() ||
      "dreamina-seedance-2-0-260128",
    requestTimeoutMs: positiveInteger(
      process.env.SEEDANCE_VIDEO_TIMEOUT_MS,
      30_000,
    ),
    estimatedUsdPerSecond: nonNegativeNumber(
      process.env.SEEDANCE_ESTIMATED_USD_PER_SECOND,
      0.303,
    ),
  };
}

export class SeedanceVideoProvider implements VideoProvider {
  readonly id = "seedance" as const;

  constructor(
    private readonly config: SeedanceVideoProviderConfig,
    private readonly request: typeof fetch = fetch,
  ) {}

  status(): VideoProviderStatus {
    const rates = {
      "720p": this.config.estimatedUsdPerSecond,
      "1080p": null,
      "4k": null,
    };
    return {
      id: this.id,
      label: "Seedance 2.0",
      configured: Boolean(this.config.apiKey),
      defaultModel: this.config.model,
      models: [
        {
          id: this.config.model,
          label: "Seedance 2.0",
          supportedResolutions: ["720p"],
          supportedDurationsSeconds: Array.from(
            { length: 12 },
            (_, index) => index + 4,
          ),
          supportsNativeAudio: true,
          estimatedUsdPerSecond: {
            withoutAudio: rates,
            withAudio: rates,
          },
          pricingMessage:
            "Estimate uses BytePlus's documented enhanced Seedance 2.0 720p image-to-video rate; the provider bill remains authoritative.",
          continuityMessage:
            "The approved storyboard image is attached as the first frame.",
          warning:
            "Seedance 2.x does not accept direct reference images containing real human faces unless your BytePlus account has the authorized material-library feature.",
        },
      ],
    };
  }

  async submit(input: VideoSubmission): Promise<{ jobId: string }> {
    const apiKey = this.requireApiKey();
    if (input.model !== this.config.model) {
      throw new VideoProviderConfigurationError(
        `Unsupported Seedance model: ${input.model}.`,
      );
    }
    if (input.resolution !== "720p") {
      throw new VideoProviderConfigurationError(
        "Seedance image-to-video is configured for supported 720p output.",
      );
    }
    if (input.durationSeconds < 4 || input.durationSeconds > 15) {
      throw new VideoProviderConfigurationError(
        "Seedance 2.0 video duration must be between 4 and 15 seconds.",
      );
    }
    const body = await this.jsonRequest(this.config.baseUrl, apiKey, {
      method: "POST",
      body: JSON.stringify({
        model: input.model,
        content: [
          { type: "text", text: input.prompt },
          {
            type: "image_url",
            image_url: { url: input.firstFrameDataUrl },
            role: "first_frame",
          },
        ],
        generate_audio: input.generateAudio,
        resolution: input.resolution,
        ratio: input.aspectRatio,
        duration: input.durationSeconds,
        watermark: false,
      }),
    });
    const jobId = stringValue(body, "id");
    if (!jobId) {
      throw new VideoProviderResponseError(
        providerMessage("Seedance did not return a task ID.", body),
      );
    }
    return { jobId };
  }

  async poll(jobId: string): Promise<VideoProviderResult> {
    const apiKey = this.requireApiKey();
    const body = await this.jsonRequest(
      `${this.config.baseUrl}/${encodeURIComponent(jobId)}`,
      apiKey,
      { method: "GET" },
    );
    const rawStatus = stringValue(body, "status");
    if (!rawStatus) {
      throw new VideoProviderResponseError(
        providerMessage("Seedance did not return a task status.", body),
      );
    }
    const status = normalizeStatus(rawStatus);
    const content = objectValue(body, "content");
    const resultUrl = stringValue(content, "video_url");
    const error = objectValue(body, "error");
    return {
      status,
      resultUrl: resultUrl ?? null,
      resultMimeType: resultUrl ? "video/mp4" : null,
      errorMessage:
        status === "failed"
          ? stringValue(error, "message") ||
            stringValue(error, "code") ||
            "Seedance video generation failed."
          : null,
      resultExpiresAt:
        status === "succeeded"
          ? new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
          : null,
      actualCostMicros: null,
    };
  }

  private requireApiKey(): string {
    if (!this.config.apiKey) {
      throw new VideoProviderConfigurationError(
        "Seedance is not configured. Add SEEDANCE_API_KEY to .env.local and restart the API.",
      );
    }
    return this.config.apiKey;
  }

  private async jsonRequest(
    url: string,
    apiKey: string,
    init: RequestInit,
  ): Promise<Record<string, unknown>> {
    let response: Response;
    try {
      response = await this.request(url, {
        ...init,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        signal: AbortSignal.timeout(this.config.requestTimeoutMs),
      });
    } catch (error) {
      throw new VideoProviderUnavailableError(
        "Seedance could not be reached. Check the network and try again.",
        { cause: error },
      );
    }
    const body = (await response.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    if (!response.ok) {
      throw new VideoProviderResponseError(
        providerMessage(`Seedance returned HTTP ${response.status}.`, body),
      );
    }
    return body;
  }
}

function normalizeStatus(value: string): VideoProviderResult["status"] {
  if (value === "succeeded") return "succeeded";
  if (["failed", "cancelled", "expired"].includes(value)) return "failed";
  if (value === "running") return "processing";
  return "submitted";
}

function providerMessage(
  fallback: string,
  body: Record<string, unknown>,
): string {
  const error = objectValue(body, "error");
  const message =
    stringValue(error, "message") ||
    stringValue(body, "message") ||
    stringValue(body, "error");
  return message ? `${fallback} ${message}` : fallback;
}

function objectValue(
  value: unknown,
  key: string,
): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const candidate = (value as Record<string, unknown>)[key];
  return typeof candidate === "object" &&
    candidate !== null &&
    !Array.isArray(candidate)
    ? (candidate as Record<string, unknown>)
    : undefined;
}

function stringValue(value: unknown, key: string): string | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const candidate = (value as Record<string, unknown>)[key];
  return typeof candidate === "string" ? candidate : undefined;
}

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function nonNegativeNumber(
  value: string | undefined,
  fallback: number,
): number {
  if (!value?.trim()) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}
