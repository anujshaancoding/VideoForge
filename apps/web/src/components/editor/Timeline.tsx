import { useEffect, useMemo, useRef, useState } from "react";
import {
  selectProjectDurationMs,
  useEditorStore,
  type AddTrackKind,
} from "../../store/editorStore.js";
import { msToTimecode } from "@videoforge/project-schema";
import type { Clip, Track } from "@videoforge/project-schema";
import { cx, IconButton, Tooltip } from "../ui/index.js";

// Timeline — bottom band, the hero edit surface (§6). Zero-prop, store-driven.
//   • sticky ruler with adaptive timecode ticks (density from pxPerSecond)
//   • 180px track-header column per track (type icon, name, audio mute/solo)
//   • track body: each clip a block at startOnTimeline*pxPerSecond, width by duration
//   • draggable red playhead; click ruler → setPlayhead; click clip → select
//   • Audio-Link chain glyph on linked clips; orange snap line during drag
//   • "+ Add track" honours Free-tier ceilings (disabled tooltip, NO upsell)
//   • real-but-modest interactions: click-select, drag-to-move (moveClip), edge trim
//     handles (trimClip). MVP-STUB: rubber-band, ripple, cross-track swap deferred.

const HEADER_W = 180; // §2.1 pinned track-header column width
const RULER_H = 32;

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

interface DragState {
  clipId: string;
  trackId: string;
  mode: "move" | "trim-start" | "trim-end";
  startX: number;
  originStartMs: number;
  originEndMs: number;
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
  const setZoom = useEditorStore((s) => s.setZoom);

  const bodyRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [snapX, setSnapX] = useState<number | null>(null);

  // Right-click context menu on media clips.
  const [clipCtx, setClipCtx] = useState<{
    clipId: string;
    trackId: string;
    x: number;
    y: number;
  } | null>(null);

  useEffect(() => {
    if (!clipCtx) return;
    const dismiss = () => setClipCtx(null);
    document.addEventListener("mousedown", dismiss);
    return () => document.removeEventListener("mousedown", dismiss);
  }, [clipCtx]);

  const pxPerMs = pxPerSecond / 1000;
  // The content width spans the project duration plus a tail of empty room.
  const contentWidthPx = Math.max(800, (durationMs + 4000) * pxPerMs);

  // All lanes top→bottom: media/overlay tracks then caption tracks (§6.2 order is a
  // design nicety; we render in array order which already encodes z-order, §18).
  const allTracks = useMemo<Track[]>(
    () => [...tracks, ...captionTracks],
    [tracks, captionTracks],
  );

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

  // ── Pointer-driven clip move / trim ──
  const onClipPointerDown = (
    e: React.PointerEvent,
    clip: Clip,
    track: Track,
    mode: DragState["mode"],
  ): void => {
    e.stopPropagation();
    if (track.locked) return;
    select("clip", clip.id);
    (e.target as Element).setPointerCapture?.(e.pointerId);
    setDrag({
      clipId: clip.id,
      trackId: track.id,
      mode,
      startX: e.clientX,
      originStartMs: clip.startOnTimeline,
      originEndMs: clip.endOnTimeline,
    });
  };

  const onBodyPointerMove = (e: React.PointerEvent): void => {
    if (!drag) return;
    const deltaMs = (e.clientX - drag.startX) / pxPerMs;
    if (drag.mode === "move") {
      const next = Math.max(0, drag.originStartMs + deltaMs);
      moveClip(drag.clipId, drag.trackId, next);
      setSnapX(next * pxPerMs); // simple snap-line affordance at the new start edge
    } else if (drag.mode === "trim-start") {
      trimClip(drag.clipId, "start", drag.originStartMs + deltaMs);
      setSnapX((drag.originStartMs + deltaMs) * pxPerMs);
    } else {
      trimClip(drag.clipId, "end", drag.originEndMs + deltaMs);
      setSnapX((drag.originEndMs + deltaMs) * pxPerMs);
    }
  };

  const endDrag = (): void => {
    setDrag(null);
    setSnapX(null);
  };

