#!/usr/bin/env tsx
import { S3Client, PutObjectCommand, CreateBucketCommand, HeadBucketCommand } from '@aws-sdk/client-s3';
import { createReadStream, existsSync } from 'node:fs';
import { join } from 'node:path';
import manifest from '../../fixtures/manifest.json' assert { type: 'json' };

const s3 = new S3Client({
  region: 'us-east-1',
  endpoint: process.env.S3_ENDPOINT ?? 'http://localhost:9000',
  forcePathStyle: true,
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY_ID ?? 'minioadmin',
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? 'minioadmin',
  },
});

const BUCKETS = [
  process.env.S3_BUCKET_ORIGINALS ?? 'vf-originals',
  process.env.S3_BUCKET_PROXIES ?? 'vf-proxies',
  process.env.S3_BUCKET_EXPORTS ?? 'vf-exports',
];

async function ensureBucket(bucket: string) {
  try { await s3.send(new HeadBucketCommand({ Bucket: bucket })); }
  catch { await s3.send(new CreateBucketCommand({ Bucket: bucket })); }
}

async function seed() {
  for (const bucket of BUCKETS) await ensureBucket(bucket);

  const mediaDir = join(process.cwd(), 'fixtures/media');
  const originBucket = process.env.S3_BUCKET_ORIGINALS ?? 'vf-originals';

  for (const fixture of manifest.fixtures) {
    const localPath = join(mediaDir, fixture.filename);
    if (!existsSync(localPath)) {
      console.warn(`Fixture file missing: ${localPath} — run scripts/generate-fixtures.ts first`);
      continue;
    }
    await s3.send(new PutObjectCommand({
      Bucket: originBucket,
      Key: fixture.s3Key,
      Body: createReadStream(localPath),
      ContentType: fixture.contentType,
    }));
    console.log(`Uploaded ${fixture.s3Key}`);
  }
  console.log('MinIO seeded.');
}

seed().catch(console.error);
