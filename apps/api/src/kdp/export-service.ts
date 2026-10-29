import { randomUUID } from "node:crypto";

import type {
  AuthorProfile,
  Book,
  BookExport,
  BookMetadata,
  Chapter,
  CoverConcept,
  ExportFile,
  ExportFileKind,
  ExportValidation,
} from "@ai-studio/contracts";
import {
  checkMetadata,
  disclosureChecklist,
  kdpRules,
  languageName,
  parseManuscript,
} from "@ai-studio/book-engine";
import type {
  KdpBookRepository,
  KdpJobRepository,
  KdpStoryRepository,
} from "@ai-studio/database";
import {
  buildDocx,
  buildEpub,
  buildMarkdown,
  buildPlainText,
  buildZip,
  readZip,
  runEpubCheck,
  validateEpubStructure,
  type ExportManuscript,
  type ExportSection,
} from "@ai-studio/book-export";

import { fileSlug, type BookFileStore } from "./book-files.js";
import type { KdpProvenanceService } from "./provenance-service.js";

export class KdpExportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "KdpExportError";
  }
}

const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (character) => `&#${character.charCodeAt(0)};`);

const mimeTypes: Record<ExportFileKind, string> = {
  epub: "application/epub+zip",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  markdown: "text/markdown; charset=utf-8",
  text: "text/plain; charset=utf-8",
  "metadata-json": "application/json",
  "metadata-html": "text/html; charset=utf-8",
  "cover-jpeg": "image/jpeg",
  "cover-prompts": "text/plain; charset=utf-8",
  "editorial-report": "text/html; charset=utf-8",
  "disclosure-report": "text/html; charset=utf-8",
  "project-backup": "application/json",
  zip: "application/zip",
};

function paragraphs(text: string | null | undefined): ExportSection["blocks"] {
  return text ? parseManuscript(text) : [];
}

function chapterHeading(chapter: Chapter, labels: { chapter: string }): string {
  if (
    chapter.title &&
    /^(epilogue|prologue|epilog|prolog)\b/i.test(chapter.title)
  )
    return chapter.title;
  return chapter.title
    ? `${labels.chapter} ${chapter.number}: ${chapter.title}`
    : `${labels.chapter} ${chapter.number}`;
}

const chapterWord: Record<string, string> = {
  de: "Kapitel",
  fr: "Chapitre",
  es: "Capítulo",
  it: "Capitolo",
  nl: "Hoofdstuk",
};

