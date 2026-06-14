import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { selectClip, useEditorStore } from "../../store/editorStore.js";
import { getAssetMeta } from "../../store/assetStore.js";
import { cx, Tooltip } from "../ui/index.js";
import { audioEngine, previewEngine } from "../../engine/index.js";
import { Shield, Maximize2, RotateCcw, FlipHorizontal, FlipVertical, ArrowUp, ArrowDown, Copy, Trash2 } from "lucide-react";

/** Default (full-frame) box for a clip that has no explicit transform yet. */
const FULL_FRAME = { x: 0, y: 0, width: 100, height: 100 } as const;
type Box = { x: number; y: number; width: number; height: number };
type Handle = "nw" | "ne" | "sw" | "se";

// CanvasStage — center preview (§5). Fixed to the project aspect ratio, centered on
// the #1A1A2E surround with equal letterbox/pillarbox padding. Zero-prop, store-driven.
//
// M2 implementation (§5.1): PreviewEngine + AudioEngine handle all decode, composite,
// and timing. The canvas is passed to the engine on mount; the engine drives the rAF
// loop. This component:
//   1. Inits the engine on mount with the canvas element + store callbacks.
//   2. Subscribes to store changes and forwards them to the engine.
//   3. Draws the safe-zone overlay on top (editor-only, never exported).
//   4. Teardown via engine.destroy() on unmount.
//
// Safe-zone and selection bounding-box overlays are painted by a secondary rAF loop
// that composites ON TOP of the engine output without interfering with the engine's
// own canvas writes.

const ZOOM_STEPS = [25, 50, 75, 100, 150, 200, 400];

