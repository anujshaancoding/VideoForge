// ─────────────────────────────────────────────────────────────────────────────
// Golden-frame fidelity gate — the export-parity invariant under test (Spec §22.3).
//
// "What you cut is what you get." For each fixture in the 3-path matrix we:
//   1. Render the fixture §18 Project through the REAL production builder
//      (buildExportCommand) + the pinned FFmpeg — the exact export path.
//   2. Extract frames at fixed timestamps (`-ss {t} -frames:v 1`).
//   3. Compare each extracted frame to the COMMITTED golden PNG using FFmpeg's
//      own `ssim`/`psnr` filters and assert SSIM ≥ 0.985 AND PSNR ≥ 38 dB
//      (§22.3 lossy-H.264 @ Auto-CRF row — BOTH metrics must clear to pass).
//
// Matrix (highest-risk graph paths):
//   (a) trim   — per-clip -ss/-to accurate seek from the SOURCE origin.
//   (b) stack  — multi-track composite + overlay z-order (bottom→top).
//   (c) speed  — per-clip setpts time-warp.
//
// SILENT-SKIP TRAP (§22.3 "fail on skip"): locally, if FFmpeg or the synthetic
// fixtures or the goldens are absent the gate skips so unit-only dev stays green.
// IN CI (process.env.CI set) that same absence is a HARD FAILURE — the gate must
// BLOCK, never vacuously pass. Goldens are regenerated only via the reviewer-gated
//   pnpm generate:fixtures --goldens   (pinned FFmpeg 6.1.1)
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect, beforeAll } from "vitest";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  GOLDEN_FIXTURES,
  GOLDEN_DIR,
  FFMPEG_PINNED_VERSION,
  goldenPngPath,
  renderFixtureToMp4,
  extractFrame,
  compareSsimPsnr,
  ffmpegPresent,
  ffmpegVersionLine,
  fixtureMediaPresent,
} from "../../../../fixtures/golden/renderHarness.js";

// §22.3 lossy-H.264 @ Auto-CRF thresholds. Both must clear for a frame to pass.
const SSIM_MIN = 0.985;
const PSNR_MIN = 38;

const IS_CI = !!process.env["CI"];

const hasFFmpeg = ffmpegPresent();
// Version must match the pinned build — a drifted encoder silently shifts the
// reference frames, so a "present but wrong version" FFmpeg must NOT run the gate.
const ffmpegLine = hasFFmpeg ? ffmpegVersionLine() : null;
const hasPinnedFFmpeg = !!ffmpegLine && ffmpegLine.includes(FFMPEG_PINNED_VERSION);
const hasMedia = fixtureMediaPresent();
const hasGoldens = GOLDEN_FIXTURES.every((f) =>
  f.sampleTimesMs.every((t) => existsSync(goldenPngPath(f.id, t))),
);

const ready = hasPinnedFFmpeg && hasMedia && hasGoldens;

// ── Silent-skip trap: in CI, missing prerequisites HARD-FAIL (never skip). ───────
// This `describe` always runs; it converts "skip" into "fail" under CI so the gate
// can never vacuously pass a PR that never actually compared a single frame.
describe("Golden-frame gate — preconditions", () => {
  it("FFmpeg + synthetic fixtures + committed goldens are all present", () => {
    const missing: string[] = [];
    if (!hasFFmpeg) {
      missing.push(`FFmpeg (install pinned ${FFMPEG_PINNED_VERSION} / set FFMPEG_PATH)`);
    } else if (!hasPinnedFFmpeg) {
      // Present but WRONG version — the pin is enforced (Forge finding), not just documented.
      missing.push(
        `FFmpeg pinned version ${FFMPEG_PINNED_VERSION} (found: ${ffmpegLine ?? "unknown"}) — ` +
          `a drifted encoder invalidates the goldens`,
      );
    }
    if (!hasMedia) missing.push("fixture media (run: pnpm generate:fixtures)");
    if (!hasGoldens)
      missing.push(
        `golden PNGs under ${GOLDEN_DIR} (run: pnpm generate:fixtures --goldens in pinned FFmpeg 6.1.1)`,
      );

    if (missing.length === 0) {
      expect(ready).toBe(true);
      return;
    }

    const msg = `[golden] gate prerequisites missing:\n  - ${missing.join("\n  - ")}`;
    if (IS_CI) {
      // HARD FAIL in CI — the fidelity gate must block, not vacuously pass (§22.3).
      expect.fail(
        `${msg}\n\nCI must run the real golden-frame gate. ` +
          `Generate fixtures + goldens in the pinned FFmpeg 6.1.1 env before this stage.`,
      );
    } else {
      // Local dev only: note the skip so logs are honest, then pass informationally.
      console.warn(`${msg}\n  → gate SKIPPED locally (would HARD-FAIL in CI).`);
      expect(true).toBe(true);
    }
  });
});

// ── The real comparison. Skips locally when not ready; in CI the precondition test
//    above has already failed, so a skip here can never mask a missing gate. ──────
describe.skipIf(!ready)("Golden-frame fidelity gate (SSIM ≥ 0.985, PSNR ≥ 38 dB)", () => {
  let workDir: string;

  beforeAll(() => {
    workDir = mkdtempSync(join(tmpdir(), "vf-golden-"));
  });

  for (const fixture of GOLDEN_FIXTURES) {
    describe(`fixture: ${fixture.id}`, () => {
      let mp4Path: string;

      beforeAll(() => {
        mp4Path = join(workDir, `${fixture.id}.mp4`);
        const r = renderFixtureToMp4(fixture.id, mp4Path);
        if (r.status !== 0) {
          throw new Error(
            `FFmpeg render failed for "${fixture.id}" (exit ${r.status}):\n${r.stderr ?? ""}`,
          );
        }
        if (!existsSync(mp4Path)) {
          throw new Error(`render produced no output for "${fixture.id}"`);
        }
      });

      for (const t of fixture.sampleTimesMs) {
        it(`frame @${t}ms matches golden within thresholds`, () => {
          const actualPng = join(workDir, `${fixture.id}_t${t}_actual.png`);
          const ex = extractFrame(mp4Path, t, actualPng);
          expect(
            ex.status,
            `frame extraction failed @${t}ms:\n${ex.stderr ?? ""}`,
          ).toBe(0);
          expect(existsSync(actualPng), `no extracted frame @${t}ms`).toBe(true);

          const golden = goldenPngPath(fixture.id, t);
          const { ssim, psnr, raw } = compareSsimPsnr(actualPng, golden);

          const detail =
            `\nfixture=${fixture.id} t=${t}ms ssim=${ssim} psnr=${psnr}` +
            `\n(thresholds: SSIM ≥ ${SSIM_MIN}, PSNR ≥ ${PSNR_MIN} dB)` +
            `\nFFmpeg metric output:\n${raw}`;

          // BOTH metrics must clear (§22.3): SSIM = structural drift, PSNR = numeric drift.
          expect(ssim, `SSIM below threshold${detail}`).toBeGreaterThanOrEqual(SSIM_MIN);
          expect(psnr, `PSNR below threshold${detail}`).toBeGreaterThanOrEqual(PSNR_MIN);
        });
      }
    });
  }

  // Cleanup after every fixture in the suite has run.
  it("cleans up temporary render artifacts", () => {
    rmSync(workDir, { recursive: true, force: true });
    expect(existsSync(workDir)).toBe(false);
  });
});
