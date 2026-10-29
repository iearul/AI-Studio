import { randomUUID } from "node:crypto";

import {
  chapterInspectionGenerationSchema,
  conceptsGenerationSchema,
  coverConceptsGenerationSchema,
  editorialReportGenerationSchema,
  metadataGenerationSchema,
  outlineGenerationSchema,
  plotArchitectureGenerationSchema,
  storyBibleGenerationSchema,
  type AuthorProfile,
  type Book,
  type BookMetadata,
  type Chapter,
  type ChapterInspection,
  type EditorialFinding,
  type EditorialKind,
  type KdpJobKind,
  type KdpSettings,
  type MetadataGeneration,
  type StoryBible,
  type StoryBibleGeneration,
} from "@ai-studio/contracts";
import {
  architecturePrompt,
  biblePrompt,
  chapterCardPrompt,
  chapterDraftPrompt,
  coherencePrompt,
  conceptsPrompt,
  countManuscriptWords,
  coverPrompt,
  defaultKdpSettings,
  editorialPrompt,
  estimateTokens,
  expansionPrompt,
  inspectionPrompt,
  kdpRules,
  lintManuscript,
  metadataPrompt,
  needsExpansion,
  outlinePrompt,
  planChapterWords,
  planSceneWords,
  plainTextToManuscript,
  sceneDraftPrompt,
  shouldDraftByScene,
  suggestListPriceUsd,
  type DraftContextInput,
} from "@ai-studio/book-engine";
import {
  KdpConflictError,
  type KdpBookRepository,
  type KdpStoryRepository,
} from "@ai-studio/database";

import type { AiCallContext, KdpAiRouter } from "./ai-router.js";
import type { JobContext, JobHandler } from "./job-runner.js";

type Loaded = {
  book: Book;
  author: AuthorProfile | null;
  settings: KdpSettings;
};

const shortId = (prefix: string) => `${prefix}-${randomUUID().slice(0, 8)}`;

export function toStoredBible(
  generated: StoryBibleGeneration,
  architecture: StoryBible["architecture"] = null,
): StoryBible {
  return {
    ...generated,
    locations: generated.locations.map((location) => ({
      ...location,
      id: shortId("loc"),
    })),
    characters: generated.characters.map((character) => ({
      ...character,
      id: shortId("char"),
      state: null,
    })),
    chronology: generated.chronology.map((event) => ({
      ...event,
      id: shortId("evt"),
      chapterNumber: null,
    })),
    objects: generated.objects.map((item) => ({ ...item, id: shortId("obj") })),
    clues: generated.clues.map((clue) => ({
      ...clue,
      id: shortId("clue"),
      status: "planned",
      notes: null,
    })),
    architecture,
    canonFacts: [],
  };
}

function words(text: string): Set<string> {
  return new Set(text.toLowerCase().match(/[\p{L}\p{N}]{4,}/gu) ?? []);
}

function overlap(a: string, b: string): number {
  const left = words(a);
  const right = words(b);
  if (left.size === 0 || right.size === 0) return 0;
  let shared = 0;
  for (const word of left) if (right.has(word)) shared += 1;
  return shared / Math.min(left.size, right.size);
}

/** Markup-preserving text so editors can quote exact replaceable passages. */
function chapterMaterial(chapters: Chapter[]): string {
  return chapters
    .map(
      (chapter) =>
        `### Chapter ${chapter.number}${chapter.title ? `: ${chapter.title}` : ""}\n\n${chapter.content}`,
    )
    .join("\n\n");
}

function batches(chapters: Chapter[], maxTokens: number): Chapter[][] {
  const result: Chapter[][] = [];
  let current: Chapter[] = [];
  let size = 0;
  for (const chapter of chapters) {
    const tokens = estimateTokens(chapter.content);
    if (current.length > 0 && size + tokens > maxTokens) {
      result.push(current);
      current = [];
      size = 0;
    }
    current.push(chapter);
    size += tokens;
  }
  if (current.length > 0) result.push(current);
  return result;
}

export class KdpPipeline {
  constructor(
    private readonly books: KdpBookRepository,
    private readonly story: KdpStoryRepository,
    private readonly ai: KdpAiRouter,
  ) {}

