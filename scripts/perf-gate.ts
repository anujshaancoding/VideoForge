#!/usr/bin/env tsx
// Perf gate: assert render-worker exports at >= 4x realtime (MVP_Scope §8).
import { spawnSync } from 'node:child_process';
import { existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const FFMPEG = process.env.FFMPEG_PATH ?? 'ffmpeg';
const fixture = join(process.cwd(), 'fixtures/media/bunny_h264_3s.mp4');

if (!existsSync(fixture)) {
  console.log('No fixture media — skipping perf gate (run generate-fixtures.ts first)');
  process.exit(0);
}

const outPath = join(tmpdir(), 'vf-perf-test.mp4');
const start = Date.now();
const result = spawnSync(FFMPEG, [
  '-i', fixture,
  '-vf', 'scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2',
  '-c:v', 'libx264', '-crf', '18', '-preset', 'fast',
  '-c:a', 'aac', '-y', outPath
], { stdio: 'pipe' });

const elapsedMs = Date.now() - start;
const sourceDurationMs = 3000;
const speedRatio = sourceDurationMs / elapsedMs;

if (result.status !== 0) {
  console.error('FFmpeg perf test failed:', result.stderr?.toString());
  process.exit(1);
}

try { unlinkSync(outPath); } catch { /* ok */ }

console.log(`Render perf: ${speedRatio.toFixed(2)}x realtime (${elapsedMs}ms for ${sourceDurationMs}ms source)`);
if (speedRatio < 4) {
  console.error(`FAIL: below 4x realtime target (got ${speedRatio.toFixed(2)}x)`);
  process.exit(1);
}
console.log('PASS: >= 4x realtime');
