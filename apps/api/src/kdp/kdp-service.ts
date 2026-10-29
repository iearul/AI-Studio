import { randomUUID } from "node:crypto";

import type {
  BookReadiness,
  CoverAsset,
  CoverUploadFields,
  EditorialIssue,
  KdpJob,
  KdpProviderHealth,
  KdpSettings,
  KdpTask,
  PassageOperationInput,
  PassageResult,
  StartKdpJob,
  UpdateKdpSettings,
} from "@ai-studio/contracts";
import {
  defaultKdpSettings,
  evaluateReadiness,
  passagePrompt,
  plainTextToManuscript,
  validateCoverImage,
} from "@ai-studio/book-engine";
import { inspectImage } from "@ai-studio/book-export";
import {
  KdpConflictError,
  type KdpBookRepository,
  type KdpJobRepository,
  type KdpStoryRepository,
} from "@ai-studio/database";

import type { KdpAiRouter } from "./ai-router.js";
import type { BookFileStore } from "./book-files.js";
import type { KdpJobRunner } from "./job-runner.js";
import type { KdpProvenanceService } from "./provenance-service.js";

export class KdpCoverValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "KdpCoverValidationError";
  }
}

const extensions: Record<string, string> = {
  jpeg: ".jpg",
  png: ".png",
  webp: ".webp",
  tiff: ".tif",
};

const mimeTypes: Record<string, string> = {
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  tiff: "image/tiff",
};

export class KdpService {
  private healthCache: { at: number; value: KdpProviderHealth[] } | undefined;

  constructor(
    private readonly books: KdpBookRepository,
    private readonly story: KdpStoryRepository,
    private readonly jobs: KdpJobRepository,
    private readonly ai: KdpAiRouter,
    private readonly runner: KdpJobRunner,
    private readonly files: BookFileStore,
    private readonly provenance: KdpProvenanceService,
  ) {}

  settings(ownerId: string): KdpSettings {
    return this.books.getSettings(ownerId, defaultKdpSettings);
  }

  updateSettings(ownerId: string, input: UpdateKdpSettings): KdpSettings {
    const current = this.settings(ownerId);
    return this.books.saveSettings(ownerId, {
      ...current,
      ...input,
      routing: { ...current.routing, ...input.routing },
    });
  }

  /**
   * Provider status checks call the providers' model endpoints, so results are
   * cached for a minute. Keys never leave the server.
   */
  async health(force = false): Promise<KdpProviderHealth[]> {
    if (
      !force &&
      this.healthCache &&
      Date.now() - this.healthCache.at < 60_000
    ) {
      return this.healthCache.value;
    }
    const checkedAt = new Date().toISOString();
    const value = await Promise.all(
      this.ai.providerList().map(async (provider) => {
        const status = await provider.getStatus();
        return {
          id: status.id,
          name: status.name,
          configured: status.configured,
          available: status.available,
          model: status.model,
          message: status.message,
          checkedAt,
        };
      }),
    );
    this.healthCache = { at: Date.now(), value };
    return value;
  }

  // --- Jobs ----------------------------------------------------------------------

  startJob(
    ownerId: string,
    bookId: string,
    input: StartKdpJob,
  ): { job: KdpJob; created: boolean } {
    const book = this.books.require(ownerId, bookId);
    if (input.kind === "bible" && !this.books.selectedConcept(book.id)) {
      throw new KdpConflictError(
        "Choose a concept before building the story bible.",
      );
    }
    if (
      (input.kind === "outline" || input.kind === "architecture") &&
      !this.story.getBible(book.id)
    ) {
      throw new KdpConflictError(
        "Build the story bible before planning the plot.",
      );
    }
    if (
      input.kind === "draft" &&
      this.story.listChapters(book.id).length === 0
    ) {
      throw new KdpConflictError("Create the chapter outline before drafting.");
    }
    const { idempotencyKey, kind, ...rest } = input;
    const result = this.jobs.enqueue({
      ownerId,
      bookId: book.id,
      kind,
      idempotencyKey,
      input: rest,
    });
    if (!result.created) return result;
    this.jobs.progress(result.job.id, {
      estimatedCostMicros: this.estimateJob(ownerId, book.id, input),
    });
    if (this.runner.isRunning) this.runner.kick();
    return { job: this.jobs.requireJob(result.job.id), created: true };
  }