  handlers(): Record<KdpJobKind, JobHandler> {
    return {
      concepts: (context) => this.concepts(context),
      bible: (context) => this.bible(context),
      architecture: (context) => this.architecture(context),
      outline: (context) => this.outline(context),
      draft: (context) => this.draft(context),
      editorial: (context) => this.editorial(context),
      metadata: (context) => this.metadata(context),
      "cover-prompts": (context) => this.coverPrompts(context),
    };
  }

  private load(context: JobContext): Loaded {
    const book = this.books.require(context.ownerId, context.job.bookId);
    const settings = this.books.getSettings(
      context.ownerId,
      defaultKdpSettings,
    );
    const author = book.authorProfileId
      ? (this.books.getAuthor(context.ownerId, book.authorProfileId) ?? null)
      : null;
    return { book, author, settings };
  }

  private call(
    context: JobContext,
    loaded: Loaded,
    stepKey: string,
  ): AiCallContext {
    return {
      ownerId: context.ownerId,
      book: loaded.book,
      settings: loaded.settings,
      jobId: context.job.id,
      stepKey,
      signal: context.signal,
    };
  }

  private guidance(context: JobContext): string | undefined {
    const value = context.job.input.guidance;
    return typeof value === "string" && value.trim() ? value : undefined;
  }

  private requireBible(bookId: string): StoryBible {
    const record = this.story.getBible(bookId);
    if (!record) throw new Error("Generate the story bible first.");
    return record.bible;
  }

  // --- Stage A ------------------------------------------------------------------

  private async concepts(
    context: JobContext,
  ): Promise<Record<string, unknown>> {
    const loaded = this.load(context);
    context.progress(0, 1, "Developing three concepts");
    const avoid = this.books
      .listConcepts(loaded.book.id)
      .map((record) => record.concept);
    const result = await context.step(
      "concepts",
      () =>
        this.ai.json(
          this.call(context, loaded, "concepts"),
          "idea",
          conceptsPrompt(loaded.book, loaded.author, {
            count: 3,
            avoid,
            guidance: this.guidance(context),
          }),
          conceptsGenerationSchema,
          { schemaName: "story_concepts", expectedOutputTokens: 3_500 },
        ),
      (output) => {
        this.books.addConcepts(loaded.book.id, output.concepts, context.job.id);
        this.books.advanceStage(loaded.book.id, "concepts");
      },
    );
    return { concepts: result.concepts.length };
  }

  // --- Stage B / C ------------------------------------------------------------

  private async bible(context: JobContext): Promise<Record<string, unknown>> {
    const loaded = this.load(context);
    const concept = this.books.selectedConcept(loaded.book.id);
    if (!concept) throw new Error("Choose a concept first.");
    context.progress(0, 1, "Building the story bible");
    const existing = this.story.getBible(loaded.book.id);
    const generated = await context.step(
      "bible",
      () =>
        this.ai.json(
          this.call(context, loaded, "bible"),
          "architect",
          biblePrompt(
            loaded.book,
            loaded.author,
            concept.concept,
            this.guidance(context),
          ),
          storyBibleGenerationSchema,
          { schemaName: "story_bible", expectedOutputTokens: 9_000 },
        ),
      (output) => {
        this.story.saveBible(
          loaded.book.id,
          toStoredBible(output, existing?.bible.architecture ?? null),
          "ai",
          {
            note: "Generated from the chosen concept",
          },
        );
        this.books.advanceStage(loaded.book.id, "bible");
      },
    );
    return {
      characters: generated.characters.length,
      clues: generated.clues.length,
    };
  }

  private async runArchitecture(
    context: JobContext,
    loaded: Loaded,
  ): Promise<void> {
    await context.step(
      "architecture",
      () =>
        this.ai.json(
          this.call(context, loaded, "architecture"),
          "architect",
          architecturePrompt(
            loaded.book,
            loaded.author,
            this.requireBible(loaded.book.id),
            this.guidance(context),
          ),
          plotArchitectureGenerationSchema,
          { schemaName: "plot_architecture", expectedOutputTokens: 5_000 },
        ),
      (architecture) => {
        const current = this.requireBible(loaded.book.id);
        this.story.saveBible(
          loaded.book.id,
          { ...current, architecture },
          "ai",
          { note: "Plot architecture" },
        );
      },
    );
  }

