import { randomUUID } from "node:crypto";

import {
  audioAttemptSchema,
  voiceProfileSchema,
  type AudioAttempt,
  type AudioKind,
  type SaveVoiceProfile,
  type VoiceProfile,
} from "@ai-film-studio/contracts";

import type { DatabaseManager } from "./database-manager.js";
import {
  GenerationNotFoundError,
  GenerationStateError,
} from "./generation-repository.js";
import type { ProjectRepository } from "./project-repository.js";

type VoiceProfileRow = {
  id: string;
  project_id: string;
  role: "narrator" | "character";
  character_id: string | null;
  provider: "elevenlabs";
  voice_id: string;
  voice_name: string;
  created_at: string;
  updated_at: string;
};

type AudioAttemptRow = {
  id: string;
  project_id: string;
  kind: AudioKind;
  target_key: string;
  scene_id: string | null;
  shot_id: string | null;
  provider: "elevenlabs";
  model: string;
  text: string;
  settings_json: string;
  status: "generating" | "succeeded" | "failed";
  review_status: "pending" | "approved" | "rejected";
  is_selected: 0 | 1;
  error_message: string | null;
  cost_micros: number;
  currency: "USD";
  generation_time_ms: number | null;
  relative_path: string | null;
  mime_type: "audio/mpeg" | null;
  byte_size: number | null;
  sha256: string | null;
  created_at: string;
  updated_at: string;
};

export type NewAudioAttempt = {
  projectId: string;
  kind: AudioKind;
  targetKey: string;
  sceneId: string | null;
  shotId: string | null;
  model: string;
  text: string;
  settings: Record<string, unknown>;
};

export type NewAudioAsset = {
  relativePath: string;
  mimeType: "audio/mpeg";
  byteSize: number;
  sha256: string;
};

const activeAudioMessage =
  "This audio is already being generated. Wait for it to finish.";

