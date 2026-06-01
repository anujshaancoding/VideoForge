#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// check-ffmpeg.mjs — assert the local FFmpeg matches the pinned build.
//
// The golden-frame fidelity gate is only meaningful if the encoder is identical
// across machines (Pipeline.md §2.6). This runs `ffmpeg -version` (honoring
// FFMPEG_PATH) and fails loudly if the reported version does not contain
// FFMPEG_PINNED_VERSION (default 6.1.1).
//
//   node scripts/check-ffmpeg.mjs        (or: pnpm check:ffmpeg / make check-ffmpeg)
// ─────────────────────────────────────────────────────────────────────────────

import { spawnSync } from 'node:child_process';

const FFMPEG_PATH = process.env['FFMPEG_PATH'] ?? 'ffmpeg';
const PINNED = process.env['FFMPEG_PINNED_VERSION'] ?? '6.1.1';

function fail(message) {
  console.error(`\n✖ check-ffmpeg: ${message}\n`);
  process.exit(1);
}

const result = spawnSync(FFMPEG_PATH, ['-version'], { encoding: 'utf8' });

if (result.error) {
  if (result.error.code === 'ENOENT') {
    fail(
      `FFmpeg not found at "${FFMPEG_PATH}".\n` +
        `  Install the pinned ${PINNED} build (Pipeline.md §2.6) and set FFMPEG_PATH,\n` +
        `  or run the containerized worker:  docker compose up render-worker`,
    );
  }
  fail(`failed to run "${FFMPEG_PATH} -version": ${result.error.message}`);
}

if (typeof result.status === 'number' && result.status !== 0) {
  fail(
    `"${FFMPEG_PATH} -version" exited with code ${result.status}.\n` +
      (result.stderr ? `  stderr: ${result.stderr.trim()}` : ''),
  );
}

const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
// First line looks like:  ffmpeg version 6.1.1 Copyright (c) ...
const firstLine = output.split('\n', 1)[0]?.trim() ?? '';

if (!output.includes(PINNED)) {
  fail(
    `FFmpeg version mismatch.\n` +
      `  expected pinned: ${PINNED}\n` +
      `  found:           ${firstLine || '(no version line)'}\n` +
      `  The golden-frame gate requires the pinned build. Install ${PINNED}\n` +
      `  (Pipeline.md §2.6) or use the containerized worker:  docker compose up render-worker`,
  );
}

console.log(`✔ FFmpeg ${PINNED} OK  (${firstLine})`);
process.exit(0);