  private async architecture(
    context: JobContext,
  ): Promise<Record<string, unknown>> {
    const loaded = this.load(context);
    context.progress(0, 1, "Designing the plot architecture");
    await this.runArchitecture(context, loaded);
    return {};
  }

  // --- Stage D -----------------------------------------------------------------

  private async outline(context: JobContext): Promise<Record<string, unknown>> {
    const loaded = this.load(context);
    const { book } = loaded;
    const brief = book.brief;
    const only = context.job.input.chapterIds as string[] | undefined;
    if (only && only.length > 0)
      return this.regenerateCards(context, loaded, only);

    const needsArchitecture =
      !this.story.getBible(book.id)?.bible.architecture ||
      context.job.input.regenerate === true;
    const total = needsArchitecture ? 2 : 1;
    if (needsArchitecture) {
      context.progress(0, total, "Designing the plot architecture");
      await this.runArchitecture(context, loaded);
    }
    context.progress(total - 1, total, "Writing chapter cards");
    const targets = planChapterWords(
      brief.targetWords,
      brief.chapterCount,
      brief.pacing,
    );
    const outline = await context.step(
      "outline",
      () =>
        this.ai.json(
          this.call(context, loaded, "outline"),
          "architect",
          outlinePrompt(
            book,
            loaded.author,
            this.requireBible(book.id),
            targets,
            this.guidance(context),
          ),
          outlineGenerationSchema,
          {
            schemaName: "chapter_outline",
            expectedOutputTokens: 600 * targets.length + 1_000,
          },
        ),
      (output) => {
        // Re-plan with the real scene counts so busier chapters get more words.
        const planned = planChapterWords(
          brief.targetWords,
          output.chapters.length,
          brief.pacing,
          output.chapters.map((card) => card.scenes.length),
        );
        this.story.replaceOutline(
          book.id,
          output.chapters.map((card, index) => ({
            ...card,
            targetWords: planned[index]!,
          })),
        );
        this.books.advanceStage(book.id, "outline");
      },
    );
    return { chapters: outline.chapters.length, requested: targets.length };
  }

  private async regenerateCards(
    context: JobContext,
    loaded: Loaded,
    chapterIds: string[],
  ): Promise<Record<string, unknown>> {
    let done = 0;
    for (const chapterId of chapterIds) {
      context.progress(done, chapterIds.length, "Rewriting chapter cards");
      const chapters = this.story.listChapters(loaded.book.id);
      const chapter = chapters.find((item) => item.id === chapterId);
      if (!chapter) continue;
      if (chapter.locked) {
        context.skip(`card:${chapterId}`, "locked");
        continue;
      }
      await context.step(
        `card:${chapterId}`,
        () =>
          this.ai.json(
            this.call(context, loaded, `card:${chapterId}`),
            "architect",
            chapterCardPrompt(
              loaded.book,
              loaded.author,
              this.requireBible(loaded.book.id),
              chapters.map((item) => ({
                number: item.number,
                card: item.card,
              })),
              chapter.number,
              chapter.targetWords,
              this.guidance(context),
            ),
            outlineGenerationSchema,
            { schemaName: "chapter_outline", expectedOutputTokens: 900 },
          ),
        (output) => {
          const card = output.chapters[0];
          if (card) {
            this.story.updateChapter(loaded.book.id, chapterId, {
              card: { ...card, targetWords: chapter.targetWords },
            });
          }
        },
      );
      done += 1;
    }
    return { cards: done };
  }

  // --- Stage E / F -------------------------------------------------------------

  private draftInput(loaded: Loaded, chapterNumber: number): DraftContextInput {
    return {
      book: loaded.book,
      author: loaded.author,
      bible: this.requireBible(loaded.book.id),
      chapters: this.story.listChapters(loaded.book.id).map((chapter) => ({
        number: chapter.number,
        card: chapter.card,
        summary: chapter.summary,
        content: chapter.content,
      })),
      chapterNumber,
    };
  }

