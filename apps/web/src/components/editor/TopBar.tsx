import { useEffect, useRef, useState } from "react";
import { useEditorStore } from "../../store/editorStore.js";
import { renameProject } from "../../lib/projectStore.js";
import { Button, IconButton, Tooltip } from "../ui/index.js";
import ExportModal from "./ExportModal.js";

// TopBar — 56px top band (§3, §8.2 trigger). Left: the VideoForge "forge" wordmark.
// Center: an editable project title. Right: undo/redo (disabled via canUndo/canRedo
// state flags), and the single amber primary CTA — Export — which opens ExportModal.
//
// Zero-prop, store-driven (the editor-shell contract). Title edits write straight to
// the live project (and the localStorage projectStore so a reopen keeps the name).

export default function TopBar() {
  const title = useEditorStore((s) => s.project.title);
  const projectId = useEditorStore((s) => s.project.id);
  const undo = useEditorStore((s) => s.undo);
  const redo = useEditorStore((s) => s.redo);
  const canUndo = useEditorStore((s) => s._canUndo);
  const canRedo = useEditorStore((s) => s._canRedo);

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
    setEditing(false);
  };

  return (
    <header
      className="flex h-topbar items-center justify-between gap-4 bg-vf-surface-1 px-4"
      role="banner"
    >
      {/* ── Left: wordmark (forge ember on the "Forge" syllable) ── */}
      <div className="flex min-w-0 items-center gap-2">
        <span aria-hidden="true" className="text-md leading-none">
          <span className="text-vf-accent">▰</span>
        </span>
        <span className="select-none whitespace-nowrap font-display text-md font-bold tracking-tight text-vf-text-primary">
          Video<span className="text-vf-accent-text">Forge</span>
        </span>
      </div>

      {/* ── Center: editable project title ── */}
      <div className="flex min-w-0 flex-1 items-center justify-center">
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
            className="max-w-sm truncate rounded-sm px-2 py-1 text-sm font-medium text-vf-text-secondary hover:bg-vf-surface-2 hover:text-vf-text-primary"
          >
            {title}
          </button>
        )}
      </div>

      {/* ── Right: undo / redo + the single amber primary CTA ── */}
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-0.5">
          <Tooltip label="Undo (Ctrl+Z)">
            <IconButton aria-label="Undo" disabled={!canUndo} onClick={undo}>
              <span aria-hidden="true">↶</span>
            </IconButton>
          </Tooltip>
          <Tooltip label="Redo (Ctrl+Y)">
            <IconButton aria-label="Redo" disabled={!canRedo} onClick={redo}>
              <span aria-hidden="true">↷</span>
            </IconButton>
          </Tooltip>
        </div>

        <Button
          variant="primary"
          size="md"
          onClick={() => setExportOpen(true)}
          leadingIcon={<span aria-hidden="true">⤓</span>}
        >
          Export
        </Button>
      </div>

      <ExportModal open={exportOpen} onClose={() => setExportOpen(false)} />
    </header>
  );
}
