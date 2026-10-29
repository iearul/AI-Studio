import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type {
  BookExport,
  BookMetadataRecord,
  BookReadiness,
  BookSummary,
  Chapter,
  ChapterListItem,
  ChapterRevision,
  ConceptRecord,
  CoverAsset,
  EditorialIssue,
  KdpJob,
  ProvenanceRecord,
  StoryBibleRecord,
} from "@ai-studio/contracts";
import { readZip, findEpubCheck } from "@ai-studio/book-export";
import type { FastifyInstance, InjectOptions } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { buildApp } from "../src/app.js";
import { createServices, type Services } from "../src/services.js";
import {
  jpegHeader,
  MockBookProvider,
  multipart,
  pngHeader,
} from "./kdp-helpers.js";

const config = {
  environment: "test" as const,
  host: "127.0.0.1",
  port: 4100,
  webOrigins: new Set(["http://localhost:3000"]),
};

describe("KDP Story Studio API", () => {
  let directory: string;
  let services: Services;
  let app: FastifyInstance;
  let claude: MockBookProvider;
  let openai: MockBookProvider;
  let key = 0;

  async function start() {
    claude = new MockBookProvider("anthropic");
    openai = new MockBookProvider("openai");
    services = await createServices({
      textProviders: [],
      kdpTextProviders: [claude, openai],
      kdpSleep: () => Promise.resolve(),
      kdpRunner: { heartbeatMs: 20 },
      // Tests stand in for a future login with a header.
      resolveOwner: (request) =>
        String(request.headers["x-test-owner"] ?? "owner-a"),
    });
    app = await buildApp(config, services);
  }

  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), "kdp-api-"));
    process.env.DATABASE_PATH = path.join(directory, "ai-studio.sqlite");
    process.env.PROJECTS_PATH = path.join(directory, "projects");
    process.env.BACKUPS_PATH = path.join(directory, "backups");
    process.env.CACHE_PATH = path.join(directory, "cache");
    await start();
  });

  afterEach(async () => {
    await app.close();
    services.database.close();
    await rm(directory, { recursive: true, force: true });
  });

  async function call<T>(
    options: Omit<InjectOptions, "url"> & { url: string },
    status = 200,
  ): Promise<T> {
    const response = await app.inject({
      ...options,
      url: `/api/v1${options.url}`,
    });
    if (response.statusCode !== status) {
      throw new Error(
        `${options.method} ${options.url} → ${response.statusCode}: ${response.body}`,
      );
    }
    return (response.body ? response.json() : undefined) as T;
  }

  async function job(
    bookId: string,
    payload: Record<string, unknown>,
  ): Promise<KdpJob> {
    key += 1;
    const { job: started } = await call<{ job: KdpJob }>(
      {
        method: "POST",
        url: `/kdp/books/${bookId}/jobs`,
        payload: { idempotencyKey: `test-key-${key}`, ...payload },
      },
      202,
    );
    await services.kdp.runner.drain();
    return call<KdpJob>({
      method: "GET",
      url: `/kdp/books/${bookId}/jobs/${started.id}`,
    });
  }

  async function createThriller(): Promise<BookSummary> {
    const { items: authors } = await call<{
      items: Array<{ id: string; penName: string }>;
    }>({ method: "GET", url: "/kdp/authors" });
    expect(authors[0]?.penName).toBe("V. K. Rabenhorst");
    return call<BookSummary>(
      {
        method: "POST",
        url: "/kdp/books",
        payload: {
          authorProfileId: authors[0]!.id,
          language: "en",
          brief: {
            theme: "A widow's dead husband keeps writing in his diary.",
            genre: "Psychological thriller",
            targetWords: 20_000,
            chapterCount: 10,
            lengthPreset: "novella",
          },
        },
      },
      201,
    );
  }

  async function planned(): Promise<{
    book: BookSummary;
    chapters: ChapterListItem[];
  }> {
    const book = await createThriller();
    expect((await job(book.id, { kind: "concepts" })).status).toBe("succeeded");
    const { items: concepts } = await call<{ items: ConceptRecord[] }>({
      method: "GET",
      url: `/kdp/books/${book.id}/concepts`,
    });
    await call({
      method: "POST",
      url: `/kdp/books/${book.id}/concepts/${concepts[1]!.id}/select`,
    });
    expect((await job(book.id, { kind: "bible" })).status).toBe("succeeded");
    expect((await job(book.id, { kind: "outline" })).status).toBe("succeeded");
    const { items: chapters } = await call<{ items: ChapterListItem[] }>({
      method: "GET",
      url: `/kdp/books/${book.id}/chapters`,
    });
    return { book, chapters };
  }

  it("hands every new or duplicated book to Google Drive", async () => {
    const syncBook = vi
      .spyOn(services.googleDrive, "syncBook")
      .mockResolvedValue();
    const book = await createThriller();
    const copy = await call<BookSummary>(
      { method: "POST", url: `/kdp/books/${book.id}/duplicate` },
      201,
    );
    expect(syncBook.mock.calls).toEqual([[book.id], [copy.id]]);
  });

  it("takes a 20,000-word thriller from theme to outline", async () => {
    const book = await createThriller();
    expect(book).toMatchObject({
      status: "draft",
      stage: "brief",
      penName: "V. K. Rabenhorst",
      genre: "Psychological thriller",
    });

    const conceptsJob = await job(book.id, { kind: "concepts" });
    expect(conceptsJob).toMatchObject({ status: "succeeded", progress: 1 });
    const { items: concepts } = await call<{ items: ConceptRecord[] }>({
      method: "GET",
      url: `/kdp/books/${book.id}/concepts`,
    });
    expect(concepts).toHaveLength(3);
    expect(concepts[0]!.concept.originalityRisks.length).toBeGreaterThan(0);

    // Asking again produces a second batch and tells the model what to avoid.
    await job(book.id, { kind: "concepts", guidance: "More gothic" });
    const second = claude.calls.filter(
      (item) => item.schemaName === "story_concepts",
    )[1]!;
    expect(second.prompt).toContain("already seen these concepts");
    expect(second.prompt).toContain("More gothic");

    await call({
      method: "POST",
      url: `/kdp/books/${book.id}/concepts/${concepts[0]!.id}/select`,
    });
    await job(book.id, { kind: "bible" });
    const bible = await call<{ record: StoryBibleRecord }>({
      method: "GET",
      url: `/kdp/books/${book.id}/bible`,
    });
    expect(
      bible.record.bible.characters.map((character) => character.name),
    ).toEqual(["Mara Lind", "Tomas Berg"]);

    // The author changes a character before the plot is built.
    const edited = structuredClone(bible.record.bible);
    edited.characters[1]!.name = "Tomas Ek";
    await call({
      method: "PUT",
      url: `/kdp/books/${book.id}/bible`,
      payload: { baseVersion: bible.record.version, bible: edited },
    });
    await call(
      {
        method: "PUT",
        url: `/kdp/books/${book.id}/bible`,
        payload: { baseVersion: bible.record.version, bible: edited },
      },
      409,
    );

    await job(book.id, { kind: "outline" });
    const outlineCall = claude.calls.find(
      (item) => item.schemaName === "chapter_outline",
    )!;
    expect(outlineCall.prompt).toContain("Tomas Ek");
    expect(outlineCall.prompt).toContain("Write exactly 10 chapter cards");
    const { items: chapters } = await call<{ items: ChapterListItem[] }>({
      method: "GET",
      url: `/kdp/books/${book.id}/chapters`,
    });
    expect(chapters).toHaveLength(10);
    expect(
      chapters.reduce((sum, chapter) => sum + chapter.targetWords, 0),
    ).toBe(20_000);
    expect(
      new Set(chapters.map((chapter) => chapter.targetWords)).size,
    ).toBeGreaterThan(3);
    const architecture = await call<{ record: StoryBibleRecord }>({
      method: "GET",
      url: `/kdp/books/${book.id}/bible`,
    });
    expect(architecture.record.bible.architecture?.suspects[0]?.isCulprit).toBe(
      true,
    );

    // Single card regeneration keeps the others.
    await job(book.id, { kind: "outline", chapterIds: [chapters[3]!.id] });
    const after = await call<{ items: ChapterListItem[] }>({
      method: "GET",
      url: `/kdp/books/${book.id}/chapters`,
    });
    expect(after.items[3]!.title).toBe("Rewritten card");
    expect(after.items[2]!.title).toBe("Row 3");
  });

  it("drafts every chapter with continuity context, inspection and cost tracking", async () => {
    const { book, chapters } = await planned();
    const draft = await job(book.id, { kind: "draft" });
    expect(draft.status).toBe("succeeded");
    expect(draft.result).toMatchObject({ drafted: 10, skipped: [] });
    expect(draft.estimatedCostMicros).toBeGreaterThan(0);
    const estimate = await call<{
      estimatedCostMicros: number;
      budgetMicros: number;
    }>({
      method: "POST",
      url: `/kdp/books/${book.id}/jobs/estimate`,
      payload: { kind: "draft", regenerate: true },
    });
    expect(estimate.estimatedCostMicros).toBeGreaterThan(0);
    expect(estimate.budgetMicros).toBe(20_000_000);

    const items = (
      await call<{ items: ChapterListItem[] }>({
        method: "GET",
        url: `/kdp/books/${book.id}/chapters`,
      })
    ).items;
    for (const chapter of items) {
      expect(chapter.wordCount).toBeGreaterThan(chapter.targetWords * 0.75);
      expect(chapter.summary).toContain(`chapter ${chapter.number}`);
      expect(chapter.status).toBe("drafted");
    }
    // Late chapters receive facts established early, plus the cached bible.
    const chapterNinePrompt = claude.calls.find(
      (item) =>
        item.kind === "prose" && /Write chapter 9 in full/.test(item.prompt),
    )!;
    expect(chapterNinePrompt.prompt).toContain("Mara's eyes are green");
    expect(chapterNinePrompt.prompt).toContain(
      "In chapter 8 Mara checks the ledger",
    );
    expect(chapterNinePrompt.cachedContext).toContain("Mara Lind");
    expect(chapterNinePrompt.prompt).not.toContain(
      items[0]!.summary!.repeat(2),
    );

    const bible = await call<{
      record: StoryBibleRecord;
      canonChanges: Array<{ change: string; status: string }>;
    }>({
      method: "GET",
      url: `/kdp/books/${book.id}/bible`,
    });
    expect(bible.record.bible.clues[0]).toMatchObject({
      status: "planted",
      plantChapter: 1,
    });
    expect(bible.record.bible.characters[0]!.state).toContain(
      "Suspicious after chapter 10",
    );
    expect(bible.canonChanges).toContainEqual(
      expect.objectContaining({
        change: "Tomas now owns a second key",
        status: "proposed",
      }),
    );

    const costs = await call<{
      summary: {
        spentMicros: number;
        runs: number;
        byTask: Array<{ task: string }>;
      };
    }>({
      method: "GET",
      url: `/kdp/books/${book.id}/costs`,
    });
    expect(costs.summary.spentMicros).toBeGreaterThan(0);
    expect(costs.summary.byTask.map((item) => item.task)).toEqual(
      expect.arrayContaining(["writer", "inspector", "architect", "idea"]),
    );
    // Inspection runs on the cheaper utility route by default.
    expect(
      openai.calls.filter((item) => item.schemaName === "chapter_inspection"),
    ).toHaveLength(10);
    expect(chapters).toHaveLength(10);

    const summary = await call<BookSummary>({
      method: "GET",
      url: `/kdp/books/${book.id}`,
    });
    expect(summary).toMatchObject({ stage: "editing", chaptersDrafted: 10 });
  });

  it("resumes a failed or interrupted draft without writing any chapter twice", async () => {
    const { book } = await planned();
    claude.failures.set(/Write chapter 4 in full/, { kind: "permanent" });
    const failed = await job(book.id, { kind: "draft" });
    expect(failed.status).toBe("failed");
    expect(failed.errorMessage).toContain("rejected the key");
    let items = (
      await call<{ items: ChapterListItem[] }>({
        method: "GET",
        url: `/kdp/books/${book.id}/chapters`,
      })
    ).items;
    expect(items.filter((chapter) => chapter.wordCount > 0)).toHaveLength(3);

    claude.failures.clear();
    await call({
      method: "POST",
      url: `/kdp/books/${book.id}/jobs/${failed.id}/resume`,
    });
    // Simulate a server restart in the middle of chapter 6.
    const gate = claude.blockOn(/Write chapter 6 in full/);
    services.kdp.runner.start();
    await gate.reached;
    await services.kdp.runner.stop();
    expect(
      (
        await call<KdpJob>({
          method: "GET",
          url: `/kdp/books/${book.id}/jobs/${failed.id}`,
        })
      ).status,
    ).toBe("running");
    services.kdp.runner.start();
    await services.kdp.runner.drain();
    await services.kdp.runner.stop();

    const finished = await call<KdpJob>({
      method: "GET",
      url: `/kdp/books/${book.id}/jobs/${failed.id}`,
    });
    expect(finished.status).toBe("succeeded");
    items = (
      await call<{ items: ChapterListItem[] }>({
        method: "GET",
        url: `/kdp/books/${book.id}/chapters`,
      })
    ).items;
    expect(items.every((chapter) => chapter.wordCount > 0)).toBe(true);
    expect(items.every((chapter) => chapter.revisionCount === 1)).toBe(true);
    for (const number of [1, 2, 3]) {
      const written = claude.calls.filter((item) =>
        new RegExp(`Write chapter ${number} in full`).test(item.prompt),
      );
      expect(written).toHaveLength(1);
    }
  });

  it("protects locked chapters, keeps revisions and regenerates only unlocked ones", async () => {
    const { book } = await planned();
    await job(book.id, { kind: "draft" });
    const items = (
      await call<{ items: ChapterListItem[] }>({
        method: "GET",
        url: `/kdp/books/${book.id}/chapters`,
      })
    ).items;
    const [first, second] = items;
    const edited = await call<Chapter>({
      method: "PUT",
      url: `/kdp/books/${book.id}/chapters/${first!.id}/content`,
      payload: {
        content:
          "Mara *closed* the ledger.\n\n* * *\n\nShe did not open it again.",
        mode: "manual",
        baseRevisionCount: 1,
      },
    });
    expect(edited).toMatchObject({ revisionCount: 2, contentSource: "mixed" });
    await call({
      method: "PATCH",
      url: `/kdp/books/${book.id}/chapters/${first!.id}`,
      payload: { locked: true },
    });
    await call(
      {
        method: "PUT",
        url: `/kdp/books/${book.id}/chapters/${first!.id}/content`,
        payload: { content: "x", mode: "manual", baseRevisionCount: 2 },
      },
      409,
    );

    const regen = await job(book.id, {
      kind: "draft",
      chapterIds: [first!.id, second!.id],
      regenerate: true,
    });
    expect(regen.status).toBe("succeeded");
    const locked = await call<Chapter>({
      method: "GET",
      url: `/kdp/books/${book.id}/chapters/${first!.id}`,
    });
    expect(locked.content).toBe(
      "Mara *closed* the ledger.\n\n* * *\n\nShe did not open it again.",
    );
    expect(locked.revisionCount).toBe(2);
    const regenerated = await call<Chapter>({
      method: "GET",
      url: `/kdp/books/${book.id}/chapters/${second!.id}`,
    });
    expect(regenerated.revisionCount).toBe(2);

    const { items: revisions } = await call<{ items: ChapterRevision[] }>({
      method: "GET",
      url: `/kdp/books/${book.id}/chapters/${second!.id}/revisions`,
    });
    const restored = await call<Chapter>({
      method: "POST",
      url: `/kdp/books/${book.id}/chapters/${second!.id}/revisions/${revisions[1]!.id}/restore`,
    });
    expect(restored.content).toBe(revisions[1]!.content);
    expect(restored.revisionCount).toBe(3);
  });

  it("detects a deliberate continuity contradiction and applies accepted editorial fixes", async () => {
    const { book } = await planned();
    await job(book.id, { kind: "draft" });
    const items = (
      await call<{ items: ChapterListItem[] }>({
        method: "GET",
        url: `/kdp/books/${book.id}/chapters`,
      })
    ).items;
    const fifth = await call<Chapter>({
      method: "GET",
      url: `/kdp/books/${book.id}/chapters/${items[4]!.id}`,
    });
    await call({
      method: "PUT",
      url: `/kdp/books/${book.id}/chapters/${fifth.id}/content`,
      payload: {
        content: `Mara blinked her blue eyes at the ledger.\n\n${fifth.content}`,
        mode: "manual",
        baseRevisionCount: fifth.revisionCount,
      },
    });
    await job(book.id, {
      kind: "draft",
      inspectOnly: true,
      chapterIds: [fifth.id],
    });
    let editorial = await call<{ issues: EditorialIssue[] }>({
      method: "GET",
      url: `/kdp/books/${book.id}/editorial`,
    });
    expect(editorial.issues).toContainEqual(
      expect.objectContaining({
        kind: "inspection",
        severity: "major",
        issue: "Mara's eye colour changes",
        chapterId: fifth.id,
      }),
    );

    await job(book.id, { kind: "editorial", passes: ["continuity", "copy"] });
    editorial = await call<{ issues: EditorialIssue[] }>({
      method: "GET",
      url: `/kdp/books/${book.id}/editorial`,
    });
    const typo = editorial.issues.find(
      (issue) => issue.kind === "copy" && issue.originalText === "teh harbour",
    )!;
    const eyes = editorial.issues.find((issue) => issue.kind === "continuity")!;
    expect(eyes.replacementText).toBe("green eyes");
    await call({
      method: "PATCH",
      url: `/kdp/books/${book.id}/editorial/issues/${typo.id}`,
      payload: { status: "accepted", apply: true },
    });
    await call({
      method: "PATCH",
      url: `/kdp/books/${book.id}/editorial/issues/${eyes.id}`,
      payload: { status: "rejected" },
    });
    const second = await call<Chapter>({
      method: "GET",
      url: `/kdp/books/${book.id}/chapters/${items[1]!.id}`,
    });
    expect(second.content).toContain("the harbour before dawn");
    expect(second.content).not.toContain("teh harbour");
    const { items: revisions } = await call<{ items: ChapterRevision[] }>({
      method: "GET",
      url: `/kdp/books/${book.id}/chapters/${second.id}/revisions`,
    });
    expect(revisions[0]).toMatchObject({ source: "ai-edit" });
    // Applying again fails safely because the quoted text is gone.
    await call(
      {
        method: "PATCH",
        url: `/kdp/books/${book.id}/editorial/issues/${typo.id}`,
        payload: { status: "accepted", apply: true },
      },
      409,
    );
  });

  it("prepares cover, listing, provenance and a validated publisher kit", async () => {
    const { book } = await planned();
    await job(book.id, { kind: "draft" });
    await job(book.id, { kind: "cover-prompts" });
    const covers = await call<{
      concepts: { data: Array<{ mainPrompt: string }> };
    }>({ method: "GET", url: `/kdp/books/${book.id}/covers` });
    expect(covers.concepts.data).toHaveLength(3);
    expect(covers.concepts.data[0]!.mainPrompt).toMatch(/no text/);

    // Pasted artwork (declared AI-generated) is persisted but never becomes the cover.
    const art = multipart("clipboard.png", "image/png", pngHeader(1600, 2560));
    const artwork = await call<CoverAsset>(
      {
        method: "POST",
        url: `/kdp/books/${book.id}/covers?kind=artwork&source=paste&provenance=ai-generated`,
        ...art,
      },
      201,
    );
    expect(artwork).toMatchObject({
      source: "paste",
      isCurrent: false,
      width: 1600,
      height: 2560,
    });
    const file = await app.inject({
      method: "GET",
      url: `/api/v1/kdp/books/${book.id}/covers/${artwork.id}/file`,
    });
    expect(file.rawPayload.equals(pngHeader(1600, 2560))).toBe(true);

    // A bad final cover is stored for reference but rejected as the book cover.
    const bad = multipart("bad.png", "image/png", pngHeader(800, 600));
    const rejected = await call<CoverAsset>(
      {
        method: "POST",
        url: `/kdp/books/${book.id}/covers?kind=final&source=upload&provenance=human`,
        ...bad,
      },
      201,
    );
    expect(rejected.validation.ok).toBe(false);
    await call(
      {
        method: "POST",
        url: `/kdp/books/${book.id}/covers/${rejected.id}/current`,
      },
      409,
    );

    const composite = multipart(
      "cover.jpg",
      "image/jpeg",
      jpegHeader(1600, 2560),
    );
    const current = await call<BookSummary>({
      method: "GET",
      url: `/kdp/books/${book.id}`,
    });
    expect(current.title).toBe("The Glass Orchard 2");
    const settings = encodeURIComponent(
      JSON.stringify({ title: current.title, author: "V. K. Rabenhorst" }),
    );
    const finalCover = await call<CoverAsset>(
      {
        method: "POST",
        url: `/kdp/books/${book.id}/covers?kind=final&source=composite&provenance=ai-generated&parentId=${artwork.id}&settings=${settings}`,
        ...composite,
      },
      201,
    );
    expect(finalCover).toMatchObject({
      isCurrent: true,
      validation: { ok: true, errors: [], warnings: [] },
    });

    await job(book.id, { kind: "metadata" });
    const metadata = await call<{
      record: BookMetadataRecord;
      findings: Array<{ level: string }>;
      consistency: unknown[];
    }>({
      method: "GET",
      url: `/kdp/books/${book.id}/metadata`,
    });
    expect(metadata.record.metadata.keywords).toHaveLength(7);
    expect(metadata.record.metadata.categories.length).toBeLessThanOrEqual(3);
    expect(metadata.record.metadata.pricing).toMatchObject({
      listPrice: 2.99,
      royaltyPlan: "70",
    });
    expect(
      metadata.findings.filter((finding) => finding.level === "error"),
    ).toEqual([]);
    expect(metadata.consistency).toEqual([]);

    const provenance = await call<{
      records: ProvenanceRecord[];
      checklist: Array<{ asset: string; mustDisclose: boolean }>;
    }>({
      method: "GET",
      url: `/kdp/books/${book.id}/provenance`,
    });
    expect(
      provenance.records.find((record) => record.asset === "text")
        ?.classification,
    ).toBe("ai-generated");
    expect(
      provenance.records.find((record) => record.asset === "cover")
        ?.classification,
    ).toBe("ai-generated");
    expect(
      provenance.checklist
        .filter((item) => item.mustDisclose)
        .map((item) => item.asset),
    ).toEqual(["text", "cover"]);
    await call(
      {
        method: "PUT",
        url: `/kdp/books/${book.id}/provenance/text`,
        payload: { classification: "human" },
      },
      409,
    );

    const exported = await call<BookExport>(
      { method: "POST", url: `/kdp/books/${book.id}/exports` },
      201,
    );
    expect(exported.validation?.epubStructure).toMatchObject({
      ok: true,
      errors: [],
    });
    expect(exported.validation?.docx).toEqual({ ok: true, errors: [] });
    if (await findEpubCheck()) {
      expect(exported.validation?.epubcheck).toMatchObject({
        available: true,
        passed: true,
        fatal: 0,
        errors: 0,
      });
    }
    expect(exported.files.map((item) => item.kind)).toEqual(
      expect.arrayContaining([
        "epub",
        "docx",
        "markdown",
        "text",
        "metadata-json",
        "metadata-html",
        "cover-jpeg",
        "cover-prompts",
        "editorial-report",
        "disclosure-report",
        "project-backup",
        "zip",
      ]),
    );

    const epub = await app.inject({
      method: "GET",
      url: `/api/v1/kdp/books/${book.id}/exports/${exported.id}/files/the-glass-orchard-2.epub`,
    });
    expect(epub.headers["content-disposition"]).toContain(
      "the-glass-orchard-2.epub",
    );
    const entries = readZip(epub.rawPayload);
    const nav = Buffer.from(entries.get("OEBPS/nav.xhtml")!).toString("utf8");
    for (let number = 1; number <= 10; number += 1)
      expect(nav).toContain(`Chapter ${number}`);
    expect([...entries.keys()].some((name) => /cover/i.test(name))).toBe(false);

    const zip = await app.inject({
      method: "GET",
      url: `/api/v1/kdp/books/${book.id}/exports/${exported.id}/files/the-glass-orchard-2-publisher-kit.zip`,
    });
    const kit = [...readZip(zip.rawPayload).keys()];
    expect(kit).toEqual(
      expect.arrayContaining([
        "the-glass-orchard-2.epub",
        "the-glass-orchard-2.docx",
        "the-glass-orchard-2-cover.jpg",
        "the-glass-orchard-2-kdp-metadata.json",
        "validation.json",
      ]),
    );

    // Ready for KDP needs passing checks and both explicit approvals.
    let readiness = await call<BookReadiness>({
      method: "GET",
      url: `/kdp/books/${book.id}/readiness`,
    });
    expect(readiness.readyForKdp).toBe(false);
    await call({
      method: "POST",
      url: `/kdp/books/${book.id}/approval`,
      payload: { field: "manuscript", approved: true },
    });
    readiness = await call<BookReadiness>({
      method: "POST",
      url: `/kdp/books/${book.id}/approval`,
      payload: { field: "listing", approved: true },
    });
    expect(readiness.manuscriptApproved && readiness.listingApproved).toBe(
      true,
    );
    expect(
      readiness.checks.find((check) => check.id === "epub-structure")?.status,
    ).not.toBe("fail");

    await call({
      method: "PUT",
      url: `/kdp/books/${book.id}/publication`,
      payload: {
        status: "live",
        asin: "B0TESTASIN",
        amazonUrl: "https://www.amazon.com/dp/B0TESTASIN",
      },
    });
    expect(
      (await call<BookSummary>({ method: "GET", url: `/kdp/books/${book.id}` }))
        .status,
    ).toBe("published");
  });

  it("restores every setting, revision and asset after the app restarts", async () => {
    const { book } = await planned();
    await job(book.id, { kind: "draft" });
    await call({
      method: "PATCH",
      url: `/kdp/books/${book.id}`,
      payload: {
        title: "The Glass Orchard",
        settings: {
          budgetUsd: 12,
          routing: {
            writer: { provider: "openai", model: null, effort: null },
          },
        },
      },
    });
    const cover = multipart("cover.jpg", "image/jpeg", jpegHeader(1600, 2560));
    const stored = await call<CoverAsset>(
      {
        method: "POST",
        url: `/kdp/books/${book.id}/covers?kind=final&source=upload&provenance=human`,
        ...cover,
      },
      201,
    );
    await app.close();
    services.database.close();

    await start();
    const reopened = await call<BookSummary>({
      method: "GET",
      url: `/kdp/books/${book.id}`,
    });
    expect(reopened).toMatchObject({
      title: "The Glass Orchard",
      chaptersDrafted: 10,
      currentCoverId: stored.id,
      settings: { budgetUsd: 12 },
    });
    expect(reopened.settings.routing.writer?.provider).toBe("openai");
    const { items } = await call<{ items: ChapterListItem[] }>({
      method: "GET",
      url: `/kdp/books/${book.id}/chapters`,
    });
    const revisions = await call<{ items: ChapterRevision[] }>({
      method: "GET",
      url: `/kdp/books/${book.id}/chapters/${items[0]!.id}/revisions`,
    });
    expect(revisions.items).toHaveLength(1);
    const file = await app.inject({
      method: "GET",
      url: `/api/v1/kdp/books/${book.id}/covers/${stored.id}/file`,
    });
    expect(file.statusCode).toBe(200);
  });

  it("offers the default pen name once and lets it stay deleted", async () => {
    const owner = { "x-test-owner": "owner-c" };
    const { items } = await call<{ items: Array<{ id: string }> }>({
      method: "GET",
      url: "/kdp/authors",
      headers: owner,
    });
    expect(items).toHaveLength(1);
    await call(
      { method: "DELETE", url: `/kdp/authors/${items[0]!.id}`, headers: owner },
      204,
    );
    expect(
      (
        await call<{ items: unknown[] }>({
          method: "GET",
          url: "/kdp/authors",
          headers: owner,
        })
      ).items,
    ).toEqual([]);
  });

  it("enforces project ownership", async () => {
    const book = await createThriller();
    const other = { "x-test-owner": "owner-b" };
    expect(
      (
        await call<{ items: unknown[] }>({
          method: "GET",
          url: "/kdp/books",
          headers: other,
        })
      ).items,
    ).toEqual([]);
    await call(
      { method: "GET", url: `/kdp/books/${book.id}`, headers: other },
      404,
    );
    await call(
      { method: "GET", url: `/kdp/books/${book.id}/chapters`, headers: other },
      404,
    );
    await call(
      {
        method: "POST",
        url: `/kdp/books/${book.id}/jobs`,
        headers: other,
        payload: { kind: "concepts", idempotencyKey: "other-owner" },
      },
      404,
    );
    await call(
      { method: "DELETE", url: `/kdp/books/${book.id}`, headers: other },
      404,
    );
    await call({ method: "GET", url: `/kdp/books/${book.id}` });
  });

  it("deduplicates double clicks and retries transient provider failures", async () => {
    const book = await createThriller();
    const first = await call<{ job: KdpJob; created: boolean }>(
      {
        method: "POST",
        url: `/kdp/books/${book.id}/jobs`,
        payload: { kind: "concepts", idempotencyKey: "double-click" },
      },
      202,
    );
    const repeat = await call<{ job: KdpJob; created: boolean }>({
      method: "POST",
      url: `/kdp/books/${book.id}/jobs`,
      payload: { kind: "concepts", idempotencyKey: "double-click" },
    });
    const other = await call<{ job: KdpJob; created: boolean }>({
      method: "POST",
      url: `/kdp/books/${book.id}/jobs`,
      payload: { kind: "concepts", idempotencyKey: "second-tab" },
    });
    expect(repeat.job.id).toBe(first.job.id);
    expect(other).toMatchObject({ created: false, job: { id: first.job.id } });
    claude.failures.set(/story concepts/, { kind: "retryable", times: 2 });
    await services.kdp.runner.drain();
    expect(
      (
        await call<KdpJob>({
          method: "GET",
          url: `/kdp/books/${book.id}/jobs/${first.job.id}`,
        })
      ).status,
    ).toBe("succeeded");
    const runs = await call<{ runs: Array<{ status: string }> }>({
      method: "GET",
      url: `/kdp/books/${book.id}/costs`,
    });
    expect(runs.runs.map((run) => run.status)).toEqual([
      "succeeded",
      "failed",
      "failed",
    ]);
  });

  it("stops at the budget limit and resumes after the budget is raised", async () => {
    const { book } = await planned();
    await call({
      method: "PATCH",
      url: `/kdp/books/${book.id}`,
      payload: { settings: { budgetUsd: 0.01, routing: {} } },
    });
    const stopped = await job(book.id, { kind: "draft" });
    expect(stopped.status).toBe("budget_stopped");
    expect(stopped.errorMessage).toMatch(/budget/);
    const items = (
      await call<{ items: ChapterListItem[] }>({
        method: "GET",
        url: `/kdp/books/${book.id}/chapters`,
      })
    ).items;
    expect(items.every((chapter) => chapter.wordCount === 0)).toBe(true);
    await call({
      method: "PATCH",
      url: `/kdp/books/${book.id}`,
      payload: { settings: { budgetUsd: 50, routing: {} } },
    });
    await call({
      method: "POST",
      url: `/kdp/books/${book.id}/jobs/${stopped.id}/resume`,
    });
    await services.kdp.runner.drain();
    expect(
      (
        await call<KdpJob>({
          method: "GET",
          url: `/kdp/books/${book.id}/jobs/${stopped.id}`,
        })
      ).status,
    ).toBe("succeeded");
  });

  it("refuses to export a book with missing chapters instead of inventing them", async () => {
    const { book } = await planned();
    const failed = await call<BookExport>(
      { method: "POST", url: `/kdp/books/${book.id}/exports` },
      422,
    );
    expect(failed).toMatchObject({ status: "failed", files: [] });
    expect(failed.errorMessage).toMatch(/Chapters without text: 1, 2/);
  });

  it("duplicates, archives, soft-deletes and restores books", async () => {
    const book = await createThriller();
    const copy = await call<BookSummary>(
      { method: "POST", url: `/kdp/books/${book.id}/duplicate` },
      201,
    );
    expect(copy.title).toBe("Untitled book (copy)");
    await call({
      method: "PATCH",
      url: `/kdp/books/${copy.id}`,
      payload: { status: "archived" },
    });
    expect(
      (
        await call<{ items: BookSummary[] }>({
          method: "GET",
          url: "/kdp/books?status=archived",
        })
      ).items,
    ).toHaveLength(1);
    await call({ method: "DELETE", url: `/kdp/books/${copy.id}` }, 204);
    expect(
      (
        await call<{ items: BookSummary[] }>({
          method: "GET",
          url: "/kdp/books",
        })
      ).items,
    ).toHaveLength(1);
    await call({ method: "POST", url: `/kdp/books/${copy.id}/restore` });
    expect(
      (
        await call<{ items: BookSummary[] }>({
          method: "GET",
          url: "/kdp/books",
        })
      ).items,
    ).toHaveLength(2);
  });
});
