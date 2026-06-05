import { memo, useEffect, useMemo, useRef, useState } from "react";
import {
  selectProjectDurationMs,
  useEditorStore,
  type AddTrackKind,
} from "../../store/editorStore.js";
import { getAssetMeta } from "../../store/assetStore.js";
import { msToTimecode } from "@videoforge/project-schema";
import type { Clip, Track } from "@videoforge/project-schema";
import { cx, IconButton, Tooltip } from "../ui/index.js";
import { resolveManifest } from "../../store/templateStore.js";
import { isSlotFilled } from "../../lib/templates.js";

/** Per-clip placeholder-slot info for the dashed timeline block (null = not a placeholder). */
export interface SlotInfo {
  label: string;
  index: number;
  total: number;
}

// Timeline — bottom band, the hero edit surface (§6). Zero-prop, store-driven.
//   • sticky ruler with adaptive timecode ticks (density from pxPerSecond)
//   • 180px track-header column per track (type icon, name, audio mute/solo)
//   • track body: each clip a block at startOnTimeline*pxPerSecond, width by duration
//   • draggable red playhead; click ruler → setPlayhead; click clip → select
//   • Audio-Link chain glyph on linked clips; orange snap line during drag
//   • "+ Add track" honours Free-tier ceilings (disabled tooltip, NO upsell)
//   • interactions: click-select; drag-to-move with snapping + cross-track drop;
//     edge trim handles. The drag is TRANSIENT — it previews via local state and
//     commits ONCE to the store on pointer-up (so a single drag is one undo step,
//     not hundreds, and the doc isn't re-serialised every frame). Hold Alt to
//     disable snapping.

const HEADER_W = 180; // §2.1 pinned track-header column width
const RULER_H = 32;
const SNAP_PX = 8; // snap-to-edge threshold in screen pixels (§3.5)

// Free-tier track ceilings (MVP_Scope §3.2 / §15.2): 3 video · 2 audio · 2 overlay.
const TRACK_CAPS: Record<AddTrackKind, number> = {
  video: 3,
  audio: 2,
  voiceover: 1,
  overlay: 2,
};

const TYPE_ICON: Record<string, string> = {
  video: "▣",
  audio: "🔊",
  voiceover: "🎙",
  overlay: "▤",
  caption: "💬",
};

const TYPE_TINT: Record<string, string> = {
  video: "bg-vf-track-video-fill border-vf-track-video",
  audio: "bg-vf-track-audio-fill border-vf-track-audio",
  voiceover: "bg-vf-track-audio-fill border-vf-track-voiceover",
  overlay: "bg-vf-track-overlay-fill border-vf-track-overlay",
  caption: "bg-vf-track-caption-fill border-vf-track-caption",
};

type DragMode = "move" | "trim-start" | "trim-end";

interface DragState {
  clipId: string;
  /** The clip's own track (source lane). */
  trackId: string;
  /** Whether the dragged clip is audio-bearing (gates compatible destination lanes). */
  isAudio: boolean;
  mode: DragMode;
  startX: number;
  originStartMs: number;
  originEndMs: number;
}

/** Live (uncommitted) drag preview — drives the dragged block's position only. */
interface DragPreview {
  startMs: number;
  endMs: number;
  /** Destination track for a cross-track move (= source track for trims). */
  trackId: string;
  /** Snap-line x in px, or null. */
  snapX: number | null;
}