/** Builds the manuscript in publication order from the book's sections. */
export function assembleManuscript(
  book: Book,
  author: AuthorProfile | null,
  chapters: Chapter[],
  metadata: BookMetadata | null,
): ExportManuscript {
  const matter = book.settings.matter;
  const penName = author?.penName ?? metadata?.penName ?? "";
  const year = new Date().getFullYear();
  const copyright =
    author?.copyrightNotice ??
    `Copyright © ${year} ${penName}. All rights reserved.\n\nNo part of this book may be reproduced in any form without written permission from the author, except for brief quotations in reviews.\n\nThis is a work of fiction. Names, characters, places and incidents are products of the author's imagination or are used fictitiously. Any resemblance to actual persons, living or dead, events or locales is coincidental.`;
  const labels = {
    chapter: chapterWord[book.language.slice(0, 2)] ?? "Chapter",
  };
  const sections: ExportSection[] = [
    {
      id: "title-page",
      kind: "title-page",
      role: "front",
      title: book.title,
      showHeading: false,
      includeInToc: false,
      blocks: [],
    },
    {
      id: "copyright",
      kind: "copyright",
      role: "front",
      title: "Copyright",
      showHeading: false,
      includeInToc: false,
      blocks: paragraphs(copyright),
    },
  ];
  const dedication = matter.dedication ?? author?.dedication;
  if (dedication) {
    sections.push({
      id: "dedication",
      kind: "dedication",
      role: "front",
      title: "Dedication",
      showHeading: false,
      includeInToc: false,
      blocks: paragraphs(dedication),
    });
  }
  const notice =
    matter.contentNotice ??
    author?.contentNotice ??
    (metadata?.contentWarnings.length
      ? `This book contains: ${metadata.contentWarnings.join(", ")}.`
      : null);
  if (matter.includeContentNotice && notice) {
    sections.push({
      id: "content-notice",
      kind: "content-notice",
      role: "front",
      title: "Content Notice",
      showHeading: true,
      includeInToc: false,
      blocks: paragraphs(notice),
    });
  }
  if (matter.includeToc) {
    sections.push({
      id: "contents",
      kind: "toc",
      role: "front",
      title: book.language.startsWith("de") ? "Inhalt" : "Contents",
      showHeading: true,
      includeInToc: false,
      blocks: [],
    });
  }
  for (const chapter of chapters) {
    const epilogue = /^(epilogue|epilog)\b/i.test(chapter.title ?? "");
    sections.push({
      id: `chapter-${chapter.number}`,
      kind: epilogue ? "epilogue" : "chapter",
      role: "body",
      title: chapterHeading(chapter, labels),
      showHeading: true,
      includeInToc: true,
      blocks: parseManuscript(chapter.content),
    });
  }
  const back: Record<(typeof matter.backMatter)[number], ExportSection | null> =
    {
      "about-author": author?.aboutAuthor
        ? {
            id: "about-the-author",
            kind: "about-author",
            role: "back",
            title: "About the Author",
            showHeading: true,
            includeInToc: true,
            blocks: paragraphs(author.aboutAuthor),
          }
        : null,
      "next-book-preview": author?.nextBookPreview
        ? {
            id: "next-book-preview",
            kind: "next-book-preview",
            role: "back",
            title: "Preview",
            showHeading: true,
            includeInToc: true,
            blocks: paragraphs(author.nextBookPreview),
          }
        : null,
      "call-to-action": author?.callToAction
        ? {
            id: "from-the-author",
            kind: "call-to-action",
            role: "back",
            title: "From the Author",
            showHeading: true,
            includeInToc: true,
            blocks: paragraphs(author.callToAction),
          }
        : null,
    };
  for (const kind of matter.backMatter) {
    const section = back[kind];
    if (section) sections.push(section);
  }
  return {
    meta: {
      identifier: book.id,
      title: book.title,
      subtitle: book.subtitle,
      authorName: penName,
      language: book.language,
      publisher: metadata?.imprint ?? metadata?.publisher ?? null,
      description:
        metadata?.description
          .replace(/<[^>]+>/g, " ")
          .replace(/\s+/g, " ")
          .trim() || null,
      seriesName: book.seriesName,
      seriesNumber: book.seriesNumber,
      rights: `Copyright © ${year} ${penName}`,
      subjects: [
        book.brief.genre,
        ...(book.brief.subgenre ? [book.brief.subgenre] : []),
      ],
      modifiedAt: new Date().toISOString(),
    },
    sections,
  };
}