function mapVoiceProfile(row: VoiceProfileRow): VoiceProfile {
  return voiceProfileSchema.parse({
    id: row.id,
    projectId: row.project_id,
    role: row.role,
    characterId: row.character_id,
    provider: row.provider,
    voiceId: row.voice_id,
    voiceName: row.voice_name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

function mapAttempt(row: AudioAttemptRow): AudioAttempt {
  return audioAttemptSchema.parse({
    id: row.id,
    projectId: row.project_id,
    kind: row.kind,
    targetKey: row.target_key,
    sceneId: row.scene_id,
    shotId: row.shot_id,
    provider: row.provider,
    model: row.model,
    text: row.text,
    settings: audioAttemptSchema.shape.settings.parse(
      JSON.parse(row.settings_json) as unknown,
    ),
    status: row.status,
    reviewStatus: row.review_status,
    selected: row.is_selected === 1,
    errorMessage: row.error_message,
    costMicros: row.cost_micros,
    currency: row.currency,
    generationTimeMs: row.generation_time_ms,
    asset:
      row.relative_path && row.mime_type && row.byte_size && row.sha256
        ? {
            relativePath: row.relative_path,
            mimeType: row.mime_type,
            byteSize: row.byte_size,
            sha256: row.sha256,
          }
        : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

export class AudioRepository {
  constructor(
    private readonly manager: DatabaseManager,
    private readonly projects: ProjectRepository,
  ) {}

  listVoiceProfiles(projectId: string): VoiceProfile[] {
    this.assertProject(projectId);
    return (
      this.manager.connection
        .prepare(
          "SELECT * FROM voice_profiles WHERE project_id = ? ORDER BY role DESC, created_at",
        )
        .all(projectId) as VoiceProfileRow[]
    ).map(mapVoiceProfile);
  }

  saveVoiceProfile(projectId: string, input: SaveVoiceProfile): VoiceProfile {
    this.assertProject(projectId);
    if (input.characterId) {
      const character = this.manager.connection
        .prepare("SELECT 1 FROM characters WHERE project_id = ? AND id = ?")
        .get(projectId, input.characterId);
      if (!character) throw new GenerationNotFoundError("Character");
    }
    const timestamp = new Date().toISOString();
    const existing = this.manager.connection
      .prepare(
        input.role === "narrator"
          ? "SELECT id FROM voice_profiles WHERE project_id = ? AND role = 'narrator'"
          : "SELECT id FROM voice_profiles WHERE project_id = ? AND character_id = ?",
      )
      .get(
        ...(input.role === "narrator"
          ? [projectId]
          : [projectId, input.characterId]),
      ) as { id: string } | undefined;
    const id = existing?.id ?? randomUUID();
    this.manager.connection.transaction(() => {
      if (existing) {
        this.manager.connection
          .prepare(
            `UPDATE voice_profiles SET voice_id = ?, voice_name = ?, updated_at = ?
             WHERE id = ?`,
          )
          .run(input.voiceId, input.voiceName, timestamp, id);
      } else {
        this.manager.connection
          .prepare(
            `INSERT INTO voice_profiles (
              id, project_id, role, character_id, provider, voice_id, voice_name,
              created_at, updated_at
            ) VALUES (?, ?, ?, ?, 'elevenlabs', ?, ?, ?, ?)`,
          )
          .run(
            id,
            projectId,
            input.role,
            input.characterId,
            input.voiceId,
            input.voiceName,
            timestamp,
            timestamp,
          );
      }
      this.projects.markManifestDirty(projectId);
    })();
    return this.listVoiceProfiles(projectId).find(
      (profile) => profile.id === id,
    )!;
  }

  listProject(projectId: string): AudioAttempt[] {
    this.assertProject(projectId);
    return (
      this.manager.connection
        .prepare(
          "SELECT * FROM audio_attempts WHERE project_id = ? ORDER BY created_at DESC, id DESC",
        )
        .all(projectId) as AudioAttemptRow[]
    ).map(mapAttempt);
  }

  getAttempt(projectId: string, attemptId: string): AudioAttempt | undefined {
    const row = this.manager.connection
      .prepare("SELECT * FROM audio_attempts WHERE project_id = ? AND id = ?")
      .get(projectId, attemptId) as AudioAttemptRow | undefined;
    return row ? mapAttempt(row) : undefined;
  }

  begin(input: NewAudioAttempt): AudioAttempt {
    this.assertProject(input.projectId);
    const timestamp = new Date().toISOString();
    const id = randomUUID();
    try {
      this.manager.connection.transaction(() => {
        this.manager.connection
          .prepare(
            `INSERT INTO audio_attempts (
              id, project_id, kind, target_key, scene_id, shot_id, provider, model,
              text, settings_json, status, created_at, updated_at
            ) VALUES (
              @id, @projectId, @kind, @targetKey, @sceneId, @shotId, 'elevenlabs',
              @model, @text, @settingsJson, 'generating', @timestamp, @timestamp
            )`,
          )
          .run({
            id,
            ...input,
            settingsJson: JSON.stringify(input.settings),
            timestamp,
          });
        this.projects.markManifestDirty(input.projectId);
      })();
    } catch (error) {
      // The partial unique index allows one generation per target at a time.
      if ((error as { code?: unknown }).code === "SQLITE_CONSTRAINT_UNIQUE") {
        throw new GenerationStateError(activeAudioMessage);
      }
      throw error;
    }
    return this.requireAttempt(input.projectId, id);
  }

  complete(
    projectId: string,
    attemptId: string,
    asset: NewAudioAsset,
    generationTimeMs: number,
    costMicros: number,
  ): AudioAttempt {
    const attempt = this.requireAttempt(projectId, attemptId);
    if (attempt.status !== "generating") {
      throw new GenerationStateError(
        "Only a generating audio attempt can be completed.",
      );
    }
    this.manager.connection.transaction(() => {
      this.manager.connection
        .prepare(
          `UPDATE audio_attempts SET
            status = 'succeeded', relative_path = ?, mime_type = ?, byte_size = ?,
            sha256 = ?, generation_time_ms = ?, cost_micros = ?, updated_at = ?
           WHERE id = ?`,
        )
        .run(
          asset.relativePath,
          asset.mimeType,
          asset.byteSize,
          asset.sha256,
          generationTimeMs,
          costMicros,
          new Date().toISOString(),
          attemptId,
        );
      this.projects.markManifestDirty(projectId);
    })();
    return this.requireAttempt(projectId, attemptId);
  }

  fail(projectId: string, attemptId: string, error: unknown): AudioAttempt {
    this.requireAttempt(projectId, attemptId);
    const message =
      error instanceof Error ? error.message : "Unknown audio failure.";
    this.manager.connection.transaction(() => {
      this.manager.connection
        .prepare(
          `UPDATE audio_attempts SET
            status = 'failed', error_message = ?, error_details_json = ?, updated_at = ?
           WHERE id = ?`,
        )
        .run(
          message.slice(0, 2000),
          JSON.stringify({
            name: error instanceof Error ? error.name : "Error",
            message,
          }).slice(0, 20_000),
          new Date().toISOString(),
          attemptId,
        );
      this.projects.markManifestDirty(projectId);
    })();
    return this.requireAttempt(projectId, attemptId);
  }

  review(
    projectId: string,
    attemptId: string,
    decision: "approve" | "reject",
  ): AudioAttempt {
    const attempt = this.requireAttempt(projectId, attemptId);
    if (attempt.status !== "succeeded" || !attempt.asset) {
      throw new GenerationStateError(
        "Only successfully generated audio can be reviewed.",
      );
    }
    const timestamp = new Date().toISOString();
    this.manager.connection.transaction(() => {
      if (decision === "approve") {
        this.manager.connection
          .prepare(
            `UPDATE audio_attempts SET is_selected = 0, updated_at = ?
             WHERE project_id = ? AND target_key = ? AND is_selected = 1`,
          )
          .run(timestamp, projectId, attempt.targetKey);
        this.manager.connection
          .prepare(
            `UPDATE audio_attempts
             SET review_status = 'approved', is_selected = 1, updated_at = ?
             WHERE id = ?`,
          )
          .run(timestamp, attemptId);
      } else {
        this.manager.connection
          .prepare(
            `UPDATE audio_attempts
             SET review_status = 'rejected', is_selected = 0, updated_at = ?
             WHERE id = ?`,
          )
          .run(timestamp, attemptId);
      }
      this.projects.markManifestDirty(projectId);
    })();
    return this.requireAttempt(projectId, attemptId);
  }

  /** Fails audio attempts that were running when the API process stopped. */
  failInterrupted(): number {
    return this.manager.connection.transaction(() => {
      const projectIds = this.manager.connection
        .prepare(
          "SELECT DISTINCT project_id FROM audio_attempts WHERE status = 'generating'",
        )
        .all() as Array<{ project_id: string }>;
      const result = this.manager.connection
        .prepare(
          `UPDATE audio_attempts SET
            status = 'failed',
            error_message = 'Interrupted because AI Film Studio stopped before the audio was saved. Generate it again.',
            error_details_json = '{"code":"interrupted","recoverable":true}',
            updated_at = ?
           WHERE status = 'generating'`,
        )
        .run(new Date().toISOString());
      for (const { project_id } of projectIds) {
        this.projects.markManifestDirty(project_id);
      }
      return result.changes;
    })();
  }

  private requireAttempt(projectId: string, attemptId: string): AudioAttempt {
    const attempt = this.getAttempt(projectId, attemptId);
    if (!attempt) throw new GenerationNotFoundError("Audio attempt");
    return attempt;
  }

  private assertProject(projectId: string): void {
    if (!this.projects.getById(projectId)) {
      throw new GenerationNotFoundError("Project");
    }
  }
}
