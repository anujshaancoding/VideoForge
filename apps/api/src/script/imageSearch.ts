// ─────────────────────────────────────────────────────────────────────────────
// Script Studio v2 — REAL web-image source (the "authentic b-roll" producer).
//
//   findSceneImage(query, target, opts) -> { pngPath, sourceUrl, source } | null
//
// Diffusion models (imagegen.ts) HALLUCINATE — they invent a generic look for any
// named, real, branded subject (a game agent, a real person, a logo), so a "Valorant
// Jett" scene comes out as a made-up character. For those scripts authenticity beats
// generation: we RETRIEVE real photos instead. This seam searches the web for the
// scene's keywords, downloads up to N candidates, auto-picks the best by resolution +
// search rank, and fits it (cover) to the export canvas. No artistic filter — the
// whole point is to keep the real frame intact.
//
// ENGINE (env IMAGE_SEARCH_ENGINE, default "none" → feature off, AI path is used):
//   google — Google Programmable Search (Custom Search JSON API), searchType=image.
//            Needs GOOGLE_CSE_KEY + GOOGLE_CSE_CX (free tier: 100 queries/day). Bing's
//            Image Search API was retired (Aug 2025), so Google is the practical path.
//
// CPU/NET-bounded by design: scene count is capped at 40 upstream, scenes run one at a
// time (sketchScenes loop), candidate downloads are concurrency-limited and each fetch
// is timeout + max-bytes capped. Returns null (never throws) so the caller degrades to
// AI generation cleanly — the same graceful-degradation contract as imagegen.ts.
// ─────────────────────────────────────────────────────────────────────────────

import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { cleanupFile } from './fs.js';

const ENGINE = (process.env['IMAGE_SEARCH_ENGINE'] ?? 'none').toLowerCase();
const GOOGLE_KEY = process.env['GOOGLE_CSE_KEY'] ?? '';
const GOOGLE_CX = process.env['GOOGLE_CSE_CX'] ?? '';

function clampInt(raw: string | undefined, dflt: number, lo: number, hi: number): number {
  const n = Number.parseInt(raw ?? '', 10);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt;
}

/** Candidates downloaded + judged per scene (the "4–5 images per keyword"). 1..10. */
const COUNT = clampInt(process.env['IMAGE_SEARCH_COUNT'], 5, 1, 10);
/** Per-image download timeout (ms). */
const TIMEOUT_MS = clampInt(process.env['IMAGE_SEARCH_TIMEOUT_MS'], 8000, 1000, 60000);
/** Reject any candidate larger than this (bytes) — bounds memory/CPU per download. */
const MAX_BYTES = clampInt(process.env['IMAGE_SEARCH_MAX_BYTES'], 12 * 1024 * 1024, 64 * 1024, 64 * 1024 * 1024);
/** Reject candidates whose smaller side is below this (px) — avoids tiny thumbnails. */
const MIN_DIM = clampInt(process.env['IMAGE_SEARCH_MIN_DIM'], 400, 1, 4096);
/** Concurrent candidate downloads per scene (bounded fan-out). */
const DL_CONCURRENCY = clampInt(process.env['IMAGE_SEARCH_CONCURRENCY'], 4, 1, 8);

/** True when the real-image source is configured (engine + credentials present). */
export function isImageSearchEnabled(): boolean {
  return ENGINE === 'google' && GOOGLE_KEY !== '' && GOOGLE_CX !== '';
}

export interface FoundImage {
  /** Absolute path to a real PNG on disk, already fitted (cover) to the canvas. */
  pngPath: string;
  /** The web page / image URL the picture came from (manifest provenance). */
  sourceUrl: string;
}

// ── Google Programmable Search (image mode) ──────────────────────────────────────

interface GoogleImageItem {
  link?: string;
  mime?: string;
  image?: { width?: number; height?: number; byteSize?: number };
}
interface GoogleSearchResponse {
  items?: GoogleImageItem[];
}

