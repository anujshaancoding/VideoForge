// Image-gen seam — the placeholder fallback must always yield a real, deterministic
// PNG so the assemble/arrange/export path runs on a box with no image engine (CI).
// We force ENGINE to a non-network value ('placeholder') BEFORE importing the module,
// so the test never touches Draw Things or the network and is fast + deterministic.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFile, rm } from 'node:fs/promises';
import { dirname } from 'node:path';

let generateBaseImage: typeof import('../imagegen.js').generateBaseImage;
const cleanup: string[] = [];

beforeAll(async () => {
  process.env['IMAGEGEN_ENGINE'] = 'placeholder';
  ({ generateBaseImage } = await import('../imagegen.js'));
});

afterAll(async () => {
  await Promise.allSettled(cleanup.map((d) => rm(d, { recursive: true, force: true })));
});

describe('generateBaseImage (placeholder fallback)', () => {
  it('always returns a real PNG with source=placeholder', async () => {
    const res = await generateBaseImage('a quiet harbour at dawn', { seed: 7, width: 128, height: 128 });
    cleanup.push(dirname(res.pngPath));
    expect(res.source).toBe('placeholder');
    const bytes = await readFile(res.pngPath);
    expect(bytes.subarray(0, 4)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    expect(bytes.byteLength).toBeGreaterThan(100);
  });

  it('is deterministic for a given seed (same tint bytes)', async () => {
    const a = await generateBaseImage('x', { seed: 42, width: 64, height: 64 });
    const b = await generateBaseImage('different prompt', { seed: 42, width: 64, height: 64 });
    cleanup.push(dirname(a.pngPath), dirname(b.pngPath));
    const [ba, bb] = await Promise.all([readFile(a.pngPath), readFile(b.pngPath)]);
    // Placeholder tint depends only on seed+size → identical bytes.
    expect(ba.equals(bb)).toBe(true);
  });
});
