import { useCallback, useMemo, useRef, useState } from 'react';
import { useEditorStore } from '../../store/editorStore.js';
import { Button, cx } from '../ui/index.js';
import type { Track, CaptionBlock } from '@videoforge/project-schema';
import { apiPresign, apiConfirmUpload, apiPollAssetReady, fileHash, type AssetRecord } from '../../lib/api.js';

// MediaPanel — left rail (§7.A). Three-section rail: Media / Text / Captions.
// "Import media" does the full real S3 upload flow (presign → PUT → confirm →
// poll asset:ready) and adds the ready asset to the local library.

type MediaKind = 'video' | 'audio' | 'image';
type TabKind = 'media' | 'text' | 'captions';

export interface MediaAsset {
  id: string;
  name: string;
  kind: MediaKind;
  duration: string;
  status: 'uploading' | 'processing' | 'ready' | 'error';
  proxyUrl: string | null;
  thumbnailUrl: string | null;
  errorMsg?: string;
}

const KIND_GLYPH: Record<MediaKind, string> = { video: '▣', audio: '♪', image: '🖼' };

function kindFromMime(mime: string): MediaKind {
  if (mime.startsWith('audio/')) return 'audio';
  if (mime.startsWith('image/')) return 'image';
  return 'video';
}

function durationLabel(ms: number | null): string {
  if (!ms) return '?:??';
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function defaultTrackFor(kind: MediaKind, tracks: Track[]): Track | undefined {
  if (kind === 'audio') return tracks.find((t) => t.type === 'audio' || t.type === 'voiceover');
  return tracks.find((t) => t.type === 'video');
}

// ── SRT parser ────────────────────────────────────────────────────────────────

function parseSrt(text: string): Array<{ id: string; startMs: number; endMs: number; text: string }> {
  const blocks: Array<{ id: string; startMs: number; endMs: number; text: string }> = [];
  const srtTimeToMs = (t: string): number => {
    const [hms, msStr] = t.split(',');
    const [h, m, s] = (hms ?? '').split(':').map(Number);
    return ((h ?? 0) * 3600 + (m ?? 0) * 60 + (s ?? 0)) * 1000 + Number(msStr ?? 0);
  };
  const parts = text.trim().split(/\n\n+/);
  for (const part of parts) {
    const lines = part.trim().split('\n');
    if (lines.length < 3) continue;
    const timeLine = lines[1] ?? '';
    const match = /(\d{2}:\d{2}:\d{2},\d{3})\s+-->\s+(\d{2}:\d{2}:\d{2},\d{3})/.exec(timeLine);
    if (!match) continue;
    blocks.push({
      id: crypto.randomUUID(),
      startMs: srtTimeToMs(match[1]!),
      endMs: srtTimeToMs(match[2]!),
      text: lines.slice(2).join('\n'),
    });
  }
  return blocks;
}

export default function MediaPanel() {
  const tracks = useEditorStore((s) => s.project.tracks);
  const playheadMs = useEditorStore((s) => s.playheadMs);
  const addClipFromAsset = useEditorStore((s) => s.addClipFromAsset);
  const select = useEditorStore((s) => s.select);
  const addTextOverlay = useEditorStore((s) => s.addTextOverlay);
  const importCaptions = useEditorStore((s) => s.importCaptions);

  const [tab, setTab] = useState<TabKind>('media');
  const [collapsed, setCollapsed] = useState(false);
  const [assets, setAssets] = useState<MediaAsset[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const srtInputRef = useRef<HTMLInputElement>(null);

  // Derive seed assets from clips already on the timeline so the library is never empty.
  const seedAssets = useMemo<MediaAsset[]>(() => {
    const seen = new Map<string, MediaAsset>();
    for (const track of tracks) {
      if (track.type === 'caption' || track.type === 'overlay') continue;
      const kind: MediaKind = track.type === 'audio' || track.type === 'voiceover' ? 'audio' : 'video';
      for (const clip of track.clips) {
        if (seen.has(clip.sourceAssetId)) continue;
        const secs = Math.round((clip.trimOut - clip.trimIn) / 1000);
        seen.set(clip.sourceAssetId, {
          id: clip.sourceAssetId,
          name: `${kind === 'audio' ? 'audio' : 'clip'}_${seen.size + 1}.${kind === 'audio' ? 'mp3' : 'mp4'}`,
          kind,
          duration: `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`,
          status: 'ready',
          proxyUrl: null,
          thumbnailUrl: null,
        });
      }
    }
    return [...seen.values()];
  }, [tracks]);

  const allAssets = useMemo(() => [...seedAssets, ...assets], [seedAssets, assets]);

  const updateAsset = useCallback((id: string, patch: Partial<MediaAsset>) => {
    setAssets((prev) => prev.map((a) => (a.id === id ? { ...a, ...patch } : a)));
  }, []);

  const uploadFile = useCallback(
    async (file: File) => {
      const kind = kindFromMime(file.type);
      const tempId = crypto.randomUUID();

      setAssets((prev) => [
        ...prev,
        { id: tempId, name: file.name, kind, duration: '?:??', status: 'uploading', proxyUrl: null, thumbnailUrl: null },
      ]);

      try {
        // 1. Compute hash for dedup
        const md5Hash = await fileHash(file);

        // 2. Presign (or get existingAssetId on dedup)
        const presign = await apiPresign({
          filename: file.name,
          contentType: file.type,
          fileSize: file.size,
          md5Hash,
        });

        if (presign.existingAssetId) {
          // Duplicate — reuse existing asset
          updateAsset(tempId, { id: presign.existingAssetId, status: 'processing' });
          const ready = await apiPollAssetReady(presign.existingAssetId);
          updateAsset(presign.existingAssetId, {
            status: 'ready',
            duration: durationLabel(ready.durationMs),
            proxyUrl: ready.proxyUrl,
            thumbnailUrl: ready.thumbnailUrl,
          });
          // remove the temp entry (id changed)
          setAssets((prev) => prev.filter((a) => a.id !== tempId));
          return;
        }

        const assetId = presign.assetId!;
        updateAsset(tempId, { id: assetId });

        // 3. PUT the file directly to S3
        await fetch(presign.uploadUrl!, { method: 'PUT', body: file, headers: { 'Content-Type': file.type } });

        // 4. Confirm upload → triggers BullMQ proxy/thumbnail/waveform jobs
        await apiConfirmUpload(assetId);
        updateAsset(assetId, { status: 'processing' });

        // 5. Poll until READY (WebSocket would be faster, but polling works)
        const ready: AssetRecord = await apiPollAssetReady(assetId);
        updateAsset(assetId, {
          name: file.name,
          status: 'ready',
          duration: durationLabel(ready.durationMs),
          proxyUrl: ready.proxyUrl,
          thumbnailUrl: ready.thumbnailUrl,
        });
      } catch (err) {
        updateAsset(tempId, { status: 'error', errorMsg: err instanceof Error ? err.message : String(err) });
      }
    },
    [updateAsset],
  );

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';
    await Promise.all(files.map(uploadFile));
  };

  const handleSrtChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const text = await file.text();
      const blocks = parseSrt(text) as CaptionBlock[];
      importCaptions(blocks);
    } catch {
      // Silently ignore parse errors for MVP
    }
  }, [importCaptions]);

  const handleAddToTimeline = (asset: MediaAsset): void => {
    if (asset.status !== 'ready') return;
    const track = defaultTrackFor(asset.kind, tracks);
    if (!track) return;
    addClipFromAsset(asset.id, track.id, playheadMs);
  };

  if (collapsed) {
    return (
      <div className="flex h-full w-full flex-col items-center gap-2 bg-vf-surface-1 py-2">
        <button
          type="button"
          aria-label="Expand media panel"
          onClick={() => setCollapsed(false)}
          className="flex h-8 w-8 items-center justify-center rounded-sm text-vf-icon-default hover:bg-vf-surface-3 hover:text-vf-text-primary"
        >
          <span aria-hidden="true">▣</span>
        </button>
      </div>
    );
  }

  return (
    <aside role="complementary" aria-label="Media library" className="flex h-full min-h-0 flex-col bg-vf-surface-1">
      {/* Tablist */}
      <div role="tablist" aria-label="Media library sections" className="flex h-9 shrink-0 items-center gap-1 border-b border-vf-border-subtle px-2">
        {(['media', 'text', 'captions'] as TabKind[]).map((key) => (
          <button
            key={key}
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={cx(
              'h-7 rounded-sm px-2 text-xs font-medium capitalize',
              tab === key ? 'border-b-2 border-vf-accent text-vf-text-primary' : 'text-vf-text-secondary hover:text-vf-text-primary',
            )}
          >
            {key === 'media' ? '▣ Media' : key === 'text' ? 'T Text' : 'CC Captions'}
          </button>
        ))}
        <button
          type="button"
          aria-label="Collapse media panel"
          onClick={() => setCollapsed(true)}
          className="ml-auto flex h-7 w-7 items-center justify-center rounded-sm text-vf-icon-muted hover:bg-vf-surface-3 hover:text-vf-text-primary"
        >
          <span aria-hidden="true">«</span>
        </button>
      </div>

      {tab === 'media' && (
        <div role="tabpanel" className="flex min-h-0 flex-1 flex-col">
          <div className="shrink-0 p-3">
            <Button
              variant="secondary"
              fullWidth
              onClick={() => fileInputRef.current?.click()}
              leadingIcon={<span aria-hidden="true">⬆</span>}
              data-testid="import-media-btn"
            >
              Import media
            </Button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
            <div className="grid grid-cols-3 gap-2">
              {allAssets.map((asset) => (
                <button
                  key={asset.id}
                  type="button"
                  disabled={asset.status !== 'ready'}
                  draggable={asset.status === 'ready'}
                  onDragStart={(e) => {
                    e.dataTransfer.setData('application/x-vf-asset', asset.id);
                    e.dataTransfer.setData('application/x-vf-asset-kind', asset.kind);
                    e.dataTransfer.effectAllowed = 'copy';
                  }}
                  onDoubleClick={() => handleAddToTimeline(asset)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleAddToTimeline(asset); }}
                  data-testid="asset-card"
                  title={asset.status === 'uploading' ? 'Uploading…' : asset.status === 'processing' ? 'Processing…' : asset.status === 'error' ? (asset.errorMsg ?? 'Upload failed') : asset.name}
                  className={cx(
                    'group flex flex-col overflow-hidden rounded-lg border text-left',
                    asset.status === 'ready'
                      ? 'border-vf-border-subtle bg-vf-surface-2 hover:border-vf-border-strong'
                      : 'border-vf-border-subtle bg-vf-surface-2 opacity-60',
                  )}
                >
                  <div className="relative flex aspect-video items-center justify-center overflow-hidden bg-vf-surface-3 text-vf-icon-muted">
                    {asset.thumbnailUrl ? (
                      <img src={asset.thumbnailUrl} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <span aria-hidden="true" className="text-lg">{KIND_GLYPH[asset.kind]}</span>
                    )}
                    {(asset.status === 'uploading' || asset.status === 'processing') && (
                      <div className="absolute inset-0 flex items-center justify-center bg-vf-overlay-scrim/70">
                        <span className="text-2xs text-vf-text-secondary">
                          {asset.status === 'uploading' ? 'Uploading…' : 'Processing…'}
                        </span>
                      </div>
                    )}
                    {asset.status === 'error' && (
                      <div
                        className="absolute inset-0 flex items-center justify-center bg-vf-danger-bg/70"
                        title={asset.errorMsg ?? 'Upload failed'}
                      >
                        <span className="max-w-full truncate px-1 text-2xs font-medium text-vf-danger-fg">
                          Error
                        </span>
                      </div>
                    )}
                    <span className="absolute bottom-1 right-1 rounded-pill bg-vf-surface-sunken/80 px-1 text-2xs text-vf-text-secondary vf-tnum">
                      {asset.duration}
                    </span>
                  </div>
                  <div className="truncate px-2 py-1 text-2xs text-vf-text-secondary" title={asset.name}>
                    {asset.name}
                  </div>
                </button>
              ))}
            </div>
            {allAssets.length === 0 && (
              <p className="mt-6 text-center text-2xs text-vf-text-tertiary">
                Import media to get started.
              </p>
            )}
          </div>
        </div>
      )}

      {tab === 'text' && (
        <div role="tabpanel" className="flex min-h-0 flex-1 flex-col gap-2 p-3">
          <p className="text-xs text-vf-text-tertiary">Add a text overlay at the playhead.</p>
          {(['Title', 'Body', 'Caption style'] as const).map((preset) => (
            <button
              key={preset}
              type="button"
              onClick={() => {
                const overlayTrack = tracks.find((t) => t.type === 'overlay');
                if (overlayTrack) {
                  addTextOverlay(preset, overlayTrack.id, playheadMs);
                }
              }}
              className="flex items-center gap-2 rounded-md border border-vf-border-subtle bg-vf-surface-2 px-3 py-2 text-left text-sm text-vf-text-primary hover:bg-vf-surface-3"
            >
              <span aria-hidden="true" className="text-vf-text-tertiary">T</span>
              {preset}
            </button>
          ))}
        </div>
      )}

      {tab === 'captions' && (
        <div role="tabpanel" className="flex min-h-0 flex-1 flex-col gap-2 p-3">
          <Button
            variant="secondary"
            fullWidth
            onClick={() => srtInputRef.current?.click()}
            leadingIcon={<span aria-hidden="true">⬆</span>}
          >
            Import .srt / .vtt
          </Button>
          <Button
            variant="secondary"
            fullWidth
            onClick={() => {
              const captionTrackId = useEditorStore.getState().project.captionTracks[0]?.id;
              const firstBlock = useEditorStore.getState().project.captionTracks[0]?.blocks[0]?.id;
              if (firstBlock) select('caption', firstBlock);
              else if (captionTrackId) select('track', captionTrackId);
            }}
            leadingIcon={<span aria-hidden="true">CC</span>}
          >
            Open caption editor
          </Button>
          <p className="mt-1 text-2xs text-vf-text-tertiary">
            Captions burn into the export or download as a sidecar .srt / .vtt.
          </p>
        </div>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept="video/*,audio/*,image/*"
        multiple
        aria-hidden="true"
        tabIndex={-1}
        className="sr-only"
        onChange={handleFileChange}
        data-testid="media-file-input"
      />
      <input
        ref={srtInputRef}
        type="file"
        accept=".srt,.vtt"
        aria-hidden="true"
        tabIndex={-1}
        className="sr-only"
        onChange={handleSrtChange}
        data-testid="srt-file-input"
      />
    </aside>
  );
}
