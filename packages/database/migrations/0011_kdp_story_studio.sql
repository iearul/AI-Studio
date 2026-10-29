-- KDP Story Studio. Every table carries owner_id so a future login only has to
-- change how the API resolves the owner. Rows are soft-deleted where users can
-- delete them, so mistakes stay recoverable.

CREATE TABLE kdp_settings (
  owner_id TEXT PRIMARY KEY NOT NULL,
  settings_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE kdp_author_profiles (
  id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL,
  pen_name TEXT NOT NULL CHECK (length(pen_name) BETWEEN 2 AND 120),
  profile_json TEXT NOT NULL,
  photo_path TEXT,
  is_default INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE INDEX kdp_author_profiles_owner_idx ON kdp_author_profiles(owner_id, deleted_at);

CREATE TABLE kdp_books (
  id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL,
  author_profile_id TEXT REFERENCES kdp_author_profiles(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  subtitle TEXT,
  series_name TEXT,
  series_number INTEGER,
  language TEXT NOT NULL,
  genre TEXT NOT NULL,
  subgenre TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'ready', 'published', 'archived')),
  stage TEXT NOT NULL DEFAULT 'brief' CHECK (stage IN ('brief', 'concepts', 'bible', 'outline', 'drafting', 'editing', 'publishing')),
  brief_json TEXT NOT NULL,
  settings_json TEXT NOT NULL,
  selected_concept_id TEXT,
  current_cover_id TEXT,
  manuscript_approved_at TEXT,
  listing_approved_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE INDEX kdp_books_owner_idx ON kdp_books(owner_id, deleted_at, updated_at DESC);

CREATE TABLE kdp_concepts (
  id TEXT PRIMARY KEY NOT NULL,
  book_id TEXT NOT NULL REFERENCES kdp_books(id) ON DELETE CASCADE,
  batch INTEGER NOT NULL,
  position INTEGER NOT NULL,
  concept_json TEXT NOT NULL,
  selected INTEGER NOT NULL DEFAULT 0 CHECK (selected IN (0, 1)),
  job_id TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX kdp_concepts_book_idx ON kdp_concepts(book_id, batch, position);
CREATE UNIQUE INDEX kdp_concepts_one_selected_idx ON kdp_concepts(book_id) WHERE selected = 1;

CREATE TABLE kdp_story_bibles (
  book_id TEXT PRIMARY KEY NOT NULL REFERENCES kdp_books(id) ON DELETE CASCADE,
  version INTEGER NOT NULL CHECK (version >= 1),
  bible_json TEXT NOT NULL,
  updated_by TEXT NOT NULL CHECK (updated_by IN ('ai', 'user', 'inspection')),
  updated_at TEXT NOT NULL
);

CREATE TABLE kdp_story_bible_versions (
  book_id TEXT NOT NULL REFERENCES kdp_books(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  bible_json TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  note TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (book_id, version)
);

CREATE TABLE kdp_canon_changes (
  id TEXT PRIMARY KEY NOT NULL,
  book_id TEXT NOT NULL REFERENCES kdp_books(id) ON DELETE CASCADE,
  chapter_id TEXT,
  source TEXT NOT NULL CHECK (source IN ('inspection', 'user', 'editorial')),
  change TEXT NOT NULL,
  reason TEXT,
  status TEXT NOT NULL CHECK (status IN ('recorded', 'proposed', 'accepted', 'rejected')),
  created_at TEXT NOT NULL
);
CREATE INDEX kdp_canon_changes_book_idx ON kdp_canon_changes(book_id, created_at);

CREATE TABLE kdp_chapters (
  id TEXT PRIMARY KEY NOT NULL,
  book_id TEXT NOT NULL REFERENCES kdp_books(id) ON DELETE CASCADE,
  position INTEGER NOT NULL CHECK (position >= 0),
  title TEXT,
  card_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'drafting', 'drafted', 'revised', 'approved')),
  locked INTEGER NOT NULL DEFAULT 0 CHECK (locked IN (0, 1)),
  approved_at TEXT,
  content TEXT NOT NULL DEFAULT '',
  word_count INTEGER NOT NULL DEFAULT 0,
  target_words INTEGER NOT NULL,
  summary TEXT,
  author_notes TEXT,
  content_source TEXT NOT NULL DEFAULT 'none' CHECK (content_source IN ('none', 'ai', 'human', 'mixed')),
  revision_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE INDEX kdp_chapters_book_idx ON kdp_chapters(book_id, deleted_at, position);

CREATE TABLE kdp_chapter_revisions (
  id TEXT PRIMARY KEY NOT NULL,
  chapter_id TEXT NOT NULL REFERENCES kdp_chapters(id) ON DELETE CASCADE,
  book_id TEXT NOT NULL REFERENCES kdp_books(id) ON DELETE CASCADE,
  revision_number INTEGER NOT NULL,
  content TEXT NOT NULL,
  word_count INTEGER NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('ai-draft', 'ai-expansion', 'ai-rewrite', 'ai-edit', 'user-edit', 'editorial-accept', 'restore', 'import')),
  note TEXT,
  job_id TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (chapter_id, revision_number)
);

CREATE TABLE kdp_editorial_reviews (
  id TEXT PRIMARY KEY NOT NULL,
  book_id TEXT NOT NULL REFERENCES kdp_books(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  job_id TEXT,
  summary TEXT NOT NULL,
  strengths_json TEXT NOT NULL,
  chapter_ids_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX kdp_editorial_reviews_book_idx ON kdp_editorial_reviews(book_id, created_at DESC);

CREATE TABLE kdp_editorial_issues (
  id TEXT PRIMARY KEY NOT NULL,
  book_id TEXT NOT NULL REFERENCES kdp_books(id) ON DELETE CASCADE,
  review_id TEXT REFERENCES kdp_editorial_reviews(id) ON DELETE CASCADE,
  chapter_id TEXT REFERENCES kdp_chapters(id) ON DELETE SET NULL,
  chapter_number INTEGER,
  kind TEXT NOT NULL CHECK (kind IN ('developmental', 'continuity', 'line', 'copy', 'originality', 'style', 'inspection')),
  severity TEXT NOT NULL CHECK (severity IN ('critical', 'major', 'minor', 'suggestion')),
  issue TEXT NOT NULL,
  location TEXT NOT NULL,
  evidence TEXT NOT NULL,
  suggestion TEXT NOT NULL,
  original_text TEXT,
  replacement_text TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'accepted', 'rejected', 'resolved')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX kdp_editorial_issues_book_idx ON kdp_editorial_issues(book_id, status, severity);

CREATE TABLE kdp_jobs (
  id TEXT PRIMARY KEY NOT NULL,
  book_id TEXT NOT NULL REFERENCES kdp_books(id) ON DELETE CASCADE,
  owner_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  lane TEXT NOT NULL CHECK (lane IN ('write', 'utility')),
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'cancelled', 'budget_stopped')),
  idempotency_key TEXT NOT NULL,
  input_json TEXT NOT NULL,
  result_json TEXT,
  progress REAL NOT NULL DEFAULT 0,
  progress_label TEXT,
  steps_done INTEGER NOT NULL DEFAULT 0,
  steps_total INTEGER NOT NULL DEFAULT 0,
  estimated_cost_micros INTEGER NOT NULL DEFAULT 0,
  actual_cost_micros INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  cancel_requested INTEGER NOT NULL DEFAULT 0,
  attempts INTEGER NOT NULL DEFAULT 0,
  lease_until TEXT,
  created_at TEXT NOT NULL,
  started_at TEXT,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  UNIQUE (owner_id, idempotency_key)
);
-- One active job per book and lane: a double click or a refresh cannot start
-- a second manuscript run.
CREATE UNIQUE INDEX kdp_jobs_one_active_idx ON kdp_jobs(book_id, lane)
  WHERE status IN ('queued', 'running');
CREATE INDEX kdp_jobs_status_idx ON kdp_jobs(status, created_at);

CREATE TABLE kdp_job_steps (
  job_id TEXT NOT NULL REFERENCES kdp_jobs(id) ON DELETE CASCADE,
  step_key TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('succeeded', 'failed', 'skipped')),
  attempts INTEGER NOT NULL DEFAULT 0,
  output_json TEXT,
  error_message TEXT,
  completed_at TEXT NOT NULL,
  PRIMARY KEY (job_id, step_key)
);

CREATE TABLE kdp_ai_runs (
  id TEXT PRIMARY KEY NOT NULL,
  book_id TEXT NOT NULL REFERENCES kdp_books(id) ON DELETE CASCADE,
  job_id TEXT,
  step_key TEXT,
  task TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens INTEGER NOT NULL DEFAULT 0,
  cache_write_tokens INTEGER NOT NULL DEFAULT 0,
  cost_micros INTEGER NOT NULL DEFAULT 0,
  estimated INTEGER NOT NULL DEFAULT 0,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL CHECK (status IN ('succeeded', 'failed', 'cancelled')),
  error_message TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX kdp_ai_runs_book_idx ON kdp_ai_runs(book_id, created_at DESC);

CREATE TABLE kdp_artifacts (
  id TEXT PRIMARY KEY NOT NULL,
  book_id TEXT NOT NULL REFERENCES kdp_books(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  data_json TEXT NOT NULL,
  job_id TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX kdp_artifacts_book_idx ON kdp_artifacts(book_id, kind, created_at DESC);

CREATE TABLE kdp_cover_assets (
  id TEXT PRIMARY KEY NOT NULL,
  book_id TEXT NOT NULL REFERENCES kdp_books(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('artwork', 'final')),
  source TEXT NOT NULL CHECK (source IN ('upload', 'paste', 'drop', 'composite')),
  original_filename TEXT NOT NULL,
  relative_path TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  width INTEGER,
  height INTEGER,
  color_model TEXT NOT NULL,
  byte_size INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  provenance TEXT NOT NULL CHECK (provenance IN ('human', 'ai-assisted', 'ai-generated', 'unknown', 'not-applicable')),
  provenance_note TEXT,
  parent_id TEXT,
  settings_json TEXT NOT NULL,
  validation_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (book_id, version)
);

CREATE TABLE kdp_book_metadata (
  book_id TEXT PRIMARY KEY NOT NULL REFERENCES kdp_books(id) ON DELETE CASCADE,
  metadata_json TEXT NOT NULL,
  generated_at TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE kdp_provenance (
  book_id TEXT NOT NULL REFERENCES kdp_books(id) ON DELETE CASCADE,
  asset TEXT NOT NULL CHECK (asset IN ('text', 'cover', 'interior-images', 'translation')),
  classification TEXT NOT NULL,
  overridden INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (book_id, asset)
);

CREATE TABLE kdp_publication_records (
  book_id TEXT PRIMARY KEY NOT NULL REFERENCES kdp_books(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('not-published', 'submitted', 'live', 'unpublished')),
  published_at TEXT,
  asin TEXT,
  amazon_url TEXT,
  final_title TEXT,
  notes TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE kdp_exports (
  id TEXT PRIMARY KEY NOT NULL,
  book_id TEXT NOT NULL REFERENCES kdp_books(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('succeeded', 'failed')),
  directory TEXT NOT NULL,
  files_json TEXT NOT NULL,
  validation_json TEXT,
  error_message TEXT,
  word_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX kdp_exports_book_idx ON kdp_exports(book_id, created_at DESC);
