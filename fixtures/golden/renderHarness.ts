// ─────────────────────────────────────────────────────────────────────────────
// Shared golden-frame render harness (Spec §22.3).
//
// ONE place that turns a fixture `Project` into a real local MP4 via the EXACT
// production builder (buildExportCommand) + a pinned FFmpeg. Imported by BOTH:
//   • scripts/generate-fixtures.ts — to synthesise/regenerate the golden PNGs.
//   • packages/ffmpeg-graph/src/__tests__/golden.test.ts — to render then compare.
// Using one harness guarantees the golden and the asserted render are produced by
// identical argv, so a passing gate genuinely means "what you cut is what you get".
//
// Pure-ish: this module DOES spawn FFmpeg (it is the impure boundary). The graph
// builder it calls stays pure. No network, no S3 — only local synthetic fixtures.
// ─────────────────────────────────────────────────────────────────────────────

import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// Import the builder by RELATIVE PATH into the ffmpeg-graph source (not the package
// name) so this harness resolves identically whether it is loaded by vitest inside
// packages/ffmpeg-graph or by `tsx` from the repo root — no dependence on a hoisted
// root node_modules/@videoforge symlink.
import { buildExportCommand } from "../../packages/ffmpeg-graph/src/buildFilterComplex.js";
import {
  GOLDEN_FIXTURES,
  GOLDEN_EXPORT_SETTINGS,
  FIXTURE_ASSET_MAP,
  type GoldenFixture,
} from "../projects/index.js";

export { GOLDEN_FIXTURES, GOLDEN_EXPORT_SETTINGS };
export type { GoldenFixture };

const HERE = dirname(fileURLToPath(import.meta.url));
/** fixtures/ root (this file lives at fixtures/golden/). */
export const FIXTURES_ROOT = join(HERE, "..");
export const MEDIA_DIR = join(FIXTURES_ROOT, "media");
export const GOLDEN_DIR = join(FIXTURES_ROOT, "golden");

export const FFMPEG = process.env["FFMPEG_PATH"] ?? "ffmpeg";

/**
 * The single pinned FFmpeg build the golden gate is calibrated against (§22.3 /
 * Pipeline.md §2.6). Goldens are encoder-build-specific: a different build silently
 * shifts the reference frames, so BOTH generation and comparison must run on this
 * exact version. Overridable via env only to allow a deliberate, reviewed bump.
 */
export const FFMPEG_PINNED_VERSION = process.env["FFMPEG_PINNED_VERSION"] ?? "6.1.1";

/**
 * Directory holding the bundled Inter static TTFs for the text-overlay drawtext stage.
 * Matches the render-worker (`INTER_FONT_DIR`, default `/usr/share/fonts/inter`) so the
 * golden render resolves `font:Inter-*.ttf` tokens to the SAME files the production
 * export uses. The text fixtures only render where this dir + Inter exist (the pinned
 * FFmpeg image); locally the gate skips them like the media fixtures.
 */
export const INTER_FONT_DIR = process.env["INTER_FONT_DIR"] ?? "/usr/share/fonts/inter";

/** Path to a fixture's golden PNG for a given sample time (ms). */
export function goldenPngPath(fixtureId: string, timeMs: number): string {
  return join(GOLDEN_DIR, `${fixtureId}_t${timeMs}.png`);
}

/** True if every synthetic fixture media file the matrix needs exists locally. */
export function fixtureMediaPresent(): boolean {
  return Object.values(FIXTURE_ASSET_MAP).every((f) => existsSync(join(MEDIA_DIR, f)));
}

/** True if `ffmpeg -version` runs (binary present). */
export function ffmpegPresent(): boolean {
  const r = spawnSync(FFMPEG, ["-version"], { stdio: "ignore" });
  return r.status === 0;
}

/**
 * The trimmed first line of `ffmpeg -version` (e.g. "ffmpeg version 6.1.1 ...") or
 * `null` if the binary is absent / failed to run.
 */
