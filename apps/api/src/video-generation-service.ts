import { readFile } from "node:fs/promises";

import {
  videoWorkspaceSchema,
  type CreateCloudVideo,
  type GeneratedAsset,
  type Project,
  type Shot,
  type VideoAttempt,
  type VideoProviderId,
  type VideoProviderModel,
  type VideoResolution,
  type VideoWorkspace,
} from "@ai-studio/contracts";
import {
  GenerationNotFoundError,
  GenerationStateError,
  type GenerationRepository,
  type ProjectRepository,
  type StoryPlanRepository,
  type VideoRepository,
} from "@ai-studio/database";
import { buildVideoPrompt } from "@ai-studio/film-engine";
import {
  VideoProviderResponseError,
  VideoProviderUnavailableError,
  type VideoProvider,
} from "@ai-studio/providers";
import type {
  ManifestSynchronizer,
  StoryboardAssetStore,
  VideoAssetStore,
} from "@ai-studio/storage";

const providerResultHosts: Record<VideoProviderId, string[]> = {
  kling: ["klingai.com"],
  seedance: ["volces.com", "bytepluses.com"],
  veo: ["generativelanguage.googleapis.com"],
};

export class VideoGenerationService {
  private readonly providers: Map<VideoProviderId, VideoProvider>;
  private readonly refreshing = new Set<string>();

  constructor(
    private readonly videos: VideoRepository,
    private readonly images: GenerationRepository,
    private readonly projects: ProjectRepository,
    private readonly storyPlans: StoryPlanRepository,
    private readonly storyboardAssets: StoryboardAssetStore,
    private readonly videoAssets: VideoAssetStore,
    private readonly manifests: ManifestSynchronizer,
    providers: VideoProvider[],
    private readonly request: typeof fetch = fetch,
  ) {
    this.providers = new Map(
      providers.map((provider) => [provider.id, provider]),
    );
  }

  workspace(projectId: string): VideoWorkspace {
    const project = this.projects.getById(projectId);
    if (!project) throw new GenerationNotFoundError("Project");
    const plan = this.storyPlans.get(projectId);
    const imageHistory = this.images.listProject(projectId);
    const videoHistory = this.videos.listProject(projectId);
    const selectedImages = new Map(
      imageHistory.attempts
        .filter((attempt) => attempt.selected && attempt.asset)
        .map((attempt) => [attempt.shotId, attempt.asset!]),
    );
    const attemptsByShot = new Map<string, VideoAttempt[]>();
    for (const attempt of videoHistory.attempts) {
      attemptsByShot.set(attempt.shotId, [
        ...(attemptsByShot.get(attempt.shotId) ?? []),
        attempt,
      ]);
    }
    const shots = (plan?.scenes ?? []).flatMap((scene) =>
      scene.shots.map((shot) => ({
        shotId: shot.id,
        shotCode: shot.code,
        action: shot.action,
        cameraMovement: shot.cameraMovement,
        durationSeconds: shot.durationSeconds,
        prompt: buildVideoPrompt(project, shot),
        sourceImageAsset: selectedImages.get(shot.id) ?? null,
        attempts: attemptsByShot.get(shot.id) ?? [],
      })),
    );
    return videoWorkspaceSchema.parse({
      providers: [...this.providers.values()].map((provider) =>
        provider.status(),
      ),
      shots,
      totals: videoHistory.totals,
    });
  }

  async importManual(input: {
    projectId: string;
    shotId: string;
    originalFilename: string;
    declaredMimeType?: string;
    stream: AsyncIterable<Uint8Array>;
  }): Promise<VideoAttempt> {
    const context = this.shotContext(input.projectId, input.shotId);
    const source = this.requireApprovedSource(input.projectId, input.shotId);
    const attempt = this.videos.begin({
      projectId: input.projectId,
      shotId: input.shotId,
      provider: "manual",
      model: null,
      prompt: buildVideoPrompt(context.project, context.shot),
      sourceImageAssetId: source.asset.id,
      resolution: "720p",
      requestedDurationSeconds: Math.max(
        1,
        Math.min(30, Math.ceil(context.shot.durationSeconds)),
      ),
      generateAudio: false,
      settings: { source: "manual-import" },
      costMicros: 0,
      costIsEstimate: false,
    });
    let storedPath: string | undefined;
    try {
      const asset = await this.videoAssets.save({
        projectId: input.projectId,
        shotId: input.shotId,
        attemptId: attempt.id,
        originalFilename: input.originalFilename,
        declaredMimeType: input.declaredMimeType,
        stream: input.stream,
      });
      storedPath = asset.relativePath;
      const completed = this.videos.complete(
        input.projectId,
        attempt.id,
        asset,
      );
      await this.manifests.drain();
      return completed;
    } catch (error) {
      if (storedPath) {
        await this.videoAssets.remove(input.projectId, storedPath);
      }
      this.videos.fail(input.projectId, attempt.id, error);
      await this.manifests.drain();
      throw error;
    }
  }

