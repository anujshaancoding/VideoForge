// ─────────────────────────────────────────────────────────────────────────────
// Script Studio v2 — image-generation seam (the b-roll producer for sketch video).
//
//   generateBaseImage(prompt, opts) -> { pngPath, source }
//
// Produces ONE base image per scene from a text prompt, at $0. Mirrors the TTS seam
// (tts.ts): a swappable engine behind a stable signature, single-flight (one gen at
// a time → bounded local GPU / respects the keyless API's rate limit), and graceful
// degradation so a box with no engine still exercises the whole pipeline.
//
// ENGINE PRECEDENCE (env IMAGEGEN_ENGINE, default "auto"):
//   1. drawthings  — Draw Things' local Automatic1111-compatible HTTP API
//                    (DRAWTHINGS_URL, default http://127.0.0.1:7860). Free, local,
//                    no key, no rate limit. The production path on the Mac.
//   2. pollinations — keyless cloud fallback (image.pollinations.ai). Rate-limited
//                    (~1 img/15s) so calls are spaced; used when Draw Things is down.
//   3. placeholder — a deterministic solid-tint PNG (sharp), so CI / a bare box
//                    still produces a real file and the assemble/arrange path runs.
//
// The downstream sketch filter (sketch.ts) is applied by the caller, so this seam
// only has to return a readable image; style/consistency is handled uniformly there.
// ─────────────────────────────────────────────────────────────────────────────

import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';

const ENGINE = (process.env['IMAGEGEN_ENGINE'] ?? 'auto').toLowerCase();
const DRAWTHINGS_URL = (process.env['DRAWTHINGS_URL'] ?? 'http://127.0.0.1:7860').replace(/\/$/, '');
// ── SDXL-Turbo-optimal defaults (researched 2026-06-17) ──────────────────────────
// Turbo is an ADD-distilled model: 1–4 steps, NO guidance (CFG≈1), Euler-ancestral.
// Higher steps/CFG "over-cook" it (the fried/HDR look); see docs/Market_Research.md.
const IMAGE_STEPS = Number.parseInt(process.env['IMAGEGEN_STEPS'] ?? '5', 10);
const IMAGE_CFG = Number.parseFloat(process.env['IMAGEGEN_CFG'] ?? '1');
// Turbo's trained sampler is Euler Ancestral ("Euler a"); DPM++ 2M/AYS are for many-
// step base SDXL and degrade Turbo. Sent as A1111 `sampler_name` (empty ⇒ omit).
const IMAGE_SAMPLER = process.env['IMAGEGEN_SAMPLER'] ?? 'Euler a';
// Generation resolution (px). Turbo's NATIVE is ~512; generating far above it (we used
// 768×1344) is what produced duplicated subjects (two lighthouses). Generate near-
// native 9:16 here, then the sketch filter upscales the styled frame to the 1080×1920
// canvas — line art is forgiving of upscale softness, and composition stays intact.
const IMAGE_WIDTH = Number.parseInt(process.env['IMAGEGEN_WIDTH'] ?? '640', 10);
const IMAGE_HEIGHT = Number.parseInt(process.env['IMAGEGEN_HEIGHT'] ?? '1152', 10);
/** Per-request timeout for a local generation (ms). Generous: cold model load + draw. */
const DRAWTHINGS_TIMEOUT_MS = Number.parseInt(process.env['IMAGEGEN_TIMEOUT_MS'] ?? '180000', 10);
/** Spacing between keyless-cloud calls (ms) to respect its ~1/15s anon rate limit. */
const POLLINATIONS_SPACING_MS = Number.parseInt(process.env['POLLINATIONS_SPACING_MS'] ?? '16000', 10);

export type ImageSource = 'drawthings' | 'pollinations' | 'placeholder';

export interface GenerateImageOptions {
  /** Deterministic seed (same seed+prompt ⇒ same image on both real engines). */
  seed: number;
  /** Generation width in px. Default IMAGEGEN_WIDTH (768). */
  width?: number;
  /** Generation height in px. Default IMAGEGEN_HEIGHT (1344) → 9:16 portrait. */
  height?: number;
  /** Things to suppress; engine-dependent. */
  negativePrompt?: string;
}

export interface GenerateImageResult {
  /** Absolute path to a real PNG on disk. */
  pngPath: string;
  /** Which engine actually produced it (for manifest provenance + UX labelling). */
  source: ImageSource;
}

