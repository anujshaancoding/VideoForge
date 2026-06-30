// Coverage for the 'line' illustration style + FLUX-first engine order (CEO 2026-06-27).
//   • promptFor  — sketch styles (line/pen/…) prompt FOR minimal line art; photo keeps
//                  the old "detailed illustration" anchor.
//   • finishFrame — 'line' and 'photo' keep the base intact (cover-fit, NO sketch filter);
//                  pen/graphite/color run the artistic filter. The behavioural tell: the
//                  pen filter thresholds to near-pure black/white, cover-fit does not.
//   • generateBaseImage engine precedence — ENGINE='auto' tries Pollinations BEFORE
//                  Draw Things; explicit values pin a single engine; placeholder is last.

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import sharp from 'sharp';
import { promptFor, finishFrame } from '../sketchScenes.js';
import {
  ILLUSTRATION_STYLES,
  DEFAULT_ILLUSTRATION_STYLE,
  isIllustrationStyle,
} from '../sketch.js';

const dirs: string[] = [];
async function tmp(): Promise<string> {
  const d = await mkdtemp(join(tmpdir(), 'vf-line-test-'));
  dirs.push(d);
  return d;
}

/** A deterministic 64×64 smooth colour gradient on disk (NOT black-and-white). */
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

/** Fraction of grayscale pixels that are near-black or near-white (the pen-filter tell). */
async function extremesRatio(path: string): Promise<number> {
  const { data, info } = await sharp(path).greyscale().raw().toBuffer({ resolveWithObject: true });
  let extremes = 0;
  for (let i = 0; i < data.length; i += 1) {
    if (data[i]! < 16 || data[i]! > 239) extremes += 1;
  }
  return extremes / (info.width * info.height);
}

afterAll(async () => {
  await Promise.allSettled(dirs.map((d) => rm(d, { recursive: true, force: true })));
});

describe('illustration style registry', () => {
  it("'line' is a valid illustration style and the default", () => {
    expect(isIllustrationStyle('line')).toBe(true);
    expect(ILLUSTRATION_STYLES).toContain('line');
    expect(DEFAULT_ILLUSTRATION_STYLE).toBe('line');
  });
  it('rejects unknown styles', () => {
    expect(isIllustrationStyle('purple')).toBe(false);
    expect(isIllustrationStyle(undefined)).toBe(false);
  });
});

describe('promptFor', () => {
  it('photo mode keeps the detailed-illustration anchor', () => {
    const p = promptFor('a quiet harbour', ['boats', 'dawn'], 'photo');
    expect(p).toContain('detailed illustration');
    expect(p).toContain('a quiet harbour');
    expect(p).not.toContain('continuous line drawing');
  });

  it.each(['line', 'pen', 'graphite', 'color'] as const)(
    'sketch style %s prompts FOR minimal line art (not a detailed render)',
    (style) => {
      const p = promptFor('a calm woman', ['flower'], style);
      expect(p).toContain('single continuous line drawing');
      expect(p).toContain('line art');
      expect(p).toContain('a calm woman');
      expect(p).not.toContain('detailed illustration');
    },
  );

  it('falls back to a generic subject when description+keywords are empty', () => {
    const p = promptFor('', [], 'line');
    expect(p).toContain('a simple scene');
  });
});

describe('finishFrame routing (line/photo skip the sketch filter)', () => {
  const target = { width: 256, height: 256 };

  it.each(['line', 'photo'] as const)(
    'style=%s cover-fits the base intact (gradient preserved, NOT thresholded)',
    async (style) => {
      const dir = await tmp();
      const src = await fixtureImage(dir);
      const out = await finishFrame(src, style, 1, target);
      dirs.push(dirname(out));
      const meta = await sharp(out).metadata();
      expect(meta.width).toBe(256);
      expect(meta.height).toBe(256);
      // A smooth gradient cover-fit stays a gradient → very few black/white extremes.
      expect(await extremesRatio(out)).toBeLessThan(0.5);
    },
  );

  it('style=pen runs the ink filter (output is near pure black-and-white)', async () => {
    const dir = await tmp();
    const src = await fixtureImage(dir);
    const out = await finishFrame(src, 'pen', 1, target);
    dirs.push(dirname(out));
    expect(await extremesRatio(out)).toBeGreaterThan(0.9);
  });
});

describe('generateBaseImage engine precedence', () => {
  const PNG_1PX_B64 =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/1eaAAAAAElFTkSuQmCC';

  const calls: string[] = [];
  function installFetch(opts: { pollinationsOk: boolean; drawThingsOk: boolean }): void {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL) => {
        const u = String(url);
        if (u.includes('pollinations')) {
          calls.push('pollinations');
          if (!opts.pollinationsOk) return { ok: true, arrayBuffer: async () => Buffer.alloc(64) };
          return { ok: true, arrayBuffer: async () => Buffer.alloc(8192) };
        }
        if (u.includes('7860') || u.includes('txt2img')) {
          calls.push('drawthings');
          if (!opts.drawThingsOk) return { ok: false };
          return { ok: true, json: async () => ({ images: [PNG_1PX_B64] }) };
        }
        calls.push('unknown');
        return { ok: false };
      }),
    );
  }

  async function load(engine: string): Promise<typeof import('../imagegen.js').generateBaseImage> {
    vi.resetModules();
    process.env['IMAGEGEN_ENGINE'] = engine;
    return (await import('../imagegen.js')).generateBaseImage;
  }

  beforeEach(() => {
    calls.length = 0;
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("auto: tries Pollinations FIRST and uses it on success (Draw Things never called)", async () => {
    installFetch({ pollinationsOk: true, drawThingsOk: true });
    const gen = await load('auto');
    const res = await gen('a cat', { seed: 1, width: 64, height: 64 });
    dirs.push(dirname(res.pngPath));
    expect(res.source).toBe('pollinations');
    expect(calls[0]).toBe('pollinations');
    expect(calls).not.toContain('drawthings');
  });

  it('auto: falls back to Draw Things when Pollinations throttles (order: pollinations→drawthings)', async () => {
    installFetch({ pollinationsOk: false, drawThingsOk: true });
    const gen = await load('auto');
    const res = await gen('a cat', { seed: 1, width: 64, height: 64 });
    dirs.push(dirname(res.pngPath));
    expect(res.source).toBe('drawthings');
    expect(calls).toEqual(['pollinations', 'drawthings']);
  });

  it('explicit drawthings: never touches Pollinations', async () => {
    installFetch({ pollinationsOk: true, drawThingsOk: true });
    const gen = await load('drawthings');
    const res = await gen('a cat', { seed: 1, width: 64, height: 64 });
    dirs.push(dirname(res.pngPath));
    expect(res.source).toBe('drawthings');
    expect(calls).not.toContain('pollinations');
  });

  it('both engines down → deterministic placeholder PNG', async () => {
    installFetch({ pollinationsOk: false, drawThingsOk: false });
    const gen = await load('auto');
    const res = await gen('a cat', { seed: 5, width: 64, height: 64 });
    dirs.push(dirname(res.pngPath));
    expect(res.source).toBe('placeholder');
    const bytes = await readFile(res.pngPath);
    expect(bytes.subarray(0, 4)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  });
});