  private async writeChapter(
    context: JobContext,
    loaded: Loaded,
    chapter: Chapter,
  ): Promise<string> {
    const maxOutputTokens = Math.min(
      64_000,
      Math.max(16_000, chapter.targetWords * 5),
    );
    const card = chapter.card;
    let text: string;
    if (shouldDraftByScene(chapter.targetWords, card.scenes.length)) {
      const sceneWords = planSceneWords(
        chapter.targetWords,
        card.scenes.length,
      );
      const scenes: string[] = [];
      for (let index = 0; index < card.scenes.length; index += 1) {
        const key = `scene:${chapter.id}:${index}`;
        const scene = await context.step(key, async () => {
          const prose = await this.ai.prose(
            this.call(context, loaded, key),
            "writer",
            sceneDraftPrompt(
              this.draftInput(loaded, chapter.number),
              index,
              sceneWords[index]!,
              scenes,
            ),
            {
              expectedOutputTokens: Math.round(sceneWords[index]! * 1.4),
              maxOutputTokens,
            },
          );
          return plainTextToManuscriptIfNeeded(prose.text);
        });
        scenes.push(scene);
      }
      const coherenceKey = `coherence:${chapter.id}`;
      text = await context.step(coherenceKey, async () => {
        const prose = await this.ai.prose(
          this.call(context, loaded, coherenceKey),
          "writer",
          coherencePrompt(this.draftInput(loaded, chapter.number), scenes),
          {
            expectedOutputTokens: Math.round(chapter.targetWords * 1.4),
            maxOutputTokens,
          },
        );
        return plainTextToManuscriptIfNeeded(prose.text);
      });
    } else {
      const key = `write:${chapter.id}`;
      text = await context.step(key, async () => {
        const prose = await this.ai.prose(
          this.call(context, loaded, key),
          "writer",
          chapterDraftPrompt(this.draftInput(loaded, chapter.number)),
          {
            expectedOutputTokens: Math.round(chapter.targetWords * 1.4),
            maxOutputTokens,
          },
        );
        return plainTextToManuscriptIfNeeded(prose.text);
      });
    }
    const actual = countManuscriptWords(text);
    if (needsExpansion(actual, chapter.targetWords)) {
      const key = `expand:${chapter.id}`;
      text = await context.step(key, async () => {
        const prose = await this.ai.prose(
          this.call(context, loaded, key),
          "writer",
          expansionPrompt(
            this.draftInput(loaded, chapter.number),
            text,
            actual,
          ),
          {
            expectedOutputTokens: Math.round(chapter.targetWords * 1.4),
            maxOutputTokens,
          },
        );
        return plainTextToManuscriptIfNeeded(prose.text);
      });
    }
    return text;
  }

