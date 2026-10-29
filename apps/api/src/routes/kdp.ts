import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";

import {
  authorProfileInputSchema,
  bookListQuerySchema,
  bookMetadataSchema,
  coverUploadFieldsSchema,
  createBookSchema,
  createChapterSchema,
  passageOperationSchema,
  provenanceAssets,
  reorderChaptersSchema,
  saveChapterContentSchema,
  saveStoryBibleSchema,
  startKdpJobSchema,
  storyConceptSchema,
  updateAuthorProfileSchema,
  updateBookSchema,
  updateChapterSchema,
  updateEditorialIssueSchema,
  updateKdpSettingsSchema,
  updateProvenanceSchema,
  updatePublicationRecordSchema,
  type CoverConcept,
  type MetadataGeneration,
} from "@ai-film-studio/contracts";
import {
  checkIdentityConsistency,
  checkMetadata,
  craftProfiles,
  defaultAuthorProfile,
  disclosureChecklist,
  estimateRoyalty,
  kdpRules,
  lengthPresets,
  lintManuscript,
} from "@ai-film-studio/book-engine";
import { buildDocx, buildMarkdown } from "@ai-film-studio/book-export";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

import { assembleManuscript } from "../kdp/export-service.js";
import { fileSlug } from "../kdp/book-files.js";
import type { Services } from "../services.js";

const bookParams = z.object({ bookId: z.uuid() });
const chapterParams = bookParams.extend({ chapterId: z.uuid() });
const jobParams = bookParams.extend({ jobId: z.uuid() });
const coverParams = bookParams.extend({ coverId: z.uuid() });
const issueParams = bookParams.extend({ issueId: z.uuid() });
const conceptParams = bookParams.extend({ conceptId: z.uuid() });
const exportFileParams = bookParams.extend({
  exportId: z.uuid(),
  filename: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,120}$/),
});

const approvalSchema = z.object({
  field: z.enum(["manuscript", "listing"]),
  approved: z.boolean(),
});

const coverQuerySchema = coverUploadFieldsSchema
  .omit({ settings: true })
  .extend({ settings: z.string().max(8_000).optional() });

function attachment(reply: FastifyReply, filename: string, mimeType: string) {
  return reply
    .type(mimeType)
    .header("Content-Disposition", `attachment; filename="${filename}"`)
    .header("Cache-Control", "no-store")
    .header("Cross-Origin-Resource-Policy", "cross-origin");
}