export function ffmpegVersionLine(): string | null {
  const r = spawnSync(FFMPEG, ["-version"], { stdio: "pipe", encoding: "utf-8" });
  if (r.status !== 0) return null;
  const out = `${r.stdout ?? ""}${r.stderr ?? ""}`;
  return out.split("\n", 1)[0]?.trim() ?? null;
}

let pinnedAssertOk = false;
/**
 * HARD-ASSERT the local FFmpeg is the pinned build before it is allowed to produce
 * or compare any golden frame (Forge finding: the pin was documented but never
 * enforced in code). Throws a loud, explicit Error on a missing binary OR a version
 * mismatch — so goldens can never be generated/compared against a drifted encoder.
 *
 * Memoised: the version probe runs once per process, then is a no-op.
 */
export function assertPinnedFFmpegVersion(): void {
  if (pinnedAssertOk) return;

  const line = ffmpegVersionLine();
  if (line === null) {
    throw new Error(
      `[golden] FFmpeg not runnable at "${FFMPEG}". The golden gate requires the ` +
        `pinned build ${FFMPEG_PINNED_VERSION} (Pipeline.md §2.6). Install it and set ` +
        `FFMPEG_PATH, or run inside the render-worker Docker image.`,
    );
  }

  // The first line is "ffmpeg version <X> Copyright ...". Require the pinned token to
  // appear in it (matches scripts/check-ffmpeg.mjs; tolerant of distro suffixes like
  // "6.1.1-3ubuntu5"). A drifted build (e.g. 6.0 / 7.0) fails loudly here.
  if (!line.includes(FFMPEG_PINNED_VERSION)) {
    throw new Error(
      `[golden] FFmpeg version mismatch — goldens MUST be generated/compared on the ` +
        `pinned encoder.\n` +
        `  expected pinned: ${FFMPEG_PINNED_VERSION}\n` +
        `  found:           ${line}\n` +
        `  A different FFmpeg build silently shifts the reference frames and makes the ` +
        `SSIM/PSNR gate meaningless. Install ${FFMPEG_PINNED_VERSION} (Pipeline.md §2.6) ` +
        `or use the render-worker Docker image. To intentionally bump, set ` +
        `FFMPEG_PINNED_VERSION and regenerate goldens in a reviewed PR.`,
    );
  }

  pinnedAssertOk = true;
}

/**
 * Substitute the builder's placeholder `asset:<id>` tokens with real local fixture
 * paths and the trailing `out.mp4` with `outPath`, then run FFmpeg.
 *
 * Returns the spawn result (caller asserts/throws). Watermark/captions are OFF in
 * GOLDEN_EXPORT_SETTINGS, so only `asset:` tokens need resolving here.
 */
export function renderFixtureToMp4(fixtureId: string, outPath: string) {
  // Pinned-encoder gate (Forge finding): never render a golden source on a drifted build.
  assertPinnedFFmpegVersion();

  const fixture = GOLDEN_FIXTURES.find((f) => f.id === fixtureId);
  if (!fixture) throw new Error(`unknown golden fixture: ${fixtureId}`);

  const { args, inputs, textFiles, fonts } = buildExportCommand(
    fixture.project,
    GOLDEN_EXPORT_SETTINGS,
  );

  // Map each clip input's `asset:<id>` token → its synthetic fixture file path.
  const tokenToPath = new Map<string, string>();
  for (const inp of inputs) {
    if (inp.kind === "clip" && inp.assetId) {
      const file = FIXTURE_ASSET_MAP[inp.assetId];
      if (!file) throw new Error(`no fixture media mapped for asset ${inp.assetId}`);
      tokenToPath.set(inp.path, join(MEDIA_DIR, file));
    }
  }

  // Text-overlay fixtures: materialise each overlay's text to a temp file and resolve the
  // in-filter `font:`/`overlaytext:` sentinels, EXACTLY as the render worker does — so the
  // golden is produced by the same drawtext the production export emits. The Inter faces
  // come from INTER_FONT_DIR (the pinned image; on a host without Inter the render simply
  // fails and the gate's precondition check reports it).
  const filterReplacements = new Map<string, string>();
  for (const f of fonts) filterReplacements.set(f.token, join(INTER_FONT_DIR, f.file));
  if (textFiles.length > 0) {
    const dir = mkdtempSync(join(tmpdir(), "vf-golden-text-"));
    for (const tf of textFiles) {
      const p = join(dir, `${tf.overlayId}.txt`);
      writeFileSync(p, tf.text);
      filterReplacements.set(tf.token, p);
    }
  }

  const resolved = args.map((a, i) => {
    if (a === "out.mp4") return outPath;
    const swapped = tokenToPath.get(a);
    if (swapped) return swapped;
    // Rewrite font/text sentinels inside the single `-filter_complex` value.
    if (i > 0 && args[i - 1] === "-filter_complex" && filterReplacements.size > 0) {
      let out = a;
      for (const [token, path] of filterReplacements) {
        if (out.includes(token)) out = out.split(token).join(path);
      }
      return out;
    }
    return a;
  });

  return spawnSync(FFMPEG, resolved, { stdio: "pipe", encoding: "utf-8" });
}

