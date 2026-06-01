// ─────────────────────────────────────────────────────────────────────────────
// @videoforge/render-worker — S3 helpers (download, upload, cleanup).
//
// All bucket names and connection details are configured via environment
// variables so the same binary works against MinIO locally and real AWS S3 in
// production.
// ─────────────────────────────────────────────────────────────────────────────

import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Upload } from '@aws-sdk/lib-storage';
import { createReadStream, createWriteStream } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { unlink } from 'node:fs/promises';

const _endpoint = process.env['S3_ENDPOINT'];
export const s3 = new S3Client({
  region: process.env['S3_REGION'] ?? 'us-east-1',
  ...(_endpoint ? { endpoint: _endpoint } : {}),
  forcePathStyle: process.env['S3_FORCE_PATH_STYLE'] === 'true',
  credentials: {
    accessKeyId: process.env['S3_ACCESS_KEY_ID'] ?? 'minioadmin',
    secretAccessKey: process.env['S3_SECRET_ACCESS_KEY'] ?? 'minioadmin',
  },
});

export const BUCKET_ORIGINALS = process.env['S3_BUCKET_ORIGINALS'] ?? 'vf-originals';
export const BUCKET_PROXIES = process.env['S3_BUCKET_PROXIES'] ?? 'vf-proxies';
export const BUCKET_EXPORTS = process.env['S3_BUCKET_EXPORTS'] ?? 'vf-exports';

/** Download an S3 object to a local temp file. Returns the local path. */
export async function downloadFromS3(bucket: string, key: string): Promise<string> {
  const cmd = new GetObjectCommand({ Bucket: bucket, Key: key });
  const resp = await s3.send(cmd);
  const localPath = join(tmpdir(), `vf-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const body = resp.Body as Readable;
  await pipeline(body, createWriteStream(localPath));
  return localPath;
}

/** Upload a local file to S3. */
export async function uploadToS3(
  localPath: string,
  bucket: string,
  key: string,
  contentType = 'video/mp4',
): Promise<void> {
  const upload = new Upload({
    client: s3,
    params: {
      Bucket: bucket,
      Key: key,
      Body: createReadStream(localPath),
      ContentType: contentType,
    },
  });
  await upload.done();
}

/** Generate a pre-signed GET URL for a given S3 object (expires in 1 h by default). */
export async function presignGetUrl(
  bucket: string,
  key: string,
  expiresIn = 3600,
): Promise<string> {
  const cmd = new GetObjectCommand({ Bucket: bucket, Key: key });
  return getSignedUrl(s3, cmd, { expiresIn });
}

/** Best-effort delete a local file — never throws. */
export async function cleanupFile(path: string): Promise<void> {
  try {
    await unlink(path);
  } catch {
    // intentionally ignored — temp-file cleanup failures are non-fatal
  }
}
