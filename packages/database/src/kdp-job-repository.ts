import { randomUUID } from "node:crypto";

import {
  bookExportSchema,
  coverAssetSchema,
  kdpAiRunSchema,
  kdpJobSchema,
  type BookExport,
  type CoverAsset,
  type ExportFile,
  type ExportValidation,
  type ImageValidation,
  type KdpAiRun,
  type KdpCostSummary,
  type KdpJob,
  type KdpJobKind,
  type KdpTask,
  type ProvenanceClass,
} from "@ai-film-studio/contracts";

import type { DatabaseManager } from "./database-manager.js";
import { KdpNotFoundError } from "./kdp-book-repository.js";

type JobRow = {
  id: string;
  book_id: string;
  owner_id: string;
  kind: string;
  lane: string;
  status: string;
  idempotency_key: string;
  input_json: string;
  result_json: string | null;
  progress: number;
  progress_label: string | null;
  steps_done: number;
  steps_total: number;
  estimated_cost_micros: number;
  actual_cost_micros: number;
  error_message: string | null;
  cancel_requested: 0 | 1;
  attempts: number;
  lease_until: string | null;
  created_at: string;
  started_at: string | null;
  updated_at: string;
  completed_at: string | null;
};

type CoverRow = {
  id: string;
  book_id: string;
  version: number;
  kind: string;
  source: string;
  original_filename: string;
  relative_path: string;
  mime_type: string;
  width: number | null;
  height: number | null;
  color_model: string;
  byte_size: number;
  sha256: string;
  provenance: string;
  provenance_note: string | null;
  parent_id: string | null;
  settings_json: string;
  validation_json: string;
  created_at: string;
  is_current: number;
};

const now = () => new Date().toISOString();

export const jobLanes: Record<KdpJobKind, "write" | "utility"> = {
  concepts: "write",
  bible: "write",
  architecture: "write",
  outline: "write",
  draft: "write",
  editorial: "utility",
  metadata: "utility",
  "cover-prompts": "utility",
};

function mapJob(row: JobRow): KdpJob {
  return kdpJobSchema.parse({
    id: row.id,
    bookId: row.book_id,
    kind: row.kind,
    lane: row.lane,
    status: row.status,
    progress: row.progress,
    progressLabel: row.progress_label,
    stepsDone: row.steps_done,
    stepsTotal: row.steps_total,
    estimatedCostMicros: row.estimated_cost_micros,
    actualCostMicros: row.actual_cost_micros,
    errorMessage: row.error_message,
    cancelRequested: row.cancel_requested === 1,
    input: JSON.parse(row.input_json) as unknown,
    result: row.result_json ? (JSON.parse(row.result_json) as unknown) : null,
    attempts: row.attempts,
    createdAt: row.created_at,
    startedAt: row.started_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
  });
}

function mapCover(row: CoverRow): CoverAsset {
  return coverAssetSchema.parse({
    id: row.id,
    bookId: row.book_id,
    version: row.version,
    kind: row.kind,
    source: row.source,
    originalFilename: row.original_filename,
    mimeType: row.mime_type,
    width: row.width,
    height: row.height,
    colorModel: row.color_model,
    byteSize: row.byte_size,
    sha256: row.sha256,
    provenance: row.provenance,
    provenanceNote: row.provenance_note,
    parentId: row.parent_id,
    settings: JSON.parse(row.settings_json) as unknown,
    validation: JSON.parse(row.validation_json) as unknown,
    isCurrent: row.is_current === 1,
    createdAt: row.created_at,
  });
}

export type EnqueueResult = { job: KdpJob; created: boolean };

export class KdpJobRepository {
  constructor(private readonly manager: DatabaseManager) {}

  private get db() {
    return this.manager.connection;
  }

  // --- Jobs ------------------------------------------------------------------