  private async draft(context: JobContext): Promise<Record<string, unknown>> {
    const loaded = this.load(context);
    const { book } = loaded;
    this.requireBible(book.id);
    const input = context.job.input as {
      chapterIds?: string[];
      regenerate?: boolean;
      inspectOnly?: boolean;
    };
    if (input.inspectOnly)
      return this.inspectOnly(context, loaded, input.chapterIds);
    // The selection is checkpointed so a resumed job works on the same chapters.
    const plan = await context.step("plan", () => {
      const chapters = this.story.listChapters(book.id);
      if (chapters.length === 0)
        throw new Error("Generate the chapter outline first.");
      return Promise.resolve(
        chapters
          .filter(
            (chapter) =>
              !input.chapterIds || input.chapterIds.includes(chapter.id),
          )
          .filter((chapter) => !chapter.locked && chapter.status !== "approved")
          .filter(
            (chapter) => input.regenerate === true || chapter.wordCount === 0,
          )
          .map((chapter) => chapter.id),
      );
    });
    this.books.advanceStage(book.id, "drafting");
    const skipped: Array<{ chapterId: string; reason: string }> = [];
    let drafted = 0;
    for (const [index, chapterId] of plan.entries()) {
      context.throwIfCancelled();
      const chapter = this.story
        .listChapters(book.id)
        .find((item) => item.id === chapterId);
      if (!chapter) {
        skipped.push({ chapterId, reason: "deleted" });
        continue;
      }
      context.progress(
        index * 2,
        plan.length * 2,
        `Chapter ${chapter.number}: drafting (${index + 1} of ${plan.length})`,
      );
      const draftKey = `draft:${chapter.id}`;
      if (!context.hasCompleted(draftKey)) {
        if (chapter.locked || chapter.status === "approved") {
          context.skip(draftKey, "locked");
          skipped.push({ chapterId, reason: "locked while the job ran" });
          continue;
        }
        if (chapter.status === "planned")
          this.story.setChapterStatus(chapter.id, "drafting");
        const text = await this.writeChapter(context, loaded, chapter);
        try {
          await context.step(
            draftKey,
            () => Promise.resolve({ words: countManuscriptWords(text) }),
            () =>
              this.story.saveChapterText(book.id, chapter.id, {
                content: text,
                source: "ai-draft",
                recordRevision: true,
                jobId: context.job.id,
                note: "Drafted by the chapter writer",
              }),
          );
        } catch (error) {
          if (!(error instanceof KdpConflictError)) throw error;
          context.skip(draftKey, error.message);
          skipped.push({ chapterId, reason: error.message });
          continue;
        }
      }
      drafted += 1;
      context.progress(
        index * 2 + 1,
        plan.length * 2,
        `Chapter ${chapter.number}: continuity inspection`,
      );
      await this.inspect(context, loaded, chapter.id);
    }
    const chapters = this.story.listChapters(book.id);
    if (chapters.every((chapter) => chapter.wordCount > 0))
      this.books.advanceStage(book.id, "editing");
    return { drafted, skipped };
  }

  /** Re-checks chapters the author edited, without touching their text. */
  private async inspectOnly(
    context: JobContext,
    loaded: Loaded,
    chapterIds?: string[],
  ): Promise<Record<string, unknown>> {
    const targets = this.story
      .listChapters(loaded.book.id)
      .filter(
        (chapter) =>
          chapter.wordCount > 0 &&
          (!chapterIds || chapterIds.includes(chapter.id)),
      );
    for (const [index, chapter] of targets.entries()) {
      context.progress(
        index,
        targets.length,
        `Chapter ${chapter.number}: continuity inspection`,
      );
      await this.inspect(context, loaded, chapter.id);
    }
    return { inspected: targets.length };
  }

  private async inspect(
    context: JobContext,
    loaded: Loaded,
    chapterId: string,
  ): Promise<void> {
    const key = `inspect:${chapterId}`;
    const chapter = this.story.getChapter(loaded.book.id, chapterId);
    await context.step(
      key,
      () =>
        this.ai.json(
          this.call(context, loaded, key),
          "inspector",
          inspectionPrompt(
            this.draftInput(loaded, chapter.number),
            chapter.content,
          ),
          chapterInspectionGenerationSchema,
          { schemaName: "chapter_inspection", expectedOutputTokens: 2_500 },
        ),
      (inspection) =>
        this.applyInspection(
          loaded.book,
          this.story.getChapter(loaded.book.id, chapterId),
          inspection,
        ),
    );
    const latest = this.story.getChapter(loaded.book.id, chapterId);
    this.story.replaceOpenIssues(
      loaded.book.id,
      "style",
      chapterId,
      lintManuscript([{ number: latest.number, content: latest.content }]).map(
        (finding) => ({
          ...finding,
          chapterId,
          originalText: null,
          replacementText: null,
        }),
      ),
    );
  }

