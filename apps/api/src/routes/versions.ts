// ─────────────────────────────────────────────────────────────────────────────
// Project version history — "never lose your work" (CEO-greenlit 2026-06-14).
//
//   POST   /api/v1/projects/:projectId/versions          → snapshot the current
//          document (or a supplied document) as a version. Body: { label?, kind?,
//          document? }. Used by BOTH auto-versioning (kind 'auto') and the manual
//          "save version" action (kind 'named', with a label).
//   GET    /api/v1/projects/:projectId/versions          → list versions, newest
//          first, capped at the latest 50 (metadata only — no snapshot payload).
//   POST   /api/v1/projects/:projectId/versions/:versionId/restore
//          → load the snapshot back as the project's CURRENT document, advancing
//          the project revision (history is preserved, never destroyed).
//
// AUTH + scoping mirror routes/projects.ts exactly: every route requires a valid
// access token; workspaceId == authenticated userId (user-is-the-workspace MVP).
// A version is only ever readable/writable when BOTH the project AND the version
// belong to the caller's workspace.
// ─────────────────────────────────────────────────────────────────────────────

import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { eq, and, desc } from 'drizzle-orm';
import { parseProject, validateProject, type Project } from '@videoforge/project-schema';
import { db } from '../db/client.js';
import { projects, projectVersions } from '../db/schema.js';
import { checkPlanLimits } from './projects.js';

/** Most-recent versions returned by the list endpoint (keeps payloads bounded). */
const LIST_LIMIT = 50;

type VersionKind = 'auto' | 'named';

interface CreateVersionBody {
  /** Optional human label (only meaningful for kind 'named'). */
  label?: unknown;
  /** 'auto' (interval snapshot) | 'named' (explicit save version). Defaults 'auto'. */
  kind?: unknown;
  /**
   * Optional full §18 document to snapshot. When present it is validated and its
   * id must match the project. When absent, the project's CURRENT stored document
   * is snapshotted instead (so a caller can checkpoint without re-sending the doc).
   */
  document?: unknown;
}

function coerceKind(raw: unknown): VersionKind {
  return raw === 'named' ? 'named' : 'auto';
}

function coerceLabel(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  // Bound the label so it can't be used to store unbounded blobs.
  return trimmed.slice(0, 200);
}

