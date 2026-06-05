// ─────────────────────────────────────────────────────────────────────────────
// §14.1 Projects — Postgres-backed CRUD via Drizzle ORM.
//
//   GET    /api/v1/projects       → list (newest updatedAt first)
//   POST   /api/v1/projects       → create from { title, canvasWidth, canvasHeight, frameRate }
//   GET    /api/v1/projects/:id   → full §18 project document
//   PATCH  /api/v1/projects/:id   → full-document save; server owns revision + updatedAt
//   DELETE /api/v1/projects/:id   → hard delete
//
// AUTH: every route requires a valid access token (app.authenticate preHandler).
// workspaceId is the authenticated userId — the "user-is-the-workspace" MVP
// model: there is no separate workspace entity, so the userId IS the workspace.
// The DB column is still named `workspace_id`; we store the userId in it.
// ─────────────────────────────────────────────────────────────────────────────

import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { eq, and, desc } from 'drizzle-orm';
import {
  newProject,
  validateProject,
  parseProject,
  type NewProjectOptions,
  type Project,
} from '@videoforge/project-schema';
import { db } from '../db/client.js';
import { projects } from '../db/schema.js';

// ── Free-tier plan limits (hard-coded, MVP_Scope §3.10) ──────────────────────
const PLAN_LIMITS = {
  maxVideoTracks: 3,
  maxAudioTracks: 2,
  maxVoiceOverTracks: 1,
  maxOverlayTracks: 2,
  /** Max project duration in ms (10 minutes). */
  maxProjectDurationMs: 600_000,
} as const;

/**
 * Pure free-tier limit check. Returns a human-readable error message when the
 * project violates a cap, or `null` when it is within limits.
 *
 * Counts tracks by type and computes project duration as the maximum
 * `endOnTimeline` across all media clips. Resolution is NOT checked here —
 * that is clamped server-side at export time.
 */
export function checkPlanLimits(project: Project): string | null {
  let videoTracks = 0;
  let audioTracks = 0;
  let voiceOverTracks = 0;
  let overlayTracks = 0;
  let maxEnd = 0;

  for (const track of project.tracks) {
    switch (track.type) {
      case 'video':
        videoTracks += 1;
        break;
      case 'audio':
        audioTracks += 1;
        break;
      case 'voiceover':
        voiceOverTracks += 1;
        break;
      case 'overlay':
        overlayTracks += 1;
        break;
      default:
        break;
    }

    const clips = (track as { clips?: Array<{ endOnTimeline?: unknown }> }).clips;
    if (clips) {
      for (const clip of clips) {
        const end = Number(clip.endOnTimeline);
        if (Number.isFinite(end) && end > maxEnd) maxEnd = end;
      }
    }
  }

  if (videoTracks > PLAN_LIMITS.maxVideoTracks) {
    return `Free tier allows at most ${PLAN_LIMITS.maxVideoTracks} video tracks (got ${videoTracks})`;
  }
  if (audioTracks > PLAN_LIMITS.maxAudioTracks) {
    return `Free tier allows at most ${PLAN_LIMITS.maxAudioTracks} audio tracks (got ${audioTracks})`;
  }
  if (voiceOverTracks > PLAN_LIMITS.maxVoiceOverTracks) {
    return `Free tier allows at most ${PLAN_LIMITS.maxVoiceOverTracks} voiceover track (got ${voiceOverTracks})`;
  }
  if (overlayTracks > PLAN_LIMITS.maxOverlayTracks) {
    return `Free tier allows at most ${PLAN_LIMITS.maxOverlayTracks} overlay tracks (got ${overlayTracks})`;
  }
  if (maxEnd > PLAN_LIMITS.maxProjectDurationMs) {
    return `Free tier allows projects up to ${PLAN_LIMITS.maxProjectDurationMs / 60_000} minutes (got ${(maxEnd / 60_000).toFixed(2)} minutes)`;
  }

  return null;
}

