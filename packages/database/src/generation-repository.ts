import { randomUUID } from "node:crypto";

import {
  generatedAssetSchema,
  generationJobSchema,
  imageAttemptSchema,
  imageHistorySchema,
  type GeneratedAsset,
  type GenerationJob,
  type ImageAttempt,
  type ImageHistory,
  type ReferenceImage,
} from "@ai-studio/contracts";

import type { DatabaseManager } from "./database-manager.js";
import type { ProjectRepository } from "./project-repository.js";

type AttemptRow = {
  id: string;
  project_id: string;
  shot_id: string;
  shot_code: string;
  provider: "comfyui" | "manual" | "openai" | "gemini";
  model: string | null;
  prompt: string;
  negative_prompt: string;
  references_json: string;
  seed: number | null;
  settings_json: string;
  status: "queued" | "generating" | "succeeded" | "failed" | "cancelled";
  review_status: "pending" | "approved" | "rejected";
  is_selected: 0 | 1;
  error_message: string | null;
  cost_micros: number;
  currency: string;
  generation_time_ms: number | null;
  created_at: string;
  updated_at: string;
};

type AssetRow = {
  id: string;
  project_id: string;
  shot_id: string;
  attempt_id: string;
  kind: "storyboard-image";
  original_filename: string;
  relative_path: string;
  mime_type: string;
  byte_size: number;
  sha256: string;
  width: number | null;
  height: number | null;
  created_at: string;
};

type JobRow = {
  id: string;
  project_id: string;
  shot_id: string;
  attempt_id: string;
  kind: "image";
  provider: "comfyui";
  status:
    | "queued"
    | "preparing"
    | "generating"
    | "downloading"
    | "completed"
    | "failed"
    | "cancelled";
  progress: number;
  provider_job_id: string | null;
  error_message: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
};

export type NewGeneratedAsset = {
  originalFilename: string;
  relativePath: string;
  mimeType: "image/jpeg" | "image/png" | "image/webp";
  byteSize: number;
  sha256: string;
  width: number | null;
  height: number | null;
};

export type NewImageAttempt = {
  projectId: string;
  shotId: string;
  provider: "manual" | "openai" | "gemini";
  model: string | null;
  prompt: string;
  negativePrompt: string;
  references: ReferenceImage[];
  seed: number | null;
  settings: Record<string, unknown>;
};

function mapAsset(row: AssetRow): GeneratedAsset {
  return generatedAssetSchema.parse({
    id: row.id,
    projectId: row.project_id,
    shotId: row.shot_id,
    attemptId: row.attempt_id,
    kind: row.kind,
    originalFilename: row.original_filename,
    relativePath: row.relative_path,
    mimeType: row.mime_type,
    byteSize: row.byte_size,
    sha256: row.sha256,
    width: row.width,
    height: row.height,
    createdAt: row.created_at,
  });
}

function mapJob(row: JobRow): GenerationJob {
  return generationJobSchema.parse({
    id: row.id,
    projectId: row.project_id,
    shotId: row.shot_id,
    attemptId: row.attempt_id,
    kind: row.kind,
    provider: row.provider,
    status: row.status,
    progress: row.progress,
    providerJobId: row.provider_job_id,
    errorMessage: row.error_message,
    createdAt: row.created_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
  });
}

function groupByAttempt<T extends { attempt_id: string }>(
  rows: T[],
): Map<string, T> {
  return new Map(rows.map((row) => [row.attempt_id, row]));
}

const activeCloudMessage =
  "An image is already being generated for this shot. Wait for it to finish.";

export class GenerationRepository {
  constructor(
    private readonly manager: DatabaseManager,
    private readonly projects: ProjectRepository,
  ) {}

