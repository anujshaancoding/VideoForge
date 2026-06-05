import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useEditorStore } from '../../store/editorStore.js';
import { useAssetStore, getAssetMeta } from '../../store/assetStore.js';
import { Button, cx } from '../ui/index.js';
import type { Track, CaptionBlock } from '@videoforge/project-schema';
import { apiPresign, apiUploadToS3, apiConfirmUpload, apiGetAsset, apiPollAssetReady, fileHash, type AssetRecord } from '../../lib/api.js';
import { wsClient } from '../../lib/wsClient.js';
import { readViewPrefs, writeViewPrefs } from '../../lib/viewPrefs.js';
import { parseCaptions } from '../../lib/captions.js';

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
  /** 0–100 byte-upload progress; set only while status === 'uploading'. */
  progress?: number;
  /** The source File, retained so a failed upload can be retried. */
  file?: File;
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

export default function MediaPanel() {
  const tracks = useEditorStore((s) => s.project.tracks);
  // NOTE: do NOT subscribe to playheadMs here — this panel (asset grid + waveforms)
  // would otherwise re-render ~20×/s during playback and on every scrub. The handlers
  // read the live playhead from getState() on demand instead.
  const addClipFromAsset = useEditorStore((s) => s.addClipFromAsset);
  const addTrack = useEditorStore((s) => s.addTrack);
  const select = useEditorStore((s) => s.select);
  const addTextOverlay = useEditorStore((s) => s.addTextOverlay);
  const importCaptions = useEditorStore((s) => s.importCaptions);
  const registerFromRecord = useAssetStore((s) => s.registerFromRecord);

  // Seed the left-rail view prefs (active tab + collapsed) from localStorage so the
  // workspace looks the same after a reload. These are UI-only; they never touch the
  // project document.
  const [tab, setTab] = useState<TabKind>(() => readViewPrefs().leftPanelTab ?? 'media');
  const [collapsed, setCollapsed] = useState<boolean>(() => readViewPrefs().leftPanelCollapsed ?? false);
  const [assets, setAssets] = useState<MediaAsset[]>([]);

  // Persist the left-rail view prefs whenever they change.
  useEffect(() => {
    writeViewPrefs({ leftPanelTab: tab, leftPanelCollapsed: collapsed });
  }, [tab, collapsed]);
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

  // WebSocket push: flip a matching uploading/processing asset to ready the moment
  // the backend broadcasts asset:ready, in addition to the HTTP poll fallback in
  // uploadFile(). Matches by assetId; ignores events for assets we don't track.
  useEffect(() => {
    const off = wsClient.on('asset:ready', (payload) => {
      const assetId = payload['assetId'];
      if (typeof assetId !== 'string') return;
      setAssets((prev) => {
        const target = prev.find((a) => a.id === assetId);
        // Ignore events for assets not in our library, or already settled.
        if (!target || target.status === 'ready' || target.status === 'error') return prev;
        // Optimistically flip to ready now; fetch the full record for URLs/duration.
        void apiGetAsset(assetId)
          .then((rec) => {
            registerFromRecord(rec);
            updateAsset(assetId, {
              status: 'ready',
              duration: durationLabel(rec.durationMs),
              proxyUrl: rec.proxyUrl,
              thumbnailUrl: rec.thumbnailUrl,
            });
          })
          .catch(() => {
            // The poll in uploadFile() remains the source of truth on fetch failure.
          });
        return prev.map((a) => (a.id === assetId ? { ...a, status: 'ready' } : a));
      });
    });
    return off;
  }, [updateAsset, registerFromRecord]);

  // WebSocket push: the worker publishes `asset:failed` when server-side processing
  // (proxy/thumbnail/waveform) fails — the HTTP poll path only catches upload-leg
  // errors, so without this the card would spin on "Processing…" forever. Flip the
  // matching card to the error/retry state (the same one upload failures use).
  useEffect(() => {
    const off = wsClient.on('asset:failed', (payload) => {
      const assetId = payload['assetId'];
      if (typeof assetId !== 'string') return;
      const message = typeof payload['message'] === 'string' ? payload['message'] : undefined;
      setAssets((prev) => {
        const target = prev.find((a) => a.id === assetId);
        // Ignore events for assets we don't track, or that already settled.
        if (!target || target.status === 'ready' || target.status === 'error') return prev;
        return prev.map((a) =>
          a.id === assetId
            ? { ...a, status: 'error', errorMsg: message ?? 'Processing failed' }
            : a,
        );
      });
    });
    return off;
  }, []);

  const uploadFile = useCallback(
    async (file: File) => {
      const kind = kindFromMime(file.type);
      const tempId = crypto.randomUUID();

      setAssets((prev) => [
        ...prev,
        { id: tempId, name: file.name, kind, duration: '?:??', status: 'uploading', progress: 0, proxyUrl: null, thumbnailUrl: null, file },
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
          registerFromRecord(ready);
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

        // 3. PUT the file directly to S3, reporting real byte-upload progress
        await apiUploadToS3(presign.uploadUrl!, file, (pct) => updateAsset(assetId, { progress: pct }));

        // 4. Confirm upload → triggers BullMQ proxy/thumbnail/waveform jobs.
        //    Server-side processing has no byte progress, so the card switches to
        //    an indeterminate "Processing…" bar (independent of the progress value).
        await apiConfirmUpload(assetId);
        updateAsset(assetId, { status: 'processing' });

        // 5. Poll until READY (WebSocket would be faster, but polling works)
        const ready: AssetRecord = await apiPollAssetReady(assetId);
        registerFromRecord(ready);
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
    [updateAsset, registerFromRecord],
  );

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';
    await Promise.all(files.map(uploadFile));
  };

  // Drag-and-drop import: accept media files dropped anywhere on the Media tab.
  const [dragOver, setDragOver] = useState(false);
  const handleMediaDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const files = Array.from(e.dataTransfer.files ?? []).filter(
        (f) => f.type.startsWith('video/') || f.type.startsWith('audio/') || f.type.startsWith('image/'),
      );
      if (files.length) void Promise.all(files.map(uploadFile));
    },
    [uploadFile],
  );

  // Retry a failed upload using the retained File.
  const retryUpload = useCallback(
    (asset: MediaAsset) => {
      if (!asset.file) return;
      setAssets((prev) => prev.filter((a) => a.id !== asset.id));
      void uploadFile(asset.file);
    },
    [uploadFile],
  );

  const handleSrtChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const text = await file.text();
      const blocks = parseCaptions(text) as CaptionBlock[];
      importCaptions(blocks);
    } catch {
      // Silently ignore parse errors for MVP
    }
  }, [importCaptions]);

  // Text tab: drop a text overlay at the playhead. A fresh project (newProject)
  // seeds only a video track — no overlay lane — so without this we'd silently
  // no-op. Create the overlay lane on demand (mirrors handleAddToTimeline's
  // "make the right lane if none exists" behaviour) so the very first overlay works.
  const handleAddTextOverlay = (preset: 'Title' | 'Body' | 'Caption style'): void => {
    let overlayTrack = tracks.find((t) => t.type === 'overlay');
    if (!overlayTrack) {
      addTrack('overlay');
      overlayTrack = useEditorStore.getState().project.tracks.find((t) => t.type === 'overlay');
    }
    if (!overlayTrack) return;
    addTextOverlay(preset, overlayTrack.id, useEditorStore.getState().playheadMs);
  };

  const handleAddToTimeline = (asset: MediaAsset): void => {
    if (asset.status !== 'ready') return;
    let track = defaultTrackFor(asset.kind, tracks);
    if (!track) {
      // Empty project (or every track was deleted): create the right lane first so
      // double-click / Enter "just works" instead of silently no-opping.
      addTrack(asset.kind === 'audio' ? 'audio' : 'video');
      track = defaultTrackFor(asset.kind, useEditorStore.getState().project.tracks);
    }
    if (!track) return;
    const durationMs = getAssetMeta(asset.id)?.durationMs ?? undefined;
    // Append AFTER the track's existing content so clips never overlap (the user
    // wants to add "at the end"); if the playhead is already past the content,
    // drop it there instead so a deliberate gap is honoured.
    const clips = 'clips' in track ? track.clips : [];
    const trackEnd = clips.reduce((max, c) => Math.max(max, c.endOnTimeline), 0);
    const atMs = Math.max(useEditorStore.getState().playheadMs, trackEnd);
    addClipFromAsset(asset.id, track.id, atMs, durationMs);
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
        <div
          role="tabpanel"
          className={cx(
            'flex min-h-0 flex-1 flex-col',
            dragOver && 'outline-2 -outline-offset-2 outline-dashed outline-vf-accent',
          )}
          onDragOver={(e) => {
            if (e.dataTransfer.types.includes('Files')) {
              e.preventDefault();
              e.dataTransfer.dropEffect = 'copy';
              setDragOver(true);
            }
          }}
          onDragLeave={(e) => { if (e.currentTarget === e.target) setDragOver(false); }}
          onDrop={handleMediaDrop}
        >
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
            <p className="mt-1 text-center text-2xs text-vf-text-tertiary">or drag &amp; drop files here</p>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
            <div className="grid grid-cols-2 gap-2.5">
              {allAssets.map((asset) => (
                <button
                  key={asset.id}
                  type="button"
                  disabled={asset.status !== 'ready' && asset.status !== 'error'}
                  draggable={asset.status === 'ready'}
                  onDragStart={(e) => {
                    e.dataTransfer.setData('application/x-vf-asset', asset.id);
                    e.dataTransfer.setData('application/x-vf-asset-kind', asset.kind);
                    e.dataTransfer.effectAllowed = 'copy';
                  }}
                  onClick={() => { if (asset.status === 'error') retryUpload(asset); }}
                  onDoubleClick={() => handleAddToTimeline(asset)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      if (asset.status === 'error') retryUpload(asset);
                      else handleAddToTimeline(asset);
                    }
                  }}
                  data-testid="asset-card"
                  title={asset.status === 'uploading' ? 'Uploading…' : asset.status === 'processing' ? 'Processing…' : asset.status === 'error' ? `${asset.errorMsg ?? 'Upload failed'} — click to retry` : asset.name}
                  className={cx(
                    'group flex flex-col overflow-hidden rounded-lg border bg-vf-surface-2 text-left transition-colors',
                    asset.status === 'ready' && 'cursor-grab border-vf-border-subtle hover:border-vf-border-strong',
                    asset.status === 'error' && 'cursor-pointer border-vf-danger-fg/40 hover:border-vf-danger-fg',
                    (asset.status === 'uploading' || asset.status === 'processing') && 'cursor-default border-vf-border-subtle',
                  )}
                >
                  <div className="relative flex aspect-video items-center justify-center overflow-hidden bg-vf-surface-3 text-vf-icon-muted">
                    {asset.status === 'uploading' ? (
                      // Uploading: real byte-progress bar + percentage (no glyph behind it).
                      <div className="flex w-full flex-col items-center justify-center gap-2 px-4">
                        <span className="text-2xs font-medium text-vf-text-secondary vf-tnum">
                          Uploading {asset.progress ?? 0}%
                        </span>
                        <div className="h-1.5 w-full overflow-hidden rounded-pill bg-vf-surface-sunken">
                          <div
                            className="h-full rounded-pill bg-vf-accent transition-[width] duration-200 ease-out"
                            style={{ width: `${asset.progress ?? 0}%` }}
                          />
                        </div>
                      </div>
                    ) : asset.status === 'processing' ? (
                      // Processing: a SPINNER (reads as "working", not an infinite bar).
                      <div className="flex flex-col items-center justify-center gap-1.5">
                        <span
                          aria-hidden="true"
                          className="h-5 w-5 animate-spin rounded-full border-2 border-vf-surface-sunken border-t-vf-accent"
                        />
                        <span className="text-2xs font-medium text-vf-text-secondary">Processing</span>
                      </div>
                    ) : asset.status === 'error' ? (
                      <div className="flex flex-col items-center justify-center gap-0.5 text-vf-danger-fg" title={asset.errorMsg ?? 'Upload failed'}>
                        <span aria-hidden="true" className="text-base">⚠</span>
                        <span className="text-2xs font-medium">Failed</span>
                        <span className="text-[10px] opacity-80">↻ Retry</span>
                      </div>
                    ) : asset.thumbnailUrl ? (
                      <img src={asset.thumbnailUrl} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <span aria-hidden="true" className="text-3xl opacity-70">{KIND_GLYPH[asset.kind]}</span>
                    )}
                    {asset.status === 'ready' && (
                      <span className="absolute bottom-1 right-1 rounded-pill bg-vf-surface-sunken/90 px-1.5 py-0.5 text-2xs text-vf-text-secondary vf-tnum">
                        {asset.duration}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1 px-2 py-1.5">
                    <span aria-hidden="true" className="shrink-0 text-2xs text-vf-text-tertiary">{KIND_GLYPH[asset.kind]}</span>
                    <span className="truncate text-xs text-vf-text-secondary" title={asset.name}>
                      {asset.name}
                    </span>
                  </div>
                </button>
              ))}
            </div>
            {allAssets.length === 0 && (
              // Editor first-open empty state (§6.3): a prominent dashed drop-zone — the
              // brand's first call to action. Clicking it opens the same file picker as
              // "Import media"; dropping a file is already handled by the tabpanel above
              // (the dashed accent outline lights up via the shared `dragOver` state).
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                data-testid="media-empty-dropzone"
                className={cx(
                  'mt-2 flex w-full flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-4 py-10 text-center transition-colors',
                  dragOver
                    ? 'border-vf-accent bg-vf-accent-subtle'
                    : 'border-vf-border-default hover:border-vf-border-strong hover:bg-vf-surface-2',
                )}
              >
                <span aria-hidden="true" className="text-2xl text-vf-text-tertiary">⬆</span>
                <span className="text-sm font-medium text-vf-text-primary">Drop a video here</span>
                <span className="text-2xs text-vf-text-tertiary">or click Import media above</span>
                <span className="text-2xs text-vf-text-tertiary">MP4 · MOV · MKV · MP3 · WAV</span>
              </button>
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
              onClick={() => handleAddTextOverlay(preset)}
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