  /**
   * Idempotent: the same key returns the same job, and a second active job in
   * the same lane returns the one already running instead of starting another.
   */
  enqueue(input: {
    ownerId: string;
    bookId: string;
    kind: KdpJobKind;
    idempotencyKey: string;
    input: Record<string, unknown>;
  }): EnqueueResult {
    return this.db.transaction((): EnqueueResult => {
      const byKey = this.db
        .prepare(
          "SELECT * FROM kdp_jobs WHERE owner_id = ? AND idempotency_key = ?",
        )
        .get(input.ownerId, input.idempotencyKey) as JobRow | undefined;
      if (byKey) return { job: mapJob(byKey), created: false };
      const lane = jobLanes[input.kind];
      const active = this.db
        .prepare(
          "SELECT * FROM kdp_jobs WHERE book_id = ? AND lane = ? AND status IN ('queued', 'running')",
        )
        .get(input.bookId, lane) as JobRow | undefined;
      if (active) return { job: mapJob(active), created: false };
      const id = randomUUID();
      const timestamp = now();
      this.db
        .prepare(
          `INSERT INTO kdp_jobs (id, book_id, owner_id, kind, lane, status, idempotency_key, input_json, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, 'queued', ?, ?, ?, ?)`,
        )
        .run(
          id,
          input.bookId,
          input.ownerId,
          input.kind,
          lane,
          input.idempotencyKey,
          JSON.stringify(input.input),
          timestamp,
          timestamp,
        );
      return { job: this.requireJob(id), created: true };
    })();
  }

  getJob(jobId: string): KdpJob | undefined {
    const row = this.db
      .prepare("SELECT * FROM kdp_jobs WHERE id = ?")
      .get(jobId) as JobRow | undefined;
    return row ? mapJob(row) : undefined;
  }

  requireJob(jobId: string): KdpJob {
    const job = this.getJob(jobId);
    if (!job) throw new KdpNotFoundError("Job");
    return job;
  }

  jobOwner(jobId: string): string | undefined {
    const row = this.db
      .prepare("SELECT owner_id FROM kdp_jobs WHERE id = ?")
      .get(jobId) as { owner_id: string } | undefined;
    return row?.owner_id;
  }

  listJobs(bookId: string, limit = 30): KdpJob[] {
    const rows = this.db
      .prepare(
        "SELECT * FROM kdp_jobs WHERE book_id = ? ORDER BY created_at DESC LIMIT ?",
      )
      .all(bookId, limit) as JobRow[];
    return rows.map(mapJob);
  }

  activeJobs(bookId: string): KdpJob[] {
    const rows = this.db
      .prepare(
        "SELECT * FROM kdp_jobs WHERE book_id = ? AND status IN ('queued', 'running') ORDER BY created_at",
      )
      .all(bookId) as JobRow[];
    return rows.map(mapJob);
  }

  /** Claims the oldest runnable job whose lease is free. */
  claimNext(leaseMs: number, excludeIds: Set<string>): KdpJob | undefined {
    return this.db.transaction(() => {
      const timestamp = now();
      const rows = this.db
        .prepare(
          `SELECT * FROM kdp_jobs
           WHERE status = 'queued' OR (status = 'running' AND (lease_until IS NULL OR lease_until < ?))
           ORDER BY created_at LIMIT 20`,
        )
        .all(timestamp) as JobRow[];
      const row = rows.find((candidate) => !excludeIds.has(candidate.id));
      if (!row) return undefined;
      this.db
        .prepare(
          `UPDATE kdp_jobs SET status = 'running', attempts = attempts + 1,
             lease_until = ?, started_at = COALESCE(started_at, ?), updated_at = ?
           WHERE id = ?`,
        )
        .run(
          new Date(Date.now() + leaseMs).toISOString(),
          timestamp,
          timestamp,
          row.id,
        );
      return this.requireJob(row.id);
    })();
  }

  /** Frees the leases of jobs left running by a previous process. */
  releaseLeases(): void {
    this.db
      .prepare(
        "UPDATE kdp_jobs SET lease_until = NULL WHERE status = 'running'",
      )
      .run();
  }

  heartbeat(jobId: string, leaseMs: number): void {
    this.db
      .prepare(
        "UPDATE kdp_jobs SET lease_until = ? WHERE id = ? AND status = 'running'",
      )
      .run(new Date(Date.now() + leaseMs).toISOString(), jobId);
  }

  progress(
    jobId: string,
    update: {
      progress?: number;
      label?: string | null;
      stepsDone?: number;
      stepsTotal?: number;
      estimatedCostMicros?: number;
    },
  ): void {
    const job = this.requireJob(jobId);
    this.db
      .prepare(
        `UPDATE kdp_jobs SET progress = ?, progress_label = ?, steps_done = ?, steps_total = ?,
           estimated_cost_micros = ?, updated_at = ? WHERE id = ?`,
      )
      .run(
        Math.max(0, Math.min(1, update.progress ?? job.progress)),
        update.label !== undefined ? update.label : job.progressLabel,
        update.stepsDone ?? job.stepsDone,
        update.stepsTotal ?? job.stepsTotal,
        update.estimatedCostMicros ?? job.estimatedCostMicros,
        now(),
        jobId,
      );
  }

