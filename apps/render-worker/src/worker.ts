// ─────────────────────────────────────────────────────────────────────────────
// @videoforge/render-worker — BullMQ "render" consumer with real FFmpeg spawn.
//
// Render path (§10.2 / Pipeline.md §3): the API enqueues a "render" job → this
// worker downloads the referenced assets from S3 → builds the command via the
// SHARED @videoforge/ffmpeg-graph package fed from the LIVE project JSON →
// spawns ffmpeg → streams progress to Redis pub/sub → uploads the output →
// publishes export:complete.
// ─────────────────────────────────────────────────────────────────────────────

import { Worker, type Job, type ConnectionOptions } from 'bullmq';
import { Redis, type RedisOptions } from 'ioredis';
import { validateProject, type Project } from '@videoforge/project-schema';
import {
  buildExportCommand,
  captionsToSrt,
  type ExportSettings,
  type BuildResult,
} from '@videoforge/ffmpeg-graph';
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
  BUCKET_EXPORTS,
} from './s3.js';

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

/** Queue name shared with the API enqueue side (§10.2). */
export const RENDER_QUEUE = 'render';

/** Path to the pinned ffmpeg binary (Pipeline.md §3). */
const FFMPEG_PATH = process.env['FFMPEG_PATH'] ?? 'ffmpeg';

/** Free-tier MVP export defaults (MP4/H.264 ≤1080p, watermark on). */
const DEFAULT_EXPORT_SETTINGS: ExportSettings = {
  format: 'mp4',
  videoCodec: 'h264',
  resolution: { w: 1080, h: 1920 },
  fps: 30,
  crf: 18,
  captions: 'none',
  watermark: true,
};

// ─────────────────────────────────────────────────────────────────────────────
// Job data / result types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Render job payload. The API places the full §18 project document inline,
 * alongside export settings, asset S3 key mappings, and workspace/export ids.
 */
export interface RenderJobData {
  exportId: string;
  projectId: string;
  workspaceId: string;
  /** §18 project JSON (from DB) — validated at job start. */
  project: unknown;
  settings?: Partial<ExportSettings>;
  /** S3 keys for each asset referenced in the project. */
  s3Keys?: {
    [assetId: string]: {
      original?: string;
      proxy?: string;
    };
  };
}