  /**
   * Rough cost of a job before it runs, from typical token counts per stage
   * and the current routing and prices. Actual cost is recorded per call.
   */
  estimateJob(
    ownerId: string,
    bookId: string,
    input: Omit<StartKdpJob, "idempotencyKey">,
  ): number {
    const book = this.books.require(ownerId, bookId);
    const settings = this.settings(ownerId);
    const estimate = (
      task: KdpTask,
      inputTokens: number,
      outputTokens: number,
    ) =>
      this.ai.estimateTokensMicros(
        settings,
        book,
        task,
        inputTokens,
        outputTokens,
      );
    const chapters = this.story.listChapterItems(book.id);
    const tokensFor = (words: number) => Math.round(words * 1.4);
    switch (input.kind) {
      case "concepts":
        return estimate("idea", 2_500, 3_500);
      case "bible":
        return estimate("architect", 3_000, 9_000);
      case "architecture":
        return estimate("architect", 10_000, 5_000);
      case "outline": {
        if (input.chapterIds?.length)
          return input.chapterIds.length * estimate("architect", 14_000, 900);
        const count = book.brief.chapterCount;
        const architecture = this.story.getBible(book.id)?.bible.architecture
          ? 0
          : estimate("architect", 10_000, 5_000);
        return (
          architecture + estimate("architect", 12_000, 600 * count + 1_000)
        );
      }
      case "draft": {
        const selected = chapters
          .filter(
            (chapter) =>
              !input.chapterIds || input.chapterIds.includes(chapter.id),
          )
          .filter((chapter) =>
            input.inspectOnly
              ? chapter.wordCount > 0
              : !chapter.locked &&
                chapter.status !== "approved" &&
                (input.regenerate === true || chapter.wordCount === 0),
          );
        return selected.reduce(
          (sum, chapter) =>
            sum +
            (input.inspectOnly
              ? 0
              : estimate("writer", 25_000, tokensFor(chapter.targetWords))) +
            estimate(
              "inspector",
              15_000 + tokensFor(chapter.targetWords),
              2_500,
            ),
          0,
        );
      }
      case "editorial": {
        const manuscript = tokensFor(
          chapters.reduce((sum, chapter) => sum + chapter.wordCount, 0),
        );
        const passes = input.passes ?? [
          "developmental",
          "continuity",
          "line",
          "copy",
          "originality",
        ];
        return passes.reduce(
          (sum, pass) =>
            sum +
            estimate(
              pass === "copy" ? "proofreader" : "reviewer",
              manuscript + 10_000,
              6_000,
            ),
          0,
        );
      }
      case "metadata":
        return estimate("metadata", 5_000 + chapters.length * 200, 2_500);
      case "cover-prompts":
        return estimate("cover", 3_000, 3_000);
    }
  }

  job(ownerId: string, bookId: string, jobId: string): KdpJob {
    this.books.require(ownerId, bookId);
    const job = this.jobs.requireJob(jobId);
    if (job.bookId !== bookId)
      throw new KdpConflictError("The job belongs to another book.");
    return job;
  }

  cancelJob(ownerId: string, bookId: string, jobId: string): KdpJob {
    this.job(ownerId, bookId, jobId);
    return this.runner.cancel(jobId);
  }

  resumeJob(ownerId: string, bookId: string, jobId: string): KdpJob {
    this.job(ownerId, bookId, jobId);
    const job = this.jobs.resume(jobId);
    if (this.runner.isRunning) this.runner.kick();
    return job;
  }

  // --- Passage operations ---------------------------------------------------------

