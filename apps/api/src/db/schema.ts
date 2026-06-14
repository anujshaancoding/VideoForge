// ─────────────────────────────────────────────────────────────────────────────
// Drizzle ORM schema — Postgres tables for VideoForge M1 backend.
// Corresponds to §18 data model and §14 API surface.
// ─────────────────────────────────────────────────────────────────────────────

import { pgTable, text, jsonb, integer, timestamp, real } from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: text('id').primaryKey(),
  email: text('email').notNull().unique(),
  displayName: text('display_name'),
  googleId: text('google_id').unique(),
  passwordHash: text('password_hash'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const projects = pgTable('projects', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull(),
  name: text('name').notNull(),
  document: jsonb('document').notNull(),
  revision: integer('revision').notNull().default(0),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const assets = pgTable('assets', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull(),
  filename: text('filename').notNull(),
  contentType: text('content_type').notNull(),
  fileSize: integer('file_size').notNull(),
  md5Hash: text('md5_hash'),
  status: text('status').notNull().default('AWAITING_UPLOAD'),
  s3KeyOriginal: text('s3_key_original'),
  s3KeyProxy: text('s3_key_proxy'),
  s3KeyThumbnail: text('s3_key_thumbnail'),
  s3KeyWaveform: text('s3_key_waveform'),
  durationMs: integer('duration_ms'),
  width: integer('width'),
  height: integer('height'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// Project versions — immutable snapshots of a project's full §18 document, taken
// automatically (~every 30 min of active editing) or on an explicit "save version".
// This is the "never lose your work" trust play: restore loads a snapshot back as
// the project's current document (via a new revision — history is never destroyed).
// workspace_id is the authenticated userId (user-is-the-workspace MVP model).
export const projectVersions = pgTable('project_versions', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull(),
  workspaceId: text('workspace_id').notNull(),
  snapshot: jsonb('snapshot').notNull(),
  label: text('label'),
  /** 'auto' (interval snapshot) | 'named' (explicit save version). */
  kind: text('kind').notNull().default('auto'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const exportJobs = pgTable('export_jobs', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull(),
  workspaceId: text('workspace_id').notNull(),
  status: text('status').notNull().default('QUEUED'),
  progress: real('progress').notNull().default(0),
  settings: jsonb('settings'),
  s3KeyOutput: text('s3_key_output'),
  errorMessage: text('error_message'),
  expiresAt: timestamp('expires_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});
