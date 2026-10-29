import { z } from "zod";

import { kdpTasks, kdpTextProviderIds } from "./kdp-common.js";
import { editorialKinds } from "./kdp-story.js";

const text = (max: number) => z.string().trim().max(max);
const required = (max: number) => z.string().trim().min(1).max(max);

// --- Jobs ----------------------------------------------------------------------

export const kdpJobKinds = [
  "concepts",
  "bible",
  "architecture",
  "outline",
  "draft",
  "editorial",
  "metadata",
  "cover-prompts",
] as const;
export const kdpJobStatuses = [
  "queued",
  "running",
  "succeeded",
  "failed",
  "cancelled",
  "budget_stopped",
] as const;
export const kdpActiveJobStatuses = ["queued", "running"] as const;

export const startKdpJobSchema = z.object({
  kind: z.enum(kdpJobKinds),
  /** Client-generated key; a repeated request returns the same job. */
  idempotencyKey: z.string().trim().min(8).max(100),
  /** Draft: only these chapters (default: every unlocked, undrafted chapter). */
  chapterIds: z.array(z.uuid()).max(150).optional(),
  /** Draft: redraft chapters that already have text (never locked ones). */
  regenerate: z.boolean().optional(),
  /** Draft: only re-run continuity inspection on chapters that have text. */
  inspectOnly: z.boolean().optional(),
  /** Editorial: which passes to run. */
  passes: z.array(z.enum(editorialKinds)).max(6).optional(),
  /** Concepts/outline/bible: extra guidance for this run. */
  guidance: z.string().trim().max(4000).optional(),
});

export const kdpJobSchema = z.object({
  id: z.uuid(),
  bookId: z.uuid(),
  kind: z.enum(kdpJobKinds),
  lane: z.enum(["write", "utility"]),
  status: z.enum(kdpJobStatuses),
  progress: z.number().min(0).max(1),
  progressLabel: z.string().nullable(),
  stepsDone: z.number().int(),
  stepsTotal: z.number().int(),
  estimatedCostMicros: z.number().int(),
  actualCostMicros: z.number().int(),
  errorMessage: z.string().nullable(),
  cancelRequested: z.boolean(),
  input: z.record(z.string(), z.unknown()),
  result: z.record(z.string(), z.unknown()).nullable(),
  attempts: z.number().int(),
  createdAt: z.string(),
  startedAt: z.string().nullable(),
  updatedAt: z.string(),
  completedAt: z.string().nullable(),
});

export const kdpAiRunSchema = z.object({
  id: z.uuid(),
  bookId: z.uuid(),
  jobId: z.uuid().nullable(),
  stepKey: z.string().nullable(),
  task: z.enum(kdpTasks),
  provider: z.enum(kdpTextProviderIds),
  model: z.string(),
  inputTokens: z.number().int(),
  outputTokens: z.number().int(),
  cacheReadTokens: z.number().int(),
  cacheWriteTokens: z.number().int(),
  costMicros: z.number().int(),
  estimated: z.boolean(),
  durationMs: z.number().int(),
  status: z.enum(["succeeded", "failed", "cancelled"]),
  errorMessage: z.string().nullable(),
  createdAt: z.string(),
});

export const kdpCostSummarySchema = z.object({
  spentMicros: z.number().int(),
  budgetMicros: z.number().int(),
  runs: z.number().int(),
  byTask: z.array(
    z.object({
      task: z.enum(kdpTasks),
      costMicros: z.number().int(),
      runs: z.number().int(),
      inputTokens: z.number().int(),
      outputTokens: z.number().int(),
    }),
  ),
  unverifiedPrices: z.boolean(),
});

// --- Cover ---------------------------------------------------------------------

export const coverConceptGenerationSchema = z.object({
  name: required(120),
  visualMotif: required(400),
  mainPrompt: required(4000),
  negativePrompt: text(1500).nullable(),
  composition: required(1500),
  palette: z.array(required(80)).min(2).max(8),
  typography: z.object({
    titleFont: required(200),
    authorFont: required(200),
    notes: required(800),
  }),
  textPlacement: required(800),
  genreReadability: required(800),
});

export const coverConceptsGenerationSchema = z.object({
  concepts: z.array(coverConceptGenerationSchema).min(3).max(5),
});

export const provenanceClasses = [
  "human",
  "ai-assisted",
  "ai-generated",
  "unknown",
  "not-applicable",
] as const;

export const imageValidationSchema = z.object({
  ok: z.boolean(),
  errors: z.array(z.string()),
  warnings: z.array(z.string()),
  rulesVersion: z.string(),
});

