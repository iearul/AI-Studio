import type {
  VideoProviderModel,
  VideoProviderStatus,
} from "@ai-studio/contracts";

import {
  type VideoProvider,
  VideoProviderConfigurationError,
  VideoProviderResponseError,
  VideoProviderUnavailableError,
  type VideoProviderResult,
  type VideoSubmission,
} from "./video-provider.js";

export type VeoVideoProviderConfig = {
  apiKey?: string;
  baseUrl: string;
  defaultModel: string;
  requestTimeoutMs: number;
};

type JsonObject = Record<string, unknown>;

const continuityMessage =
  "The approved storyboard image is sent as the first frame. Veo does not take separate character or location reference photos with a starting frame.";
const audioWarning =
  "Veo 3.1 always generates sound with the clip, so the audio switch has no effect. Clips are 4, 6, or 8 seconds; 1080p and 4K are 8 seconds only. Veo supports 16:9 and 9:16 projects.";

// Gemini API prices (USD per second), sound included, September 2026.
const veoModels: VideoProviderModel[] = [
  {
    id: "veo-3.1-fast-generate-preview",
    label: "Veo 3.1 Fast",
    supportedResolutions: ["720p", "1080p", "4k"],
    supportedDurationsSeconds: [4, 6, 8],
    durationsByResolution: { "1080p": [8], "4k": [8] },
    supportsNativeAudio: true,
    estimatedUsdPerSecond: {
      withoutAudio: { "720p": 0.1, "1080p": 0.12, "4k": 0.3 },
      withAudio: { "720p": 0.1, "1080p": 0.12, "4k": 0.3 },
    },
    pricingMessage:
      "Estimate uses Google's Veo 3.1 Fast rates: $0.10/s at 720p, $0.12/s at 1080p, $0.30/s at 4K, sound included.",
    continuityMessage,
    warning: audioWarning,
  },
  {
    id: "veo-3.1-generate-preview",
    label: "Veo 3.1",
    supportedResolutions: ["720p", "1080p", "4k"],
    supportedDurationsSeconds: [4, 6, 8],
    durationsByResolution: { "1080p": [8], "4k": [8] },
    supportsNativeAudio: true,
    estimatedUsdPerSecond: {
      withoutAudio: { "720p": 0.4, "1080p": 0.4, "4k": 0.6 },
      withAudio: { "720p": 0.4, "1080p": 0.4, "4k": 0.6 },
    },
    pricingMessage:
      "Estimate uses Google's Veo 3.1 rates: $0.40/s at 720p or 1080p, $0.60/s at 4K, sound included.",
    continuityMessage,
    warning: audioWarning,
  },
  {
    id: "veo-3.1-lite-generate-preview",
    label: "Veo 3.1 Lite",
    supportedResolutions: ["720p", "1080p"],
    supportedDurationsSeconds: [4, 6, 8],
    durationsByResolution: { "1080p": [8] },
    supportsNativeAudio: true,
    estimatedUsdPerSecond: {
      withoutAudio: { "720p": 0.05, "1080p": 0.08, "4k": null },
      withAudio: { "720p": 0.05, "1080p": 0.08, "4k": null },
    },
    pricingMessage:
      "Estimate uses Google's Veo 3.1 Lite rates: $0.05/s at 720p or $0.08/s at 1080p, sound included.",
    continuityMessage,
    warning: audioWarning,
  },
];

// Google keeps generated videos for two days.
const resultLifetimeMs = 2 * 24 * 60 * 60 * 1000;

export function resolveVeoVideoProviderConfig(): VeoVideoProviderConfig {
  const requested = process.env.VEO_VIDEO_MODEL?.trim();
  const timeout = Number(process.env.VEO_VIDEO_TIMEOUT_MS ?? 60_000);
  return {
    apiKey: process.env.GEMINI_API_KEY?.trim() || undefined,
    baseUrl: "https://generativelanguage.googleapis.com",
    defaultModel: veoModels.some((model) => model.id === requested)
      ? requested!
      : "veo-3.1-fast-generate-preview",
    requestTimeoutMs:
      Number.isInteger(timeout) && timeout > 0 ? timeout : 60_000,
  };
}

export class VeoVideoProvider implements VideoProvider {
  readonly id = "veo" as const;

  constructor(
    private readonly config: VeoVideoProviderConfig,
    private readonly request: typeof fetch = fetch,
  ) {}

  status(): VideoProviderStatus {
    return {
      id: this.id,
      label: "Google Veo",
      configured: Boolean(this.config.apiKey),
      defaultModel: this.config.defaultModel,
      models: veoModels,
    };
  }

  async submit(input: VideoSubmission): Promise<{ jobId: string }> {
    const apiKey = this.requireApiKey();
    const model = veoModels.find((candidate) => candidate.id === input.model);
    if (!model) {
      throw new VideoProviderConfigurationError(
        `Unsupported Veo model: ${input.model}.`,
      );
    }
    if (input.aspectRatio === "1:1") {
      throw new VideoProviderConfigurationError(
        "Veo supports 16:9 and 9:16 videos, but this project is 1:1.",
      );
    }
    const durations =
      model.durationsByResolution?.[input.resolution] ??
      model.supportedDurationsSeconds;
    if (
      !model.supportedResolutions.includes(input.resolution) ||
      !durations.includes(input.durationSeconds)
    ) {
      throw new VideoProviderConfigurationError(
        `${model.label} does not support ${input.durationSeconds}s at ${input.resolution}.`,
      );
    }
    const base64 = input.firstFrameDataUrl.split(",", 2)[1] ?? "";
    const body = await this.jsonRequest(
      `${this.config.baseUrl}/v1beta/models/${encodeURIComponent(model.id)}:predictLongRunning`,
      apiKey,
      {
        method: "POST",
        body: JSON.stringify({
          instances: [
            {
              prompt: input.prompt,
              image: {
                inlineData: {
                  mimeType: input.firstFrameMimeType,
                  data: base64,
                },
              },
            },
          ],
          parameters: {
            aspectRatio: input.aspectRatio,
            resolution: input.resolution,
            durationSeconds: String(input.durationSeconds),
            personGeneration: "allow_adult",
            numberOfVideos: 1,
          },
        }),
      },
    );
    if (typeof body.name !== "string" || !body.name.includes("/operations/")) {
      throw new VideoProviderResponseError(
        "Veo did not return an operation name.",
      );
    }
    return { jobId: body.name };
  }