function htmlPage(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
<style>body{font:15px/1.55 -apple-system,Segoe UI,sans-serif;max-width:860px;margin:32px auto;padding:0 16px;color:#1b1b18}
h1{font-family:Georgia,serif}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ddd;padding:6px 8px;text-align:left;vertical-align:top}
.sev-critical{color:#a11}.sev-major{color:#b54708}.muted{color:#6f6f67}</style></head><body>${body}</body></html>`;
}

export class KdpExportService {
  constructor(
    private readonly books: KdpBookRepository,
    private readonly story: KdpStoryRepository,
    private readonly jobs: KdpJobRepository,
    private readonly files: BookFileStore,
    private readonly provenance: KdpProvenanceService,
  ) {}

  async export(ownerId: string, bookId: string): Promise<BookExport> {
    const book = this.books.require(ownerId, bookId);
    const author = book.authorProfileId
      ? (this.books.getAuthor(ownerId, book.authorProfileId) ?? null)
      : null;
    const chapters = this.story.listChapters(book.id);
    const exportId = randomUUID();
    const directory = `exports/${exportId}`;
    const wordCount = chapters.reduce(
      (sum, chapter) => sum + chapter.wordCount,
      0,
    );
    const empty = chapters.filter((chapter) => chapter.wordCount === 0);
    if (chapters.length === 0 || empty.length > 0) {
      return this.jobs.addExport({
        id: exportId,
        bookId: book.id,
        status: "failed",
        directory,
        files: [],
        validation: null,
        errorMessage:
          chapters.length === 0
            ? "The book has no chapters."
            : `Chapters without text: ${empty.map((chapter) => chapter.number).join(", ")}. Draft or write them before exporting; missing chapters are never invented.`,
        wordCount,
      });
    }
    try {
      return await this.build(
        book,
        author,
        chapters,
        exportId,
        directory,
        wordCount,
      );
    } catch (error) {
      await this.files.remove(book.id, directory).catch(() => undefined);
      return this.jobs.addExport({
        id: exportId,
        bookId: book.id,
        status: "failed",
        directory,
        files: [],
        validation: null,
        errorMessage:
          error instanceof Error ? error.message : "The export failed.",
        wordCount,
      });
    }
  }

  private async build(
    book: Book,
    author: AuthorProfile | null,
    chapters: Chapter[],
    exportId: string,
    directory: string,
    wordCount: number,
  ): Promise<BookExport> {
    const metadataRecord = this.books.getMetadata(
      book.id,
      book.listingApprovedAt,
    );
    const metadata = metadataRecord?.metadata ?? null;
    const manuscript = assembleManuscript(book, author, chapters, metadata);
    const slug = fileSlug(book.title);
    const outputs: Array<{
      kind: ExportFileKind;
      filename: string;
      data: Uint8Array | string;
    }> = [];

    const cover = book.currentCoverId
      ? this.jobs.getCover(book.id, book.currentCoverId)
      : null;
    const coverBytes = cover
      ? await this.files.read(book.id, this.jobs.coverPath(book.id, cover.id))
      : null;
    const epub = buildEpub(
      manuscript,
      book.settings.matter.embedCoverInEpub &&
        coverBytes &&
        cover?.mimeType === "image/jpeg"
        ? { cover: { bytes: coverBytes, mimeType: "image/jpeg" } }
        : {},
    );
    outputs.push({ kind: "epub", filename: `${slug}.epub`, data: epub });
    const docx = await buildDocx(manuscript);
    outputs.push({ kind: "docx", filename: `${slug}.docx`, data: docx });
    outputs.push({
      kind: "markdown",
      filename: `${slug}.md`,
      data: buildMarkdown(manuscript),
    });
    outputs.push({
      kind: "text",
      filename: `${slug}.txt`,
      data: buildPlainText(manuscript),
    });

    const provenance = this.provenance.refresh(book.ownerId, book.id);
    if (metadata) {
      outputs.push({
        kind: "metadata-json",
        filename: `${slug}-kdp-metadata.json`,
        data: JSON.stringify(
          {
            rulesVersion: kdpRules.version,
            rulesVerifiedAt: kdpRules.verifiedAt,
            approvedAt: book.listingApprovedAt,
            metadata,
            aiDisclosure: disclosureChecklist(provenance),
          },
          null,
          2,
        ),
      });
      outputs.push({
        kind: "metadata-html",
        filename: `${slug}-kdp-listing.html`,
        data: this.listingHtml(book, metadata),
      });
    }
    if (
      cover &&
      coverBytes &&
      cover.kind === "final" &&
      cover.mimeType === "image/jpeg"
    ) {
      outputs.push({
        kind: "cover-jpeg",
        filename: `${slug}-cover.jpg`,
        data: coverBytes,
      });
    }
    const coverConcepts = this.books.latestArtifact<CoverConcept[]>(
      book.id,
      "cover-concepts",
    );
    if (coverConcepts) {
      outputs.push({
        kind: "cover-prompts",
        filename: `${slug}-cover-prompts.txt`,
        data: this.coverPromptsText(coverConcepts.data),
      });
    }
    outputs.push({
      kind: "editorial-report",
      filename: `${slug}-editorial-report.html`,
      data: this.editorialHtml(book),
    });
    outputs.push({
      kind: "disclosure-report",
      filename: `${slug}-ai-disclosure.html`,
      data: this.disclosureHtml(book, provenance),
    });
    outputs.push({
      kind: "project-backup",
      filename: `${slug}-project-backup.json`,
      data: JSON.stringify(this.backup(book, author), null, 2),
    });

    const written: ExportFile[] = [];
    for (const output of outputs) {
      const stored = await this.files.write(
        book.id,
        `${directory}/${output.filename}`,
        output.data,
      );
      written.push({
        kind: output.kind,
        filename: output.filename,
        mimeType: mimeTypes[output.kind],
        byteSize: stored.byteSize,
        sha256: stored.sha256,
      });
    }

    const validation = await this.validate(
      book.id,
      `${directory}/${slug}.epub`,
      epub,
      docx,
    );
    const coverFiles = await Promise.all(
      this.jobs.listCovers(book.id).map(async (item) => ({
        path: `covers/v${item.version}-${item.kind}${item.mimeType === "image/png" ? ".png" : item.mimeType === "image/webp" ? ".webp" : ".jpg"}`,
        data: await this.files.read(
          book.id,
          this.jobs.coverPath(book.id, item.id),
        ),
      })),
    );
    const zip = buildZip([
      ...outputs.map((output) => ({
        path: output.filename,
        data: output.data,
      })),
      { path: "validation.json", data: JSON.stringify(validation, null, 2) },
      ...coverFiles,
    ]);
    const zipFile = await this.files.write(
      book.id,
      `${directory}/${slug}-publisher-kit.zip`,
      zip,
    );
    written.push({
      kind: "zip",
      filename: `${slug}-publisher-kit.zip`,
      mimeType: mimeTypes.zip,
      byteSize: zipFile.byteSize,
      sha256: zipFile.sha256,
    });

    return this.jobs.addExport({
      id: exportId,
      bookId: book.id,
      status: "succeeded",
      directory,
      files: written,
      validation,
      errorMessage: null,
      wordCount,
    });
  }

  private async validate(
    bookId: string,
    epubPath: string,
    epub: Uint8Array,
    docx: Uint8Array,
  ): Promise<ExportValidation> {
    const structure = validateEpubStructure(epub);
    const check = await runEpubCheck(
      this.files.absolutePath(bookId, epubPath),
      { timeoutMs: 180_000 },
    );
    const docxErrors: string[] = [];
    try {
      const entries = readZip(docx);
      const document = entries.get("word/document.xml");
      if (!document) docxErrors.push("word/document.xml is missing.");
      const xml = document ? Buffer.from(document).toString("utf8") : "";
      if (/<w:(?:ins|del)\b/.test(xml))
        docxErrors.push("The document contains tracked changes.");
      if (/<w:commentReference\b/.test(xml))
        docxErrors.push("The document contains comments.");
      if (!/w:val="Heading1"/.test(xml))
        docxErrors.push("No Heading 1 chapter headings were found.");
    } catch {
      docxErrors.push("The DOCX file could not be opened as a ZIP package.");
    }
    return {
      epubStructure: {
        ok: structure.ok,
        errors: structure.errors,
        warnings: structure.warnings,
      },
      epubcheck: {
        available: check.available,
        version: check.version,
        passed: check.passed,
        fatal: check.counts.fatal,
        errors: check.counts.error,
        warnings: check.counts.warning,
        messages: check.messages.slice(0, 100),
      },
      docx: { ok: docxErrors.length === 0, errors: docxErrors },
    };
  }

  private listingHtml(book: Book, metadata: BookMetadata): string {
    const findings = checkMetadata(metadata);
    const rows: Array<[string, string]> = [
      ["Title", metadata.title],
      ["Subtitle", metadata.subtitle ?? "—"],
      [
        "Series",
        metadata.seriesName
          ? `${metadata.seriesName} #${metadata.seriesNumber ?? ""}`
          : "—",
      ],
      ["Author", metadata.penName],
      ["Language", languageName(metadata.language)],
      ["Primary marketplace", metadata.primaryMarketplace],
      ["Keywords", metadata.keywords.map(escapeHtml).join("<br>")],
      [
        "Categories",
        metadata.categories
          .map((category) => escapeHtml(category.path))
          .join("<br>"),
      ],
      ["Audience", metadata.audience],
      ["Sexually explicit", metadata.sexuallyExplicit ? "Yes" : "No"],
      [
        "Price",
        `${metadata.pricing.listPrice} ${metadata.pricing.currency}, ${metadata.pricing.royaltyPlan}% royalty`,
      ],
      [
        "Publishing rights",
        metadata.publishingRights === "own-copyright"
          ? "I own the copyright"
          : "Public domain",
      ],
    ];
    return htmlPage(
      `${book.title} — KDP listing`,
      `<h1>${escapeHtml(book.title)}</h1><p class="muted">KDP rules ${kdpRules.version}, verified ${kdpRules.verifiedAt}. Listing ${book.listingApprovedAt ? `approved ${book.listingApprovedAt}` : "not yet approved"}.</p>
<table>${rows.map(([label, value]) => `<tr><th>${label}</th><td>${label === "Keywords" || label === "Categories" ? value : escapeHtml(value)}</td></tr>`).join("")}</table>
<h2>Description</h2><div>${metadata.description}</div>
${findings.length ? `<h2>Checks</h2><ul>${findings.map((finding) => `<li>${finding.level}: ${escapeHtml(finding.message)}</li>`).join("")}</ul>` : ""}`,
    );
  }

  private coverPromptsText(concepts: CoverConcept[]): string {
    return concepts
      .map(
        (concept, index) =>
          `CONCEPT ${index + 1}: ${concept.name}\n\nPrompt (artwork only, no lettering):\n${concept.mainPrompt}\n\nNegative prompt:\n${concept.negativePrompt ?? "—"}\n\nComposition: ${concept.composition}\nPalette: ${concept.palette.join(", ")}\nTypography: ${concept.typography.titleFont}; ${concept.typography.authorFont}. ${concept.typography.notes}\nText placement: ${concept.textPlacement}\nThumbnail readability: ${concept.genreReadability}\n`,
      )
      .join("\n----------------------------------------\n\n");
  }

  private editorialHtml(book: Book): string {
    const reviews = this.story.listReviews(book.id);
    const issues = this.story.listIssues(book.id);
    return htmlPage(
      `${book.title} — editorial report`,
      `<h1>Editorial report: ${escapeHtml(book.title)}</h1>
<p class="muted">AI-assisted review. It is not professional editing, and it does not certify originality or legal clearance.</p>
${reviews.map((review) => `<h2>${escapeHtml(review.kind)} review <span class="muted">${review.createdAt}</span></h2><p>${escapeHtml(review.summary)}</p>${review.strengths.length ? `<p><strong>Strengths:</strong> ${review.strengths.map(escapeHtml).join("; ")}</p>` : ""}`).join("")}
<h2>Issues (${issues.length})</h2>
<table><tr><th>Severity</th><th>Kind</th><th>Issue</th><th>Location</th><th>Evidence</th><th>Suggestion</th><th>Status</th></tr>
${issues.map((issue) => `<tr><td class="sev-${issue.severity}">${issue.severity}</td><td>${issue.kind}</td><td>${escapeHtml(issue.issue)}</td><td>${escapeHtml(issue.location)}</td><td>${escapeHtml(issue.evidence)}</td><td>${escapeHtml(issue.suggestion)}</td><td>${issue.status}</td></tr>`).join("")}</table>`,
    );
  }

  private disclosureHtml(
    book: Book,
    provenance: ReturnType<KdpProvenanceService["refresh"]>,
  ): string {
    const answers = disclosureChecklist(provenance);
    return htmlPage(
      `${book.title} — AI content disclosure`,
      `<h1>AI content disclosure: ${escapeHtml(book.title)}</h1>
<p>KDP asks whether a book contains AI-generated text, images or translations. AI-generated content must be disclosed; AI-assisted content (your own work edited or checked with AI tools) does not need to be. Content created by AI stays AI-generated even after substantial editing.</p>
<table><tr><th>Asset</th><th>Classification</th><th>Recommended answer</th><th>Basis</th></tr>
${answers.map((answer) => `<tr><td>${answer.label}</td><td>${answer.classification}</td><td>${escapeHtml(answer.answer)}</td><td>${escapeHtml(answer.note)}</td></tr>`).join("")}</table>
<p class="muted">Rules ${kdpRules.version}, verified ${kdpRules.verifiedAt}. Check KDP's current wording when you publish.</p>`,
    );
  }

  /** Everything needed to understand and rebuild the project, as data. */
  backup(book: Book, author: AuthorProfile | null): Record<string, unknown> {
    const chapters = this.story.listChapters(book.id);
    return {
      format: "kdp-story-studio-backup",
      version: 1,
      exportedAt: new Date().toISOString(),
      book,
      author,
      concepts: this.books.listConcepts(book.id),
      storyBible: this.story.getBible(book.id),
      canonChanges: this.story.listCanonChanges(book.id),
      chapters,
      revisions: chapters.flatMap((chapter) =>
        this.story.listRevisions(book.id, chapter.id),
      ),
      editorialReviews: this.story.listReviews(book.id),
      editorialIssues: this.story.listIssues(book.id),
      metadata: this.books.getMetadata(book.id, book.listingApprovedAt),
      provenance: this.books.listProvenance(book.id),
      publication: this.books.getPublication(book.id),
      covers: this.jobs.listCovers(book.id),
      coverConcepts:
        this.books.latestArtifact(book.id, "cover-concepts")?.data ?? null,
      aiRuns: this.jobs.listRuns(book.id, 10_000),
    };
  }
}
