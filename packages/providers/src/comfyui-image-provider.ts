import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  imageProviderStatusSchema,
  type ImageProviderStatus,
} from "@ai-film-studio/contracts";

import {
  ImageProviderConfigurationError,
  ImageProviderUnavailableError,
  type GeneratedImage,
  type ImageProvider,
  type ImageProviderProgress,
  type ImageProviderRequest,
} from "./image-provider.js";

export type ComfyUiImageProviderConfig = {
  baseUrl: string;
  workflowPath: string | null;
  model: string | null;
  timeoutMs: number;
  pollIntervalMs: number;
};

type Dependencies = {
  fetch: typeof fetch;
  readFile: typeof readFile;
  sleep: (milliseconds: number) => Promise<void>;
};

type JsonObject = Record<string, unknown>;

const defaultDependencies: Dependencies = {
  fetch,
  readFile,
  sleep: (milliseconds) =>
    new Promise((resolve) => setTimeout(resolve, milliseconds)),
};

export function resolveComfyUiImageProviderConfig(
  workspaceRoot: string,
): ComfyUiImageProviderConfig {
  const baseUrl = new URL(
    process.env.COMFYUI_BASE_URL ?? "http://127.0.0.1:8188",
  );
  if (
    baseUrl.protocol !== "http:" ||
    baseUrl.username ||
    baseUrl.password ||
    !["127.0.0.1", "localhost", "::1", "[::1]"].includes(baseUrl.hostname)
  ) {
    throw new ImageProviderConfigurationError(
      "COMFYUI_BASE_URL must use HTTP on a loopback host.",
    );
  }
  const workflow = process.env.COMFYUI_IMAGE_WORKFLOW_PATH?.trim();
  const timeout = Number(process.env.COMFYUI_IMAGE_TIMEOUT_MS ?? 600_000);
  if (!Number.isInteger(timeout) || timeout < 10_000 || timeout > 3_600_000) {
    throw new ImageProviderConfigurationError(
      "COMFYUI_IMAGE_TIMEOUT_MS must be between 10000 and 3600000.",
    );
  }
  return {
    baseUrl: baseUrl.toString().replace(/\/$/, ""),
    workflowPath: workflow ? path.resolve(workspaceRoot, workflow) : null,
    model: process.env.COMFYUI_IMAGE_MODEL?.trim() || null,
    timeoutMs: timeout,
    pollIntervalMs: 750,
  };
}

export class ComfyUiImageProvider implements ImageProvider {
  constructor(
    readonly config: ComfyUiImageProviderConfig,
    private readonly dependencies: Dependencies = defaultDependencies,
  ) {}

  async getStatus(): Promise<ImageProviderStatus> {
    const configured = Boolean(this.config.workflowPath && this.config.model);
    if (!configured) {
      return this.status(
        false,
        false,
        "Set COMFYUI_IMAGE_WORKFLOW_PATH and COMFYUI_IMAGE_MODEL to enable local generation.",
      );
    }
    try {
      await this.loadWorkflow();
    } catch (error) {
      return this.status(
        true,
        false,
        error instanceof Error ? error.message : "The workflow is unreadable.",
      );
    }
    try {
      const response = await this.dependencies.fetch(
        `${this.config.baseUrl}/system_stats`,
        { signal: AbortSignal.timeout(2_500) },
      );
      if (!response.ok) {
        return this.status(
          true,
          false,
          `ComfyUI health check returned HTTP ${response.status}.`,
        );
      }
      return this.status(true, true, "ComfyUI is ready for image generation.");
    } catch {
      return this.status(
        true,
        false,
        "ComfyUI is configured but is not reachable.",
      );
    }
  }