  async poll(jobId: string): Promise<VideoProviderResult> {
    const apiKey = this.requireApiKey();
    if (!/^models\/[\w.-]+\/operations\/[\w-]+$/.test(jobId)) {
      throw new VideoProviderResponseError("Invalid Veo operation name.");
    }
    const operation = await this.jsonRequest(
      `${this.config.baseUrl}/v1beta/${jobId}`,
      apiKey,
      { method: "GET" },
    );
    const error = asObject(operation.error);
    if (error) {
      return failed(
        typeof error.message === "string"
          ? `Veo failed: ${error.message.slice(0, 300)}`
          : "Veo failed without an error message.",
      );
    }
    if (operation.done !== true) {
      return {
        status: "processing",
        resultUrl: null,
        resultMimeType: null,
        errorMessage: null,
        resultExpiresAt: null,
        actualCostMicros: null,
      };
    }
    const generated = asObject(
      asObject(operation.response)?.generateVideoResponse,
    );
    const samples = Array.isArray(generated?.generatedSamples)
      ? generated.generatedSamples
      : [];
    const uri = asObject(asObject(samples[0])?.video)?.uri;
    if (typeof uri !== "string") {
      const reasons = Array.isArray(generated?.raiMediaFilteredReasons)
        ? generated.raiMediaFilteredReasons.filter(
            (reason): reason is string => typeof reason === "string",
          )
        : [];
      return failed(
        reasons.length > 0
          ? `Veo blocked the clip: ${reasons.join(" ").slice(0, 300)}`
          : "Veo finished without a video; its safety filters may have blocked it.",
      );
    }
    return {
      status: "succeeded",
      resultUrl: uri,
      resultMimeType: "video/mp4",
      errorMessage: null,
      resultExpiresAt: new Date(Date.now() + resultLifetimeMs).toISOString(),
      actualCostMicros: null,
    };
  }

  /**
   * Veo file links need the API key and redirect to Google storage. The key is
   * sent only to the Gemini API host, never to the redirect target.
   */
  async download(url: string, signal: AbortSignal): Promise<Response> {
    const apiKey = this.requireApiKey();
    const first = await this.request(url, {
      method: "GET",
      headers: { "x-goog-api-key": apiKey },
      redirect: "manual",
      signal,
    });
    if (first.status < 300 || first.status >= 400) return first;
    const location = first.headers.get("location");
    let target: URL;
    try {
      target = new URL(location ?? "", url);
    } catch {
      throw new VideoProviderResponseError(
        "Veo redirected the download to an invalid address.",
      );
    }
    const trusted = ["googleapis.com", "googleusercontent.com"].some(
      (host) =>
        target.hostname === host || target.hostname.endsWith(`.${host}`),
    );
    if (target.protocol !== "https:" || !trusted) {
      throw new VideoProviderResponseError(
        "Veo redirected the download to an untrusted address.",
      );
    }
    return this.request(target, { method: "GET", redirect: "error", signal });
  }

  private requireApiKey(): string {
    if (!this.config.apiKey) {
      throw new VideoProviderConfigurationError(
        "GEMINI_API_KEY is required for Veo video generation.",
      );
    }
    return this.config.apiKey;
  }

  private async jsonRequest(
    url: string,
    apiKey: string,
    init: RequestInit,
  ): Promise<JsonObject> {
    let response: Response;
    try {
      response = await this.request(url, {
        ...init,
        headers: {
          "x-goog-api-key": apiKey,
          "content-type": "application/json",
        },
        signal: AbortSignal.timeout(this.config.requestTimeoutMs),
      });
    } catch (error) {
      throw new VideoProviderUnavailableError("Veo could not be reached.", {
        cause: error,
      });
    }
    const body = asObject(await safeJson(response));
    if (!response.ok) {
      const message = asObject(body?.error)?.message;
      if (
        response.status === 401 ||
        response.status === 403 ||
        (typeof message === "string" &&
          message.toLowerCase().includes("api key"))
      ) {
        throw new VideoProviderConfigurationError(
          "Google rejected the configured GEMINI_API_KEY or its project permissions.",
        );
      }
      if (response.status === 429) {
        throw new VideoProviderUnavailableError(
          "Veo rate limits or billing quota prevented video generation.",
        );
      }
      throw new VideoProviderResponseError(
        typeof message === "string"
          ? `Veo rejected the request: ${message.slice(0, 300)}`
          : `Veo returned HTTP ${response.status}.`,
      );
    }
    if (!body) {
      throw new VideoProviderResponseError("Veo returned an invalid response.");
    }
    return body;
  }
}

function failed(errorMessage: string): VideoProviderResult {
  return {
    status: "failed",
    resultUrl: null,
    resultMimeType: null,
    errorMessage,
    resultExpiresAt: null,
    actualCostMicros: null,
  };
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
