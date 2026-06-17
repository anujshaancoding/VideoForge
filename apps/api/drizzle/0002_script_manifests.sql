-- VideoForge — Script Studio v2 sidecar manifests.
-- The assembler emits a §18 Project + a sidecar ScriptManifest (provenance + scene
-- windows + element id map). The manifest is NEVER inlined into the Project document
-- (ProjectSchema is .strict()), so it is persisted HERE, keyed by project id. The
-- Arrange step loads scene windows from this manifest to re-place uploaded assets
-- without re-planning. (Part of the CEO-approved `script` infra delta, 2026-06-05.)
-- Applied by drizzle-orm/postgres-js/migrator on server startup (idempotent).

CREATE TABLE IF NOT EXISTS script_manifests (
  project_id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  manifest JSONB NOT NULL,
  plan JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS script_manifests_workspace_id_idx ON script_manifests (workspace_id);