  /** Records what a chapter established; changes to canon become proposals. */
  applyInspection(
    book: Book,
    chapter: Chapter,
    inspection: ChapterInspection,
  ): void {
    const record = this.story.getBible(book.id);
    if (!record) return;
    const number = chapter.number;
    const bible = structuredClone(record.bible);
    // A redrafted chapter replaces what its earlier draft established.
    bible.canonFacts = bible.canonFacts.filter(
      (fact) => fact.chapterNumber !== number,
    );
    bible.chronology = bible.chronology.filter(
      (event) => event.chapterNumber !== number || event.hiddenFromReader,
    );
    for (const fact of inspection.newFacts) {
      if (bible.canonFacts.some((item) => item.fact === fact.fact)) continue;
      bible.canonFacts.push({
        id: shortId("fact"),
        fact: fact.fact,
        category: fact.category,
        chapterNumber: number,
      });
    }
    for (const event of inspection.chronology) {
      bible.chronology.push({
        id: shortId("evt"),
        when: event.when,
        event: event.event,
        characters: [],
        hiddenFromReader: false,
        chapterNumber: number,
      });
    }
    for (const update of inspection.characterStates) {
      const character = bible.characters.find(
        (item) =>
          item.name.toLowerCase() === update.name.toLowerCase() ||
          item.name.toLowerCase().includes(update.name.toLowerCase()) ||
          update.name.toLowerCase().includes(item.name.toLowerCase()),
      );
      if (character) {
        character.state = `Ch. ${number}: ${update.state}`.slice(0, 1000);
      } else {
        this.story.recordCanonChange({
          bookId: book.id,
          chapterId: chapter.id,
          source: "inspection",
          change: `Character not in the bible appears: ${update.name} — ${update.state}`,
          reason: "Add them to the story bible if they matter.",
          status: "proposed",
        });
      }
    }
    for (const update of inspection.clueUpdates) {
      const ranked = bible.clues
        .map((clue) => ({
          clue,
          score: overlap(clue.description, update.clue),
        }))
        .sort((a, b) => b.score - a.score);
      const match =
        ranked[0] && ranked[0].score >= 0.3 ? ranked[0].clue : undefined;
      if (match) {
        if (update.status === "paid-off") {
          match.status = "paid-off";
          match.payoffChapter = number;
        } else if (match.status === "planned") {
          match.status = "planted";
          match.plantChapter = match.plantChapter ?? number;
        }
        match.notes = `Ch. ${number}: ${update.note}`.slice(0, 1000);
      } else {
        this.story.recordCanonChange({
          bookId: book.id,
          chapterId: chapter.id,
          source: "inspection",
          change: `Clue not in the register (${update.status}): ${update.clue}`,
          reason: update.note,
          status: "proposed",
        });
      }
    }
    for (const change of inspection.canonChanges) {
      this.story.recordCanonChange({
        bookId: book.id,
        chapterId: chapter.id,
        source: "inspection",
        change: change.change,
        reason: change.reason,
        status: "proposed",
      });
    }
    const findings: Array<EditorialFinding & { chapterId: string | null }> = [
      ...inspection.contradictions.map((item) => ({
        severity: item.severity,
        issue: item.issue,
        chapterNumber: number,
        location: `Chapter ${number}`,
        evidence: item.evidence,
        suggestion: item.suggestion,
        originalText: null,
        replacementText: null,
        chapterId: chapter.id,
      })),
      ...inspection.repetitions.map((item) => ({
        severity: "minor" as const,
        issue: item.issue,
        chapterNumber: number,
        location: `Chapter ${number}`,
        evidence: item.evidence,
        suggestion: "Cut or vary the repetition.",
        originalText: null,
        replacementText: null,
        chapterId: chapter.id,
      })),
      ...(inspection.transitionNote
        ? [
            {
              severity: "suggestion" as const,
              issue: "Scene transition",
              chapterNumber: number,
              location: `Opening of chapter ${number}`,
              evidence: inspection.transitionNote,
              suggestion: "Check the transition from the previous chapter.",
              originalText: null,
              replacementText: null,
              chapterId: chapter.id,
            },
          ]
        : []),
    ];
    this.story.replaceOpenIssues(book.id, "inspection", chapter.id, findings);
    this.story.setSummary(chapter.id, inspection.summary);
    this.story.saveBible(book.id, bible, "inspection", {
      note: `Continuity inspection of chapter ${number}`,
    });
  }

  // --- Editorial ---------------------------------------------------------------