// ── Single-flight: one generation at a time (bounded GPU / rate limit) ───────────
let genChain: Promise<unknown> = Promise.resolve();
function runExclusive<T>(fn: () => Promise<T>): Promise<T> {
  const next = genChain.then(fn, fn);
  genChain = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Draw Things (local A1111-compatible HTTP) ────────────────────────────────────

interface Txt2ImgResponse {
  images?: string[];
}

async function tryDrawThings(
  prompt: string,
  opts: Required<Pick<GenerateImageOptions, 'seed' | 'width' | 'height'>> & { negativePrompt: string },
  outPath: string,
): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DRAWTHINGS_TIMEOUT_MS);
  try {
    const body: Record<string, unknown> = {
      prompt,
      negative_prompt: opts.negativePrompt,
      seed: opts.seed,
      steps: IMAGE_STEPS,
      cfg_scale: IMAGE_CFG,
      width: opts.width,
      height: opts.height,
    };
    // Pin Turbo's Euler-ancestral sampler (DT defaults to DPM++ 2M Karras otherwise).
    if (IMAGE_SAMPLER.trim()) body['sampler_name'] = IMAGE_SAMPLER.trim();
    const res = await fetch(`${DRAWTHINGS_URL}/sdapi/v1/txt2img`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) return false;
    const json = (await res.json()) as Txt2ImgResponse;
    const b64 = json.images?.[0];
    if (!b64) return false;
    const raw = b64.includes(',') ? b64.slice(b64.indexOf(',') + 1) : b64;
    await writeFile(outPath, Buffer.from(raw, 'base64'));
    return true;
  } catch {
    return false; // unreachable / aborted / bad payload → fall through to next engine
  } finally {
    clearTimeout(timer);
  }
}

// ── Pollinations (keyless cloud fallback) ────────────────────────────────────────

let lastPollinationsAt = 0;

async function tryPollinations(
  prompt: string,
  opts: Required<Pick<GenerateImageOptions, 'seed' | 'width' | 'height'>>,
  outPath: string,
): Promise<boolean> {
  // Respect the anonymous rate limit by spacing consecutive calls.
  const waited = Date.now() - lastPollinationsAt;
  if (waited < POLLINATIONS_SPACING_MS) await sleep(POLLINATIONS_SPACING_MS - waited);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60000);
  try {
    const url =
      `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}` +
      `?width=${opts.width}&height=${opts.height}&seed=${opts.seed}&nologo=true&model=flux`;
    const res = await fetch(url, { signal: controller.signal });
    lastPollinationsAt = Date.now();
    if (!res.ok) return false;
    const buf = Buffer.from(await res.arrayBuffer());
    // It returns 200 + a tiny placeholder when throttled — reject suspiciously small bodies.
    if (buf.byteLength < 2048) return false;
    await writeFile(outPath, buf);
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

// ── Placeholder (deterministic, always succeeds) ─────────────────────────────────

async function writePlaceholder(
  opts: Required<Pick<GenerateImageOptions, 'seed' | 'width' | 'height'>>,
  outPath: string,
): Promise<void> {
  // A flat tint derived from the seed — deterministic, valid PNG, real bytes. Lets
  // the assemble/arrange/export path run end-to-end on a box with no image engine.
  const r = 40 + (opts.seed % 120);
  const g = 40 + ((opts.seed * 7) % 120);
  const b = 40 + ((opts.seed * 13) % 120);
  await sharp({
    create: { width: opts.width, height: opts.height, channels: 3, background: { r, g, b } },
  })
    .png()
    .toFile(outPath);
}

/**
 * Generate a base image for `prompt`. Runs exclusively (one at a time). Tries the
 * configured engine(s) in precedence order; ALWAYS returns a real PNG (placeholder
 * last), so the caller never has to handle a missing file.
 */
export async function generateBaseImage(
  prompt: string,
  options: GenerateImageOptions,
): Promise<GenerateImageResult> {
  const opts = {
    seed: options.seed,
    width: options.width ?? IMAGE_WIDTH,
    height: options.height ?? IMAGE_HEIGHT,
    negativePrompt: options.negativePrompt ?? 'text, watermark, signature, blurry',
  };

  return runExclusive(async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vf-img-'));
    const pngPath = join(dir, 'base.png');

    const useDrawThings = ENGINE === 'drawthings' || ENGINE === 'auto';
    const usePollinations = ENGINE === 'pollinations' || ENGINE === 'auto';

    if (useDrawThings && (await tryDrawThings(prompt, opts, pngPath))) {
      return { pngPath, source: 'drawthings' };
    }
    if (usePollinations && (await tryPollinations(prompt, opts, pngPath))) {
      return { pngPath, source: 'pollinations' };
    }
    await writePlaceholder(opts, pngPath);
    return { pngPath, source: 'placeholder' };
  });
}
