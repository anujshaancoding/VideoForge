import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { selectProjectDurationMs, useEditorStore } from "../../store/editorStore.js";
import { renameProject } from "../../lib/projectStore.js";
import { useAuthStore } from "../../store/authStore.js";
import { apiLogout } from "../../lib/api.js";
import { Button, IconButton, Tooltip } from "../ui/index.js";
import ExportModal from "./ExportModal.js";
import { saveNow } from "../../lib/useAutosave.js";
import { Undo2, Redo2 } from "lucide-react";

// TopBar — 56px top band (§3, §8.2 trigger). Left: the VideoForge "forge" wordmark.
// Center: an editable project title. Right: undo/redo (disabled via canUndo/canRedo
// state flags), and the single amber primary CTA — Export — which opens ExportModal.
//
// Zero-prop, store-driven (the editor-shell contract). Title edits write straight to
// the live project (and the localStorage projectStore so a reopen keeps the name).

export default function TopBar() {
  const navigate = useNavigate();
  const title = useEditorStore((s) => s.project.title);
  const projectId = useEditorStore((s) => s.project.id);
  const undo = useEditorStore((s) => s.undo);
  const redo = useEditorStore((s) => s.redo);
  const canUndo = useEditorStore((s) => s._canUndo);
  const canRedo = useEditorStore((s) => s._canRedo);
  // Export is gated until the project has timeline content (durationMs > 0). The
  // grey → amber transition the moment the first clip lands is the first "aha" (§6.4).
  const durationMs = useEditorStore(selectProjectDurationMs);
  const canExport = durationMs > 0;

  const [exportOpen, setExportOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(title);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) {
      setDraft(title);
      // Focus + select-all on entering edit mode.
      requestAnimationFrame(() => inputRef.current?.select());
    }
  }, [editing, title]);

  // MVP-STUB: title mutation isn't a store action in the contract surface, so we
  // write through the localStorage projectStore and mutate the live project title
  // in place. The store rename action is wired in a later milestone (M4).
  const commitTitle = (): void => {
    const next = draft.trim() || title;
    renameProject(projectId, next);
    // Reflect immediately in the running editor without a full reload.
    useEditorStore.setState((s) => {
      s.project.title = next;
    });
    // Force an immediate autosave so the status flips from "Unsaved changes" promptly
    // (the normal 3s debounce + add-track etc. can otherwise leave the badge stale for a bit).
    void saveNow();
    setEditing(false);
  };

  return (
    <header
      className="flex h-topbar w-full max-w-full items-center justify-between gap-1 overflow-hidden bg-vf-surface-1 px-1 text-xs sm:gap-2 sm:px-2 sm:text-sm md:gap-4 md:px-4 md:text-base"
      role="banner"
    >
      {/* ── Left: wordmark (forge ember on the "Forge" syllable) — compact on narrow viewports.
          Clicking navigates home (P2 gap from QA report). */}
      <button
        type="button"
        onClick={() => {
          // F17: save before leaving (autosave is best-effort; force a flush)
          try { saveNow?.(); } catch {}
          navigate("/");
        }}
        className="flex min-w-0 items-center gap-1.5 md:gap-2 rounded hover:bg-vf-surface-2 active:bg-vf-surface-3 px-1 -mx-1 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-vf-accent"
        aria-label="Go to home"
        title="Go to home"
      >
        <span aria-hidden="true" className="text-md leading-none md:text-lg">
          <span className="text-vf-accent">▰</span>
        </span>
        <span className="select-none whitespace-nowrap font-display text-sm font-bold tracking-tight text-vf-text-primary md:text-md">
          <span className="hidden md:inline">Video</span>
          <span className="text-vf-accent-text">Forge</span>
        </span>
      </button>

      {/* ── Center: editable project title — aggressively truncated on tiny viewports */}
      <div className="flex min-w-0 flex-1 items-center justify-center overflow-hidden">
        {editing ? (
          <input
            ref={inputRef}
            value={draft}
            aria-label="Project title"
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitTitle}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitTitle();
              if (e.key === "Escape") setEditing(false);
            }}
            className="h-8 w-full max-w-sm rounded-sm border border-vf-border-default bg-vf-surface-2 px-2 text-center text-sm text-vf-text-primary"
          />
        ) : (
          <button
            type="button"
            onClick={() => setEditing(true)}
            title="Rename project"
            className="max-w-[90px] truncate rounded-sm px-1 py-0.5 text-xs font-medium text-vf-text-secondary hover:bg-vf-surface-2 hover:text-vf-text-primary sm:max-w-[140px] sm:text-sm sm:px-2 sm:py-1 md:max-w-sm"
          >
            {title}
          </button>
        )}
      </div>

      {/* ── Right: undo / redo + the single amber primary CTA — compact on mobile */}
      <div className="flex items-center gap-1 md:gap-2">
        <div className="flex items-center gap-0.5">
          <Tooltip label="Undo">
            <IconButton aria-label="Undo" size="lg" disabled={!canUndo} onClick={undo}>
              <Undo2 className="h-5 w-5" aria-hidden="true" />
            </IconButton>
          </Tooltip>
          <Tooltip label="Redo">
            <IconButton aria-label="Redo" size="lg" disabled={!canRedo} onClick={redo}>
              <Redo2 className="h-5 w-5" aria-hidden="true" />
            </IconButton>
          </Tooltip>
        </div>

        {/* aria-disabled (NOT bare `disabled`) keeps the CTA in the focus order for axe
            while it's gated — Sentinel checks this. The grey → amber flip when the first
            clip lands is the first "aha". Title explains the gate to mouse users. */}
        <Button
          variant="primary"
          size="md"
          aria-disabled={!canExport}
          title={canExport ? undefined : "Add a clip to the timeline to export"}
          onClick={() => {
            if (canExport) setExportOpen(true);
          }}
          leadingIcon={<span aria-hidden="true">⤓</span>}
        >
          Export
        </Button>

        {/* Minimal account indicator in editor header (parity with Dashboard).
            Shows user email on hover; click logs out (MVP). */}
        <UserBadge />
      </div>

      <ExportModal open={exportOpen} onClose={() => setExportOpen(false)} />

      {/* local component to avoid top-level import cycles / keep TopBar focused */}
      {/**/}
    </header>
  );
}

function UserBadge() {
  const user = useAuthStore((s) => s.user);
  if (!user) return null;
  const label = user.displayName || user.email;
  const initial = (user.displayName || user.email || "?").trim()[0]?.toUpperCase() ?? "?";

  const onLogout = async () => {
    try {
      await apiLogout();
    } finally {
      // authStore will react to the needs-login or we can force a hard nav
      window.location.href = "/";
    }
  };

  return (
    <button
      type="button"
      onClick={onLogout}
      title={`Account: ${label} — click to sign out`}
      aria-label={`Account ${label}`}
      className="ml-1 flex h-7 items-center gap-1.5 rounded-full border border-vf-border-subtle bg-vf-surface-2 pl-1 pr-2 text-[10px] text-vf-text-tertiary hover:bg-vf-surface-3"
    >
      <span className="flex h-4 w-4 items-center justify-center rounded-full bg-vf-surface-3 text-[9px] font-medium text-vf-text-secondary">
        {initial}
      </span>
      <span className="hidden max-w-[60px] truncate tabular-nums sm:inline md:max-w-[90px]">{user.email}</span>
    </button>
  );
}