/** Result returned to BullMQ on success. */
export interface RenderJobResult {
  exportId: string;
  s3Key: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Redis connection helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Build the Redis connection BullMQ needs (REDIS_URL or host/port env). */
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

/** Separate Redis client used for Pub/Sub publishing (BullMQ owns its own connection). */
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
// Progress parsing
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Parse `time=HH:MM:SS.ss` from a FFmpeg stderr line.
 * Returns the elapsed seconds, or null if no match.
 */
function parseTimeFromFfmpegLine(line: string): number | null {
  const m = /time=(\d{2}):(\d{2}):(\d{2})\.(\d{2})/.exec(line);
  if (!m) return null;
  const [, hh, mm, ss, cs] = m;
  return (
    Number(hh) * 3600 +
    Number(mm) * 60 +
    Number(ss) +
    Number(cs) / 100
  );
}

/**
 * Derive the total project duration in seconds by scanning all clip
 * `endOnTimeline` values across every track.
 */
function projectDurationSeconds(project: Project): number {
  let maxMs = 0;
  for (const track of project.tracks) {
    if ('clips' in track) {
      for (const clip of (track as { clips: Array<{ endOnTimeline: number }> }).clips) {
        if (clip.endOnTimeline > maxMs) maxMs = clip.endOnTimeline;
      }
    }
  }
  return maxMs / 1000 || 1; // avoid division by zero
}

// ─────────────────────────────────────────────────────────────────────────────
// Asset resolution
// ─────────────────────────────────────────────────────────────────────────────

/**
 * For every `InputSpec` with kind === "clip", download the asset from S3 and
 * return a map from `assetId` to local temp file path.
 * Falls back from `original` → `proxy` with a warning.
 */
async function resolveAssets(
  buildResult: BuildResult,
  s3Keys: RenderJobData['s3Keys'],
  exportId: string,
): Promise<Map<string, string>> {
  const assetPaths = new Map<string, string>();

  for (const inp of buildResult.inputs) {
    if (inp.kind !== 'clip' || !inp.assetId) continue;
    const assetId = inp.assetId;

    if (assetPaths.has(assetId)) continue; // already resolved

    const keys = s3Keys?.[assetId];

    if (keys?.original) {
      const localPath = await downloadFromS3(BUCKET_ORIGINALS, keys.original);
      assetPaths.set(assetId, localPath);
    } else if (keys?.proxy) {
      console.warn(
        `[render-worker] export ${exportId}: asset ${assetId} original not found — using proxy`,
      );
      const localPath = await downloadFromS3(BUCKET_PROXIES, keys.proxy);
      assetPaths.set(assetId, localPath);
    } else {
      throw new Error(
        `export ${exportId}: no S3 key for asset ${assetId} — cannot render`,
      );
    }
  }

  return assetPaths;
}

/**
 * Rewrite the placeholder tokens in `args` with real local file paths:
 *   `asset:<assetId>`          → local downloaded path
 *   `watermark:vf`             → path to bundled watermark PNG (or a generated one)
 *   `subtitles:captions.srt`   → path to the written SRT file
 *
 * The `args` array has the form:
 *   ... -i asset:<id> ...
 * so we need to replace the placeholder values wherever they appear.
 */
function substituteInputPaths(
  args: string[],
  buildResult: BuildResult,
  assetPaths: Map<string, string>,
  subtitlePath: string | null,
  watermarkPath: string | null,
): string[] {
  // Build a lookup from placeholder token → real path using the InputSpec list.
  const tokenToPath = new Map<string, string>();
  for (const inp of buildResult.inputs) {
    if (inp.kind === 'clip' && inp.assetId) {
      const local = assetPaths.get(inp.assetId);
      if (local) tokenToPath.set(inp.path, local);
    } else if (inp.kind === 'subtitles' && subtitlePath) {
      tokenToPath.set(inp.path, subtitlePath);
      // Also fix the `subtitles=subtitles\:captions.srt` reference inside
      // the filter_complex string — handled via the same token replacement below.
    } else if (inp.kind === 'watermark' && watermarkPath) {
      tokenToPath.set(inp.path, watermarkPath);
    }
  }

  return args.map((arg) => tokenToPath.get(arg) ?? arg);
}

// ─────────────────────────────────────────────────────────────────────────────
// FFmpeg spawn
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Spawn FFmpeg with the given argv. Streams stderr for progress, publishes to
 * Redis. Resolves when ffmpeg exits 0; rejects on non-zero with the last stderr.
 */
async function spawnFfmpeg(
  finalArgs: string[],
  exportId: string,
  totalSeconds: number,
  redis: Redis,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(FFMPEG_PATH, finalArgs, { stdio: ['ignore', 'pipe', 'pipe'] });

    const stderrLines: string[] = [];
    const MAX_STDERR_LINES = 100;

    child.stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      const lines = text.split('\n');
      for (const line of lines) {
        if (!line.trim()) continue;
        stderrLines.push(line);
        if (stderrLines.length > MAX_STDERR_LINES) stderrLines.shift();

        const elapsed = parseTimeFromFfmpegLine(line);
        if (elapsed !== null) {
          const progress = Math.min(99, Math.round((elapsed / totalSeconds) * 100));
          const etaSeconds = elapsed > 0
            ? Math.round(((totalSeconds - elapsed) / elapsed) * (Date.now() / 1000 - Date.now() / 1000))
            : null;
          const payload = JSON.stringify({ exportId, progress, etaSeconds });
          void redis.publish('export:progress', payload);
        }
      }
    });

    // stdout is unused for video encoding — just drain it
    child.stdout.on('data', () => undefined);

    child.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        const tail = stderrLines.slice(-20).join('\n');
        reject(
          new Error(
            `ffmpeg exited with code ${String(code)} for export ${exportId}:\n${tail}`,
          ),
        );
      }
    });

    child.on('error', (err) => {
      reject(new Error(`failed to spawn ffmpeg: ${err.message}`));
    });
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Watermark helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Return the path to the watermark PNG. In production this would be the
 * bundled branding asset. For MVP we generate a 1x1 transparent PNG so
 * the FFmpeg command doesn't fail when no branding file is present.
 */
