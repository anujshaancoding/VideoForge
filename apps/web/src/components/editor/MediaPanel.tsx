import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useEditorStore } from '../../store/editorStore.js';
import { useAssetStore, getAssetMeta, kindFromContentType } from '../../store/assetStore.js';
import { Button, cx, Tooltip } from '../ui/index.js';
import type { Track, CaptionBlock } from '@videoforge/project-schema';
import { apiPresign, apiUploadToS3, apiConfirmUpload, apiGetAsset, apiPollAssetReady, fileHash, isAcceptedFormat, SIZE_LIMITS, formatBytes, type AssetRecord } from '../../lib/api.js';
import { wsClient } from '../../lib/wsClient.js';
import { readViewPrefs, writeViewPrefs } from '../../lib/viewPrefs.js';
import { parseCaptions } from '../../lib/captions.js';
import { resolveManifest } from '../../store/templateStore.js';
import { isSlotFilled } from '../../lib/templates.js';
import { Image, Type, Captions, Package, Shapes, Sparkles, ChevronLeft, Upload, Music, AlertTriangle, Pencil, Trash2, Search, X } from 'lucide-react';
import { stockItemsForTab, renderBackgroundToFile, thumbnailCss, STOCK_CATEGORIES, type StockItem } from '../../lib/stockLibrary.js';

// MediaPanel — left rail (§7.A). Three-section rail: Media / Text / Captions.
// "Import media" does the full real S3 upload flow (presign → PUT → confirm →
// poll asset:ready) and adds the ready asset to the local library.

type MediaKind = 'video' | 'audio' | 'image';
type TabKind = 'media' | 'text' | 'captions' | 'stock' | 'elements' | 'ai';

// Suggested creative rail sections per product review (Templates/Uploads/Text/Captions/Elements/Audio...).
// Current implementation focuses on the core three for MVP. Icons + labels make it feel like a proper tool palette.

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

const KIND_GLYPH: Record<MediaKind, React.ReactNode> = {
  video: <Image className="h-5 w-5" aria-hidden="true" />,
  audio: <Music className="h-5 w-5" aria-hidden="true" />,
  image: <Image className="h-5 w-5" aria-hidden="true" />,
};

function kindFromMime(mime: string): MediaKind {
  if (mime.startsWith('audio/')) return 'audio';
  if (mime.startsWith('image/')) return 'image';
  return 'video';
}

