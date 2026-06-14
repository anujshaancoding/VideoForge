-- VideoForge — project version history ("never lose your work")
-- Immutable snapshots of a project's full §18 document: auto (~30 min interval)
-- or named (explicit "save version"). Restore loads a snapshot as the project's
-- current document via a new revision — history is never destroyed.
-- Applied by drizzle-orm/postgres-js/migrator on server startup (idempotent).

CREATE TABLE IF NOT EXISTS project_versions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  snapshot JSONB NOT NULL,
  label TEXT,
  kind TEXT NOT NULL DEFAULT 'auto',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS project_versions_project_id_idx ON project_versions (project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS project_versions_workspace_id_idx ON project_versions (workspace_id);