  async passage(
    ownerId: string,
    bookId: string,
    chapterId: string,
    input: PassageOperationInput,
  ): Promise<PassageResult> {
    const book = this.books.require(ownerId, bookId);
    const chapter = this.story.getChapter(book.id, chapterId);
    const settings = this.settings(ownerId);
    const bible = this.story.getBible(book.id)?.bible ?? null;
    const index = chapter.content.indexOf(input.passage);
    const surrounding =
      index >= 0
        ? chapter.content.slice(
            Math.max(0, index - 2_000),
            Math.min(
              chapter.content.length,
              index + input.passage.length + 1_000,
            ),
          )
        : chapter.content.slice(0, 3_000);
    const before = this.jobs.spentMicros(book.id);
    const prose = await this.ai.prose(
      {
        ownerId,
        book,
        settings,
        jobId: null,
        stepKey: `passage:${chapterId}`,
        signal: AbortSignal.timeout(10 * 60_000),
      },
      input.operation === "fix-grammar" ? "proofreader" : "writer",
      passagePrompt(
        book,
        bible,
        input.operation,
        input.passage,
        surrounding,
        input.instruction,
      ),
      {
        expectedOutputTokens:
          Math.round(
            (input.passage.length / 4) *
              (input.operation === "expand" ? 2.5 : 1.2),
          ) + 200,
        maxOutputTokens: 16_000,
      },
    );
    const text = prose.text.trim();
    return {
      operation: input.operation,
      original: input.passage,
      replacement: /\*[^*\n]+\*/.test(text)
        ? text
        : plainTextToManuscript(text),
      notes: null,
      costMicros: this.jobs.spentMicros(book.id) - before,
    };
  }

  // --- Editorial -------------------------------------------------------------------

  /** Accepting an issue can apply its replacement text to the chapter. */
  updateIssue(
    ownerId: string,
    bookId: string,
    issueId: string,
    status: EditorialIssue["status"],
    apply: boolean,
  ): EditorialIssue {
    const book = this.books.require(ownerId, bookId);
    const issue = this.story.getIssue(book.id, issueId);
    if (apply && status === "accepted") {
      if (
        !issue.chapterId ||
        !issue.originalText ||
        issue.replacementText === null
      ) {
        throw new KdpConflictError(
          "This issue has no exact replacement to apply; edit the chapter yourself.",
        );
      }
      const chapter = this.story.getChapter(book.id, issue.chapterId);
      if (!chapter.content.includes(issue.originalText)) {
        throw new KdpConflictError(
          "The quoted text is no longer in the chapter. It may have been edited; apply the change yourself.",
        );
      }
      this.story.saveChapterText(book.id, chapter.id, {
        content: chapter.content.replace(
          issue.originalText,
          issue.replacementText,
        ),
        source: issue.kind === "copy" ? "ai-edit" : "editorial-accept",
        recordRevision: true,
        note: `Accepted ${issue.kind} edit: ${issue.issue}`.slice(0, 300),
      });
    }
    return this.story.setIssueStatus(book.id, issueId, status);
  }

  // --- Covers ----------------------------------------------------------------------

