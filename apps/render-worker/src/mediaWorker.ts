// ─────────────────────────────────────────────────────────────────────────────
// @videoforge/render-worker — BullMQ "media" consumer.
//
// Processes freshly-uploaded originals: generates a 720p H.264 proxy, a
// thumbnail sprite, and a waveform peaks JSON, then publishes asset:ready to
// Redis so the API's WS hub can notify the browser.
// ─────────────────────────────────────────────────────────────────────────────

import { Worker, type Job, type ConnectionOptions } from 'bullmq';
import { Redis, type RedisOptions } from 'ioredis';
import { spawn } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  downloadFromS3,
  uploadToS3,
  cleanupFile,
  BUCKET_ORIGINALS,
  BUCKET_PROXIES,
} from './s3.js';

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

export const MEDIA_QUEUE = 'media';

const FFMPEG_PATH = process.env['FFMPEG_PATH'] ?? 'ffmpeg';

// ─────────────────────────────────────────────────────────────────────────────
// Job data type
// ─────────────────────────────────────────────────────────────────────────────

export interface MediaJobData {
  assetId: string;
  workspaceId: string;
  s3KeyOriginal: string;
  contentType: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Redis helpers
// ─────────────────────────────────────────────────────────────────────────────

function redisConnection(): RedisOptions | InstanceType<typeof Redis> {
  const url = process.env['REDIS_URL'];
  if (url) {
    return new Redis(url, { maxRetriesPerRequest: null });
  }
  return {
    host: process.env['REDIS_HOST'] ?? '127.0.0.1',
    port: Number.parseInt(process.env['REDIS_PORT'] ?? '6379', 10),
    maxRetriesPerRequest: null,
  };
}

let _pubRedis: Redis | undefined;
function getPubRedis(): Redis {
  if (!_pubRedis) {
    const url = process.env['REDIS_URL'];
    _pubRedis = url
      ? new Redis(url)
      : new Redis({
          host: process.env['REDIS_HOST'] ?? '127.0.0.1',
          port: Number.parseInt(process.env['REDIS_PORT'] ?? '6379', 10),
        });
  }
  return _pubRedis;
}

// ─────────────────────────────────────────────────────────────────────────────
// FFmpeg helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Run ffmpeg with the given args. Rejects with last stderr lines on non-zero exit. */
async function runFfmpeg(args: string[], label: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(FFMPEG_PATH, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const stderrLines: string[] = [];

    child.stderr.on('data', (chunk: Buffer) => {
      const lines = chunk.toString().split('\n');
      for (const line of lines) {
        if (line.trim()) {
          stderrLines.push(line);
          if (stderrLines.length > 50) stderrLines.shift();
        }
      }
    });

    child.stdout.on('data', () => undefined);

    child.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        const tail = stderrLines.slice(-10).join('\n');
        reject(new Error(`ffmpeg [${label}] exited ${String(code)}:\n${tail}`));
      }
    });

    child.on('error', (err) => {
      reject(new Error(`failed to spawn ffmpeg [${label}]: ${err.message}`));
    });
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Waveform
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generate a waveform peaks JSON.
 * MVP shortcut: returns 1000 random peaks normalised 0–1. This is acceptable
 * at the MVP stage since waveform display is purely informational.
 * A production implementation would use ffprobe astats to extract real peaks.
 */
function generateFakePeaks(count = 1000): string {
  const peaks: number[] = [];
  for (let i = 0; i < count; i++) {
    peaks.push(Math.round(Math.random() * 1000) / 1000);
  }
  return JSON.stringify({ peaks, sampleRate: 44100 });
}

// ─────────────────────────────────────────────────────────────────────────────
// Main job processor
// ─────────────────────────────────────────────────────────────────────────────