export default function Timeline() {
  const tracks = useEditorStore((s) => s.project.tracks);
  const captionTracks = useEditorStore((s) => s.project.captionTracks);
  const pxPerSecond = useEditorStore((s) => s.pxPerSecond);
  const playheadMs = useEditorStore((s) => s.playheadMs);
  const selection = useEditorStore((s) => s.selection);
  const fps = useEditorStore((s) => s.project.canvas.frameRate);
  const durationMs = useEditorStore(selectProjectDurationMs);

  const setPlayhead = useEditorStore((s) => s.setPlayhead);
  const select = useEditorStore((s) => s.select);
  const moveClip = useEditorStore((s) => s.moveClip);
  const trimClip = useEditorStore((s) => s.trimClip);
  const addTrack = useEditorStore((s) => s.addTrack);
  const addClipFromAsset = useEditorStore((s) => s.addClipFromAsset);
  const deleteSelected = useEditorStore((s) => s.deleteSelected);
  const duplicateSelected = useEditorStore((s) => s.duplicateSelected);
  const splitAtPlayhead = useEditorStore((s) => s.splitAtPlayhead);
  const setTrackMute = useEditorStore((s) => s.setTrackMute);
  const setTrackSolo = useEditorStore((s) => s.setTrackSolo);
  const addCrossfade = useEditorStore((s) => s.addCrossfade);
  const detachAudio = useEditorStore((s) => s.detachAudio);
  const setZoom = useEditorStore((s) => s.setZoom);

  const bodyRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [preview, setPreview] = useState<DragPreview | null>(null);

  // Right-click context menu on media clips.
  const [clipCtx, setClipCtx] = useState<{
    clipId: string;
    trackId: string;
    x: number;
    y: number;
  } | null>(null);
  const [trackCtx, setTrackCtx] = useState<{ trackId: string; x: number; y: number } | null>(null);

  useEffect(() => {
    if (!clipCtx) return;
    const dismiss = () => setClipCtx(null);
    document.addEventListener("mousedown", dismiss);
    return () => document.removeEventListener("mousedown", dismiss);
  }, [clipCtx]);

  useEffect(() => {
    if (!trackCtx) return;
    const dismiss = () => setTrackCtx(null);
    document.addEventListener("mousedown", dismiss);
    return () => document.removeEventListener("mousedown", dismiss);
  }, [trackCtx]);

  const pxPerMs = pxPerSecond / 1000;
  // The content width spans the project duration plus a tail of empty room.
  const contentWidthPx = Math.max(800, (durationMs + 4000) * pxPerMs);

  // Empty-state hint (§6.3): show a centered prompt while no media/overlay clips exist.
  // Caption-only blocks don't count as "real" timeline content for the first-clip aha.
  const hasClips = useMemo(
    () => tracks.some((t) => "clips" in t && t.clips.length > 0),
    [tracks],
  );

  // All lanes top→bottom: media/overlay tracks then caption tracks (§6.2 order is a
  // design nicety; we render in array order which already encodes z-order, §18).
  const allTracks = useMemo<Track[]>(
    () => [...tracks, ...captionTracks],
    [tracks, captionTracks],
  );

  // Template placeholder slots → dashed clip blocks with a "N of M" badge. Only
  // UNFILLED media slots render as placeholders (a filled slot is a normal clip).
  const project = useEditorStore((s) => s.project);
  const placeholderSlots = useMemo<Map<string, SlotInfo>>(() => {
    const map = new Map<string, SlotInfo>();
    const manifest = resolveManifest(project);
    if (!manifest) return map;
    for (const slot of manifest.slots) {
      if (slot.target.type !== "clip") continue;
      if (isSlotFilled(project, slot)) continue;
      map.set(slot.target.clipId, { label: slot.label, index: slot.index, total: slot.total });
    }
    return map;
  }, [project]);

  // ── Ruler ticks: adapt density to zoom so labels never collide. ──
  const tickEverySec = useMemo(() => {
    const candidates = [0.5, 1, 2, 5, 10, 30, 60];
    for (const c of candidates) if (c * pxPerSecond >= 64) return c;
    return 60;
  }, [pxPerSecond]);

  const ticks = useMemo(() => {
    const out: number[] = [];
    const totalSec = contentWidthPx / pxPerSecond;
    for (let t = 0; t <= totalSec; t += tickEverySec) out.push(t);
    return out;
  }, [contentWidthPx, pxPerSecond, tickEverySec]);

  const seekFromClientX = (clientX: number): void => {
    const body = bodyRef.current;
    if (!body) return;
    const rect = body.getBoundingClientRect();
    const x = clientX - rect.left + body.scrollLeft;
    setPlayhead(Math.max(0, x / pxPerMs));
  };

  const minClipMs = Math.max(1, Math.round(1000 / (fps || 30)));

  // Snap candidates: every OTHER media clip's start/end edge, the playhead, and 0.
  const snapEdgesFor = (excludeClipId: string): number[] => {
    const edges: number[] = [0, playheadMs];
    for (const t of tracks) {
      if (t.type !== "video" && t.type !== "audio" && t.type !== "voiceover") continue;
      for (const c of t.clips) {
        if (c.id === excludeClipId) continue;
        edges.push(c.startOnTimeline, c.endOnTimeline);
      }
    }
    return edges;
  };

  // Snap `ms` to the nearest candidate edge within SNAP_PX; returns the snapped ms.
  const snapMs = (ms: number, edges: number[]): { ms: number; dist: number } => {
    let bestMs = ms;
    let bestDist = Infinity;
    for (const e of edges) {
      const d = Math.abs(e - ms);
      if (d * pxPerMs <= SNAP_PX && d < bestDist) {
        bestDist = d;
        bestMs = e;
      }
    }
    return { ms: bestMs, dist: bestDist };
  };

  // Which media track lane the pointer Y is over (for cross-track move).
  const trackAtClientY = (clientY: number): Track | null => {
    const body = bodyRef.current;
    if (!body) return null;
    const top = body.getBoundingClientRect().top;
    let acc = top;
    for (const t of allTracks) {
      if (clientY >= acc && clientY < acc + t.height) return t;
      acc += t.height;
    }
    return null;
  };

  // ── Pointer-driven clip move / trim (transient → commit on pointer-up) ──
  const onClipPointerDown = (
    e: React.PointerEvent,
    clip: Clip,
    track: Track,
    mode: DragMode,
  ): void => {
    e.stopPropagation();
    if (track.locked) return;
    select("clip", clip.id);
    (e.target as Element).setPointerCapture?.(e.pointerId);
    setDrag({
      clipId: clip.id,
      trackId: track.id,
      isAudio: track.type === "audio" || track.type === "voiceover",
      mode,
      startX: e.clientX,
      originStartMs: clip.startOnTimeline,
      originEndMs: clip.endOnTimeline,
    });
    setPreview({
      startMs: clip.startOnTimeline,
      endMs: clip.endOnTimeline,
      trackId: track.id,
      snapX: null,
    });
  };

  const onBodyPointerMove = (e: React.PointerEvent): void => {
    if (!drag) return;
    const deltaMs = (e.clientX - drag.startX) / pxPerMs;
    const alt = e.altKey; // hold Alt to disable snapping
    const edges = alt ? [] : snapEdgesFor(drag.clipId);
    const span = drag.originEndMs - drag.originStartMs;

    if (drag.mode === "move") {
      let start = Math.max(0, drag.originStartMs + deltaMs);
      // Snap whichever edge (start/end) lands closest to a candidate.
      const s = snapMs(start, edges);
      const eSnap = snapMs(start + span, edges);
      if (s.dist <= eSnap.dist && s.dist !== Infinity) start = s.ms;
      else if (eSnap.dist !== Infinity) start = Math.max(0, eSnap.ms - span);
      // Cross-track: move to the compatible lane under the pointer.
      const overTrack = trackAtClientY(e.clientY);
      const dest =
        overTrack &&
        ((drag.isAudio && (overTrack.type === "audio" || overTrack.type === "voiceover")) ||
          (!drag.isAudio && overTrack.type === "video"))
          ? overTrack.id
          : drag.trackId;
      setPreview({ startMs: start, endMs: start + span, trackId: dest, snapX: start * pxPerMs });
    } else if (drag.mode === "trim-start") {
      let start = Math.min(Math.max(0, drag.originStartMs + deltaMs), drag.originEndMs - minClipMs);
      const s = snapMs(start, edges);
      if (s.dist !== Infinity) start = Math.min(s.ms, drag.originEndMs - minClipMs);
      setPreview({ startMs: start, endMs: drag.originEndMs, trackId: drag.trackId, snapX: start * pxPerMs });
    } else {
      let end = Math.max(drag.originStartMs + minClipMs, drag.originEndMs + deltaMs);
      const s = snapMs(end, edges);
      if (s.dist !== Infinity) end = Math.max(drag.originStartMs + minClipMs, s.ms);
      setPreview({ startMs: drag.originStartMs, endMs: end, trackId: drag.trackId, snapX: end * pxPerMs });
    }
  };

  // Commit the transient drag to the store as a SINGLE undoable op.
  const endDrag = (): void => {
    if (drag && preview) {
      if (drag.mode === "move") {
        moveClip(drag.clipId, preview.trackId, preview.startMs);
      } else if (drag.mode === "trim-start") {
        trimClip(drag.clipId, "start", preview.startMs);
      } else {
        trimClip(drag.clipId, "end", preview.endMs);
      }
    }
    setDrag(null);
    setPreview(null);
  };

  // Called by TrackBody when an asset is dropped onto a lane from the MediaPanel.
  const handleDropClip = (assetId: string, clientX: number, trackId: string): void => {
    const body = bodyRef.current;
    if (!body) return;
    const rect = body.getBoundingClientRect();
    const x = clientX - rect.left + body.scrollLeft;
    let dropMs = Math.max(0, x / pxPerMs);
    // Snap the drop to nearby edges + playhead too.
    const snapped = snapMs(dropMs, snapEdgesFor(assetId));
    if (snapped.dist !== Infinity) dropMs = snapped.ms;
    const durationMs = getAssetMeta(assetId)?.durationMs ?? undefined;
    addClipFromAsset(assetId, trackId, dropMs, durationMs);
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-vf-surface-1">
      {/* ── Top: ruler row (header gutter + sticky ruler) ── */}
      <div className="flex shrink-0" style={{ height: RULER_H }}>
        {/* Header-column gutter + Add-track menu trigger area */}
        <div
          className="flex shrink-0 items-center justify-between border-b border-r border-vf-border-subtle bg-vf-surface-2 px-2"
          style={{ width: HEADER_W }}
        >
          <span className="text-2xs font-semibold uppercase tracking-wide text-vf-text-tertiary">
            Tracks
          </span>
          <AddTrackMenu tracks={tracks} onAdd={addTrack} />
        </div>
        {/* Ruler (click to jump, drag to scrub) */}
        <div className="relative flex-1 overflow-hidden bg-vf-surface-sunken">
          <div
            className="relative h-full cursor-pointer"
            style={{ width: contentWidthPx }}
            onPointerDown={(e) => seekFromClientX(e.clientX)}
          >
            {ticks.map((t) => (
              <div
                key={t}
                className="absolute top-0 h-full border-l border-vf-border-subtle"
                style={{ left: t * pxPerSecond }}
              >
                <span className="absolute left-1 top-1 text-2xs text-vf-ruler-tick vf-tnum">
                  {msToTimecode(t * 1000, fps)}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Track stack (headers + bodies share a scroll context) ── */}
      <div className="relative flex min-h-0 flex-1 overflow-y-auto">
        {/* Empty-state hint: centered over the bodies viewport (offset past the pinned
            header column). Pointer-transparent so it never blocks a drop. Vanishes the
            moment the first clip lands — part of "aha" moment A (timeline comes alive). */}
        {!hasClips && (
          <div
            aria-hidden="true"
            data-testid="timeline-empty-hint"
            className="pointer-events-none absolute inset-y-0 right-0 z-10 flex items-center justify-center"
            style={{ left: HEADER_W }}
          >
            <p className="max-w-[260px] text-center text-xs text-vf-text-tertiary">
              Drag a clip here, or double-click media to add it. Your edit builds left-to-right.
            </p>
          </div>
        )}
        {/* Header column (does not horizontal-scroll). */}
        <div className="shrink-0 border-r border-vf-border-subtle" style={{ width: HEADER_W }}>
          {allTracks.map((track) => (
            <TrackHeader
              key={track.id}
              track={track}
              selected={selection.kind === "track" && selection.id === track.id}
              onSelect={() => select("track", track.id)}
              onMute={(v) => setTrackMute(track.id, v)}
              onSolo={(v) => setTrackSolo(track.id, v)}
              onContextMenu={(x, y) => {
                select("track", track.id);
                setTrackCtx({ trackId: track.id, x, y });
              }}
            />
          ))}
        </div>

        {/* Track bodies (scroll H). */}
        <div ref={bodyRef} className="relative min-w-0 flex-1 overflow-x-auto">
          <div
            className="relative"
            style={{ width: contentWidthPx }}
            onPointerMove={onBodyPointerMove}
            onPointerUp={endDrag}
            onPointerLeave={endDrag}
          >
            {allTracks.map((track) => (
              <TrackBody
                key={track.id}
                track={track}
                pxPerMs={pxPerMs}
                selectionId={selection.id}
                dragClipId={drag?.clipId ?? null}
                dragPreview={preview}
                placeholderSlots={placeholderSlots}
                onClipDown={onClipPointerDown}
                onSelectCaption={(id) => select("caption", id)}
                onSelectOverlay={(id) => select("overlay", id)}
                onDropClip={handleDropClip}
                onClipContextMenu={(clipId, trackId, x, y) => {
                  select("clip", clipId);
                  setClipCtx({ clipId, trackId, x, y });
                }}
              />
            ))}

            {/* Snap-line affordance (orange) during a drag (§6.6). */}
            {preview?.snapX != null && (
              <div
                aria-hidden="true"
                className="pointer-events-none absolute top-0 z-sticky h-full w-0.5 bg-vf-snap-line"
                style={{ left: preview.snapX }}
              />
            )}

            {/* Draggable red playhead, full body height (§6.3). */}
            <div
              role="slider"
              aria-label="Playhead"
              aria-valuetext={msToTimecode(playheadMs, fps)}
              tabIndex={0}
              onPointerDown={(e) => {
                (e.target as Element).setPointerCapture?.(e.pointerId);
                const move = (ev: PointerEvent): void => seekFromClientX(ev.clientX);
                const up = (): void => {
                  window.removeEventListener("pointermove", move);
                  window.removeEventListener("pointerup", up);
                };
                window.addEventListener("pointermove", move);
                window.addEventListener("pointerup", up);
              }}
              onKeyDown={(e) => {
                const frame = 1000 / (fps || 30);
                if (e.key === "ArrowLeft") setPlayhead(Math.max(0, playheadMs - frame));
                if (e.key === "ArrowRight") setPlayhead(playheadMs + frame);
              }}
              className="absolute top-0 z-sticky h-full w-0.5 cursor-ew-resize bg-vf-playhead"
              style={{ left: playheadMs * pxPerMs }}
            >
              <span
                aria-hidden="true"
                className="absolute -left-[5px] -top-0.5 h-0 w-0 border-x-[6px] border-t-[8px] border-x-transparent border-t-vf-playhead"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Clip right-click context menu (portal to fixed coords). */}
      {clipCtx && (
        <div
          role="menu"
          data-testid="clip-context-menu"
          style={{ position: "fixed", top: clipCtx.y, left: clipCtx.x }}
          className="z-[9999] w-44 rounded-md border border-vf-border-subtle bg-vf-surface-3 p-1 shadow-vf-2"
          onMouseDown={(e) => e.stopPropagation()}
        >
          <button
            role="menuitem"
            type="button"
            className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-xs text-vf-text-primary hover:bg-vf-surface-4"
            onClick={() => { splitAtPlayhead(); setClipCtx(null); }}
          >
            ✂ Split at playhead
          </button>
          <button
            role="menuitem"
            type="button"
            className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-xs text-vf-text-primary hover:bg-vf-surface-4"
            onClick={() => { duplicateSelected(); setClipCtx(null); }}
          >
            ⧉ Duplicate
          </button>
          <button
            role="menuitem"
            type="button"
            className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-xs text-vf-text-primary hover:bg-vf-surface-4"
            onClick={() => { addCrossfade(clipCtx.clipId); setClipCtx(null); }}
          >
            ⤫ Crossfade to next
          </button>
          <button
            role="menuitem"
            type="button"
            className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-xs text-vf-text-primary hover:bg-vf-surface-4"
            onClick={() => { detachAudio(clipCtx.clipId); setClipCtx(null); }}
          >
            🔗 Detach audio
          </button>
          <div className="my-1 border-t border-vf-border-subtle" />
          <button
            role="menuitem"
            type="button"
            className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-xs text-vf-danger-fg hover:bg-vf-surface-4"
            onClick={() => { deleteSelected(); setClipCtx(null); }}
          >
            🗑 Delete
          </button>
        </div>
      )}

      {/* Track-header right-click context menu. */}
      {trackCtx && (
        <div
          role="menu"
          data-testid="track-context-menu"
          style={{ position: "fixed", top: trackCtx.y, left: trackCtx.x }}
          className="z-[9999] w-44 rounded-md border border-vf-border-subtle bg-vf-surface-3 p-1 shadow-vf-2"
          onMouseDown={(e) => e.stopPropagation()}
        >
          <button
            role="menuitem"
            type="button"
            className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-xs text-vf-danger-fg hover:bg-vf-surface-4"
            onClick={() => {
              select("track", trackCtx.trackId);
              deleteSelected();
              setTrackCtx(null);
            }}
          >
            🗑 Delete track
          </button>
        </div>
      )}

      {/* ── Utility row: zoom (§6.1) ── */}
      <div className="flex h-7 shrink-0 items-center gap-2 border-t border-vf-border-subtle bg-vf-surface-2 px-3">
        <button
          type="button"
          onClick={() => setZoom(100)}
          className="rounded-sm px-2 py-0.5 text-2xs text-vf-text-secondary hover:bg-vf-surface-3"
        >
          Fit
        </button>
        <IconButton aria-label="Zoom out" size="sm" onClick={() => setZoom(pxPerSecond - 20)}>
          <span aria-hidden="true">−</span>
        </IconButton>
        <input
          type="range"
          aria-label="Timeline zoom"
          min={10}
          max={800}
          value={pxPerSecond}
          onChange={(e) => setZoom(Number(e.target.value))}
          className="h-1.5 w-40 cursor-pointer appearance-none rounded-pill bg-vf-surface-sunken accent-vf-accent"
        />
        <IconButton aria-label="Zoom in" size="sm" onClick={() => setZoom(pxPerSecond + 20)}>
          <span aria-hidden="true">+</span>
        </IconButton>
        <span className="vf-tnum text-2xs text-vf-text-tertiary">{pxPerSecond} px/s</span>
      </div>
    </div>
  );
}

// ── Track header (180px) ───────────────────────────────────────────────────────
function TrackHeader({
  track,
  selected,
  onSelect,
  onMute,
  onSolo,
  onContextMenu,
}: {
  track: Track;
  selected: boolean;
  onSelect: () => void;
  onMute: (v: boolean) => void;
  onSolo: (v: boolean) => void;
  onContextMenu: (x: number, y: number) => void;
}) {
  const isAudio = track.type === "audio" || track.type === "voiceover";
  return (
    <div
      onClick={onSelect}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onContextMenu(e.clientX, e.clientY);
      }}
      className={cx(
        "flex flex-col justify-center gap-1 border-b border-vf-border-subtle px-2",
        selected ? "bg-vf-surface-3" : "bg-vf-surface-2",
      )}
      style={{ height: track.height }}
    >
      <div className="flex items-center gap-1">
        <span aria-hidden="true" className="text-xs" title={track.type}>
          {TYPE_ICON[track.type]}
        </span>
        <span className="truncate text-xs font-medium text-vf-text-primary">{track.name}</span>
        <span
          aria-hidden="true"
          className="ml-auto h-3 w-3 shrink-0 rounded-sm"
          style={{ backgroundColor: track.colour }}
        />
      </div>
      {isAudio && (
        <div className="flex items-center gap-1">
          <button
            type="button"
            role="switch"
            aria-checked={track.muted}
            aria-label={`Mute ${track.name}`}
            onClick={(e) => {
              e.stopPropagation();
              onMute(!track.muted);
            }}
            className={cx(
              "h-5 rounded-sm px-1.5 text-2xs",
              track.muted ? "bg-vf-surface-4 text-vf-accent-text" : "text-vf-text-tertiary hover:bg-vf-surface-3",
            )}
          >
            M
          </button>
          <button
            type="button"
            role="switch"
            aria-checked={track.solo}
            aria-label={`Solo ${track.name}`}
            onClick={(e) => {
              e.stopPropagation();
              onSolo(!track.solo);
            }}
            className={cx(
              "h-5 rounded-sm px-1.5 text-2xs",
              track.solo ? "bg-vf-surface-4 text-vf-accent-text" : "text-vf-text-tertiary hover:bg-vf-surface-3",
            )}
          >
            S
          </button>
        </div>
      )}
    </div>
  );
}

