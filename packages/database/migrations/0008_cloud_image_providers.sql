-- migration: table-rebuild
-- SQLite cannot change a CHECK constraint, so generation_attempts is rebuilt to
-- accept the OpenAI and Gemini image providers. The runner disables foreign keys
-- for this file so generation_jobs and assets keep their rows.
CREATE TABLE generation_attempts_next (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  shot_id TEXT NOT NULL REFERENCES shots(id) ON DELETE CASCADE,
  media_kind TEXT NOT NULL CHECK (media_kind = 'image'),
  provider TEXT NOT NULL CHECK (provider IN ('comfyui', 'manual', 'openai', 'gemini')),
  model TEXT,
  prompt TEXT NOT NULL,
  negative_prompt TEXT NOT NULL DEFAULT '',
  references_json TEXT NOT NULL DEFAULT '[]',
  seed INTEGER CHECK (seed IS NULL OR seed >= 0),
  settings_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL CHECK (status IN (
    'queued', 'generating', 'succeeded', 'failed', 'cancelled'
  )),
  review_status TEXT NOT NULL DEFAULT 'pending' CHECK (review_status IN (
    'pending', 'approved', 'rejected'
  )),
  is_selected INTEGER NOT NULL DEFAULT 0 CHECK (is_selected IN (0, 1)),
  error_message TEXT,
  error_details_json TEXT,
  cost_micros INTEGER NOT NULL DEFAULT 0 CHECK (cost_micros >= 0),
  currency TEXT NOT NULL DEFAULT 'USD' CHECK (length(currency) = 3),
  generation_time_ms INTEGER CHECK (generation_time_ms IS NULL OR generation_time_ms >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT INTO generation_attempts_next (
  id, project_id, shot_id, media_kind, provider, model, prompt, negative_prompt,
  references_json, seed, settings_json, status, review_status, is_selected,
  error_message, error_details_json, cost_micros, currency, generation_time_ms,
  created_at, updated_at
)
SELECT
  id, project_id, shot_id, media_kind, provider, model, prompt, negative_prompt,
  references_json, seed, settings_json, status, review_status, is_selected,
  error_message, error_details_json, cost_micros, currency, generation_time_ms,
  created_at, updated_at
FROM generation_attempts;

DROP TABLE generation_attempts;
ALTER TABLE generation_attempts_next RENAME TO generation_attempts;

CREATE INDEX generation_attempts_project_idx
  ON generation_attempts(project_id, created_at DESC);
CREATE INDEX generation_attempts_shot_idx
  ON generation_attempts(shot_id, created_at DESC);
CREATE UNIQUE INDEX generation_attempts_selected_image_idx
  ON generation_attempts(shot_id)
  WHERE media_kind = 'image' AND is_selected = 1;
-- One paid image request per shot at a time.
CREATE UNIQUE INDEX generation_attempts_one_active_cloud_idx
  ON generation_attempts(shot_id)
  WHERE provider IN ('openai', 'gemini') AND status IN ('queued', 'generating');