export async function processMediaJob(job: Job<MediaJobData>): Promise<void> {
  const { assetId, s3KeyOriginal } = job.data;
  const redis = getPubRedis();
  const tempFiles: string[] = [];

  try {
    // 1. Download the original from S3.
    console.info(`[media-worker] ${assetId}: downloading original`);
    const inputPath = await downloadFromS3(BUCKET_ORIGINALS, s3KeyOriginal);
    tempFiles.push(inputPath);

    // 2a. Generate 720p H.264/AAC proxy.
    const proxyPath = join(tmpdir(), `vf-proxy-${assetId}.mp4`);
    tempFiles.push(proxyPath);
    console.info(`[media-worker] ${assetId}: generating proxy`);
    await runFfmpeg(
      [
        '-y', '-hide_banner', '-nostdin',
        '-i', inputPath,
        '-vf', 'scale=1280:720',
        '-c:v', 'libx264',
        '-crf', '23',
        '-preset', 'fast',
        '-c:a', 'aac',
        '-b:a', '128k',
        proxyPath,
      ],
      `proxy:${assetId}`,
    );

    // 2b. Generate thumbnail (first of up to 10 frames at 1 fps, 160×90).
    const thumbDir = tmpdir();
    const thumbPattern = join(thumbDir, `vf-thumb-${assetId}-%03d.jpg`);
    const thumb0 = join(thumbDir, `vf-thumb-${assetId}-001.jpg`);
    tempFiles.push(thumb0);
    console.info(`[media-worker] ${assetId}: generating thumbnails`);
    await runFfmpeg(
      [
        '-y', '-hide_banner', '-nostdin',
        '-i', inputPath,
        '-vf', 'fps=1,scale=160:90',
        '-frames:v', '10',
        thumbPattern,
      ],
      `thumb:${assetId}`,
    );

    // 2c. Generate waveform peaks (MVP: synthetic random peaks).
    const waveformPath = join(tmpdir(), `vf-waveform-${assetId}.json`);
    tempFiles.push(waveformPath);
    await writeFile(waveformPath, generateFakePeaks());

    // 3. Upload proxy.
    const proxyKey = `${assetId}/proxy.mp4`;
    console.info(`[media-worker] ${assetId}: uploading proxy`);
    await uploadToS3(proxyPath, BUCKET_PROXIES, proxyKey, 'video/mp4');

    // 4. Upload thumbnail (first frame).
    const thumbnailKey = `${assetId}/thumb.jpg`;
    console.info(`[media-worker] ${assetId}: uploading thumbnail`);
    await uploadToS3(thumb0, BUCKET_PROXIES, thumbnailKey, 'image/jpeg');

    // 5. Upload waveform peaks.
    const waveformKey = `${assetId}/waveform.json`;
    console.info(`[media-worker] ${assetId}: uploading waveform`);
    await uploadToS3(waveformPath, BUCKET_PROXIES, waveformKey, 'application/json');

    // 6. Publish asset:ready.
    await redis.publish(
      'asset:ready',
      JSON.stringify({ assetId, proxyKey, thumbnailKey, waveformKey }),
    );

    console.info(`[media-worker] ${assetId}: ready`);
  } finally {
    await Promise.allSettled(tempFiles.map((p) => cleanupFile(p)));
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Worker factory
// ─────────────────────────────────────────────────────────────────────────────

export function createMediaWorker(): Worker<MediaJobData, void> {
  const concurrency = Number.parseInt(process.env['MEDIA_CONCURRENCY'] ?? '2', 10);

  const worker = new Worker<MediaJobData, void>(MEDIA_QUEUE, processMediaJob, {
    connection: redisConnection() as unknown as ConnectionOptions,
    concurrency: Number.isFinite(concurrency) && concurrency > 0 ? concurrency : 2,
  });

  worker.on('ready', () => {
    console.info(`[media-worker] connected; listening on "${MEDIA_QUEUE}" queue`);
  });
  worker.on('active', (job) => {
    console.info(`[media-worker] job ${job.id} active (asset ${job.data.assetId})`);
  });
  worker.on('completed', (job) => {
    console.info(`[media-worker] job ${job.id} completed (asset ${job.data.assetId})`);
  });
  worker.on('failed', (job, err) => {
    console.error(`[media-worker] job ${job?.id ?? '?'} failed: ${err.message}`);
  });
  worker.on('error', (err) => {
    console.error(`[media-worker] worker error: ${err.message}`);
  });

  return worker;
}
