import { z } from "zod";

const text = (max: number) => z.string().trim().max(max);
const required = (max: number) => z.string().trim().min(1).max(max);
const list = (max: number, itemMax = 600) =>
  z.array(z.string().trim().min(1).max(itemMax)).max(max);

// --- Stage A: concepts -----------------------------------------------------

export const storyConceptSchema = z.object({
  workingTitle: required(160),
  logline: required(600),
  genrePositioning: required(800),
  centralConflict: required(1200),
  protagonist: required(1200),
  emotionalStakes: required(1200),
  coreQuestion: required(600),
  hook: required(800),
  potentialEnding: required(1200),
  originalityRisks: list(6),
});

export const conceptsGenerationSchema = z.object({
  concepts: z.array(storyConceptSchema).min(1).max(5),
});

export const conceptRecordSchema = z.object({
  id: z.uuid(),
  bookId: z.uuid(),
  batch: z.number().int().min(1),
  position: z.number().int().min(0),
  concept: storyConceptSchema,
  selected: z.boolean(),
  createdAt: z.string(),
});

// --- Stage B/C: story bible and plot architecture ---------------------------

export const bibleRelationshipSchema = z.object({
  with: required(120),
  relation: required(400),
});

export const bibleCharacterGenerationSchema = z.object({
  name: required(120),
  role: required(80),
  age: text(40).nullable(),
  description: required(1500),
  physicalDetails: text(1000).nullable(),
  motivation: required(800),
  fear: required(600),
  goal: required(600),
  secret: text(800).nullable(),
  arc: required(1000),
  speechPattern: required(600),
  relationships: z.array(bibleRelationshipSchema).max(12),
});

export const bibleLocationGenerationSchema = z.object({
  name: required(160),
  description: required(1200),
  significance: text(800).nullable(),
});

export const timelineEventGenerationSchema = z.object({
  when: required(160),
  event: required(800),
  characters: list(10, 120),
  /** Part of the hidden truth the reader learns later. */
  hiddenFromReader: z.boolean(),
});

export const clueKinds = [
  "clue",
  "red-herring",
  "foreshadowing",
  "setup",
  "mystery",
] as const;
export const clueStatuses = [
  "planned",
  "planted",
  "paid-off",
  "dropped",
] as const;

export const clueGenerationSchema = z.object({
  kind: z.enum(clueKinds),
  description: required(800),
  payoff: required(800),
  plantChapter: z.number().int().min(1).max(150).nullable(),
  payoffChapter: z.number().int().min(1).max(150).nullable(),
});

export const storyObjectGenerationSchema = z.object({
  name: required(160),
  description: required(800),
  significance: required(800),
});

export const styleGuideSchema = z.object({
  narrativeVoice: required(1500),
  proseRules: list(20),
  dialogueRules: list(12),
  avoid: list(30, 200),
});

export const storyBibleGenerationSchema = z.object({
  premise: required(2000),
  theme: required(1000),
  settingRules: list(20),
  locations: z.array(bibleLocationGenerationSchema).max(25),
  characters: z.array(bibleCharacterGenerationSchema).min(1).max(30),
  chronology: z.array(timelineEventGenerationSchema).max(60),
  majorEvents: list(30),
  objects: z.array(storyObjectGenerationSchema).max(25),
  clues: z.array(clueGenerationSchema).max(60),
  viewpointRules: required(1500),
  styleGuide: styleGuideSchema,
  plotConstraints: list(25),
  endingResolution: required(2000),
  unresolvedQuestions: list(20),
});

export const suspectSchema = z.object({
  name: required(120),
  motive: required(600),
  opportunity: required(600),
  isCulprit: z.boolean(),
});

export const plotArchitectureGenerationSchema = z.object({
  structure: required(160),
  structureRationale: required(1200),
  acts: z
    .array(
      z.object({
        name: required(120),
        summary: required(2000),
        turningPoint: required(800),
      }),
    )
    .min(2)
    .max(7),
  beginning: required(2000),
  middle: required(2000),
  ending: required(2000),
  /** Mysteries and thrillers: what really happened, in true order. */
  truthTimeline: z.array(timelineEventGenerationSchema).max(40),
  suspects: z.array(suspectSchema).max(12),
  redHerrings: list(12),
  revealOrder: list(20),
  /** Horror: rules of the threat, or the uncertainty that replaces them. */
  threatRules: list(15),
  /** Romantic suspense: relationship progression beside the external plot. */
  relationshipArc: list(15),
  tensionNotes: list(12),
});