function durationLabel(ms: number | null, kind?: MediaKind): string {
  if (!ms) {
    if (kind === 'image') return '0:05';
    return '—';
  }
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function defaultTrackFor(kind: MediaKind, tracks: Track[]): Track | undefined {
  if (kind === 'audio') return tracks.find((t) => t.type === 'audio' || t.type === 'voiceover');
  return tracks.find((t) => t.type === 'video');
}

export default function MediaPanel() {
  const tracks = useEditorStore((s) => s.project.tracks);
  const projectId = useEditorStore((s) => s.project.id);
  // NOTE: do NOT subscribe to playheadMs here — this panel (asset grid + waveforms)
  // would otherwise re-render ~20×/s during playback and on every scrub. The handlers
  // read the live playhead from getState() on demand instead.
  const addClipFromAsset = useEditorStore((s) => s.addClipFromAsset);
  const addTrack = useEditorStore((s) => s.addTrack);
  const select = useEditorStore((s) => s.select);
  const addTextOverlay = useEditorStore((s) => s.addTextOverlay);
  const importCaptions = useEditorStore((s) => s.importCaptions);
  const registerFromRecord = useAssetStore((s) => s.registerFromRecord);
  const renameAssetMeta = useAssetStore((s) => s.renameAsset);
  const deleteAssetMeta = useAssetStore((s) => s.deleteAsset);
  const replaceClipAsset = useEditorStore((s) => s.replaceClipAsset);

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

  const allAssets = useMemo(() => {
    const map = new Map<string, MediaAsset>();
    // seeds (from clips) first, then extra library uploads (avoid dups)
    seedAssets.forEach((a) => map.set(a.id, a));
    assets.forEach((a) => { if (!map.has(a.id)) map.set(a.id, a); });
    return Array.from(map.values());
  }, [seedAssets, assets]);

  // Media-library search + per-kind filter (CEO-greenlit 2026-06-14). UI-only: filters
  // the user's library grid by filename substring (case-insensitive) AND by asset kind.
  // Scoped to the Media tab; does not touch the Stock tab, upload, or timeline behaviour.
  const [search, setSearch] = useState('');
  const [kindFilter, setKindFilter] = useState<'all' | MediaKind>('all');

  const filteredAssets = useMemo(() => {
    const q = search.trim().toLowerCase();
    return allAssets.filter(
      (a) =>
        (kindFilter === 'all' || a.kind === kindFilter) &&
        (q === '' || a.name.toLowerCase().includes(q)),
    );
  }, [allAssets, search, kindFilter]);

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
        // Do NOT flip to 'ready' synchronously: the card only becomes draggable/playable
        // once apiGetAsset registers the asset meta (proxyUrl/duration) in assetStore.
        // Flipping early would present an "unplayable ready" card if the fetch is slow or
        // fails. Fetch first, then flip on success; on failure stay 'processing' (the
        // HTTP poll in uploadFile() remains the source of truth / retry path).
        void apiGetAsset(assetId)
          .then((rec) => {
            registerFromRecord(rec);
            updateAsset(assetId, {
              status: 'ready',
              duration: durationLabel(rec.durationMs, kindFromContentType(rec.contentType)),
              proxyUrl: rec.proxyUrl,
              thumbnailUrl: rec.thumbnailUrl,
            });
          })
          .catch(() => {
            // Keep 'processing'; the uploadFile() poll will settle the card (ready or error).
          });
        return prev;
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

  // Persist the media library (user-uploaded assets not yet in timeline) across reloads.
  // We store only the asset IDs in localStorage per project. On mount/reload for this project,
  // we fetch the records (same as Editor does for referenced assets), register them in assetStore,
  // and populate the local UI list so they appear in the media panel even if never added to a clip.
  useEffect(() => {
    if (!projectId) {
      setAssets([]);
      return;
    }
    // Clear any session-only uploads from previous project; we will repopulate from persisted library.
    setAssets([]);
    const key = `vf_media_library_${projectId}`;
    let ids: string[] = [];
    try {
      ids = JSON.parse(localStorage.getItem(key) || '[]');
    } catch {}
    ids.forEach((id) => {
      // Skip if this asset is already provided via current clips (seedAssets).
      if (seedAssets.some((a) => a.id === id)) return;
      // Fetch + register (like Editor hydration). This makes proxy/thumbnail available
      // for preview/playback even for "library only" (unused) uploads.
      apiGetAsset(id)
        .then((rec) => {
          registerFromRecord(rec);
          const uiAsset: MediaAsset = {
            id: rec.id,
            name: rec.filename || 'media',
            kind: kindFromContentType(rec.contentType),
            duration: durationLabel(rec.durationMs, kindFromContentType(rec.contentType)),
            status: 'ready',
            proxyUrl: rec.proxyUrl,
            thumbnailUrl: rec.thumbnailUrl,
          };
          setAssets((prev) => (prev.some((a) => a.id === id) ? prev : [...prev, uiAsset]));
        })
        .catch(() => {
          // Asset may have been deleted server-side; ignore.
        });
    });
  }, [projectId, registerFromRecord]);

  const uploadFile = useCallback(
    async (file: File): Promise<AssetRecord | null> => {
      const kind = kindFromMime(file.type);
      const tempId = crypto.randomUUID();

      // Pre-flight client-side guards (§3.1): reject unsupported formats and files
      // over the per-kind ceiling BEFORE hashing/presign/upload, with a friendly,
      // self-explaining error card (the server re-validates with 415/413 anyway).
      if (!isAcceptedFormat(file.type, file.name)) {
        setAssets((prev) => [
          ...prev,
          { id: tempId, name: file.name, kind, duration: '—', status: 'error', proxyUrl: null, thumbnailUrl: null,
            errorMsg: 'Format not supported. Use MP4/MOV, MP3/WAV/AAC, or JPG/PNG.' },
        ]);
        return null;
      }
      const sizeLimit = SIZE_LIMITS[kind];
      if (file.size > sizeLimit) {
        setAssets((prev) => [
          ...prev,
          { id: tempId, name: file.name, kind, duration: '—', status: 'error', proxyUrl: null, thumbnailUrl: null,
            errorMsg: `Too large — ${kind} files must be under ${formatBytes(sizeLimit)}.` },
        ]);
        return null;
      }

      setAssets((prev) => [
        ...prev,
        { id: tempId, name: file.name, kind, duration: kind==='image' ? '0:05' : '?:??', status: 'uploading', progress: 0, proxyUrl: null, thumbnailUrl: null, file },
      ]);

      try {
        // 1. Compute content hash for dedup
        const contentHash = await fileHash(file);

        // 2. Presign (or get existingAssetId on dedup)
        const presign = await apiPresign({
          filename: file.name,
          contentType: file.type,
          fileSize: file.size,
          contentHash,
        });

        if (presign.existingAssetId) {
          // Duplicate — reuse existing asset
          updateAsset(tempId, { id: presign.existingAssetId, status: 'processing' });
          const ready = await apiPollAssetReady(presign.existingAssetId);
          registerFromRecord(ready);
          updateAsset(presign.existingAssetId, {
            status: 'ready',
            duration: durationLabel(ready.durationMs, kindFromContentType(ready.contentType)),
            proxyUrl: ready.proxyUrl,
            thumbnailUrl: ready.thumbnailUrl,
          });
          // remove the temp entry (id changed)
          setAssets((prev) => prev.filter((a) => a.id !== tempId));
          return ready;
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
          duration: durationLabel(ready.durationMs, kindFromContentType(ready.contentType)),
          proxyUrl: ready.proxyUrl,
          thumbnailUrl: ready.thumbnailUrl,
        });

        // Persist this upload to the project's media library so it survives reload
        // even if the user never adds it to the timeline.
        const currentPid = useEditorStore.getState().project.id;
        if (currentPid) {
          const key = `vf_media_library_${currentPid}`;
          try {
            const cur: string[] = JSON.parse(localStorage.getItem(key) || '[]');
            if (!cur.includes(assetId)) {
              localStorage.setItem(key, JSON.stringify([...cur, assetId]));
            }
          } catch {}
        }
        return ready;
      } catch (err) {
        updateAsset(tempId, { status: 'error', errorMsg: err instanceof Error ? err.message : String(err) });
        return null;
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
      // Pass ALL dropped files through uploadFile, which validates format/size and
      // surfaces a clear "format not supported" / "too large" error card for any
      // rejected file (rather than silently swallowing it as the old MIME filter did).
      const files = Array.from(e.dataTransfer.files ?? []);
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

  // Library rename (§3.1). Prompt for a new filename, PATCH it, reflect locally.
  // Seed-only assets (derived from timeline clips, not real uploads) have no server
  // record to rename, so we update just the local label for them.
  const handleRenameAsset = useCallback(
    async (asset: MediaAsset) => {
      const next = window.prompt('Rename media', asset.name)?.trim();
      if (!next || next === asset.name) return;
      const isLibraryUpload = assets.some((a) => a.id === asset.id);
      if (isLibraryUpload) {
        try {
          await renameAssetMeta(asset.id, next);
        } catch {
          return; // leave the label unchanged on failure
        }
      }
      updateAsset(asset.id, { name: next });
    },
    [assets, renameAssetMeta, updateAsset],
  );

  // Library delete (§3.1) with an in-use warning: if any timeline clip references
  // this asset (sourceAssetId === asset.id), warn before deleting (deleting leaves
  // those clips pointing at a now-missing asset).
  const handleDeleteAsset = useCallback(
    async (asset: MediaAsset) => {
      const proj = useEditorStore.getState().project;
      const inUse = proj.tracks.some(
        (t) => 'clips' in t && t.clips.some((c) => 'sourceAssetId' in c && c.sourceAssetId === asset.id),
      );
      const message = inUse
        ? `"${asset.name}" is used by one or more clips on the timeline. Delete it anyway? Those clips will lose their media.`
        : `Delete "${asset.name}" from your media library?`;
      if (!window.confirm(message)) return;
      const isLibraryUpload = assets.some((a) => a.id === asset.id);
      if (isLibraryUpload) {
        try {
          await deleteAssetMeta(asset.id);
        } catch {
          return; // keep the card if the server delete failed
        }
        // Drop from the persisted media-library id list so it stays gone on reload.
        const pid = proj.id;
        if (pid) {
          const key = `vf_media_library_${pid}`;
          try {
            const cur: string[] = JSON.parse(localStorage.getItem(key) || '[]');
            localStorage.setItem(key, JSON.stringify(cur.filter((id) => id !== asset.id)));
          } catch {}
        }
      }
      setAssets((prev) => prev.filter((a) => a.id !== asset.id));
    },
    [assets, deleteAssetMeta],
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

    const proj = useEditorStore.getState().project;
    const manifest = resolveManifest(proj);
    const selection = useEditorStore.getState().selection;

    const wantKind = asset.kind === 'image' ? 'image' : 'video';

    if (manifest) {
      // Priority: if a specific media clip that is a template slot target is currently
      // selected (user clicked a "Moment 1" placeholder or the slot row "Select in timeline"),
      // then clicking/dblclicking a compatible media card should fill/replace *that exact slot*.
      // This makes the "select slot -> pick media for it" flow work (the explicit creator action
      // the audit was exercising).
      if (selection.kind === 'clip' && selection.id) {
        const selectedClipId = selection.id;
        const targetedSlot = manifest.slots.find(s =>
          s.target.type === 'clip' &&
          s.target.clipId === selectedClipId &&
          s.kind === wantKind
        );
        if (targetedSlot && targetedSlot.target.type === 'clip') {
          const meta = getAssetMeta(asset.id);
          // Always perform the asset replacement on the *explicitly selected* slot clip.
          // This prevents the previous behavior of falling through to "add new clip"
          // (which created extra generic clips, changed project duration, and left slots
          // unfilled). The fill is NOT gated on proxyUrl/thumbnailUrl: asset.status is
          // already 'ready' (guarded above) and the §18 doc references media by assetId
          // only, so isSlotFilled() flips immediately; the playable proxy streams in for
          // preview a moment later. The old proxyUrl guard is exactly why a just-ready
          // upload left the slot showing "drop photo/video".
          replaceClipAsset(
            targetedSlot.target.clipId,
            targetedSlot.target.trackId,
            asset.id,
            meta?.durationMs ?? undefined,
          );
          useEditorStore.getState().clearSelection();
          return;
        }
      }

      // Fallback for no specific selection (or selected item wasn't a matching slot):
      // prefer filling the *next* unfilled media slot of compatible kind. This makes blind
      // "add media" naturally advance the template.
      const unfilledSlot = manifest.slots.find(s =>
        s.kind === wantKind &&
        s.target.type === 'clip' &&
        !isSlotFilled(proj, s)
      );
      if (unfilledSlot && unfilledSlot.target.type === 'clip') {
        const meta = getAssetMeta(asset.id);
        // Not gated on proxyUrl/thumbnailUrl — see the selected-slot branch above:
        // a 'ready' asset fills the slot by assetId immediately so the slot never
        // stays a placeholder while its proxy is still being generated.
        replaceClipAsset(
          unfilledSlot.target.clipId,
          unfilledSlot.target.trackId,
          asset.id,
          meta?.durationMs ?? undefined,
        );
        return;
      }
    }

    // Normal (non-template or all slots filled) path: add as a new clip on a suitable track.
    let track = defaultTrackFor(asset.kind, tracks);
    if (!track) {
      // Empty project (or every track was deleted): create the right lane first so
      // double-click / Enter "just works" instead of silently no-opping.
      addTrack(asset.kind === 'audio' ? 'audio' : 'video');
      track = defaultTrackFor(asset.kind, useEditorStore.getState().project.tracks);
    }
    if (!track) return;
    let durationMs = getAssetMeta(asset.id)?.durationMs ?? undefined;
    if (asset.kind === 'image' && !durationMs) durationMs = 5000; // F10: images default 5s
    // Append AFTER the track's existing content so clips never overlap (the user
    // wants to add "at the end"); if the playhead is already past the content,
    // drop it there instead so a deliberate gap is honoured.
    const clips = 'clips' in track ? track.clips : [];
    const trackEnd = clips.reduce((max, c) => Math.max(max, c.endOnTimeline), 0);
    const atMs = Math.max(useEditorStore.getState().playheadMs, trackEnd);
    addClipFromAsset(asset.id, track.id, atMs, durationMs);
  };

  // Stock library (generated backgrounds). INVARIANT-SAFE import: a generated
  // background is NOT a new project construct. We rasterise it to a PNG Blob in the
  // browser (canvas.toBlob) and push it through the SAME upload pipeline as a user
  // file (presign → PUT → confirm → poll), so it becomes an ordinary image asset
  // that already previews (canvas drawImage) and exports (asset:<id> input)
  // identically. No schema/engine change; preview == export by construction.
  const [addingStockId, setAddingStockId] = useState<string | null>(null);
  const handleAddStockItem = useCallback(
    async (item: StockItem) => {
      if (addingStockId) return;
      setAddingStockId(item.id);
      // Switch to the Media tab so the user sees the new asset land in their library
      // (with the normal upload→processing→ready card) and where it then appears.
      setTab('media');
      try {
        const file = await renderBackgroundToFile(item);
        const ready = await uploadFile(file);
        if (!ready) return; // uploadFile surfaced an error card already
        registerFromRecord(ready);
        handleAddToTimeline({
          id: ready.id,
          name: ready.filename || item.title,
          kind: kindFromContentType(ready.contentType),
          duration: durationLabel(ready.durationMs, kindFromContentType(ready.contentType)),
          status: 'ready',
          proxyUrl: ready.proxyUrl,
          thumbnailUrl: ready.thumbnailUrl,
        });
      } finally {
        setAddingStockId(null);
      }
    },
    [addingStockId, uploadFile, registerFromRecord],
  );

  if (collapsed) {
    return (
      <div className="flex h-full w-full flex-col items-center gap-2 bg-vf-surface-1 py-2">
        <Tooltip label="Expand">
          <button
            type="button"
            aria-label="Expand media panel"
            onClick={() => setCollapsed(false)}
            className="flex h-14 w-14 items-center justify-center rounded-lg text-vf-text-tertiary hover:bg-vf-surface-2 hover:text-vf-text-primary"
          >
            <Image className="h-7 w-7" aria-hidden="true" />
          </button>
        </Tooltip>
      </div>
    );
  }

  return (
    <aside role="complementary" aria-label="Creative tools rail" className="flex h-full min-h-0 flex-col bg-vf-surface-1">
      {/* Creative tool rail — larger, confident hit targets and icons per UX audit */}
      <div role="tablist" aria-label="Creative tool rail" className="flex h-16 shrink-0 items-center gap-2 border-b border-vf-border-subtle px-2">
        {([
          { key: 'media', label: 'Media', icon: Image },
          { key: 'text', label: 'Text', icon: Type },
          { key: 'captions', label: 'Captions', icon: Captions },
          { key: 'stock', label: 'Stock', icon: Package },
          { key: 'elements', label: 'Elements', icon: Shapes },
          { key: 'ai', label: 'AI', icon: Sparkles },
        ] as const).map(({ key, label, icon: Icon }) => {
          // 'stock' is now a live tab (generated backgrounds); elements/ai remain "SOON".
          const isCore = ['media','text','captions','stock'].includes(key);
          return (
            <Tooltip key={key} label={label}>
              <button
                role="tab"
                aria-selected={tab === key}
                onClick={() => setTab(key as TabKind)}
                className={cx(
                  'relative flex h-14 w-14 items-center justify-center rounded-lg text-sm font-medium transition-colors',
                  !isCore && 'opacity-60',
                  tab === key ? 'bg-vf-surface-3 text-vf-accent-text' : 'text-vf-text-secondary hover:bg-vf-surface-2 hover:text-vf-text-primary',
                )}
                title={label}
              >
                <Icon className="h-7 w-7" aria-hidden="true" />
                {!isCore && (
                  <span className="absolute bottom-0.5 text-[8px] font-semibold text-vf-text-tertiary tracking-[0.5px]">SOON</span>
                )}
              </button>
            </Tooltip>
          );
        })}
        <Tooltip label="Collapse">
          <button
            type="button"
            aria-label="Collapse media panel"
            onClick={() => setCollapsed(true)}
            className="ml-auto flex h-14 w-14 items-center justify-center rounded-lg text-vf-text-tertiary hover:bg-vf-surface-2 hover:text-vf-text-primary"
          >
            <ChevronLeft className="h-7 w-7" aria-hidden="true" />
          </button>
        </Tooltip>
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
              leadingIcon={<Upload className="h-5 w-5" aria-hidden="true" />}
              data-testid="import-media-btn"
            >
              Import media
            </Button>
            <p className="mt-1 text-center text-2xs text-vf-text-tertiary">or drag &amp; drop files here</p>
          </div>
          {/* Library search + per-kind filter chips. Only shown once the library has
              something to search; an empty library leads straight to the dropzone CTA. */}
          {allAssets.length > 0 && (
            <div className="shrink-0 px-3 pb-2">
              <div className="relative">
                <Search
                  className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-vf-text-tertiary"
                  aria-hidden="true"
                />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search media…"
                  aria-label="Search media library by name"
                  data-testid="media-search-input"
                  className="h-9 w-full rounded-sm border border-vf-border-default bg-vf-surface-2 pl-8 pr-8 text-sm text-vf-text-primary placeholder:text-vf-text-tertiary transition-colors hover:border-vf-border-strong focus:border-vf-border-strong focus:outline-none"
                />
                {search !== '' && (
                  <button
                    type="button"
                    aria-label="Clear search"
                    title="Clear search"
                    onClick={() => setSearch('')}
                    className="absolute right-1.5 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md text-vf-text-tertiary hover:bg-vf-surface-3 hover:text-vf-text-primary"
                  >
                    <X className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                )}
              </div>
              <div role="group" aria-label="Filter by media type" className="mt-2 flex flex-wrap gap-1.5">
                {([
                  { key: 'all', label: 'All' },
                  { key: 'video', label: 'Video' },
                  { key: 'audio', label: 'Audio' },
                  { key: 'image', label: 'Image' },
                ] as const).map(({ key, label }) => (
                  <button
                    key={key}
                    type="button"
                    aria-pressed={kindFilter === key}
                    onClick={() => setKindFilter(key)}
                    data-testid={`media-filter-${key}`}
                    className={cx(
                      'rounded-pill border px-2.5 py-1 text-2xs font-medium transition-colors',
                      kindFilter === key
                        ? 'border-vf-selection bg-vf-selection/15 text-vf-text-primary'
                        : 'border-vf-border-subtle bg-vf-surface-2 text-vf-text-secondary hover:border-vf-border-strong hover:text-vf-text-primary',
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-3 pb-3 w-full">
            <div className="grid grid-cols-2 gap-2.5 w-full">
              {filteredAssets.map((asset) => (
                <div key={asset.id} className="group relative">
                {/* Hover actions (§3.1 rename/delete). Siblings of the card button — not
                    nested — so the markup stays valid; only for settled (ready) assets. */}
                {asset.status === 'ready' && (
                  <div className="absolute right-1 top-1 z-10 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                    <button
                      type="button"
                      aria-label={`Rename ${asset.name}`}
                      title="Rename"
                      data-testid="asset-rename-btn"
                      onClick={(e) => { e.stopPropagation(); void handleRenameAsset(asset); }}
                      className="flex h-6 w-6 items-center justify-center rounded-md bg-vf-surface-sunken/90 text-vf-text-secondary hover:bg-vf-surface-3 hover:text-vf-text-primary"
                    >
                      <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      aria-label={`Delete ${asset.name}`}
                      title="Delete"
                      data-testid="asset-delete-btn"
                      onClick={(e) => { e.stopPropagation(); void handleDeleteAsset(asset); }}
                      className="flex h-6 w-6 items-center justify-center rounded-md bg-vf-surface-sunken/90 text-vf-text-secondary hover:bg-vf-danger-fg/20 hover:text-vf-danger-fg"
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                  </div>
                )}
                <button
                  type="button"
                  disabled={asset.status !== 'ready' && asset.status !== 'error'}
                  draggable={asset.status === 'ready'}
                  onDragStart={(e) => {
                    e.dataTransfer.setData('application/x-vf-asset', asset.id);
                    e.dataTransfer.setData('application/x-vf-asset-kind', asset.kind);
                    e.dataTransfer.effectAllowed = 'copy';
                  }}
                  onClick={() => {
                    if (asset.status === 'error') retryUpload(asset);
                    // Do NOT call handleAddToTimeline here for ready assets.
                    // Single-click should not add (prevents duplication on double-click).
                    // Double-click (below) and drag are the documented ways to add media.
                  }}
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
                    'flex w-full flex-col overflow-hidden min-w-0 rounded-lg border bg-vf-surface-2 text-left transition-colors',
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
                        <AlertTriangle className="h-4 w-4" aria-hidden="true" />
                        <span className="text-2xs font-medium">Failed</span>
                        <span className="text-[10px] opacity-80">↻ Retry</span>
                      </div>
                    ) : asset.thumbnailUrl ? (
                      <img src={asset.thumbnailUrl} alt="" className="h-full w-full object-contain bg-vf-surface-sunken" />
                    ) : (
                      <span aria-hidden="true" className="opacity-70">{KIND_GLYPH[asset.kind]}</span>
                    )}
                    {asset.status === 'ready' && (
                      <span className="absolute bottom-1 right-1 rounded-pill bg-vf-surface-sunken/90 px-1.5 py-0.5 text-2xs text-vf-text-secondary vf-tnum">
                        {asset.duration}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1 px-2 py-1.5">
                    <span aria-hidden="true" className="shrink-0 text-vf-text-tertiary">{KIND_GLYPH[asset.kind]}</span>
                    <span className="truncate text-xs text-vf-text-secondary" title={asset.name}>
                      {asset.name}
                    </span>
                  </div>
                </button>
                </div>
              ))}
            </div>
            {allAssets.length > 0 && filteredAssets.length === 0 && (
              // "No matches" state — distinct from the genuinely-empty library below.
              // The library has assets, but the active search/kind filter excludes them all.
              <div
                data-testid="media-no-matches"
                className="mt-2 flex w-full flex-col items-center justify-center gap-2 rounded-lg border border-vf-border-subtle bg-vf-surface-2/60 px-4 py-10 text-center"
              >
                <Search className="h-7 w-7 text-vf-text-tertiary" aria-hidden="true" />
                <span className="text-sm font-medium text-vf-text-secondary">No media matches your filters</span>
                <span className="text-2xs text-vf-text-tertiary">Try a different search or clear the filters.</span>
                <button
                  type="button"
                  onClick={() => { setSearch(''); setKindFilter('all'); }}
                  className="mt-1 rounded-pill border border-vf-border-subtle bg-vf-surface-2 px-3 py-1 text-2xs font-medium text-vf-text-secondary hover:border-vf-border-strong hover:text-vf-text-primary"
                >
                  Clear filters
                </button>
              </div>
            )}
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
                <Upload className="h-8 w-8 text-vf-text-tertiary" aria-hidden="true" />
                <span className="text-sm font-medium text-vf-text-primary">Drop a video here</span>
                <span className="text-2xs text-vf-text-tertiary">or click Import media above</span>
                <span className="text-2xs text-vf-text-tertiary">MP4 · MOV · MP3 · WAV · AAC · JPG · PNG</span>
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
              <Type className="h-5 w-5 text-vf-text-tertiary" aria-hidden="true" />
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
            leadingIcon={<Upload className="h-5 w-5" aria-hidden="true" />}
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
            leadingIcon={<Captions className="h-5 w-5" aria-hidden="true" />}
          >
            Open caption editor
          </Button>
          <p className="mt-1 text-2xs text-vf-text-tertiary">
            Captions burn into the export or download as a sidecar .srt / .vtt.
          </p>
        </div>
      )}

      {/* Stock: live generated CC0 backgrounds + an honest "coming soon" note for the
          external CC0 video/music set still behind the content/license gate. */}
      {(tab as string) === 'stock' && (
        <div role="tabpanel" className="flex min-h-0 flex-1 flex-col">
          <div className="shrink-0 px-3 pt-3">
            <p className="text-xs font-medium text-vf-text-secondary">Backgrounds</p>
            <p className="mt-0.5 text-2xs text-vf-text-tertiary">
              Generated solid &amp; gradient backgrounds — no license needed. Click to add at the playhead.
            </p>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-3 pb-3 pt-2 w-full">
            <div className="grid grid-cols-2 gap-2.5 w-full">
              {stockItemsForTab('stock').map((item) => (
                <button
                  key={item.id}
                  type="button"
                  disabled={addingStockId !== null}
                  onClick={() => void handleAddStockItem(item)}
                  data-testid="stock-item"
                  data-stock-id={item.id}
                  title={`${item.title} — click to add`}
                  className={cx(
                    'group flex w-full flex-col overflow-hidden min-w-0 rounded-lg border border-vf-border-subtle bg-vf-surface-2 text-left transition-colors',
                    addingStockId ? 'cursor-default opacity-60' : 'cursor-pointer hover:border-vf-border-strong',
                  )}
                >
                  <div
                    className="relative flex aspect-video items-center justify-center overflow-hidden"
                    style={{ background: thumbnailCss(item) }}
                  >
                    {addingStockId === item.id && (
                      <span
                        aria-hidden="true"
                        className="h-5 w-5 animate-spin rounded-full border-2 border-white/30 border-t-white"
                      />
                    )}
                  </div>
                  <div className="flex items-center gap-1 px-2 py-1.5">
                    <span aria-hidden="true" className="shrink-0 text-vf-text-tertiary"><Image className="h-4 w-4" /></span>
                    <span className="truncate text-xs text-vf-text-secondary" title={item.title}>{item.title}</span>
                  </div>
                </button>
              ))}
            </div>
            <div className="mt-4 flex items-center gap-2 rounded-lg border border-vf-border-subtle bg-vf-surface-2/60 px-3 py-2.5 text-2xs text-vf-text-tertiary">
              <Package className="h-4 w-4 shrink-0 opacity-70" aria-hidden="true" />
              <span>{STOCK_CATEGORIES.stock.comingSoon}</span>
            </div>
          </div>
        </div>
      )}
      {/* Elements: intentionally empty — shapes/stickers can't yet export
          (buildFilterComplex omits image/shape/lottie/sticker overlays), so adding
          them would break preview == export. Honest "coming soon" until the gate. */}
      {(tab as string) === 'elements' && (
        <div role="tabpanel" className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
          <Shapes className="h-8 w-8 text-vf-text-tertiary opacity-60" aria-hidden="true" />
          <p className="text-sm font-medium text-vf-text-secondary">Elements &amp; stickers</p>
          <p className="text-2xs text-vf-text-tertiary">{STOCK_CATEGORIES.elements.comingSoon}</p>
        </div>
      )}
      {(tab as string) === 'ai' && (
        <div role="tabpanel" className="p-4 text-center text-xs text-vf-text-tertiary">
          <div className="mb-2"><Sparkles className="h-8 w-8 mx-auto opacity-60" /></div>
          AI tools<br />Auto-captions, beat sync, resize, script-to-video (Phase 2)
        </div>
      )}
      {(['brand'] as string[]).includes(tab as string) && (
        <div role="tabpanel" className="p-4 text-center text-xs text-vf-text-tertiary">
          Brand kit / fonts / logos (Phase 2)
        </div>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept=".mp4,.mov,.mp3,.wav,.aac,.m4a,.jpg,.jpeg,.png,video/mp4,video/quicktime,audio/mpeg,audio/wav,audio/aac,audio/mp4,image/jpeg,image/png"
        multiple
        aria-hidden="true"
        aria-label="Import video, audio or image files"
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
        aria-label="Import captions from .srt or .vtt file"
        tabIndex={-1}
        className="sr-only"
        onChange={handleSrtChange}
        data-testid="srt-file-input"
      />
    </aside>
  );
}
