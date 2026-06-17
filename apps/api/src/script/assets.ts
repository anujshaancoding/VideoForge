// ─────────────────────────────────────────────────────────────────────────────
// Script Studio v2 — register a local file as a media asset via the EXISTING
// originals-bucket + media-job pipeline (Contract C #3).
//
// This is the seam that makes a synthesized VO WAV (or a bundled CC0 music WAV)
// INDISTINGUISHABLE from an uploaded MP3: we mint an asset row (same `assets`
// table, same status machine), PUT the file straight into the originals bucket
// under the same `${assetId}/original<ext>` key the presign flow uses, flip to
// PROCESSING, and enqueue the SAME `media` BullMQ job. The media worker then makes
// the proxy/waveform and publishes `asset:ready`, which the API subscriber persists
// → the asset becomes READY exactly like any upload. Zero new asset/render code.
// ─────────────────────────────────────────────────────────────────────────────

import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { extname, basename } from 'node:path';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { s3, BUCKET_ORIGINALS } from '../s3.js';
import { db } from '../db/client.js';
import { assets } from '../db/schema.js';
import { mediaQueue, type MediaJobData } from '../queues.js';

function contentTypeFor(ext: string): string {
  switch (ext.toLowerCase()) {
    case '.wav':
      return 'audio/wav';
    case '.mp3':
      return 'audio/mpeg';
    case '.m4a':
      return 'audio/mp4';
    // Image types — generated sketch frames register exactly like an uploaded photo
    // (contentType image/* ⇒ arrange treats them as photo b-roll spanning the scene).
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.webp':
      return 'image/webp';
    default:
      return 'application/octet-stream';
  }
}

export interface RegisteredAsset {
  assetId: string;
  filename: string;
}

/**
 * Upload a local file to the originals bucket, insert its `assets` row (PROCESSING),
 * and enqueue the existing `media` job. Returns the new assetId. The asset reaches
 * READY asynchronously via the normal media-worker → asset:ready → API-subscriber
 * path — identical to an uploaded file.
 *
 * @param localPath  Absolute path to the file on disk (a synth WAV, or a bundled bed).
 * @param workspaceId The owning workspace (== authenticated userId).
 * @param displayName Library display filename.
 */
export async function registerLocalFileAsAsset(
  localPath: string,
  workspaceId: string,
  displayName: string,
): Promise<RegisteredAsset> {
  const data = await readFile(localPath);
  const ext = extname(localPath) || '.wav';
  const contentType = contentTypeFor(ext);
  const assetId = randomUUID();
  const s3KeyOriginal = `${assetId}/original${ext}`;
  const filename = displayName || basename(localPath);

  // 1. PUT the bytes into the originals bucket (same key shape as presign).
  await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET_ORIGINALS,
      Key: s3KeyOriginal,
      Body: data,
      ContentType: contentType,
    }),
  );

  // 2. Insert the asset row straight into PROCESSING (it already has its original).
  await db.insert(assets).values({
    id: assetId,
    workspaceId,
    filename,
    contentType,
    fileSize: data.byteLength,
    md5Hash: null,
    status: 'PROCESSING',
    s3KeyOriginal,
  });

  // 3. Enqueue the SAME media job an upload-confirm enqueues.
  const jobData: MediaJobData = {
    assetId,
    workspaceId,
    s3KeyOriginal,
    contentType,
  };
  await mediaQueue.add('process', jobData);

  return { assetId, filename };
}