// ── Track body (clips for one lane) ──────────────────────────────────────────────
function TrackBody({
  track,
  pxPerMs,
  selectionId,
  dragClipId,
  dragPreview,
  placeholderSlots,
  onClipDown,
  onSelectCaption,
  onSelectOverlay,
  onDropClip,
  onClipContextMenu,
}: {
  track: Track;
  pxPerMs: number;
  selectionId: string | null;
  dragClipId: string | null;
  dragPreview: DragPreview | null;
  placeholderSlots: Map<string, SlotInfo>;
  onClipDown: (e: React.PointerEvent, clip: Clip, track: Track, mode: DragMode) => void;
  onSelectCaption: (id: string) => void;
  onSelectOverlay: (id: string) => void;
  onDropClip: (assetId: string, clientX: number, trackId: string) => void;
  onClipContextMenu: (clipId: string, trackId: string, x: number, y: number) => void;
}) {
  const canReceiveDrop = track.type === "video" || track.type === "audio" || track.type === "voiceover";
  // The dragged clip renders at its live preview position only on its DESTINATION lane.
  const isDropTarget = dragPreview?.trackId === track.id;

  const containsDragged = canReceiveDrop && track.clips.some((c) => c.id === dragClipId);
  const crossTrackTarget = isDropTarget && dragClipId != null && !containsDragged;

  // Caption + overlay clips do not carry the media Clip shape; render minimal blocks.
  return (
    <div
      className={cx(
        "relative border-b border-vf-border-subtle",
        crossTrackTarget && "bg-vf-selection/10 ring-1 ring-inset ring-vf-selection/40",
        track.locked && "[background-image:repeating-linear-gradient(45deg,transparent,transparent_6px,rgba(255,255,255,0.03)_6px,rgba(255,255,255,0.03)_12px)]",
      )}
      style={{ height: track.height }}
      onDragOver={(e) => {
        if (!canReceiveDrop) return;
        if (e.dataTransfer.types.includes("application/x-vf-asset")) {
          e.preventDefault();
          e.dataTransfer.dropEffect = "copy";
        }
      }}
      onDrop={(e) => {
        if (!canReceiveDrop) return;
        e.preventDefault();
        const assetId = e.dataTransfer.getData("application/x-vf-asset");
        const assetKind = e.dataTransfer.getData("application/x-vf-asset-kind");
        if (!assetId) return;
        // Type guard: audio assets only go to audio/voiceover tracks.
        if (assetKind === "audio" && track.type === "video") return;
        if (assetKind !== "audio" && (track.type === "audio" || track.type === "voiceover")) return;
        onDropClip(assetId, e.clientX, track.id);
      }}
    >
      {track.type === "caption"
        ? track.blocks.map((b) => (
            <button
              key={b.id}
              type="button"
              onClick={() => onSelectCaption(b.id)}
              className={cx(
                "absolute top-1 flex h-[calc(100%-8px)] items-center overflow-hidden rounded-pill border px-2 text-2xs",
                TYPE_TINT.caption,
                selectionId === b.id ? "ring-2 ring-vf-selection" : "",
              )}
              style={{ left: b.startMs * pxPerMs, width: Math.max(12, (b.endMs - b.startMs) * pxPerMs) }}
              title={b.text}
            >
              <span className="truncate text-vf-text-primary">{b.text}</span>
            </button>
          ))
        : track.type === "overlay"
          ? track.clips.map((ov) => (
              <button
                key={ov.id}
                type="button"
                onClick={() => onSelectOverlay(ov.id)}
                className={cx(
                  "absolute top-1 flex h-[calc(100%-8px)] items-center overflow-hidden rounded-xs border px-2 text-2xs",
                  TYPE_TINT.overlay,
                  selectionId === ov.id ? "ring-2 ring-vf-selection" : "",
                )}
                style={{
                  left: ov.startOnTimeline * pxPerMs,
                  width: Math.max(12, (ov.endOnTimeline - ov.startOnTimeline) * pxPerMs),
                }}
                title={ov.kind === "text" ? ov.text : ov.kind}
              >
                <span aria-hidden="true" className="mr-1 text-vf-text-tertiary">
                  ▤
                </span>
                <span className="truncate text-vf-text-primary">
                  {ov.kind === "text" ? ov.text : ov.kind}
                </span>
              </button>
            ))
          : track.clips.map((clip) => (
              <MediaClipBlock
                key={clip.id}
                clip={clip}
                track={track}
                pxPerMs={pxPerMs}
                selected={selectionId === clip.id}
                previewOverride={clip.id === dragClipId ? dragPreview : null}
                slotInfo={placeholderSlots.get(clip.id) ?? null}
                onClipDown={onClipDown}
                onContextMenu={(x, y) => onClipContextMenu(clip.id, track.id, x, y)}
              />
            ))}
    </div>
  );
}

