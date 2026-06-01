// ─────────────────────────────────────────────────────────────────────────────
// S3 client + presign helpers (AWS SDK v3).
// Supports MinIO in dev (S3_ENDPOINT + S3_FORCE_PATH_STYLE=true).
// ─────────────────────────────────────────────────────────────────────────────

import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const s3Config = {
  region: process.env['S3_REGION'] ?? 'us-east-1',
  forcePathStyle: process.env['S3_FORCE_PATH_STYLE'] === 'true',
  credentials: {
    accessKeyId: process.env['S3_ACCESS_KEY_ID'] ?? 'minioadmin',
    secretAccessKey: process.env['S3_SECRET_ACCESS_KEY'] ?? 'minioadmin',
  },
  ...(process.env['S3_ENDPOINT'] ? { endpoint: process.env['S3_ENDPOINT'] } : {}),
};
export const s3 = new S3Client(s3Config);

export const BUCKET_ORIGINALS =
  process.env['S3_BUCKET_ORIGINALS'] ?? 'vf-originals';
export const BUCKET_PROXIES =
  process.env['S3_BUCKET_PROXIES'] ?? 'vf-proxies';
export const BUCKET_EXPORTS =
  process.env['S3_BUCKET_EXPORTS'] ?? 'vf-exports';

/**
 * Generate a presigned PUT URL for direct-to-S3 browser uploads.
 * @param bucket Target bucket name.
 * @param key    Object key.
 * @param expiresIn Seconds until the URL expires (default 1 hour).
 */
export async function presignPut(
  bucket: string,
  key: string,
  expiresIn = 3600,
): Promise<string> {
  return getSignedUrl(
    s3,
    new PutObjectCommand({ Bucket: bucket, Key: key }),
    { expiresIn },
  );
}

/**
 * Generate a presigned GET URL for authenticated asset delivery.
 * @param bucket Source bucket name.
 * @param key    Object key.
 * @param expiresIn Seconds until the URL expires (default 1 hour).
 */
export async function presignGet(
  bucket: string,
  key: string,
  expiresIn = 3600,
): Promise<string> {
  return getSignedUrl(
    s3,
    new GetObjectCommand({ Bucket: bucket, Key: key }),
    { expiresIn },
  );
}