// ── Body shapes ──────────────────────────────────────────────────────────────

interface CreateProjectBody {
  title?: unknown;
  canvasWidth?: unknown;
  canvasHeight?: unknown;
  frameRate?: unknown;
  /**
   * Optional full §18 document to persist (create-from-template path, Forge's
   * "Option A"). When present it is validated, plan-limited, and has all
   * server-owned identity/ownership fields FORCED before insert (see
   * forceServerOwnedFields). When absent, the route falls back to the existing
   * blank-seed behaviour via newProject() — existing callers send no document
   * and are therefore unaffected (backward-compatible).
   */
  document?: unknown;
  /** Optional template provenance id (UUID). Stamped onto Project.templateId. */
  templateId?: unknown;
}

/** RFC-4122 UUID matcher (mirrors the schema's `uuid` validator surface). */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Stamp the server-owned identity/ownership fields onto a client-supplied,
 * already-validated document so a client can never spoof ownership or inject
 * another user's id. EVERY field a client could use to impersonate or to seed
 * stale state is overwritten here from server-trusted sources:
 *
 *   - `id`              → freshly generated server-side (ignores any client id)
 *   - `ownerId`         → the authenticated userId
 *   - `workspaceId`     → the authenticated userId ("user-is-the-workspace")
 *   - `collaborators`   → reset to [{ userId: self, role: 'admin' }]
 *   - `isPublic`        → forced false
 *   - `revision`        → reset to the initial revision (1)
 *   - `createdAt`/`updatedAt` → server clock
 *   - `templateId`      → provenance only; accepted iff a valid UUID, else null
 *
 * `templateId` precedence: an explicit body.templateId (validated) wins;
 * otherwise a UUID already on the document is kept; otherwise null. It is NEVER
 * used for auth — it is opaque provenance metadata.
 *
 * The result is re-parsed through parseProject() (belt-and-suspenders, mirroring
 * the PATCH save path) so the returned/inserted object is exactly a valid §18
 * Project.
 */
const INITIAL_REVISION = 1;

function forceServerOwnedFields(
  doc: Project,
  userId: string,
  templateIdFromBody: unknown,
): Project {
  const now = new Date().toISOString();

  // templateId: explicit body value (if a valid UUID) wins; else keep a valid
  // UUID already on the document; else null. Never trust it for ownership.
  let templateId: string | null = null;
  if (typeof templateIdFromBody === 'string' && UUID_RE.test(templateIdFromBody)) {
    templateId = templateIdFromBody;
  } else if (typeof doc.templateId === 'string' && UUID_RE.test(doc.templateId)) {
    templateId = doc.templateId;
  }

  return parseProject({
    ...(doc as object),
    id: randomUUID(),
    ownerId: userId,
    workspaceId: userId,
    collaborators: [{ userId, role: 'admin' }],
    isPublic: false,
    revision: INITIAL_REVISION,
    createdAt: now,
    updatedAt: now,
    templateId,
  });
}

function coerceCreateBody(
  body: CreateProjectBody,
): NewProjectOptions | { error: string } {
  const title =
    typeof body.title === 'string' && body.title.trim()
      ? body.title.trim()
      : 'Untitled';
  const canvasWidth = Number(body.canvasWidth);
  const canvasHeight = Number(body.canvasHeight);
  const frameRate = Number(body.frameRate);

  if (
    !Number.isInteger(canvasWidth) ||
    canvasWidth < 1 ||
    canvasWidth > 4096
  ) {
    return { error: 'canvasWidth must be an integer in [1, 4096]' };
  }
  if (
    !Number.isInteger(canvasHeight) ||
    canvasHeight < 1 ||
    canvasHeight > 4096
  ) {
    return { error: 'canvasHeight must be an integer in [1, 4096]' };
  }
  if (!Number.isFinite(frameRate) || frameRate <= 0 || frameRate > 120) {
    return { error: 'frameRate must be in (0, 120]' };
  }

  return { title, canvasWidth, canvasHeight, frameRate };
}