export function registerKdpRoutes(
  app: FastifyInstance,
  services: Services,
): void {
  const kdp = services.kdp;
  const owner = (request: FastifyRequest) => kdp.resolveOwner(request);

  /** First visit: offer the default pen name so a book can be created at once. */
  const ensureAuthors = (ownerId: string) => {
    const authors = kdp.books.listAuthors(ownerId);
    // Only a first visit gets the default; a deleted default stays deleted.
    if (authors.length > 0 || kdp.books.hasEverHadAuthor(ownerId))
      return authors;
    kdp.books.createAuthor(ownerId, defaultAuthorProfile);
    return kdp.books.listAuthors(ownerId);
  };

  // --- Reference data, settings, providers ----------------------------------

  app.get("/kdp/reference", () => ({
    rules: kdpRules,
    lengthPresets,
    craftProfiles: craftProfiles.map(({ id, label, techniques }) => ({
      id,
      label,
      techniques,
    })),
  }));

  app.get("/kdp/settings", (request) => kdp.service.settings(owner(request)));

  app.put("/kdp/settings", (request) =>
    kdp.service.updateSettings(
      owner(request),
      updateKdpSettingsSchema.parse(request.body),
    ),
  );

  app.get<{ Querystring: { force?: string } }>(
    "/kdp/providers",
    async (request) => ({
      providers: await kdp.service.health(request.query.force === "true"),
      worker: { running: kdp.runner.isRunning },
    }),
  );

  // --- Pen names ---------------------------------------------------------------

  app.get("/kdp/authors", (request) => ({
    items: ensureAuthors(owner(request)),
  }));

  app.post("/kdp/authors", (request, reply) =>
    reply
      .status(201)
      .send(
        kdp.books.createAuthor(
          owner(request),
          authorProfileInputSchema.parse(request.body),
        ),
      ),
  );

  app.patch<{ Params: { authorId: string } }>(
    "/kdp/authors/:authorId",
    (request) =>
      kdp.books.updateAuthor(
        owner(request),
        z.uuid().parse(request.params.authorId),
        updateAuthorProfileSchema.parse(request.body),
      ),
  );

  app.delete<{ Params: { authorId: string } }>(
    "/kdp/authors/:authorId",
    (request, reply) => {
      kdp.books.deleteAuthor(
        owner(request),
        z.uuid().parse(request.params.authorId),
      );
      return reply.status(204).send();
    },
  );

  // --- Books -----------------------------------------------------------------

  app.get("/kdp/books", (request) => {
    const items = kdp.books.list(
      owner(request),
      bookListQuerySchema.parse(request.query),
    );
    return { items, total: items.length };
  });

  app.post(
    "/kdp/books",
    { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } },
    (request, reply) => {
      const book = kdp.books.create(
        owner(request),
        createBookSchema.parse(request.body),
      );
      return reply.status(201).send(kdp.books.summary(owner(request), book.id));
    },
  );

  app.get("/kdp/books/:bookId", (request) => {
    const { bookId } = bookParams.parse(request.params);
    return kdp.books.summary(owner(request), bookId);
  });

  app.patch("/kdp/books/:bookId", (request) => {
    const { bookId } = bookParams.parse(request.params);
    kdp.books.update(
      owner(request),
      bookId,
      updateBookSchema.parse(request.body),
    );
    return kdp.books.summary(owner(request), bookId);
  });

  app.delete("/kdp/books/:bookId", (request, reply) => {
    const { bookId } = bookParams.parse(request.params);
    kdp.books.softDelete(owner(request), bookId);
    return reply.status(204).send();
  });

  app.post("/kdp/books/:bookId/restore", (request) => {
    const { bookId } = bookParams.parse(request.params);
    kdp.books.restore(owner(request), bookId);
    return kdp.books.summary(owner(request), bookId);
  });

  app.post("/kdp/books/:bookId/duplicate", (request, reply) => {
    const { bookId } = bookParams.parse(request.params);
    const copy = kdp.books.duplicate(owner(request), bookId);
    return reply.status(201).send(kdp.books.summary(owner(request), copy.id));
  });

  app.post("/kdp/books/:bookId/approval", (request) => {
    const { bookId } = bookParams.parse(request.params);
    const { field, approved } = approvalSchema.parse(request.body);
    kdp.books.setApproval(owner(request), bookId, field, approved);
    return kdp.service.syncReadyStatus(owner(request), bookId);
  });

  app.get("/kdp/books/:bookId/readiness", (request) => {
    const { bookId } = bookParams.parse(request.params);
    return kdp.service.syncReadyStatus(owner(request), bookId);
  });

  // --- Concepts ------------------------------------------------------------------

  app.get("/kdp/books/:bookId/concepts", (request) => {
    const { bookId } = bookParams.parse(request.params);
    kdp.books.require(owner(request), bookId);
    return { items: kdp.books.listConcepts(bookId) };
  });

  app.put("/kdp/books/:bookId/concepts/:conceptId", (request) => {
    const { bookId, conceptId } = conceptParams.parse(request.params);
    kdp.books.require(owner(request), bookId);
    return kdp.books.updateConcept(
      bookId,
      conceptId,
      storyConceptSchema.parse(request.body),
    );
  });

  app.post("/kdp/books/:bookId/concepts/:conceptId/select", (request) => {
    const { bookId, conceptId } = conceptParams.parse(request.params);
    kdp.books.require(owner(request), bookId);
    return kdp.books.selectConcept(bookId, conceptId);
  });

  // --- Story bible ------------------------------------------------------------------

  app.get("/kdp/books/:bookId/bible", (request) => {
    const { bookId } = bookParams.parse(request.params);
    kdp.books.require(owner(request), bookId);
    return {
      record: kdp.story.getBible(bookId),
      versions: kdp.story.listBibleVersions(bookId),
      canonChanges: kdp.story.listCanonChanges(bookId),
    };
  });

  app.put(
    "/kdp/books/:bookId/bible",
    { bodyLimit: 4 * 1024 * 1024 },
    (request) => {
      const { bookId } = bookParams.parse(request.params);
      kdp.books.require(owner(request), bookId);
      const input = saveStoryBibleSchema.parse(request.body);
      return kdp.story.saveBible(bookId, input.bible, "user", {
        baseVersion: input.baseVersion,
        note: "Edited by the author",
      });
    },
  );

  // --- Chapters ----------------------------------------------------------------------

  app.get("/kdp/books/:bookId/chapters", (request) => {
    const { bookId } = bookParams.parse(request.params);
    kdp.books.require(owner(request), bookId);
    return { items: kdp.story.listChapterItems(bookId) };
  });

  app.post("/kdp/books/:bookId/chapters", (request, reply) => {
    const { bookId } = bookParams.parse(request.params);
    kdp.books.require(owner(request), bookId);
    const input = createChapterSchema.parse(request.body);
    return reply
      .status(201)
      .send(kdp.story.addChapter(bookId, input.card, input.afterChapterId));
  });

  app.put("/kdp/books/:bookId/chapters/order", (request) => {
    const { bookId } = bookParams.parse(request.params);
    kdp.books.require(owner(request), bookId);
    const { chapterIds } = reorderChaptersSchema.parse(request.body);
    kdp.story.reorder(bookId, chapterIds);
    return { items: kdp.story.listChapterItems(bookId) };
  });

  app.get("/kdp/books/:bookId/chapters/:chapterId", (request) => {
    const { bookId, chapterId } = chapterParams.parse(request.params);
    kdp.books.require(owner(request), bookId);
    return kdp.story.getChapter(bookId, chapterId);
  });

  app.patch("/kdp/books/:bookId/chapters/:chapterId", (request) => {
    const { bookId, chapterId } = chapterParams.parse(request.params);
    kdp.books.require(owner(request), bookId);
    const chapter = kdp.story.updateChapter(
      bookId,
      chapterId,
      updateChapterSchema.parse(request.body),
    );
    kdp.service.syncReadyStatus(owner(request), bookId);
    return chapter;
  });

  app.delete("/kdp/books/:bookId/chapters/:chapterId", (request, reply) => {
    const { bookId, chapterId } = chapterParams.parse(request.params);
    kdp.books.require(owner(request), bookId);
    kdp.story.deleteChapter(bookId, chapterId);
    return reply.status(204).send();
  });

  app.put(
    "/kdp/books/:bookId/chapters/:chapterId/content",
    { bodyLimit: 4 * 1024 * 1024 },
    (request) => {
      const { bookId, chapterId } = chapterParams.parse(request.params);
      kdp.books.require(owner(request), bookId);
      const input = saveChapterContentSchema
        .extend({
          aiOperation: z
            .enum([
              "rewrite",
              "expand",
              "improve-dialogue",
              "adjust-pacing",
              "fix-grammar",
            ])
            .optional(),
        })
        .parse(request.body);
      const source = input.aiOperation
        ? input.aiOperation === "fix-grammar"
          ? "ai-edit"
          : "ai-rewrite"
        : "user-edit";
      const chapter = kdp.story.saveChapterText(bookId, chapterId, {
        content: input.content,
        source,
        recordRevision:
          input.mode === "manual" || input.aiOperation !== undefined,
        baseRevisionCount: input.baseRevisionCount,
        snapshotAfterMs: 10 * 60_000,
        note:
          input.note ??
          (input.aiOperation ? `Accepted AI ${input.aiOperation}` : null),
      });
      if (input.mode === "manual") {
        kdp.story.replaceOpenIssues(
          bookId,
          "style",
          chapterId,
          lintManuscript([
            { number: chapter.number, content: chapter.content },
          ]).map((finding) => ({
            ...finding,
            chapterId,
            originalText: null,
            replacementText: null,
          })),
        );
      }
      return chapter;
    },
  );

  app.get("/kdp/books/:bookId/chapters/:chapterId/revisions", (request) => {
    const { bookId, chapterId } = chapterParams.parse(request.params);
    kdp.books.require(owner(request), bookId);
    return { items: kdp.story.listRevisions(bookId, chapterId) };
  });

  app.post<{
    Params: { bookId: string; chapterId: string; revisionId: string };
  }>(
    "/kdp/books/:bookId/chapters/:chapterId/revisions/:revisionId/restore",
    (request) => {
      const { bookId, chapterId } = chapterParams.parse(request.params);
      kdp.books.require(owner(request), bookId);
      return kdp.story.restoreRevision(
        bookId,
        chapterId,
        z.uuid().parse(request.params.revisionId),
      );
    },
  );

  app.post(
    "/kdp/books/:bookId/chapters/:chapterId/passage",
    { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } },
    (request) => {
      const { bookId, chapterId } = chapterParams.parse(request.params);
      return kdp.service.passage(
        owner(request),
        bookId,
        chapterId,
        passageOperationSchema.parse(request.body),
      );
    },
  );

  app.get<{ Querystring: { format?: string } }>(
    "/kdp/books/:bookId/chapters/:chapterId/export",
    async (request, reply) => {
      const { bookId, chapterId } = chapterParams.parse(request.params);
      const book = kdp.books.require(owner(request), bookId);
      const chapter = kdp.story.getChapter(bookId, chapterId);
      const author = book.authorProfileId
        ? (kdp.books.getAuthor(owner(request), book.authorProfileId) ?? null)
        : null;
      const assembled = assembleManuscript(book, author, [chapter], null);
      const single = {
        ...assembled,
        sections: assembled.sections.filter(
          (section) => section.role === "body",
        ),
      };
      const base = `${fileSlug(book.title)}-chapter-${chapter.number}`;
      if (request.query.format === "docx") {
        return attachment(
          reply,
          `${base}.docx`,
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        ).send(Buffer.from(await buildDocx(single)));
      }
      return attachment(
        reply,
        `${base}.md`,
        "text/markdown; charset=utf-8",
      ).send(buildMarkdown(single));
    },
  );

  // --- Jobs and cost ---------------------------------------------------------------------

  app.post(
    "/kdp/books/:bookId/jobs",
    { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } },
    (request, reply) => {
      const { bookId } = bookParams.parse(request.params);
      const result = kdp.service.startJob(
        owner(request),
        bookId,
        startKdpJobSchema.parse(request.body),
      );
      return reply.status(result.created ? 202 : 200).send(result);
    },
  );

  app.post("/kdp/books/:bookId/jobs/estimate", (request) => {
    const { bookId } = bookParams.parse(request.params);
    const input = startKdpJobSchema
      .omit({ idempotencyKey: true })
      .parse(request.body);
    const book = kdp.books.require(owner(request), bookId);
    const settings = kdp.service.settings(owner(request));
    return {
      estimatedCostMicros: kdp.service.estimateJob(
        owner(request),
        bookId,
        input,
      ),
      spentMicros: kdp.jobs.spentMicros(bookId),
      budgetMicros: kdp.ai.budgetMicros(settings, book),
    };
  });

  app.get("/kdp/books/:bookId/jobs", (request) => {
    const { bookId } = bookParams.parse(request.params);
    kdp.books.require(owner(request), bookId);
    return {
      items: kdp.jobs.listJobs(bookId),
      worker: { running: kdp.runner.isRunning },
    };
  });

  app.get("/kdp/books/:bookId/jobs/:jobId", (request) => {
    const { bookId, jobId } = jobParams.parse(request.params);
    return kdp.service.job(owner(request), bookId, jobId);
  });

  app.post("/kdp/books/:bookId/jobs/:jobId/cancel", (request) => {
    const { bookId, jobId } = jobParams.parse(request.params);
    return kdp.service.cancelJob(owner(request), bookId, jobId);
  });

  app.post("/kdp/books/:bookId/jobs/:jobId/resume", (request) => {
    const { bookId, jobId } = jobParams.parse(request.params);
    return kdp.service.resumeJob(owner(request), bookId, jobId);
  });

  app.get("/kdp/books/:bookId/costs", (request) => {
    const { bookId } = bookParams.parse(request.params);
    const book = kdp.books.require(owner(request), bookId);
    const settings = kdp.service.settings(owner(request));
    return {
      summary: kdp.jobs.costSummary(
        bookId,
        kdp.ai.budgetMicros(settings, book),
      ),
      runs: kdp.jobs.listRuns(bookId, 100),
    };
  });

  // --- Editorial -------------------------------------------------------------------------

  app.get("/kdp/books/:bookId/editorial", (request) => {
    const { bookId } = bookParams.parse(request.params);
    kdp.books.require(owner(request), bookId);
    return {
      reviews: kdp.story.listReviews(bookId),
      issues: kdp.story.listIssues(bookId),
      canonChanges: kdp.story.listCanonChanges(bookId),
    };
  });

  app.post("/kdp/books/:bookId/editorial/style", (request) => {
    const { bookId } = bookParams.parse(request.params);
    kdp.books.require(owner(request), bookId);
    const chapters = kdp.story.listChapters(bookId);
    const byNumber = new Map(
      chapters.map((chapter) => [chapter.number, chapter.id]),
    );
    kdp.story.replaceOpenIssues(
      bookId,
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
    return { issues: kdp.story.listIssues(bookId) };
  });

  app.patch("/kdp/books/:bookId/editorial/issues/:issueId", (request) => {
    const { bookId, issueId } = issueParams.parse(request.params);
    const input = updateEditorialIssueSchema.parse(request.body);
    return kdp.service.updateIssue(
      owner(request),
      bookId,
      issueId,
      input.status,
      input.apply,
    );
  });

  // --- Covers -------------------------------------------------------------------------------

  app.get("/kdp/books/:bookId/covers", (request) => {
    const { bookId } = bookParams.parse(request.params);
    kdp.books.require(owner(request), bookId);
    return {
      items: kdp.jobs.listCovers(bookId),
      concepts: kdp.books.latestArtifact<CoverConcept[]>(
        bookId,
        "cover-concepts",
      ),
      rules: kdpRules.cover,
    };
  });

  app.post(
    "/kdp/books/:bookId/covers",
    { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const { bookId } = bookParams.parse(request.params);
      const query = coverQuerySchema.parse(request.query);
      const settings = query.settings
        ? z.record(z.string(), z.unknown()).parse(JSON.parse(query.settings))
        : {};
      const upload = await request.file({
        limits: {
          files: 1,
          fileSize: kdpRules.cover.maxFileSizeMB * 1024 * 1024,
          parts: 1,
        },
      });
      if (!upload)
        throw new z.ZodError([
          {
            code: "custom",
            path: ["file"],
            message: "An image file is required.",
            input: undefined,
          },
        ]);
      const buffer = await upload.toBuffer();
      const cover = await kdp.service.addCover(
        owner(request),
        bookId,
        { ...query, settings },
        { filename: upload.filename, buffer },
      );
      return reply.status(201).send(cover);
    },
  );

  app.get("/kdp/books/:bookId/covers/:coverId/file", async (request, reply) => {
    const { bookId, coverId } = coverParams.parse(request.params);
    const file = kdp.service.coverFile(owner(request), bookId, coverId);
    await stat(file.absolutePath);
    return reply
      .type(file.mimeType)
      .header("Content-Length", file.byteSize)
      .header("Cache-Control", "private, max-age=3600, immutable")
      .header("Cross-Origin-Resource-Policy", "cross-origin")
      .send(createReadStream(file.absolutePath));
  });

  app.post("/kdp/books/:bookId/covers/:coverId/current", (request) => {
    const { bookId, coverId } = coverParams.parse(request.params);
    return kdp.service.setCurrentCover(owner(request), bookId, coverId);
  });

  app.patch("/kdp/books/:bookId/covers/:coverId", (request) => {
    const { bookId, coverId } = coverParams.parse(request.params);
    kdp.books.require(owner(request), bookId);
    const input = z
      .object({
        provenance: coverUploadFieldsSchema.shape.provenance,
        provenanceNote: z.string().trim().max(500).nullable(),
      })
      .parse(request.body);
    const cover = kdp.jobs.setCoverProvenance(
      bookId,
      coverId,
      input.provenance,
      input.provenanceNote,
    );
    kdp.provenance.refresh(owner(request), bookId);
    return cover;
  });

  // --- Metadata, provenance, publication ----------------------------------------------------

  app.get("/kdp/books/:bookId/metadata", (request) => {
    const { bookId } = bookParams.parse(request.params);
    const book = kdp.books.require(owner(request), bookId);
    const record = kdp.books.getMetadata(bookId, book.listingApprovedAt);
    const author = book.authorProfileId
      ? (kdp.books.getAuthor(owner(request), book.authorProfileId) ?? null)
      : null;
    const cover = book.currentCoverId
      ? kdp.jobs.getCover(bookId, book.currentCoverId)
      : null;
    const coverText = (cover?.settings ?? {}) as {
      title?: string;
      author?: string;
    };
    const sources = [
      {
        name: "book",
        values: {
          title: book.title,
          subtitle: book.subtitle,
          author: author?.penName ?? "",
          seriesName: book.seriesName,
          seriesNumber: book.seriesNumber,
        },
      },
      ...(record
        ? [
            {
              name: "listing",
              values: {
                title: record.metadata.title,
                subtitle: record.metadata.subtitle,
                author: record.metadata.penName,
                seriesName: record.metadata.seriesName,
                seriesNumber: record.metadata.seriesNumber,
              },
            },
          ]
        : []),
      ...(cover?.source === "composite" && coverText.title
        ? [
            {
              name: "cover",
              values: {
                title: coverText.title,
                author: coverText.author ?? "",
              },
            },
          ]
        : []),
    ];
    const words = kdp.story
      .listChapterItems(bookId)
      .reduce((sum, chapter) => sum + chapter.wordCount, 0);
    return {
      record,
      suggestion: kdp.books.latestArtifact<MetadataGeneration>(
        bookId,
        "metadata-suggestion",
      ),
      findings: record ? checkMetadata(record.metadata) : [],
      consistency: checkIdentityConsistency(sources),
      royalty: record
        ? estimateRoyalty(
            record.metadata.pricing.currency,
            record.metadata.pricing.listPrice,
            Math.max(0.1, (words * 6) / 1_000_000),
            record.metadata.pricing.royaltyPlan,
          )
        : null,
      rules: {
        version: kdpRules.version,
        verifiedAt: kdpRules.verifiedAt,
        metadata: kdpRules.metadata,
        pricing: kdpRules.pricing,
        kdpSelect: kdpRules.kdpSelect,
      },
    };
  });

  app.put("/kdp/books/:bookId/metadata", (request) => {
    const { bookId } = bookParams.parse(request.params);
    const book = kdp.books.require(owner(request), bookId);
    kdp.books.saveMetadata(
      bookId,
      bookMetadataSchema.parse(request.body),
      false,
    );
    kdp.service.syncReadyStatus(owner(request), bookId);
    return kdp.books.getMetadata(bookId, null) ?? { bookId: book.id };
  });

  app.get("/kdp/books/:bookId/provenance", (request) => {
    const { bookId } = bookParams.parse(request.params);
    const records = kdp.provenance.refresh(owner(request), bookId);
    return {
      records,
      checklist: disclosureChecklist(records),
      rulesVersion: kdpRules.version,
    };
  });

  app.put<{ Params: { bookId: string; asset: string } }>(
    "/kdp/books/:bookId/provenance/:asset",
    (request) => {
      const { bookId } = bookParams.parse(request.params);
      const asset = z.enum(provenanceAssets).parse(request.params.asset);
      const input = updateProvenanceSchema.parse(request.body);
      const records = kdp.provenance.override(
        owner(request),
        bookId,
        asset,
        input.classification,
        input.notes ?? null,
      );
      return {
        records,
        checklist: disclosureChecklist(records),
        rulesVersion: kdpRules.version,
      };
    },
  );

  app.get("/kdp/books/:bookId/publication", (request) => {
    const { bookId } = bookParams.parse(request.params);
    kdp.books.require(owner(request), bookId);
    return kdp.books.getPublication(bookId);
  });

  app.put("/kdp/books/:bookId/publication", (request) => {
    const { bookId } = bookParams.parse(request.params);
    kdp.books.require(owner(request), bookId);
    return kdp.books.savePublication(
      bookId,
      updatePublicationRecordSchema.parse(request.body),
    );
  });

  // --- Exports ------------------------------------------------------------------------------------

  app.post(
    "/kdp/books/:bookId/exports",
    { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const { bookId } = bookParams.parse(request.params);
      const result = await kdp.exports.export(owner(request), bookId);
      kdp.service.syncReadyStatus(owner(request), bookId);
      return reply
        .status(result.status === "succeeded" ? 201 : 422)
        .send(result);
    },
  );

  app.get("/kdp/books/:bookId/exports", (request) => {
    const { bookId } = bookParams.parse(request.params);
    kdp.books.require(owner(request), bookId);
    return { items: kdp.jobs.listExports(bookId) };
  });

  app.get(
    "/kdp/books/:bookId/exports/:exportId/files/:filename",
    async (request, reply) => {
      const { bookId, exportId, filename } = exportFileParams.parse(
        request.params,
      );
      kdp.books.require(owner(request), bookId);
      const record = kdp.jobs.getExport(bookId, exportId);
      const file = record.files.find((item) => item.filename === filename);
      if (!file)
        throw new z.ZodError([
          {
            code: "custom",
            path: ["filename"],
            message: "No such file in this export.",
            input: filename,
          },
        ]);
      const absolutePath = kdp.files.absolutePath(
        bookId,
        `${kdp.jobs.exportDirectory(bookId, exportId)}/${filename}`,
      );
      await stat(absolutePath);
      return attachment(reply, filename, file.mimeType)
        .header("Content-Length", file.byteSize)
        .send(createReadStream(absolutePath));
    },
  );

  // Manuscript preview as structured blocks, for the publish page.
  app.get("/kdp/books/:bookId/manuscript", (request) => {
    const { bookId } = bookParams.parse(request.params);
    const book = kdp.books.require(owner(request), bookId);
    const author = book.authorProfileId
      ? (kdp.books.getAuthor(owner(request), book.authorProfileId) ?? null)
      : null;
    const manuscript = assembleManuscript(
      book,
      author,
      kdp.story.listChapters(bookId),
      kdp.books.getMetadata(bookId, null)?.metadata ?? null,
    );
    return {
      meta: manuscript.meta,
      sections: manuscript.sections.map((section) => ({
        id: section.id,
        kind: section.kind,
        role: section.role,
        title: section.title,
        includeInToc: section.includeInToc,
        paragraphs: section.blocks.length,
      })),
    };
  });
}