export const coverAssetSchema = z.object({
  id: z.uuid(),
  bookId: z.uuid(),
  version: z.number().int().min(1),
  kind: z.enum(["artwork", "final"]),
  source: z.enum(["upload", "paste", "drop", "composite"]),
  originalFilename: z.string(),
  mimeType: z.string(),
  width: z.number().int().nullable(),
  height: z.number().int().nullable(),
  colorModel: z.string(),
  byteSize: z.number().int(),
  sha256: z.string(),
  provenance: z.enum(provenanceClasses),
  provenanceNote: z.string().nullable(),
  /** The artwork version a composite was made from. */
  parentId: z.uuid().nullable(),
  settings: z.record(z.string(), z.unknown()),
  validation: imageValidationSchema,
  isCurrent: z.boolean(),
  createdAt: z.string(),
});

export const coverUploadFieldsSchema = z.object({
  kind: z.enum(["artwork", "final"]),
  source: z.enum(["upload", "paste", "drop", "composite"]),
  provenance: z.enum(provenanceClasses),
  provenanceNote: z.string().trim().max(500).nullable().optional(),
  parentId: z.uuid().nullable().optional(),
  settings: z.record(z.string(), z.unknown()).optional(),
});

// --- Metadata --------------------------------------------------------------------

export const kdpCategorySuggestionSchema = z.object({
  path: required(300),
  rationale: required(600),
});

export const metadataGenerationSchema = z.object({
  description: required(4000),
  keywords: z.array(required(80)).min(1).max(7),
  categories: z.array(kdpCategorySuggestionSchema).min(1).max(3),
  subtitle: text(200).nullable(),
  subtitleRationale: required(600),
  audience: required(600),
  sexuallyExplicit: z.boolean(),
  explicitContentAssessment: required(1000),
  minimumReaderAge: z.number().int().min(0).max(21).nullable(),
  contentWarnings: z.array(required(120)).max(10),
  pricingRationale: required(1000),
  suggestedPriceUsd: z.number().min(0.99).max(200),
});

export const marketplaces = [
  "amazon.com",
  "amazon.co.uk",
  "amazon.de",
  "amazon.fr",
  "amazon.es",
  "amazon.it",
  "amazon.nl",
  "amazon.ca",
  "amazon.com.au",
  "amazon.co.jp",
  "amazon.in",
  "amazon.com.br",
  "amazon.com.mx",
] as const;

export const bookMetadataSchema = z.object({
  title: text(200),
  subtitle: text(200).nullable(),
  seriesName: text(200).nullable(),
  seriesNumber: z.number().int().min(1).max(999).nullable(),
  edition: text(40).nullable(),
  penName: text(120),
  contributors: z
    .array(z.object({ role: required(60), name: required(120) }))
    .max(10),
  language: text(20),
  description: text(4000),
  keywords: z.array(text(80)).max(7),
  categories: z.array(kdpCategorySuggestionSchema).max(3),
  primaryMarketplace: z.enum(marketplaces),
  audience: text(600),
  sexuallyExplicit: z.boolean(),
  explicitContentAssessment: text(1000),
  minimumReaderAge: z.number().int().min(0).max(21).nullable(),
  contentWarnings: z.array(text(120)).max(10),
  publishingRights: z.enum(["own-copyright", "public-domain"]),
  pricing: z.object({
    currency: z.enum(["USD", "GBP", "EUR"]),
    listPrice: z.number().min(0.99).max(250),
    royaltyPlan: z.enum(["35", "70"]),
    rationale: text(1500),
  }),
  kdpSelect: z.object({
    enroll: z.boolean().nullable(),
    notes: text(1500),
  }),
  publication: z.object({
    plan: z.enum(["immediately", "preorder", "undecided"]),
    date: z.string().nullable(),
    notes: text(1000),
  }),
  publisher: text(120).nullable(),
  imprint: text(100).nullable(),
  isbnNote: text(1000),
  checklist: z.record(z.string(), z.boolean()),
});

export const bookMetadataRecordSchema = z.object({
  bookId: z.uuid(),
  metadata: bookMetadataSchema,
  generatedAt: z.string().nullable(),
  updatedAt: z.string(),
  approvedAt: z.string().nullable(),
});

// --- Provenance and publication ---------------------------------------------------

export const provenanceAssets = [
  "text",
  "cover",
  "interior-images",
  "translation",
] as const;

export const provenanceRecordSchema = z.object({
  asset: z.enum(provenanceAssets),
  classification: z.enum(provenanceClasses),
  detected: z.enum(provenanceClasses),
  detectedReason: z.string(),
  overridden: z.boolean(),
  notes: z.string().nullable(),
  updatedAt: z.string(),
});

export const updateProvenanceSchema = z.object({
  classification: z.enum(provenanceClasses),
  notes: z.string().trim().max(1000).nullable().optional(),
});

export const publicationStatuses = [
  "not-published",
  "submitted",
  "live",
  "unpublished",
] as const;

