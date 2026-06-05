// ─────────────────────────────────────────────────────────────────────────────
// Sidecar caption format threading (Batch-1 P0 fix).
//
// The export modal lets the user pick a sidecar caption format (.srt | .vtt). That
// choice used to be dropped: the worker only ever wrote SRT, and only on the BURN
// path. These tests pin the pure helpers that resolve the chosen format and serialise
// the caption track to it — so the file written next to the MP4 matches the request.
//
// Pure logic only — S3 mocked so importing worker.js does no I/O (mirrors
// selectRenderDocument.test.ts / resolveAssets.test.ts).
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect, vi } from 'vitest';
import { sampleProject, type Project, type CaptionTrack } from '@videoforge/project-schema';
import { captionsToSrt } from '@videoforge/ffmpeg-graph';

vi.mock('../s3.js', () => ({
  downloadFromS3: vi.fn(),
  uploadToS3: vi.fn(),
  cleanupFile: vi.fn(),
  BUCKET_ORIGINALS: 'vf-originals',
  BUCKET_PROXIES: 'vf-proxies',
  BUCKET_EXPORTS: 'vf-exports',
}));

const { resolveSidecarFmt, buildSidecar, captionsToVtt } = await import('../worker.js');

/** The sample project's first caption track (has ≥1 block). */
function captionTrack(): CaptionTrack {
  const doc: Project = JSON.parse(JSON.stringify(sampleProject));
  const track = doc.captionTracks[0];
  if (!track || track.blocks.length === 0) throw new Error('sample needs caption blocks');
  return track;
}

describe('resolveSidecarFmt — read the chosen format from raw job settings', () => {
  it('returns .vtt when the client asked for it', () => {
    expect(resolveSidecarFmt({ sidecarFmt: '.vtt' })).toBe('.vtt');
  });

  it('defaults to .srt for .srt / missing / bogus values', () => {
    expect(resolveSidecarFmt({ sidecarFmt: '.srt' })).toBe('.srt');
    expect(resolveSidecarFmt({})).toBe('.srt');
    expect(resolveSidecarFmt(undefined)).toBe('.srt');
    expect(resolveSidecarFmt({ sidecarFmt: 'nonsense' })).toBe('.srt');
  });
});

describe('buildSidecar — serialise to the requested format', () => {
  it('.srt path reuses the shared captionsToSrt bytes exactly', () => {
    const track = captionTrack();
    expect(buildSidecar(track, '.srt')).toBe(captionsToSrt(track));
  });

  it('.vtt path emits a WEBVTT header and dot-separated timestamps', () => {
    const track = captionTrack();
    const vtt = buildSidecar(track, '.vtt');
    expect(vtt.startsWith('WEBVTT\n')).toBe(true);
    // Timing lines use '.' (not ',') for the millisecond separator.
    expect(/\d{2}:\d{2}:\d{2}\.\d{3} --> \d{2}:\d{2}:\d{2}\.\d{3}/.test(vtt)).toBe(true);
    expect(vtt).not.toMatch(/\d{2}:\d{2}:\d{2},\d{3} -->/);
  });

  it('captionsToVtt preserves the SRT cue text + count (only header/separators differ)', () => {
    const track = captionTrack();
    const srt = captionsToSrt(track);
    const vtt = captionsToVtt(track);
    // Same number of cues (each cue body line survives the transform).
    for (const block of track.blocks) {
      expect(vtt.includes(block.text)).toBe(true);
    }
    // The VTT body is the SRT body with the header prepended + commas→dots on timings.
    expect(vtt).toBe(
      'WEBVTT\n\n' +
        srt.replace(
          /(\d{2}:\d{2}:\d{2}),(\d{3})(\s*-->\s*)(\d{2}:\d{2}:\d{2}),(\d{3})/g,
          '$1.$2$3$4.$5',
        ),
    );
  });
});
