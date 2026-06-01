#!/usr/bin/env tsx
// Generates synthetic CC0 test fixtures using FFmpeg lavfi sources.
// Run: tsx scripts/generate-fixtures.ts
// Requires: ffmpeg on PATH or FFMPEG_PATH env var

import { execSync } from 'node:child_process';
import { mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const FFMPEG = process.env.FFMPEG_PATH ?? 'ffmpeg';
const OUT = join(process.cwd(), 'fixtures/media');

mkdirSync(OUT, { recursive: true });

// 3-second 720p test video (color bars + timestamp burn-in)
if (!existsSync(join(OUT, 'bunny_h264_3s.mp4'))) {
  execSync(
    `${FFMPEG} -y -f lavfi -i "smptehdbars=size=1280x720:rate=30" -f lavfi -i "sine=frequency=440:sample_rate=44100" -t 3 -c:v libx264 -crf 23 -c:a aac -b:a 128k "${join(OUT, 'bunny_h264_3s.mp4')}"`,
    { stdio: 'inherit' }
  );
  console.log('Generated bunny_h264_3s.mp4');
}

// 5-second 440Hz sine wav
if (!existsSync(join(OUT, 'tone_440hz_5s.wav'))) {
  execSync(
    `${FFMPEG} -y -f lavfi -i "sine=frequency=440:sample_rate=44100" -t 5 "${join(OUT, 'tone_440hz_5s.wav')}"`,
    { stdio: 'inherit' }
  );
  console.log('Generated tone_440hz_5s.wav');
}

console.log('All fixtures generated.');