// ── A single media (video / audio) clip block with trim handles ──────────────────
// Memoised so a drag (which only changes the dragged clip's override) and unrelated
// store updates do not re-render every clip on the timeline (§3.1 perf substrate).
const MediaClipBlock = memo(function MediaClipBlock({
  clip,
  track,
  pxPerMs,
  selected,
  previewOverride,
  slotInfo,
  onClipDown,
  onContextMenu,
}: {
  clip: Clip;
  track: Track;
  pxPerMs: number;
  selected: boolean;
  previewOverride: DragPreview | null;
  slotInfo: SlotInfo | null;
  onClipDown: (e: React.PointerEvent, clip: Clip, track: Track, mode: DragMode) => void;
  onContextMenu: (x: number, y: number) => void;
}) {
  // During a drag, render at the live (uncommitted) preview position.
  const startMs = previewOverride?.startMs ?? clip.startOnTimeline;
  const endMs = previewOverride?.endMs ?? clip.endOnTimeline;
  const left = startMs * pxPerMs;
  const width = Math.max(16, (endMs - startMs) * pxPerMs);
  const isAudio = track.type === "audio" || track.type === "voiceover";
  // Unfilled template media slot → dashed placeholder block (Templates_Design §2.1).
  // Dashed border is reserved EXCLUSIVELY for slot clips (design guardrail).
  const isPlaceholder = slotInfo !== null;

  return (
    <div
      role="gridcell"
      aria-selected={selected}
      data-testid={`clip-${clip.id}`}
      data-placeholder={isPlaceholder ? "true" : undefined}
      onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); onContextMenu(e.clientX, e.clientY); }}
      onPointerDown={(e) => onClipDown(e, clip, track, "move")}
      className={cx(
        "group absolute top-1 flex h-[calc(100%-8px)] cursor-move flex-col overflow-hidden rounded-xs border",
        isPlaceholder
          ? "border-dashed border-vf-border-default bg-vf-surface-2"
          : isAudio
            ? TYPE_TINT.audio
            : TYPE_TINT.video,
        selected ? "border-2 border-vf-selection" : "",
      )}
      style={{ left, width }}
    >
      {isPlaceholder ? (
        // Slot placeholder: icon + "Drop your photo or video here" + "N of M" badge.
        <div className="flex h-full w-full items-center gap-2 px-2">
          <span aria-hidden="true" className="text-vf-icon-muted">▦</span>
          <span className="truncate text-xs font-medium text-vf-text-tertiary">
            Drop your photo or video here
          </span>
          <span className="ml-auto shrink-0 text-2xs text-vf-text-disabled">
            {slotInfo!.index} of {slotInfo!.total}
          </span>
        </div>
      ) : (
        <>
      {/* Label strip (video) */}
      <div className="flex h-4 shrink-0 items-center gap-1 bg-black/25 px-1">
        <span className="truncate text-2xs text-vf-text-primary">
          {isAudio ? "audio" : "video"} {clip.id.slice(0, 4)}
        </span>
        {clip.speed !== 1 && (
          <span className="rounded-pill bg-vf-surface-4 px-1 text-[9px] text-vf-text-secondary vf-tnum">
            {clip.speed}×
          </span>
        )}
        {clip.linkedClipId && (
          <span aria-label="Audio-linked" title="Audio-linked" className="ml-auto text-[10px]">
            🔗
          </span>
        )}
      </div>

      {/* Body: real waveform peaks for audio, plain fill for video */}
      <div className="relative min-h-0 flex-1">
        {isAudio ? (
          <ClipWaveform assetId={clip.sourceAssetId} trimInMs={clip.trimIn} trimOutMs={clip.trimOut} />
        ) : null}
      </div>
        </>
      )}

      {/* Trim handles (8px grab zones; appear on hover/selection) */}
      <div
        onPointerDown={(e) => onClipDown(e, clip, track, "trim-start")}
        className="absolute left-0 top-0 h-full w-2 cursor-ew-resize bg-vf-border-strong/0 group-hover:bg-vf-border-strong/40"
        aria-hidden="true"
      />
      <div
        onPointerDown={(e) => onClipDown(e, clip, track, "trim-end")}
        className="absolute right-0 top-0 h-full w-2 cursor-ew-resize bg-vf-border-strong/0 group-hover:bg-vf-border-strong/40"
        aria-hidden="true"
      />
    </div>
  );
});

