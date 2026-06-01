import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  CanvasStage,
  Inspector,
  MediaPanel,
  StatusBar,
  Timeline,
  TopBar,
  Transport,
  EditorErrorBoundary,
} from "../components/editor/index.js";
import { useEditorStore } from "../store/editorStore.js";
import { getProject } from "../lib/projectStore.js";
import { Button } from "../components/ui/index.js";
import { previewEngine } from "../engine/index.js";
import { wsClient } from "../lib/wsClient.js";

// Editor route (§3.4) — composes the seven zero-prop, store-driven editor shell
// components into the six-band layout grid:
//
//   ┌──────────────── TopBar (56px) ───────────────────┐
//   │ MediaPanel │  CanvasStage + Transport │ Inspector │   ← Canvas Area row (fills)
//   ├────────────────────────────────────────────────── ┤
//   │              Timeline (260px, resizable)           │
//   ├─────────────── StatusBar (28px) ──────────────────┤
//   └────────────────────────────────────────────────── ┘
//
// The root never scrolls — each zone owns its own scroll. This stage owns the
// LAYOUT; the inner components are built by the EditorShell stage. Loading + a
// not-found fallback live here.

const TIMELINE_HEIGHT = 260; // px, §3.4 default (180–600 resizable handled later)

export default function Editor() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const loadProject = useEditorStore((s) => s.loadProject);
  const currentId = useEditorStore((s) => s.project.id);
  const [notFound, setNotFound] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    if (id === currentId) {
      // already loaded into the store
      setLoading(false);
      setNotFound(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setNotFound(false);
    getProject(id)
      .then((project) => {
        if (cancelled) return;
        if (project) {
          loadProject(project);
          setNotFound(false);
        } else {
          setNotFound(true);
        }
      })
      .catch(() => {
        if (!cancelled) setNotFound(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [id, currentId, loadProject]);

  // Connect WebSocket hub for asset:ready + export progress push events.
  useEffect(() => {
    wsClient.connect('dev-workspace');
    return () => wsClient.disconnect();
  }, []);

  // ── Global keyboard shortcuts ─────────────────────────────────────────────
  const togglePlay = useEditorStore((s) => s.togglePlay);
  const play = useEditorStore((s) => s.play);
  const pause = useEditorStore((s) => s.pause);
  const undo = useEditorStore((s) => s.undo);
  const redo = useEditorStore((s) => s.redo);
  const deleteSelected = useEditorStore((s) => s.deleteSelected);
  const duplicateSelected = useEditorStore((s) => s.duplicateSelected);
  const splitAtPlayhead = useEditorStore((s) => s.splitAtPlayhead);
  const setPlayhead = useEditorStore((s) => s.setPlayhead);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      // Don't intercept shortcuts when the user is typing in an input/textarea.
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || (e.target as HTMLElement).isContentEditable)
        return;

      const mod = e.metaKey || e.ctrlKey;

      if (e.code === "Space" && !mod) {
        e.preventDefault();
        togglePlay();
      } else if (mod && e.code === "KeyZ" && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if (mod && (e.code === "KeyY" || (e.code === "KeyZ" && e.shiftKey))) {
        e.preventDefault();
        redo();
      } else if ((e.key === "Delete" || e.key === "Backspace") && !mod) {
        e.preventDefault();
        deleteSelected();
      } else if (mod && e.code === "KeyD") {
        // Ctrl/Cmd+D → duplicate selected
        e.preventDefault();
        duplicateSelected();
      } else if (e.code === "KeyS" && !mod) {
        // S → split at playhead
        e.preventDefault();
        splitAtPlayhead();
      } else if (e.code === "KeyJ" && !mod) {
        // J → rewind (play in reverse at -1×; for preview we seek back 2s)
        e.preventDefault();
        const state = useEditorStore.getState();
        if (state.isPlaying) {
          pause();
        }
        const next = Math.max(0, state.playheadMs - 2000);
        setPlayhead(next);
        previewEngine.seekTo(next);
      } else if (e.code === "KeyK" && !mod) {
        // K → pause / stop
        e.preventDefault();
        pause();
      } else if (e.code === "KeyL" && !mod) {
        // L → play forward
        e.preventDefault();
        const state = useEditorStore.getState();
        if (!state.isPlaying) {
          play();
        }
      }
    },
    [
      togglePlay,
      play,
      pause,
      undo,
      redo,
      deleteSelected,
      duplicateSelected,
      splitAtPlayhead,
      setPlayhead,
    ],
  );

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  if (loading && !notFound) {
    return (
      <main
        role="status"
        aria-live="polite"
        className="flex h-full flex-col items-center justify-center gap-4 bg-vf-bg-app text-center"
      >
        <p className="text-sm text-vf-text-secondary">Loading project…</p>
      </main>
    );
  }

  if (notFound) {
    return (
      <main className="flex h-full flex-col items-center justify-center gap-4 bg-vf-bg-app text-center">
        <h1 className="text-xl font-bold text-vf-text-primary">Project not found</h1>
        <p className="max-w-sm text-sm text-vf-text-secondary">
          We couldn&rsquo;t find that project. It may have been deleted.
        </p>
        <Button variant="secondary" onClick={() => navigate("/")}>
          Back to dashboard
        </Button>
      </main>
    );
  }

  return (
    <EditorErrorBoundary>
      <div
        style={EDITOR_LAYOUT_STYLE}
        className="grid h-full grid-rows-[var(--vf-topbar-h)_1fr_var(--vf-timeline-h)_var(--vf-statusbar-h)] overflow-hidden bg-vf-bg-app"
      >
        {/* Band 1 — Top Bar (56px fixed, z-100). */}
        <div className="row-start-1 border-b border-vf-border-subtle">
          <TopBar />
        </div>

        {/* Band 2 — Canvas Area row: Left media panel | Canvas + Transport | Inspector. */}
        <div className="row-start-2 grid min-h-0 grid-cols-[280px_1fr_300px] overflow-hidden">
          <div className="col-start-1 min-h-0 border-r border-vf-border-subtle">
            <MediaPanel />
          </div>
          <div className="col-start-2 grid min-h-0 grid-rows-[1fr_var(--vf-transport-h)] overflow-hidden bg-vf-surface-canvas-surround">
            <div className="row-start-1 min-h-0 overflow-hidden">
              <CanvasStage />
            </div>
            <div className="row-start-2 border-t border-vf-border-subtle">
              <Transport />
            </div>
          </div>
          <div className="col-start-3 min-h-0 border-l border-vf-border-subtle">
            <Inspector />
          </div>
        </div>

        {/* Band 3 — Timeline Zone (full width beneath the side panels). */}
        <div className="row-start-3 min-h-0 overflow-hidden border-t border-vf-border-subtle">
          <Timeline />
        </div>

        {/* Band 4 — Status Bar (28px fixed). */}
        <div className="row-start-4 border-t border-vf-border-subtle">
          <StatusBar />
        </div>
      </div>
    </EditorErrorBoundary>
  );
}

// Pinned layout band heights as CSS vars (§3.4) — kept here so the grid template
// reads cleanly and the timeline becomes resizable later by just changing the var.
export const EDITOR_LAYOUT_STYLE: React.CSSProperties & Record<string, string> = {
  "--vf-topbar-h": "56px",
  "--vf-transport-h": "48px",
  "--vf-timeline-h": `${TIMELINE_HEIGHT}px`,
  "--vf-statusbar-h": "28px",
};