  // Called by TrackBody when an asset is dropped onto a lane from the MediaPanel.
  const handleDropClip = (assetId: string, clientX: number, trackId: string): void => {
    const body = bodyRef.current;
    if (!body) return;
    const rect = body.getBoundingClientRect();
    const x = clientX - rect.left + body.scrollLeft;
    const dropMs = Math.max(0, x / pxPerMs);
    addClipFromAsset(assetId, trackId, dropMs);
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
      <div className="flex min-h-0 flex-1 overflow-y-auto">
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
            {snapX !== null && (
              <div
                aria-hidden="true"
                className="pointer-events-none absolute top-0 z-sticky h-full w-0.5 bg-vf-snap-line"
                style={{ left: snapX }}
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
}: {
  track: Track;
  selected: boolean;
  onSelect: () => void;
  onMute: (v: boolean) => void;
  onSolo: (v: boolean) => void;
}) {
  const isAudio = track.type === "audio" || track.type === "voiceover";
  return (
    <div
      onClick={onSelect}
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
  onClipDown,
  onSelectCaption,
  onSelectOverlay,
  onDropClip,
  onClipContextMenu,
}: {
  track: Track;
  pxPerMs: number;
  selectionId: string | null;
  onClipDown: (e: React.PointerEvent, clip: Clip, track: Track, mode: DragState["mode"]) => void;
  onSelectCaption: (id: string) => void;
  onSelectOverlay: (id: string) => void;
  onDropClip: (assetId: string, clientX: number, trackId: string) => void;
  onClipContextMenu: (clipId: string, trackId: string, x: number, y: number) => void;
}) {
  const canReceiveDrop = track.type === "video" || track.type === "audio" || track.type === "voiceover";

  // Caption + overlay clips do not carry the media Clip shape; render minimal blocks.
  return (
    <div
      className={cx(
        "relative border-b border-vf-border-subtle",
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
                onClipDown={onClipDown}
                onContextMenu={(x, y) => onClipContextMenu(clip.id, track.id, x, y)}
              />
            ))}
    </div>
  );
}

// ── A single media (video / audio) clip block with trim handles ──────────────────
function MediaClipBlock({
  clip,
  track,
  pxPerMs,
  selected,
  onClipDown,
  onContextMenu,
}: {
  clip: Clip;
  track: Track;
  pxPerMs: number;
  selected: boolean;
  onClipDown: (e: React.PointerEvent, clip: Clip, track: Track, mode: DragState["mode"]) => void;
  onContextMenu: (x: number, y: number) => void;
}) {
  const left = clip.startOnTimeline * pxPerMs;
  const width = Math.max(16, (clip.endOnTimeline - clip.startOnTimeline) * pxPerMs);
  const isAudio = track.type === "audio" || track.type === "voiceover";

  return (
    <div
      role="gridcell"
      aria-selected={selected}
      data-testid={`clip-${clip.id}`}
      onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); onContextMenu(e.clientX, e.clientY); }}
      onPointerDown={(e) => onClipDown(e, clip, track, "move")}
      className={cx(
        "group absolute top-1 flex h-[calc(100%-8px)] cursor-move flex-col overflow-hidden rounded-xs border",
        isAudio ? TYPE_TINT.audio : TYPE_TINT.video,
        selected ? "border-2 border-vf-selection" : "",
      )}
      style={{ left, width }}
    >
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

      {/* Body: faux waveform for audio, plain fill for video */}
      <div className="relative min-h-0 flex-1">
        {isAudio ? (
          <svg className="h-full w-full" preserveAspectRatio="none" viewBox="0 0 100 20" aria-hidden="true">
            <path
              d={fauxWaveform()}
              fill="none"
              stroke="var(--vf-track-audio-waveform)"
              strokeWidth="0.6"
            />
          </svg>
        ) : null}
      </div>

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
}

// Deterministic faux waveform path (MVP-STUB: real peaks come from the analysis job).
function fauxWaveform(): string {
  let d = "M 0 10";
  for (let x = 0; x <= 100; x += 2) {
    const amp = 2 + 7 * Math.abs(Math.sin(x * 0.6) * Math.cos(x * 0.21));
    d += ` L ${x} ${10 - amp} L ${x} ${10 + amp}`;
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