  private async editorial(
    context: JobContext,
  ): Promise<Record<string, unknown>> {
    const loaded = this.load(context);
    const { book } = loaded;
    const bible = this.requireBible(book.id);
    const passes = (
      (context.job.input.passes as EditorialKind[] | undefined) ?? [
        "developmental",
        "continuity",
        "line",
        "copy",
        "originality",
      ]
    ).filter(
      (pass): pass is Exclude<EditorialKind, "style" | "inspection"> =>
        pass !== "style" && pass !== "inspection",
    );
    const chapters = this.story
      .listChapters(book.id)
      .filter((chapter) => chapter.wordCount > 0);
    if (chapters.length === 0)
      throw new Error("There is no chapter text to review yet.");
    const byNumber = new Map(
      chapters.map((chapter) => [chapter.number, chapter.id]),
    );

    // Free deterministic checks first; they cost nothing.
    this.story.replaceOpenIssues(
      book.id,
      "style",
      null,
      lintManuscript(
        chapters.map((chapter) => ({
          number: chapter.number,
          content: chapter.content,
        })),
      ).map((finding) => ({
        ...finding,
        chapterId: finding.chapterNumber
          ? (byNumber.get(finding.chapterNumber) ?? null)
          : null,
        originalText: null,
        replacementText: null,
      })),
    );

    const work: Array<{
      pass: (typeof passes)[number];
      batch: Chapter[];
      index: number;
    }> = [];
    for (const pass of passes) {
      const limit =
        pass === "developmental" || pass === "originality"
          ? 150_000
          : pass === "continuity"
            ? 60_000
            : 12_000;
      batches(chapters, limit).forEach((batch, index) =>
        work.push({ pass, batch, index }),
      );
    }
    let done = 0;
    for (const item of work) {
      context.progress(
        done,
        work.length,
        `${item.pass} review${item.batch.length < chapters.length ? `, chapters ${item.batch[0]!.number}–${item.batch[item.batch.length - 1]!.number}` : ""}`,
      );
      const key = `editorial:${item.pass}:${item.index}`;
      const scope =
        item.batch.length === chapters.length
          ? "the complete manuscript"
          : `chapters ${item.batch[0]!.number}–${item.batch[item.batch.length - 1]!.number}`;
      await context.step(
        key,
        () =>
          this.ai.json(
            this.call(context, loaded, key),
            item.pass === "copy" ? "proofreader" : "reviewer",
            editorialPrompt(
              book,
              item.pass,
              bible,
              `${chapterMaterial(item.batch)}\n\n(Text uses *asterisks* for italics and "* * *" for scene breaks. Copy originalText exactly, including asterisks.)`,
              scope,
            ),
            editorialReportGenerationSchema,
            { schemaName: "editorial_report", expectedOutputTokens: 6_000 },
          ),
        (report) =>
          this.story.addReview({
            bookId: book.id,
            kind: item.pass,
            jobId: context.job.id,
            summary: report.summary,
            strengths: report.strengths,
            chapterIds: item.batch.map((chapter) => chapter.id),
            findings: report.findings.map((finding) => ({
              ...finding,
              chapterId: finding.chapterNumber
                ? (byNumber.get(finding.chapterNumber) ?? null)
                : null,
            })),
          }),
      );
      done += 1;
    }
    this.books.advanceStage(book.id, "editing");
    return { passes, batches: work.length };
  }

  // --- Listing and cover ----------------------------------------------------------

  private async metadata(
    context: JobContext,
  ): Promise<Record<string, unknown>> {
    const loaded = this.load(context);
    const { book, author } = loaded;
    const chapters = this.story.listChapters(book.id);
    const words =
      chapters.reduce((sum, chapter) => sum + chapter.wordCount, 0) ||
      book.brief.targetWords;
    const bible = this.story.getBible(book.id)?.bible ?? null;
    context.progress(0, 1, "Writing the KDP listing");
    const generated = await context.step(
      "metadata",
      () =>
        this.ai.json(
          this.call(context, loaded, "metadata"),
          "metadata",
          metadataPrompt(
            book,
            author,
            bible,
            chapters.map(
              (chapter) => chapter.summary ?? chapter.card.objective,
            ),
            words,
          ),
          metadataGenerationSchema,
          { schemaName: "kdp_listing", expectedOutputTokens: 2_500 },
        ),
      (output) => {
        const existing = this.books.getMetadata(book.id, null)?.metadata;
        this.books.saveMetadata(
          book.id,
          mergeMetadata(book, author, existing, output, words),
          true,
        );
        this.books.addArtifact(
          book.id,
          "metadata-suggestion",
          output,
          context.job.id,
        );
        this.books.advanceStage(book.id, "publishing");
      },
    );
    return {
      keywords: generated.keywords.length,
      categories: generated.categories.length,
    };
  }

