// ─────────────────────────────────────────────────────────────────────────────
// BullMQ queue producers.
// `media`  — proxy/waveform/thumbnail generation for uploaded assets.
// `render` — FFmpeg export jobs driven by apps/render-worker.
// ─────────────────────────────────────────────────────────────────────────────

import { Queue } from 'bullmq';
import { Redis } from 'ioredis';

function redisConnection(): Redis {
  const url = process.env['REDIS_URL'];
  if (url) {
    return new Redis(url, { maxRetriesPerRequest: null });
  }
  return new Redis({
    host: process.env['REDIS_HOST'] ?? '127.0.0.1',
    port: Number(process.env['REDIS_PORT'] ?? 6379),
    maxRetriesPerRequest: null,
  });
}

export const redisClient: Redis = redisConnection();

export const mediaQueue = new Queue('media', {
  connection: redisClient as unknown as never,
});
export const renderQueue = new Queue('render', {
  connection: redisClient as unknown as never,
});

// ── Job data shapes ──────────────────────────────────────────────────────────

export interface MediaJobData {
  assetId: string;
  workspaceId: string;
  s3KeyOriginal: string;
  contentType: string;
  durationMs?: number;
}

export interface RenderJobData {
  exportId: string;
  projectId: string;
  workspaceId: string;
  settings: Record<string, unknown>;
}
