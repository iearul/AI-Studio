import type {
  Bible,
  ImageAttempt,
  ImageHistory,
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
import type {
  ManifestSynchronizer,
  StoryboardAssetStore,
} from "@ai-film-studio/storage";

type ShotContext = {
  project: Project;
  plan: StoryPlan;
  bible: Bible;
  coverage: ReferenceCoverage["shots"][number];
};

export class ImageGenerationService {
  constructor(
    private readonly generations: GenerationRepository,
    private readonly projects: ProjectRepository,
    private readonly storyPlans: StoryPlanRepository,
    private readonly bible: BibleRepository,
    private readonly storyboardAssets: StoryboardAssetStore,
    private readonly manifests: ManifestSynchronizer,
  ) {}

  getHistory(projectId: string): ImageHistory {
    return this.generations.listProject(projectId);
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