async function resolveWatermarkPath(exportId: string): Promise<string> {
  const bundled = process.env['WATERMARK_PATH'];
  if (bundled) return bundled;

  // Fallback: create a minimal 1×1 transparent PNG so FFmpeg doesn't error out.
  // Real deployments set WATERMARK_PATH to the actual branding overlay file.
  const path = join(tmpdir(), `vf-wm-${exportId}.png`);
  // Minimal valid 1×1 transparent PNG (68 bytes).
  const minimalPng = Buffer.from(
    '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c6260000000020001e221bc330000000049454e44ae426082',
    'hex',
  );
  await writeFile(path, minimalPng);
  return path;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main job processor
// ─────────────────────────────────────────────────────────────────────────────

/** Process a single "render" job end-to-end. */
export async function processRenderJob(
  job: Job<RenderJobData>,
): Promise<RenderJobResult> {
  const { exportId } = job.data;
  const redis = getPubRedis();
  const tempFiles: string[] = [];

  try {
    // 1. Validate the §18 project document.
    const validationResult = validateProject(job.data.project);
    if (!validationResult.ok) {
      throw new Error(
        `export ${exportId}: project failed §18 validation (${validationResult.errors.length} issue(s))`,
      );
    }
    const project: Project = validationResult.value;

    // 2. Build the FFmpeg argv via the SHARED invariant package.
    const settings: ExportSettings = {
      ...DEFAULT_EXPORT_SETTINGS,
      ...(job.data.settings ?? {}),
    };
    const buildResult: BuildResult = buildExportCommand(project, settings);

    // 3. Resolve asset S3 keys → local temp paths.
    const assetPaths = await resolveAssets(buildResult, job.data.s3Keys, exportId);
    for (const p of assetPaths.values()) tempFiles.push(p);

    // 4a. If captions burn is requested, write the SRT file.
    let subtitlePath: string | null = null;
    if (settings.captions === 'burn' && project.captionTracks.length > 0) {
      const firstTrack = project.captionTracks[0];
      if (firstTrack) {
        subtitlePath = join(tmpdir(), `vf-captions-${exportId}.srt`);
        await writeFile(subtitlePath, captionsToSrt(firstTrack));
        tempFiles.push(subtitlePath);
      }
    }

    // 4b. Resolve watermark path (only needed when the graph includes a watermark input).
    let watermarkPath: string | null = null;
    const hasWatermarkInput = buildResult.inputs.some((inp) => inp.kind === 'watermark');
    if (hasWatermarkInput) {
      watermarkPath = await resolveWatermarkPath(exportId);
      tempFiles.push(watermarkPath);
    }

    // 5. Substitute placeholder tokens with real local paths.
    const resolvedArgs = substituteInputPaths(
      buildResult.args,
      buildResult,
      assetPaths,
      subtitlePath,
      watermarkPath,
    );

    // 6. Replace the placeholder output filename "out.mp4" with an absolute temp path.
    const outputPath = join(tmpdir(), `vf-export-${exportId}.mp4`);
    tempFiles.push(outputPath);
    const finalArgs = resolvedArgs.map((arg) => (arg === 'out.mp4' ? outputPath : arg));

    console.info(
      `[render-worker] export ${exportId} — spawning: ${FFMPEG_PATH} ${finalArgs.slice(0, 8).join(' ')} ...`,
    );

    // 7. Compute total duration for progress calculation.
    const totalSeconds = projectDurationSeconds(project);

    // 8. Spawn FFmpeg and wait for completion.
    await spawnFfmpeg(finalArgs, exportId, totalSeconds, redis);

    // 9. Upload the output to S3.
    const s3Key = `exports/${exportId}.mp4`;
    await uploadToS3(outputPath, BUCKET_EXPORTS, s3Key);

    // 10. Publish export:complete.
    await redis.publish(
      'export:complete',
      JSON.stringify({ exportId, s3Key }),
    );

    console.info(`[render-worker] export ${exportId} complete → s3://${BUCKET_EXPORTS}/${s3Key}`);
    return { exportId, s3Key };
  } finally {
    // 11. Clean up all temp files regardless of success/failure.
    await Promise.allSettled(tempFiles.map((p) => cleanupFile(p)));
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Worker factory
// ─────────────────────────────────────────────────────────────────────────────

/** Construct (but do not implicitly start beyond BullMQ's own listener) the Worker. */
export function createRenderWorker(): Worker<RenderJobData, RenderJobResult> {
  const concurrency = Number.parseInt(process.env['RENDER_CONCURRENCY'] ?? '1', 10);

  const worker = new Worker<RenderJobData, RenderJobResult>(RENDER_QUEUE, processRenderJob, {
    connection: redisConnection() as unknown as ConnectionOptions,
    concurrency: Number.isFinite(concurrency) && concurrency > 0 ? concurrency : 1,
  });

  worker.on('ready', () => {
    console.info(`[render-worker] connected; listening on "${RENDER_QUEUE}" queue`);
  });
  worker.on('active', (job) => {
    console.info(`[render-worker] job ${job.id} active (export ${job.data.exportId})`);
  });
  worker.on('completed', (job) => {
    console.info(`[render-worker] job ${job.id} completed (export ${job.data.exportId})`);
  });
  worker.on('failed', (job, err) => {
    console.error(`[render-worker] job ${job?.id ?? '?'} failed: ${err.message}`);
  });
  worker.on('error', (err) => {
    console.error(`[render-worker] worker error: ${err.message}`);
  });

  return worker;
}
