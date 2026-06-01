// ─────────────────────────────────────────────────────────────────────────────
// §14.2 Assets — real S3 upload flow backed by Postgres.
//
//   POST /api/v1/assets/presign      → dedup by md5Hash; insert row; presign PUT URL
//   POST /api/v1/assets/:id/confirm  → flip to PROCESSING; enqueue BullMQ media job
//   GET  /api/v1/assets/:id          → return row; map s3 keys to presigned GET URLs
//
// workspaceId = 'dev-workspace' (MVP stub — real auth wires the JWT claim).
// ─────────────────────────────────────────────────────────────────────────────

import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { eq, and } from 'drizzle-orm';
import { db } from '../db/client.js';
import { assets } from '../db/schema.js';
import { presignPut, presignGet, BUCKET_ORIGINALS, BUCKET_PROXIES } from '../s3.js';
import { mediaQueue, type MediaJobData } from '../queues.js';

const DEV_WORKSPACE = 'dev-workspace';

// ── Body shapes ──────────────────────────────────────────────────────────────

interface PresignBody {
  filename?: unknown;
  contentType?: unknown;
  fileSize?: unknown;
  md5Hash?: unknown;
}

// ── Route plugin ─────────────────────────────────────────────────────────────

export async function assetRoutes(app: FastifyInstance): Promise<void> {
  // POST /api/v1/assets/presign — begin upload.
  app.post<{ Body: PresignBody }>('/presign', async (request, reply) => {
    const body = request.body ?? {};
    const filename =
      typeof body.filename === 'string' ? body.filename : 'upload.bin';
    const contentType =
      typeof body.contentType === 'string'
        ? body.contentType
        : 'application/octet-stream';
    const fileSize = Number(body.fileSize);
    const md5Hash =
      typeof body.md5Hash === 'string' && body.md5Hash.trim()
        ? body.md5Hash.trim()
        : null;

    // Deduplication: if the same workspace already has a matching md5Hash
    // return the existing assetId so the client skips the upload.
    if (md5Hash) {
      const [dup] = await db
        .select({ id: assets.id, status: assets.status })
        .from(assets)
        .where(
          and(
            eq(assets.workspaceId, DEV_WORKSPACE),
            eq(assets.md5Hash, md5Hash),
          ),
        );
      if (dup) {
        return reply.code(200).send({ existingAssetId: dup.id });
      }
    }

    const assetId = randomUUID();
    const ext = path.extname(filename) || '';
    const s3KeyOriginal = `${assetId}/original${ext}`;

    await db.insert(assets).values({
      id: assetId,
      workspaceId: DEV_WORKSPACE,
      filename,
      contentType,
      fileSize: Number.isFinite(fileSize) && fileSize > 0 ? fileSize : 0,
      md5Hash,
      status: 'AWAITING_UPLOAD',
      s3KeyOriginal,
    });

    const uploadUrl = await presignPut(BUCKET_ORIGINALS, s3KeyOriginal, 3600);
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();

    return reply.code(201).send({
      assetId,
      uploadUrl,
      partSizeBytes: 10 * 1024 * 1024,
      expiresAt,
    });
  });

  // POST /api/v1/assets/:id/confirm — finish upload; enqueue proxy/waveform job.
  app.post<{ Params: { id: string } }>(
    '/:id/confirm',
    async (request, reply) => {
      const [row] = await db
        .select()
        .from(assets)
        .where(
          and(
            eq(assets.id, request.params.id),
            eq(assets.workspaceId, DEV_WORKSPACE),
          ),
        );

      if (!row) {
        return reply
          .code(404)
          .send({ error: 'NotFound', message: 'asset not found' });
      }

      await db
        .update(assets)
        .set({ status: 'PROCESSING' })
        .where(eq(assets.id, request.params.id));

      const jobData: MediaJobData = {
        assetId: row.id,
        workspaceId: row.workspaceId,
        s3KeyOriginal: row.s3KeyOriginal ?? `${row.id}/original`,
        contentType: row.contentType,
      };
      await mediaQueue.add('process', jobData);

      return reply.code(200).send({ id: row.id, status: 'PROCESSING' });
    },
  );

  // GET /api/v1/assets/:id — return metadata; resolve s3 keys to presigned URLs.
  app.get<{ Params: { id: string } }>('/:id', async (request, reply) => {
    const [row] = await db
      .select()
      .from(assets)
      .where(
        and(
          eq(assets.id, request.params.id),
          eq(assets.workspaceId, DEV_WORKSPACE),
        ),
      );

    if (!row) {
      return reply
        .code(404)
        .send({ error: 'NotFound', message: 'asset not found' });
    }

    // Resolve s3 keys → presigned GET URLs for ready assets.
    const [proxyUrl, thumbnailUrl, waveformUrl] = await Promise.all([
      row.s3KeyProxy
        ? presignGet(BUCKET_PROXIES, row.s3KeyProxy)
        : Promise.resolve(null),
      row.s3KeyThumbnail
        ? presignGet(BUCKET_PROXIES, row.s3KeyThumbnail)
        : Promise.resolve(null),
      row.s3KeyWaveform
        ? presignGet(BUCKET_PROXIES, row.s3KeyWaveform)
        : Promise.resolve(null),
    ]);

    return {
      id: row.id,
      status: row.status,
      filename: row.filename,
      contentType: row.contentType,
      fileSize: row.fileSize,
      durationMs: row.durationMs,
      width: row.width,
      height: row.height,
      proxyUrl,
      thumbnailUrl,
      waveformUrl,
      createdAt: row.createdAt.toISOString(),
    };
  });
}