  listProject(projectId: string): ImageHistory {
    this.assertProject(projectId);
    const attemptRows = this.manager.connection
      .prepare(
        `SELECT a.*, s.code AS shot_code
         FROM generation_attempts a
         JOIN shots s ON s.id = a.shot_id
         WHERE a.project_id = ? AND a.media_kind = 'image'
         ORDER BY a.created_at DESC, a.id DESC`,
      )
      .all(projectId) as AttemptRow[];
    const assets = groupByAttempt(
      this.manager.connection
        .prepare("SELECT * FROM assets WHERE project_id = ?")
        .all(projectId) as AssetRow[],
    );
    const jobs = groupByAttempt(
      this.manager.connection
        .prepare("SELECT * FROM generation_jobs WHERE project_id = ?")
        .all(projectId) as JobRow[],
    );
    const attempts = attemptRows.map((row) =>
      imageAttemptSchema.parse({
        id: row.id,
        projectId: row.project_id,
        shotId: row.shot_id,
        shotCode: row.shot_code,
        provider: row.provider,
        model: row.model,
        prompt: row.prompt,
        negativePrompt: row.negative_prompt,
        references: imageAttemptSchema.shape.references.parse(
          JSON.parse(row.references_json) as unknown,
        ),
        seed: row.seed,
        settings: imageAttemptSchema.shape.settings.parse(
          JSON.parse(row.settings_json) as unknown,
        ),
        status: row.status,
        reviewStatus: row.review_status,
        selected: row.is_selected === 1,
        errorMessage: row.error_message,
        costMicros: row.cost_micros,
        currency: row.currency,
        generationTimeMs: row.generation_time_ms,
        asset: assets.has(row.id) ? mapAsset(assets.get(row.id)!) : null,
        job: jobs.has(row.id) ? mapJob(jobs.get(row.id)!) : null,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      }),
    );
    return imageHistorySchema.parse({
      attempts,
      totals: {
        attempts: attempts.length,
        succeeded: attempts.filter((attempt) => attempt.status === "succeeded")
          .length,
        approved: attempts.filter(
          (attempt) => attempt.reviewStatus === "approved",
        ).length,
        failed: attempts.filter((attempt) => attempt.status === "failed")
          .length,
        costMicros: attempts.reduce(
          (total, attempt) => total + attempt.costMicros,
          0,
        ),
        currency: "USD",
      },
    });
  }

  getAttempt(projectId: string, attemptId: string): ImageAttempt | undefined {
    return this.listProject(projectId).attempts.find(
      (attempt) => attempt.id === attemptId,
    );
  }

  beginManualImage(input: NewImageAttempt): ImageAttempt {
    if (input.provider !== "manual") {
      throw new GenerationStateError(
        "Manual import requires the manual provider.",
      );
    }
    return this.beginImage(input);
  }

  beginCloudImage(input: NewImageAttempt): ImageAttempt {
    if (input.provider === "manual") {
      throw new GenerationStateError(
        "Cloud generation requires an image API provider.",
      );
    }
    const active = this.manager.connection
      .prepare(
        `SELECT 1 FROM generation_attempts
         WHERE shot_id = ? AND provider IN ('openai', 'gemini')
           AND status IN ('queued', 'generating')`,
      )
      .get(input.shotId);
    if (active) {
      throw new GenerationStateError(activeCloudMessage);
    }
    try {
      return this.beginImage(input);
    } catch (error) {
      // The partial unique index closes the race between two simultaneous clicks.
      if ((error as { code?: unknown }).code === "SQLITE_CONSTRAINT_UNIQUE") {
        throw new GenerationStateError(activeCloudMessage);
      }
      throw error;
    }
  }

  /** Fails image attempts that were running when the API process stopped. */
  failInterrupted(): number {
    const timestamp = new Date().toISOString();
    return this.manager.connection.transaction(() => {
      const projectIds = this.manager.connection
        .prepare(
          `SELECT DISTINCT project_id FROM generation_attempts
           WHERE provider IN ('manual', 'openai', 'gemini')
             AND status IN ('queued', 'generating')`,
        )
        .all() as Array<{ project_id: string }>;
      const result = this.manager.connection
        .prepare(
          `UPDATE generation_attempts SET
            status = 'failed',
            error_message = 'Interrupted because AI Studio stopped before the image was saved. Generate it again.',
            error_details_json = '{"code":"interrupted","recoverable":true}',
            updated_at = ?
           WHERE provider IN ('manual', 'openai', 'gemini')
             AND status IN ('queued', 'generating')`,
        )
        .run(timestamp);
      for (const { project_id } of projectIds) {
        this.projects.markManifestDirty(project_id);
      }
      return result.changes;
    })();
  }

