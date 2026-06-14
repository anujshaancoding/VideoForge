import { useCallback, useEffect, useRef, useState } from "react";
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
import { resolveManifest } from "../store/templateStore.js";
import { isSlotFilled } from "../lib/templates.js";
import { armAutosave, disarmAutosave, saveNow } from "../lib/useAutosave.js";
import { readViewPrefs, writeViewPrefs } from "../lib/viewPrefs.js";
import { Button, Tooltip } from "../components/ui/index.js";
import { cx } from "../components/ui/cx.js";
import { previewEngine } from "../engine/index.js";
import { wsClient } from "../lib/wsClient.js";
import type { Project } from "@videoforge/project-schema";
import { LayoutGrid, Image, Type, Captions, Music, Shapes, Palette, Sparkles } from "lucide-react";
import TemplatesPanel from "../components/editor/TemplatesPanel.js";

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
  const [leftRailTab, setLeftRailTab] = useState<string | null>(null);
  const leftRailTabRef = useRef<string | null>(null);
  useEffect(() => { leftRailTabRef.current = leftRailTab; }, [leftRailTab]);

  // Auto-open media rail when a placeholder clip requests it (from timeline/canvas click in Templates flow).
  // Robust: force the tab even if panel was closed or on another tab (Text etc.).
  // Clear the one-shot flag after handling. We use a ref for current tab to avoid stale closure.
  useEffect(() => {
    return useEditorStore.subscribe((state) => {
      if (state.pendingMediaOpenFor) {
        if (leftRailTabRef.current !== 'media') {
          setLeftRailTab('media');
        }
        // Clear immediately to prevent re-fires / loops on the same notification.
        useEditorStore.setState({ pendingMediaOpenFor: null });
      }
    });
  }, []);

  // Mobile bottom-tab dedicated editor model (per review): on narrow viewports, preview is primary,
  // sides accessed via bottom tabs that open as sheets or swap. This provides a complete mobile interaction model instead of squeezed desktop panels.
  const [isNarrow, setIsNarrow] = useState(false);
  useEffect(() => {
    const onResize = () => setIsNarrow(window.innerWidth < 640);
    onResize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

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
  // Skip known template placeholder/demo asset IDs (they have no DB row and cause 404s).
  useEffect(() => {
    if (loading || notFound || loadError) return;
    const project = useEditorStore.getState().project;
    const { assets, registerFromRecord } = useAssetStore.getState();
    const manifest = resolveManifest(project); // may be null
    let cancelled = false;

    const placeholderAssetIds = new Set<string>();
    if (manifest) {
      // Collect sourceAssetIds for clips that are still unfilled template placeholders.
      // These have no real asset rows in the user's DB and will 404 on GET /assets/:id.
      for (const slot of manifest.slots) {
        if (slot.target.type === "clip" && !isSlotFilled(project, slot as any)) {
          // Find the current clip for that slot target and grab its (placeholder) asset id.
          if (slot.target.type === "clip") {
            const clipTarget = slot.target as { type: "clip"; trackId: string; clipId: string };
            for (const t of project.tracks) {
              if ((t.type === "video" || t.type === "audio" || t.type === "voiceover") && t.id === clipTarget.trackId) {
                const c = (t as any).clips?.find((cc: any) => cc.id === clipTarget.clipId);
                if (c?.sourceAssetId) placeholderAssetIds.add(c.sourceAssetId);
                break;
              }
            }
          }
        }
      }
    }

    for (const assetId of referencedAssetIds(project)) {
      if (placeholderAssetIds.has(assetId)) continue; // synthetic template demo, no real asset row
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
  const rippleDelete = useEditorStore((s) => s.rippleDelete);
  const copySelected = useEditorStore((s) => s.copySelected);
  const paste = useEditorStore((s) => s.paste);
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
      } else if (mod && (e.key === "Delete" || e.key === "Backspace")) {
        // Ctrl/Cmd+Delete → ripple delete (close the gap), §3.3.
        e.preventDefault();
        rippleDelete();
      } else if ((e.key === "Delete" || e.key === "Backspace") && !mod) {
        e.preventDefault();
        deleteSelected();
      } else if (mod && e.code === "KeyC" && !e.shiftKey) {
        // Ctrl/Cmd+C → copy selected clip/overlay (Shift+Cmd+C is text-align center).
        e.preventDefault();
        copySelected();
      } else if (mod && e.code === "KeyV") {
        // Ctrl/Cmd+V → paste from the in-memory clipboard.
        e.preventDefault();
        paste();
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
      } else if (!mod && (e.key === "ArrowLeft" || e.key === "ArrowRight" || e.key === "ArrowUp" || e.key === "ArrowDown")) {
        e.preventDefault();
        const st = useEditorStore.getState();
        const sel = st.selection;
        const fps = st.project.canvas.frameRate || 30;
        const frameMs = 1000 / fps;
        const deltaMs = e.shiftKey ? frameMs * 10 : frameMs;
        const deltaPct = e.shiftKey ? 5 : 1; // for overlays
        if (sel.kind === "clip" && sel.id) {
          // Nudge selected media clip in time
          let found: any = null;
          for (const t of st.project.tracks) {
            if (t.type === "video" || t.type === "audio" || t.type === "voiceover") {
              const c = t.clips.find((c: any) => c.id === sel.id);
              if (c) { found = { trackId: t.id, clip: c }; break; }
            }
          }
          if (found) {
            let newStart = found.clip.startOnTimeline + (e.key === "ArrowLeft" ? -deltaMs : deltaMs);
            newStart = Math.max(0, newStart);
            st.moveClip(sel.id, found.trackId, newStart);
          }
        } else if (sel.kind === "overlay" && sel.id) {
          // Nudge selected overlay in position (X/Y)
          useEditorStore.setState((s) => {
            for (const t of s.project.tracks) {
              if (t.type !== "overlay") continue;
              const ov = t.clips.find((c: any) => c.id === sel.id);
              if (ov) {
                let nx = ov.canvasX ?? 0;
                let ny = ov.canvasY ?? 0;
                if (e.key === "ArrowLeft") nx = Math.max(0, nx - deltaPct);
                else if (e.key === "ArrowRight") nx = Math.min(100, nx + deltaPct);
                else if (e.key === "ArrowUp") ny = Math.max(0, ny - deltaPct);
                else if (e.key === "ArrowDown") ny = Math.min(100, ny + deltaPct);
                ov.canvasX = nx;
                ov.canvasY = ny;
                break;
              }
            }
          });
        } else {
          // Default: nudge playhead
          const next = Math.max(0, st.playheadMs + (e.key === "ArrowLeft" ? -deltaMs : deltaMs));
          setPlayhead(next);
          previewEngine.seekTo(next);
        }
      } else if (e.code === "KeyM" && !mod) {
        // M → toggle mute first audio track (or selected if audio)
        e.preventDefault();
        const st = useEditorStore.getState();
        const proj = st.project;
        let targetTrack = proj.tracks.find((t: any) => t.type === "audio" || t.type === "voiceover");
        if (targetTrack) {
          st.setTrackMute(targetTrack.id, !targetTrack.muted);
        }
      } else if (e.code === "KeyT" && !mod) {
        // T → add default text overlay at playhead
        e.preventDefault();
        const st = useEditorStore.getState();
        let ovTrack = st.project.tracks.find((t: any) => t.type === "overlay");
        if (!ovTrack) {
          st.addTrack("overlay");
          ovTrack = useEditorStore.getState().project.tracks.find((t: any) => t.type === "overlay");
        }
        if (ovTrack) {
          st.addTextOverlay("Body", ovTrack.id, st.playheadMs);
        }
      } else if (mod && e.key === "/") {
        // Cmd+/ → toggle left sidebar (media panel or close)
        e.preventDefault();
        setLeftRailTab(leftRailTab ? null : 'media');
      } else if (mod && (e.code === "KeyB" || e.code === "KeyI")) {
        // Cmd+B/I text formatting — toggle on selected text overlay (F06). We only
        // ever write §18-valid TextStyle fields (fontWeight, italic) so the document
        // always passes export validation. Underline (Cmd+U) is intentionally NOT
        // handled: it has no §18 representation and no FFmpeg drawtext support yet —
        // see ROADMAP "underline end-to-end" (needs a shared text-metrics subsystem).
        e.preventDefault();
        const st = useEditorStore.getState();
        const sel = st.selection;
        if (sel.kind !== "overlay" || !sel.id) return;
        const proj = st.project;
        for (const t of proj.tracks) {
          if (t.type !== "overlay") continue;
          const ov = t.clips.find((c: any) => c.id === sel.id);
          if (ov && ov.kind === "text") {
            const style = { ...(ov as any).style };
            if (e.code === "KeyB") {
              style.fontWeight = (style.fontWeight || 600) >= 700 ? 400 : 700;
            } else if (e.code === "KeyI") {
              style.italic = !style.italic;
            }
            useEditorStore.setState((s) => {
              for (const tt of s.project.tracks) {
                if (tt.type !== "overlay") continue;
                const o = tt.clips.find((c: any) => c.id === sel.id);
                if (o) { (o as any).style = style; break; }
              }
            });
            break;
          }
        }
      } else if (mod && e.shiftKey && (e.code === "KeyL" || e.code === "KeyC" || e.code === "KeyR")) {
        // Shift+Cmd + L/C/R text align (F13)
        e.preventDefault();
        const st = useEditorStore.getState();
        const sel = st.selection;
        if (sel.kind !== "overlay" || !sel.id) return;
        const align = e.code === "KeyL" ? "left" : e.code === "KeyC" ? "center" : "right";
        useEditorStore.setState((s) => {
          for (const t of s.project.tracks) {
            if (t.type !== "overlay") continue;
            const o = t.clips.find((c: any) => c.id === sel.id);
            if (o && o.kind === "text") {
              (o as any).style = { ...(o as any).style, align };
              break;
            }
          }
        });
      }
    },
    [
      togglePlay,
      play,
      pause,
      undo,
      redo,
      deleteSelected,
      rippleDelete,
      copySelected,
      paste,
      duplicateSelected,
      splitAtPlayhead,
      setPlayhead,
      setLeftRailTab, // for Cmd+/ toggle
    ],
  );

  useEffect(() => {
    // Global shortcuts at document level with capture so Space (and JKL etc) work
    // regardless of focus — canvas, inspector inputs (non-text), timeline, or nothing focused.
    // This fixes the "spacebar silent fail when canvas focused" issue.
    const opts: AddEventListenerOptions = { capture: true };
    document.addEventListener("keydown", handleKeyDown, opts);
    return () => document.removeEventListener("keydown", handleKeyDown, opts);
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
        className={`grid h-full w-full max-w-[100vw] grid-rows-[var(--vf-topbar-h)_1fr_var(--vf-timeline-h)_var(--vf-statusbar-h)] overflow-x-auto overflow-y-hidden bg-vf-bg-app ${isNarrow ? 'pb-12' : ''}`}
      >
        {/* Band 1 — Top Bar (52px fixed) — elegant cinematic.
            Low z-10 so higher-z elements (rail z-20, tooltips z-[9999], popovers, modals) can render above it without being covered by the top bar.
            instead of disappearing behind the header. */}
        <div className="row-start-1 z-10 border-b border-vf-border-subtle">
          <TopBar />
        </div>

        {/* Band 2 — Canvas Area: THE HERO STAGE. Canvas dominates visually.
            Supportive narrow rails (icon rail + content). Beautiful centered framing.
            On narrow: dedicated mobile with bottom tabs + sheets, preview always central. */}
        <div className={`row-start-2 grid min-h-0 overflow-x-auto bg-vf-surface-canvas-surround ${isNarrow ? 'grid-cols-1' : 'grid-cols-[var(--vf-left-rail-w)_var(--vf-left-content-w)_1fr_var(--vf-right-panel-w)]'}`}>
          {/* Premium left icon rail + content (redesigned for hierarchy) */}
          {!isNarrow && (
            <>
              <div className="col-start-1 border-r border-vf-border-subtle bg-vf-surface-1 flex flex-col items-center py-4 gap-3 z-20 text-vf-text-tertiary" style={{width: 'var(--vf-left-rail-w)'}}>
                {[
                  {id:'templates', label:'Templates', icon: LayoutGrid},
                  {id:'media', label:'Media', icon: Image},
                  {id:'text', label:'Text', icon: Type},
                  {id:'captions', label:'Captions', icon: Captions},
                  {id:'audio', label:'Audio', icon: Music},
                  {id:'elements', label:'Elements', icon: Shapes, disabled:false},
                  {id:'brand', label:'Brand', icon: Palette, disabled:true},
                  {id:'ai', label:'AI', icon: Sparkles, disabled:true},
                ].map(item => {
                  const Icon = item.icon;
                  return (
                    <Tooltip key={item.id} label={item.disabled ? `${item.label} (coming soon)` : item.label}>
                      <button
                        onClick={() => !item.disabled && setLeftRailTab(item.id)}
                        disabled={item.disabled}
                        className={cx(
                          "w-14 h-14 flex flex-col items-center justify-center rounded-xl hover:bg-vf-surface-2 active:bg-vf-surface-3 transition-all",
                          leftRailTab===item.id && "bg-vf-surface-3 text-vf-accent-text scale-[1.02]",
                          item.disabled && "opacity-40 cursor-not-allowed"
                        )}
                      >
                        <Icon className="h-7 w-7" aria-hidden="true" />
                        <span className="text-[9px] mt-1 tracking-wider font-medium">{item.label}</span>
                      </button>
                    </Tooltip>
                  );
                })}
              </div>
              {leftRailTab && (
                <div className="col-start-2 border-r border-vf-border-subtle bg-vf-surface-2 overflow-y-auto overflow-x-hidden min-w-0 p-2 text-xs">
                  {leftRailTab === 'media' && <MediaPanel />}
                  {leftRailTab === 'templates' && <TemplatesPanel />}
                  {leftRailTab === 'text' && (
                    <div className="p-2 text-xs">
                      <p className="mb-1 text-vf-text-tertiary">Add text (like Canva)</p>
                      {(['Title', 'Subtitle', 'Body text', 'Custom Text'] as const).map((p) => (
                        <button
                          key={p}
                          onClick={() => {
                            const st = useEditorStore.getState();
                            let ovTrack = st.project.tracks.find((t: any) => t.type === "overlay");
                            if (!ovTrack) { st.addTrack("overlay"); ovTrack = useEditorStore.getState().project.tracks.find((t: any) => t.type === "overlay"); }
                            if (ovTrack) {
                              // F04: specific defaults per button
                              const presetName = p === "Title" ? "Title" : p === "Subtitle" ? "Subtitle" : p === "Body text" ? "Body text" : "Your text here";
                              st.addTextOverlay(presetName as any, ovTrack.id, st.playheadMs);
                            }
                          }}
                          className="block w-full text-left py-1 hover:bg-vf-surface-3 rounded"
                        >
                          + {p}
                        </button>
                      ))}

                      {/* F04: Text styles presets section (apply to selected or last text) */}
                      <div className="mt-3 pt-2 border-t border-vf-border-subtle">
                        <div className="text-[10px] uppercase tracking-widest text-vf-text-tertiary mb-1">Text styles</div>
                        {[
                          { name: "Bold Title", fontSize: 64, fontWeight: 800, color: "#FFFFFF" },
                          { name: "Neon Glow", fontSize: 36, fontWeight: 700, color: "#67e8f9" },
                          { name: "Minimal", fontSize: 28, fontWeight: 400, color: "#e2e8f0" },
                          { name: "Caption", fontSize: 18, fontWeight: 500, color: "#cbd5e1" },
                        ].map((preset) => (
                          <button
                            key={preset.name}
                            className="block w-full text-left px-2 py-0.5 text-[11px] hover:bg-vf-surface-3 rounded"
                            onClick={() => {
                              const st = useEditorStore.getState();
                              const sel = st.selection;
                              // Find selected text overlay, else the most recent one
                              let targetId: string | null = sel.kind === "overlay" && sel.id ? sel.id : null;
                              if (!targetId) {
                                for (const t of [...st.project.tracks].reverse()) {
                                  if (t.type !== "overlay") continue;
                                  const last = [...t.clips].reverse().find((c: any) => c.kind === "text");
                                  if (last) { targetId = last.id; break; }
                                }
                              }
                              if (targetId) {
                                useEditorStore.setState((s) => {
                                  for (const t of s.project.tracks) {
                                    if (t.type !== "overlay") continue;
                                    const o = t.clips.find((c: any) => c.id === targetId);
                                    if (o && o.kind === "text") {
                                      (o as any).style = {
                                        ...(o as any).style,
                                        fontSize: preset.fontSize,
                                        fontWeight: preset.fontWeight,
                                        color: preset.color,
                                      };
                                      break;
                                    }
                                  }
                                });
                              } else {
                                // No text yet — add one with the preset
                                let ovTrack = st.project.tracks.find((t: any) => t.type === "overlay");
                                if (!ovTrack) { st.addTrack("overlay"); ovTrack = useEditorStore.getState().project.tracks.find((t: any) => t.type === "overlay"); }
                                if (ovTrack) st.addTextOverlay("Body", ovTrack.id, st.playheadMs);
                              }
                            }}
                          >
                            {preset.name}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  {leftRailTab === 'captions' && (
                    <div className="p-2 text-xs">
                      <p className="text-vf-text-tertiary">Captions (stub — full like Canva)</p>
                      <button onClick={() => alert("Auto-generate from audio (stub — would transcribe with Whisper, add editable blocks to caption track)")}>Auto-generate captions</button>
                      <div className="mt-1">Manual entry + style (font/color/position) stub</div>
                    </div>
                  )}
                  {leftRailTab === 'audio' && (
                    <div className="p-2 text-xs">
                      <p className="text-vf-text-tertiary">Audio (stub — full library like Canva)</p>
                      <button onClick={() => alert("Music/SFX browser stub (would list tracks, preview, add to audio track)")}>Browse music & SFX</button>
                      <button className="mt-1 block" onClick={() => alert("Record voiceover stub (would use getUserMedia + MediaRecorder, add to VO track)")}>Record voiceover</button>
                    </div>
                  )}
                  {leftRailTab === 'elements' && (
                    <div className="p-2">
                      <p className="text-xs text-vf-text-tertiary mb-2">Basic shapes (click to add at playhead)</p>
                      {[
                        { label: "Rectangle", sym: "■", size: 48 },
                        { label: "Circle", sym: "●", size: 48 },
                        { label: "Line", sym: "—", size: 32 },
                        { label: "Arrow", sym: "→", size: 40 },
                        { label: "Star", sym: "★", size: 44 },
                      ].map((s) => (
                        <button
                          key={s.label}
                          onClick={() => {
                            const st = useEditorStore.getState();
                            let ovTrack = st.project.tracks.find((t: any) => t.type === "overlay");
                            if (!ovTrack) { st.addTrack("overlay"); ovTrack = useEditorStore.getState().project.tracks.find((t: any) => t.type === "overlay"); }
                            if (ovTrack) {
                              // F22: add as styled text symbol for now (visible immediately; full vector shapes later)
                              st.addTextOverlay(s.label as any, ovTrack.id, st.playheadMs);
                              // After add, quickly style the newest overlay as a big centered symbol
                              setTimeout(() => {
                                const latest = useEditorStore.getState();
                                const ovTrack2 = latest.project.tracks.find((t: any) => t.type === "overlay");
                                const ovs = (ovTrack2 as any)?.clips || [];
                                const last = ovs[ovs.length - 1];
                                if (last && last.kind === "text") {
                                  useEditorStore.setState((ss) => {
                                    for (const t of ss.project.tracks) {
                                      if (t.type !== "overlay") continue;
                                      const clips = (t as any).clips || [];
                                      const o = clips.find((c: any) => c.id === last.id);
                                      if (o) {
                                        (o as any).text = s.sym;
                                        (o as any).style = { ...(o as any).style, fontSize: s.size, align: "center", color: "#ffffff" };
                                        (o as any).canvasX = 40; (o as any).canvasY = 40; (o as any).width = 20; (o as any).height = 12;
                                        break;
                                      }
                                    }
                                  });
                                }
                              }, 10);
                            }
                          }}
                          className="block w-full text-left px-2 py-1 text-xs hover:bg-vf-surface-3 rounded"
                        >
                          {s.label} <span className="opacity-60">{s.sym}</span>
                        </button>
                      ))}
                      <p className="mt-2 text-[10px] text-vf-text-tertiary">Shapes appear as large symbols (full rect/circle drawing in canvas + inspector coming).</p>
                    </div>
                  )}
                  {leftRailTab === 'brand' && (
                    <div className="p-2 text-xs">
                      <p className="text-vf-text-tertiary mb-1">Brand kit (stub — full like Canva)</p>
                      <div>Colors: <span className="inline-block w-4 h-4 bg-red-500" /> <span className="inline-block w-4 h-4 bg-blue-500" /> (stub)</div>
                      <div>Fonts: Inter, Arial (stub)</div>
                      <button className="mt-1 text-[10px] underline" onClick={() => alert("Upload logo stub (would store in project/brand and surface in pickers)")}>Upload logo</button>
                    </div>
                  )}
                  {leftRailTab === 'ai' && (
                    <div className="p-2 text-xs">
                      <p className="text-vf-text-tertiary mb-1">AI tools (stub — matching Canva AI)</p>
                      <button onClick={() => alert("AI BG remove / Magic Eraser / Beat Sync / AI voice / captions stub (would integrate Whisper etc.)")}>Magic tools (stub)</button>
                    </div>
                  )}
                  {false && <div className="p-3 text-center text-vf-text-disabled italic">This section is coming in a future update.<br/>Roadmap item.</div>}
                  <button onClick={() => setLeftRailTab(null)} className="mt-3 text-[10px] text-vf-text-tertiary hover:text-vf-text-primary">Close panel</button>
                </div>
              )}
            </>
          )}
          {/* CENTERED CANVAS + TRANSPORT — the main stage, visually dominant */}
          <div className={`${isNarrow ? 'col-span-1' : 'col-start-3'} grid min-h-0 grid-rows-[1fr_var(--vf-transport-h)] overflow-visible p-2 md:p-4`}>
            <div className="row-start-1 min-h-0 flex items-center justify-center overflow-visible">
              {/* Dominant stage: much larger effective canvas (2-3x previous on typical desktop).
                  Looser max, more of the available grid cell, minimal chrome padding so the
                  preview feels like the hero (Canva/CapCut stage feeling). Aspect + zoom inside
                  CanvasStage still honour the project canvas. */}
              <div className="relative w-full h-full max-w-[min(98%,1200px)] max-h-[min(96%,820px)] flex items-center justify-center overflow-visible">
                <div className="relative vf-stage-frame w-full h-full rounded-2xl overflow-hidden border border-vf-border-strong shadow-[var(--vf-shadow-3)] bg-[#0C0E18]">
                  <CanvasStage />
                </div>
              </div>
            </div>
            <div className="row-start-2 border-t border-vf-border-subtle bg-vf-surface-1/80">
              <Transport />
            </div>
          </div>
          {/* Right Inspector — supportive, not dominant */}
          {!isNarrow && (
            <div className="col-start-4 min-h-0 border-l border-vf-border-subtle bg-vf-surface-1 overflow-y-auto">
              <Inspector />
            </div>
          )}
        </div>

        {/* Bottom-tab bar for dedicated mobile (no desktop squeeze) */}
        {isNarrow && (
          <div className="fixed bottom-0 left-0 right-0 z-[100] flex h-14 border-t border-vf-border-subtle bg-vf-surface-1/95 text-[10px] backdrop-blur md:hidden">
            {[
              { label: 'Media', icon: '▣' },
              { label: 'Canvas', icon: '◉' },
              { label: 'Timeline', icon: '≡' },
              { label: 'Props', icon: '⚙' },
            ].map((t, i) => (
              <button
                key={i}
                className="flex-1 flex flex-col items-center justify-center gap-0.5 text-vf-text-tertiary active:text-vf-accent-text transition-colors"
                aria-label={t.label}
              >
                <span className="text-base" aria-hidden="true">{t.icon}</span>
                <span>{t.label}</span>
              </button>
            ))}
          </div>
        )}

        {/* Band 3 — Timeline (supportive, polished, contained) */}
        <div className="row-start-3 min-h-0 overflow-hidden border-t border-vf-border-subtle bg-vf-surface-1">
          <Timeline />
        </div>

        {/* Band 4 — Status */}
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
