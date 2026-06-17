// Sketch post-filter — determinism + validity. The uniform filter is the style/
// consistency lever, so it must be byte-stable (golden-able) and emit valid PNGs.

import { afterAll, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { applySketch, SKETCH_STYLES, DEFAULT_SKETCH_STYLE, isSketchStyle } from '../sketch.js';

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47]); // ‰PNG

const dirs: string[] = [];
async function tmp(): Promise<string> {
  const d = await mkdtemp(join(tmpdir(), 'vf-sketch-test-'));
  dirs.push(d);
  return d;
}

/** A deterministic 64×64 colour test image (smooth gradient) on disk. */
async function fixtureImage(dir: string): Promise<string> {
  const w = 64;
  const h = 64;
  const buf = Buffer.alloc(w * h * 3);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const i = (y * w + x) * 3;
      buf[i] = (x * 4) & 0xff;
      buf[i + 1] = (y * 4) & 0xff;
      buf[i + 2] = ((x + y) * 2) & 0xff;
    }
  }
  const p = join(dir, 'fixture.png');
  await sharp(buf, { raw: { width: w, height: h, channels: 3 } }).png().toFile(p);
  return p;
}

afterAll(async () => {
  await Promise.allSettled(dirs.map((d) => rm(d, { recursive: true, force: true })));
});

describe('applySketch', () => {
  it('default style is pen and the style guard accepts exactly the three styles', () => {
    expect(DEFAULT_SKETCH_STYLE).toBe('pen');
    expect(SKETCH_STYLES).toEqual(['graphite', 'pen', 'color']);
    for (const s of SKETCH_STYLES) expect(isSketchStyle(s)).toBe(true);
    expect(isSketchStyle('purple')).toBe(false);
    expect(isSketchStyle(undefined)).toBe(false);
  });

  it.each(SKETCH_STYLES)('emits a valid, deterministic PNG for style=%s', async (style) => {
    const dir = await tmp();
    const src = await fixtureImage(dir);
    const a = join(dir, `${style}-a.png`);
    const b = join(dir, `${style}-b.png`);

    await applySketch(src, style, a);
    await applySketch(src, style, b);

    const [ba, bb] = await Promise.all([readFile(a), readFile(b)]);
    // Valid PNG signature.
    expect(ba.subarray(0, 4)).toEqual(PNG_SIG);
    // Deterministic: identical input ⇒ byte-identical output (golden-safe).
    expect(ba.equals(bb)).toBe(true);
    // Non-trivial output.
    expect(ba.byteLength).toBeGreaterThan(100);

    // Decodes back to the source dimensions.
    const meta = await sharp(a).metadata();
    expect(meta.width).toBe(64);
    expect(meta.height).toBe(64);
  });

  it('renders at the export canvas size when a target is given (crisp 1080×1920)', async () => {
    const dir = await tmp();
    const src = await fixtureImage(dir); // 64×64 square source
    const out = join(dir, 'pen-1080.png');
    await applySketch(src, 'pen', out, { width: 1080, height: 1920 });
    const meta = await sharp(out).metadata();
    expect(meta.width).toBe(1080);
    expect(meta.height).toBe(1920);
  });

  it('pen output is effectively black-and-white (ink line art)', async () => {
    const dir = await tmp();
    const src = await fixtureImage(dir);
    const out = join(dir, 'pen.png');
    await applySketch(src, 'pen', out);
    // After thresholding, the grayscale histogram should pile up near 0 and 255.
    const { data, info } = await sharp(out).greyscale().raw().toBuffer({ resolveWithObject: true });
    let extremes = 0;
    for (let i = 0; i < data.length; i += 1) {
      if (data[i]! < 16 || data[i]! > 239) extremes += 1;
    }
    expect(extremes / (info.width * info.height)).toBeGreaterThan(0.9);
  });
});
