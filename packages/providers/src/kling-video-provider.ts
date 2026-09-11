import type { VideoProviderStatus } from "@ai-film-studio/contracts";

import {
  type VideoProvider,
  VideoProviderConfigurationError,
  VideoProviderResponseError,
  VideoProviderUnavailableError,
  type VideoProviderResult,
  type VideoSubmission,
} from "./video-provider.js";

export type KlingVideoProviderConfig = {
  apiKey?: string;
  baseUrl: string;
  model: string;
  requestTimeoutMs: number;
  estimatedUsdPerSecond: number | null;
};

type KlingTask = {
  id?: unknown;
  status?: unknown;
  message?: unknown;
  outputs?: unknown;
  billing?: unknown;
};

export function resolveKlingVideoProviderConfig(): KlingVideoProviderConfig {
  return {
    apiKey: process.env.KLING_API_KEY?.trim() || undefined,
    baseUrl:
      process.env.KLING_BASE_URL?.trim() || "https://api-singapore.klingai.com",
    model: process.env.KLING_VIDEO_MODEL?.trim() || "kling-3.0",
    requestTimeoutMs: positiveInteger(
      process.env.KLING_VIDEO_TIMEOUT_MS,
      30_000,
    ),
    estimatedUsdPerSecond: nonNegativeNumber(
      process.env.KLING_ESTIMATED_USD_PER_SECOND,
    ),
  };
}

export class KlingVideoProvider implements VideoProvider {
  readonly id = "kling" as const;

  constructor(
    private readonly config: KlingVideoProviderConfig,
    private readonly request: typeof fetch = fetch,
  ) {}

  status(): VideoProviderStatus {
    return {
      id: this.id,
      label: "Kling 3.0",
      configured: Boolean(this.config.apiKey),
      model: this.config.model,
      supportedResolutions: ["720p", "1080p", "4k"],
      minimumDurationSeconds: 3,
      maximumDurationSeconds: 15,
      estimatedUsdPerSecond: this.config.estimatedUsdPerSecond,
      pricingMessage:
        this.config.estimatedUsdPerSecond === null
          ? "Kling pricing is account/package dependent. Check the Kling console; actual cash billing is recorded after completion when returned by the API."
          : "Estimate uses KLING_ESTIMATED_USD_PER_SECOND; Kling's returned cash billing replaces it after completion.",
      warning: null,
    };
  }

  async submit(input: VideoSubmission): Promise<{ jobId: string }> {
    const apiKey = this.requireApiKey();
    if (input.firstFrameMimeType === "image/webp") {
      throw new VideoProviderConfigurationError(
        "Kling 3.0 accepts JPEG or PNG first frames, but the approved frame is WebP. Import and approve a PNG or JPEG attempt for this shot.",
      );
    }
    if (input.durationSeconds < 3 || input.durationSeconds > 15) {
      throw new VideoProviderConfigurationError(
        "Kling 3.0 video duration must be between 3 and 15 seconds.",
      );
    }
    const body = await this.jsonRequest(
      `${this.config.baseUrl}/image-to-video/${encodeURIComponent(this.config.model)}`,
      apiKey,
      {
        method: "POST",
        body: JSON.stringify({
          contents: [
            { type: "prompt", text: input.prompt },
            { type: "first_frame", url: input.firstFrameDataUrl },
          ],
          settings: {
            resolution: input.resolution,
            duration: input.durationSeconds,
            audio: input.generateAudio ? "native" : "off",
            multi_shot: false,
          },
          options: {
            external_task_id: input.externalTaskId,
            watermark_info: { enabled: false },
          },
        }),
      },
    );
    const data = objectValue(body, "data");
    const jobId = stringValue(data, "id");
    if (!jobId || numberValue(body, "code") !== 0) {
      throw new VideoProviderResponseError(
        providerMessage("Kling did not return a task ID.", body),
      );
    }
    return { jobId };
  }

  async poll(jobId: string): Promise<VideoProviderResult> {
    const apiKey = this.requireApiKey();
    const body = await this.jsonRequest(
      `${this.config.baseUrl}/tasks?task_ids=${encodeURIComponent(jobId)}`,
      apiKey,
      { method: "GET" },
    );
    const tasks = Array.isArray(objectValue(body, "data"))
      ? (objectValue(body, "data") as KlingTask[])
      : [];
    const task = tasks[0];
    if (!task || typeof task.status !== "string") {
      throw new VideoProviderResponseError(
        providerMessage("Kling did not return the requested task.", body),
      );
    }
    const status = normalizeStatus(task.status);
    const output = Array.isArray(task.outputs)
      ? (task.outputs as Array<Record<string, unknown>>).find(
          (candidate) => candidate.type === "video",
        )
      : undefined;
    const resultUrl = output ? stringValue(output, "url") : undefined;
    return {
      status,
      resultUrl: resultUrl ?? null,
      resultMimeType: resultUrl ? "video/mp4" : null,
      errorMessage:
        status === "failed"
          ? typeof task.message === "string"
            ? task.message
            : "Kling video generation failed."
          : null,
      resultExpiresAt:
        status === "succeeded"
          ? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
          : null,
      actualCostMicros: klingCashCost(task.billing),
    };
  }

  private requireApiKey(): string {
    if (!this.config.apiKey) {
      throw new VideoProviderConfigurationError(
        "Kling is not configured. Add KLING_API_KEY to .env.local and restart the API.",
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
        "Kling could not be reached. Check the network and try again.",
        { cause: error },
      );
    }
    const body = (await response.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    if (!response.ok) {
      throw new VideoProviderResponseError(
        providerMessage(`Kling returned HTTP ${response.status}.`, body),
      );
    }
    return body;
  }
}

function normalizeStatus(value: string): VideoProviderResult["status"] {
  if (value === "succeeded") return "succeeded";
  if (value === "failed") return "failed";
  if (value === "processing") return "processing";
  return "submitted";
}

function klingCashCost(value: unknown): number | null {
  if (!Array.isArray(value)) return null;
  let totalUsd = 0;
  let found = false;
  for (const item of value) {
    if (
      typeof item === "object" &&
      item !== null &&
      (item as Record<string, unknown>).charge_type === "cash" &&
      (item as Record<string, unknown>).currency === "USD"
    ) {
      const amount = Number((item as Record<string, unknown>).amount);
      if (Number.isFinite(amount) && amount >= 0) {
        totalUsd += amount;
        found = true;
      }
    }
  }
  return found ? Math.round(totalUsd * 1_000_000) : null;
}

function providerMessage(
  fallback: string,
  body: Record<string, unknown>,
): string {
  const message = stringValue(body, "message");
  return message ? `${fallback} ${message}` : fallback;
}

function objectValue(
  value: unknown,
  key: string,
): Record<string, unknown> | unknown[] | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const candidate = (value as Record<string, unknown>)[key];
  return typeof candidate === "object" && candidate !== null
    ? (candidate as Record<string, unknown> | unknown[])
    : undefined;
}

function stringValue(value: unknown, key: string): string | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const candidate = (value as Record<string, unknown>)[key];
  return typeof candidate === "string" ? candidate : undefined;
}

function numberValue(value: unknown, key: string): number | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const candidate = (value as Record<string, unknown>)[key];
  return typeof candidate === "number" ? candidate : undefined;
}

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function nonNegativeNumber(value: string | undefined): number | null {
  if (!value?.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}