const withId = <T extends z.ZodRawShape>(schema: z.ZodObject<T>) =>
  schema.extend({ id: z.string().min(1).max(60) });

export const bibleCharacterSchema = withId(
  bibleCharacterGenerationSchema,
).extend({
  /** Current state, updated by continuity inspection. */
  state: text(1000).nullable(),
});
export const bibleLocationSchema = withId(bibleLocationGenerationSchema);
export const timelineEventSchema = withId(timelineEventGenerationSchema).extend(
  {
    chapterNumber: z.number().int().min(1).nullable(),
  },
);
export const clueSchema = withId(clueGenerationSchema).extend({
  status: z.enum(clueStatuses),
  notes: text(1000).nullable(),
});
export const storyObjectSchema = withId(storyObjectGenerationSchema);
export const canonFactSchema = z.object({
  id: z.string().min(1).max(60),
  fact: required(800),
  category: text(60),
  chapterNumber: z.number().int().min(1).nullable(),
});

export const storyBibleSchema = z.object({
  premise: text(2000),
  theme: text(1000),
  settingRules: list(40),
  locations: z.array(bibleLocationSchema).max(60),
  characters: z.array(bibleCharacterSchema).max(60),
  chronology: z.array(timelineEventSchema).max(200),
  majorEvents: list(60),
  objects: z.array(storyObjectSchema).max(60),
  clues: z.array(clueSchema).max(120),
  viewpointRules: text(1500),
  styleGuide: styleGuideSchema,
  plotConstraints: list(40),
  endingResolution: text(2000),
  unresolvedQuestions: list(40),
  architecture: plotArchitectureGenerationSchema.nullable(),
  canonFacts: z.array(canonFactSchema).max(800),
});

export const storyBibleRecordSchema = z.object({
  bookId: z.uuid(),
  version: z.number().int().min(1),
  bible: storyBibleSchema,
  updatedAt: z.string(),
  updatedBy: z.enum(["ai", "user", "inspection"]),
});

export const saveStoryBibleSchema = z.object({
  /** Optimistic concurrency: the version the edit was based on. */
  baseVersion: z.number().int().min(1),
  bible: storyBibleSchema,
});

export const canonChangeSchema = z.object({
  id: z.uuid(),
  bookId: z.uuid(),
  chapterId: z.uuid().nullable(),
  source: z.enum(["inspection", "user", "editorial"]),
  change: z.string(),
  reason: z.string().nullable(),
  status: z.enum(["recorded", "proposed", "accepted", "rejected"]),
  createdAt: z.string(),
});

// --- Stage D: chapter outline -----------------------------------------------

export const chapterSceneSchema = z.object({
  summary: required(1200),
  purpose: required(600),
});

export const chapterCardGenerationSchema = z.object({
  title: text(160).nullable(),
  povCharacter: required(120),
  location: required(300),
  time: required(200),
  objective: required(800),
  openingHook: required(800),
  scenes: z.array(chapterSceneSchema).min(1).max(8),
  conflict: required(1000),
  newInformation: list(10),
  clues: list(10),
  continuityReferences: list(12),
  emotionalMovement: required(800),
  endingBeat: required(800),
  dependsOn: z.array(z.number().int().min(1).max(150)).max(10),
});

export const outlineGenerationSchema = z.object({
  chapters: z.array(chapterCardGenerationSchema).min(1).max(150),
});

export const chapterCardSchema = chapterCardGenerationSchema.extend({
  targetWords: z.number().int().min(100).max(30_000),
});

// --- Chapters ----------------------------------------------------------------

export const chapterStatuses = [
  "planned",
  "drafting",
  "drafted",
  "revised",
  "approved",
] as const;
export const contentSources = ["none", "ai", "human", "mixed"] as const;
export const revisionSources = [
  "ai-draft",
  "ai-expansion",
  "ai-rewrite",
  "ai-edit",
  "user-edit",
  "editorial-accept",
  "restore",
  "import",
] as const;

