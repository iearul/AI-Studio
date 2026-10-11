import { readFile } from "node:fs/promises";

import type {
  Bible,
  CloudImageProviderId,
  CreateCloudImage,
  CreateCloudReferenceImage,
  ImageAttempt,
  ImageHistory,
  ImageProviderModel,
  ImageProviderStatus,
  ImageQuality,
  Project,
  ReferenceCoverage,
  ReferenceImage,
  ReferenceOwnerType,
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
import {
  buildReferenceCoverage,
  buildReferencePrompt,
  referenceAspectRatios,
} from "@ai-film-studio/film-engine";
import type {
  ImageGenerationInput,
  ImageProvider,
  ImageReferenceInput,
} from "@ai-film-studio/providers";
import {
  detectImage,
  type ManifestSynchronizer,
  type ReferenceImageStore,
  type StoryboardAssetStore,
} from "@ai-film-studio/storage";

type ShotContext = {
  project: Project;
  plan: StoryPlan;
  bible: Bible;
  coverage: ReferenceCoverage["shots"][number];
};

type LabelledReference = { label: string; reference: ReferenceImage };

type ProviderChoice = {
  provider: ImageProvider;
  model: ImageProviderModel;
  quality: ImageQuality;
};

const ownerLabels: Record<ReferenceOwnerType, string> = {
  character: "Character",
  location: "Location",
  prop: "Prop",
};

const referenceInstructions: Record<ReferenceOwnerType, string> = {
  character:
    "They show this same character; match the face, body, hair, wardrobe, and accessories exactly.",
  location:
    "They show this same location; match the layout, architecture, materials, and palette exactly.",
  prop: "They show this same prop; match the shape, proportions, materials, colors, and markings exactly.",
};

// Most useful view first when only some photos of an entity fit in a request.
const viewPreference: ReferenceImage["view"][] = [
  "three-quarter",
  "front",
  "full-body",
  "neutral",
  "interior",
  "exterior-day",
  "profile",
  "detail",
  "expression",
  "exterior-night",
  "other",
];

export class ImageGenerationService {
  private readonly providers: Map<CloudImageProviderId, ImageProvider>;
  private readonly running = new Set<Promise<void>>();

  constructor(
    private readonly generations: GenerationRepository,
    private readonly projects: ProjectRepository,
    private readonly storyPlans: StoryPlanRepository,
    private readonly bible: BibleRepository,
    private readonly storyboardAssets: StoryboardAssetStore,
    private readonly referenceImages: ReferenceImageStore,
    private readonly manifests: ManifestSynchronizer,
    providers: ImageProvider[] = [],
  ) {
    this.providers = new Map(
      providers.map((provider) => [provider.id, provider]),
    );
  }

  getHistory(projectId: string): ImageHistory {
    return this.generations.listProject(projectId);
  }

  providerStatuses(): ImageProviderStatus[] {
    return [...this.providers.values()].map((provider) => provider.status());
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
      references: this.references(context.coverage).map(
        (item) => item.reference,
      ),
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

  /**
   * Starts a paid storyboard generation and returns the attempt immediately;
   * the image is saved in the background and the attempt updates when done.
   */
  async generateShot(
    projectId: string,
    shotId: string,
    input: CreateCloudImage,
  ): Promise<ImageAttempt> {
    const context = this.requireReadyShot(projectId, shotId);
    const choice = this.requireChoice(input);
    const selection = await this.loadReferences(
      projectId,
      this.references(context.coverage),
      choice,
    );
    const prompt = withReferenceKey(
      context.coverage.prompt,
      selection.sent,
      "Use them as the exact identity, wardrobe, location, and prop references for this shot.",
    );
    const attempt = this.generations.beginCloudImage({
      projectId,
      shotId,
      provider: choice.provider.id,
      model: choice.model.id,
      prompt,
      negativePrompt: "",
      references: selection.sent.map((item) => item.reference),
      seed: null,
      settings: {
        source: "image-api",
        quality: choice.quality.id,
        aspectRatio: context.project.aspectRatio,
        estimatedUsdPerImage: choice.quality.estimatedUsdPerImage,
        skippedReferenceIds: selection.skipped.map((item) => item.reference.id),
      },
    });
    await this.manifests.drain();
    const task = this.completeShot(projectId, attempt, context, choice, {
      model: choice.model.id,
      quality: choice.quality.id,
      prompt,
      aspectRatio: context.project.aspectRatio,
      references: selection.inputs,
    }).finally(() => this.running.delete(task));
    this.running.add(task);
    return attempt;
  }

  /** Resolves when every background generation has finished. */
  async settle(): Promise<void> {
    await Promise.allSettled([...this.running]);
  }

  /** Generates a Visual Bible reference photo and stores it like an upload. */
  async generateReference(
    projectId: string,
    ownerType: ReferenceOwnerType,
    ownerId: string,
    input: CreateCloudReferenceImage,
  ): Promise<ReferenceImage> {
    const project = this.projects.getById(projectId);
    if (!project) throw new GenerationNotFoundError("Project");
    const bible = this.bible.list(projectId);
    const built = buildReferencePrompt(
      project,
      bible,
      ownerType,
      ownerId,
      input.view,
    );
    if (!built) throw new GenerationNotFoundError(ownerLabels[ownerType]);
    const choice = this.requireChoice(input);
    const entity = [
      ...bible.characters,
      ...bible.locations,
      ...bible.props,
    ].find((candidate) => candidate.id === ownerId);
    const selection = await this.loadReferences(
      projectId,
      prioritize([
        (entity?.references ?? []).map((reference) => ({
          label: `${built.ownerName} (${built.ownerCode})`,
          reference,
        })),
      ]),
      choice,
    );
    const image = await choice.provider.generate({
      model: choice.model.id,
      quality: choice.quality.id,
      prompt: withReferenceKey(
        built.prompt,
        selection.sent,
        referenceInstructions[ownerType],
      ),
      aspectRatio: referenceAspectRatios[ownerType],
      references: selection.inputs,
    });
    const stored = await this.referenceImages.save({
      projectId,
      ownerType,
      ownerId,
      originalFilename: built.filename.replace(
        /\.png$/,
        `-${choice.provider.id}.png`,
      ),
      declaredMimeType:
        detectImage(image.data)?.mimeType ?? "application/octet-stream",
      buffer: image.data,
    });
    try {
      const reference = this.bible.addReference(projectId, {
        ownerType,
        ownerId,
        view: input.view,
        ...stored,
      });
      await this.manifests.drain();
      return reference;
    } catch (error) {
      await this.referenceImages.remove(projectId, stored.relativePath);
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

  private async completeShot(
    projectId: string,
    attempt: ImageAttempt,
    context: ShotContext,
    choice: ProviderChoice,
    request: ImageGenerationInput,
  ): Promise<void> {
    const startedAt = Date.now();
    let storedPath: string | undefined;
    try {
      const image = await choice.provider.generate(request);
      const asset = await this.storyboardAssets.save({
        projectId,
        shotId: attempt.shotId,
        attemptId: attempt.id,
        originalFilename: `${context.coverage.shotCode}-${choice.provider.id}.png`,
        buffer: image.data,
      });
      storedPath = asset.relativePath;
      this.generations.completeAttempt(
        projectId,
        attempt.id,
        asset,
        Date.now() - startedAt,
        image.costMicros,
      );
    } catch (error) {
      try {
        if (storedPath) {
          await this.storyboardAssets.remove(projectId, storedPath);
        }
        this.generations.failAttempt(projectId, attempt.id, error);
      } catch {
        // The database may already be closed during shutdown; startup marks
        // the attempt as interrupted instead.
        return;
      }
    }
    try {
      await this.manifests.drain();
    } catch {
      // The manifest stays dirty and is written on the next successful drain.
    }
  }

  private requireChoice(input: {
    provider: CloudImageProviderId;
    model: string;
    quality: string;
  }): ProviderChoice {
    const provider = this.providers.get(input.provider);
    if (!provider) {
      throw new GenerationStateError(
        `${input.provider} image generation is not available.`,
      );
    }
    const status = provider.status();
    if (!status.configured) throw new GenerationStateError(status.message);
    const model = status.models.find(
      (candidate) => candidate.id === input.model,
    );
    if (!model) {
      throw new GenerationStateError(
        `${input.model} is not available for ${status.label}. Reload the page and choose another model.`,
      );
    }
    const quality = model.qualities.find(
      (candidate) => candidate.id === input.quality,
    );
    if (!quality) {
      throw new GenerationStateError(
        `${model.label} does not offer the ${input.quality} quality.`,
      );
    }
    return { provider, model, quality };
  }

  private async loadReferences(
    projectId: string,
    candidates: LabelledReference[],
    choice: ProviderChoice,
  ): Promise<{
    sent: LabelledReference[];
    skipped: LabelledReference[];
    inputs: ImageReferenceInput[];
  }> {
    const sent: LabelledReference[] = [];
    const skipped: LabelledReference[] = [];
    const inputs: ImageReferenceInput[] = [];
    let bytes = 0;
    for (const candidate of candidates) {
      const { reference } = candidate;
      if (
        inputs.length >= choice.model.maxReferenceImages ||
        bytes + reference.byteSize > choice.provider.maxReferenceBytes
      ) {
        skipped.push(candidate);
        continue;
      }
      try {
        inputs.push({
          filename: reference.originalFilename,
          mimeType: reference.mimeType,
          data: await readFile(
            this.referenceImages.absolutePath(
              projectId,
              reference.relativePath,
            ),
          ),
        });
      } catch {
        skipped.push(candidate);
        continue;
      }
      bytes += reference.byteSize;
      sent.push(candidate);
    }
    return { sent, skipped, inputs };
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
  ): LabelledReference[] {
    return prioritize(
      [
        ...coverage.characters,
        ...(coverage.location ? [coverage.location] : []),
        ...coverage.props,
      ].map((entity) =>
        entity.references.map((reference) => ({
          label: `${entity.name} (${entity.code})`,
          reference,
        })),
      ),
    );
  }
}

/**
 * Orders reference photos so each entity's best view comes before anyone's
 * second view, which keeps every subject represented when limits apply.
 */
function prioritize(groups: LabelledReference[][]): LabelledReference[] {
  const sorted = groups.map((group) =>
    [...group].sort(
      (left, right) =>
        viewPreference.indexOf(left.reference.view) -
        viewPreference.indexOf(right.reference.view),
    ),
  );
  const ordered: LabelledReference[] = [];
  const seen = new Set<string>();
  for (let round = 0; sorted.some((group) => group.length > round); round++) {
    for (const group of sorted) {
      const candidate = group[round];
      if (candidate && !seen.has(candidate.reference.id)) {
        seen.add(candidate.reference.id);
        ordered.push(candidate);
      }
    }
  }
  return ordered;
}

function withReferenceKey(
  prompt: string,
  sent: LabelledReference[],
  instruction: string,
): string {
  if (sent.length === 0) return prompt;
  const key = sent
    .map(
      (item, index) =>
        `${index + 1}. ${item.label} — ${item.reference.view.replaceAll("-", " ")} view`,
    )
    .join("\n");
  return `ATTACHED REFERENCE IMAGES, IN ORDER:\n${key}\n${instruction}\n\n${prompt}`;
}
