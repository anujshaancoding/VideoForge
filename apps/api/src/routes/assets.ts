// ─────────────────────────────────────────────────────────────────────────────
// §14.2 Assets — real S3 upload flow backed by Postgres.
//
//   POST /api/v1/assets/presign      → dedup by md5Hash; insert row; presign PUT URL
//   POST /api/v1/assets/:id/confirm  → flip to PROCESSING; enqueue BullMQ media job
//   GET  /api/v1/assets/:id          → return row; map s3 keys to presigned GET URLs;
//                                       include hasOriginal (has a non-proxy original)
//
// AUTH: every route requires a valid access token (app.authenticate preHandler).
// workspaceId = the authenticated userId (user-is-the-workspace MVP model); the
// DB column is still named `workspace_id` but stores the userId.
// ─────────────────────────────────────────────────────────────────────────────

import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { eq, and } from 'drizzle-orm';
import { DeleteObjectCommand } from '@aws-sdk/client-s3';
import { db } from '../db/client.js';
import { assets } from '../db/schema.js';
import {
  s3,
  presignPut,
  presignGet,
  BUCKET_ORIGINALS,
  BUCKET_PROXIES,
} from '../s3.js';
import { mediaQueue, type MediaJobData } from '../queues.js';

// ── Accepted formats + size ceilings (MVP §3.1) ───────────────────────────────
// Single decode path: MP4/MOV (H.264), MP3/WAV/AAC, JPG/PNG. Reject anything else
// at presign (415) so an H.265/MKV/AVI never gets uploaded then fails late in the
// worker. Mirrors the client allowlist in apps/web/src/lib/api.ts.

const ACCEPTED_MIME = new Set<string>([
  'video/mp4',
  'video/quicktime',
  'audio/mpeg',
  'audio/mp3',
  'audio/wav',
  'audio/x-wav',
  'audio/wave',
  'audio/aac',
  'audio/mp4',
  'audio/x-m4a',
  'audio/m4a',
  'image/jpeg',
  'image/png',
]);

const ACCEPTED_EXTENSIONS = new Set<string>([
  '.mp4', '.mov',
  '.mp3', '.wav', '.aac', '.m4a',
  '.jpg', '.jpeg', '.png',
]);

/** Per-kind upload ceilings (bytes): 20 GB video / 2 GB audio / 100 MB image. */
const SIZE_LIMITS = {
  video: 20 * 1024 * 1024 * 1024,
  audio: 2 * 1024 * 1024 * 1024,
  image: 100 * 1024 * 1024,
} as const;

function kindFromContentType(mime: string): keyof typeof SIZE_LIMITS {
  if (mime.startsWith('audio/')) return 'audio';
  if (mime.startsWith('image/')) return 'image';
  return 'video';
}

function isAcceptedFormat(contentType: string, filename: string): boolean {
  if (contentType && ACCEPTED_MIME.has(contentType.toLowerCase())) return true;
  const ext = path.extname(filename).toLowerCase();
  return ext !== '' && ACCEPTED_EXTENSIONS.has(ext);
}

// ── Body shapes ──────────────────────────────────────────────────────────────

interface PresignBody {
  filename?: unknown;
  contentType?: unknown;
  fileSize?: unknown;
  /** Workspace dedup hash (SHA-256 hex). Renamed from the misleading `md5Hash`. */
  contentHash?: unknown;
}

interface PatchAssetBody {
  filename?: unknown;
}

// ── Route plugin ─────────────────────────────────────────────────────────────

