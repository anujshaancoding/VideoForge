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
import { validateProject, type Project, type CaptionTrack } from '@videoforge/project-schema';
import {
  buildExportCommand,
  captionsToSrt,
  projectDurationMs,
  type ExportSettings,
  type BuildResult,
} from '@videoforge/ffmpeg-graph';
import { spawn, execFile } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
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

/**
 * Directory holding the bundled Inter static TTFs the text-overlay `drawtext` stage
 * resolves `font:` tokens against (Text_Overlay_Export_Spec.md §4.3). The Dockerfile
 * downloads the pinned Inter release here and sets this env; the default matches it so
 * a locally-installed Inter at that path also works.
 */
const INTER_FONT_DIR = process.env['INTER_FONT_DIR'] ?? '/usr/share/fonts/inter';

/** Free-tier MVP export defaults (MP4/H.264 ≤1080p, watermark-FREE, CEO 2026-06-14). */
const DEFAULT_EXPORT_SETTINGS: ExportSettings = {
  format: 'mp4',
  videoCodec: 'h264',
  resolution: { w: 1080, h: 1920 },
  fps: 30,
  crf: 18,
  captions: 'none',
  watermark: false,
};

// ─────────────────────────────────────────────────────────────────────────────
// Job data / result types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Render job payload. The API places the full §18 project document inline,
 * alongside export settings, asset S3 key mappings, and workspace/export ids.
 *
 * Document SOURCE (Templates wave contract, agreed w/ Core/Pixel): the worker
 * renders the document the API put on the job — there is no DB fetch here. The
 * API resolves WHICH §18 document to render (a client-supplied render-snapshot
 * pruned of unfilled template slots, OR the stored project) and inlines it. To
 * keep that contract explicit and forward-compatible, the worker accepts the doc
 * under either field and prefers an explicit `document` snapshot when present,
 * falling back to `project` (the field the API currently sets — see
 * apps/api/src/queues.ts `RenderJobData.project`). Either way the SAME doc flows
 * through buildExportCommand unchanged, so the export-parity invariant holds:
 * we render EXACTLY the document the API provided.
 */