export default function CanvasStage() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);

  const aspectRatio = useEditorStore((s) => s.project.canvas.aspectRatio);
  const canvasW = useEditorStore((s) => s.project.canvas.width);
  const canvasH = useEditorStore((s) => s.project.canvas.height);
  const bgColor = useEditorStore((s) => s.project.canvas.backgroundColor);

  // Selected media clip (for the on-canvas transform box). Re-derives on edits.
  const selectedClip = useEditorStore((s) =>
    s.selection.kind === "clip" && s.selection.id ? selectClip(s, s.selection.id) : null,
  );
  const setClipTransform = useEditorStore((s) => s.setClipTransform);
  const setClipFlip = useEditorStore((s) => s.setClipFlip);
  const moveClipLayer = useEditorStore((s) => s.moveClipLayer);
  const duplicateSelected = useEditorStore((s) => s.duplicateSelected);
  const deleteSelected = useEditorStore((s) => s.deleteSelected);

  const [safeZones, setSafeZones] = useState(false);
  const [zoom, setZoom] = useState(100);
  // Live box while dragging/resizing on the canvas (committed to the store on release,
  // so a whole gesture is ONE undo step — not hundreds, mirroring the timeline drag).
  const [dragBox, setDragBox] = useState<Box | null>(null);
  // Transient alignment guides (percent positions) shown only while a drag/resize is
  // snapped to canvas center/edges. Sky-blue (brand selection colour). Preview-only UX:
  // the COMMITTED value is just a normal snapped transform, so the export is unaffected
  // (no export change needed) — the guides never render to the canvas/engine output.
  const [guides, setGuides] = useState<{ v: number[]; h: number[] }>({ v: [], h: [] });
  // For inline text editing on double-click (P1 gap: double-click text should enter edit mode in canvas)
  const [editingTextId, setEditingTextId] = useState<string | null>(null);
  // Ref to the inline contentEditable box so we can focus it + place the caret
  // when editing begins (a contentEditable div is not focused automatically).
  const editorRef = useRef<HTMLDivElement>(null);

  // F08: when inline edit mode opens, move keyboard focus into the contentEditable
  // box and drop the caret at the end of the seeded text so the user can type
  // immediately (without this, the box renders but shows no caret — the reported bug).
  useEffect(() => {
    if (!editingTextId) return;
    const el = editorRef.current;
    if (!el) return;
    el.focus();
    const sel = window.getSelection();
    if (sel) {
      const range = document.createRange();
      range.selectNodeContents(el);
      range.collapse(false); // caret at end
      sel.removeAllRanges();
      sel.addRange(range);
    }
  }, [editingTextId]);

  // Cmd/Ctrl + +/- for canvas zoom (to match Canva and report request)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && (e.key === "+" || e.key === "=")) {
        e.preventDefault();
        setZoom((z) => Math.min(200, z + 25));
      } else if (mod && e.key === "-") {
        e.preventDefault();
        setZoom((z) => Math.max(25, z - 25));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Canvas right-click context menu (Canva-style, disables native browser menu).
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; items: Array<{ label: string; onClick: () => void; disabled?: boolean; shortcut?: string }> } | null>(null);

  // ── Engine init on mount ──────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const store = useEditorStore.getState();

    // Throttle playhead store updates. Per-frame is too much for Zustand re-renders.
    // During playback we use a tighter throttle so the timecode visibly advances
    // immediately when the user presses Play (the previous 80ms + initial delay was
    // causing "Play flips to Pause but time stays at 00:00").
    let lastPlayheadUpdate = 0;
    const throttledSetPlayhead = (ms: number) => {
      const now = performance.now();
      // Much tighter during play for responsive timecode; looser when paused/scrubbing.
      const isPlayingNow = useEditorStore.getState().isPlaying;
      const interval = isPlayingNow ? 80 : 140; // looser during play to reduce React churn (timecode, timeline playhead re-renders) while keeping UI responsive
      if (now - lastPlayheadUpdate > interval) {
        lastPlayheadUpdate = now;
        useEditorStore.getState().setPlayhead(ms);
      } else if (isPlayingNow && (now - lastPlayheadUpdate) > 25) {
        // During play, force a few early updates so the first second of playback
        // doesn't look stuck even if the RAF timing lands between throttles.
        lastPlayheadUpdate = now;
        useEditorStore.getState().setPlayhead(ms);
      }
    };

    previewEngine.init(canvas, audioEngine, {
      onPlayheadUpdate: throttledSetPlayhead,
      onPlaybackEnded: () => useEditorStore.getState().pause(),
    });

    previewEngine.setProject(store.project);
    audioEngine.updateProject(store.project);

    // Autoplay policy: the AudioContext (our master playback clock) is created
    // SUSPENDED on every page load until a user gesture. Resume it on the first
    // interaction so the clock is already running by the time Play is pressed —
    // otherwise, right after a reload, the playhead clock stays frozen and the
    // video gets stuck on a single frame. Idempotent + self-removing.
    const unlockAudio = () => {
      const ctx = audioEngine.audioCtx;
      if (ctx.state !== "running") void ctx.resume().catch(() => undefined);
      window.removeEventListener("pointerdown", unlockAudio);
      window.removeEventListener("keydown", unlockAudio);
      window.removeEventListener("touchstart", unlockAudio);
    };
    window.addEventListener("pointerdown", unlockAudio);
    window.addEventListener("keydown", unlockAudio);
    window.addEventListener("touchstart", unlockAudio);

    return () => {
      window.removeEventListener("pointerdown", unlockAudio);
      window.removeEventListener("keydown", unlockAudio);
      window.removeEventListener("touchstart", unlockAudio);
      previewEngine.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Forward store changes to engine ──────────────────────────────────────
  useEffect(() => {
    let prevIsPlaying = useEditorStore.getState().isPlaying;
    let prevPlayheadMs = useEditorStore.getState().playheadMs;
    let prevProject = useEditorStore.getState().project;

    return useEditorStore.subscribe((state) => {
      const { isPlaying, playheadMs, project } = state;

      // Project changed → sync engines.
      if (project !== prevProject) {
        previewEngine.setProject(project);
        audioEngine.updateProject(project);
        prevProject = project;
      }

      // Playback state changed.
      if (isPlaying !== prevIsPlaying) {
        if (isPlaying) {
          previewEngine.play(playheadMs);
          // Force an immediate store update with the starting time so the timecode
          // reflects the play state right away (works around any throttle/RAF delay
          // on the very first engine emit).
          useEditorStore.getState().setPlayhead(playheadMs);
        } else {
          previewEngine.pause();
        }
        prevIsPlaying = isPlaying;
      }

      // Seek while paused (scrub).
      if (!isPlaying && playheadMs !== prevPlayheadMs) {
        previewEngine.seekTo(playheadMs);
        prevPlayheadMs = playheadMs;
      }
    });
  }, []);

  // Safe-zone guides are a DOM overlay (below) — NOT strokes on the engine canvas.
  // The old approach stroked the engine's own canvas from a separate rAF loop, so
  // toggling Safe off left the lines burned in until the next engine redraw (and the
  // loop ran at 60fps fighting the engine). A DOM overlay toggles cleanly + for free.

  // ── Canvas backing-store resolution ──────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const scale = Math.min(1, 720 / Math.max(canvasW, canvasH));
    canvas.width = Math.round(canvasW * scale);
    canvas.height = Math.round(canvasH * scale);
  }, [canvasW, canvasH]);

  // clearSelection is now handled at the viewport level (see onPointerDown below)
  // so clicks anywhere on the stage "white space" / empty area will deselect
  // and close context menus, while clicks on the active selection box or toolbar
  // are stopped by those elements.

  const onCanvasDoubleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    // Hit-test text overlays so double-click on drawn text selects the overlay
    // (allowing edit in the inspector panel) instead of always clearing selection.
    // This fixes the critical "double-click text deselects instead of entering edit mode" bug.
    const state = useEditorStore.getState();
    const proj = state.project;
    const overlayTracks = proj.tracks.filter((t) => t.type === "overlay");
    const textOverlays: any[] = [];
    for (const t of overlayTracks) {
      for (const c of t.clips) {
        if (c.kind === "text") textOverlays.push(c);
      }
    }
    if (textOverlays.length === 0) {
      state.clearSelection();
      return;
    }

    const vp = viewportRef.current;
    if (!vp) {
      state.clearSelection();
      return;
    }
    const rect = vp.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * 100;
    const py = ((e.clientY - rect.top) / rect.height) * 100;

    for (const ov of textOverlays) {
      const { canvasX = 0, canvasY = 0, width = 100, height = 100 } = ov;
      if (px >= canvasX && px <= canvasX + width && py >= canvasY && py <= canvasY + height) {
        state.select("overlay", ov.id);
        setEditingTextId(ov.id); // enter inline edit
        return;
      }
    }
    state.clearSelection();
    setEditingTextId(null);
  };

  // ── On-canvas transform: drag the box to move, corners to resize ───────────
  // Box is percent-of-canvas; mirrors the export (clipBox) so what you see == export.
  function beginTransform(e: React.PointerEvent, mode: "move" | Handle): void {
    if (!selectedClip) return;
    e.preventDefault();
    e.stopPropagation();
    const vp = viewportRef.current;
    if (!vp) return;
    const rect = vp.getBoundingClientRect();
    const startBox: Box = { ...(selectedClip.transform ?? FULL_FRAME) };
    const startX = e.clientX;
    const startY = e.clientY;
    const clip = selectedClip;
    let live: Box = startBox;

    // Snap-to-center / snap-to-edge while dragging (alignment snapping). Threshold is a
    // small fraction of the canvas; when an edge or the box center lands within it of a
    // canvas guide line (0% / 50% / 100%), the value is nudged exactly onto the line and
    // a transient sky-blue guide is drawn. This is preview-only UX — the committed box is
    // an ordinary snapped transform, so the export geometry is unchanged.
    const SNAP = 1.5; // percent threshold
    const snap1d = (v: number, targets: number[]): { v: number; hit: number | null } => {
      for (const t of targets) {
        if (Math.abs(v - t) <= SNAP) return { v: t, hit: t };
      }
      return { v, hit: null };
    };

    const onMove = (ev: PointerEvent): void => {
      const dx = ((ev.clientX - startX) / rect.width) * 100;
      const dy = ((ev.clientY - startY) / rect.height) * 100;
      let b: Box = { ...startBox };
      const vGuides = new Set<number>();
      const hGuides = new Set<number>();
      if (mode === "move") {
        b.x = startBox.x + dx;
        b.y = startBox.y + dy;
        // Snap left edge, horizontal center, and right edge against canvas 0/50/100.
        const cx = b.x + b.width / 2;
        const left = snap1d(b.x, [0]);
        const center = snap1d(cx, [50]);
        const right = snap1d(b.x + b.width, [100]);
        if (center.hit !== null) { b.x = center.v - b.width / 2; vGuides.add(50); }
        else if (left.hit !== null) { b.x = 0; vGuides.add(0); }
        else if (right.hit !== null) { b.x = 100 - b.width; vGuides.add(100); }
        // Same for the vertical axis (top edge / vertical center / bottom edge).
        const cy = b.y + b.height / 2;
        const top = snap1d(b.y, [0]);
        const middle = snap1d(cy, [50]);
        const bottom = snap1d(b.y + b.height, [100]);
        if (middle.hit !== null) { b.y = middle.v - b.height / 2; hGuides.add(50); }
        else if (top.hit !== null) { b.y = 0; hGuides.add(0); }
        else if (bottom.hit !== null) { b.y = 100 - b.height; hGuides.add(100); }
      } else {
        const right = startBox.x + startBox.width;
        const bottom = startBox.y + startBox.height;
        let nx = startBox.x;
        let ny = startBox.y;
        let nr = right;
        let nb = bottom;
        if (mode.includes("w")) nx = startBox.x + dx;
        if (mode.includes("e")) nr = right + dx;
        if (mode.includes("n")) ny = startBox.y + dy;
        if (mode.includes("s")) nb = bottom + dy;
        // Snap whichever edges are being dragged to the canvas edges/center.
        if (mode.includes("w")) { const s = snap1d(nx, [0, 50]); if (s.hit !== null) { nx = s.v; vGuides.add(s.hit); } }
        if (mode.includes("e")) { const s = snap1d(nr, [50, 100]); if (s.hit !== null) { nr = s.v; vGuides.add(s.hit); } }
        if (mode.includes("n")) { const s = snap1d(ny, [0, 50]); if (s.hit !== null) { ny = s.v; hGuides.add(s.hit); } }
        if (mode.includes("s")) { const s = snap1d(nb, [50, 100]); if (s.hit !== null) { nb = s.v; hGuides.add(s.hit); } }
        const MIN = 5; // percent floor so a box can't collapse
        b = {
          x: Math.min(nx, nr - MIN),
          y: Math.min(ny, nb - MIN),
          width: Math.max(MIN, nr - nx),
          height: Math.max(MIN, nb - ny),
        };
      }
      live = b;
      setDragBox(b);
      setGuides({ v: [...vGuides], h: [...hGuides] });
    };
    const onUp = (): void => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      const r = (n: number): number => Math.round(n * 100) / 100;
      setClipTransform(clip.id, clip.trackId, {
        x: r(live.x),
        y: r(live.y),
        width: r(live.width),
        height: r(live.height),
      });
      setDragBox(null);
      setGuides({ v: [], h: [] });
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  // Rotate direct-manipulation removed (invariant): the export emits no rotate filter
  // (clip rotation is deferred), so offering a rotate handle / applying rotate(...) in
  // the preview would show a rotation the export won't honor. The schema field stays;
  // only the UI affordance + preview application are removed.

  // ── Drag a media asset from the gallery onto the canvas → PiP overlay ──────
  const onCanvasDragOver = (e: React.DragEvent): void => {
    if (e.dataTransfer.types.includes("application/x-vf-asset")) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
    }
  };
  const onCanvasDrop = (e: React.DragEvent): void => {
    const assetId = e.dataTransfer.getData("application/x-vf-asset");
    const kind = e.dataTransfer.getData("application/x-vf-asset-kind");
    if (!assetId) return;
    e.preventDefault();

    const store = useEditorStore.getState();
    const proj = store.project;
    const durationMs = getAssetMeta(assetId)?.durationMs ?? undefined;

    if (kind === "audio") {
      // Add to audio/voiceover track at playhead (or end of content)
      let track = proj.tracks.find((t) => t.type === "audio" || t.type === "voiceover");
      if (!track) {
        store.addTrack("audio");
        const updated = useEditorStore.getState().project;
        track = updated.tracks.find((t) => t.type === "audio" || t.type === "voiceover");
      }
      if (!track) return;
      const clips = "clips" in track ? track.clips : [];
      const trackEnd = clips.reduce((max, c) => Math.max(max, c.endOnTimeline), 0);
      const atMs = Math.max(store.playheadMs, trackEnd);
      store.addClipFromAsset(assetId, track.id, atMs, durationMs);
    } else {
      // Video or image: add to main video track at playhead (or end of content)
      // (Dropping on the "screen"/canvas adds as main timeline clip, per requested UX.
      // PiP overlays can still be created via other means or future modifier.)
      let track = proj.tracks.find((t) => t.type === "video");
      if (!track) {
        store.addTrack("video");
        const updated = useEditorStore.getState().project;
        track = updated.tracks.find((t) => t.type === "video");
      }
      if (!track) return;
      const clips = "clips" in track ? track.clips : [];
      const trackEnd = clips.reduce((max, c) => Math.max(max, c.endOnTimeline), 0);
      const atMs = Math.max(store.playheadMs, trackEnd);
      store.addClipFromAsset(assetId, track.id, atMs, durationMs);
    }
  };

  const HANDLE_POS: Record<Handle, React.CSSProperties> = {
    nw: { left: 0, top: 0, cursor: "nwse-resize" },
    ne: { right: 0, top: 0, cursor: "nesw-resize" },
    sw: { left: 0, bottom: 0, cursor: "nesw-resize" },
    se: { right: 0, bottom: 0, cursor: "nwse-resize" },
  };
  const box: Box = dragBox ?? selectedClip?.transform ?? FULL_FRAME;

  // Compute toolbar screen position using fixed positioning + portal.
  // This makes the "items to edit" toolbar immune to overflow-hidden on the stage frame
  // and to being covered by the transport bar at the bottom.
  const [toolbarScreenPos, setToolbarScreenPos] = useState<{ left: number; top: number } | null>(null);

  useEffect(() => {
    const vp = viewportRef.current;
    if (!vp || !selectedClip) {
      setToolbarScreenPos(null);
      return;
    }

    const rect = vp.getBoundingClientRect();
    const centerXPct = box.x + box.width / 2;
    const left = rect.left + (centerXPct / 100) * rect.width;

    const isLowOnCanvas = (box.y + box.height) > 75;
    const placeAbove = box.y > 12 || isLowOnCanvas;

    let top: number;
    if (placeAbove) {
      top = rect.top + (box.y / 100) * rect.height - 52; // above the box
    } else {
      top = rect.top + ((box.y + box.height) / 100) * rect.height + 6;
    }

    setToolbarScreenPos({ left, top });
  }, [box, selectedClip]);

  return (
    <div
      ref={wrapRef}
      role="main"
      className="relative flex h-full min-h-0 w-full items-center justify-center overflow-visible bg-vf-surface-canvas-surround p-1 sm:p-3 md:p-6"
    >
      {/* Overlay HUD (top-right): Safe / Zoom / Fit (§5.2). Larger premium controls. */}
      <div className="absolute right-2 top-2 z-[999] flex flex-wrap items-center gap-1 rounded-lg bg-vf-surface-2/90 p-1 shadow-vf-1 sm:right-3 sm:top-3 sm:gap-1.5 sm:p-1.5">
        <Tooltip label="Safe zones">
          <button
            type="button"
            aria-pressed={safeZones}
            onClick={() => setSafeZones((v) => !v)}
            className={cx(
              "flex h-9 items-center gap-1 rounded-md px-2 text-xs",
              safeZones
                ? "bg-vf-surface-3 text-vf-accent-text"
                : "text-vf-text-tertiary hover:bg-vf-surface-3",
            )}
          >
            <Shield className="h-5 w-5" aria-hidden="true" /> <span className="hidden sm:inline">Safe</span>
          </button>
        </Tooltip>
        <Tooltip label="Zoom">
          <select
            aria-label="Canvas zoom"
            value={zoom}
            onChange={(e) => setZoom(Number(e.target.value))}
            className="h-9 rounded-md bg-vf-surface-3 px-2 text-xs text-vf-text-primary vf-tnum"
          >
            {ZOOM_STEPS.map((z) => (
              <option key={z} value={z}>
                {z}%
              </option>
            ))}
          </select>
        </Tooltip>
        <Tooltip label="Fit">
          <button
            type="button"
            onClick={() => {
              // F12: compute fit so the canvas fills the available stage without overflow
              const vp = viewportRef.current;
              if (!vp) { setZoom(100); return; }
              const availW = vp.clientWidth - 16; // small padding
              const availH = vp.clientHeight - 16;
              const scale = Math.min(availW / canvasW, availH / canvasH);
              const fit = Math.max(25, Math.min(200, Math.round(scale * 100)));
              setZoom(fit);
            }}
            className="flex h-9 items-center gap-1 rounded-md px-2 text-xs text-vf-text-tertiary hover:bg-vf-surface-3"
          >
            <Maximize2 className="h-5 w-5" aria-hidden="true" /> <span className="hidden sm:inline">Fit</span>
          </button>
        </Tooltip>
      </div>

      {/* Preview viewport */}
      <div
        ref={viewportRef}
        className="relative max-h-full max-w-full"
        style={{
          aspectRatio: `${canvasW} / ${canvasH}`,
          height: `${zoom}%`,
          maxHeight: "100%",
          maxWidth: "100%",
        }}
        title={`${aspectRatio} · ${canvasW}×${canvasH}`}
        onDragOver={onCanvasDragOver}
        onDrop={onCanvasDrop}
        onWheel={(e) => {
          if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
            const factor = e.deltaY < 0 ? 1.25 : 0.8;
            setZoom((z) => Math.max(25, Math.min(200, z * factor)));
          }
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          const { clientX: x, clientY: y } = e;
          const items: Array<{ label: string; onClick: () => void; disabled?: boolean }> = [];
          const sel = useEditorStore.getState().selection;
          const hasSel = !!sel.id && (sel.kind === "clip" || sel.kind === "overlay");
          const cb = (useEditorStore.getState() as any).clipboard;
          if (hasSel) {
            items.push({ label: "Copy", onClick: () => useEditorStore.getState().copySelected(), shortcut: "⌘C" } as any);
            items.push({ label: "Duplicate", onClick: () => useEditorStore.getState().duplicateSelected(), shortcut: "⌘D" } as any);
            items.push({ label: "Delete", onClick: () => useEditorStore.getState().deleteSelected(), shortcut: "⌫" } as any);
            items.push({ label: "Split at playhead", onClick: () => useEditorStore.getState().splitAtPlayhead(), shortcut: "S" } as any);
            items.push({ label: "Bring forward", onClick: () => useEditorStore.getState().moveClipLayer?.(sel.id!, "forward") });
            items.push({ label: "Send backward", onClick: () => useEditorStore.getState().moveClipLayer?.(sel.id!, "backward") });
            // Add transition / Comment / Info stubs removed: out-of-MVP alert() placeholders.
          }
          if (cb) {
            items.push({ label: "Paste (⌘V)", onClick: () => useEditorStore.getState().paste() });
          }
          if (items.length) {
            setContextMenu({ x, y, items });
          }
        }}
        onPointerDown={() => {
          setContextMenu(null);
          // Clicking anywhere on the "white space" / empty area of the stage
          // (the entire viewport box) should clear the current selection
          // (deselect any overlay/text clip) and dismiss open context menus.
          // This is standard behavior (clicking background clears UI state).
          // Child elements like the transform box or toolbar stopPropagation
          // so interacting with a selected item (drag, resize, toolbar buttons)
          // does not accidentally clear the selection.
          useEditorStore.getState().clearSelection();
        }}
        onDoubleClick={onCanvasDoubleClick}
      >
        <canvas
          ref={canvasRef}
          role="application"
          aria-label="Preview canvas"
          className="h-full w-full rounded-sm border border-vf-border-subtle"
          style={{
            backgroundColor: bgColor || "#111111",
            aspectRatio: `${canvasW} / ${canvasH}`,
          }}
        />

        {/* F08 FIXED: Inline text editor now *inside* the relative viewportRef.
            This makes the `absolute` + % left/top/width/height position it directly
            over the drawn text overlay (using the same canvasX/Y/width/height
            coordinate system as the hit-test and the PreviewEngine layout).
            Styles changed to feel "in-place" on the canvas text (transparent bg,
            matching text color, visible caret) instead of a floating white box. */}
        {editingTextId && (() => {
          const st = useEditorStore.getState();
          let foundOv: any = null;
          for (const t of st.project.tracks) {
            if (t.type === "overlay") {
              foundOv = t.clips.find((c: any) => c.id === editingTextId);
              if (foundOv) break;
            }
          }
          if (!foundOv) return null;
          const style = (foundOv as any).style || {};
          // Better font scaling: base on the logical project height mapped to current display height of the viewport.
          const vh = viewportRef.current?.offsetHeight || 800;
          const baseFont = style.fontSize || 24;
          const fontSize = Math.max(10, (baseFont / 1920) * vh * (zoom / 100));
          const textColor = style.color || "#FFFFFF";
          return (
            <div
              key={editingTextId}
              ref={editorRef}
              contentEditable
              suppressContentEditableWarning
              className="absolute z-[200] bg-black/40 p-1 outline-none border border-vf-accent shadow-sm"
              style={{
                left: `${foundOv.canvasX || 0}%`,
                top: `${foundOv.canvasY || 0}%`,
                width: `${foundOv.width || 100}%`,
                height: `${foundOv.height || Math.max(8, (baseFont / 1920) * 100 * 1.4)}%`,
                fontSize: `${fontSize}px`,
                fontWeight: style.fontWeight || 600,
                // Hard-locked to Inter (invariant): the canvas + export both render
                // bundled Inter, so the inline editor must too to stay WYSIWYG.
                fontFamily: "Inter, system-ui, sans-serif",
                fontStyle: style.italic ? "italic" : "normal",
                color: textColor,
                caretColor: textColor,
                textAlign: style.align || "left",
                lineHeight: 1.2,
                overflow: "hidden",
                whiteSpace: "pre-wrap",
              }}
              onBlur={(e) => {
                const newText = (e.currentTarget.textContent || "").trim();
                useEditorStore.setState((s) => {
                  for (const t of s.project.tracks) {
                    if (t.type !== "overlay") continue;
                    const o = t.clips.find((c: any) => c.id === editingTextId);
                    if (o) { (o as any).text = newText || "Text"; break; }
                  }
                });
                setEditingTextId(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  (e.currentTarget as HTMLElement).blur();
                }
                if (e.key === "Escape") {
                  setEditingTextId(null);
                }
              }}
              // seed with current text
              dangerouslySetInnerHTML={{ __html: foundOv.text || "" }}
            />
          );
        })()}

        {/* Safe-zone guides (editor-only, never exported). DOM overlay so the
            toggle is instant and leaves no residue on the engine canvas. */}
        {safeZones && (
          <>
            <div
              aria-hidden="true"
              className="pointer-events-none absolute border border-dashed"
              style={{ inset: "5%", borderColor: "rgba(255,255,255,0.35)" }}
            />
            <div
              aria-hidden="true"
              className="pointer-events-none absolute border border-dashed"
              style={{ inset: "10%", borderColor: "rgba(255,209,92,0.5)" }}
            />
          </>
        )}

        {/* Alignment snapping guides (sky-blue, brand selection colour). Rendered only
            while a drag/resize is snapped to a canvas edge/center. Pure preview-only UX:
            never drawn to the engine output, so the export is unaffected. */}
        {(guides.v.length > 0 || guides.h.length > 0) && (
          <>
            {guides.v.map((vx) => (
              <div
                key={`v-${vx}`}
                aria-hidden="true"
                data-testid="snap-guide-v"
                className="pointer-events-none absolute top-0 bottom-0 z-[110] w-px bg-vf-selection"
                style={{ left: `${vx}%` }}
              />
            ))}
            {guides.h.map((hy) => (
              <div
                key={`h-${hy}`}
                aria-hidden="true"
                data-testid="snap-guide-h"
                className="pointer-events-none absolute left-0 right-0 z-[110] h-px bg-vf-selection"
                style={{ top: `${hy}%` }}
              />
            ))}
          </>
        )}

        {/* On-canvas transform box for the selected clip (move + resize → PiP).
            No rotate handle / rotate(...) transform: the export does not honor clip
            rotation, so the preview must render the box un-rotated (invariant). */}
        {selectedClip && (
          <div
            data-testid="canvas-transform-box"
            className="absolute z-[100] box-border border-2 border-vf-accent"
            style={{
              left: `${box.x}%`,
              top: `${box.y}%`,
              width: `${box.width}%`,
              height: `${box.height}%`,
              cursor: "move",
              touchAction: "none",
            }}
            onPointerDown={(e) => beginTransform(e, "move")}
          >
            {(["nw", "ne", "sw", "se"] as Handle[]).map((h) => (
              <div
                key={h}
                onPointerDown={(e) => beginTransform(e, h)}
                className="absolute h-3 w-3 rounded-sm border border-vf-accent bg-white"
                style={{ ...HANDLE_POS[h], margin: -6, touchAction: "none" }}
              />
            ))}
          </div>
        )}

        {/* Floating action toolbar (the "items to edit").
            Rendered via portal + fixed positioning so it is never clipped by the
            stage-frame's overflow-hidden and can float above the transport bar
            at the bottom of the screen. High z-index ensures visibility. */}
        {selectedClip && toolbarScreenPos && createPortal(
          <div
            data-testid="canvas-toolbar"
            className="fixed z-[9999] flex -translate-x-1/2 items-center gap-1.5 rounded-lg border border-vf-border-subtle bg-vf-surface-2/95 p-1.5 shadow-vf-2 backdrop-blur"
            style={{
              left: toolbarScreenPos.left,
              top: toolbarScreenPos.top,
              cursor: "default",
            }}
            onPointerDown={(e) => e.stopPropagation()}
          >
            {([
              ["Flip horizontal", "Flip H", FlipHorizontal, () => setClipFlip(selectedClip.id, selectedClip.trackId, "h", !selectedClip.flipH)],
              ["Flip vertical", "Flip V", FlipVertical, () => setClipFlip(selectedClip.id, selectedClip.trackId, "v", !selectedClip.flipV)],
              ["Bring forward", "Forward", ArrowUp, () => moveClipLayer(selectedClip.id, "forward")],
              ["Send backward", "Backward", ArrowDown, () => moveClipLayer(selectedClip.id, "backward")],
              ["Duplicate", "Duplicate", Copy, () => duplicateSelected()],
              ["Reset size/position", "Reset", RotateCcw, () => setClipTransform(selectedClip.id, selectedClip.trackId, undefined)],
              ["Delete", "Delete", Trash2, () => deleteSelected()],
              // Animate / BG Remover / Duration stubs removed: out-of-MVP features that
              // shipped as alert()/prompt() placeholders (broken affordances).
            ] as Array<[string, string, any, () => void]>).map(([label, tip, Icon, onClick]) => (
              <Tooltip key={label} label={tip}>
                <button
                  type="button"
                  aria-label={label}
                  onClick={onClick}
                  className="flex h-9 w-9 items-center justify-center rounded-md text-vf-text-secondary hover:bg-vf-surface-3 hover:text-vf-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-vf-accent active:bg-vf-surface-4"
                >
                  <Icon className="h-5 w-5" aria-hidden="true" />
                </button>
              </Tooltip>
            ))}
          </div>,
          document.body
        )}
      </div>

      {/* Note: inline editor moved inside the viewportRef (relative) below so absolute % positioning is relative to the correct stage. See the version inside the viewport. */}

      {/* Right-click context menu on the preview canvas (premium creator expectation).
          Provides Copy/Paste + layer/delete actions. One-word labels. Disables native menu. */}
      {contextMenu && (
        <div
          className="fixed z-[9999] min-w-[160px] rounded-md border border-vf-border-subtle bg-vf-surface-3 py-1 shadow-vf-2 text-sm"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          {contextMenu.items.map((it, idx) => (
            <button
              key={idx}
              disabled={it.disabled}
              onClick={() => {
                it.onClick();
                setContextMenu(null);
              }}
              className="flex w-full items-center justify-between px-3 py-1.5 text-left text-vf-text-primary hover:bg-vf-surface-4 disabled:opacity-40"
            >
              <span>{it.label}</span>
              {/* F21: shortcut hint on right (light) */}
              {(it as any).shortcut && (
                <span className="ml-3 text-[10px] text-vf-text-tertiary tabular-nums">{(it as any).shortcut}</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
