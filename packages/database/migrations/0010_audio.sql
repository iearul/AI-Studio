-- Voice profiles keep one voice per narrator and per character, so a character
-- sounds the same in every scene.
CREATE TABLE voice_profiles (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('narrator', 'character')),
  character_id TEXT REFERENCES characters(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider = 'elevenlabs'),
  voice_id TEXT NOT NULL,
  voice_name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (
    (role = 'narrator' AND character_id IS NULL) OR
    (role = 'character' AND character_id IS NOT NULL)
  )
);

CREATE UNIQUE INDEX voice_profiles_narrator_idx
  ON voice_profiles(project_id) WHERE role = 'narrator';
CREATE UNIQUE INDEX voice_profiles_character_idx
  ON voice_profiles(character_id) WHERE role = 'character';

-- Every narration, dialogue, sound-effect, and music generation is an immutable
-- attempt. target_key names what it is for (for example "sfx:<shot id>"), and
-- approving one attempt makes it the only selected audio for that target.
CREATE TABLE audio_attempts (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('narration', 'dialogue', 'sfx', 'music')),
  target_key TEXT NOT NULL,
  scene_id TEXT REFERENCES scenes(id) ON DELETE CASCADE,
  shot_id TEXT REFERENCES shots(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider = 'elevenlabs'),
  model TEXT NOT NULL,
  text TEXT NOT NULL,
  settings_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL CHECK (status IN ('generating', 'succeeded', 'failed')),
  review_status TEXT NOT NULL DEFAULT 'pending' CHECK (review_status IN (
    'pending', 'approved', 'rejected'
  )),
  is_selected INTEGER NOT NULL DEFAULT 0 CHECK (is_selected IN (0, 1)),
  error_message TEXT,
  error_details_json TEXT,
  cost_micros INTEGER NOT NULL DEFAULT 0 CHECK (cost_micros >= 0),
  currency TEXT NOT NULL DEFAULT 'USD' CHECK (currency = 'USD'),
  generation_time_ms INTEGER CHECK (generation_time_ms IS NULL OR generation_time_ms >= 0),
  relative_path TEXT,
  mime_type TEXT CHECK (mime_type IS NULL OR mime_type = 'audio/mpeg'),
  byte_size INTEGER CHECK (byte_size IS NULL OR byte_size > 0),
  sha256 TEXT CHECK (sha256 IS NULL OR length(sha256) = 64),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK ((status = 'succeeded') = (relative_path IS NOT NULL))
);

CREATE INDEX audio_attempts_project_idx
  ON audio_attempts(project_id, created_at DESC);
CREATE UNIQUE INDEX audio_attempts_selected_idx
  ON audio_attempts(project_id, target_key) WHERE is_selected = 1;
CREATE UNIQUE INDEX audio_attempts_one_active_idx
  ON audio_attempts(project_id, target_key) WHERE status = 'generating';