  async addCover(
    ownerId: string,
    bookId: string,
    fields: CoverUploadFields,
    upload: { filename: string; buffer: Buffer },
  ): Promise<CoverAsset> {
    const book = this.books.require(ownerId, bookId);
    if (upload.buffer.length === 0)
      throw new KdpCoverValidationError("The image is empty.");
    const info = inspectImage(upload.buffer);
    if (!info) {
      throw new KdpCoverValidationError("Use a JPEG, PNG, WebP or TIFF image.");
    }
    if (fields.parentId) this.jobs.getCover(book.id, fields.parentId);
    const mimeType = mimeTypes[info.format]!;
    const validation = validateCoverImage(
      {
        mimeType,
        width: info.width,
        height: info.height,
        colorModel: info.colorModel,
        byteSize: upload.buffer.length,
      },
      fields.kind,
    );
    const id = randomUUID();
    const relativePath = `covers/${id}${extensions[info.format]}`;
    const stored = await this.files.write(book.id, relativePath, upload.buffer);
    try {
      const cover = this.jobs.addCover({
        id,
        bookId: book.id,
        kind: fields.kind,
        source: fields.source,
        originalFilename:
          upload.filename.slice(0, 200) || `cover${extensions[info.format]}`,
        relativePath,
        mimeType,
        width: info.width,
        height: info.height,
        colorModel: info.colorModel,
        byteSize: stored.byteSize,
        sha256: stored.sha256,
        provenance: fields.provenance,
        provenanceNote: fields.provenanceNote ?? null,
        parentId: fields.parentId ?? null,
        settings: fields.settings ?? {},
        validation,
      });
      // A valid final cover becomes current; artwork never replaces a final cover.
      if (fields.kind === "final" && validation.ok)
        this.books.setCurrentCover(book.id, cover.id);
      this.provenance.refresh(ownerId, book.id);
      return this.jobs.getCover(book.id, cover.id);
    } catch (error) {
      await this.files.remove(book.id, relativePath);
      throw error;
    }
  }

  setCurrentCover(
    ownerId: string,
    bookId: string,
    coverId: string,
  ): CoverAsset {
    const book = this.books.require(ownerId, bookId);
    const cover = this.jobs.getCover(book.id, coverId);
    if (cover.kind !== "final" || !cover.validation.ok) {
      throw new KdpConflictError(
        "Only a final cover that passes the KDP checks can be the book's cover.",
      );
    }
    this.books.setCurrentCover(book.id, coverId);
    this.provenance.refresh(ownerId, book.id);
    return this.jobs.getCover(book.id, coverId);
  }

  coverFile(
    ownerId: string,
    bookId: string,
    coverId: string,
  ): { absolutePath: string; mimeType: string; byteSize: number } {
    const book = this.books.require(ownerId, bookId);
    const cover = this.jobs.getCover(book.id, coverId);
    return {
      absolutePath: this.files.absolutePath(
        book.id,
        this.jobs.coverPath(book.id, coverId),
      ),
      mimeType: cover.mimeType,
      byteSize: cover.byteSize,
    };
  }

  // --- Readiness ---------------------------------------------------------------------

  readiness(ownerId: string, bookId: string): BookReadiness {
    const book = this.books.require(ownerId, bookId);
    const author = book.authorProfileId
      ? (this.books.getAuthor(ownerId, book.authorProfileId) ?? null)
      : null;
    const chapters = this.story.listChapterItems(book.id);
    const metadata = this.books.getMetadata(book.id, book.listingApprovedAt);
    const covers = this.jobs.listCovers(book.id);
    const cover =
      covers.find((item) => item.id === book.currentCoverId) ?? null;
    const latestExport = this.jobs.listExports(book.id)[0] ?? null;
    const contentUpdatedAt =
      [
        ...chapters.map((chapter) => chapter.updatedAt),
        metadata?.updatedAt ?? "",
        cover?.createdAt ?? "",
        author?.updatedAt ?? "",
      ]
        .sort()
        .pop() ?? book.updatedAt;
    return evaluateReadiness({
      book,
      author,
      chapters,
      openIssues: this.story.listIssues(book.id, { status: "open" }),
      editorialPassesRun: this.story.passesRun(book.id),
      metadata,
      cover,
      latestExport,
      provenance: this.provenance.refresh(ownerId, book.id),
      contentUpdatedAt,
    });
  }

  /** Ready for KDP needs passing checks plus the author's explicit approvals. */
  syncReadyStatus(ownerId: string, bookId: string): BookReadiness {
    const readiness = this.readiness(ownerId, bookId);
    const book = this.books.require(ownerId, bookId);
    if (book.status === "draft" && readiness.readyForKdp)
      this.books.setStatus(book.id, "ready");
    if (book.status === "ready" && !readiness.readyForKdp)
      this.books.setStatus(book.id, "draft");
    return readiness;
  }
}
