// ─────────────────────────────────────────────────────────────────────────────
// §14.1 Projects — Postgres-backed CRUD via Drizzle ORM.
//
//   GET    /api/v1/projects       → list (newest updatedAt first)
//   POST   /api/v1/projects       → create from { title, canvasWidth, canvasHeight, frameRate }
//   GET    /api/v1/projects/:id   → full §18 project document
//   PATCH  /api/v1/projects/:id   → full-document save; server owns revision + updatedAt
//   DELETE /api/v1/projects/:id   → hard delete
//
// workspaceId is hardcoded to 'dev-workspace' for MVP — auth middleware wires
// the real value once JWT authentication is enabled.
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

/** MVP stub: single workspace for all requests. */
const DEV_WORKSPACE = 'dev-workspace';

// ── Body shapes ──────────────────────────────────────────────────────────────

interface CreateProjectBody {
  title?: unknown;
  canvasWidth?: unknown;
  canvasHeight?: unknown;
  frameRate?: unknown;
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
  // GET /api/v1/projects — list workspace projects, newest first.
  app.get('/', async () => {
    const rows = await db
      .select()
      .from(projects)
      .where(eq(projects.workspaceId, DEV_WORKSPACE))
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

  // POST /api/v1/projects — create from canvas params.
  app.post<{ Body: CreateProjectBody }>('/', async (request, reply) => {
    const coerced = coerceCreateBody(request.body ?? {});
    if ('error' in coerced) {
      return reply
        .code(400)
        .send({ error: 'ValidationError', message: coerced.error });
    }

    const project = newProject(coerced);

    await db.insert(projects).values({
      id: project.id,
      workspaceId: DEV_WORKSPACE,
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
          eq(projects.workspaceId, DEV_WORKSPACE),
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
            eq(projects.workspaceId, DEV_WORKSPACE),
          ),
        );

      if (!existing) {
        return reply
          .code(404)
          .send({ error: 'NotFound', message: 'project not found' });
      }

      const result = validateProject(request.body);
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

      // Optional optimistic-concurrency check: if client sends baseRevision,
      // reject if it doesn't match the stored revision.
      const incoming = request.body as { baseRevision?: unknown };
      if (
        incoming.baseRevision !== undefined &&
        Number(incoming.baseRevision) !== existing.revision
      ) {
        return reply.code(409).send({
          error: 'RevisionConflict',
          message: `baseRevision ${String(incoming.baseRevision)} does not match server revision ${existing.revision}`,
        });
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
      .where(and(eq(projects.id, request.params.id), eq(projects.workspaceId, DEV_WORKSPACE)));

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
      workspaceId: DEV_WORKSPACE,
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
          eq(projects.workspaceId, DEV_WORKSPACE),
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