export const chapterSchema = z.object({
  id: z.uuid(),
  bookId: z.uuid(),
  position: z.number().int().min(0),
  number: z.number().int().min(1),
  title: z.string().nullable(),
  card: chapterCardSchema,
  status: z.enum(chapterStatuses),
  locked: z.boolean(),
  approvedAt: z.string().nullable(),
  content: z.string(),
  wordCount: z.number().int().min(0),
  targetWords: z.number().int(),
  summary: z.string().nullable(),
  authorNotes: z.string().nullable(),
  contentSource: z.enum(contentSources),
  revisionCount: z.number().int().min(0),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const chapterSummaryListItemSchema = chapterSchema.omit({
  content: true,
});

export const chapterRevisionSchema = z.object({
  id: z.uuid(),
  chapterId: z.uuid(),
  bookId: z.uuid(),
  revisionNumber: z.number().int().min(1),
  content: z.string(),
  wordCount: z.number().int(),
  source: z.enum(revisionSources),
  note: z.string().nullable(),
  jobId: z.uuid().nullable(),
  createdAt: z.string(),
});

export const saveChapterContentSchema = z.object({
  content: z.string().max(400_000),
  /** Autosave updates the working copy; a manual save also records a revision. */
  mode: z.enum(["autosave", "manual"]),
  /** Revision count the editor started from, to reject stale saves. */
  baseRevisionCount: z.number().int().min(0),
  note: z.string().trim().max(300).nullable().optional(),
});

export const updateChapterSchema = z.object({
  title: z.string().trim().max(160).nullable().optional(),
  card: chapterCardSchema.optional(),
  locked: z.boolean().optional(),
  approved: z.boolean().optional(),
  authorNotes: z.string().trim().max(20_000).nullable().optional(),
});

export const createChapterSchema = z.object({
  afterChapterId: z.uuid().nullable(),
  card: chapterCardSchema,
});

export const reorderChaptersSchema = z.object({
  chapterIds: z.array(z.uuid()).min(1).max(150),
});

export const passageOperations = [
  "rewrite",
  "expand",
  "improve-dialogue",
  "adjust-pacing",
  "fix-grammar",
] as const;

export const passageOperationSchema = z.object({
  operation: z.enum(passageOperations),
  passage: z.string().min(1).max(30_000),
  instruction: z.string().trim().max(1000).nullable().optional(),
});

export const passageResultSchema = z.object({
  operation: z.enum(passageOperations),
  original: z.string(),
  replacement: z.string(),
  notes: z.string().nullable(),
  costMicros: z.number().int(),
});

// --- Stage F: continuity inspection -----------------------------------------

export const issueSeverities = [
  "critical",
  "major",
  "minor",
  "suggestion",
] as const;

export const chapterInspectionGenerationSchema = z.object({
  summary: required(3000),
  chronology: z
    .array(z.object({ when: required(160), event: required(600) }))
    .max(20),
  newFacts: z
    .array(z.object({ fact: required(600), category: required(60) }))
    .max(30),
  characterStates: z
    .array(z.object({ name: required(120), state: required(600) }))
    .max(20),
  clueUpdates: z
    .array(
      z.object({
        clue: required(400),
        status: z.enum(["planted", "advanced", "paid-off"]),
        note: required(400),
      }),
    )
    .max(20),
  contradictions: z
    .array(
      z.object({
        severity: z.enum(issueSeverities),
        issue: required(600),
        evidence: required(1000),
        suggestion: required(800),
      }),
    )
    .max(20),
  repetitions: z
    .array(z.object({ issue: required(400), evidence: required(800) }))
    .max(15),
  transitionNote: text(800).nullable(),
  canonChanges: z
    .array(z.object({ change: required(600), reason: required(600) }))
    .max(15),
});

// --- Editorial review ----------------------------------------------------------

export const editorialKinds = [
  "developmental",
  "continuity",
  "line",
  "copy",
  "originality",
  "style",
  "inspection",
] as const;
export const issueStatuses = [
  "open",
  "accepted",
  "rejected",
  "resolved",
] as const;

export const editorialFindingGenerationSchema = z.object({
  severity: z.enum(issueSeverities),
  issue: required(800),
  chapterNumber: z.number().int().min(1).max(150).nullable(),
  location: required(300),
  evidence: required(1500),
  suggestion: required(1500),
  /** Exact text from the chapter to replace, when the fix is a local edit. */
  originalText: text(4000).nullable(),
  replacementText: text(6000).nullable(),
});

export const editorialReportGenerationSchema = z.object({
  summary: required(3000),
  strengths: list(10),
  findings: z.array(editorialFindingGenerationSchema).max(60),
});

export const editorialIssueSchema = z.object({
  id: z.uuid(),
  bookId: z.uuid(),
  reviewId: z.uuid().nullable(),
  chapterId: z.uuid().nullable(),
  chapterNumber: z.number().int().nullable(),
  kind: z.enum(editorialKinds),
  severity: z.enum(issueSeverities),
  issue: z.string(),
  location: z.string(),
  evidence: z.string(),
  suggestion: z.string(),
  originalText: z.string().nullable(),
  replacementText: z.string().nullable(),
  status: z.enum(issueStatuses),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const editorialReviewSchema = z.object({
  id: z.uuid(),
  bookId: z.uuid(),
  kind: z.enum(editorialKinds),
  jobId: z.uuid().nullable(),
  summary: z.string(),
  strengths: z.array(z.string()),
  chapterIds: z.array(z.uuid()),
  createdAt: z.string(),
});

export const updateEditorialIssueSchema = z.object({
  status: z.enum(issueStatuses),
  /** Apply the replacement text to the chapter when accepting. */
  apply: z.boolean().default(false),
});

export type StoryConcept = z.infer<typeof storyConceptSchema>;
export type ConceptRecord = z.infer<typeof conceptRecordSchema>;
export type BibleCharacterGeneration = z.infer<
  typeof bibleCharacterGenerationSchema
>;
export type StoryBibleGeneration = z.infer<typeof storyBibleGenerationSchema>;
export type PlotArchitectureGeneration = z.infer<
  typeof plotArchitectureGenerationSchema
>;
export type BibleCharacter = z.infer<typeof bibleCharacterSchema>;
export type BibleLocation = z.infer<typeof bibleLocationSchema>;
export type TimelineEvent = z.infer<typeof timelineEventSchema>;
export type Clue = z.infer<typeof clueSchema>;
export type CanonFact = z.infer<typeof canonFactSchema>;
export type StoryBible = z.infer<typeof storyBibleSchema>;
export type StoryBibleRecord = z.infer<typeof storyBibleRecordSchema>;
export type SaveStoryBible = z.infer<typeof saveStoryBibleSchema>;
export type CanonChange = z.infer<typeof canonChangeSchema>;
export type ChapterCardGeneration = z.infer<typeof chapterCardGenerationSchema>;
export type ChapterCard = z.infer<typeof chapterCardSchema>;
export type ChapterStatus = (typeof chapterStatuses)[number];
export type ContentSource = (typeof contentSources)[number];
export type RevisionSource = (typeof revisionSources)[number];
export type Chapter = z.infer<typeof chapterSchema>;
export type ChapterListItem = z.infer<typeof chapterSummaryListItemSchema>;
export type ChapterRevision = z.infer<typeof chapterRevisionSchema>;
export type SaveChapterContent = z.infer<typeof saveChapterContentSchema>;
export type UpdateChapter = z.infer<typeof updateChapterSchema>;
export type CreateChapter = z.infer<typeof createChapterSchema>;
export type PassageOperation = (typeof passageOperations)[number];
export type PassageOperationInput = z.infer<typeof passageOperationSchema>;
export type PassageResult = z.infer<typeof passageResultSchema>;
export type ChapterInspection = z.infer<
  typeof chapterInspectionGenerationSchema
>;
export type IssueSeverity = (typeof issueSeverities)[number];
export type EditorialKind = (typeof editorialKinds)[number];
export type EditorialFinding = z.infer<typeof editorialFindingGenerationSchema>;
export type EditorialReportGeneration = z.infer<
  typeof editorialReportGenerationSchema
>;
export type EditorialIssue = z.infer<typeof editorialIssueSchema>;
export type EditorialReview = z.infer<typeof editorialReviewSchema>;
export type UpdateEditorialIssue = z.infer<typeof updateEditorialIssueSchema>;