export interface RenderJobData {
  exportId: string;
  projectId: string;
  workspaceId: string;
  /**
   * Optional explicit §18 render-snapshot. When the API attaches this (the
   * previewed, pruned-of-unfilled-slots document), the worker renders THIS exact
   * document. Takes precedence over `project`.
   */
  document?: unknown;
  /** §18 project JSON the API inlined (snapshot or stored doc) — validated at job start. */
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
 * Total project duration in seconds for the progress bar. Delegates to the graph
 * package's `projectDurationMs` — the SINGLE source of truth that also bounds the
 * export (`-t` cap + base `:d=`), so the progress total can never drift from the
 * actual encoded length. Empty timelines resolve to the documented 1s floor there.
 */
function projectDurationSeconds(project: Project): number {
  return projectDurationMs(project) / 1000;
}

// ─────────────────────────────────────────────────────────────────────────────
// Document source selection
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Pick the §18 document the worker renders from the job payload. Prefer an
 * explicit `document` render-snapshot (the previewed, pruned-of-unfilled-slots
 * doc the client supplied) when present; otherwise fall back to `project` (the
 * field the API currently inlines). The worker never fetches by id — the API
 * resolves WHICH document to render and inlines it. Exported + pure so the
 * source-selection contract is unit-testable without FFmpeg/Redis/S3.
 */
export function selectRenderDocument(
  data: Pick<RenderJobData, 'document' | 'project'>,
): unknown {
  return data.document !== undefined && data.document !== null
    ? data.document
    : data.project;
}

// ─────────────────────────────────────────────────────────────────────────────
// Sidecar captions (.srt / .vtt)
// ─────────────────────────────────────────────────────────────────────────────

/** Chosen sidecar caption format ('.srt' | '.vtt'). Defaults to '.srt'. */
export type SidecarFmt = '.srt' | '.vtt';

/**
 * Serialise a caption track into a WebVTT document. Derived from the shared SRT
 * serializer (`captionsToSrt`, the single source of caption ordering/text) so the
 * two formats can never drift: we reuse its body and only swap the `WEBVTT` header
 * + the `HH:MM:SS,mmm` → `HH:MM:SS.mmm` timestamp separator VTT requires. Kept here
 * (not in ffmpeg-graph/project-schema — those are the parity surfaces we must not
 * touch); pure + exported for unit testing.
 */
export function captionsToVtt(track: CaptionTrack): string {
  // captionsToSrt yields numbered cues `n\nHH:MM:SS,mmm --> HH:MM:SS,mmm\ntext`.
  // VTT drops the cue numbers' requirement (they're optional) and uses '.' for the
  // millisecond separator on the timing line only.
  const body = captionsToSrt(track).replace(
    /(\d{2}:\d{2}:\d{2}),(\d{3})(\s*-->\s*)(\d{2}:\d{2}:\d{2}),(\d{3})/g,
    '$1.$2$3$4.$5',
  );
  return `WEBVTT\n\n${body}`;
}

/**
 * Resolve the sidecar caption format from the raw job settings. The web client puts
 * the chosen `.srt`/`.vtt` under `settings.sidecarFmt`; anything else (absent, bad)
 * falls back to `.srt`. Kept tolerant because `sidecarFmt` is NOT part of the typed
 * `ExportSettings` (the parity surface) — it rides as an extra settings key.
 */
export function resolveSidecarFmt(settings: Record<string, unknown> | undefined): SidecarFmt {
  return settings?.['sidecarFmt'] === '.vtt' ? '.vtt' : '.srt';
}

/** Serialise the first caption track to the chosen sidecar format. */
export function buildSidecar(track: CaptionTrack, fmt: SidecarFmt): string {
  return fmt === '.vtt' ? captionsToVtt(track) : captionsToSrt(track);
}

// ─────────────────────────────────────────────────────────────────────────────
// Asset resolution
// ─────────────────────────────────────────────────────────────────────────────

/**
 * For every `InputSpec` with kind === "clip", download the asset from S3 and
 * return a map from `assetId` to local temp file path.
 * Falls back from `original` → `proxy` with a warning.
 *
 * Exported for the export-parity gate (#8 golden-adjacent test): when BOTH keys
 * exist we MUST fetch the ORIGINAL (the proxy is a degraded 720p preview rendition,
 * §16.3 — using it would silently break "what you cut is what you get").
 */
export async function resolveAssets(
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
 * Replace all occurrences of each sentinel substring in the `-filter_complex` value
 * with its real path. The text-overlay drawtext stage embeds `__VF_FONT_*__` /
 * `__VF_OVERLAYTEXT_*__` tokens INSIDE the filter graph string (drawtext reads the
 * font/text by filter option, not as an `-i` stream), so a whole-arg swap cannot reach
 * them — we rewrite within the single `-filter_complex` arg instead. The sentinels are
 * fixed, escape-free strings the builder controls, so a plain substring replace is safe
 * and deterministic.
 *
 * Pure + exported for unit testing (no fs/spawn).
 */
export function substituteFilterTokens(
  args: string[],
  replacements: Map<string, string>,
): string[] {
  if (replacements.size === 0) return args;
  return args.map((arg, i) => {
    // The graph string is the value immediately following the `-filter_complex` flag.
    if (i === 0 || args[i - 1] !== '-filter_complex') return arg;
    let out = arg;
    for (const [token, path] of replacements) {
      if (out.includes(token)) out = out.split(token).join(path);
    }
    return out;
  });
}

/**
 * Rewrite the placeholder tokens in `args` with real local file paths:
 *   `asset:<assetId>`          → local downloaded path                 (whole-arg `-i` value)
 *   `watermark:vf`             → path to bundled watermark PNG          (whole-arg `-i` value)
 *   `subtitles:captions.srt`   → path to the written SRT file           (whole-arg `-i` value)
 *   `__VF_FONT_<file>__`       → `${INTER_FONT_DIR}/<file>`             (in `-filter_complex`)
 *   `__VF_OVERLAYTEXT_<id>__`  → path to the written per-overlay text   (in `-filter_complex`)
 *
 * Clip/watermark/subtitles tokens appear as standalone args (`-i <token>`); the font /
 * overlay-text tokens are embedded in the filter graph string (drawtext options), so
 * they are rewritten there via {@link substituteFilterTokens}.
 */
function substituteInputPaths(
  args: string[],
  buildResult: BuildResult,
  assetPaths: Map<string, string>,
  subtitlePath: string | null,
  watermarkPath: string | null,
  textFilePaths: Map<string, string>,
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

  const whole = args.map((arg) => tokenToPath.get(arg) ?? arg);

  // In-filter sentinels: fonts (resolved against INTER_FONT_DIR) + per-overlay text files.
  const filterReplacements = new Map<string, string>();
  for (const f of buildResult.fonts) {
    filterReplacements.set(f.token, join(INTER_FONT_DIR, f.file));
  }
  for (const tf of buildResult.textFiles) {
    const p = textFilePaths.get(tf.token);
    if (p) filterReplacements.set(tf.token, p);
  }
  return substituteFilterTokens(whole, filterReplacements);
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
  workspaceId: string,
  totalSeconds: number,
  redis: Redis,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(FFMPEG_PATH, finalArgs, { stdio: ['ignore', 'pipe', 'pipe'] });

    const stderrLines: string[] = [];
    const MAX_STDERR_LINES = 100;

    const wallStart = Date.now();
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
          // ETA from wall-clock render rate: how long the remaining media will take
          // at the speed we've encoded so far.
          const wallElapsedSec = (Date.now() - wallStart) / 1000;
          const etaSeconds =
            elapsed > 0 && wallElapsedSec > 0
              ? Math.max(0, Math.round((wallElapsedSec / elapsed) * (totalSeconds - elapsed)))
              : null;
          const payload = JSON.stringify({
            type: 'export:progress',
            exportId,
            workspaceId,
            progress,
            etaSeconds,
          });
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
 * Return the path to the watermark PNG. Production sets WATERMARK_PATH to the real
 * branding asset. Otherwise we GENERATE A VISIBLE one with FFmpeg (the old fallback
 * was a 1×1 TRANSPARENT PNG → the mandatory Free-tier watermark was invisible).
 *
 * Generation chain (each step is dependency-light; falls back on failure):
 *   1. Branded text "VideoForge" via drawtext on a transparent canvas.
 *   2. A solid brand-amber tag (no font needed) if drawtext/font is unavailable.
 *   3. A 1×1 opaque-white pixel (always works) — the export scales it to ~10% width.
 */
async function resolveWatermarkPath(exportId: string): Promise<string> {
  const bundled = process.env['WATERMARK_PATH'];
  if (bundled) return bundled;

  const path = join(tmpdir(), `vf-wm-${exportId}.png`);

  // 1. Try a branded text watermark (white text + shadow on transparent bg).
  try {
    await execFileAsync(FFMPEG_PATH, [
      '-y', '-hide_banner', '-f', 'lavfi',
      '-i', 'color=c=black@0.0:s=480x110',
      '-vf',
      "drawtext=text='VideoForge':fontcolor=white:fontsize=56:x=(w-text_w)/2:y=(h-text_h)/2:shadowcolor=black@0.6:shadowx=3:shadowy=3",
      '-frames:v', '1', path,
    ]);
    return path;
  } catch {
    /* drawtext/font unavailable — fall through */
  }

  // 2. Solid brand-amber tag (no font dependency).
  try {
    await execFileAsync(FFMPEG_PATH, [
      '-y', '-hide_banner', '-f', 'lavfi',
      '-i', 'color=c=0xFF7A1A:s=240x70', '-frames:v', '1', path,
    ]);
    return path;
  } catch {
    /* lavfi unavailable — fall through to the embedded pixel */
  }

  // 3. Last resort: a 1×1 OPAQUE WHITE PNG (visible once scaled), so the watermark
  //    is never invisible even if FFmpeg generation fails entirely.
  const whitePixelPng = Buffer.from(
    '89504e470d0a1a0a0000000d4948445200000001000000010802000000907753' +
      'de0000000c4944415408d763f8ffff3f0005fe02fea735c1c20000000049454e44ae426082',
    'hex',
  );
  await writeFile(path, whitePixelPng);
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
  const workspaceId = job.data.workspaceId ?? 'dev-workspace';
  const redis = getPubRedis();
  const tempFiles: string[] = [];

  try {
    // 1. Resolve the §18 document SOURCE and validate it.
    //    Prefer an explicit `document` render-snapshot (the previewed, pruned-of-
    //    unfilled-slots doc) when the API attaches one; otherwise render `project`
    //    (the field the API currently inlines). We do NOT fetch by id here — the
    //    API already resolved which document to render and inlined it. This change
    //    only selects the SOURCE field; the doc still flows unchanged through
    //    buildExportCommand below, so "render exactly the provided doc" holds.
    const sourceDoc = selectRenderDocument(job.data);
    const validationResult = validateProject(sourceDoc);
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

    // 4c. Write one temp file per text overlay (mirrors the SRT write at 4a). The
    //     drawtext stage reads each overlay's text via `textfile=` — content never
    //     touches the filtergraph tokeniser, so `:` `'` `%` `\` / newlines are safe
    //     (§7.1). `overlayId` is a UUID, so the filename is filesystem-safe.
    const textFilePaths = new Map<string, string>();
    for (const tf of buildResult.textFiles) {
      const p = join(tmpdir(), `vf-overlaytext-${exportId}-${tf.overlayId}.txt`);
      await writeFile(p, tf.text);
      tempFiles.push(p);
      textFilePaths.set(tf.token, p);
    }

    // 5. Substitute placeholder tokens with real local paths (clip/watermark/subtitles
    //    whole-arg `-i` values + in-filter font/overlay-text sentinels).
    const resolvedArgs = substituteInputPaths(
      buildResult.args,
      buildResult,
      assetPaths,
      subtitlePath,
      watermarkPath,
      textFilePaths,
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
    await spawnFfmpeg(finalArgs, exportId, workspaceId, totalSeconds, redis);

    // 9. Upload the output to S3.
    const s3Key = `exports/${exportId}.mp4`;
    await uploadToS3(outputPath, BUCKET_EXPORTS, s3Key);

    // 9b. Sidecar captions: when captions==='sidecar', write the chosen format
    //     (.srt or .vtt) NEXT TO the MP4 (P0 fix — the format the user picked was
    //     previously dropped, and SRT was only ever written for the BURN path). The
    //     format rides as an extra `settings.sidecarFmt` key (not part of the typed
    //     parity ExportSettings), so we read it from the raw job settings.
    let sidecarKey: string | null = null;
    if (settings.captions === 'sidecar' && project.captionTracks.length > 0) {
      const firstTrack = project.captionTracks[0];
      if (firstTrack && firstTrack.blocks.length > 0) {
        const fmt = resolveSidecarFmt(job.data.settings as Record<string, unknown> | undefined);
        const sidecarLocalPath = join(tmpdir(), `vf-captions-${exportId}${fmt}`);
        await writeFile(sidecarLocalPath, buildSidecar(firstTrack, fmt));
        tempFiles.push(sidecarLocalPath);
        sidecarKey = `exports/${exportId}${fmt}`;
        await uploadToS3(sidecarLocalPath, BUCKET_EXPORTS, sidecarKey);
        console.info(
          `[render-worker] export ${exportId} — wrote sidecar captions → s3://${BUCKET_EXPORTS}/${sidecarKey}`,
        );
      }
    }

    // 10. Publish export:complete (carry the sidecar key when one was written).
    await redis.publish(
      'export:complete',
      JSON.stringify({
        type: 'export:complete',
        exportId,
        workspaceId,
        s3Key,
        ...(sidecarKey ? { sidecarKey } : {}),
      }),
    );

    console.info(`[render-worker] export ${exportId} complete → s3://${BUCKET_EXPORTS}/${s3Key}`);
    return { exportId, s3Key };
  } catch (err) {
    // Publish a failure event so the API can mark the export FAILED and notify the client.
    const message = err instanceof Error ? err.message : String(err);
    await getPubRedis().publish(
      'export:failed',
      JSON.stringify({ type: 'export:failed', exportId, workspaceId, message }),
    );
    throw err;
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
