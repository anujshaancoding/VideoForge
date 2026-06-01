import { useEffect, useRef, useState } from "react";
import { useEditorStore } from "../../store/editorStore.js";
import { cx } from "../ui/index.js";
import { audioEngine, previewEngine } from "../../engine/index.js";

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

  const aspectRatio = useEditorStore((s) => s.project.canvas.aspectRatio);
  const canvasW = useEditorStore((s) => s.project.canvas.width);
  const canvasH = useEditorStore((s) => s.project.canvas.height);
  const bgColor = useEditorStore((s) => s.project.canvas.backgroundColor);

  const [safeZones, setSafeZones] = useState(false);
  const [zoom, setZoom] = useState(100);

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

  // ── Safe-zone overlay rAF (composited on top of engine output) ───────────
  useEffect(() => {
    if (!safeZones) return;
    let raf = 0;
    const draw = (): void => {
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext("2d");
      if (canvas && ctx) {
        const w = canvas.width;
        const h = canvas.height;
        ctx.setLineDash([6, 4]);
        ctx.strokeStyle = "rgba(255,255,255,0.35)";
        ctx.lineWidth = 1;
        ctx.strokeRect(w * 0.05, h * 0.05, w * 0.9, h * 0.9);
        ctx.strokeStyle = "rgba(255,209,92,0.5)";
        ctx.strokeRect(w * 0.1, h * 0.1, w * 0.8, h * 0.8);
        ctx.setLineDash([]);
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [safeZones]);

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
        className="relative max-h-full max-w-full"
        style={{
          aspectRatio: `${canvasW} / ${canvasH}`,
          height: `${zoom}%`,
          maxHeight: "100%",
          maxWidth: "100%",
        }}
        title={`${aspectRatio} · ${canvasW}×${canvasH}`}
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
      </div>
    </div>
  );
}