// ── Route plugin ─────────────────────────────────────────────────────────────

export async function projectRoutes(app: FastifyInstance): Promise<void> {
  // Gate every route in this group behind a valid access token. request.user is
  // populated by the decorator; we read request.user.userId as the workspace id.
  app.addHook('preHandler', app.authenticate);

  // GET /api/v1/projects — list workspace projects, newest first.
  app.get('/', async (request) => {
    const rows = await db
      .select()
      .from(projects)
      .where(eq(projects.workspaceId, request.user.userId))
      .orderBy(desc(projects.updatedAt));

    const items = rows.map((r) => ({
      id: r.id,
      name: r.name,
      document: r.document,
      revision: r.revision,
      createdAt: (r.document as Project).createdAt ?? r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    }));
    return { items, total: items.length };
  });

  // POST /api/v1/projects — create a project.
  //
  // Two shapes, ONE endpoint (additive / backward-compatible — Forge's Option A):
  //   • body has NO `document`  → seed a blank project from canvas params
  //                               (the EXACT prior behaviour; NewProjectModal hits
  //                               this and is unaffected).
  //   • body HAS a `document`   → create-from-template: validate it, force all
  //                               server-owned identity/ownership fields, enforce
  //                               plan limits, then insert. The client can NOT
  //                               spoof id/ownerId/workspaceId — they are
  //                               overwritten server-side (forceServerOwnedFields).
  app.post<{ Body: CreateProjectBody }>('/', async (request, reply) => {
    const body = request.body ?? {};

    // ── Path B: client supplied a full document (create-from-template) ──────────
    if (body.document !== undefined && body.document !== null) {
      const result = validateProject(body.document);
      if (!result.ok) {
        // Malformed §18 document → 400, NO insert. (Mirrors the canvas-param
        // ValidationError above; plan-limit violations stay 422 below.)
        return reply
          .code(400)
          .send({ error: 'ValidationError', issues: result.errors });
      }

      // Force server-owned fields BEFORE any persistence so a client cannot
      // inject another user's id/ownership or a stale revision.
      const project = forceServerOwnedFields(
        result.value,
        request.user.userId,
        body.templateId,
      );

      const limitError = checkPlanLimits(project);
      if (limitError) {
        return reply
          .code(422)
          .send({ error: 'PlanLimitExceeded', message: limitError });
      }

      await db.insert(projects).values({
        id: project.id,
        workspaceId: request.user.userId,
        name: project.title,
        document: project as unknown as Record<string, unknown>,
        revision: project.revision,
      });

      return reply.code(201).send(project);
    }

    // ── Path A: no document → blank seed from canvas params (unchanged) ─────────
    const coerced = coerceCreateBody(body);
    if ('error' in coerced) {
      return reply
        .code(400)
        .send({ error: 'ValidationError', message: coerced.error });
    }

    const project = newProject(coerced);

    const limitError = checkPlanLimits(project);
    if (limitError) {
      return reply
        .code(422)
        .send({ error: 'PlanLimitExceeded', message: limitError });
    }

    await db.insert(projects).values({
      id: project.id,
      workspaceId: request.user.userId,
      name: project.title,
      document: project as unknown as Record<string, unknown>,
      revision: project.revision,
    });

    return reply.code(201).send(project);
  });

  // GET /api/v1/projects/:id — full §18 document.
  app.get<{ Params: { id: string } }>('/:id', async (request, reply) => {
    const [row] = await db
      .select()
      .from(projects)
      .where(
        and(
          eq(projects.id, request.params.id),
          eq(projects.workspaceId, request.user.userId),
        ),
      );

    if (!row) {
      return reply
        .code(404)
        .send({ error: 'NotFound', message: 'project not found' });
    }
    return {
      id: row.id,
      name: row.name,
      document: row.document,
      revision: row.revision,
      createdAt: (row.document as Project).createdAt ?? row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  });

  // PATCH /api/v1/projects/:id — full-document save; server stamps revision+1.
  app.patch<{ Params: { id: string }; Body: unknown }>(
    '/:id',
    async (request, reply) => {
      const [existing] = await db
        .select()
        .from(projects)
        .where(
          and(
            eq(projects.id, request.params.id),
            eq(projects.workspaceId, request.user.userId),
          ),
        );

      if (!existing) {
        return reply
          .code(404)
          .send({ error: 'NotFound', message: 'project not found' });
      }

      // Contract: the autosave envelope is { document, baseRevision }, NOT a bare
      // Project. Validate the inner document only — validating the envelope itself
      // would always 422 (the #1 autosave blocker).
      const { document, baseRevision } = (request.body ?? {}) as {
        document?: unknown;
        baseRevision?: unknown;
      };

      const result = validateProject(document);
      if (!result.ok) {
        return reply
          .code(422)
          .send({ error: 'SchemaError', issues: result.errors });
      }

      if (result.value.id !== request.params.id) {
        return reply.code(409).send({
          error: 'IdMismatch',
          message: 'project id in body does not match URL',
        });
      }

      // Optimistic-concurrency check: when the client sends baseRevision, reject
      // if it doesn't match the stored revision. Undefined → skip the check.
      if (
        baseRevision !== undefined &&
        Number(baseRevision) !== existing.revision
      ) {
        return reply.code(409).send({
          error: 'RevisionConflict',
          message: `baseRevision ${String(baseRevision)} does not match server revision ${existing.revision}`,
        });
      }

      // Server-side free-tier enforcement on the validated document.
      const limitError = checkPlanLimits(result.value);
      if (limitError) {
        return reply
          .code(422)
          .send({ error: 'PlanLimitExceeded', message: limitError });
      }

      const now = new Date().toISOString();
      const newRevision = existing.revision + 1;

      const saved: Project = parseProject({
        ...result.value,
        revision: newRevision,
        createdAt: (existing.document as Project).createdAt,
        updatedAt: now,
      });

      await db
        .update(projects)
        .set({
          name: saved.title,
          document: saved as unknown as Record<string, unknown>,
          revision: newRevision,
          updatedAt: new Date(),
        })
        .where(eq(projects.id, request.params.id));

      return { revision: newRevision, updatedAt: now };
    },
  );

  // POST /api/v1/projects/:id/duplicate — copy with a new id.
  app.post<{ Params: { id: string } }>('/:id/duplicate', async (request, reply) => {
    const [row] = await db
      .select()
      .from(projects)
      .where(and(eq(projects.id, request.params.id), eq(projects.workspaceId, request.user.userId)));

    if (!row) {
      return reply.code(404).send({ error: 'NotFound', message: 'project not found' });
    }

    const src = row.document as Project;
    const now = new Date().toISOString();
    const copy: Project = {
      ...(src as object),
      id: randomUUID(),
      title: `${src.title} (copy)`,
      revision: 1,
      createdAt: now,
      updatedAt: now,
    } as Project;

    await db.insert(projects).values({
      id: copy.id,
      workspaceId: request.user.userId,
      name: copy.title,
      document: copy as unknown as Record<string, unknown>,
      revision: 1,
    });

    return reply.code(201).send(copy);
  });

  // DELETE /api/v1/projects/:id — hard delete.
  app.delete<{ Params: { id: string } }>('/:id', async (request, reply) => {
    const [existing] = await db
      .select({ id: projects.id })
      .from(projects)
      .where(
        and(
          eq(projects.id, request.params.id),
          eq(projects.workspaceId, request.user.userId),
        ),
      );

    if (!existing) {
      return reply
        .code(404)
        .send({ error: 'NotFound', message: 'project not found' });
    }

    await db
      .delete(projects)
      .where(eq(projects.id, request.params.id));

    return reply.code(204).send();
  });
}
