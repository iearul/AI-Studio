ALTER TABLE shots ADD COLUMN props_json TEXT NOT NULL DEFAULT '[]';

CREATE TABLE characters (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  name TEXT NOT NULL COLLATE NOCASE,
  age INTEGER CHECK (age IS NULL OR age BETWEEN 0 AND 150),
  gender TEXT NOT NULL DEFAULT '',
  cultural_appearance TEXT NOT NULL DEFAULT '',
  face_description TEXT NOT NULL DEFAULT '',
  hair TEXT NOT NULL DEFAULT '',
  eyes TEXT NOT NULL DEFAULT '',
  skin TEXT NOT NULL DEFAULT '',
  height TEXT NOT NULL DEFAULT '',
  body_type TEXT NOT NULL DEFAULT '',
  default_clothing_json TEXT NOT NULL DEFAULT '[]',
  alternative_clothing_json TEXT NOT NULL DEFAULT '[]',
  accessories_json TEXT NOT NULL DEFAULT '[]',
  personality TEXT NOT NULL DEFAULT '',
  voice TEXT NOT NULL DEFAULT '',
  speech_style TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(project_id, code),
  UNIQUE(project_id, name)
);

CREATE INDEX characters_project_idx ON characters(project_id);

CREATE TABLE locations (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  name TEXT NOT NULL COLLATE NOCASE,
  country_culture TEXT NOT NULL DEFAULT '',
  type TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  architecture TEXT NOT NULL DEFAULT '',
  materials_json TEXT NOT NULL DEFAULT '[]',
  furniture_json TEXT NOT NULL DEFAULT '[]',
  default_lighting TEXT NOT NULL DEFAULT '',
  color_palette_json TEXT NOT NULL DEFAULT '[]',
  nearby_environment TEXT NOT NULL DEFAULT '',
  period_details TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(project_id, code),
  UNIQUE(project_id, name)
);

CREATE INDEX locations_project_idx ON locations(project_id);

CREATE TABLE props (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  name TEXT NOT NULL COLLATE NOCASE,
  description TEXT NOT NULL DEFAULT '',
  materials_json TEXT NOT NULL DEFAULT '[]',
  colors_json TEXT NOT NULL DEFAULT '[]',
  significance TEXT NOT NULL DEFAULT '',
  continuity_notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(project_id, code),
  UNIQUE(project_id, name)
);

CREATE INDEX props_project_idx ON props(project_id);

CREATE TABLE reference_images (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  owner_type TEXT NOT NULL CHECK (owner_type IN ('character', 'location', 'prop')),
  owner_id TEXT NOT NULL,
  view TEXT NOT NULL CHECK (view IN (
    'front', 'three-quarter', 'profile', 'full-body', 'neutral', 'expression',
    'exterior-day', 'exterior-night', 'interior', 'detail', 'other'
  )),
  original_filename TEXT NOT NULL,
  relative_path TEXT NOT NULL,
  mime_type TEXT NOT NULL CHECK (mime_type IN ('image/jpeg', 'image/png', 'image/webp')),
  byte_size INTEGER NOT NULL CHECK (byte_size > 0),
  sha256 TEXT NOT NULL CHECK (length(sha256) = 64),
  created_at TEXT NOT NULL,
  UNIQUE(project_id, relative_path)
);

CREATE INDEX reference_images_owner_idx
  ON reference_images(project_id, owner_type, owner_id);

CREATE TRIGGER reference_images_character_guard
BEFORE INSERT ON reference_images
WHEN NEW.owner_type = 'character'
  AND NOT EXISTS (
    SELECT 1 FROM characters
    WHERE id = NEW.owner_id AND project_id = NEW.project_id
  )
BEGIN
  SELECT RAISE(ABORT, 'reference character does not exist in project');
END;

CREATE TRIGGER reference_images_location_guard
BEFORE INSERT ON reference_images
WHEN NEW.owner_type = 'location'
  AND NOT EXISTS (
    SELECT 1 FROM locations
    WHERE id = NEW.owner_id AND project_id = NEW.project_id
  )
BEGIN
  SELECT RAISE(ABORT, 'reference location does not exist in project');
END;

CREATE TRIGGER reference_images_prop_guard
BEFORE INSERT ON reference_images
WHEN NEW.owner_type = 'prop'
  AND NOT EXISTS (
    SELECT 1 FROM props
    WHERE id = NEW.owner_id AND project_id = NEW.project_id
  )
BEGIN
  SELECT RAISE(ABORT, 'reference prop does not exist in project');
END;

CREATE TRIGGER characters_reference_cleanup
AFTER DELETE ON characters
BEGIN
  DELETE FROM reference_images
  WHERE owner_type = 'character' AND owner_id = OLD.id;
END;

CREATE TRIGGER locations_reference_cleanup
AFTER DELETE ON locations
BEGIN
  DELETE FROM reference_images
  WHERE owner_type = 'location' AND owner_id = OLD.id;
END;

CREATE TRIGGER props_reference_cleanup
AFTER DELETE ON props
BEGIN
  DELETE FROM reference_images
  WHERE owner_type = 'prop' AND owner_id = OLD.id;
END;
