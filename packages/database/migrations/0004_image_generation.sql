CREATE TABLE generation_attempts (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  shot_id TEXT NOT NULL REFERENCES shots(id) ON DELETE CASCADE,
  media_kind TEXT NOT NULL CHECK (media_kind = 'image'),
  provider TEXT NOT NULL CHECK (provider IN ('comfyui', 'manual')),
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
  currency TEXT NOT NULL DEFAULT 'EUR' CHECK (length(currency) = 3),
  generation_time_ms INTEGER CHECK (generation_time_ms IS NULL OR generation_time_ms >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX generation_attempts_project_idx
  ON generation_attempts(project_id, created_at DESC);
CREATE INDEX generation_attempts_shot_idx
  ON generation_attempts(shot_id, created_at DESC);
CREATE UNIQUE INDEX generation_attempts_selected_image_idx
  ON generation_attempts(shot_id)
  WHERE media_kind = 'image' AND is_selected = 1;

CREATE TABLE generation_jobs (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  shot_id TEXT NOT NULL REFERENCES shots(id) ON DELETE CASCADE,
  attempt_id TEXT UNIQUE NOT NULL REFERENCES generation_attempts(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind = 'image'),
  provider TEXT NOT NULL CHECK (provider = 'comfyui'),
  status TEXT NOT NULL CHECK (status IN (
    'queued', 'preparing', 'generating', 'downloading', 'completed', 'failed', 'cancelled'
  )),
  progress INTEGER NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  provider_job_id TEXT,
  error_message TEXT,
  error_details_json TEXT,
  created_at TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT
);

CREATE INDEX generation_jobs_status_idx
  ON generation_jobs(status, created_at);

CREATE TABLE assets (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  shot_id TEXT NOT NULL REFERENCES shots(id) ON DELETE CASCADE,
  attempt_id TEXT UNIQUE NOT NULL REFERENCES generation_attempts(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind = 'storyboard-image'),
  original_filename TEXT NOT NULL,
  relative_path TEXT NOT NULL,
  mime_type TEXT NOT NULL CHECK (mime_type IN ('image/jpeg', 'image/png', 'image/webp')),
  byte_size INTEGER NOT NULL CHECK (byte_size > 0),
  sha256 TEXT NOT NULL CHECK (length(sha256) = 64),
  width INTEGER CHECK (width IS NULL OR width > 0),
  height INTEGER CHECK (height IS NULL OR height > 0),
  created_at TEXT NOT NULL,
  UNIQUE(project_id, relative_path)
);

CREATE INDEX assets_project_idx ON assets(project_id, created_at DESC);
