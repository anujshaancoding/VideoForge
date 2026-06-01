// ─────────────────────────────────────────────────────────────────────────────
// §14.3 Exports — Postgres-backed export jobs + BullMQ render queue.
//
//   POST /api/v1/exports        → validate project; insert export_job; enqueue render job
//   GET  /api/v1/exports/:id    → poll status; include presigned outputUrl when COMPLETE
//   POST /api/v1/exports/:id/download → mint a fresh 1-hour presigned GET URL
//
// workspaceId = 'dev-workspace' (MVP stub — real auth wires the JWT claim).
// ─────────────────────────────────────────────────────────────────────────────

import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { eq, and } from 'drizzle-orm';
import { validateProject, type Project } from '@videoforge/project-schema';
import { buildExportCommand, type ExportSettings } from '@videoforge/ffmpeg-graph';
import { db } from '../db/client.js';
import { projects, exportJobs } from '../db/schema.js';
import { presignGet, BUCKET_EXPORTS } from '../s3.js';
import { renderQueue, type RenderJobData, redisClient } from '../queues.js';

const DEV_WORKSPACE = 'dev-workspace';

/** Free-tier MVP export defaults (MP4/H.264 ≤1080p, watermark on). */
const DEFAULT_EXPORT_SETTINGS: ExportSettings = {
  format: 'mp4',
  videoCodec: 'h264',
  resolution: { w: 1080, h: 1920 },
  fps: 30,
  crf: 18,
  captions: 'none',
  watermark: true,
};

// ── Body shapes ──────────────────────────────────────────────────────────────

interface CreateExportBody {
  projectId?: unknown;
  settings?: Partial<ExportSettings>;
}

// ── Route plugin ─────────────────────────────────────────────────────────────

export async function exportRoutes(app: FastifyInstance): Promise<void> {
  // POST /api/v1/exports — create export job.
  app.post<{ Body: CreateExportBody }>('/', async (request, reply) => {
    const body = request.body ?? {};
    const projectId =
      typeof body.projectId === 'string' ? body.projectId : null;

    if (!projectId) {
      return reply
        .code(400)
        .send({ error: 'ValidationError', message: 'projectId is required' });
    }

    // Fetch the live project document from Postgres.
    const [projectRow] = await db
      .select()
      .from(projects)
      .where(
        and(
          eq(projects.id, projectId),
          eq(projects.workspaceId, DEV_WORKSPACE),
        ),
      );

    if (!projectRow) {
      return reply
        .code(404)
        .send({ error: 'NotFound', message: 'project not found' });
    }

    // Validate the stored §18 document before exporting.
    const result = validateProject(projectRow.document);
    if (!result.ok) {
      return reply
        .code(422)
        .send({ error: 'SchemaError', issues: result.errors });
    }
    const project: Project = result.value;

    // ── Redis sliding-window rate limit: max 5 exports/min per workspace ────
    const workspaceId = DEV_WORKSPACE;
    const rateLimitKey = `rate:export:${workspaceId}`;
    const now = Date.now();
    const windowMs = 60_000;
    const limit = Number(process.env['EXPORT_RATE_LIMIT_PER_MIN'] ?? 5);

    await redisClient.zremrangebyscore(rateLimitKey, '-inf', now - windowMs);
    const exportCount = await redisClient.zcard(rateLimitKey);
    if (exportCount >= limit) {
      return reply.code(429).send({ error: 'RateLimitExceeded', message: `Export limit: ${limit}/min` });
    }
    await redisClient.zadd(rateLimitKey, now, `${now}-${Math.random()}`);
    await redisClient.expire(rateLimitKey, 61);

    // Build/validate the FFmpeg command graph (preview only — worker will run it).
    const mergedSettings: ExportSettings = {
      ...DEFAULT_EXPORT_SETTINGS,
      ...(body.settings ?? {}),
    };

    try {
      buildExportCommand(project, mergedSettings);
    } catch (err) {
      return reply.code(400).send({
        error: 'GraphBuildError',
        message: err instanceof Error ? err.message : String(err),
      });
    }

    const exportId = randomUUID();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    await db.insert(exportJobs).values({
      id: exportId,
      projectId,
      workspaceId: DEV_WORKSPACE,
      status: 'QUEUED',
      progress: 0,
      settings: mergedSettings as unknown as Record<string, unknown>,
      expiresAt,
    });

    const jobData: RenderJobData = {
      exportId,
      projectId,
      workspaceId: DEV_WORKSPACE,
      settings: mergedSettings as unknown as Record<string, unknown>,
    };
    await renderQueue.add('render', jobData);

    return reply.code(201).send({ exportId, status: 'QUEUED' });
  });

  // GET /api/v1/exports/:id — poll status.
  app.get<{ Params: { id: string } }>('/:id', async (request, reply) => {
    const [row] = await db
      .select()
      .from(exportJobs)
      .where(
        and(
          eq(exportJobs.id, request.params.id),
          eq(exportJobs.workspaceId, DEV_WORKSPACE),
        ),
      );

    if (!row) {
      return reply
        .code(404)
        .send({ error: 'NotFound', message: 'export not found' });
    }

    let outputUrl: string | null = null;
    if (row.status === 'COMPLETE' && row.s3KeyOutput) {
      outputUrl = await presignGet(BUCKET_EXPORTS, row.s3KeyOutput, 3600);
    }

    return {
      exportId: row.id,
      projectId: row.projectId,
      status: row.status,
      progress: row.progress,
      outputUrl,
      errorMessage: row.errorMessage,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  });

  // POST /api/v1/exports/:id/download — mint fresh 1-hour presigned URL.
  app.post<{ Params: { id: string } }>(
    '/:id/download',
    async (request, reply) => {
      const [row] = await db
        .select()
        .from(exportJobs)
        .where(
          and(
            eq(exportJobs.id, request.params.id),
            eq(exportJobs.workspaceId, DEV_WORKSPACE),
          ),
        );

      if (!row) {
        return reply
          .code(404)
          .send({ error: 'NotFound', message: 'export not found' });
      }

      if (row.status !== 'COMPLETE' || !row.s3KeyOutput) {
        return reply
          .code(409)
          .send({ error: 'NotReady', message: 'export is not complete yet' });
      }

      const downloadUrl = await presignGet(BUCKET_EXPORTS, row.s3KeyOutput, 3600);
      return { downloadUrl, expiresAt: new Date(Date.now() + 3600 * 1000).toISOString() };
    },
  );
}