  addCost(jobId: string, costMicros: number): void {
    this.db
      .prepare(
        "UPDATE kdp_jobs SET actual_cost_micros = actual_cost_micros + ? WHERE id = ?",
      )
      .run(costMicros, jobId);
  }

  finish(
    jobId: string,
    status: "succeeded" | "failed" | "cancelled" | "budget_stopped",
    detail: {
      errorMessage?: string | null;
      result?: Record<string, unknown> | null;
    } = {},
  ): void {
    const timestamp = now();
    this.db
      .prepare(
        `UPDATE kdp_jobs SET status = ?, error_message = ?, result_json = COALESCE(?, result_json),
           lease_until = NULL, updated_at = ?, completed_at = ?,
           progress = CASE WHEN ? = 'succeeded' THEN 1 ELSE progress END
         WHERE id = ?`,
      )
      .run(
        status,
        detail.errorMessage ?? null,
        detail.result ? JSON.stringify(detail.result) : null,
        timestamp,
        timestamp,
        status,
        jobId,
      );
  }

  requestCancel(jobId: string): KdpJob {
    const job = this.requireJob(jobId);
    if (job.status === "queued") {
      this.finish(jobId, "cancelled", {
        errorMessage: "Cancelled before it started.",
      });
    } else if (job.status === "running") {
      this.db
        .prepare(
          "UPDATE kdp_jobs SET cancel_requested = 1, updated_at = ? WHERE id = ?",
        )
        .run(now(), jobId);
    }
    return this.requireJob(jobId);
  }

  isCancelRequested(jobId: string): boolean {
    const row = this.db
      .prepare("SELECT cancel_requested FROM kdp_jobs WHERE id = ?")
      .get(jobId) as { cancel_requested: number } | undefined;
    return row?.cancel_requested === 1;
  }

  /**
   * Resumes a stopped job in place: completed steps stay checkpointed, so the
   * job continues where it stopped.
   */
  resume(jobId: string): KdpJob {
    return this.db.transaction(() => {
      const job = this.requireJob(jobId);
      if (!["failed", "cancelled", "budget_stopped"].includes(job.status))
        return job;
      const active = this.db
        .prepare(
          "SELECT id FROM kdp_jobs WHERE book_id = ? AND lane = ? AND status IN ('queued', 'running') AND id != ?",
        )
        .get(job.bookId, job.lane, jobId) as { id: string } | undefined;
      if (active) return this.requireJob(active.id);
      this.db
        .prepare(
          `UPDATE kdp_jobs SET status = 'queued', cancel_requested = 0, error_message = NULL,
             completed_at = NULL, updated_at = ? WHERE id = ?`,
        )
        .run(now(), jobId);
      return this.requireJob(jobId);
    })();
  }

  // --- Steps (checkpoints) -------------------------------------------------

  getStep<T>(
    jobId: string,
    stepKey: string,
  ): { status: string; output: T | null } | undefined {
    const row = this.db
      .prepare(
        "SELECT status, output_json FROM kdp_job_steps WHERE job_id = ? AND step_key = ?",
      )
      .get(jobId, stepKey) as
      { status: string; output_json: string | null } | undefined;
    if (!row) return undefined;
    return {
      status: row.status,
      output: row.output_json ? (JSON.parse(row.output_json) as T) : null,
    };
  }

  completedStepCount(jobId: string): number {
    const row = this.db
      .prepare(
        "SELECT COUNT(*) AS count FROM kdp_job_steps WHERE job_id = ? AND status IN ('succeeded', 'skipped')",
      )
      .get(jobId) as { count: number };
    return row.count;
  }

  /**
   * Records a finished step. Called inside the same transaction as the step's
   * own writes, so a crash never leaves a write without its checkpoint.
   */
  recordStep(
    jobId: string,
    stepKey: string,
    status: "succeeded" | "skipped" | "failed",
    output: unknown,
    attempts: number,
    errorMessage: string | null = null,
  ): void {
    this.db
      .prepare(
        `INSERT INTO kdp_job_steps (job_id, step_key, status, attempts, output_json, error_message, completed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(job_id, step_key) DO UPDATE SET status = excluded.status,
           attempts = excluded.attempts, output_json = excluded.output_json,
           error_message = excluded.error_message, completed_at = excluded.completed_at`,
      )
      .run(
        jobId,
        stepKey,
        status,
        attempts,
        output === undefined ? null : JSON.stringify(output),
        errorMessage,
        now(),
      );
  }

