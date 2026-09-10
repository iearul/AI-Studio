CREATE TABLE projects (
  id TEXT PRIMARY KEY NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL CHECK (length(title) BETWEEN 2 AND 120),
  type TEXT NOT NULL CHECK (type IN ('reel', 'video')),
  topic TEXT NOT NULL CHECK (length(topic) BETWEEN 3 AND 500),
  language TEXT NOT NULL CHECK (language IN ('bn', 'en', 'de', 'other')),
  custom_language TEXT,
  target_duration_seconds INTEGER NOT NULL CHECK (target_duration_seconds BETWEEN 15 AND 1500),
  aspect_ratio TEXT NOT NULL CHECK (aspect_ratio IN ('9:16', '16:9', '1:1')),
  style TEXT NOT NULL CHECK (style IN ('mystery', 'horror', 'historical', 'mythological', 'documentary', 'cinematic', 'custom')),
  custom_style TEXT,
  narration TEXT NOT NULL CHECK (narration IN ('narrator', 'dialogue', 'both', 'none')),
  target_audience TEXT,
  tone TEXT,
  age_rating TEXT,
  country_culture TEXT,
  visual_style TEXT,
  desired_ending TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'archived')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX projects_updated_at_idx ON projects(updated_at DESC);
CREATE INDEX projects_type_status_idx ON projects(type, status);

CREATE TABLE settings (
  key TEXT PRIMARY KEY NOT NULL,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE backup_records (
  id TEXT PRIMARY KEY NOT NULL,
  filename TEXT UNIQUE NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('manual', 'automatic', 'pre_restore')),
  size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0),
  checksum_sha256 TEXT NOT NULL CHECK (length(checksum_sha256) = 64),
  created_at TEXT NOT NULL
);

CREATE TABLE manifest_outbox (
  project_id TEXT PRIMARY KEY NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  project_json TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_error TEXT,
  updated_at TEXT NOT NULL
);
