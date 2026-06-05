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
import { useAssetStore } from "../store/assetStore.js";
import { useAuthStore } from "../store/authStore.js";
import { getProject } from "../lib/projectStore.js";
import { apiGetAsset } from "../lib/api.js";
import { armAutosave, disarmAutosave, saveNow } from "../lib/useAutosave.js";
import { readViewPrefs, writeViewPrefs } from "../lib/viewPrefs.js";
import { Button } from "../components/ui/index.js";
import { previewEngine } from "../engine/index.js";
import { wsClient } from "../lib/wsClient.js";
import type { Project } from "@videoforge/project-schema";

/** Every source-asset id referenced by a project (media clips + image-kind overlays). */
function referencedAssetIds(project: Project): string[] {
  const ids = new Set<string>();
  for (const track of project.tracks) {
    if (track.type === "video" || track.type === "audio" || track.type === "voiceover") {
      for (const clip of track.clips) ids.add(clip.sourceAssetId);
    } else if (track.type === "overlay") {
      for (const ov of track.clips) {
        if ("sourceAssetId" in ov && ov.sourceAssetId) ids.add(ov.sourceAssetId);
      }
    }
  }
  return [...ids];
}

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
  const setZoom = useEditorStore((s) => s.setZoom);
  // Hydrate from the server document whenever the route id is not yet the loaded
  // one. We deliberately do NOT short-circuit on `id === currentId`: after a reload
  // the store is reset to the seed sampleProject, and if the route id happened to
  // equal the seed id we would otherwise skip fetching the real saved document.
  const armedId = useEditorStore((s) => s.project.id);
  // Gate the load on an authenticated session: the access token lives only in
  // memory and is restored by App's boot refresh. App already holds rendering until
  // that refresh resolves, so by the time the editor mounts `user` reflects the
  // real session — if it's null the user is genuinely logged out (RequireAuth
  // redirects), and we must not fetch logged-out and mask the server document.
  const user = useAuthStore((s) => s.user);
  const [notFound, setNotFound] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    if (!id) return;
    if (!user) return; // RequireAuth will redirect; never fetch without a session.

    let cancelled = false;
    setLoading(true);
    setNotFound(false);
    setLoadError(false);
    // Disarm while (re)loading so autosave can't persist the outgoing doc.
    disarmAutosave();
    getProject(id)
      .then((project) => {
        if (cancelled) return;
        if (project) {
          loadProject(project);
          // Restore the persisted timeline zoom (a view pref, not project data) so
          // the workspace feels stable across reloads. Done AFTER loadProject, which
          // preserves zoom but resets selection/playhead.
          const prefs = readViewPrefs();
          if (typeof prefs.timelineZoom === "number") setZoom(prefs.timelineZoom);
          // Arm autosave ONLY now that the store holds the real server document, so
          // the seed/stale state can never be PATCHed back over the saved project.
          armAutosave(project.id);
          setNotFound(false);
        } else {
          setNotFound(true);
        }
      })
      .catch(() => {
        // getProject now rethrows on server-reachable failures (e.g. a 401 auth
        // race) instead of silently returning stale localStorage data. Surface a
        // retryable error rather than loading — and overwriting — a masked doc.
        if (!cancelled) setLoadError(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [id, user, retry, loadProject, setZoom]);

  // Disarm autosave when leaving the editor so a stale id can't be saved later.
  useEffect(() => () => disarmAutosave(), []);

  // Persist the timeline zoom (a view pref) whenever it changes, so a reload
  // restores the same scale. Subscribing directly keeps this off the render path.
  useEffect(() => {
    let prevZoom = useEditorStore.getState().zoom;
    return useEditorStore.subscribe((s) => {
      if (s.zoom === prevZoom) return;
      prevZoom = s.zoom;
      writeViewPrefs({ timelineZoom: s.zoom });
    });
  }, []);

  // Connect WebSocket hub for asset:ready + export progress push events.
  useEffect(() => {
    wsClient.connect();
    return () => wsClient.disconnect();
  }, []);

  // Hydrate the asset registry for every asset the loaded project references, so the
  // preview/audio engines can resolve real presigned proxy URLs (not synthesised ones).
  useEffect(() => {
    if (loading || notFound || loadError) return;
    const project = useEditorStore.getState().project;
    const { assets, registerFromRecord } = useAssetStore.getState();
    let cancelled = false;
    for (const assetId of referencedAssetIds(project)) {
      if (assets[assetId]?.proxyUrl) continue; // already resolved
      void apiGetAsset(assetId)
        .then((rec) => { if (!cancelled) registerFromRecord(rec); })
        .catch(() => { /* missing asset — engine falls back to the stub rect */ });
    }
    return () => { cancelled = true; };
  }, [armedId, loading, notFound, loadError]);

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
      // Don't intercept shortcuts while the user is TYPING in a text field. We only
      // bail for genuine text entry (textarea, contentEditable, or text-like inputs)
      // — NOT for range sliders / checkboxes / buttons, which are <input>s too but
      // do not consume typing. Bailing on those broke keyboard undo/redo after an
      // edit moved focus to a slider (e.g. the playhead).
      const target = e.target as HTMLElement;
      const tag = target.tagName;
      const NON_TEXT_INPUT = new Set([
        "range",
        "checkbox",
        "radio",
        "button",
        "submit",
        "reset",
        "color",
        "file",
      ]);
      const isTextEntry =
        tag === "TEXTAREA" ||
        target.isContentEditable ||
        (tag === "INPUT" && !NON_TEXT_INPUT.has((target as HTMLInputElement).type));
      if (isTextEntry) return;

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
      } else if (mod && e.code === "KeyS") {
        // Ctrl/Cmd+S → force an immediate save (don't let the browser "Save page").
        e.preventDefault();
        saveNow();
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

  if (loading && !notFound && !loadError) {
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

  // Server-reachable load failure (e.g. a transient 401 during session restore).
  // We intentionally did NOT fall back to stale local data, so offer a retry rather
  // than loading — and risking overwriting — a masked document.
  if (loadError) {
    return (
      <main className="flex h-full flex-col items-center justify-center gap-4 bg-vf-bg-app text-center">
        <h1 className="text-xl font-bold text-vf-text-primary">Couldn&rsquo;t load this project</h1>
        <p className="max-w-sm text-sm text-vf-text-secondary">
          Your work is safe on the server. This was likely a temporary hiccup — try again.
        </p>
        <div className="flex gap-2">
          <Button variant="primary" onClick={() => setRetry((n) => n + 1)}>
            Retry
          </Button>
          <Button variant="secondary" onClick={() => navigate("/")}>
            Back to dashboard
          </Button>
        </div>
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