  async submitCloud(
    projectId: string,
    shotId: string,
    input: CreateCloudVideo,
  ): Promise<VideoAttempt> {
    const context = this.shotContext(projectId, shotId);
    const source = this.requireApprovedSource(projectId, shotId);
    const provider = this.requireProvider(input.provider);
    const status = provider.status();
    if (!status.configured) {
      throw new GenerationStateError(
        `${status.label} is not configured. Add its API key in .env.local and restart the API.`,
      );
    }
    const model = status.models.find(
      (candidate) => candidate.id === input.model,
    );
    if (!model) {
      throw new GenerationStateError(
        `${input.model} is not available for ${status.label}. Reload the page and select an available model.`,
      );
    }
    if (!model.supportedResolutions.includes(input.resolution)) {
      throw new GenerationStateError(
        `${model.label} does not support ${input.resolution} for this image-to-video workflow.`,
      );
    }
    if (input.generateAudio && !model.supportsNativeAudio) {
      throw new GenerationStateError(
        `${model.label} does not support native audio. Turn it off before submitting.`,
      );
    }
    const durationSeconds = providerDuration(
      context.shot.durationSeconds,
      model,
      input.resolution,
    );
    if (durationSeconds === null) {
      throw new GenerationStateError(
        `${model.label} supports at most ${Math.max(...model.supportedDurationsSeconds)} seconds. Split this shot before submitting it.`,
      );
    }
    const rate = input.generateAudio
      ? model.estimatedUsdPerSecond.withAudio[input.resolution]
      : model.estimatedUsdPerSecond.withoutAudio[input.resolution];
    const estimatedCostMicros =
      rate !== null ? Math.round(rate * durationSeconds * 1_000_000) : 0;
    const attempt = this.videos.begin({
      projectId,
      shotId,
      provider: input.provider,
      model: model.id,
      prompt: buildVideoPrompt(context.project, context.shot),
      sourceImageAssetId: source.asset.id,
      resolution: input.resolution,
      requestedDurationSeconds: durationSeconds,
      generateAudio: input.generateAudio,
      settings: {
        source: "approved-storyboard-image",
        continuityInput: "first_frame",
        sourceReferenceIds: source.referenceIds,
        additionalReferencesSent: false,
        continuityNote: model.continuityMessage,
        sourceShotDurationSeconds: context.shot.durationSeconds,
        providerDurationRounded:
          durationSeconds !== Math.ceil(context.shot.durationSeconds),
      },
      costMicros: estimatedCostMicros,
      costIsEstimate: estimatedCostMicros > 0,
    });
    try {
      const image = await readFile(
        this.storyboardAssets.absolutePath(
          projectId,
          source.asset.relativePath,
        ),
      );
      const submitted = await provider.submit({
        model: model.id,
        prompt: attempt.prompt,
        firstFrameDataUrl: `data:${source.asset.mimeType};base64,${image.toString("base64")}`,
        firstFrameMimeType: source.asset.mimeType,
        aspectRatio: context.project.aspectRatio,
        durationSeconds,
        resolution: input.resolution,
        generateAudio: input.generateAudio,
        externalTaskId: attempt.id,
      });
      const saved = this.videos.submitted(
        projectId,
        attempt.id,
        submitted.jobId,
      );
      await this.manifests.drain();
      return saved;
    } catch (error) {
      this.videos.fail(projectId, attempt.id, error);
      await this.manifests.drain();
      throw error;
    }
  }

  async refresh(projectId: string, attemptId: string): Promise<VideoAttempt> {
    const key = `${projectId}:${attemptId}`;
    if (this.refreshing.has(key)) {
      return this.requireAttempt(projectId, attemptId);
    }
    this.refreshing.add(key);
    try {
      const attempt = this.requireAttempt(projectId, attemptId);
      if (
        !["submitted", "processing", "downloading"].includes(attempt.status)
      ) {
        return attempt;
      }
      if (attempt.provider === "manual" || !attempt.providerJobId) {
        throw new GenerationStateError(
          "This video attempt does not have a cloud provider task.",
        );
      }
      const provider = this.requireProvider(attempt.provider);
      const result = await provider.poll(attempt.providerJobId);
      if (result.actualCostMicros !== null) {
        this.videos.recordActualCost(
          projectId,
          attemptId,
          result.actualCostMicros,
        );
      }
      if (result.status === "failed") {
        const failed = this.videos.fail(
          projectId,
          attemptId,
          new Error(
            result.errorMessage ?? `${provider.status().label} failed.`,
          ),
        );
        await this.manifests.drain();
        return failed;
      }
      if (result.status !== "succeeded") {
        const active = this.videos.markProviderState(
          projectId,
          attemptId,
          result.status,
        );
        await this.manifests.drain();
        return active;
      }
      if (!result.resultUrl || !result.resultMimeType) {
        throw new VideoProviderResponseError(
          `${provider.status().label} reported success without a video URL.`,
        );
      }
      this.assertSafeResultUrl(attempt.provider, result.resultUrl);
      this.videos.markProviderState(
        projectId,
        attemptId,
        "downloading",
        result.resultExpiresAt,
      );
      const response = await this.download(provider, result.resultUrl);
      if (!response.body) {
        throw new VideoProviderResponseError(
          "The provider video download did not contain a response body.",
        );
      }
      const asset = await this.videoAssets.save({
        projectId,
        shotId: attempt.shotId,
        attemptId,
        originalFilename: `${attempt.shotCode}-${attempt.provider}.mp4`,
        declaredMimeType:
          response.headers.get("content-type") ?? result.resultMimeType,
        stream: response.body as unknown as AsyncIterable<Uint8Array>,
      });
      const completed = this.videos.complete(projectId, attemptId, asset);
      await this.manifests.drain();
      return completed;
    } catch (error) {
      const current = this.videos.getAttempt(projectId, attemptId);
      if (
        current &&
        ["submitted", "processing", "downloading"].includes(current.status) &&
        !(error instanceof VideoProviderUnavailableError)
      ) {
        this.videos.fail(projectId, attemptId, error);
        await this.manifests.drain();
      }
      throw error;
    } finally {
      this.refreshing.delete(key);
    }
  }

