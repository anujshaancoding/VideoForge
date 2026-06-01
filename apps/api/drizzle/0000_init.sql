-- VideoForge M1 initial schema
-- Applied by drizzle-orm/postgres-js/migrator on server startup.

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  display_name TEXT,
  google_id TEXT UNIQUE,
  password_hash TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  name TEXT NOT NULL,
  document JSONB NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS projects_workspace_id_idx ON projects (workspace_id);

CREATE TABLE IF NOT EXISTS assets (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  filename TEXT NOT NULL,
  content_type TEXT NOT NULL,
  file_size INTEGER NOT NULL,
  md5_hash TEXT,
  status TEXT NOT NULL DEFAULT 'AWAITING_UPLOAD',
  s3_key_original TEXT,
  s3_key_proxy TEXT,
  s3_key_thumbnail TEXT,
  s3_key_waveform TEXT,
  duration_ms INTEGER,
  width INTEGER,
  height INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS assets_workspace_id_idx ON assets (workspace_id);
CREATE INDEX IF NOT EXISTS assets_md5_hash_idx ON assets (workspace_id, md5_hash);

CREATE TABLE IF NOT EXISTS export_jobs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'QUEUED',
  progress REAL NOT NULL DEFAULT 0,
  settings JSONB,
  s3_key_output TEXT,
  error_message TEXT,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS export_jobs_project_id_idx ON export_jobs (project_id);
CREATE INDEX IF NOT EXISTS export_jobs_workspace_id_idx ON export_jobs (workspace_id);
