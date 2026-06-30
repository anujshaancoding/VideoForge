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
// Script Studio v2 — bounded async path for LONG scripts (Contract C #3). Short
// scripts (≤ ~8 scenes) run inline in the route; longer ones enqueue here and a
// single-concurrency `script` worker (apps/api/src/script/worker.ts) runs the SAME
// orchestration off the request thread, emitting `script:progress`/`script:complete`.
export const scriptQueue = new Queue('script', {
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

export interface ScriptJobData {
  /** The owning workspace (== authenticated userId). */
  workspaceId: string;
  /** Project title. */
  title: string;
  /** The reviewed/edited scene plan (Contract A). */
  plan: unknown;
  /** Caller-supplied voice id. */
  voiceId: string;
  /** Whether to attach a bundled CC0 music bed. */
  withMusic: boolean;
  /** Scene-image style: 'pen'|'graphite'|'color' (AI sketch) | 'photo' (real web
   *  image) | null (text-card video). Validated by isIllustrationStyle in the worker. */
  sketchStyle?: string | null;
}

export interface RenderJobData {
  exportId: string;
  projectId: string;
  workspaceId: string;
  /** The full §18 project document — the worker validates + renders this. */
  project: unknown;
  settings: Record<string, unknown>;
  /** S3 keys for every asset referenced by the project (assetId → keys). */
  s3Keys: {
    [assetId: string]: {
      original?: string;
      proxy?: string;
    };
  };
}