/**
 * Extract a single frame from `mp4Path` at timeline time `timeMs` into `pngPath`.
 * Uses output-seek (`-ss` AFTER `-i`) for frame-accurate extraction, matching the
 * §22.3 method (`ffmpeg -ss {t} -frames:v 1`).
 */
export function extractFrame(mp4Path: string, timeMs: number, pngPath: string) {
  // Pinned-encoder gate: the extracting decoder must match the golden's build too.
  assertPinnedFFmpegVersion();

  const t = (timeMs / 1000).toFixed(3);
  return spawnSync(
    FFMPEG,
    ["-y", "-hide_banner", "-nostdin", "-i", mp4Path, "-ss", t, "-frames:v", "1", "-update", "1", pngPath],
    { stdio: "pipe", encoding: "utf-8" },
  );
}

/**
 * Compare `actualPng` against `goldenPng` using FFmpeg's `ssim` + `psnr` filters,
 * exactly as §22.3 prescribes (the metric matches the encoder's colour handling).
 * Returns parsed { ssim, psnr } (psnr "inf" → Infinity for identical frames).
 */
export function compareSsimPsnr(
  actualPng: string,
  goldenPng: string,
): { ssim: number; psnr: number; raw: string } {
  // Pinned-encoder gate: the metric/colour handling must come from the pinned build.
  assertPinnedFFmpegVersion();

  // Two-input filtergraph: [actual][golden] → ssim → psnr. Both filters print to
  // stderr. -f null discards the muxed output; we only want the printed metrics.
  const r = spawnSync(
    FFMPEG,
    [
      "-hide_banner",
      "-nostdin",
      "-i",
      actualPng,
      "-i",
      goldenPng,
      "-lavfi",
      "[0:v][1:v]ssim;[0:v][1:v]psnr",
      "-f",
      "null",
      "-",
    ],
    { stdio: "pipe", encoding: "utf-8" },
  );
  const raw = (r.stderr ?? "") + (r.stdout ?? "");

  // SSIM line: "... SSIM ... All:0.993842 (22.097394)"  → take the All: value.
  const ssimMatch = /SSIM[^\n]*All:\s*([0-9.]+)/i.exec(raw);
  // PSNR line: "... PSNR ... average:41.23 ... " (or "average:inf").
  const psnrMatch = /PSNR[^\n]*average:\s*(inf|[0-9.]+)/i.exec(raw);

  if (!ssimMatch || !psnrMatch) {
    throw new Error(
      `could not parse SSIM/PSNR from FFmpeg output (exit ${r.status}). Raw:\n${raw}`,
    );
  }

  const ssim = Number.parseFloat(ssimMatch[1]!);
  const psnrStr = psnrMatch[1]!;
  const psnr = psnrStr.toLowerCase() === "inf" ? Number.POSITIVE_INFINITY : Number.parseFloat(psnrStr);
  return { ssim, psnr, raw };
}
