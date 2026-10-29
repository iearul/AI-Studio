import type {
  ProvenanceAsset,
  ProvenanceRecord,
} from "@ai-film-studio/contracts";
import {
  detectCoverProvenance,
  detectTextProvenance,
  type DetectedProvenance,
} from "@ai-film-studio/book-engine";
import {
  KdpConflictError,
  type KdpBookRepository,
  type KdpJobRepository,
  type KdpStoryRepository,
} from "@ai-film-studio/database";

const involvement: Partial<Record<ProvenanceRecord["classification"], number>> =
  {
    human: 0,
    "ai-assisted": 1,
    "ai-generated": 2,
  };

/**
 * Provenance is derived from what actually happened (revision sources, cover
 * declarations). A user override is kept, but the detected value is always
 * shown beside it so a wrong override is visible.
 */
export class KdpProvenanceService {
  constructor(
    private readonly books: KdpBookRepository,
    private readonly story: KdpStoryRepository,
    private readonly jobs: KdpJobRepository,
  ) {}

  detect(bookId: string): Record<ProvenanceAsset, DetectedProvenance> {
    const book = this.books.getById(bookId);
    const chapters = this.story.listChapters(bookId);
    const sources = this.story.revisionSources(bookId);
    const text = detectTextProvenance(
      chapters.map((chapter) => ({
        chapterNumber: chapter.number,
        hasText: chapter.wordCount > 0,
        revisionSources: sources.get(chapter.id) ?? [],
      })),
    );
    const covers = this.jobs.listCovers(bookId);
    const current = book?.currentCoverId
      ? (covers.find((item) => item.id === book.currentCoverId) ?? null)
      : null;
    const parent = current?.parentId
      ? (covers.find((item) => item.id === current.parentId) ?? null)
      : null;
    return {
      text,
      cover: detectCoverProvenance(current, parent),
      "interior-images": {
        classification: "not-applicable",
        reason: "The manuscript has no interior images.",
      },
      translation: {
        classification: "not-applicable",
        reason: "The book is written in its original language, not translated.",
      },
    };
  }

  /** Recomputes detected values and returns the effective records. */
  refresh(ownerId: string, bookId: string): ProvenanceRecord[] {
    this.books.require(ownerId, bookId);
    const detected = this.detect(bookId);
    const stored = new Map(
      this.books.listProvenance(bookId).map((record) => [record.asset, record]),
    );
    const assets: ProvenanceAsset[] = [
      "text",
      "cover",
      "interior-images",
      "translation",
    ];
    return assets.map((asset) => {
      const existing = stored.get(asset);
      const detection = detected[asset];
      if (!existing || !existing.overridden) {
        if (!existing || existing.classification !== detection.classification) {
          this.books.setProvenance(
            bookId,
            asset,
            detection.classification,
            false,
            existing?.notes ?? null,
          );
        }
      }
      const record = this.books
        .listProvenance(bookId)
        .find((item) => item.asset === asset)!;
      return {
        asset,
        classification: record.classification,
        detected: detection.classification,
        detectedReason: detection.reason,
        overridden: record.overridden,
        notes: record.notes,
        updatedAt: record.updatedAt,
      };
    });
  }

  override(
    ownerId: string,
    bookId: string,
    asset: ProvenanceAsset,
    classification: ProvenanceRecord["classification"],
    notes: string | null,
  ): ProvenanceRecord[] {
    this.books.require(ownerId, bookId);
    const detected = this.detect(bookId)[asset];
    const detectedLevel = involvement[detected.classification];
    const requestedLevel = involvement[classification];
    if (
      detectedLevel !== undefined &&
      requestedLevel !== undefined &&
      requestedLevel < detectedLevel
    ) {
      throw new KdpConflictError(
        `This ${asset} is recorded as ${detected.classification}: ${detected.reason} It cannot be marked as involving less AI than that.`,
      );
    }
    // An override that matches detection is not an override.
    this.books.setProvenance(
      bookId,
      asset,
      classification,
      classification !== detected.classification,
      notes,
    );
    return this.refresh(ownerId, bookId);
  }
}