export const publicationRecordSchema = z.object({
  bookId: z.uuid(),
  status: z.enum(publicationStatuses),
  publishedAt: z.string().nullable(),
  asin: z
    .string()
    .trim()
    .regex(/^[A-Z0-9]{10}$/, "An ASIN has 10 letters or digits.")
    .nullable(),
  amazonUrl: z.url().max(500).nullable(),
  finalTitle: text(250).nullable(),
  notes: text(4000).nullable(),
  updatedAt: z.string(),
});

export const updatePublicationRecordSchema = publicationRecordSchema
  .omit({ bookId: true, updatedAt: true })
  .partial();

// --- Exports and readiness -----------------------------------------------------------

export const exportFileKinds = [
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
] as const;

export const exportFileSchema = z.object({
  kind: z.enum(exportFileKinds),
  filename: z.string(),
  mimeType: z.string(),
  byteSize: z.number().int(),
  sha256: z.string(),
});

export const validationIssueSchema = z.object({
  code: z.string(),
  message: z.string(),
  path: z.string().optional(),
});

export const exportValidationSchema = z.object({
  epubStructure: z.object({
    ok: z.boolean(),
    errors: z.array(validationIssueSchema),
    warnings: z.array(validationIssueSchema),
  }),
  epubcheck: z.object({
    available: z.boolean(),
    version: z.string().nullable(),
    passed: z.boolean(),
    fatal: z.number().int(),
    errors: z.number().int(),
    warnings: z.number().int(),
    messages: z.array(
      z.object({
        severity: z.string(),
        id: z.string(),
        message: z.string(),
        location: z.string().optional(),
      }),
    ),
  }),
  docx: z.object({ ok: z.boolean(), errors: z.array(z.string()) }),
});

export const bookExportSchema = z.object({
  id: z.uuid(),
  bookId: z.uuid(),
  status: z.enum(["succeeded", "failed"]),
  files: z.array(exportFileSchema),
  validation: exportValidationSchema.nullable(),
  errorMessage: z.string().nullable(),
  wordCount: z.number().int(),
  createdAt: z.string(),
});

export const readinessAreas = [
  "manuscript",
  "editorial",
  "cover",
  "metadata",
  "files",
  "disclosure",
  "rights",
] as const;

export const readinessCheckSchema = z.object({
  id: z.string(),
  area: z.enum(readinessAreas),
  label: z.string(),
  status: z.enum(["pass", "warn", "fail"]),
  detail: z.string(),
});

export const bookReadinessSchema = z.object({
  checks: z.array(readinessCheckSchema),
  technicalChecksPass: z.boolean(),
  manuscriptApproved: z.boolean(),
  listingApproved: z.boolean(),
  readyForKdp: z.boolean(),
  rulesVersion: z.string(),
  rulesVerifiedAt: z.string(),
});

export type KdpJobKind = (typeof kdpJobKinds)[number];
export type KdpJobStatus = (typeof kdpJobStatuses)[number];
export type StartKdpJob = z.infer<typeof startKdpJobSchema>;
export type KdpJob = z.infer<typeof kdpJobSchema>;
export type KdpAiRun = z.infer<typeof kdpAiRunSchema>;
export type KdpCostSummary = z.infer<typeof kdpCostSummarySchema>;
export type CoverConcept = z.infer<typeof coverConceptGenerationSchema>;
export type ProvenanceClass = (typeof provenanceClasses)[number];
export type ImageValidation = z.infer<typeof imageValidationSchema>;
export type CoverAsset = z.infer<typeof coverAssetSchema>;
export type CoverUploadFields = z.infer<typeof coverUploadFieldsSchema>;
export type KdpCategorySuggestion = z.infer<typeof kdpCategorySuggestionSchema>;
export type MetadataGeneration = z.infer<typeof metadataGenerationSchema>;
export type Marketplace = (typeof marketplaces)[number];
export type BookMetadata = z.infer<typeof bookMetadataSchema>;
export type BookMetadataRecord = z.infer<typeof bookMetadataRecordSchema>;
export type ProvenanceAsset = (typeof provenanceAssets)[number];
export type ProvenanceRecord = z.infer<typeof provenanceRecordSchema>;
export type UpdateProvenance = z.infer<typeof updateProvenanceSchema>;
export type PublicationStatus = (typeof publicationStatuses)[number];
export type PublicationRecord = z.infer<typeof publicationRecordSchema>;
export type UpdatePublicationRecord = z.infer<
  typeof updatePublicationRecordSchema
>;
export type ExportFileKind = (typeof exportFileKinds)[number];
export type ExportFile = z.infer<typeof exportFileSchema>;
export type ValidationIssue = z.infer<typeof validationIssueSchema>;
export type ExportValidation = z.infer<typeof exportValidationSchema>;
export type BookExport = z.infer<typeof bookExportSchema>;
export type ReadinessCheck = z.infer<typeof readinessCheckSchema>;
export type BookReadiness = z.infer<typeof bookReadinessSchema>;
