import { randomInt } from "node:crypto";
import { readFile } from "node:fs/promises";

import type {
  Bible,
  ImageAttempt,
  ImageGenerationInput,
  ImageHistory,
  ImageProviderStatus,
  Project,
  ReferenceCoverage,
  ReferenceImage,
  StoryPlan,
} from "@ai-film-studio/contracts";
import {
  GenerationNotFoundError,
  GenerationStateError,
  type BibleRepository,
  type GenerationRepository,
  type ProjectRepository,
  type StoryPlanRepository,
} from "@ai-film-studio/database";
import { buildReferenceCoverage } from "@ai-film-studio/film-engine";
import {
  ImageProviderConfigurationError,
  ImageProviderUnavailableError,
  type ImageProvider,
} from "@ai-film-studio/providers";
import type {
  ManifestSynchronizer,
  ReferenceImageStore,
  StoryboardAssetStore,
} from "@ai-film-studio/storage";

type ShotContext = {
  project: Project;
  plan: StoryPlan;
  bible: Bible;
  coverage: ReferenceCoverage["shots"][number];
};

export class ImageGenerationService {
  private timer: ReturnType<typeof setInterval> | undefined;
  private running = false;

  constructor(
    private readonly generations: GenerationRepository,
    private readonly projects: ProjectRepository,
    private readonly storyPlans: StoryPlanRepository,
    private readonly bible: BibleRepository,
    private readonly referenceImages: ReferenceImageStore,
    private readonly storyboardAssets: StoryboardAssetStore,
    private readonly provider: ImageProvider,
    private readonly manifests: ManifestSynchronizer,
  ) {}

  getHistory(projectId: string): ImageHistory {
    return this.generations.listProject(projectId);
  }

  getProviderStatus(): Promise<ImageProviderStatus> {
    return this.provider.getStatus();
  }

  async queue(
    projectId: string,
    shotId: string,
    input: ImageGenerationInput,
  ): Promise<ImageAttempt> {
    const context = this.requireReadyShot(projectId, shotId);
    const status = await this.provider.getStatus();
    if (!status.configured) {
      throw new ImageProviderConfigurationError(status.message);
    }
    if (!status.available) {
      throw new ImageProviderUnavailableError(status.message);
    }
    const parsedSeed = input.seed ?? randomInt(0, 2_147_483_647);
    const dimensions = resolveDimensions(
      context.project.aspectRatio,
      input.width,
      input.height,
    );
    const attempt = this.generations.queueImage({
      projectId,
      shotId,
      provider: "comfyui",
      model: status.model,
      prompt: context.coverage.prompt,
      negativePrompt: input.negativePrompt ?? "",
      references: this.references(context.coverage),
      seed: parsedSeed,
      settings: {
        width: dimensions.width,
        height: dimensions.height,
      },
    });
    await this.manifests.drain();
    return attempt;
  }

  async importManual(input: {
    projectId: string;
    shotId: string;
    originalFilename: string;
    declaredMimeType: string;
    buffer: Buffer;
  }): Promise<ImageAttempt> {
    const context = this.requireReadyShot(input.projectId, input.shotId);
    const startedAt = Date.now();
    const attempt = this.generations.beginManualImage({
      projectId: input.projectId,
      shotId: input.shotId,
      provider: "manual",
      model: null,
      prompt: context.coverage.prompt,
      negativePrompt: "",
      references: this.references(context.coverage),
      seed: null,
      settings: { source: "manual-import" },
    });
    let storedPath: string | undefined;
    try {
      const asset = await this.storyboardAssets.save({
        projectId: input.projectId,
        shotId: input.shotId,
        attemptId: attempt.id,
        originalFilename: input.originalFilename,
        declaredMimeType: input.declaredMimeType,
        buffer: input.buffer,
      });
      storedPath = asset.relativePath;
      const completed = this.generations.completeAttempt(
        input.projectId,
        attempt.id,
        asset,
        Date.now() - startedAt,
      );
      await this.manifests.drain();
      return completed;
    } catch (error) {
      if (storedPath) {
        await this.storyboardAssets.remove(input.projectId, storedPath);
      }
      this.generations.failAttempt(input.projectId, attempt.id, error);
      await this.manifests.drain();
      throw error;
    }
  }