/** Fetch ranked image-result URLs for `query` (best first). Empty on any failure. */
async function searchGoogle(query: string): Promise<string[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    // Ask for a few extra so we still have COUNT candidates after type/size filtering.
    const num = Math.min(10, COUNT + 3);
    const url =
      `https://www.googleapis.com/customsearch/v1?key=${encodeURIComponent(GOOGLE_KEY)}` +
      `&cx=${encodeURIComponent(GOOGLE_CX)}&searchType=image&safe=active` +
      `&num=${num}&q=${encodeURIComponent(query)}`;
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return [];
    const json = (await res.json()) as GoogleSearchResponse;
    return (json.items ?? [])
      .filter((it) => typeof it.link === 'string' && /^https?:\/\//.test(it.link))
      .map((it) => it.link as string);
  } catch {
    return []; // unreachable / aborted / bad payload → caller falls back to AI
  } finally {
    clearTimeout(timer);
  }
}

// ── Bounded download + validate ──────────────────────────────────────────────────

interface Candidate {
  rawPath: string;
  width: number;
  height: number;
  rank: number; // 0 = top search result
  sourceUrl: string;
}

/** Download one candidate to a temp file and probe it. Returns null if unusable
 *  (too big, too small, undecodable, timed out). Never throws. */
async function fetchCandidate(url: string, rank: number, dir: string): Promise<Candidate | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return null;
    const len = Number.parseInt(res.headers.get('content-length') ?? '', 10);
    if (Number.isFinite(len) && len > MAX_BYTES) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength < 1024 || buf.byteLength > MAX_BYTES) return null;

    const meta = await sharp(buf).metadata();
    const width = meta.width ?? 0;
    const height = meta.height ?? 0;
    if (Math.min(width, height) < MIN_DIM) return null;

    const rawPath = join(dir, `cand-${rank}.img`);
    await writeFile(rawPath, buf);
    return { rawPath, width, height, rank, sourceUrl: url };
  } catch {
    return null; // network / decode / abort → just drop this candidate
  } finally {
    clearTimeout(timer);
  }
}

/** Run `fn` over `items` with at most `limit` in flight (bounded fan-out). */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  async function worker(): Promise<void> {
    while (next < items.length) {
      const i = next;
      next += 1;
      out[i] = await fn(items[i] as T, i);
    }
  }
  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
  await Promise.all(workers);
  return out;
}

/** Higher is better: favours high resolution, with search rank as the tie-breaker. */
function score(c: Candidate): number {
  return Math.min(c.width, c.height) - c.rank * 60;
}

/** Cover-fit any decodable image to the export canvas and write a PNG. */
export async function fitToCanvas(
  srcPath: string,
  dstPath: string,
  target: { width: number; height: number },
): Promise<void> {
  await sharp(srcPath)
    .resize(target.width, target.height, { fit: 'cover', kernel: 'lanczos3' })
    .removeAlpha()
    .toColourspace('srgb')
    .png()
    .toFile(dstPath);
}

/**
 * Find a real web image for `query`, fitted to `target`. Downloads up to COUNT
 * candidates, auto-picks the best (resolution, then rank), and returns its fitted PNG.
 * Returns null when the feature is off or nothing usable was found — the caller then
 * degrades to AI generation. The returned pngPath is the caller's to register + clean.
 */
export async function findSceneImage(
  query: string,
  target: { width: number; height: number },
): Promise<FoundImage | null> {
  if (!isImageSearchEnabled()) return null;
  const q = query.trim();
  if (!q) return null;

  const urls = (await searchGoogle(q)).slice(0, Math.min(10, COUNT + 3));
  if (urls.length === 0) return null;

  const dir = await mkdtemp(join(tmpdir(), 'vf-imgsearch-'));
  const trash: string[] = [];
  try {
    const results = await mapLimit(urls, DL_CONCURRENCY, (url, i) => fetchCandidate(url, i, dir));
    const valid = results.filter((c): c is Candidate => c !== null);
    for (const c of valid) trash.push(c.rawPath);
    if (valid.length === 0) return null;

    const best = valid.reduce((a, b) => (score(b) > score(a) ? b : a));
    const dstPath = join(dir, 'picked.png');
    await fitToCanvas(best.rawPath, dstPath, target);
    return { pngPath: dstPath, sourceUrl: best.sourceUrl };
  } catch {
    return null;
  } finally {
    // The picked PNG is kept (returned); the raw candidate downloads are disposable.
    await Promise.allSettled(trash.map((p) => cleanupFile(p)));
  }
}
