import { randomUUID } from "node:crypto";

import {
  authorProfileInputSchema,
  authorProfileSchema,
  bookMetadataRecordSchema,
  bookMetadataSchema,
  bookSchema,
  bookSummarySchema,
  conceptRecordSchema,
  createBookSchema,
  kdpSettingsSchema,
  provenanceRecordSchema,
  publicationRecordSchema,
  storyBriefSchema,
  storyConceptSchema,
  bookSettingsSchema,
  type AuthorProfile,
  type AuthorProfileInput,
  type Book,
  type BookListQuery,
  type BookMetadata,
  type BookMetadataRecord,
  type BookStage,
  type BookSummary,
  type ConceptRecord,
  type CreateBookInput,
  type KdpSettings,
  type ProvenanceAsset,
  type ProvenanceClass,
  type PublicationRecord,
  type StoryConcept,
  type UpdateAuthorProfile,
  type UpdateBook,
  type UpdatePublicationRecord,
} from "@ai-studio/contracts";

import type { DatabaseManager } from "./database-manager.js";

export class KdpNotFoundError extends Error {
  constructor(resource: string) {
    super(`${resource} was not found.`);
    this.name = "KdpNotFoundError";
  }
}

export class KdpConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "KdpConflictError";
  }
}

type BookRow = {
  id: string;
  owner_id: string;
  author_profile_id: string | null;
  title: string;
  subtitle: string | null;
  series_name: string | null;
  series_number: number | null;
  language: string;
  genre: string;
  subgenre: string | null;
  status: string;
  stage: string;
  brief_json: string;
  settings_json: string;
  selected_concept_id: string | null;
  current_cover_id: string | null;
  manuscript_approved_at: string | null;
  listing_approved_at: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

type SummaryRow = BookRow & {
  pen_name: string | null;
  actual_words: number | null;
  chapters_planned: number;
  chapters_drafted: number;
  chapters_approved: number;
  spent_micros: number | null;
  last_export_at: string | null;
  cover_path: string | null;
  job_id: string | null;
  job_kind: string | null;
  job_status: string | null;
  job_progress: number | null;
  job_label: string | null;
};

type AuthorRow = {
  id: string;
  owner_id: string;
  pen_name: string;
  profile_json: string;
  photo_path: string | null;
  is_default: 0 | 1;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

const now = () => new Date().toISOString();

function mapBook(row: BookRow): Book {
  return bookSchema.parse({
    id: row.id,
    ownerId: row.owner_id,
    authorProfileId: row.author_profile_id,
    title: row.title,
    subtitle: row.subtitle,
    seriesName: row.series_name,
    seriesNumber: row.series_number,
    language: row.language,
    genre: row.genre,
    subgenre: row.subgenre,
    status: row.status,
    stage: row.stage,
    brief: storyBriefSchema.parse(JSON.parse(row.brief_json) as unknown),
    settings: bookSettingsSchema.parse(
      JSON.parse(row.settings_json) as unknown,
    ),
    selectedConceptId: row.selected_concept_id,
    currentCoverId: row.current_cover_id,
    manuscriptApprovedAt: row.manuscript_approved_at,
    listingApprovedAt: row.listing_approved_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  });
}

function mapAuthor(row: AuthorRow): AuthorProfile {
  return authorProfileSchema.parse({
    ...(JSON.parse(row.profile_json) as object),
    id: row.id,
    ownerId: row.owner_id,
    penName: row.pen_name,
    isDefault: row.is_default === 1,
    photoPath: row.photo_path,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

const sortColumns: Record<BookListQuery["sort"], string> = {
  updated: "b.updated_at DESC",
  created: "b.created_at DESC",
  title: "b.title COLLATE NOCASE ASC",
  words: "actual_words DESC",
  status: "b.status ASC, b.updated_at DESC",
};

export class KdpBookRepository {
  constructor(private readonly manager: DatabaseManager) {}

  private get db() {
    return this.manager.connection;
  }

  // --- Settings --------------------------------------------------------------

  getSettings(ownerId: string, defaults: KdpSettings): KdpSettings {
    const row = this.db
      .prepare("SELECT settings_json FROM kdp_settings WHERE owner_id = ?")
      .get(ownerId) as { settings_json: string } | undefined;
    if (!row) return defaults;
    const stored = JSON.parse(row.settings_json) as Partial<KdpSettings>;
    return kdpSettingsSchema.parse({
      ...defaults,
      ...stored,
      routing: { ...defaults.routing, ...stored.routing },
    });
  }

  saveSettings(ownerId: string, settings: KdpSettings): KdpSettings {
    const parsed = kdpSettingsSchema.parse(settings);
    this.db
      .prepare(
        `INSERT INTO kdp_settings (owner_id, settings_json, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(owner_id) DO UPDATE SET
           settings_json = excluded.settings_json,
           updated_at = excluded.updated_at`,
      )
      .run(ownerId, JSON.stringify(parsed), now());
    return parsed;
  }

  // --- Author profiles ----------------------------------------------------------

  /** True once the owner has had any pen name, including deleted ones. */
  hasEverHadAuthor(ownerId: string): boolean {
    return (
      this.db
        .prepare("SELECT 1 FROM kdp_author_profiles WHERE owner_id = ? LIMIT 1")
        .get(ownerId) !== undefined
    );
  }

  listAuthors(ownerId: string): AuthorProfile[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM kdp_author_profiles
         WHERE owner_id = ? AND deleted_at IS NULL
         ORDER BY is_default DESC, pen_name COLLATE NOCASE`,
      )
      .all(ownerId) as AuthorRow[];
    return rows.map(mapAuthor);
  }

  getAuthor(ownerId: string, id: string): AuthorProfile | undefined {
    const row = this.db
      .prepare(
        "SELECT * FROM kdp_author_profiles WHERE id = ? AND owner_id = ? AND deleted_at IS NULL",
      )
      .get(id, ownerId) as AuthorRow | undefined;
    return row ? mapAuthor(row) : undefined;
  }

  requireAuthor(ownerId: string, id: string): AuthorProfile {
    const author = this.getAuthor(ownerId, id);
    if (!author) throw new KdpNotFoundError("Pen name");
    return author;
  }

  createAuthor(ownerId: string, input: AuthorProfileInput): AuthorProfile {
    const profile = authorProfileInputSchema.parse(input);
    const id = randomUUID();
    const timestamp = now();
    this.db.transaction(() => {
      const hasDefault = this.db
        .prepare(
          "SELECT 1 FROM kdp_author_profiles WHERE owner_id = ? AND is_default = 1 AND deleted_at IS NULL",
        )
        .get(ownerId);
      const isDefault = profile.isDefault || !hasDefault;
      if (isDefault) this.clearDefaultAuthor(ownerId);
      this.db
        .prepare(
          `INSERT INTO kdp_author_profiles
           (id, owner_id, pen_name, profile_json, photo_path, is_default, created_at, updated_at)
           VALUES (?, ?, ?, ?, NULL, ?, ?, ?)`,
        )
        .run(
          id,
          ownerId,
          profile.penName,
          JSON.stringify(profile),
          isDefault ? 1 : 0,
          timestamp,
          timestamp,
        );
    })();
    return this.requireAuthor(ownerId, id);
  }

  updateAuthor(
    ownerId: string,
    id: string,
    input: UpdateAuthorProfile,
  ): AuthorProfile {
    const existing = this.requireAuthor(ownerId, id);
    const profile = authorProfileInputSchema.parse({ ...existing, ...input });
    this.db.transaction(() => {
      if (profile.isDefault) this.clearDefaultAuthor(ownerId);
      this.db
        .prepare(
          `UPDATE kdp_author_profiles
           SET pen_name = ?, profile_json = ?, is_default = ?, updated_at = ?
           WHERE id = ? AND owner_id = ?`,
        )
        .run(
          profile.penName,
          JSON.stringify(profile),
          profile.isDefault ? 1 : 0,
          now(),
          id,
          ownerId,
        );
    })();
    return this.requireAuthor(ownerId, id);
  }

  setAuthorPhoto(
    ownerId: string,
    id: string,
    relativePath: string | null,
  ): AuthorProfile {
    this.requireAuthor(ownerId, id);
    this.db
      .prepare(
        "UPDATE kdp_author_profiles SET photo_path = ?, updated_at = ? WHERE id = ? AND owner_id = ?",
      )
      .run(relativePath, now(), id, ownerId);
    return this.requireAuthor(ownerId, id);
  }

  deleteAuthor(ownerId: string, id: string): void {
    this.requireAuthor(ownerId, id);
    const inUse = this.db
      .prepare(
        "SELECT COUNT(*) AS count FROM kdp_books WHERE author_profile_id = ? AND deleted_at IS NULL",
      )
      .get(id) as { count: number };
    if (inUse.count > 0) {
      throw new KdpConflictError(
        `This pen name is used by ${inUse.count} book(s); move them to another pen name first.`,
      );
    }
    this.db
      .prepare(
        "UPDATE kdp_author_profiles SET deleted_at = ?, is_default = 0 WHERE id = ? AND owner_id = ?",
      )
      .run(now(), id, ownerId);
  }

  private clearDefaultAuthor(ownerId: string): void {
    this.db
      .prepare(
        "UPDATE kdp_author_profiles SET is_default = 0 WHERE owner_id = ?",
      )
      .run(ownerId);
  }

  // --- Books -----------------------------------------------------------------

  list(ownerId: string, query: BookListQuery): BookSummary[] {
    const conditions = ["b.owner_id = ?"];
    const parameters: unknown[] = [ownerId];
    conditions.push(
      query.includeDeleted
        ? "b.deleted_at IS NOT NULL"
        : "b.deleted_at IS NULL",
    );
    if (query.status) {
      conditions.push("b.status = ?");
      parameters.push(query.status);
    }
    if (query.authorProfileId) {
      conditions.push("b.author_profile_id = ?");
      parameters.push(query.authorProfileId);
    }
    if (query.genre) {
      conditions.push(
        "(b.genre = ? COLLATE NOCASE OR b.subgenre = ? COLLATE NOCASE)",
      );
      parameters.push(query.genre, query.genre);
    }
    if (query.series) {
      conditions.push("b.series_name = ? COLLATE NOCASE");
      parameters.push(query.series);
    }
    if (query.search) {
      const escaped = `%${query.search.replace(/[\\%_]/g, "\\$&")}%`;
      conditions.push(
        "(b.title LIKE ? ESCAPE '\\' OR b.subtitle LIKE ? ESCAPE '\\' OR b.series_name LIKE ? ESCAPE '\\' OR a.pen_name LIKE ? ESCAPE '\\')",
      );
      parameters.push(escaped, escaped, escaped, escaped);
    }
    const rows = this.db
      .prepare(
        `${this.summarySelect()} WHERE ${conditions.join(" AND ")} ORDER BY ${sortColumns[query.sort]}`,
      )
      .all(...parameters) as SummaryRow[];
    return rows.map((row) => this.mapSummary(row));
  }

  summary(ownerId: string, bookId: string): BookSummary {
    const row = this.db
      .prepare(`${this.summarySelect()} WHERE b.id = ? AND b.owner_id = ?`)
      .get(bookId, ownerId) as SummaryRow | undefined;
    if (!row) throw new KdpNotFoundError("Book");
    return this.mapSummary(row);
  }

  private summarySelect(): string {
    return `
      SELECT b.*, a.pen_name,
        (SELECT SUM(word_count) FROM kdp_chapters c WHERE c.book_id = b.id AND c.deleted_at IS NULL) AS actual_words,
        (SELECT COUNT(*) FROM kdp_chapters c WHERE c.book_id = b.id AND c.deleted_at IS NULL) AS chapters_planned,
        (SELECT COUNT(*) FROM kdp_chapters c WHERE c.book_id = b.id AND c.deleted_at IS NULL AND c.word_count > 0) AS chapters_drafted,
        (SELECT COUNT(*) FROM kdp_chapters c WHERE c.book_id = b.id AND c.deleted_at IS NULL AND c.status = 'approved') AS chapters_approved,
        (SELECT SUM(cost_micros) FROM kdp_ai_runs r WHERE r.book_id = b.id) AS spent_micros,
        (SELECT MAX(created_at) FROM kdp_exports e WHERE e.book_id = b.id AND e.status = 'succeeded') AS last_export_at,
        (SELECT relative_path FROM kdp_cover_assets ca WHERE ca.id = b.current_cover_id) AS cover_path,
        j.id AS job_id, j.kind AS job_kind, j.status AS job_status,
        j.progress AS job_progress, j.progress_label AS job_label
      FROM kdp_books b
      LEFT JOIN kdp_author_profiles a ON a.id = b.author_profile_id
      LEFT JOIN kdp_jobs j ON j.id = (
        SELECT id FROM kdp_jobs WHERE book_id = b.id AND status IN ('queued', 'running')
        ORDER BY created_at LIMIT 1
      )`;
  }

  private mapSummary(row: SummaryRow): BookSummary {
    return bookSummarySchema.parse({
      ...mapBook(row),
      penName: row.pen_name,
      actualWords: row.actual_words ?? 0,
      chaptersPlanned: row.chapters_planned,
      chaptersDrafted: row.chapters_drafted,
      chaptersApproved: row.chapters_approved,
      spentMicros: row.spent_micros ?? 0,
      lastExportAt: row.last_export_at,
      coverThumbnail: row.cover_path ? row.current_cover_id : null,
      activeJob: row.job_id
        ? {
            id: row.job_id,
            kind: row.job_kind,
            status: row.job_status,
            progress: row.job_progress ?? 0,
            progressLabel: row.job_label,
          }
        : null,
    });
  }

  get(ownerId: string, bookId: string): Book | undefined {
    const row = this.db
      .prepare(
        "SELECT * FROM kdp_books WHERE id = ? AND owner_id = ? AND deleted_at IS NULL",
      )
      .get(bookId, ownerId) as BookRow | undefined;
    return row ? mapBook(row) : undefined;
  }

  /** Every book-scoped operation starts here: it enforces ownership. */
  require(ownerId: string, bookId: string): Book {
    const book = this.get(ownerId, bookId);
    if (!book) throw new KdpNotFoundError("Book");
    return book;
  }

  /** Worker access: the owner comes from the job row, not from a request. */
  getById(bookId: string): Book | undefined {
    const row = this.db
      .prepare("SELECT * FROM kdp_books WHERE id = ? AND deleted_at IS NULL")
      .get(bookId) as BookRow | undefined;
    return row ? mapBook(row) : undefined;
  }

  create(ownerId: string, input: CreateBookInput): Book {
    const parsed = createBookSchema.parse(input);
    const author = this.requireAuthor(ownerId, parsed.authorProfileId);
    const id = randomUUID();
    const timestamp = now();
    const title = parsed.title ?? parsed.brief.workingTitle ?? "Untitled book";
    this.db
      .prepare(
        `INSERT INTO kdp_books (
          id, owner_id, author_profile_id, title, subtitle, series_name, series_number,
          language, genre, subgenre, status, stage, brief_json, settings_json,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', 'brief', ?, ?, ?, ?)`,
      )
      .run(
        id,
        ownerId,
        author.id,
        title,
        parsed.subtitle,
        parsed.seriesName,
        parsed.seriesNumber,
        parsed.language,
        parsed.brief.genre,
        parsed.brief.subgenre,
        JSON.stringify(parsed.brief),
        JSON.stringify(parsed.settings),
        timestamp,
        timestamp,
      );
    return this.require(ownerId, id);
  }

  update(ownerId: string, bookId: string, input: UpdateBook): Book {
    const existing = this.require(ownerId, bookId);
    if (input.authorProfileId)
      this.requireAuthor(ownerId, input.authorProfileId);
    const brief = input.brief ?? existing.brief;
    const next = {
      ...existing,
      ...input,
      brief,
      genre: brief.genre,
      subgenre: brief.subgenre,
      settings: input.settings ?? existing.settings,
    };
    this.db
      .prepare(
        `UPDATE kdp_books SET
          author_profile_id = ?, title = ?, subtitle = ?, series_name = ?, series_number = ?,
          language = ?, genre = ?, subgenre = ?, status = ?, brief_json = ?, settings_json = ?,
          updated_at = ?
         WHERE id = ? AND owner_id = ?`,
      )
      .run(
        next.authorProfileId,
        next.title,
        next.subtitle,
        next.seriesName,
        next.seriesNumber,
        next.language,
        next.genre,
        next.subgenre,
        next.status,
        JSON.stringify(next.brief),
        JSON.stringify(next.settings),
        now(),
        bookId,
        ownerId,
      );
    return this.require(ownerId, bookId);
  }

  touch(bookId: string): void {
    this.db
      .prepare("UPDATE kdp_books SET updated_at = ? WHERE id = ?")
      .run(now(), bookId);
  }

  /** Stages only move forward automatically; users can always revisit earlier ones. */
  advanceStage(bookId: string, stage: BookStage): void {
    const order = [
      "brief",
      "concepts",
      "bible",
      "outline",
      "drafting",
      "editing",
      "publishing",
    ];
    const row = this.db
      .prepare("SELECT stage FROM kdp_books WHERE id = ?")
      .get(bookId) as { stage: string } | undefined;
    if (!row || order.indexOf(row.stage) >= order.indexOf(stage)) return;
    this.db
      .prepare("UPDATE kdp_books SET stage = ?, updated_at = ? WHERE id = ?")
      .run(stage, now(), bookId);
  }

  setApproval(
    ownerId: string,
    bookId: string,
    field: "manuscript" | "listing",
    approved: boolean,
  ): Book {
    this.require(ownerId, bookId);
    const column =
      field === "manuscript" ? "manuscript_approved_at" : "listing_approved_at";
    this.db
      .prepare(
        `UPDATE kdp_books SET ${column} = ?, updated_at = ? WHERE id = ? AND owner_id = ?`,
      )
      .run(approved ? now() : null, now(), bookId, ownerId);
    return this.require(ownerId, bookId);
  }

  setStatus(bookId: string, status: Book["status"]): void {
    this.db
      .prepare("UPDATE kdp_books SET status = ?, updated_at = ? WHERE id = ?")
      .run(status, now(), bookId);
  }

  setCurrentCover(bookId: string, coverId: string | null): void {
    this.db
      .prepare(
        "UPDATE kdp_books SET current_cover_id = ?, updated_at = ? WHERE id = ?",
      )
      .run(coverId, now(), bookId);
  }

  softDelete(ownerId: string, bookId: string): void {
    this.require(ownerId, bookId);
    this.db
      .prepare(
        "UPDATE kdp_books SET deleted_at = ?, updated_at = ? WHERE id = ? AND owner_id = ?",
      )
      .run(now(), now(), bookId, ownerId);
  }

  restore(ownerId: string, bookId: string): Book {
    const result = this.db
      .prepare(
        "UPDATE kdp_books SET deleted_at = NULL, updated_at = ? WHERE id = ? AND owner_id = ? AND deleted_at IS NOT NULL",
      )
      .run(now(), bookId, ownerId);
    if (result.changes === 0) throw new KdpNotFoundError("Deleted book");
    return this.require(ownerId, bookId);
  }

  /** Copies the brief, bible, chapters with their history, and the listing. */
  duplicate(ownerId: string, bookId: string): Book {
    const source = this.require(ownerId, bookId);
    const id = randomUUID();
    const timestamp = now();
    this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO kdp_books (
            id, owner_id, author_profile_id, title, subtitle, series_name, series_number,
            language, genre, subgenre, status, stage, brief_json, settings_json,
            selected_concept_id, created_at, updated_at
          ) SELECT ?, owner_id, author_profile_id, title || ' (copy)', subtitle, series_name,
            series_number, language, genre, subgenre, 'draft', stage, brief_json, settings_json,
            NULL, ?, ? FROM kdp_books WHERE id = ?`,
        )
        .run(id, timestamp, timestamp, source.id);
      const concepts = this.db
        .prepare("SELECT * FROM kdp_concepts WHERE book_id = ?")
        .all(source.id) as Array<{
        id: string;
        batch: number;
        position: number;
        concept_json: string;
        selected: number;
      }>;
      for (const concept of concepts) {
        const conceptId = randomUUID();
        this.db
          .prepare(
            `INSERT INTO kdp_concepts (id, book_id, batch, position, concept_json, selected, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            conceptId,
            id,
            concept.batch,
            concept.position,
            concept.concept_json,
            concept.selected,
            timestamp,
          );
        if (concept.selected) {
          this.db
            .prepare(
              "UPDATE kdp_books SET selected_concept_id = ? WHERE id = ?",
            )
            .run(conceptId, id);
        }
      }
      this.db
        .prepare(
          `INSERT INTO kdp_story_bibles (book_id, version, bible_json, updated_by, updated_at)
           SELECT ?, 1, bible_json, updated_by, ? FROM kdp_story_bibles WHERE book_id = ?`,
        )
        .run(id, timestamp, source.id);
      this.db
        .prepare(
          `INSERT INTO kdp_story_bible_versions (book_id, version, bible_json, updated_by, note, created_at)
           SELECT book_id, 1, bible_json, updated_by, 'Duplicated', ? FROM kdp_story_bibles WHERE book_id = ?`,
        )
        .run(timestamp, id);
      const chapters = this.db
        .prepare(
          "SELECT id FROM kdp_chapters WHERE book_id = ? AND deleted_at IS NULL",
        )
        .all(source.id) as Array<{ id: string }>;
      for (const chapter of chapters) {
        const chapterId = randomUUID();
        this.db
          .prepare(
            `INSERT INTO kdp_chapters (
              id, book_id, position, title, card_json, status, locked, approved_at, content,
              word_count, target_words, summary, author_notes, content_source, revision_count,
              created_at, updated_at
            ) SELECT ?, ?, position, title, card_json, status, locked, approved_at, content,
              word_count, target_words, summary, author_notes, content_source, revision_count, ?, ?
            FROM kdp_chapters WHERE id = ?`,
          )
          .run(chapterId, id, timestamp, timestamp, chapter.id);
        const revisions = this.db
          .prepare("SELECT * FROM kdp_chapter_revisions WHERE chapter_id = ?")
          .all(chapter.id) as Array<Record<string, unknown>>;
        for (const revision of revisions) {
          this.db
            .prepare(
              `INSERT INTO kdp_chapter_revisions
               (id, chapter_id, book_id, revision_number, content, word_count, source, note, job_id, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)`,
            )
            .run(
              randomUUID(),
              chapterId,
              id,
              revision.revision_number,
              revision.content,
              revision.word_count,
              revision.source,
              revision.note,
              revision.created_at,
            );
        }
      }
      this.db
        .prepare(
          `INSERT INTO kdp_book_metadata (book_id, metadata_json, generated_at, updated_at)
           SELECT ?, metadata_json, generated_at, ? FROM kdp_book_metadata WHERE book_id = ?`,
        )
        .run(id, timestamp, source.id);
      this.db
        .prepare(
          `INSERT INTO kdp_provenance (book_id, asset, classification, overridden, notes, updated_at)
           SELECT ?, asset, classification, overridden, notes, ? FROM kdp_provenance WHERE book_id = ?`,
        )
        .run(id, timestamp, source.id);
    })();
    return this.require(ownerId, id);
  }

  // --- Concepts ---------------------------------------------------------------

  listConcepts(bookId: string): ConceptRecord[] {
    const rows = this.db
      .prepare(
        "SELECT * FROM kdp_concepts WHERE book_id = ? ORDER BY batch DESC, position ASC",
      )
      .all(bookId) as Array<{
      id: string;
      book_id: string;
      batch: number;
      position: number;
      concept_json: string;
      selected: number;
      created_at: string;
    }>;
    return rows.map((row) =>
      conceptRecordSchema.parse({
        id: row.id,
        bookId: row.book_id,
        batch: row.batch,
        position: row.position,
        concept: JSON.parse(row.concept_json) as unknown,
        selected: row.selected === 1,
        createdAt: row.created_at,
      }),
    );
  }

  addConcepts(
    bookId: string,
    concepts: StoryConcept[],
    jobId: string | null,
  ): ConceptRecord[] {
    const row = this.db
      .prepare(
        "SELECT COALESCE(MAX(batch), 0) AS batch FROM kdp_concepts WHERE book_id = ?",
      )
      .get(bookId) as { batch: number };
    const batch = row.batch + 1;
    const timestamp = now();
    const insert = this.db.prepare(
      `INSERT INTO kdp_concepts (id, book_id, batch, position, concept_json, selected, job_id, created_at)
       VALUES (?, ?, ?, ?, ?, 0, ?, ?)`,
    );
    concepts.forEach((concept, position) =>
      insert.run(
        randomUUID(),
        bookId,
        batch,
        position,
        JSON.stringify(storyConceptSchema.parse(concept)),
        jobId,
        timestamp,
      ),
    );
    return this.listConcepts(bookId).filter(
      (concept) => concept.batch === batch,
    );
  }

  updateConcept(
    bookId: string,
    conceptId: string,
    concept: StoryConcept,
  ): ConceptRecord {
    const result = this.db
      .prepare(
        "UPDATE kdp_concepts SET concept_json = ? WHERE id = ? AND book_id = ?",
      )
      .run(
        JSON.stringify(storyConceptSchema.parse(concept)),
        conceptId,
        bookId,
      );
    if (result.changes === 0) throw new KdpNotFoundError("Concept");
    return this.listConcepts(bookId).find((item) => item.id === conceptId)!;
  }

  selectConcept(bookId: string, conceptId: string): ConceptRecord {
    const concept = this.listConcepts(bookId).find(
      (item) => item.id === conceptId,
    );
    if (!concept) throw new KdpNotFoundError("Concept");
    this.db.transaction(() => {
      this.db
        .prepare("UPDATE kdp_concepts SET selected = 0 WHERE book_id = ?")
        .run(bookId);
      this.db
        .prepare("UPDATE kdp_concepts SET selected = 1 WHERE id = ?")
        .run(conceptId);
      this.db
        .prepare(
          `UPDATE kdp_books SET selected_concept_id = ?,
             title = CASE WHEN title = 'Untitled book' THEN ? ELSE title END,
             updated_at = ? WHERE id = ?`,
        )
        .run(conceptId, concept.concept.workingTitle, now(), bookId);
    })();
    this.advanceStage(bookId, "bible");
    return { ...concept, selected: true };
  }

  selectedConcept(bookId: string): ConceptRecord | undefined {
    return this.listConcepts(bookId).find((concept) => concept.selected);
  }

  // --- Metadata, provenance, publication ---------------------------------------

  getMetadata(
    bookId: string,
    approvedAt: string | null,
  ): BookMetadataRecord | null {
    const row = this.db
      .prepare("SELECT * FROM kdp_book_metadata WHERE book_id = ?")
      .get(bookId) as
      | {
          book_id: string;
          metadata_json: string;
          generated_at: string | null;
          updated_at: string;
        }
      | undefined;
    if (!row) return null;
    return bookMetadataRecordSchema.parse({
      bookId: row.book_id,
      metadata: JSON.parse(row.metadata_json) as unknown,
      generatedAt: row.generated_at,
      updatedAt: row.updated_at,
      approvedAt,
    });
  }

  saveMetadata(
    bookId: string,
    metadata: BookMetadata,
    generated: boolean,
  ): void {
    const parsed = bookMetadataSchema.parse(metadata);
    const timestamp = now();
    this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO kdp_book_metadata (book_id, metadata_json, generated_at, updated_at)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(book_id) DO UPDATE SET
             metadata_json = excluded.metadata_json,
             generated_at = COALESCE(excluded.generated_at, kdp_book_metadata.generated_at),
             updated_at = excluded.updated_at`,
        )
        .run(
          bookId,
          JSON.stringify(parsed),
          generated ? timestamp : null,
          timestamp,
        );
      // Any change to the listing withdraws its approval.
      this.db
        .prepare(
          "UPDATE kdp_books SET listing_approved_at = NULL, updated_at = ? WHERE id = ?",
        )
        .run(timestamp, bookId);
    })();
  }

  listProvenance(bookId: string): Array<{
    asset: ProvenanceAsset;
    classification: ProvenanceClass;
    overridden: boolean;
    notes: string | null;
    updatedAt: string;
  }> {
    const rows = this.db
      .prepare("SELECT * FROM kdp_provenance WHERE book_id = ?")
      .all(bookId) as Array<{
      asset: ProvenanceAsset;
      classification: ProvenanceClass;
      overridden: number;
      notes: string | null;
      updated_at: string;
    }>;
    return rows.map((row) => ({
      asset: row.asset,
      classification: row.classification,
      overridden: row.overridden === 1,
      notes: row.notes,
      updatedAt: row.updated_at,
    }));
  }

  setProvenance(
    bookId: string,
    asset: ProvenanceAsset,
    classification: ProvenanceClass,
    overridden: boolean,
    notes: string | null,
  ): void {
    provenanceRecordSchema.shape.classification.parse(classification);
    this.db
      .prepare(
        `INSERT INTO kdp_provenance (book_id, asset, classification, overridden, notes, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(book_id, asset) DO UPDATE SET
           classification = excluded.classification,
           overridden = excluded.overridden,
           notes = excluded.notes,
           updated_at = excluded.updated_at`,
      )
      .run(bookId, asset, classification, overridden ? 1 : 0, notes, now());
  }

  getPublication(bookId: string): PublicationRecord {
    const row = this.db
      .prepare("SELECT * FROM kdp_publication_records WHERE book_id = ?")
      .get(bookId) as
      | {
          book_id: string;
          status: string;
          published_at: string | null;
          asin: string | null;
          amazon_url: string | null;
          final_title: string | null;
          notes: string | null;
          updated_at: string;
        }
      | undefined;
    return publicationRecordSchema.parse(
      row
        ? {
            bookId: row.book_id,
            status: row.status,
            publishedAt: row.published_at,
            asin: row.asin,
            amazonUrl: row.amazon_url,
            finalTitle: row.final_title,
            notes: row.notes,
            updatedAt: row.updated_at,
          }
        : {
            bookId,
            status: "not-published",
            publishedAt: null,
            asin: null,
            amazonUrl: null,
            finalTitle: null,
            notes: null,
            updatedAt: now(),
          },
    );
  }

  savePublication(
    bookId: string,
    input: UpdatePublicationRecord,
  ): PublicationRecord {
    const record = publicationRecordSchema.parse({
      ...this.getPublication(bookId),
      ...input,
      updatedAt: now(),
    });
    this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO kdp_publication_records
           (book_id, status, published_at, asin, amazon_url, final_title, notes, updated_at)
           VALUES (@bookId, @status, @publishedAt, @asin, @amazonUrl, @finalTitle, @notes, @updatedAt)
           ON CONFLICT(book_id) DO UPDATE SET
             status = excluded.status, published_at = excluded.published_at,
             asin = excluded.asin, amazon_url = excluded.amazon_url,
             final_title = excluded.final_title, notes = excluded.notes,
             updated_at = excluded.updated_at`,
        )
        .run(record);
      if (record.status === "live") this.setStatus(bookId, "published");
    })();
    return record;
  }

  // --- Generic artifacts --------------------------------------------------------

  addArtifact(
    bookId: string,
    kind: string,
    data: unknown,
    jobId: string | null,
  ): string {
    const id = randomUUID();
    this.db
      .prepare(
        "INSERT INTO kdp_artifacts (id, book_id, kind, data_json, job_id, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(id, bookId, kind, JSON.stringify(data), jobId, now());
    return id;
  }

  latestArtifact<T>(
    bookId: string,
    kind: string,
  ): { id: string; data: T; createdAt: string } | null {
    const row = this.db
      .prepare(
        "SELECT id, data_json, created_at FROM kdp_artifacts WHERE book_id = ? AND kind = ? ORDER BY created_at DESC LIMIT 1",
      )
      .get(bookId, kind) as
      { id: string; data_json: string; created_at: string } | undefined;
    return row
      ? {
          id: row.id,
          data: JSON.parse(row.data_json) as T,
          createdAt: row.created_at,
        }
      : null;
  }
}
