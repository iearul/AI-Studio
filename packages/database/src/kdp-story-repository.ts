import { randomUUID } from "node:crypto";

import {
  canonChangeSchema,
  chapterCardSchema,
  chapterRevisionSchema,
  chapterSchema,
  chapterSummaryListItemSchema,
  editorialIssueSchema,
  editorialReviewSchema,
  storyBibleRecordSchema,
  storyBibleSchema,
  type CanonChange,
  type Chapter,
  type ChapterCard,
  type ChapterListItem,
  type ChapterRevision,
  type ContentSource,
  type EditorialFinding,
  type EditorialIssue,
  type EditorialKind,
  type EditorialReview,
  type RevisionSource,
  type StoryBible,
  type StoryBibleRecord,
} from "@ai-studio/contracts";
import {
  countManuscriptWords,
  normalizeManuscript,
} from "@ai-studio/book-engine";

import type { DatabaseManager } from "./database-manager.js";
import { KdpConflictError, KdpNotFoundError } from "./kdp-book-repository.js";

type ChapterRow = {
  id: string;
  book_id: string;
  position: number;
  title: string | null;
  card_json: string;
  status: string;
  locked: 0 | 1;
  approved_at: string | null;
  content: string;
  word_count: number;
  target_words: number;
  summary: string | null;
  author_notes: string | null;
  content_source: string;
  revision_count: number;
  created_at: string;
  updated_at: string;
};

type IssueRow = {
  id: string;
  book_id: string;
  review_id: string | null;
  chapter_id: string | null;
  chapter_number: number | null;
  kind: string;
  severity: string;
  issue: string;
  location: string;
  evidence: string;
  suggestion: string;
  original_text: string | null;
  replacement_text: string | null;
  status: string;
  created_at: string;
  updated_at: string;
};

const now = () => new Date().toISOString();