  private beginImage(input: NewImageAttempt): ImageAttempt {
    this.requireShot(input.projectId, input.shotId);
    const timestamp = new Date().toISOString();
    const attemptId = randomUUID();
    this.manager.connection.transaction(() => {
      this.insertAttempt(attemptId, timestamp, "generating", input);
      this.projects.markManifestDirty(input.projectId);
    })();
    return this.requireAttempt(input.projectId, attemptId);
  }

  completeAttempt(
    projectId: string,
    attemptId: string,
    asset: NewGeneratedAsset,
    generationTimeMs: number,
    costMicros = 0,
  ): ImageAttempt {
    const attempt = this.requireAttempt(projectId, attemptId);
    if (attempt.status !== "generating") {
      throw new GenerationStateError(
        "Only a generating attempt can be completed.",
      );
    }
    const timestamp = new Date().toISOString();
    this.manager.connection.transaction(() => {
      this.manager.connection
        .prepare(
          `INSERT INTO assets (
            id, project_id, shot_id, attempt_id, kind, original_filename,
            relative_path, mime_type, byte_size, sha256, width, height, created_at
          ) VALUES (
            @id, @projectId, @shotId, @attemptId, 'storyboard-image',
            @originalFilename, @relativePath, @mimeType, @byteSize, @sha256,
            @width, @height, @createdAt
          )`,
        )
        .run({
          id: randomUUID(),
          projectId,
          shotId: attempt.shotId,
          attemptId,
          ...asset,
          createdAt: timestamp,
        });
      this.manager.connection
        .prepare(
          `UPDATE generation_attempts SET
            status = 'succeeded', generation_time_ms = ?, cost_micros = ?,
            error_message = NULL, error_details_json = NULL, updated_at = ?
           WHERE id = ?`,
        )
        .run(generationTimeMs, costMicros, timestamp, attemptId);
      this.projects.markManifestDirty(projectId);
    })();
    return this.requireAttempt(projectId, attemptId);
  }

  failAttempt(
    projectId: string,
    attemptId: string,
    error: unknown,
  ): ImageAttempt {
    this.requireAttempt(projectId, attemptId);
    const timestamp = new Date().toISOString();
    const message =
      error instanceof Error ? error.message : "Unknown generation failure.";
    const details = this.errorDetails(error);
    this.manager.connection.transaction(() => {
      this.manager.connection
        .prepare(
          `UPDATE generation_attempts SET
            status = 'failed', error_message = ?, error_details_json = ?,
            updated_at = ? WHERE id = ?`,
        )
        .run(message.slice(0, 2000), details, timestamp, attemptId);
      this.manager.connection
        .prepare(
          `UPDATE generation_jobs SET
            status = 'failed', error_message = ?, error_details_json = ?,
            completed_at = ? WHERE attempt_id = ?`,
        )
        .run(message.slice(0, 2000), details, timestamp, attemptId);
      this.projects.markManifestDirty(projectId);
    })();
    return this.requireAttempt(projectId, attemptId);
  }

