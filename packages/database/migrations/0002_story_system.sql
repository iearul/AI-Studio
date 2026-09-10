CREATE TABLE stories (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT UNIQUE NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  logline TEXT NOT NULL,
  genre TEXT NOT NULL,
  theme TEXT NOT NULL,
  tone TEXT NOT NULL,
  main_conflict TEXT NOT NULL,
  main_character TEXT NOT NULL,
  supporting_characters_json TEXT NOT NULL DEFAULT '[]',
  beginning TEXT NOT NULL,
  middle TEXT NOT NULL,
  climax TEXT NOT NULL,
  ending TEXT NOT NULL,
  audience_emotion TEXT NOT NULL,
  hook TEXT,
  twist TEXT,
  cliffhanger TEXT,
  retention_moments_json TEXT NOT NULL DEFAULT '[]',
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE scripts (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT UNIQUE NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  notes TEXT,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE scenes (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  script_id TEXT NOT NULL REFERENCES scripts(id) ON DELETE CASCADE,
  position INTEGER NOT NULL CHECK (position >= 0),
  scene_number INTEGER NOT NULL CHECK (scene_number > 0),
  location TEXT NOT NULL,
  time_of_day TEXT NOT NULL,
  characters_json TEXT NOT NULL DEFAULT '[]',
  action TEXT NOT NULL,
  narration TEXT,
  dialogue TEXT,
  estimated_duration_seconds REAL NOT NULL CHECK (estimated_duration_seconds > 0),
  emotional_purpose TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(project_id, scene_number),
  UNIQUE(project_id, position)
);

CREATE INDEX scenes_project_position_idx ON scenes(project_id, position);

CREATE TABLE shots (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  scene_id TEXT NOT NULL REFERENCES scenes(id) ON DELETE CASCADE,
  position INTEGER NOT NULL CHECK (position >= 0),
  code TEXT NOT NULL,
  duration_seconds REAL NOT NULL CHECK (duration_seconds BETWEEN 0.5 AND 30),
  characters_json TEXT NOT NULL DEFAULT '[]',
  location TEXT NOT NULL,
  shot_type TEXT NOT NULL,
  camera_angle TEXT NOT NULL,
  lens TEXT NOT NULL,
  camera_movement TEXT NOT NULL,
  action TEXT NOT NULL,
  lighting TEXT NOT NULL,
  emotion TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(project_id, code),
  UNIQUE(scene_id, position)
);

CREATE INDEX shots_project_idx ON shots(project_id);
CREATE INDEX shots_scene_position_idx ON shots(scene_id, position);