// ── Real waveform peaks for an audio clip ─────────────────────────────────────────
// Fetches the asset's waveform-peaks JSON (written by the worker's analysis job) and
// renders the slice corresponding to the clip's [trimIn, trimOut] window. Falls back
// to a flat baseline while loading / when unavailable — never a fake sine.

const waveformPeaksCache = new Map<string, number[]>();

function ClipWaveform({
  assetId,
  trimInMs,
  trimOutMs,
}: {
  assetId: string;
  trimInMs: number;
  trimOutMs: number;
}) {
  const [peaks, setPeaks] = useState<number[] | null>(waveformPeaksCache.get(assetId) ?? null);

  useEffect(() => {
    if (peaks) return;
    const url = getAssetMeta(assetId)?.waveformUrl;
    if (!url) return;
    let cancelled = false;
    void fetch(url)
      .then((r) => (r.ok ? r.json() : null))
      .then((data: unknown) => {
        if (cancelled || data == null) return;
        const arr: number[] = Array.isArray(data)
          ? (data as number[])
          : Array.isArray((data as { peaks?: number[] }).peaks)
            ? (data as { peaks: number[] }).peaks
            : [];
        if (arr.length) {
          waveformPeaksCache.set(assetId, arr);
          setPeaks(arr);
        }
      })
      .catch(() => { /* non-fatal: keep the flat baseline */ });
    return () => { cancelled = true; };
  }, [assetId, peaks]);

  const durationMs = getAssetMeta(assetId)?.durationMs ?? null;
  const path = useMemo(() => {
    if (!peaks || peaks.length === 0) return null;
    let slice = peaks;
    if (durationMs && durationMs > 0) {
      const n = peaks.length;
      const a = Math.max(0, Math.floor((trimInMs / durationMs) * n));
      const b = Math.min(n, Math.ceil((trimOutMs / durationMs) * n));
      if (b > a) slice = peaks.slice(a, b);
    }
    return buildWavePath(slice);
  }, [peaks, durationMs, trimInMs, trimOutMs]);

  if (!path) {
    return (
      <svg className="h-full w-full" preserveAspectRatio="none" viewBox="0 0 100 20" aria-hidden="true">
        <line x1="0" y1="10" x2="100" y2="10" stroke="var(--vf-track-audio-waveform)" strokeWidth="0.4" opacity="0.5" />
      </svg>
    );
  }
  return (
    <svg className="h-full w-full" preserveAspectRatio="none" viewBox="0 0 100 20" aria-hidden="true">
      <path d={path} fill="none" stroke="var(--vf-track-audio-waveform)" strokeWidth="0.6" />
    </svg>
  );
}

