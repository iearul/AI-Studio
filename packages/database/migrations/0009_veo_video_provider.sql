-- migration: table-rebuild
-- SQLite cannot change a CHECK constraint, so video_attempts is rebuilt to accept
-- the Google Veo provider. The runner disables foreign keys for this file so
-- video_assets keep their rows.
CREATE TABLE video_attempts_next (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  shot_id TEXT NOT NULL REFERENCES shots(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('manual', 'kling', 'seedance', 'veo')),
  model TEXT,
  prompt TEXT NOT NULL,
  source_image_asset_id TEXT REFERENCES assets(id) ON DELETE SET NULL,
  provider_job_id TEXT,
  status TEXT NOT NULL CHECK (status IN (
    'submitting', 'submitted', 'processing', 'downloading',
    'succeeded', 'failed', 'cancelled'
  )),
  review_status TEXT NOT NULL DEFAULT 'pending' CHECK (review_status IN (
    'pending', 'approved', 'rejected'
  )),
  is_selected INTEGER NOT NULL DEFAULT 0 CHECK (is_selected IN (0, 1)),
  resolution TEXT NOT NULL CHECK (resolution IN ('720p', '1080p', '4k')),
  requested_duration_seconds INTEGER NOT NULL CHECK (
    requested_duration_seconds BETWEEN 1 AND 30
  ),
  generate_audio INTEGER NOT NULL DEFAULT 0 CHECK (generate_audio IN (0, 1)),
  settings_json TEXT NOT NULL DEFAULT '{}',
  error_message TEXT,
  error_details_json TEXT,
  cost_micros INTEGER NOT NULL DEFAULT 0 CHECK (cost_micros >= 0),
  cost_is_estimate INTEGER NOT NULL DEFAULT 0 CHECK (cost_is_estimate IN (0, 1)),
  currency TEXT NOT NULL DEFAULT 'USD' CHECK (currency = 'USD'),
  result_expires_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(provider, provider_job_id)
);

INSERT INTO video_attempts_next (
  id, project_id, shot_id, provider, model, prompt, source_image_asset_id,
  provider_job_id, status, review_status, is_selected, resolution,
  requested_duration_seconds, generate_audio, settings_json, error_message,
  error_details_json, cost_micros, cost_is_estimate, currency, result_expires_at,
  created_at, updated_at
)
SELECT
  id, project_id, shot_id, provider, model, prompt, source_image_asset_id,
  provider_job_id, status, review_status, is_selected, resolution,
  requested_duration_seconds, generate_audio, settings_json, error_message,
  error_details_json, cost_micros, cost_is_estimate, currency, result_expires_at,
  created_at, updated_at
FROM video_attempts;

DROP TABLE video_attempts;
ALTER TABLE video_attempts_next RENAME TO video_attempts;

CREATE INDEX video_attempts_project_idx
  ON video_attempts(project_id, created_at DESC);
CREATE INDEX video_attempts_shot_idx
  ON video_attempts(shot_id, created_at DESC);
CREATE UNIQUE INDEX video_attempts_selected_idx
  ON video_attempts(shot_id) WHERE is_selected = 1;
CREATE UNIQUE INDEX video_attempts_one_active_shot_idx
  ON video_attempts(shot_id)
  WHERE status IN ('submitting', 'submitted', 'processing', 'downloading');
