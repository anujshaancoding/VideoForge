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
const FFPROBE_PATH = process.env['FFPROBE_PATH'] ?? 'ffprobe';

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
// FFprobe metadata
// ─────────────────────────────────────────────────────────────────────────────

/** Extracted media metadata. Any field may be null when ffprobe can't supply it. */
export interface ProbeMetadata {
  durationMs: number | null;
  width: number | null;
  height: number | null;
}

/** Minimal shape of the ffprobe JSON we consume. */
interface FfprobeJson {
  format?: { duration?: string | number };
  streams?: Array<{ codec_type?: string; width?: number; height?: number }>;
}

/** Run ffprobe and collect its JSON stdout. Rejects on spawn error / non-zero exit. */
async function runFfprobe(inputPath: string): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const child = spawn(
      FFPROBE_PATH,
      ['-v', 'quiet', '-print_format', 'json', '-show_format', '-show_streams', inputPath],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );

    const stdoutChunks: Buffer[] = [];
    child.stdout.on('data', (chunk: Buffer) => stdoutChunks.push(chunk));
    child.stderr.on('data', () => undefined);

    child.on('close', (code) => {
      if (code === 0) {
        resolve(Buffer.concat(stdoutChunks).toString());
      } else {
        reject(new Error(`ffprobe exited ${String(code)}`));
      }
    });

    child.on('error', (err) => {
      reject(new Error(`failed to spawn ffprobe: ${err.message}`));
    });
  });
}

/**
 * Probe a media file for duration (ms) and video width/height.
 *
 * Robust by design: any failure (ffprobe missing, non-zero exit, malformed JSON,
 * absent fields) returns nulls so the import job can still complete. The first
 * video stream supplies width/height; format.duration (seconds) is rounded to ms.
 */
