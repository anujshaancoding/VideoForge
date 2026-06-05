// ─────────────────────────────────────────────────────────────────────────────
// §14.3 Exports — Postgres-backed export jobs + BullMQ render queue.
//
//   POST /api/v1/exports        → validate project; insert export_job; enqueue render job
//   GET  /api/v1/exports/:id    → poll status; include presigned outputUrl when COMPLETE
//   POST /api/v1/exports/:id/download → mint a fresh 1-hour presigned GET URL
//
// AUTH: every route requires a valid access token (app.authenticate preHandler).
// workspaceId = the authenticated userId (user-is-the-workspace MVP model). The
// per-user export rate-limit also keys off this userId. DB column stays
// `workspace_id`.
// ─────────────────────────────────────────────────────────────────────────────

import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { eq, and, inArray } from 'drizzle-orm';
import { validateProject, type Project } from '@videoforge/project-schema';
import { buildExportCommand, type ExportSettings } from '@videoforge/ffmpeg-graph';
import { db } from '../db/client.js';
import { projects, exportJobs, assets } from '../db/schema.js';
import { presignGet, BUCKET_EXPORTS } from '../s3.js';
import { renderQueue, type RenderJobData, redisClient } from '../queues.js';

/** Collect every distinct sourceAssetId referenced by clips/overlays in a project. */
function collectAssetIds(project: Project): string[] {
  const ids = new Set<string>();
  for (const track of project.tracks) {
    const clips = (track as { clips?: Array<{ sourceAssetId?: string }> }).clips;
    if (!clips) continue; // caption tracks have `blocks`, not `clips`
    for (const clip of clips) {
      if (clip.sourceAssetId) ids.add(clip.sourceAssetId);
    }
  }
  return [...ids];
}

/** Free-tier export resolution cap: short edge (min of w/h) ≤ 1080 (MVP_Scope §3.10). */
const MAX_SHORT_EDGE = 1080;

/**
 * Clamp an export resolution so its short edge ≤ {@link MAX_SHORT_EDGE},
 * preserving aspect ratio. Returns the input unchanged when already within cap.
 */
function clampResolution(res: { w: number; h: number }): { w: number; h: number } {
  const w = Number(res.w);
  const h = Number(res.h);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) {
    // Degenerate input — fall back to a portrait 1080 short edge.
    return { w: 1080, h: 1920 };
  }
  const shortEdge = Math.min(w, h);
  if (shortEdge <= MAX_SHORT_EDGE) return { w: Math.round(w), h: Math.round(h) };
  const scale = MAX_SHORT_EDGE / shortEdge;
  return { w: Math.round(w * scale), h: Math.round(h * scale) };
}

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
  /**
   * Optional full §18 render-snapshot (Templates wave contract). When present,
   * the worker renders THIS exact document (e.g. a template pruned of unfilled
   * slots) instead of the stored project — preserving preview==export. It does
   * NOT change ownership/billing: the export still belongs to `projectId`, which
   * must be owned by the caller, and the Free-tier watermark/rate-limit are
   * applied exactly as for the stored-project path.
   */
  document?: unknown;
}

// ── Atomic sliding-window rate limit (Redis Lua) ─────────────────────────────
//
// The previous implementation ran zremrangebyscore → zcard → zadd as three
// separate round-trips, a TOCTOU race: N concurrent requests could all read a
// sub-limit count before any of them added, and all pass. This Lua script does
// prune + count + conditional-add in ONE atomic server-side step.
//
//   KEYS[1] = rate key            ARGV[1] = now (ms epoch)
//   ARGV[2] = windowMs            ARGV[3] = limit
//   ARGV[4] = unique member       ARGV[5] = key ttl (seconds)
//
// Returns 1 when the request is ALLOWED (member added), 0 when DENIED (over the
// limit; nothing added). Because the add is conditional and atomic, only the
// first `limit` requests in any window can win.
const RATE_LIMIT_LUA = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local windowMs = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])
local member = ARGV[4]
local ttl = tonumber(ARGV[5])
redis.call('ZREMRANGEBYSCORE', key, '-inf', now - windowMs)
local count = redis.call('ZCARD', key)
if count >= limit then
  return 0