export async function versionRoutes(app: FastifyInstance): Promise<void> {
  // Gate every route behind a valid access token (same model as projectRoutes).
  app.addHook('preHandler', app.authenticate);

  // POST /:projectId/versions — snapshot a version.
  app.post<{ Params: { projectId: string }; Body: CreateVersionBody }>(
    '/:projectId/versions',
    async (request, reply) => {
      const [project] = await db
        .select()
        .from(projects)
        .where(
          and(
            eq(projects.id, request.params.projectId),
            eq(projects.workspaceId, request.user.userId),
          ),
        );

      if (!project) {
        return reply
          .code(404)
          .send({ error: 'NotFound', message: 'project not found' });
      }

      const body = request.body ?? {};

      // Resolve the document to snapshot: an explicitly supplied document (validated
      // + id-matched) wins; otherwise the project's current stored document.
      let snapshot: Project;
      if (body.document !== undefined && body.document !== null) {
        const result = validateProject(body.document);
        if (!result.ok) {
          return reply
            .code(422)
            .send({ error: 'SchemaError', issues: result.errors });
        }
        if (result.value.id !== request.params.projectId) {
          return reply.code(409).send({
            error: 'IdMismatch',
            message: 'document id in body does not match the project',
          });
        }
        snapshot = result.value;
      } else {
        snapshot = project.document as Project;
      }

      const id = randomUUID();
      const kind = coerceKind(body.kind);
      const label = coerceLabel(body.label);
      const now = new Date();

      await db.insert(projectVersions).values({
        id,
        projectId: request.params.projectId,
        workspaceId: request.user.userId,
        snapshot: snapshot as unknown as Record<string, unknown>,
        label,
        kind,
        createdAt: now,
      });

      return reply.code(201).send({
        id,
        projectId: request.params.projectId,
        label,
        kind,
        createdAt: now.toISOString(),
      });
    },
  );

  // GET /:projectId/versions — list, newest first, capped (metadata only).
  app.get<{ Params: { projectId: string } }>(
    '/:projectId/versions',
    async (request, reply) => {
      const [project] = await db
        .select({ id: projects.id })
        .from(projects)
        .where(
          and(
            eq(projects.id, request.params.projectId),
            eq(projects.workspaceId, request.user.userId),
          ),
        );

      if (!project) {
        return reply
          .code(404)
          .send({ error: 'NotFound', message: 'project not found' });
      }

      const rows = await db
        .select({
          id: projectVersions.id,
          label: projectVersions.label,
          kind: projectVersions.kind,
          createdAt: projectVersions.createdAt,
        })
        .from(projectVersions)
        .where(
          and(
            eq(projectVersions.projectId, request.params.projectId),
            eq(projectVersions.workspaceId, request.user.userId),
          ),
        )
        .orderBy(desc(projectVersions.createdAt))
        .limit(LIST_LIMIT);

      const items = rows.map((r) => ({
        id: r.id,
        label: r.label,
        kind: r.kind,
        createdAt: r.createdAt.toISOString(),
      }));
      return { items, total: items.length };
    },
  );

  // POST /:projectId/versions/:versionId/restore — load a snapshot as current.
  //
  // History-preserving: we DON'T delete newer versions. We write the snapshot back
  // onto the project as a NEW revision (revision + 1), so the pre-restore state is
  // still recoverable from its own version row. The restored document is re-stamped
  // through parseProject (mirrors the PATCH save path) and re-checked against plan
  // limits before it can become the live document.
  app.post<{ Params: { projectId: string; versionId: string } }>(
    '/:projectId/versions/:versionId/restore',
    async (request, reply) => {
      const [project] = await db
        .select()
        .from(projects)
        .where(
          and(
            eq(projects.id, request.params.projectId),
            eq(projects.workspaceId, request.user.userId),
          ),
        );

      if (!project) {
        return reply
          .code(404)
          .send({ error: 'NotFound', message: 'project not found' });
      }

      const [version] = await db
        .select()
        .from(projectVersions)
        .where(
          and(
            eq(projectVersions.id, request.params.versionId),
            eq(projectVersions.projectId, request.params.projectId),
            eq(projectVersions.workspaceId, request.user.userId),
          ),
        );

      if (!version) {
        return reply
          .code(404)
          .send({ error: 'NotFound', message: 'version not found' });
      }

      // Validate the snapshot before it becomes the live document — a snapshot from
      // an older schema must not be restored into an invalid current document.
      const result = validateProject(version.snapshot);
      if (!result.ok) {
        return reply
          .code(422)
          .send({ error: 'SchemaError', issues: result.errors });
      }

      const limitError = checkPlanLimits(result.value);
      if (limitError) {
        return reply
          .code(422)
          .send({ error: 'PlanLimitExceeded', message: limitError });
      }

      const now = new Date();
      const newRevision = project.revision + 1;

      // Restore = the snapshot's content, but identity/ownership + revision/time are
      // re-stamped from the live project so we never resurrect a stale id/owner.
      const restored: Project = parseProject({
        ...(result.value as object),
        id: project.id,
        revision: newRevision,
        createdAt: (project.document as Project).createdAt,
        updatedAt: now.toISOString(),
      });

      await db
        .update(projects)
        .set({
          name: restored.title,
          document: restored as unknown as Record<string, unknown>,
          revision: newRevision,
          updatedAt: now,
        })
        .where(eq(projects.id, request.params.projectId));

      // Return the full restored document so the client can hand it straight to the
      // editor store (loadProject) without a follow-up GET.
      return reply.send({ revision: newRevision, document: restored });
    },
  );
}
