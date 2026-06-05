// ─────────────────────────────────────────────────────────────────────────────
// #8 — resolveAssets() rendition-choice gate (export parity, §16.3 / §10.2).
//
// The render worker must export from the ORIGINAL asset, never the degraded proxy
// (a 720p preview rendition). The proxy is a LAST RESORT used only when no original
// exists, and that fallback must WARN so it is never silent. This unit test locks
// that contract down with the S3 layer fully mocked (no network / Redis / FFmpeg):
//
//   1. both `original` + `proxy` keys present  → downloads ORIGINAL (vf-originals).
//   2. proxy ONLY                              → downloads proxy (vf-proxies) + warns.
//   3. neither                                 → throws (cannot render).
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { BuildResult, InputSpec } from '@videoforge/ffmpeg-graph';

// ── Mock the S3 helpers so resolveAssets() does no real I/O. ─────────────────────
// vi.mock is hoisted to the top of the module, so the mock fns are CREATED INSIDE
// the factory (referencing a top-level const here would throw "cannot access before
// initialization"). We grab the mocked downloadFromS3 back via vi.mocked after the
// dynamic import below.
vi.mock('../s3.js', () => ({
  downloadFromS3: vi.fn(async (bucket: string, key: string) => `/tmp/dl/${bucket}/${key}`),
  BUCKET_ORIGINALS: 'vf-originals',
  BUCKET_PROXIES: 'vf-proxies',
  BUCKET_EXPORTS: 'vf-exports',
  // unused by resolveAssets but referenced by the module's import surface:
  uploadToS3: vi.fn(),
  cleanupFile: vi.fn(),
  presignGetUrl: vi.fn(),
  s3: {},
}));

// Import AFTER the mock is registered (vi.mock is hoisted above these awaits).
const { resolveAssets } = await import('../worker.js');
const { downloadFromS3: downloadFromS3Mock } = await import('../s3.js');
const downloadFromS3 = vi.mocked(downloadFromS3Mock);

const ASSET_A = 'a6b7c8d9-4354-4567-9782-9d0e1f203143';

/** Minimal BuildResult carrying a single clip input for `assetId`. */
function buildResultFor(assetId: string): BuildResult {
  const input: InputSpec = {
    index: 0,
    kind: 'clip',
    assetId,
    clipId: 'clip-0',
    preArgs: ['-ss', '0', '-to', '1'],
    path: `asset:${assetId}`,
  };
  return {
    args: [],
    filterComplex: '',
    inputs: [input],
    outputLabel: '[vout]',
    textFiles: [],
    fonts: [],
  };
}

beforeEach(() => {
  downloadFromS3.mockClear();
});

describe('resolveAssets() — export-parity rendition choice', () => {
  it('fetches the ORIGINAL (not the proxy) when BOTH keys exist', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const result = buildResultFor(ASSET_A);
    const paths = await resolveAssets(
      result,
      { [ASSET_A]: { original: 'orig/a.mp4', proxy: 'proxy/a.mp4' } },
      'export-1',
    );

    // Downloaded from the ORIGINALS bucket with the original key — proxy ignored.
    expect(downloadFromS3).toHaveBeenCalledTimes(1);
    expect(downloadFromS3).toHaveBeenCalledWith('vf-originals', 'orig/a.mp4');
    expect(downloadFromS3).not.toHaveBeenCalledWith('vf-proxies', expect.anything());
    expect(paths.get(ASSET_A)).toBe('/tmp/dl/vf-originals/orig/a.mp4');
    // No fallback → no warning.
    expect(warn).not.toHaveBeenCalled();

    warn.mockRestore();
  });

  it('falls back to the proxy AND warns when only the proxy key exists', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const result = buildResultFor(ASSET_A);
    const paths = await resolveAssets(
      result,
      { [ASSET_A]: { proxy: 'proxy/a.mp4' } },
      'export-2',
    );

    expect(downloadFromS3).toHaveBeenCalledTimes(1);
    expect(downloadFromS3).toHaveBeenCalledWith('vf-proxies', 'proxy/a.mp4');
    expect(paths.get(ASSET_A)).toBe('/tmp/dl/vf-proxies/proxy/a.mp4');

    // The silent-degradation guard: the fallback MUST warn, naming the asset.
    expect(warn).toHaveBeenCalledTimes(1);
    const warnMsg = String(warn.mock.calls[0]?.[0] ?? '');
    expect(warnMsg).toContain(ASSET_A);
    expect(warnMsg.toLowerCase()).toContain('proxy');

    warn.mockRestore();
  });

  it('throws when NEITHER an original nor a proxy key exists', async () => {
    const result = buildResultFor(ASSET_A);

    await expect(
      resolveAssets(result, { [ASSET_A]: {} }, 'export-3'),
    ).rejects.toThrow(/no S3 key for asset/i);

    // Also throws when the asset is missing from the map entirely.
    await expect(
      resolveAssets(result, {}, 'export-3b'),
    ).rejects.toThrow(/no S3 key for asset/i);

    expect(downloadFromS3).not.toHaveBeenCalled();
  });
});