end
redis.call('ZADD', key, now, member)
redis.call('EXPIRE', key, ttl)
return 1
`;

// ── Route plugin ─────────────────────────────────────────────────────────────

export async function exportRoutes(app: FastifyInstance): Promise<void> {
  // Gate every route behind a valid access token; request.user.userId is the workspace.
  app.addHook('preHandler', app.authenticate);

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
          eq(projects.workspaceId, request.user.userId),
        ),
      );

    if (!projectRow) {
      return reply
        .code(404)
        .send({ error: 'NotFound', message: 'project not found' });
    }

    // Resolve WHICH §18 document to render:
    //   • body.document present → render that exact client-supplied snapshot
    //     (Templates wave: the previewed, prune-of-unfilled-slots document).
    //     Ownership is already enforced above — `projectId` must belong to the
    //     caller — so the snapshot cannot change ownership/billing; it still
    //     exports under the user's `projectId`. A malformed snapshot → 400
    //     (mirrors POST /projects' document path), never an insert/enqueue.
    //   • absent → render the stored project by id (the exact prior behaviour).
    // Either way the SAME settings (watermark: true) + rate-limit + graph build
    // run below, so the snapshot never bypasses the Free-tier watermark.
    let project: Project;
    if (body.document !== undefined && body.document !== null) {
      const snapshot = validateProject(body.document);
      if (!snapshot.ok) {
        return reply
          .code(400)
          .send({ error: 'ValidationError', issues: snapshot.errors });
      }
      project = snapshot.value;
    } else {
      // Validate the stored §18 document before exporting.
      const result = validateProject(projectRow.document);
      if (!result.ok) {
        return reply
          .code(422)
          .send({ error: 'SchemaError', issues: result.errors });
      }
      project = result.value;
    }

    // ── Redis sliding-window rate limit: max 5 exports/min per user ─────────
    // Atomic prune+count+conditional-add via a single Lua eval (see
    // RATE_LIMIT_LUA) so concurrent requests can't all slip past the limit.
    const workspaceId = request.user.userId;
    const rateLimitKey = `rate:export:${workspaceId}`;
    const now = Date.now();
    const windowMs = 60_000;
    const limit = Number(process.env['EXPORT_RATE_LIMIT_PER_MIN'] ?? 5);
    const member = `${now}-${randomUUID()}`;

    const allowed = await redisClient.eval(
      RATE_LIMIT_LUA,
      1,
      rateLimitKey,
      String(now),
      String(windowMs),
      String(limit),
      member,
      '61',
    );
    if (allowed !== 1) {
      return reply.code(429).send({ error: 'RateLimitExceeded', message: `Export limit: ${limit}/min` });
    }

    // Build/validate the FFmpeg command graph (preview only — worker will run it).
    const mergedSettings: ExportSettings = {
      ...DEFAULT_EXPORT_SETTINGS,
      ...(body.settings ?? {}),
    };

    // Sidecar caption format ('.srt' | '.vtt') rides as an extra key OUTSIDE the
    // typed parity ExportSettings (we must not extend ffmpeg-graph's type). Carry it
    // through to the worker only for the sidecar path; default '.srt'.
    const rawSettings = (body.settings ?? {}) as Record<string, unknown>;
    const sidecarFmt = rawSettings['sidecarFmt'] === '.vtt' ? '.vtt' : '.srt';

    // Server-side free-tier resolution clamp: short edge ≤ 1080p. Never trust the
    // client's resolution; downscale (keeping aspect ratio) when it exceeds the cap.
    mergedSettings.resolution = clampResolution(mergedSettings.resolution);

    try {
      buildExportCommand(project, mergedSettings);
    } catch (err) {
      return reply.code(400).send({
        error: 'GraphBuildError',
        message: err instanceof Error ? err.message : String(err),
      });
    }

    // Resolve the S3 keys for every asset the project references so the worker
    // can fetch the ORIGINAL (proxy fallback) when it builds the filter_complex.
    const assetIds = collectAssetIds(project);
    const s3Keys: RenderJobData['s3Keys'] = {};
    if (assetIds.length > 0) {
      const assetRows = await db
        .select({
          id: assets.id,
          s3KeyOriginal: assets.s3KeyOriginal,
          s3KeyProxy: assets.s3KeyProxy,
        })
        .from(assets)
        .where(
          and(
            eq(assets.workspaceId, request.user.userId),
            inArray(assets.id, assetIds),
          ),
        );
      for (const row of assetRows) {
        s3Keys[row.id] = {
          ...(row.s3KeyOriginal ? { original: row.s3KeyOriginal } : {}),
          ...(row.s3KeyProxy ? { proxy: row.s3KeyProxy } : {}),
        };
      }
    }

    // Proxy-downgrade warnings: every referenced asset whose ORIGINAL is missing
    // (only a proxy survives, or the asset row is gone) renders from a lower-quality
    // proxy. We only have the assetId here, so the message keys off that.
    const warnings: string[] = [];
    for (const assetId of assetIds) {
      if (!s3Keys[assetId]?.original) {
        warnings.push(
          `${assetId} will export from its proxy (lower quality)`,
        );
      }
    }

    const exportId = randomUUID();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    await db.insert(exportJobs).values({
      id: exportId,
      projectId,
      workspaceId: request.user.userId,
      status: 'QUEUED',
      progress: 0,
      // Persist warnings alongside settings so GET /exports/:id (the poll path) can
      // surface the proxy-downgrade warning, not just the POST response.
      settings: { ...mergedSettings, warnings } as unknown as Record<string, unknown>,
      expiresAt,
    });

    const jobData: RenderJobData = {
      exportId,
      projectId,
      workspaceId: request.user.userId,
      project,
      // Pass the typed settings plus the sidecar format the worker reads for the
      // sidecar caption path (kept out of the typed ExportSettings shape).
      settings: { ...mergedSettings, sidecarFmt } as unknown as Record<string, unknown>,
      s3Keys,
    };
    await renderQueue.add('render', jobData);

    return reply.code(201).send({ exportId, status: 'QUEUED', warnings });
  });

  // GET /api/v1/exports/:id — poll status.
  app.get<{ Params: { id: string } }>('/:id', async (request, reply) => {
    const [row] = await db
      .select()
      .from(exportJobs)
      .where(
        and(
          eq(exportJobs.id, request.params.id),
          eq(exportJobs.workspaceId, request.user.userId),
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

    // Surface the persisted proxy-downgrade warnings on the poll path too.
    const settings = (row.settings ?? {}) as { warnings?: unknown };
    const warnings = Array.isArray(settings.warnings) ? (settings.warnings as string[]) : [];

    return {
      exportId: row.id,
      projectId: row.projectId,
      status: row.status,
      progress: row.progress,
      outputUrl,
      errorMessage: row.errorMessage,
      warnings,
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
            eq(exportJobs.workspaceId, request.user.userId),
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