  private async coverPrompts(
    context: JobContext,
  ): Promise<Record<string, unknown>> {
    const loaded = this.load(context);
    context.progress(0, 1, "Designing cover concepts");
    const generated = await context.step(
      "cover-prompts",
      () =>
        this.ai.json(
          this.call(context, loaded, "cover-prompts"),
          "cover",
          coverPrompt(
            loaded.book,
            loaded.author,
            this.story.getBible(loaded.book.id)?.bible ?? null,
          ),
          coverConceptsGenerationSchema,
          { schemaName: "cover_concepts", expectedOutputTokens: 3_000 },
        ),
      (output) => {
        this.books.addArtifact(
          loaded.book.id,
          "cover-concepts",
          output.concepts,
          context.job.id,
        );
      },
    );
    return { concepts: generated.concepts.length };
  }
}

/** Prose is stored as markup; plain model text gets escaped asterisks. */
function plainTextToManuscriptIfNeeded(text: string): string {
  // Models follow the markup rules; only strip stray headings and fences.
  const cleaned = text
    .replace(/^```[a-z]*\n?|```$/gim, "")
    .replace(/^#{1,6}\s+.*$/m, (heading, offset: number) =>
      offset === 0 ? "" : heading,
    )
    .trim();
  return /\*[^*\n]+\*/.test(cleaned) || /^\* \* \*$/m.test(cleaned)
    ? cleaned
    : plainTextToManuscript(cleaned);
}

export function mergeMetadata(
  book: Book,
  author: AuthorProfile | null,
  existing: BookMetadata | undefined,
  generated: MetadataGeneration,
  words: number,
): BookMetadata {
  const [low, high] = kdpRules.pricing.royalty70Band.USD;
  const suggested = generated.suggestedPriceUsd || suggestListPriceUsd(words);
  const price = Math.min(Math.max(suggested, 0.99), 200);
  const seventy = price >= low && price <= high;
  return {
    title: book.title,
    subtitle: book.subtitle,
    seriesName: book.seriesName,
    seriesNumber: book.seriesNumber,
    edition: existing?.edition ?? null,
    penName: author?.penName ?? existing?.penName ?? "",
    contributors: existing?.contributors ?? [],
    language: book.language,
    description: generated.description,
    keywords: generated.keywords.slice(0, kdpRules.metadata.keywordsMax),
    categories: generated.categories.slice(0, kdpRules.metadata.categoriesMax),
    primaryMarketplace:
      existing?.primaryMarketplace ??
      (book.language === "de" ? "amazon.de" : "amazon.com"),
    audience: generated.audience,
    sexuallyExplicit: generated.sexuallyExplicit,
    explicitContentAssessment: generated.explicitContentAssessment,
    minimumReaderAge: generated.minimumReaderAge,
    contentWarnings: generated.contentWarnings,
    publishingRights: existing?.publishingRights ?? "own-copyright",
    pricing: {
      currency: existing?.pricing.currency ?? "USD",
      listPrice: existing?.pricing.listPrice ?? price,
      royaltyPlan: existing?.pricing.royaltyPlan ?? (seventy ? "70" : "35"),
      rationale: generated.pricingRationale,
    },
    kdpSelect: existing?.kdpSelect ?? {
      enroll: null,
      notes:
        "KDP Select requires eBook exclusivity to Amazon for 90-day terms that renew automatically. It adds Kindle+ page-read income and promotions, and is required for 70% royalties in Brazil, Japan, Mexico and India. Decide after checking where else you want to sell.",
    },
    publication: existing?.publication ?? {
      plan: "undecided",
      date: null,
      notes: "",
    },
    publisher: existing?.publisher ?? null,
    imprint: existing?.imprint ?? null,
    isbnNote:
      existing?.isbnNote ??
      "Kindle eBooks do not need an ISBN; Amazon assigns an ASIN. A paperback needs its own ISBN (free from KDP or your own); never reuse an eBook ISBN for print.",
    checklist: existing?.checklist ?? {},
  };
}
