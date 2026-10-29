import { randomUUID } from "node:crypto";

import {
  generatedAssetSchema,
  videoAssetSchema,
  videoAttemptSchema,
  videoHistorySchema,
  type GeneratedAsset,
  type VideoAsset,
  type VideoAttempt,
  type VideoHistory,
  type VideoProviderId,
  type VideoResolution,
} from "@ai-studio/contracts";

import {
  GenerationNotFoundError,
  GenerationStateError,
} from "./generation-repository.js";
import type { DatabaseManager } from "./database-manager.js";
import type { ProjectRepository } from "./project-repository.js";

type ImageAssetRow = {
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

type VideoAssetRow = Omit<ImageAssetRow, "kind" | "width" | "height"> & {
  kind: "shot-video";
};

type VideoAttemptRow = {
  id: string;
  project_id: string;
  shot_id: string;
  shot_code: string;
  provider: "manual" | VideoProviderId;
  model: string | null;
  prompt: string;
  source_image_asset_id: string | null;
  provider_job_id: string | null;
  status: VideoAttempt["status"];
  review_status: VideoAttempt["reviewStatus"];
  is_selected: 0 | 1;
  resolution: VideoResolution;
  requested_duration_seconds: number;
  generate_audio: 0 | 1;
  settings_json: string;
  error_message: string | null;
  cost_micros: number;
  cost_is_estimate: 0 | 1;
  currency: "USD";
  result_expires_at: string | null;
  created_at: string;
  updated_at: string;
};

export type NewVideoAsset = {
  originalFilename: string;
  relativePath: string;
  mimeType: VideoAsset["mimeType"];
  byteSize: number;
  sha256: string;
};

export type NewVideoAttempt = {
  projectId: string;
  shotId: string;
  provider: "manual" | VideoProviderId;
  model: string | null;
  prompt: string;
  sourceImageAssetId: string;
  resolution: VideoResolution;
  requestedDurationSeconds: number;
  generateAudio: boolean;
  settings: Record<string, unknown>;
  costMicros: number;
  costIsEstimate: boolean;
};

function mapImageAsset(row: ImageAssetRow): GeneratedAsset {
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

function mapVideoAsset(row: VideoAssetRow): VideoAsset {
  return videoAssetSchema.parse({
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
    createdAt: row.created_at,
  });
}

export class VideoRepository {
  constructor(
    private readonly manager: DatabaseManager,
    private readonly projects: ProjectRepository,
  ) {}

  listProject(projectId: string): VideoHistory {
    this.assertProject(projectId);
    const rows = this.manager.connection
      .prepare(
        `SELECT a.*, s.code AS shot_code
         FROM video_attempts a
         JOIN shots s ON s.id = a.shot_id
         WHERE a.project_id = ?
         ORDER BY a.created_at DESC, a.id DESC`,
      )
      .all(projectId) as VideoAttemptRow[];
    const imageAssets = new Map(
      (
        this.manager.connection
          .prepare("SELECT * FROM assets WHERE project_id = ?")
          .all(projectId) as ImageAssetRow[]
      ).map((row) => [row.id, row]),
    );
    const videoAssets = new Map(
      (
        this.manager.connection
          .prepare("SELECT * FROM video_assets WHERE project_id = ?")
          .all(projectId) as VideoAssetRow[]
      ).map((row) => [row.attempt_id, row]),
    );
    const attempts = rows.map((row) =>
      videoAttemptSchema.parse({
        id: row.id,
        projectId: row.project_id,
        shotId: row.shot_id,
        shotCode: row.shot_code,
        provider: row.provider,
        model: row.model,
        prompt: row.prompt,
        sourceImageAsset: row.source_image_asset_id
          ? mapImageAsset(imageAssets.get(row.source_image_asset_id)!)
          : null,
        providerJobId: row.provider_job_id,
        status: row.status,
        reviewStatus: row.review_status,
        selected: row.is_selected === 1,
        resolution: row.resolution,
        requestedDurationSeconds: row.requested_duration_seconds,
        generateAudio: row.generate_audio === 1,
        settings: videoAttemptSchema.shape.settings.parse(
          JSON.parse(row.settings_json) as unknown,
        ),
        errorMessage: row.error_message,
        costMicros: row.cost_micros,
        costIsEstimate: row.cost_is_estimate === 1,
        currency: row.currency,
        resultExpiresAt: row.result_expires_at,
        asset: videoAssets.has(row.id)
          ? mapVideoAsset(videoAssets.get(row.id)!)
          : null,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      }),
    );
    return videoHistorySchema.parse({
      attempts,
      totals: {
        attempts: attempts.length,
        succeeded: attempts.filter((attempt) => attempt.status === "succeeded")
          .length,
        approved: attempts.filter(
          (attempt) => attempt.reviewStatus === "approved",
        ).length,
        active: attempts.filter((attempt) =>
          ["submitting", "submitted", "processing", "downloading"].includes(
            attempt.status,
          ),
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

  getAttempt(projectId: string, attemptId: string): VideoAttempt | undefined {
    return this.listProject(projectId).attempts.find(
      (attempt) => attempt.id === attemptId,
    );
  }

  begin(input: NewVideoAttempt): VideoAttempt {
    this.requireShotAndSource(
      input.projectId,
      input.shotId,
      input.sourceImageAssetId,
    );
    this.assertNoActiveAttempt(input.shotId);
    const id = randomUUID();
    const timestamp = new Date().toISOString();
    const status = input.provider === "manual" ? "processing" : "submitting";
    this.manager.connection.transaction(() => {
      this.manager.connection
        .prepare(
          `INSERT INTO video_attempts (
            id, project_id, shot_id, provider, model, prompt,
            source_image_asset_id, status, resolution,
            requested_duration_seconds, generate_audio, settings_json,
            cost_micros, cost_is_estimate, currency, created_at, updated_at
          ) VALUES (
            @id, @projectId, @shotId, @provider, @model, @prompt,
            @sourceImageAssetId, @status, @resolution,
            @requestedDurationSeconds, @generateAudio, @settingsJson,
            @costMicros, @costIsEstimate, 'USD', @createdAt, @updatedAt
          )`,
        )
        .run({
          id,
          ...input,
          status,
          generateAudio: input.generateAudio ? 1 : 0,
          settingsJson: JSON.stringify(input.settings),
          costIsEstimate: input.costIsEstimate ? 1 : 0,
          createdAt: timestamp,
          updatedAt: timestamp,
        });
      this.projects.markManifestDirty(input.projectId);
    })();
    return this.requireAttempt(input.projectId, id);
  }

  submitted(
    projectId: string,
    attemptId: string,
    providerJobId: string,
  ): VideoAttempt {
    const attempt = this.requireAttempt(projectId, attemptId);
    if (attempt.status !== "submitting") {
      throw new GenerationStateError(
        "Only a submitting video attempt can receive a provider job.",
      );
    }
    this.updateState(projectId, attemptId, "submitted", {
      providerJobId,
      errorMessage: null,
    });
    return this.requireAttempt(projectId, attemptId);
  }

  markProviderState(
    projectId: string,
    attemptId: string,
    state: "submitted" | "processing" | "downloading",
    resultExpiresAt: string | null = null,
  ): VideoAttempt {
    const attempt = this.requireAttempt(projectId, attemptId);
    if (!["submitted", "processing", "downloading"].includes(attempt.status)) {
      throw new GenerationStateError("This video attempt is no longer active.");
    }
    this.manager.connection.transaction(() => {
      this.manager.connection
        .prepare(
          `UPDATE video_attempts SET status = ?, result_expires_at = ?,
           updated_at = ? WHERE id = ? AND project_id = ?`,
        )
        .run(
          state,
          resultExpiresAt,
          new Date().toISOString(),
          attemptId,
          projectId,
        );
      this.projects.markManifestDirty(projectId);
    })();
    return this.requireAttempt(projectId, attemptId);
  }

  complete(
    projectId: string,
    attemptId: string,
    asset: NewVideoAsset,
  ): VideoAttempt {
    const attempt = this.requireAttempt(projectId, attemptId);
    if (
      !["processing", "downloading"].includes(attempt.status) ||
      attempt.asset
    ) {
      throw new GenerationStateError(
        "Only an active video attempt without an asset can be completed.",
      );
    }
    const timestamp = new Date().toISOString();
    this.manager.connection.transaction(() => {
      this.manager.connection
        .prepare(
          `INSERT INTO video_assets (
            id, project_id, shot_id, attempt_id, kind, original_filename,
            relative_path, mime_type, byte_size, sha256, created_at
          ) VALUES (
            @id, @projectId, @shotId, @attemptId, 'shot-video',
            @originalFilename, @relativePath, @mimeType, @byteSize, @sha256,
            @createdAt
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
          `UPDATE video_attempts SET status = 'succeeded', error_message = NULL,
           error_details_json = NULL, updated_at = ?
           WHERE id = ? AND project_id = ?`,
        )
        .run(timestamp, attemptId, projectId);
      this.projects.markManifestDirty(projectId);
    })();
    return this.requireAttempt(projectId, attemptId);
  }

  fail(projectId: string, attemptId: string, error: unknown): VideoAttempt {
    this.requireAttempt(projectId, attemptId);
    const message =
      error instanceof Error
        ? error.message
        : "Unknown video generation failure.";
    const details = JSON.stringify({
      name: error instanceof Error ? error.name : "Error",
      message,
      ...(error instanceof Error && error.cause ? { cause: error.cause } : {}),
    }).slice(0, 20_000);
    this.manager.connection.transaction(() => {
      this.manager.connection
        .prepare(
          `UPDATE video_attempts SET status = 'failed', error_message = ?,
           error_details_json = ?,
           cost_micros = CASE WHEN cost_is_estimate = 1 THEN 0 ELSE cost_micros END,
           cost_is_estimate = 0, updated_at = ?
           WHERE id = ? AND project_id = ?`,
        )
        .run(
          message.slice(0, 2000),
          details,
          new Date().toISOString(),
          attemptId,
          projectId,
        );
      this.projects.markManifestDirty(projectId);
    })();
    return this.requireAttempt(projectId, attemptId);
  }

  review(
    projectId: string,
    attemptId: string,
    decision: "approve" | "reject",
  ): VideoAttempt {
    const attempt = this.requireAttempt(projectId, attemptId);
    if (attempt.status !== "succeeded" || !attempt.asset) {
      throw new GenerationStateError(
        "Only a successfully saved video can be reviewed.",
      );
    }
    const timestamp = new Date().toISOString();
    this.manager.connection.transaction(() => {
      if (decision === "approve") {
        this.manager.connection
          .prepare(
            `UPDATE video_attempts SET is_selected = 0, updated_at = ?
             WHERE shot_id = ? AND is_selected = 1`,
          )
          .run(timestamp, attempt.shotId);
      }
      this.manager.connection
        .prepare(
          `UPDATE video_attempts SET review_status = ?, is_selected = ?,
           updated_at = ? WHERE id = ? AND project_id = ?`,
        )
        .run(
          decision === "approve" ? "approved" : "rejected",
          decision === "approve" ? 1 : 0,
          timestamp,
          attemptId,
          projectId,
        );
      this.projects.markManifestDirty(projectId);
    })();
    return this.requireAttempt(projectId, attemptId);
  }

  getAsset(projectId: string, assetId: string): VideoAsset | undefined {
    const row = this.manager.connection
      .prepare("SELECT * FROM video_assets WHERE project_id = ? AND id = ?")
      .get(projectId, assetId) as VideoAssetRow | undefined;
    return row ? mapVideoAsset(row) : undefined;
  }

  recordActualCost(
    projectId: string,
    attemptId: string,
    costMicros: number,
  ): VideoAttempt {
    this.requireAttempt(projectId, attemptId);
    if (!Number.isSafeInteger(costMicros) || costMicros < 0) {
      throw new GenerationStateError("Provider cost must be non-negative.");
    }
    this.manager.connection.transaction(() => {
      this.manager.connection
        .prepare(
          `UPDATE video_attempts SET cost_micros = ?, cost_is_estimate = 0,
           updated_at = ? WHERE id = ? AND project_id = ?`,
        )
        .run(costMicros, new Date().toISOString(), attemptId, projectId);
      this.projects.markManifestDirty(projectId);
    })();
    return this.requireAttempt(projectId, attemptId);
  }

  listActive(): Array<{ projectId: string; attemptId: string }> {
    return this.manager.connection
      .prepare(
        `SELECT project_id AS projectId, id AS attemptId
         FROM video_attempts
         WHERE status IN ('submitted', 'processing', 'downloading')
         ORDER BY updated_at ASC LIMIT 100`,
      )
      .all() as Array<{ projectId: string; attemptId: string }>;
  }

  private updateState(
    projectId: string,
    attemptId: string,
    status: VideoAttempt["status"],
    values: { providerJobId?: string; errorMessage?: string | null },
  ): void {
    this.manager.connection
      .prepare(
        `UPDATE video_attempts SET status = ?,
         provider_job_id = COALESCE(?, provider_job_id), error_message = ?,
         updated_at = ? WHERE id = ? AND project_id = ?`,
      )
      .run(
        status,
        values.providerJobId ?? null,
        values.errorMessage ?? null,
        new Date().toISOString(),
        attemptId,
        projectId,
      );
  }

  private requireAttempt(projectId: string, attemptId: string): VideoAttempt {
    const attempt = this.getAttempt(projectId, attemptId);
    if (!attempt) throw new GenerationNotFoundError("Video attempt");
    return attempt;
  }

  private requireShotAndSource(
    projectId: string,
    shotId: string,
    sourceImageAssetId: string,
  ): void {
    this.assertProject(projectId);
    const source = this.manager.connection
      .prepare(
        `SELECT 1
         FROM generation_attempts attempt
         JOIN assets asset ON asset.attempt_id = attempt.id
         WHERE attempt.project_id = ? AND attempt.shot_id = ?
           AND asset.id = ? AND attempt.status = 'succeeded'
           AND attempt.review_status = 'approved' AND attempt.is_selected = 1`,
      )
      .get(projectId, shotId, sourceImageAssetId);
    if (!source) {
      throw new GenerationStateError(
        "Approve one storyboard image for this shot before making video.",
      );
    }
  }

  private assertNoActiveAttempt(shotId: string): void {
    const active = this.manager.connection
      .prepare(
        `SELECT 1 FROM video_attempts WHERE shot_id = ?
         AND status IN ('submitting', 'submitted', 'processing', 'downloading')`,
      )
      .get(shotId);
    if (active) {
      throw new GenerationStateError(
        "This shot already has an active video attempt.",
      );
    }
  }

  private assertProject(projectId: string): void {
    if (!this.projects.getById(projectId)) {
      throw new GenerationNotFoundError("Project");
    }
  }
}