  async review(
    projectId: string,
    attemptId: string,
    decision: "approve" | "reject",
  ): Promise<ImageAttempt> {
    const attempt = this.generations.review(projectId, attemptId, decision);
    await this.manifests.drain();
    return attempt;
  }

  async runNext(): Promise<boolean> {
    const attempt = this.generations.claimNextImageJob();
    if (!attempt) return false;
    const startedAt = Date.now();
    let storedPath: string | undefined;
    try {
      const references = await Promise.all(
        attempt.references.map(async (reference) => ({
          filename: reference.originalFilename,
          mimeType: reference.mimeType,
          buffer: await readFile(
            this.referenceImages.absolutePath(
              attempt.projectId,
              reference.relativePath,
            ),
          ),
        })),
      );
      const width = numericSetting(attempt.settings, "width", 1024);
      const height = numericSetting(attempt.settings, "height", 1024);
      const generated = await this.provider.generate(
        {
          prompt: attempt.prompt,
          negativePrompt: attempt.negativePrompt,
          seed: attempt.seed ?? 0,
          width,
          height,
          filenamePrefix: `ai-film-studio-${attempt.shotCode.toLowerCase()}`,
          references,
        },
        (progress) => {
          this.generations.updateJob(
            attempt.projectId,
            attempt.id,
            progress.status,
            progress.progress,
            progress.providerJobId,
          );
        },
      );
      const asset = await this.storyboardAssets.save({
        projectId: attempt.projectId,
        shotId: attempt.shotId,
        attemptId: attempt.id,
        originalFilename: generated.filename,
        declaredMimeType: generated.mimeType,
        buffer: generated.buffer,
      });
      storedPath = asset.relativePath;
      this.generations.completeAttempt(
        attempt.projectId,
        attempt.id,
        asset,
        Date.now() - startedAt,
        generated.providerJobId,
      );
    } catch (error) {
      if (storedPath) {
        await this.storyboardAssets.remove(attempt.projectId, storedPath);
      }
      this.generations.failAttempt(attempt.projectId, attempt.id, error);
    }
    await this.manifests.drain();
    return true;
  }

  async drain(limit = 10): Promise<number> {
    let completed = 0;
    while (completed < limit && (await this.runNext())) completed += 1;
    return completed;
  }

  start(intervalMs = 750): void {
    if (this.timer) return;
    this.generations.failInterruptedJobs();
    const tick = () => {
      if (this.running) return;
      this.running = true;
      void this.drain()
        .catch(() => undefined)
        .finally(() => {
          this.running = false;
        });
    };
    tick();
    this.timer = setInterval(tick, intervalMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  private requireReadyShot(projectId: string, shotId: string): ShotContext {
    const project = this.projects.getById(projectId);
    if (!project) throw new GenerationNotFoundError("Project");
    const plan = this.storyPlans.get(projectId);
    if (!plan) {
      throw new GenerationStateError(
        "Create and import a story plan before generating images.",
      );
    }
    const bible = this.bible.list(projectId);
    const coverage = buildReferenceCoverage(project, plan, bible).shots.find(
      (candidate) => candidate.shotId === shotId,
    );
    if (!coverage) throw new GenerationNotFoundError("Shot");
    if (!coverage.ready) {
      throw new GenerationStateError(
        "Resolve every character, location, and prop before generating this shot.",
      );
    }
    return { project, plan, bible, coverage };
  }

  private references(
    coverage: ReferenceCoverage["shots"][number],
  ): ReferenceImage[] {
    const byId = new Map<string, ReferenceImage>();
    for (const reference of [
      ...coverage.characters.flatMap((entity) => entity.references),
      ...(coverage.location?.references ?? []),
      ...coverage.props.flatMap((entity) => entity.references),
    ]) {
      byId.set(reference.id, reference);
    }
    return [...byId.values()];
  }
}

function resolveDimensions(
  aspectRatio: Project["aspectRatio"],
  width?: number,
  height?: number,
): { width: number; height: number } {
  if (width !== undefined && height !== undefined) return { width, height };
  if (aspectRatio === "9:16") return { width: 720, height: 1280 };
  if (aspectRatio === "16:9") return { width: 1024, height: 576 };
  return { width: 768, height: 768 };
}

function numericSetting(
  settings: Record<string, unknown>,
  name: string,
  fallback: number,
): number {
  const value = settings[name];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