  review(
    projectId: string,
    attemptId: string,
    decision: "approve" | "reject",
  ): ImageAttempt {
    const attempt = this.requireAttempt(projectId, attemptId);
    if (attempt.status !== "succeeded" || !attempt.asset) {
      throw new GenerationStateError(
        "Only a successfully generated image can be reviewed.",
      );
    }
    const timestamp = new Date().toISOString();
    this.manager.connection.transaction(() => {
      if (decision === "approve") {
        this.manager.connection
          .prepare(
            `UPDATE generation_attempts
             SET is_selected = 0, updated_at = ?
             WHERE shot_id = ? AND media_kind = 'image' AND is_selected = 1`,
          )
          .run(timestamp, attempt.shotId);
        this.manager.connection
          .prepare(
            `UPDATE generation_attempts
             SET review_status = 'approved', is_selected = 1, updated_at = ?
             WHERE id = ?`,
          )
          .run(timestamp, attemptId);
        this.manager.connection
          .prepare(
            "UPDATE shots SET status = 'approved', updated_at = ? WHERE id = ?",
          )
          .run(timestamp, attempt.shotId);
      } else {
        this.manager.connection
          .prepare(
            `UPDATE generation_attempts
             SET review_status = 'rejected', is_selected = 0, updated_at = ?
             WHERE id = ?`,
          )
          .run(timestamp, attemptId);
        const selected = this.manager.connection
          .prepare(
            `SELECT 1 FROM generation_attempts
             WHERE shot_id = ? AND media_kind = 'image' AND is_selected = 1`,
          )
          .get(attempt.shotId);
        if (!selected) {
          this.manager.connection
            .prepare(
              "UPDATE shots SET status = 'draft', updated_at = ? WHERE id = ?",
            )
            .run(timestamp, attempt.shotId);
        }
      }
      this.projects.markManifestDirty(projectId);
    })();
    return this.requireAttempt(projectId, attemptId);
  }

  getAsset(projectId: string, assetId: string): GeneratedAsset | undefined {
    const row = this.manager.connection
      .prepare("SELECT * FROM assets WHERE project_id = ? AND id = ?")
      .get(projectId, assetId) as AssetRow | undefined;
    return row ? mapAsset(row) : undefined;
  }

  private insertAttempt(
    id: string,
    timestamp: string,
    status: "queued" | "generating",
    input: NewImageAttempt,
  ): void {
    this.manager.connection
      .prepare(
        `INSERT INTO generation_attempts (
          id, project_id, shot_id, media_kind, provider, model, prompt,
          negative_prompt, references_json, seed, settings_json, status,
          review_status, is_selected, cost_micros, currency, created_at, updated_at
        ) VALUES (
          @id, @projectId, @shotId, 'image', @provider, @model, @prompt,
          @negativePrompt, @referencesJson, @seed, @settingsJson, @status,
          'pending', 0, 0, 'USD', @createdAt, @updatedAt
        )`,
      )
      .run({
        id,
        ...input,
        status,
        referencesJson: JSON.stringify(input.references),
        settingsJson: JSON.stringify(input.settings),
        createdAt: timestamp,
        updatedAt: timestamp,
      });
  }

  private requireAttempt(projectId: string, attemptId: string): ImageAttempt {
    const attempt = this.getAttempt(projectId, attemptId);
    if (!attempt) throw new GenerationNotFoundError("Generation attempt");
    return attempt;
  }

  private requireShot(projectId: string, shotId: string): { code: string } {
    this.assertProject(projectId);
    const shot = this.manager.connection
      .prepare("SELECT code FROM shots WHERE project_id = ? AND id = ?")
      .get(projectId, shotId) as { code: string } | undefined;
    if (!shot) throw new GenerationNotFoundError("Shot");
    return shot;
  }

  private assertProject(projectId: string): void {
    if (!this.projects.getById(projectId)) {
      throw new GenerationNotFoundError("Project");
    }
  }

  private errorDetails(error: unknown): string {
    if (error instanceof Error) {
      try {
        return JSON.stringify({
          name: error.name,
          message: error.message,
          stack: error.stack,
          cause: error.cause,
        }).slice(0, 20_000);
      } catch {
        return JSON.stringify({ name: error.name, message: error.message });
      }
    }
    return JSON.stringify({ value: String(error) }).slice(0, 20_000);
  }
}

export class GenerationNotFoundError extends Error {
  constructor(resource: string) {
    super(`${resource} was not found.`);
    this.name = "GenerationNotFoundError";
  }
}

export class GenerationStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GenerationStateError";
  }
}