export async function assetRoutes(app: FastifyInstance): Promise<void> {
  // Gate every route behind a valid access token; request.user.userId is the workspace.
  app.addHook('preHandler', app.authenticate);

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
    const contentHash =
      typeof body.contentHash === 'string' && body.contentHash.trim()
        ? body.contentHash.trim()
        : null;

    // Reject unsupported formats up-front (415) rather than presigning + uploading
    // a file the worker can't decode (H.265/MKV/AVI/…). MVP single decode path.
    if (!isAcceptedFormat(contentType, filename)) {
      return reply.code(415).send({
        error: 'UnsupportedMediaType',
        message:
          'Format not supported. Use MP4/MOV (H.264), MP3/WAV/AAC, or JPG/PNG.',
      });
    }

    // Enforce the Free-tier per-kind ceilings (413) before handing back an upload
    // URL. A non-finite/≤0 size is also rejected (it previously got coerced to 0
    // and slipped through unbounded).
    const kind = kindFromContentType(contentType);
    const limit = SIZE_LIMITS[kind];
    if (!Number.isFinite(fileSize) || fileSize <= 0 || fileSize > limit) {
      return reply.code(413).send({
        error: 'PayloadTooLarge',
        message: `File exceeds the ${kind} size limit.`,
      });
    }

    // Deduplication: only dedup against a READY asset (a complete, processed copy).
    // Matching a half-finished AWAITING_UPLOAD/PROCESSING/FAILED row would hand the
    // client a broken asset it then polls forever — so those fall through to a fresh
    // upload (md5_hash has no unique constraint, so a new row is fine).
    if (contentHash) {
      const [dup] = await db
        .select({ id: assets.id })
        .from(assets)
        .where(
          and(
            eq(assets.workspaceId, request.user.userId),
            eq(assets.md5Hash, contentHash),
            eq(assets.status, 'READY'),
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
      workspaceId: request.user.userId,
      filename,
      contentType,
      // Size was validated against the per-kind ceiling above, so it is a finite
      // positive number here (no more silent coercion to 0).
      fileSize,
      md5Hash: contentHash,
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
            eq(assets.workspaceId, request.user.userId),
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
          eq(assets.workspaceId, request.user.userId),
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
      // True when the asset still has its full-quality ORIGINAL (non-proxy) S3
      // object. Pixel uses this for the pre-export proxy-warning badge: a missing
      // original means the export would render from the lower-quality proxy.
      hasOriginal: Boolean(row.s3KeyOriginal),
      proxyUrl,
      thumbnailUrl,
      waveformUrl,
      createdAt: row.createdAt.toISOString(),
    };
  });

  // PATCH /api/v1/assets/:id — rename the library display filename (§3.1 rename).
  app.patch<{ Params: { id: string }; Body: PatchAssetBody }>(
    '/:id',
    async (request, reply) => {
      const body = request.body ?? {};
      const filename =
        typeof body.filename === 'string' ? body.filename.trim() : '';
      if (!filename) {
        return reply
          .code(400)
          .send({ error: 'BadRequest', message: 'filename is required' });
      }

      const [row] = await db
        .select()
        .from(assets)
        .where(
          and(
            eq(assets.id, request.params.id),
            eq(assets.workspaceId, request.user.userId),
          ),
        );

      if (!row) {
        return reply
          .code(404)
          .send({ error: 'NotFound', message: 'asset not found' });
      }

      await db
        .update(assets)
        .set({ filename })
        .where(eq(assets.id, request.params.id));

      // Re-resolve presigned URLs so the client gets a complete AssetRecord back.
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

      return reply.code(200).send({
        id: row.id,
        status: row.status,
        filename,
        contentType: row.contentType,
        fileSize: row.fileSize,
        durationMs: row.durationMs,
        width: row.width,
        height: row.height,
        hasOriginal: Boolean(row.s3KeyOriginal),
        proxyUrl,
        thumbnailUrl,
        waveformUrl,
        createdAt: row.createdAt.toISOString(),
      });
    },
  );

  // DELETE /api/v1/assets/:id — remove the asset row + its S3 objects (§3.1 delete).
  // The in-use warning lives client-side (it knows the live timeline); the server
  // just performs the deletion the user confirmed.
  app.delete<{ Params: { id: string } }>('/:id', async (request, reply) => {
    const [row] = await db
      .select()
      .from(assets)
      .where(
        and(
          eq(assets.id, request.params.id),
          eq(assets.workspaceId, request.user.userId),
        ),
      );

    if (!row) {
      return reply
        .code(404)
        .send({ error: 'NotFound', message: 'asset not found' });
    }

    // Best-effort S3 cleanup; the DB row is the authoritative record, so a failed
    // object delete must not block removing the asset from the library.
    const objectDeletes: Array<Promise<unknown>> = [];
    if (row.s3KeyOriginal) {
      objectDeletes.push(
        s3.send(
          new DeleteObjectCommand({
            Bucket: BUCKET_ORIGINALS,
            Key: row.s3KeyOriginal,
          }),
        ),
      );
    }
    for (const key of [row.s3KeyProxy, row.s3KeyThumbnail, row.s3KeyWaveform]) {
      if (key) {
        objectDeletes.push(
          s3.send(
            new DeleteObjectCommand({ Bucket: BUCKET_PROXIES, Key: key }),
          ),
        );
      }
    }
    await Promise.allSettled(objectDeletes);

    await db
      .delete(assets)
      .where(
        and(
          eq(assets.id, request.params.id),
          eq(assets.workspaceId, request.user.userId),
        ),
      );

    return reply.code(204).send();
  });
}
