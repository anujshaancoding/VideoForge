// ─────────────────────────────────────────────────────────────────────────────
// FreePD-tier CC0 music bed generator (one-shot, committed output).
//
// FreePD.com (the intended CC0 source) is permanently closed (confirmed 2026-06).
// To keep a $0, no-runtime-fetch, CC0 bundled music set, these short loopable beds
// are SYNTHESIZED here and dedicated to the public domain (CC0 1.0). They are
// authored by Zentrix Studio for VideoForge; no third-party rights attach. Run
// `node fixtures/music/generate-beds.mjs` to regenerate (deterministic).
//
// Output: a few short (8s) loopable mono 16-bit PCM WAV beds — simple, low-energy
// chord pads so they sit UNDER voiceover (the assembler ducks them further via the
// existing volume envelope). Real audio files → exported through the unchanged
// ffmpeg audio chain, indistinguishable from an uploaded MP3.
// ─────────────────────────────────────────────────────────────────────────────

import { writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SAMPLE_RATE = 44100;
const DURATION_S = 8;

function wavFromSamples(float32) {
  const n = float32.length;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0, 'ascii');
  buf.writeUInt32LE(36 + n * 2, 4);
  buf.write('WAVE', 8, 'ascii');
  buf.write('fmt ', 12, 'ascii');
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22); // mono
  buf.writeUInt32LE(SAMPLE_RATE, 24);
  buf.writeUInt32LE(SAMPLE_RATE * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36, 'ascii');
  buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    const s = Math.max(-1, Math.min(1, float32[i]));
    buf.writeInt16LE(Math.round(s * 32767 * 0.6), 44 + i * 2); // -ish headroom
  }
  return buf;
}

// A gentle pad: a root chord with a slow tremolo + soft attack/release loop seam.
function makeBed(rootHz, chordRatios) {
  const total = SAMPLE_RATE * DURATION_S;
  const out = new Float32Array(total);
  for (let i = 0; i < total; i++) {
    const t = i / SAMPLE_RATE;
    let v = 0;
    for (const r of chordRatios) {
      v += Math.sin(2 * Math.PI * rootHz * r * t);
    }
    v /= chordRatios.length;
    // slow tremolo (loops cleanly at 8s: 4 cycles)
    const trem = 0.85 + 0.15 * Math.sin(2 * Math.PI * 0.5 * t);
    // crossfade the loop seam so it tiles without a click (fade first/last 0.25s)
    const fade = 0.25;
    let env = 1;
    if (t < fade) env = t / fade;
    else if (t > DURATION_S - fade) env = (DURATION_S - t) / fade;
    out[i] = v * trem * env;
  }
  return out;
}

const beds = [
  { name: 'bed-calm-cmaj.wav', root: 130.81, chord: [1, 1.26, 1.5] }, // C3 major-ish
  { name: 'bed-warm-amin.wav', root: 110.0, chord: [1, 1.2, 1.5] }, // A2 minor-ish
  { name: 'bed-bright-gmaj.wav', root: 196.0, chord: [1, 1.26, 1.5] }, // G3 major-ish
];

for (const b of beds) {
  const wav = wavFromSamples(makeBed(b.root, b.chord));
  writeFileSync(join(HERE, b.name), wav);
  console.log(`wrote ${b.name} (${wav.length} bytes)`);
}