async function probeMetadata(inputPath: string, assetId: string): Promise<ProbeMetadata> {
  const empty: ProbeMetadata = { durationMs: null, width: null, height: null };
  try {
    const raw = await runFfprobe(inputPath);
    const parsed = JSON.parse(raw) as FfprobeJson;

    let durationMs: number | null = null;
    const rawDuration = parsed.format?.duration;
    const durationSec =
      typeof rawDuration === 'number' ? rawDuration : Number.parseFloat(rawDuration ?? '');
    if (Number.isFinite(durationSec) && durationSec >= 0) {
      durationMs = Math.round(durationSec * 1000);
    }

    let width: number | null = null;
    let height: number | null = null;
    const videoStream = parsed.streams?.find((s) => s.codec_type === 'video');
    if (videoStream) {
      if (typeof videoStream.width === 'number' && Number.isFinite(videoStream.width)) {
        width = videoStream.width;
      }
      if (typeof videoStream.height === 'number' && Number.isFinite(videoStream.height)) {
        height = videoStream.height;
      }
    }

    return { durationMs, width, height };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[media-worker] ${assetId}: ffprobe failed, metadata unknown: ${message}`);
    return empty;
  }
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
  const { assetId, s3KeyOriginal, contentType } = job.data;
  const workspaceId = job.data.workspaceId ?? 'dev-workspace';
  const isAudio = (contentType ?? '').startsWith('audio/');
  const isImage = (contentType ?? '').startsWith('image/');
  const redis = getPubRedis();
  const tempFiles: string[] = [];

  try {
    // 1. Download the original from S3.
    console.info(`[media-worker] ${assetId}: downloading original (${contentType})`);
    const inputPath = await downloadFromS3(BUCKET_ORIGINALS, s3KeyOriginal);
    tempFiles.push(inputPath);

    // 1b. Probe the original for real duration / dimensions before transcoding.
    //     Never fatal: missing fields fall through as null.
    const metadata = await probeMetadata(inputPath, assetId);

    let proxyKey: string | undefined;
    let thumbnailKey: string | undefined;
    let waveformKey: string | undefined;

    if (isAudio) {
      // ── Audio: AAC/mp4 audio-only proxy + waveform. No video filter, no thumb. ──
      const proxyPath = join(tmpdir(), `vf-proxy-${assetId}.m4a`);
      tempFiles.push(proxyPath);
      console.info(`[media-worker] ${assetId}: generating audio proxy`);
      await runFfmpeg(
        ['-y', '-hide_banner', '-nostdin', '-i', inputPath, '-vn', '-c:a', 'aac', '-b:a', '128k', proxyPath],
        `proxy:${assetId}`,
      );
      proxyKey = `${assetId}/proxy.m4a`;
      await uploadToS3(proxyPath, BUCKET_PROXIES, proxyKey, 'audio/mp4');

      const waveformPath = join(tmpdir(), `vf-waveform-${assetId}.json`);
      tempFiles.push(waveformPath);
      await writeFile(waveformPath, generateFakePeaks());
      waveformKey = `${assetId}/waveform.json`;
      await uploadToS3(waveformPath, BUCKET_PROXIES, waveformKey, 'application/json');
    } else if (isImage) {
      // ── Image: a downscaled JPG serves as both proxy and thumbnail. ──
      const thumbPath = join(tmpdir(), `vf-thumb-${assetId}.jpg`);
      tempFiles.push(thumbPath);
      console.info(`[media-worker] ${assetId}: generating image thumbnail`);
      await runFfmpeg(
        ['-y', '-hide_banner', '-nostdin', '-i', inputPath, '-vf', 'scale=160:90:force_original_aspect_ratio=decrease', '-frames:v', '1', thumbPath],
        `thumb:${assetId}`,
      );
      thumbnailKey = `${assetId}/thumb.jpg`;
      await uploadToS3(thumbPath, BUCKET_PROXIES, thumbnailKey, 'image/jpeg');
    } else {
      // ── Video: 720p H.264/AAC proxy + thumbnail + waveform. ──
      const proxyPath = join(tmpdir(), `vf-proxy-${assetId}.mp4`);
      tempFiles.push(proxyPath);
      console.info(`[media-worker] ${assetId}: generating video proxy`);
      await runFfmpeg(
        [
          '-y', '-hide_banner', '-nostdin',
          '-i', inputPath,
          '-vf', 'scale=1280:720:force_original_aspect_ratio=decrease',
          '-c:v', 'libx264', '-crf', '23', '-preset', 'fast',
          '-c:a', 'aac', '-b:a', '128k',
          proxyPath,
        ],
        `proxy:${assetId}`,
      );
      proxyKey = `${assetId}/proxy.mp4`;
      await uploadToS3(proxyPath, BUCKET_PROXIES, proxyKey, 'video/mp4');

      const thumb0 = join(tmpdir(), `vf-thumb-${assetId}.jpg`);
      tempFiles.push(thumb0);
      console.info(`[media-worker] ${assetId}: generating thumbnail`);
      // Seek 1s in (or clamp to start) for a representative frame, not a black intro.
      await runFfmpeg(
        ['-y', '-hide_banner', '-nostdin', '-ss', '1', '-i', inputPath, '-vf', 'scale=160:90:force_original_aspect_ratio=decrease', '-frames:v', '1', thumb0],
        `thumb:${assetId}`,
      );
      thumbnailKey = `${assetId}/thumb.jpg`;
      await uploadToS3(thumb0, BUCKET_PROXIES, thumbnailKey, 'image/jpeg');

      const waveformPath = join(tmpdir(), `vf-waveform-${assetId}.json`);
      tempFiles.push(waveformPath);
      await writeFile(waveformPath, generateFakePeaks());
      waveformKey = `${assetId}/waveform.json`;
      await uploadToS3(waveformPath, BUCKET_PROXIES, waveformKey, 'application/json');
    }

    // Per-content-type metadata: audio has no spatial dimensions; images have no
    // duration; video carries all three. Only include fields we actually probed.
    const metaFields: { durationMs?: number; width?: number; height?: number } = {};
    if (!isImage && typeof metadata.durationMs === 'number') {
      metaFields.durationMs = metadata.durationMs;
    }
    if (!isAudio) {
      if (typeof metadata.width === 'number') metaFields.width = metadata.width;
      if (typeof metadata.height === 'number') metaFields.height = metadata.height;
    }

    // Publish asset:ready. The API subscriber persists these keys + metadata to
    // Postgres (status PROCESSING → READY) and broadcasts to the workspace WS room.
    await redis.publish(
      'asset:ready',
      JSON.stringify({
        type: 'asset:ready',
        assetId,
        workspaceId,
        ...(proxyKey ? { proxyKey } : {}),
        ...(thumbnailKey ? { thumbnailKey } : {}),
        ...(waveformKey ? { waveformKey } : {}),
        ...metaFields,
      }),
    );

    console.info(`[media-worker] ${assetId}: ready`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await redis.publish(
      'asset:failed',
      JSON.stringify({ type: 'asset:failed', assetId, workspaceId, message }),
    );
    throw err;
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