function mapChapter(row: ChapterRow, number: number): Chapter {
  return chapterSchema.parse({
    id: row.id,
    bookId: row.book_id,
    position: row.position,
    number,
    title: row.title,
    card: JSON.parse(row.card_json) as unknown,
    status: row.status,
    locked: row.locked === 1,
    approvedAt: row.approved_at,
    content: row.content,
    wordCount: row.word_count,
    targetWords: row.target_words,
    summary: row.summary,
    authorNotes: row.author_notes,
    contentSource: row.content_source,
    revisionCount: row.revision_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

function mapIssue(row: IssueRow): EditorialIssue {
  return editorialIssueSchema.parse({
    id: row.id,
    bookId: row.book_id,
    reviewId: row.review_id,
    chapterId: row.chapter_id,
    chapterNumber: row.chapter_number,
    kind: row.kind,
    severity: row.severity,
    issue: row.issue,
    location: row.location,
    evidence: row.evidence,
    suggestion: row.suggestion,
    originalText: row.original_text,
    replacementText: row.replacement_text,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

const aiSources = new Set<RevisionSource>([
  "ai-draft",
  "ai-expansion",
  "ai-rewrite",
]);

function nextContentSource(
  current: ContentSource,
  source: RevisionSource,
): ContentSource {
  const incoming: ContentSource = aiSources.has(source)
    ? "ai"
    : source === "restore"
      ? current
      : "human";
  if (current === "none") return incoming;
  if (current === incoming) return current;
  return "mixed";
}

export type SaveChapterTextInput = {
  content: string;
  source: RevisionSource;
  /** False for autosave: the working copy changes without a new revision. */
  recordRevision: boolean;
  note?: string | null;
  jobId?: string | null;
  /** Reject when the chapter changed since the editor loaded it. */
  baseRevisionCount?: number;
  /** AI writes are refused on locked or approved chapters. */
  allowLocked?: boolean;
  /** Autosave also snapshots a revision when the last one is this old. */
  snapshotAfterMs?: number;
};

export class KdpStoryRepository {
  constructor(private readonly manager: DatabaseManager) {}

  private get db() {
    return this.manager.connection;
  }

  // --- Story bible ----------------------------------------------------------

  getBible(bookId: string): StoryBibleRecord | null {
    const row = this.db
      .prepare("SELECT * FROM kdp_story_bibles WHERE book_id = ?")
      .get(bookId) as
      | {
          book_id: string;
          version: number;
          bible_json: string;
          updated_by: string;
          updated_at: string;
        }
      | undefined;
    if (!row) return null;
    return storyBibleRecordSchema.parse({
      bookId: row.book_id,
      version: row.version,
      bible: JSON.parse(row.bible_json) as unknown,
      updatedAt: row.updated_at,
      updatedBy: row.updated_by,
    });
  }

  /**
   * Saves a new bible version. With `baseVersion`, a stale edit is rejected
   * instead of silently overwriting newer canon.
   */
  saveBible(
    bookId: string,
    bible: StoryBible,
    updatedBy: StoryBibleRecord["updatedBy"],
    options: { baseVersion?: number; note?: string } = {},
  ): StoryBibleRecord {
    const parsed = storyBibleSchema.parse(bible);
    const timestamp = now();
    this.db.transaction(() => {
      const current = this.db
        .prepare("SELECT version FROM kdp_story_bibles WHERE book_id = ?")
        .get(bookId) as { version: number } | undefined;
      if (
        options.baseVersion !== undefined &&
        current &&
        current.version !== options.baseVersion
      ) {
        throw new KdpConflictError(
          "The story bible changed since you opened it (for example after a chapter inspection). Reload and apply your edit again.",
        );
      }
      const version = (current?.version ?? 0) + 1;
      const json = JSON.stringify(parsed);
      this.db
        .prepare(
          `INSERT INTO kdp_story_bibles (book_id, version, bible_json, updated_by, updated_at)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(book_id) DO UPDATE SET version = excluded.version,
             bible_json = excluded.bible_json, updated_by = excluded.updated_by,
             updated_at = excluded.updated_at`,
        )
        .run(bookId, version, json, updatedBy, timestamp);
      this.db
        .prepare(
          `INSERT INTO kdp_story_bible_versions (book_id, version, bible_json, updated_by, note, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(bookId, version, json, updatedBy, options.note ?? null, timestamp);
      this.db
        .prepare("UPDATE kdp_books SET updated_at = ? WHERE id = ?")
        .run(timestamp, bookId);
    })();
    return this.getBible(bookId)!;
  }

  listBibleVersions(bookId: string): Array<{
    version: number;
    updatedBy: string;
    note: string | null;
    createdAt: string;
  }> {
    const rows = this.db
      .prepare(
        "SELECT version, updated_by, note, created_at FROM kdp_story_bible_versions WHERE book_id = ? ORDER BY version DESC",
      )
      .all(bookId) as Array<{
      version: number;
      updated_by: string;
      note: string | null;
      created_at: string;
    }>;
    return rows.map((row) => ({
      version: row.version,
      updatedBy: row.updated_by,
      note: row.note,
      createdAt: row.created_at,
    }));
  }

  recordCanonChange(input: {
    bookId: string;
    chapterId: string | null;
    source: CanonChange["source"];
    change: string;
    reason: string | null;
    status: CanonChange["status"];
  }): void {
    this.db
      .prepare(
        `INSERT INTO kdp_canon_changes (id, book_id, chapter_id, source, change, reason, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        randomUUID(),
        input.bookId,
        input.chapterId,
        input.source,
        input.change,
        input.reason,
        input.status,
        now(),
      );
  }

  listCanonChanges(bookId: string): CanonChange[] {
    const rows = this.db
      .prepare(
        "SELECT * FROM kdp_canon_changes WHERE book_id = ? ORDER BY created_at DESC",
      )
      .all(bookId) as Array<Record<string, string | null>>;
    return rows.map((row) =>
      canonChangeSchema.parse({
        id: row.id,
        bookId: row.book_id,
        chapterId: row.chapter_id,
        source: row.source,
        change: row.change,
        reason: row.reason,
        status: row.status,
        createdAt: row.created_at,
      }),
    );
  }

  // --- Chapters --------------------------------------------------------------

  listChapters(bookId: string): Chapter[] {
    const rows = this.db
      .prepare(
        "SELECT * FROM kdp_chapters WHERE book_id = ? AND deleted_at IS NULL ORDER BY position ASC, created_at ASC",
      )
      .all(bookId) as ChapterRow[];
    return rows.map((row, index) => mapChapter(row, index + 1));
  }

  listChapterItems(bookId: string): ChapterListItem[] {
    return this.listChapters(bookId).map((chapter) =>
      chapterSummaryListItemSchema.parse(chapter),
    );
  }

  getChapter(bookId: string, chapterId: string): Chapter {
    const chapter = this.listChapters(bookId).find(
      (item) => item.id === chapterId,
    );
    if (!chapter) throw new KdpNotFoundError("Chapter");
    return chapter;
  }

  /**
   * Replaces the outline. Chapters with text, locked or approved chapters are
   * kept (moved after the new cards) so no written work is ever discarded.
   */
  replaceOutline(bookId: string, cards: ChapterCard[]): Chapter[] {
    const timestamp = now();
    this.db.transaction(() => {
      const existing = this.listChapters(bookId);
      const written = existing.filter(
        (chapter) =>
          chapter.locked ||
          chapter.status === "approved" ||
          chapter.wordCount > 0,
      );
      if (written.length > 0) {
        throw new KdpConflictError(
          `${written.length} chapter(s) already have text or are locked. Regenerate single cards instead, or delete those chapters first.`,
        );
      }
      this.db
        .prepare(
          "UPDATE kdp_chapters SET deleted_at = ? WHERE book_id = ? AND deleted_at IS NULL",
        )
        .run(timestamp, bookId);
      cards.forEach((card, position) => {
        const parsed = chapterCardSchema.parse(card);
        this.db
          .prepare(
            `INSERT INTO kdp_chapters (id, book_id, position, title, card_json, target_words, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            randomUUID(),
            bookId,
            position,
            parsed.title,
            JSON.stringify(parsed),
            parsed.targetWords,
            timestamp,
            timestamp,
          );
      });
      this.db
        .prepare("UPDATE kdp_books SET updated_at = ? WHERE id = ?")
        .run(timestamp, bookId);
    })();
    return this.listChapters(bookId);
  }

  addChapter(
    bookId: string,
    card: ChapterCard,
    afterChapterId: string | null,
  ): Chapter {
    const parsed = chapterCardSchema.parse(card);
    const chapters = this.listChapters(bookId);
    const afterIndex = afterChapterId
      ? chapters.findIndex((chapter) => chapter.id === afterChapterId)
      : -1;
    if (afterChapterId && afterIndex < 0) throw new KdpNotFoundError("Chapter");
    const id = randomUUID();
    const timestamp = now();
    this.db.transaction(() => {
      const ordered = [...chapters.map((chapter) => chapter.id)];
      ordered.splice(afterIndex + 1, 0, id);
      this.db
        .prepare(
          `INSERT INTO kdp_chapters (id, book_id, position, title, card_json, target_words, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          bookId,
          afterIndex + 1,
          parsed.title,
          JSON.stringify(parsed),
          parsed.targetWords,
          timestamp,
          timestamp,
        );
      this.applyOrder(ordered);
    })();
    return this.getChapter(bookId, id);
  }

  reorder(bookId: string, chapterIds: string[]): Chapter[] {
    const chapters = this.listChapters(bookId);
    const known = new Set(chapters.map((chapter) => chapter.id));
    if (
      chapterIds.length !== chapters.length ||
      chapterIds.some((id) => !known.has(id))
    ) {
      throw new KdpConflictError(
        "The new order must list every chapter exactly once.",
      );
    }
    this.db.transaction(() => this.applyOrder(chapterIds))();
    return this.listChapters(bookId);
  }

  private applyOrder(ids: string[]): void {
    const statement = this.db.prepare(
      "UPDATE kdp_chapters SET position = ? WHERE id = ?",
    );
    ids.forEach((id, position) => statement.run(position, id));
  }

  updateChapter(
    bookId: string,
    chapterId: string,
    input: {
      title?: string | null;
      card?: ChapterCard;
      locked?: boolean;
      approved?: boolean;
      authorNotes?: string | null;
    },
  ): Chapter {
    const chapter = this.getChapter(bookId, chapterId);
    const card = input.card
      ? chapterCardSchema.parse(input.card)
      : chapter.card;
    const title =
      input.title !== undefined
        ? input.title
        : input.card
          ? card.title
          : chapter.title;
    const approved = input.approved ?? chapter.status === "approved";
    const status = approved
      ? "approved"
      : chapter.status === "approved"
        ? chapter.revisionCount > 1
          ? "revised"
          : "drafted"
        : chapter.status;
    this.db
      .prepare(
        `UPDATE kdp_chapters SET title = ?, card_json = ?, target_words = ?, locked = ?,
           status = ?, approved_at = ?, author_notes = ?, updated_at = ?
         WHERE id = ? AND book_id = ?`,
      )
      .run(
        title,
        JSON.stringify({ ...card, title }),
        card.targetWords,
        (input.locked ?? chapter.locked) ? 1 : 0,
        status,
        approved ? (chapter.approvedAt ?? now()) : null,
        input.authorNotes !== undefined
          ? input.authorNotes
          : chapter.authorNotes,
        now(),
        chapterId,
        bookId,
      );
    return this.getChapter(bookId, chapterId);
  }

  deleteChapter(bookId: string, chapterId: string): void {
    const chapter = this.getChapter(bookId, chapterId);
    if (chapter.locked)
      throw new KdpConflictError("Unlock the chapter before deleting it.");
    this.db.transaction(() => {
      this.db
        .prepare("UPDATE kdp_chapters SET deleted_at = ? WHERE id = ?")
        .run(now(), chapterId);
      this.applyOrder(this.listChapters(bookId).map((item) => item.id));
    })();
  }

  setChapterStatus(chapterId: string, status: Chapter["status"]): void {
    this.db
      .prepare(
        "UPDATE kdp_chapters SET status = ?, updated_at = ? WHERE id = ?",
      )
      .run(status, now(), chapterId);
  }

  setSummary(chapterId: string, summary: string): void {
    this.db
      .prepare("UPDATE kdp_chapters SET summary = ? WHERE id = ?")
      .run(summary, chapterId);
  }

  /**
   * The only write path for chapter text. Locked and approved chapters only
   * accept writes the user made (or explicitly allowed).
   */
  saveChapterText(
    bookId: string,
    chapterId: string,
    input: SaveChapterTextInput,
  ): Chapter {
    const content = normalizeManuscript(input.content);
    const wordCount = countManuscriptWords(content);
    const timestamp = now();
    this.db.transaction(() => {
      const chapter = this.getChapter(bookId, chapterId);
      if (
        (chapter.locked || chapter.status === "approved") &&
        !input.allowLocked
      ) {
        throw new KdpConflictError(
          `Chapter ${chapter.number} is ${chapter.locked ? "locked" : "approved"}; unlock it before changing its text.`,
        );
      }
      if (
        input.baseRevisionCount !== undefined &&
        input.baseRevisionCount !== chapter.revisionCount
      ) {
        throw new KdpConflictError(
          "This chapter changed in another window or by a generation job. Reload it before saving.",
        );
      }
      const source = nextContentSource(chapter.contentSource, input.source);
      const textChanged = content !== chapter.content;
      // Revisions compare with the last revision, not the working copy, so
      // text that autosave already stored still gets its manual revision.
      const last = this.db
        .prepare(
          "SELECT content, created_at FROM kdp_chapter_revisions WHERE chapter_id = ? ORDER BY revision_number DESC LIMIT 1",
        )
        .get(chapterId) as { content: string; created_at: string } | undefined;
      const differsFromLast = !last || last.content !== content;
      const snapshotDue =
        input.snapshotAfterMs !== undefined &&
        (!last ||
          Date.now() - Date.parse(last.created_at) >= input.snapshotAfterMs);
      let revisionCount = chapter.revisionCount;
      if ((input.recordRevision || snapshotDue) && differsFromLast) {
        revisionCount += 1;
        this.db
          .prepare(
            `INSERT INTO kdp_chapter_revisions
             (id, chapter_id, book_id, revision_number, content, word_count, source, note, job_id, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            randomUUID(),
            chapterId,
            bookId,
            revisionCount,
            content,
            wordCount,
            input.source,
            input.note ?? null,
            input.jobId ?? null,
            timestamp,
          );
      }
      const status =
        chapter.status === "approved"
          ? "approved"
          : wordCount === 0
            ? "planned"
            : input.source === "ai-draft" && chapter.status !== "revised"
              ? "drafted"
              : chapter.status === "planned" || chapter.status === "drafting"
                ? "drafted"
                : "revised";
      this.db
        .prepare(
          `UPDATE kdp_chapters SET content = ?, word_count = ?, content_source = ?,
             revision_count = ?, status = ?, updated_at = ?
           WHERE id = ?`,
        )
        .run(
          content,
          wordCount,
          textChanged || input.recordRevision ? source : chapter.contentSource,
          revisionCount,
          status,
          timestamp,
          chapterId,
        );
      this.db
        .prepare("UPDATE kdp_books SET updated_at = ? WHERE id = ?")
        .run(timestamp, bookId);
    })();
    return this.getChapter(bookId, chapterId);
  }

  listRevisions(bookId: string, chapterId: string): ChapterRevision[] {
    this.getChapter(bookId, chapterId);
    const rows = this.db
      .prepare(
        "SELECT * FROM kdp_chapter_revisions WHERE chapter_id = ? ORDER BY revision_number DESC",
      )
      .all(chapterId) as Array<Record<string, string | number | null>>;
    return rows.map((row) =>
      chapterRevisionSchema.parse({
        id: row.id,
        chapterId: row.chapter_id,
        bookId: row.book_id,
        revisionNumber: row.revision_number,
        content: row.content,
        wordCount: row.word_count,
        source: row.source,
        note: row.note,
        jobId: row.job_id,
        createdAt: row.created_at,
      }),
    );
  }

  revisionSources(bookId: string): Map<string, RevisionSource[]> {
    const rows = this.db
      .prepare(
        "SELECT chapter_id, source FROM kdp_chapter_revisions WHERE book_id = ?",
      )
      .all(bookId) as Array<{ chapter_id: string; source: RevisionSource }>;
    const map = new Map<string, RevisionSource[]>();
    for (const row of rows)
      map.set(row.chapter_id, [...(map.get(row.chapter_id) ?? []), row.source]);
    return map;
  }

  restoreRevision(
    bookId: string,
    chapterId: string,
    revisionId: string,
  ): Chapter {
    const revision = this.listRevisions(bookId, chapterId).find(
      (item) => item.id === revisionId,
    );
    if (!revision) throw new KdpNotFoundError("Revision");
    return this.saveChapterText(bookId, chapterId, {
      content: revision.content,
      source: "restore",
      recordRevision: true,
      note: `Restored revision ${revision.revisionNumber}`,
    });
  }

  // --- Editorial ----------------------------------------------------------------

  addReview(input: {
    bookId: string;
    kind: EditorialKind;
    jobId: string | null;
    summary: string;
    strengths: string[];
    chapterIds: string[];
    findings: Array<EditorialFinding & { chapterId: string | null }>;
  }): EditorialReview {
    const id = randomUUID();
    const timestamp = now();
    this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO kdp_editorial_reviews (id, book_id, kind, job_id, summary, strengths_json, chapter_ids_json, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          input.bookId,
          input.kind,
          input.jobId,
          input.summary,
          JSON.stringify(input.strengths),
          JSON.stringify(input.chapterIds),
          timestamp,
        );
      for (const finding of input.findings) {
        this.insertIssue({
          ...finding,
          bookId: input.bookId,
          reviewId: id,
          kind: input.kind,
        });
      }
    })();
    return this.listReviews(input.bookId).find((review) => review.id === id)!;
  }

  insertIssue(
    input: EditorialFinding & {
      bookId: string;
      reviewId: string | null;
      chapterId: string | null;
      kind: EditorialKind;
    },
  ): void {
    const timestamp = now();
    this.db
      .prepare(
        `INSERT INTO kdp_editorial_issues (
          id, book_id, review_id, chapter_id, chapter_number, kind, severity, issue, location,
          evidence, suggestion, original_text, replacement_text, status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?)`,
      )
      .run(
        randomUUID(),
        input.bookId,
        input.reviewId,
        input.chapterId,
        input.chapterNumber,
        input.kind,
        input.severity,
        input.issue,
        input.location,
        input.evidence,
        input.suggestion,
        input.originalText,
        input.replacementText,
        timestamp,
        timestamp,
      );
  }

  /** Style findings are recomputed on demand; old open ones are replaced. */
  replaceOpenIssues(
    bookId: string,
    kind: EditorialKind,
    chapterId: string | null,
    findings: Array<EditorialFinding & { chapterId: string | null }>,
  ): void {
    this.db.transaction(() => {
      if (chapterId) {
        this.db
          .prepare(
            "DELETE FROM kdp_editorial_issues WHERE book_id = ? AND kind = ? AND chapter_id = ? AND status = 'open'",
          )
          .run(bookId, kind, chapterId);
      } else {
        this.db
          .prepare(
            "DELETE FROM kdp_editorial_issues WHERE book_id = ? AND kind = ? AND status = 'open'",
          )
          .run(bookId, kind);
      }
      for (const finding of findings) {
        this.insertIssue({ ...finding, bookId, reviewId: null, kind });
      }
    })();
  }

  listReviews(bookId: string): EditorialReview[] {
    const rows = this.db
      .prepare(
        "SELECT * FROM kdp_editorial_reviews WHERE book_id = ? ORDER BY created_at DESC",
      )
      .all(bookId) as Array<Record<string, string | null>>;
    return rows.map((row) =>
      editorialReviewSchema.parse({
        id: row.id,
        bookId: row.book_id,
        kind: row.kind,
        jobId: row.job_id,
        summary: row.summary,
        strengths: JSON.parse(row.strengths_json ?? "[]") as unknown,
        chapterIds: JSON.parse(row.chapter_ids_json ?? "[]") as unknown,
        createdAt: row.created_at,
      }),
    );
  }

  listIssues(
    bookId: string,
    filter: { status?: EditorialIssue["status"]; chapterId?: string } = {},
  ): EditorialIssue[] {
    const conditions = ["book_id = ?"];
    const parameters: unknown[] = [bookId];
    if (filter.status) {
      conditions.push("status = ?");
      parameters.push(filter.status);
    }
    if (filter.chapterId) {
      conditions.push("chapter_id = ?");
      parameters.push(filter.chapterId);
    }
    const rows = this.db
      .prepare(
        `SELECT * FROM kdp_editorial_issues WHERE ${conditions.join(" AND ")}
         ORDER BY CASE severity WHEN 'critical' THEN 0 WHEN 'major' THEN 1 WHEN 'minor' THEN 2 ELSE 3 END, created_at DESC`,
      )
      .all(...parameters) as IssueRow[];
    return rows.map(mapIssue);
  }

  getIssue(bookId: string, issueId: string): EditorialIssue {
    const row = this.db
      .prepare(
        "SELECT * FROM kdp_editorial_issues WHERE id = ? AND book_id = ?",
      )
      .get(issueId, bookId) as IssueRow | undefined;
    if (!row) throw new KdpNotFoundError("Editorial issue");
    return mapIssue(row);
  }

  setIssueStatus(
    bookId: string,
    issueId: string,
    status: EditorialIssue["status"],
  ): EditorialIssue {
    this.getIssue(bookId, issueId);
    this.db
      .prepare(
        "UPDATE kdp_editorial_issues SET status = ?, updated_at = ? WHERE id = ?",
      )
      .run(status, now(), issueId);
    return this.getIssue(bookId, issueId);
  }

  passesRun(bookId: string): string[] {
    const rows = this.db
      .prepare(
        "SELECT DISTINCT kind FROM kdp_editorial_reviews WHERE book_id = ?",
      )
      .all(bookId) as Array<{ kind: string }>;
    return rows.map((row) => row.kind);
  }
}