  async generate(
    request: ImageProviderRequest,
    onProgress: (progress: ImageProviderProgress) => void | Promise<void>,
  ): Promise<GeneratedImage> {
    if (!this.config.workflowPath || !this.config.model) {
      throw new ImageProviderConfigurationError(
        "ComfyUI image generation is not configured.",
      );
    }
    const startedAt = Date.now();
    const referenceNames: string[] = [];
    for (const reference of request.references) {
      referenceNames.push(await this.uploadReference(reference));
    }
    await onProgress({ status: "preparing", progress: 15 });
    const workflow = substituteWorkflow(await this.loadWorkflow(), {
      "{{PROMPT}}": request.prompt,
      "{{NEGATIVE_PROMPT}}": request.negativePrompt,
      "{{SEED}}": request.seed,
      "{{WIDTH}}": request.width,
      "{{HEIGHT}}": request.height,
      "{{FILENAME_PREFIX}}": request.filenamePrefix,
      "{{MODEL}}": this.config.model,
      ...Object.fromEntries(
        referenceNames.map((filename, index) => [
          `{{REFERENCE_IMAGE_${index + 1}}}`,
          filename,
        ]),
      ),
    });
    const unresolved = [
      ...new Set(JSON.stringify(workflow).match(/\{\{[A-Z0-9_]+\}\}/g) ?? []),
    ];
    if (unresolved.length > 0) {
      throw new ImageProviderConfigurationError(
        `ComfyUI workflow has unresolved tokens: ${unresolved.join(", ")}.`,
      );
    }
    const queued = await this.fetchJson(`${this.config.baseUrl}/prompt`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt: workflow }),
    });
    const promptId = stringProperty(queued, "prompt_id");
    if (!promptId) {
      throw new ImageProviderUnavailableError(
        "ComfyUI did not return a prompt identifier.",
      );
    }
    await onProgress({
      status: "generating",
      progress: 30,
      providerJobId: promptId,
    });
    const image = await this.waitForImage(promptId, startedAt, onProgress);
    await onProgress({
      status: "downloading",
      progress: 90,
      providerJobId: promptId,
    });
    const query = new URLSearchParams({
      filename: image.filename,
      ...(image.subfolder ? { subfolder: image.subfolder } : {}),
      ...(image.type ? { type: image.type } : {}),
    });
    const response = await this.dependencies.fetch(
      `${this.config.baseUrl}/view?${query.toString()}`,
      { signal: AbortSignal.timeout(30_000) },
    );
    if (!response.ok) {
      throw new ImageProviderUnavailableError(
        `ComfyUI image download returned HTTP ${response.status}.`,
      );
    }
    return {
      buffer: Buffer.from(await response.arrayBuffer()),
      filename: image.filename,
      mimeType:
        response.headers.get("content-type")?.split(";", 1)[0]?.trim() ??
        "application/octet-stream",
      providerJobId: promptId,
    };
  }

  private async uploadReference(reference: {
    filename: string;
    mimeType: string;
    buffer: Buffer;
  }): Promise<string> {
    const form = new FormData();
    form.append(
      "image",
      new Blob([Uint8Array.from(reference.buffer)], {
        type: reference.mimeType,
      }),
      reference.filename,
    );
    form.append("type", "input");
    form.append("overwrite", "false");
    const response = await this.fetchJson(
      `${this.config.baseUrl}/upload/image`,
      { method: "POST", body: form },
    );
    const name = stringProperty(response, "name");
    if (!name) {
      throw new ImageProviderUnavailableError(
        "ComfyUI did not return an uploaded reference filename.",
      );
    }
    const subfolder = stringProperty(response, "subfolder");
    return subfolder ? `${subfolder}/${name}` : name;
  }

  private async waitForImage(
    promptId: string,
    startedAt: number,
    onProgress: (progress: ImageProviderProgress) => void | Promise<void>,
  ): Promise<{ filename: string; subfolder: string; type: string }> {
    let progress = 35;
    while (Date.now() - startedAt < this.config.timeoutMs) {
      const history = await this.fetchJson(
        `${this.config.baseUrl}/history/${encodeURIComponent(promptId)}`,
        { signal: AbortSignal.timeout(10_000) },
      );
      const entry = asObject(history[promptId]);
      if (entry) {
        const status = asObject(entry.status);
        if (status?.status_str === "error") {
          throw new ImageProviderUnavailableError(
            "ComfyUI reported a workflow execution error.",
          );
        }
        const image = firstOutputImage(asObject(entry.outputs));
        if (image) return image;
      }
      progress = Math.min(85, progress + 2);
      await onProgress({
        status: "generating",
        progress,
        providerJobId: promptId,
      });
      await this.dependencies.sleep(this.config.pollIntervalMs);
    }
    throw new ImageProviderUnavailableError(
      `ComfyUI generation timed out after ${this.config.timeoutMs} ms.`,
    );
  }

  private async loadWorkflow(): Promise<JsonObject> {
    if (!this.config.workflowPath) {
      throw new ImageProviderConfigurationError(
        "COMFYUI_IMAGE_WORKFLOW_PATH is not set.",
      );
    }
    try {
      const value = JSON.parse(
        await this.dependencies.readFile(this.config.workflowPath, "utf8"),
      ) as unknown;
      const workflow = asObject(value);
      if (!workflow || Object.keys(workflow).length === 0) {
        throw new Error("Workflow must be a non-empty JSON object.");
      }
      const serialized = JSON.stringify(workflow);
      const requiredTokens = [
        "{{PROMPT}}",
        "{{NEGATIVE_PROMPT}}",
        "{{SEED}}",
        "{{WIDTH}}",
        "{{HEIGHT}}",
        "{{FILENAME_PREFIX}}",
        "{{MODEL}}",
      ];
      const missing = requiredTokens.filter(
        (token) => !serialized.includes(token),
      );
      if (missing.length > 0) {
        throw new Error(`Workflow is missing tokens: ${missing.join(", ")}.`);
      }
      return workflow;
    } catch (error) {
      throw new ImageProviderConfigurationError(
        `Unable to load the ComfyUI API workflow: ${
          error instanceof Error ? error.message : "invalid file"
        }`,
      );
    }
  }

  private async fetchJson(
    url: string,
    init?: RequestInit,
  ): Promise<JsonObject> {
    let response: Response;
    try {
      response = await this.dependencies.fetch(url, init);
    } catch (error) {
      throw new ImageProviderUnavailableError(
        `ComfyUI request failed: ${
          error instanceof Error ? error.message : "network error"
        }`,
      );
    }
    if (!response.ok) {
      const body = (await response.text()).slice(0, 1000);
      throw new ImageProviderUnavailableError(
        `ComfyUI returned HTTP ${response.status}${body ? `: ${body}` : "."}`,
      );
    }
    try {
      const value = (await response.json()) as unknown;
      const object = asObject(value);
      if (!object) throw new Error("Expected an object.");
      return object;
    } catch (error) {
      throw new ImageProviderUnavailableError(
        `ComfyUI returned invalid JSON: ${
          error instanceof Error ? error.message : "invalid response"
        }`,
      );
    }
  }

  private status(
    configured: boolean,
    available: boolean,
    message: string,
  ): ImageProviderStatus {
    return imageProviderStatusSchema.parse({
      id: "comfyui",
      name: "ComfyUI",
      configured,
      available,
      baseUrl: this.config.baseUrl,
      workflowPath: this.config.workflowPath,
      model: this.config.model,
      message,
    });
  }
}

function asObject(value: unknown): JsonObject | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : undefined;
}

function stringProperty(value: JsonObject, key: string): string | undefined {
  return typeof value[key] === "string" ? value[key] : undefined;
}

function firstOutputImage(
  outputs: JsonObject | undefined,
): { filename: string; subfolder: string; type: string } | undefined {
  if (!outputs) return undefined;
  for (const output of Object.values(outputs)) {
    const images = asObject(output)?.images;
    if (!Array.isArray(images)) continue;
    for (const value of images) {
      const image = asObject(value);
      const filename = image && stringProperty(image, "filename");
      if (filename) {
        return {
          filename,
          subfolder: stringProperty(image, "subfolder") ?? "",
          type: stringProperty(image, "type") ?? "output",
        };
      }
    }
  }
  return undefined;
}

export function substituteWorkflow(
  value: unknown,
  replacements: Record<string, string | number>,
): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => substituteWorkflow(item, replacements));
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        substituteWorkflow(item, replacements),
      ]),
    );
  }
  if (typeof value !== "string") return value;
  if (value in replacements) return replacements[value];
  return Object.entries(replacements).reduce(
    (result, [token, replacement]) =>
      result.replaceAll(token, String(replacement)),
    value,
  );
}
