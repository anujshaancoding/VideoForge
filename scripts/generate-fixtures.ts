#!/usr/bin/env tsx
// ─────────────────────────────────────────────────────────────────────────────
// Synthetic CC0 test-fixture generator + golden-frame regenerator (Spec §22.3/§22.6).
//
//   pnpm generate:fixtures            # synthesise lavfi media only (idempotent)
//   pnpm generate:fixtures --goldens  # ALSO (re)generate the committed golden PNGs
//   pnpm generate:fixtures --force    # overwrite existing media
//
// REVIEWER-GATED GOLDEN UPDATE (§22.3): goldens are encoder-build-specific. They
// are committed as regular small PNG git blobs (NO Git LFS — Anchor's CI decision).
// Regenerating them is a deliberate, reviewed event: run this with --goldens inside
// the PINNED FFmpeg 6.1.1 CI/Docker env, then commit the changed PNGs with a PR note
// citing the trigger (FFmpeg bump / intentional graph change). NEVER regenerate
// goldens on an arbitrary local FFmpeg — a different build silently shifts the
// reference and the gate stops meaning anything.
//
// Requires: ffmpeg on PATH or FFMPEG_PATH env var (pin 6.1.1 for goldens).
// ─────────────────────────────────────────────────────────────────────────────

import { execFileSync } from "node:child_process";
import { mkdirSync, existsSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import {
  GOLDEN_FIXTURES,
  MEDIA_DIR,
  GOLDEN_DIR,
  FFMPEG,
  goldenPngPath,
  renderFixtureToMp4,
  extractFrame,
  ffmpegPresent,
} from "../fixtures/golden/renderHarness.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..");
const LEGACY_MEDIA = join(REPO_ROOT, "fixtures/media");

const argv = new Set(process.argv.slice(2));
const DO_GOLDENS = argv.has("--goldens") || argv.has("--update");
const FORCE = argv.has("--force");

mkdirSync(MEDIA_DIR, { recursive: true });
mkdirSync(GOLDEN_DIR, { recursive: true });

function ff(args: string[]): void {
  execFileSync(FFMPEG, args, { stdio: "inherit" });
}

function makeIfMissing(file: string, builder: () => void): void {
  const path = join(MEDIA_DIR, file);
  if (existsSync(path) && !FORCE) {
    console.log(`• ${file} exists — skipping (use --force to rebuild)`);
    return;
  }
  builder();
  console.log(`✓ generated ${file}`);
}

if (!ffmpegPresent()) {
  console.error(
    `\n✖ FFmpeg not found at "${FFMPEG}". Install the pinned 6.1.1 build (Pipeline.md §2.6)\n` +
      `  and set FFMPEG_PATH, or run inside the render-worker Docker image, then retry.\n`,
  );
  process.exit(1);
}

// ── 1. Golden-matrix source media (deterministic synthetic lavfi sources) ────────
// testsrc2 carries a per-frame counter + moving elements → trim/speed offsets are
// VISIBLE in the frame, so a golden compare actually exercises the time-warp. Solid
// colour clips give the stack/overlay fixture unambiguous z-order colours.
//
// Encode params match GOLDEN_EXPORT_SETTINGS-class output (libx264, yuv420p) so the
// fixture decode path mirrors the export path.

makeIfMissing("gold_bars_5s.mp4", () =>
  ff([
    "-y", "-hide_banner",
    "-f", "lavfi", "-i", "testsrc2=size=640x360:rate=30:duration=5",
    "-c:v", "libx264", "-crf", "18", "-pix_fmt", "yuv420p", "-preset", "medium",
    "-r", "30", join(MEDIA_DIR, "gold_bars_5s.mp4"),
  ]),
);

makeIfMissing("gold_red_3s.mp4", () =>
  ff([
    "-y", "-hide_banner",
    "-f", "lavfi", "-i", "color=c=red:size=640x360:rate=30:duration=3",
    "-c:v", "libx264", "-crf", "18", "-pix_fmt", "yuv420p", "-preset", "medium",
    "-r", "30", join(MEDIA_DIR, "gold_red_3s.mp4"),
  ]),
);

makeIfMissing("gold_blue_3s.mp4", () =>
  ff([
    "-y", "-hide_banner",
    "-f", "lavfi", "-i", "color=c=blue:size=640x360:rate=30:duration=3",
    "-c:v", "libx264", "-crf", "18", "-pix_fmt", "yuv420p", "-preset", "medium",
    "-r", "30", join(MEDIA_DIR, "gold_blue_3s.mp4"),
  ]),
);

// ── 2. Legacy fixtures (kept for the older golden.test.ts smoke path + manifest) ──
mkdirSync(LEGACY_MEDIA, { recursive: true });
if (!existsSync(join(LEGACY_MEDIA, "bunny_h264_3s.mp4")) || FORCE) {
  ff([
    "-y", "-hide_banner",
    "-f", "lavfi", "-i", "smptehdbars=size=1280x720:rate=30",
    "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=44100",
    "-t", "3", "-c:v", "libx264", "-crf", "23", "-c:a", "aac", "-b:a", "128k",
    join(LEGACY_MEDIA, "bunny_h264_3s.mp4"),
  ]);
  console.log("✓ generated bunny_h264_3s.mp4");
}
if (!existsSync(join(LEGACY_MEDIA, "tone_440hz_5s.wav")) || FORCE) {
  ff([
    "-y", "-hide_banner",
    "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=44100", "-t", "5",
    join(LEGACY_MEDIA, "tone_440hz_5s.wav"),
  ]);
  console.log("✓ generated tone_440hz_5s.wav");
}

// ── 3. (Optional) Golden frames — REVIEWER-GATED, pinned-encoder only ─────────────
if (DO_GOLDENS) {
  console.log("\n── Regenerating golden frames (pinned-encoder, reviewed event) ──");
  const tmp = join(MEDIA_DIR, ".golden-work");
  mkdirSync(tmp, { recursive: true });

  for (const fixture of GOLDEN_FIXTURES) {
    const mp4 = join(tmp, `${fixture.id}.mp4`);
    const render = renderFixtureToMp4(fixture.id, mp4);
    if (render.status !== 0) {
      console.error(`✖ render failed for "${fixture.id}":\n${render.stderr ?? ""}`);
      process.exit(1);
    }
    for (const t of fixture.sampleTimesMs) {
      const png = goldenPngPath(fixture.id, t);
      const ex = extractFrame(mp4, t, png);
      if (ex.status !== 0) {
        console.error(`✖ frame extract failed for "${fixture.id}" @${t}ms:\n${ex.stderr ?? ""}`);
        process.exit(1);
      }
      console.log(`✓ golden ${fixture.id}_t${t}.png`);
    }
  }
  rmSync(tmp, { recursive: true, force: true });
  console.log(
    "\nGoldens regenerated. Commit the changed PNGs and record the trigger\n" +
      "(FFmpeg version bump / intentional graph change) in the PR description.\n",
  );
} else {
  console.log(
    "\nMedia ready. To (re)generate committed golden frames (reviewed, pinned\n" +
      "FFmpeg 6.1.1 only):  pnpm generate:fixtures --goldens\n",
  );
}

console.log("All fixtures generated.");
