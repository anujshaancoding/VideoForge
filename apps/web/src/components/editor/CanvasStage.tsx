import { useEffect, useRef, useState } from "react";
import { selectClip, useEditorStore } from "../../store/editorStore.js";
import { getAssetMeta } from "../../store/assetStore.js";
import { cx, Tooltip } from "../ui/index.js";
import { audioEngine, previewEngine } from "../../engine/index.js";

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
  const addClipToCanvas = useEditorStore((s) => s.addClipToCanvas);
  const setClipFlip = useEditorStore((s) => s.setClipFlip);
  const moveClipLayer = useEditorStore((s) => s.moveClipLayer);
  const duplicateSelected = useEditorStore((s) => s.duplicateSelected);
  const deleteSelected = useEditorStore((s) => s.deleteSelected);

  const [safeZones, setSafeZones] = useState(false);
  const [zoom, setZoom] = useState(100);
  // Live box while dragging/resizing on the canvas (committed to the store on release,
  // so a whole gesture is ONE undo step — not hundreds, mirroring the timeline drag).
  const [dragBox, setDragBox] = useState<Box | null>(null);

  // ── Engine init on mount ──────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const store = useEditorStore.getState();

    previewEngine.init(canvas, audioEngine, {
      onPlayheadUpdate: (ms) => useEditorStore.getState().setPlayhead(ms),
      onPlaybackEnded: () => useEditorStore.getState().pause(),
    });

    previewEngine.setProject(store.project);
    audioEngine.updateProject(store.project);

    return () => {
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

  const onCanvasPointerDown = (): void => {
    useEditorStore.getState().clearSelection();
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

    const onMove = (ev: PointerEvent): void => {
      const dx = ((ev.clientX - startX) / rect.width) * 100;
      const dy = ((ev.clientY - startY) / rect.height) * 100;
      let b: Box = { ...startBox };
      if (mode === "move") {
        b.x = startBox.x + dx;
        b.y = startBox.y + dy;
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
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

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
    if (!assetId || kind === "audio") return; // audio is not a visual canvas overlay
    e.preventDefault();
    const durationMs = getAssetMeta(assetId)?.durationMs ?? undefined;
    addClipToCanvas(assetId, useEditorStore.getState().playheadMs, durationMs);
  };

  const HANDLE_POS: Record<Handle, React.CSSProperties> = {
    nw: { left: 0, top: 0, cursor: "nwse-resize" },
    ne: { right: 0, top: 0, cursor: "nesw-resize" },
    sw: { left: 0, bottom: 0, cursor: "nesw-resize" },
    se: { right: 0, bottom: 0, cursor: "nwse-resize" },
  };
  const box: Box = dragBox ?? selectedClip?.transform ?? FULL_FRAME;

  return (
    <div
      ref={wrapRef}
      role="main"
      className="relative flex h-full min-h-0 w-full items-center justify-center overflow-hidden bg-vf-surface-canvas-surround p-6"
    >
      {/* Overlay HUD (top-right): Safe / Zoom / Fit (§5.2). */}
      <div className="absolute right-3 top-3 z-sticky flex items-center gap-1 rounded-md bg-vf-surface-2/90 p-1 shadow-vf-1">
        <button
          type="button"
          aria-pressed={safeZones}
          onClick={() => setSafeZones((v) => !v)}
          title="Toggle safe zones (`)"
          className={cx(
            "flex h-7 items-center gap-1 rounded-sm px-2 text-2xs",
            safeZones
              ? "bg-vf-surface-3 text-vf-accent-text"
              : "text-vf-icon-default hover:bg-vf-surface-3",
          )}
        >
          <span aria-hidden="true">⛶</span> Safe
        </button>
        <select
          aria-label="Canvas zoom"
          value={zoom}
          onChange={(e) => setZoom(Number(e.target.value))}
          className="h-7 rounded-sm bg-vf-surface-3 px-1 text-2xs text-vf-text-primary vf-tnum"
        >
          {ZOOM_STEPS.map((z) => (
            <option key={z} value={z}>
              {z}%
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => setZoom(100)}
          title="Fit to window (Ctrl+Shift+0)"
          className="flex h-7 items-center gap-1 rounded-sm px-2 text-2xs text-vf-icon-default hover:bg-vf-surface-3"
        >
          <span aria-hidden="true">⤢</span> Fit
        </button>
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
      >
        <canvas
          ref={canvasRef}
          role="application"
          aria-label="Preview canvas"
          onPointerDown={onCanvasPointerDown}
          className="h-full w-full rounded-sm border border-vf-border-subtle"
          style={{
            backgroundColor: bgColor || "#111111",
            aspectRatio: `${canvasW} / ${canvasH}`,
          }}
        />
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

        {/* On-canvas transform box for the selected clip (move + resize → PiP). */}
        {selectedClip && (
          <div
            data-testid="canvas-transform-box"
            className="absolute z-10 box-border border-2 border-vf-accent"
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
            {/* Floating action toolbar above the box (Canva-style). Each entry:
                [aria-label (descriptive), tooltip (1–3 words), glyph, onClick]. */}
            <div
              data-testid="canvas-toolbar"
              className="absolute left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-md border border-vf-border-subtle bg-vf-surface-2 p-1 shadow-vf-2"
              style={{ top: -48, cursor: "default" }}
              onPointerDown={(e) => e.stopPropagation()}
            >
              {([
                ["Flip horizontal", "Flip H", "⇋", () => setClipFlip(selectedClip.id, selectedClip.trackId, "h", !selectedClip.flipH)],
                ["Flip vertical", "Flip V", "⥯", () => setClipFlip(selectedClip.id, selectedClip.trackId, "v", !selectedClip.flipV)],
                ["Bring forward", "Forward", "⬆", () => moveClipLayer(selectedClip.id, "forward")],
                ["Send backward", "Backward", "⬇", () => moveClipLayer(selectedClip.id, "backward")],
                ["Duplicate", "Duplicate", "⧉", () => duplicateSelected()],
                ["Reset size/position", "Reset size", "⤢", () => setClipTransform(selectedClip.id, selectedClip.trackId, undefined)],
                ["Delete", "Delete", "🗑", () => deleteSelected()],
              ] as Array<[string, string, string, () => void]>).map(([label, tip, glyph, onClick]) => (
                <Tooltip key={label} label={tip}>
                  <button
                    type="button"
                    aria-label={label}
                    onClick={onClick}
                    className="flex h-9 w-9 items-center justify-center rounded-sm text-base text-vf-text-secondary hover:bg-vf-surface-3 hover:text-vf-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-vf-accent"
                  >
                    <span aria-hidden="true">{glyph}</span>
                  </button>
                </Tooltip>
              ))}
            </div>
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
      </div>
    </div>
  );
}