/** Build a 0..100 × 0..20 mirrored waveform path from normalised (0..1) peaks. */
function buildWavePath(peaks: number[]): string {
  const N = 100;
  let d = "M 0 10";
  for (let i = 0; i <= N; i++) {
    const idx = Math.min(peaks.length - 1, Math.floor((i / N) * peaks.length));
    const amp = Math.max(0.4, Math.min(1, peaks[idx] ?? 0)) * 9;
    d += ` L ${i} ${10 - amp} L ${i} ${10 + amp}`;
  }
  return d;
}

// ── "+ Add track" menu honouring Free-tier ceilings (§6.2, no upsell) ─────────────
function AddTrackMenu({
  tracks,
  onAdd,
}: {
  tracks: Track[];
  onAdd: (kind: AddTrackKind) => void;
}) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const dismiss = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", dismiss);
    return () => document.removeEventListener("mousedown", dismiss);
  }, [open]);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const t of tracks) c[t.type] = (c[t.type] ?? 0) + 1;
    return c;
  }, [tracks]);

  const options: Array<{ kind: AddTrackKind; label: string }> = [
    { kind: "video", label: "Video track" },
    { kind: "audio", label: "Audio track" },
    { kind: "overlay", label: "Overlay track" },
  ];

  return (
    <div className="relative">
      <IconButton aria-label="Add track" size="sm" onClick={() => setOpen((v) => !v)}>
        <span aria-hidden="true">+</span>
      </IconButton>
      {open && (
        <div
          ref={menuRef}
          role="menu"
          data-testid="add-track-menu"
          className="absolute right-0 top-7 z-dropdown w-44 rounded-md border border-vf-border-subtle bg-vf-surface-3 p-1 shadow-vf-2"
        >
          {options.map(({ kind, label }) => {
            const atCap = (counts[kind] ?? 0) >= TRACK_CAPS[kind];
            const item = (
              <button
                key={kind}
                type="button"
                role="menuitem"
                disabled={atCap}
                aria-disabled={atCap}
                onClick={() => {
                  if (atCap) return;
                  onAdd(kind);
                  setOpen(false);
                }}
                className={cx(
                  "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-xs",
                  atCap
                    ? "cursor-not-allowed text-vf-text-disabled"
                    : "text-vf-text-primary hover:bg-vf-surface-4",
                )}
              >
                <span aria-hidden="true">{TYPE_ICON[kind]}</span>
                {label}
              </button>
            );
            // Free-tier ceiling → disabled with an informational tooltip, NO upsell.
            return atCap ? (
              <Tooltip key={kind} label={`Free tier: max ${TRACK_CAPS[kind]} ${kind} tracks`} side="bottom">
                {item}
              </Tooltip>
            ) : (
              item
            );
          })}
        </div>
      )}
    </div>
  );
}
