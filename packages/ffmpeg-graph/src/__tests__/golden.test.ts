// ─────────────────────────────────────────────────────────────────────────────
// Golden-frame fidelity gate (Stage 5, CI §10.3).
//
// Spawns the ACTUAL pinned FFmpeg against synthetic fixture media and asserts:
//   1. FFmpeg exits 0 (no graph errors)
//   2. Output file is non-empty (>1 kB)
//
// Requires FFMPEG_PATH env var or `ffmpeg` on PATH, and fixture media generated
// by `scripts/generate-fixtures.ts`.  Skipped automatically when neither is
// available so unit-only CI runs stay green.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect } from 'vitest';
import { buildExportCommand } from '../index.js';
import { sampleProject } from '@videoforge/project-schema';
import { execSync, spawnSync } from 'node:child_process';
import { existsSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const FFMPEG = process.env.FFMPEG_PATH ?? 'ffmpeg';
// Run from packages/ffmpeg-graph; fixtures live two levels up at repo root.
const FIXTURE_DIR = join(process.cwd(), '../../fixtures/media');

// Detect ffmpeg availability once.
const hasFFmpeg = (() => {
  try { execSync(`${FFMPEG} -version`, { stdio: 'ignore' }); return true; }
  catch { return false; }
})();

const fixtureVideo = join(FIXTURE_DIR, 'bunny_h264_3s.mp4');
const hasFixtures = existsSync(fixtureVideo);

describe.skipIf(!hasFFmpeg || !hasFixtures)('Golden-frame fidelity gate', () => {
  it('renders fixture project: FFmpeg exits 0 and output is non-empty', () => {
    const outPath = join(tmpdir(), `vf-golden-test-${Date.now()}.mp4`);

    const settings = {
      format: 'mp4' as const,
      videoCodec: 'h264' as const,
      resolution: { w: 1080, h: 1920 },
      fps: 30,
      crf: 18,
      captions: 'none' as const,
      watermark: false,
    };

    const { args, inputs } = buildExportCommand(sampleProject, settings);

    // Build a substitution map: every distinct asset:<id> token → the fixture file.
    // The sampleProject uses multiple asset ids (video A, video B, audio, voice).
    // We substitute ALL clip inputs with the single 3-second fixture clip because:
    //   - The graph is structurally correct (trims, xfade, amix all fire)
    //   - We only assert render integrity, not content fidelity at this MVP stage.
    const tokenToPath = new Map<string, string>();
    for (const inp of inputs) {
      if (inp.kind === 'clip' && inp.path) {
        tokenToPath.set(inp.path, fixtureVideo);
      }
    }
    // Watermark and subtitles tokens: substitute with the fixture video for the
    // watermark (an image placeholder) and skip/omit via captions:none above.
    tokenToPath.set('watermark:vf', fixtureVideo);

    // Replace placeholder tokens in the flat args array.
    const resolvedArgs = args.map(arg => tokenToPath.get(arg) ?? arg);

    // Append the output path (buildExportCommand omits it; worker appends).
    resolvedArgs.push(outPath);

    const result = spawnSync(FFMPEG, resolvedArgs, {
      stdio: 'pipe',
      encoding: 'utf-8',
    });

    // Clean up before asserting so a failed test doesn't leave temp files.
    const cleanup = () => { try { unlinkSync(outPath); } catch { /* ok */ } };

    if (result.status !== 0) {
      cleanup();
      expect.fail(
        `FFmpeg exited ${result.status}.\nSTDERR:\n${result.stderr ?? ''}\nARGS:\n${resolvedArgs.join(' ')}`
      );
    }

    expect(existsSync(outPath), 'Output file should exist after FFmpeg exits 0').toBe(true);

    const { size } = statSync(outPath);
    expect(size, 'Output file should be > 1 kB').toBeGreaterThan(1000);

    cleanup();
  });
});

describe('Golden-frame gate — fixture availability notice', () => {
  it('reports fixture/FFmpeg status so CI logs are clear', () => {
    if (!hasFFmpeg) {
      console.warn('[golden] FFmpeg not found — gate skipped (install ffmpeg or set FFMPEG_PATH)');
    } else if (!hasFixtures) {
      console.warn('[golden] Fixture media not found — gate skipped (run: tsx scripts/generate-fixtures.ts)');
    } else {
      console.log(`[golden] FFmpeg: ${FFMPEG}, fixtures: ${FIXTURE_DIR}`);
    }
    // This describe block always passes — it is informational only.
    expect(true).toBe(true);
  });
});