  async refreshPending(): Promise<void> {
    for (const { projectId, attemptId } of this.videos.listActive()) {
      try {
        await this.refresh(projectId, attemptId);
      } catch {
        // The failure is already persisted with the attempt. The next item can run.
      }
    }
  }

  async review(
    projectId: string,
    attemptId: string,
    decision: "approve" | "reject",
  ): Promise<VideoAttempt> {
    const attempt = this.videos.review(projectId, attemptId, decision);
    await this.manifests.drain();
    return attempt;
  }

  private shotContext(
    projectId: string,
    shotId: string,
  ): { project: Project; shot: Shot } {
    const project = this.projects.getById(projectId);
    if (!project) throw new GenerationNotFoundError("Project");
    const shot = this.storyPlans
      .get(projectId)
      ?.scenes.flatMap((scene) => scene.shots)
      .find((candidate) => candidate.id === shotId);
    if (!shot) throw new GenerationNotFoundError("Shot");
    return { project, shot };
  }

  private requireApprovedSource(
    projectId: string,
    shotId: string,
  ): { asset: GeneratedAsset; referenceIds: string[] } {
    const attempt = this.images
      .listProject(projectId)
      .attempts.find(
        (candidate) =>
          candidate.shotId === shotId && candidate.selected && candidate.asset,
      );
    if (!attempt?.asset) {
      throw new GenerationStateError(
        "Approve one storyboard image for this shot before making video.",
      );
    }
    return {
      asset: attempt.asset,
      referenceIds: attempt.references.map((reference) => reference.id),
    };
  }

  private requireProvider(providerId: VideoProviderId): VideoProvider {
    const provider = this.providers.get(providerId);
    if (!provider) {
      throw new GenerationStateError(
        `${providerId} is not available in this installation.`,
      );
    }
    return provider;
  }

  private requireAttempt(projectId: string, attemptId: string): VideoAttempt {
    const attempt = this.videos.getAttempt(projectId, attemptId);
    if (!attempt) throw new GenerationNotFoundError("Video attempt");
    return attempt;
  }

  private assertSafeResultUrl(provider: VideoProviderId, value: string): void {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      throw new VideoProviderResponseError(
        "The provider returned an invalid video URL.",
      );
    }
    const trusted = providerResultHosts[provider].some(
      (host) => url.hostname === host || url.hostname.endsWith(`.${host}`),
    );
    if (url.protocol !== "https:" || !trusted || url.username || url.password) {
      throw new VideoProviderResponseError(
        "The provider returned an untrusted video download URL.",
      );
    }
  }

  private async download(
    provider: VideoProvider,
    url: string,
  ): Promise<Response> {
    let response: Response;
    const signal = AbortSignal.timeout(5 * 60_000);
    try {
      response = provider.download
        ? await provider.download(url, signal)
        : await this.request(url, { method: "GET", redirect: "error", signal });
    } catch (error) {
      throw new VideoProviderUnavailableError(
        "The completed provider video could not be downloaded.",
        { cause: error },
      );
    }
    if (!response.ok) {
      throw new VideoProviderResponseError(
        `The completed provider video returned HTTP ${response.status}.`,
      );
    }
    const length = Number(response.headers.get("content-length"));
    if (Number.isFinite(length) && length > 512 * 1024 * 1024) {
      throw new VideoProviderResponseError(
        "The provider video is larger than the 512 MB safety limit.",
      );
    }
    return response;
  }
}

function providerDuration(
  shotDurationSeconds: number,
  model: VideoProviderModel,
  resolution: VideoResolution,
): number | null {
  const target = Math.ceil(shotDurationSeconds);
  return (
    [
      ...(model.durationsByResolution?.[resolution] ??
        model.supportedDurationsSeconds),
    ]
      .sort((left, right) => left - right)
      .find((duration) => duration >= target) ?? null
  );
}
