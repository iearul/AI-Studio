import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type { ChapterCard, StoryBible } from "@ai-studio/contracts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { DatabaseManager } from "../src/database-manager.js";
import {
  KdpBookRepository,
  KdpConflictError,
  KdpNotFoundError,
} from "../src/kdp-book-repository.js";
import { KdpJobRepository } from "../src/kdp-job-repository.js";
import { KdpStoryRepository } from "../src/kdp-story-repository.js";

const card = (title: string, targetWords = 2_000): ChapterCard => ({
  title,
  povCharacter: "Ilse",
  location: "Harbour",
  time: "Night",
  objective: "Find the ledger",
  openingHook: "A light in the closed office",
  scenes: [{ summary: "Ilse breaks in", purpose: "Raise stakes" }],
  conflict: "The guard returns",
  newInformation: [],
  clues: [],
  continuityReferences: [],
  emotionalMovement: "Fear to resolve",
  endingBeat: "She finds the ledger empty",
  dependsOn: [],
  targetWords,
});

const bible: StoryBible = {
  premise: "A harbour clerk finds a ledger of the dead.",
  theme: "Debt",
  settingRules: [],
  locations: [],
  characters: [],
  chronology: [],
  majorEvents: [],
  objects: [],
  clues: [],
  viewpointRules: "Close third on Ilse",
  styleGuide: {
    narrativeVoice: "Dry",
    proseRules: [],
    dialogueRules: [],
    avoid: [],
  },
  plotConstraints: [],
  endingResolution: "She pays the debt",
  unresolvedQuestions: [],
  architecture: null,
  canonFacts: [],
};

