// ─────────────────────────────────────────────────────────────────────────────
// Unit tests for the in-filter sentinel substitution used by the text-overlay
// drawtext stage (Text_Overlay_Export_Spec.md §10.3). The builder embeds
// `__VF_FONT_*__` / `__VF_OVERLAYTEXT_*__` tokens inside the `-filter_complex`
// string (drawtext reads font/text by option, not as an `-i` stream); the worker
// must rewrite them THERE — a whole-arg swap cannot reach inside the graph string.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect, vi } from 'vitest';

// Mock the S3 helpers so importing worker.js does no real I/O (mirrors the other
// worker unit tests). vi.mock is hoisted above the import below.
vi.mock('../s3.js', () => ({
  downloadFromS3: vi.fn(),
  uploadToS3: vi.fn(),
  cleanupFile: vi.fn(),
  BUCKET_ORIGINALS: 'vf-originals',
  BUCKET_PROXIES: 'vf-proxies',
  BUCKET_EXPORTS: 'vf-exports',
}));

import { substituteFilterTokens } from '../worker.js';

describe('substituteFilterTokens — in-filter sentinel rewrite', () => {
  it('replaces font + overlay-text sentinels ONLY inside the -filter_complex value', () => {
    const args = [
      '-i',
      '__VF_FONT_Inter-SemiBold.ttf__', // a NON-filter arg that happens to contain a token
      '-filter_complex',
      "[v]drawtext=fontfile=__VF_FONT_Inter-SemiBold.ttf__:textfile=__VF_OVERLAYTEXT_abc__:fontsize=48[o]",
      '-map',
      '[o]',
    ];
    const out = substituteFilterTokens(
      args,
      new Map([
        ['__VF_FONT_Inter-SemiBold.ttf__', '/usr/share/fonts/inter/Inter-SemiBold.ttf'],
        ['__VF_OVERLAYTEXT_abc__', '/tmp/vf-overlaytext-x-abc.txt'],
      ]),
    );
    // The filter value is rewritten…
    expect(out[3]).toBe(
      '[v]drawtext=fontfile=/usr/share/fonts/inter/Inter-SemiBold.ttf:textfile=/tmp/vf-overlaytext-x-abc.txt:fontsize=48[o]',
    );
    // …but the standalone arg at index 1 (not after -filter_complex) is untouched.
    expect(out[1]).toBe('__VF_FONT_Inter-SemiBold.ttf__');
  });

  it('replaces every occurrence of a token (multiple overlays sharing one font)', () => {
    const args = [
      '-filter_complex',
      '[a]drawtext=fontfile=__VF_FONT_Inter-Bold.ttf__[b];[b]drawtext=fontfile=__VF_FONT_Inter-Bold.ttf__[c]',
    ];
    const out = substituteFilterTokens(
      args,
      new Map([['__VF_FONT_Inter-Bold.ttf__', '/fonts/Inter-Bold.ttf']]),
    );
    expect(out[1]).toBe(
      '[a]drawtext=fontfile=/fonts/Inter-Bold.ttf[b];[b]drawtext=fontfile=/fonts/Inter-Bold.ttf[c]',
    );
  });

  it('is a no-op when there are no replacements', () => {
    const args = ['-filter_complex', '[v]copy[o]'];
    expect(substituteFilterTokens(args, new Map())).toEqual(args);
  });

  it('does not touch args when no -filter_complex flag is present', () => {
    const args = ['-i', 'in.mp4', '__VF_FONT_X__'];
    const out = substituteFilterTokens(args, new Map([['__VF_FONT_X__', '/fonts/X']]));
    expect(out).toEqual(args); // index 2 is not preceded by -filter_complex
  });
});