  transaction<T>(work: () => T): T {
    return this.db.transaction(work)();
  }

  // --- AI runs and cost --------------------------------------------------------

  recordRun(input: Omit<KdpAiRun, "id" | "createdAt">): KdpAiRun {
    const id = randomUUID();
    const createdAt = now();
    this.db
      .prepare(
        `INSERT INTO kdp_ai_runs (
          id, book_id, job_id, step_key, task, provider, model, input_tokens, output_tokens,
          cache_read_tokens, cache_write_tokens, cost_micros, estimated, duration_ms, status,
          error_message, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.bookId,
        input.jobId,
        input.stepKey,
        input.task,
        input.provider,
        input.model,
        input.inputTokens,
        input.outputTokens,
        input.cacheReadTokens,
        input.cacheWriteTokens,
        input.costMicros,
        input.estimated ? 1 : 0,
        input.durationMs,
        input.status,
        input.errorMessage,
        createdAt,
      );
    if (input.jobId && input.costMicros > 0)
      this.addCost(input.jobId, input.costMicros);
    return kdpAiRunSchema.parse({ ...input, id, createdAt });
  }

  listRuns(bookId: string, limit = 200): KdpAiRun[] {
    const rows = this.db
      .prepare(
        "SELECT * FROM kdp_ai_runs WHERE book_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?",
      )
      .all(bookId, limit) as Array<Record<string, string | number | null>>;
    return rows.map((row) =>
      kdpAiRunSchema.parse({
        id: row.id,
        bookId: row.book_id,
        jobId: row.job_id,
        stepKey: row.step_key,
        task: row.task,
        provider: row.provider,
        model: row.model,
        inputTokens: row.input_tokens,
        outputTokens: row.output_tokens,
        cacheReadTokens: row.cache_read_tokens,
        cacheWriteTokens: row.cache_write_tokens,
        costMicros: row.cost_micros,
        estimated: row.estimated === 1,
        durationMs: row.duration_ms,
        status: row.status,
        errorMessage: row.error_message,
        createdAt: row.created_at,
      }),
    );
  }

  spentMicros(bookId: string): number {
    const row = this.db
      .prepare(
        "SELECT COALESCE(SUM(cost_micros), 0) AS total FROM kdp_ai_runs WHERE book_id = ?",
      )
      .get(bookId) as { total: number };
    return row.total;
  }

  costSummary(bookId: string, budgetMicros: number): KdpCostSummary {
    const rows = this.db
      .prepare(
        `SELECT task, SUM(cost_micros) AS cost, COUNT(*) AS runs, SUM(input_tokens + cache_read_tokens + cache_write_tokens) AS input,
           SUM(output_tokens) AS output, MAX(estimated) AS estimated
         FROM kdp_ai_runs WHERE book_id = ? GROUP BY task ORDER BY cost DESC`,
      )
      .all(bookId) as Array<{
      task: KdpTask;
      cost: number;
      runs: number;
      input: number;
      output: number;
      estimated: number;
    }>;
    return {
      spentMicros: rows.reduce((sum, row) => sum + row.cost, 0),
      budgetMicros,
      runs: rows.reduce((sum, row) => sum + row.runs, 0),
      byTask: rows.map((row) => ({
        task: row.task,
        costMicros: row.cost,
        runs: row.runs,
        inputTokens: row.input,
        outputTokens: row.output,
      })),
      unverifiedPrices: rows.some((row) => row.estimated === 1),
    };
  }

  // --- Covers -------------------------------------------------------------------

  addCover(input: {
    bookId: string;
    kind: CoverAsset["kind"];
    source: CoverAsset["source"];
    originalFilename: string;
    relativePath: string;
    mimeType: string;
    width: number | null;
    height: number | null;
    colorModel: string;
    byteSize: number;
    sha256: string;
    provenance: ProvenanceClass;
    provenanceNote: string | null;
    parentId: string | null;
    settings: Record<string, unknown>;
    validation: ImageValidation;
    id?: string;
  }): CoverAsset {
    const id = input.id ?? randomUUID();
    this.db.transaction(() => {
      const row = this.db
        .prepare(
          "SELECT COALESCE(MAX(version), 0) AS version FROM kdp_cover_assets WHERE book_id = ?",
        )
        .get(input.bookId) as { version: number };
      this.db
        .prepare(
          `INSERT INTO kdp_cover_assets (
            id, book_id, version, kind, source, original_filename, relative_path, mime_type,
            width, height, color_model, byte_size, sha256, provenance, provenance_note, parent_id,
            settings_json, validation_json, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          input.bookId,
          row.version + 1,
          input.kind,
          input.source,
          input.originalFilename,
          input.relativePath,
          input.mimeType,
          input.width,
          input.height,
          input.colorModel,
          input.byteSize,
          input.sha256,
          input.provenance,
          input.provenanceNote,
          input.parentId,
          JSON.stringify(input.settings),
          JSON.stringify(input.validation),
          now(),
        );
    })();
    return this.getCover(input.bookId, id);
  }

  listCovers(bookId: string): CoverAsset[] {
    const rows = this.db
      .prepare(
        `SELECT ca.*, CASE WHEN b.current_cover_id = ca.id THEN 1 ELSE 0 END AS is_current
         FROM kdp_cover_assets ca JOIN kdp_books b ON b.id = ca.book_id
         WHERE ca.book_id = ? ORDER BY ca.version DESC`,
      )
      .all(bookId) as CoverRow[];
    return rows.map(mapCover);
  }

  getCover(bookId: string, coverId: string): CoverAsset {
    const cover = this.listCovers(bookId).find((item) => item.id === coverId);
    if (!cover) throw new KdpNotFoundError("Cover");
    return cover;
  }

  coverPath(bookId: string, coverId: string): string {
    const row = this.db
      .prepare(
        "SELECT relative_path FROM kdp_cover_assets WHERE id = ? AND book_id = ?",
      )
      .get(coverId, bookId) as { relative_path: string } | undefined;
    if (!row) throw new KdpNotFoundError("Cover");
    return row.relative_path;
  }

  setCoverProvenance(
    bookId: string,
    coverId: string,
    provenance: ProvenanceClass,
    note: string | null,
  ): CoverAsset {
    this.getCover(bookId, coverId);
    this.db
      .prepare(
        "UPDATE kdp_cover_assets SET provenance = ?, provenance_note = ? WHERE id = ?",
      )
      .run(provenance, note, coverId);
    return this.getCover(bookId, coverId);
  }

  // --- Exports -------------------------------------------------------------------

  addExport(input: {
    id: string;
    bookId: string;
    status: BookExport["status"];
    directory: string;
    files: ExportFile[];
    validation: ExportValidation | null;
    errorMessage: string | null;
    wordCount: number;
  }): BookExport {
    this.db
      .prepare(
        `INSERT INTO kdp_exports (id, book_id, status, directory, files_json, validation_json, error_message, word_count, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.id,
        input.bookId,
        input.status,
        input.directory,
        JSON.stringify(input.files),
        input.validation ? JSON.stringify(input.validation) : null,
        input.errorMessage,
        input.wordCount,
        now(),
      );
    return this.getExport(input.bookId, input.id);
  }

  listExports(bookId: string): BookExport[] {
    const rows = this.db
      .prepare(
        "SELECT * FROM kdp_exports WHERE book_id = ? ORDER BY created_at DESC",
      )
      .all(bookId) as Array<Record<string, string | number | null>>;
    return rows.map((row) =>
      bookExportSchema.parse({
        id: row.id,
        bookId: row.book_id,
        status: row.status,
        files: JSON.parse(String(row.files_json)) as unknown,
        validation: row.validation_json
          ? (JSON.parse(String(row.validation_json)) as unknown)
          : null,
        errorMessage: row.error_message,
        wordCount: row.word_count,
        createdAt: row.created_at,
      }),
    );
  }

  getExport(bookId: string, exportId: string): BookExport {
    const item = this.listExports(bookId).find(
      (entry) => entry.id === exportId,
    );
    if (!item) throw new KdpNotFoundError("Export");
    return item;
  }

  exportDirectory(bookId: string, exportId: string): string {
    const row = this.db
      .prepare("SELECT directory FROM kdp_exports WHERE id = ? AND book_id = ?")
      .get(exportId, bookId) as { directory: string } | undefined;
    if (!row) throw new KdpNotFoundError("Export");
    return row.directory;
  }
}