describe("KDP repositories", () => {
  let directory: string;
  let manager: DatabaseManager;
  let books: KdpBookRepository;
  let story: KdpStoryRepository;
  let jobs: KdpJobRepository;

  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), "kdp-database-"));
    manager = new DatabaseManager(path.join(directory, "test.sqlite"));
    await manager.open();
    books = new KdpBookRepository(manager);
    story = new KdpStoryRepository(manager);
    jobs = new KdpJobRepository(manager);
  });

  afterEach(async () => {
    manager.close();
    await rm(directory, { recursive: true, force: true });
  });

  function createBook(owner = "owner-a") {
    const author = books.createAuthor(owner, { penName: "V. K. Rabenhorst" });
    return books.create(owner, {
      authorProfileId: author.id,
      language: "en",
      brief: {
        theme: "A clerk finds a ledger listing people who have not died yet.",
        genre: "Psychological thriller",
        targetWords: 20_000,
        chapterCount: 10,
      },
    });
  }

  it("enforces ownership on books and pen names", () => {
    const book = createBook("owner-a");
    expect(books.require("owner-a", book.id).title).toBe("Untitled book");
    expect(() => books.require("owner-b", book.id)).toThrow(KdpNotFoundError);
    expect(books.list("owner-b", { sort: "updated" })).toEqual([]);
    expect(() => books.requireAuthor("owner-b", book.authorProfileId!)).toThrow(
      KdpNotFoundError,
    );
    expect(() =>
      books.create("owner-b", {
        authorProfileId: book.authorProfileId!,
        language: "en",
        brief: {
          theme: "x y z",
          genre: "Mystery",
          targetWords: 1000,
          chapterCount: 1,
        },
      }),
    ).toThrow(KdpNotFoundError);
  });

  it("lists summaries with filters and keeps deleted books recoverable", () => {
    const book = createBook();
    books.update("owner-a", book.id, {
      title: "The Ledger",
      seriesName: "Harbour Files",
      seriesNumber: 1,
    });
    story.replaceOutline(book.id, [card("One"), card("Two")]);
    const [summary] = books.list("owner-a", {
      sort: "updated",
      search: "ledger",
    });
    expect(summary).toMatchObject({
      title: "The Ledger",
      penName: "V. K. Rabenhorst",
      chaptersPlanned: 2,
      chaptersDrafted: 0,
    });
    expect(
      books.list("owner-a", { sort: "title", series: "harbour files" }),
    ).toHaveLength(1);
    books.softDelete("owner-a", book.id);
    expect(books.list("owner-a", { sort: "updated" })).toHaveLength(0);
    expect(
      books.list("owner-a", { sort: "updated", includeDeleted: true }),
    ).toHaveLength(1);
    books.restore("owner-a", book.id);
    expect(books.require("owner-a", book.id).deletedAt).toBeNull();
  });

  it("records revisions, protects locked chapters and rejects stale saves", () => {
    const book = createBook();
    const [first] = story.replaceOutline(book.id, [card("One"), card("Two")]);
    const drafted = story.saveChapterText(book.id, first!.id, {
      content: "Ilse *ran*.\n\n* * *\n\nShe stopped.",
      source: "ai-draft",
      recordRevision: true,
    });
    expect(drafted).toMatchObject({
      wordCount: 4,
      status: "drafted",
      contentSource: "ai",
      revisionCount: 1,
    });
    const autosaved = story.saveChapterText(book.id, first!.id, {
      content: "Ilse *ran* home.\n\n* * *\n\nShe stopped.",
      source: "user-edit",
      recordRevision: false,
      baseRevisionCount: 1,
    });
    expect(autosaved).toMatchObject({
      revisionCount: 1,
      contentSource: "mixed",
    });
    expect(() =>
      story.saveChapterText(book.id, first!.id, {
        content: "x",
        source: "user-edit",
        recordRevision: true,
        baseRevisionCount: 0,
      }),
    ).toThrow(KdpConflictError);
    // A manual save after autosave still records the edit as a revision.
    const manual = story.saveChapterText(book.id, first!.id, {
      content: "Ilse *ran* home.\n\n* * *\n\nShe stopped.",
      source: "user-edit",
      recordRevision: true,
      baseRevisionCount: 1,
    });
    expect(manual.revisionCount).toBe(2);
    story.updateChapter(book.id, first!.id, { locked: true });
    expect(() =>
      story.saveChapterText(book.id, first!.id, {
        content: "AI overwrite",
        source: "ai-draft",
        recordRevision: true,
      }),
    ).toThrow(/locked/);
    story.updateChapter(book.id, first!.id, { locked: false });
    story.saveChapterText(book.id, first!.id, {
      content: "Second version.",
      source: "user-edit",
      recordRevision: true,
    });
    const revisions = story.listRevisions(book.id, first!.id);
    expect(revisions.map((revision) => revision.source)).toEqual([
      "user-edit",
      "user-edit",
      "ai-draft",
    ]);
    const restored = story.restoreRevision(
      book.id,
      first!.id,
      revisions[2]!.id,
    );
    expect(restored.content).toBe("Ilse *ran*.\n\n* * *\n\nShe stopped.");
    expect(story.revisionSources(book.id).get(first!.id)).toContain("ai-draft");
    expect(() => story.replaceOutline(book.id, [card("New")])).toThrow(
      /already have text/,
    );
  });

  it("adds, reorders and deletes chapters", () => {
    const book = createBook();
    const [one, two] = story.replaceOutline(book.id, [
      card("One"),
      card("Two"),
    ]);
    const added = story.addChapter(book.id, card("Between"), one!.id);
    expect(story.listChapters(book.id).map((chapter) => chapter.title)).toEqual(
      ["One", "Between", "Two"],
    );
    expect(added.number).toBe(2);
    story.reorder(book.id, [two!.id, one!.id, added.id]);
    expect(
      story
        .listChapters(book.id)
        .map((chapter) => [chapter.number, chapter.title]),
    ).toEqual([
      [1, "Two"],
      [2, "One"],
      [3, "Between"],
    ]);
    expect(() => story.reorder(book.id, [one!.id])).toThrow(KdpConflictError);
    story.deleteChapter(book.id, added.id);
    expect(story.listChapters(book.id)).toHaveLength(2);
  });

  it("versions the story bible and refuses stale edits", () => {
    const book = createBook();
    const first = story.saveBible(book.id, bible, "ai");
    const second = story.saveBible(
      book.id,
      { ...bible, theme: "Guilt" },
      "user",
      { baseVersion: 1 },
    );
    expect([first.version, second.version]).toEqual([1, 2]);
    expect(() =>
      story.saveBible(book.id, bible, "user", { baseVersion: 1 }),
    ).toThrow(KdpConflictError);
    expect(
      story.listBibleVersions(book.id).map((version) => version.version),
    ).toEqual([2, 1]);
  });

  it("runs one job per book lane and returns the same job for a repeated key", () => {
    const book = createBook();
    const first = jobs.enqueue({
      ownerId: "owner-a",
      bookId: book.id,
      kind: "draft",
      idempotencyKey: "click-1",
      input: {},
    });
    const repeat = jobs.enqueue({
      ownerId: "owner-a",
      bookId: book.id,
      kind: "draft",
      idempotencyKey: "click-1",
      input: {},
    });
    const doubleClick = jobs.enqueue({
      ownerId: "owner-a",
      bookId: book.id,
      kind: "outline",
      idempotencyKey: "click-2",
      input: {},
    });
    expect(first.created).toBe(true);
    expect(repeat).toMatchObject({ created: false, job: { id: first.job.id } });
    expect(doubleClick).toMatchObject({
      created: false,
      job: { id: first.job.id },
    });
    const utility = jobs.enqueue({
      ownerId: "owner-a",
      bookId: book.id,
      kind: "metadata",
      idempotencyKey: "click-3",
      input: {},
    });
    expect(utility.created).toBe(true);
  });

  it("re-claims a running job whose lease expired and keeps checkpoints", () => {
    const book = createBook();
    const { job } = jobs.enqueue({
      ownerId: "owner-a",
      bookId: book.id,
      kind: "draft",
      idempotencyKey: "k-1",
      input: {},
    });
    const claimed = jobs.claimNext(-1_000, new Set());
    expect(claimed?.id).toBe(job.id);
    jobs.recordStep(job.id, "draft:1", "succeeded", { words: 2000 }, 1);
    // The lease above is already expired, as after a crash.
    const reclaimed = jobs.claimNext(60_000, new Set());
    expect(reclaimed).toMatchObject({ id: job.id, attempts: 2 });
    expect(jobs.getStep(job.id, "draft:1")).toEqual({
      status: "succeeded",
      output: { words: 2000 },
    });
    expect(jobs.claimNext(60_000, new Set())).toBeUndefined();
    jobs.requestCancel(job.id);
    expect(jobs.isCancelRequested(job.id)).toBe(true);
    jobs.finish(job.id, "cancelled");
    expect(jobs.resume(job.id)).toMatchObject({
      status: "queued",
      cancelRequested: false,
    });
  });

  it("tracks AI cost per book and job", () => {
    const book = createBook();
    const { job } = jobs.enqueue({
      ownerId: "owner-a",
      bookId: book.id,
      kind: "concepts",
      idempotencyKey: "k-2",
      input: {},
    });
    jobs.recordRun({
      bookId: book.id,
      jobId: job.id,
      stepKey: "concepts",
      task: "idea",
      provider: "anthropic",
      model: "claude-opus-5-5",
      inputTokens: 1000,
      outputTokens: 500,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      costMicros: 14_000,
      estimated: false,
      durationMs: 1200,
      status: "succeeded",
      errorMessage: null,
    });
    expect(jobs.spentMicros(book.id)).toBe(14_000);
    expect(jobs.requireJob(job.id).actualCostMicros).toBe(14_000);
    expect(jobs.costSummary(book.id, 20_000_000)).toMatchObject({
      spentMicros: 14_000,
      runs: 1,
      unverifiedPrices: false,
    });
  });

  it("duplicates a book with chapters, revisions and bible", () => {
    const book = createBook();
    story.saveBible(book.id, bible, "ai");
    const [chapter] = story.replaceOutline(book.id, [card("One")]);
    story.saveChapterText(book.id, chapter!.id, {
      content: "Text here.",
      source: "ai-draft",
      recordRevision: true,
    });
    const copy = books.duplicate("owner-a", book.id);
    expect(copy.title).toBe("Untitled book (copy)");
    const copied = story.listChapters(copy.id);
    expect(copied[0]).toMatchObject({ content: "Text here.", wordCount: 2 });
    expect(story.listRevisions(copy.id, copied[0]!.id)[0]?.source).toBe(
      "ai-draft",
    );
    expect(story.getBible(copy.id)?.bible.premise).toBe(bible.premise);
  });
});
