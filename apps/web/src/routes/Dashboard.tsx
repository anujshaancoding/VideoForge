import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Sparkles } from "lucide-react";
import {
  deleteProject,
  duplicateProject,
  listProjects,
  relativeTime,
  renameProject,
  type ProjectSummary,
} from "../lib/projectStore.js";
import { Button, Modal } from "../components/ui/index.js";
import { cx } from "../components/ui/cx.js";
import { markFirstSession } from "../lib/firstSession.js";
import { useAuthStore } from "../store/authStore.js";

// Project Dashboard (§4.2) — the creator's home. Card grid + persistent create-tile
// + empty state. Open / Duplicate / Delete (delete is confirm-gated, no undo in
// MVP). Backed by the localStorage project store (MVP-STUB for GET /api/v1/projects).

function AspectGlyph({ width, height }: { width: number; height: number }) {
  // Proportional outline so aspect is not text/color-only (§4.2 / §19.8 SC 1.4.1).
  const max = 16;
  const ratio = width / height;
  const w = ratio >= 1 ? max : Math.round(max * ratio);
  const h = ratio >= 1 ? Math.round(max / ratio) : max;
  return (
    <span
      aria-hidden="true"
      className="inline-block border border-vf-text-tertiary"
      style={{ width: `${w}px`, height: `${h}px` }}
    />
  );
}

function ProjectCard({
  project,
  onOpen,
  onDuplicate,
  onDelete,
  onRename,
  busy,
}: {
  project: ProjectSummary;
  onOpen: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onRename: (newTitle: string) => void;
  busy: boolean;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [isRenaming, setIsRenaming] = useState(false);
  const [draft, setDraft] = useState(project.title);
  const menuRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const dismiss = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", dismiss);
    return () => document.removeEventListener("mousedown", dismiss);
  }, [menuOpen]);

  // When entering rename mode, focus and select the text (F18)
  useEffect(() => {
    if (isRenaming && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isRenaming]);

  // Visual preview "stage" for the card — makes projects feel real and desirable (product review feedback).
  // Uses the project's actual aspect for the preview frame + a subtle "video" treatment.
  const previewRatio = project.width / project.height;
  const isVertical = previewRatio < 1;

  return (
    <li className="relative">
      {/* Card is a non-interactive container. The open affordance is a single
          "stretched" button covering the card (below the content), and the actions
          button sits ABOVE it (z-10) as a SIBLING — so no interactive element is
          nested inside another (WCAG 4.1.2 / axe nested-interactive). */}
      <div
        className={cx(
          "group relative flex cursor-pointer flex-col overflow-hidden rounded-xl border border-vf-border-subtle bg-vf-surface-1",
          "transition-colors duration-[var(--vf-motion-duration)] hover:border-vf-border-strong hover:bg-vf-surface-2",
          "focus-within:border-vf-border-strong",
        )}
      >
        <button
          type="button"
          aria-label={`Open ${project.title}`}
          onClick={onOpen}
          className="absolute inset-0 z-0 cursor-pointer rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-vf-accent"
        />
        <div
          className="pointer-events-none relative flex items-center justify-center overflow-hidden bg-vf-surface-sunken"
          style={{ aspectRatio: previewRatio }}
        >
          {/* "Video frame" treatment: dark stage + subtle inner frame to feel like a real preview */}
          <div
            className="relative flex items-center justify-center rounded-sm border border-vf-border-subtle/60 bg-[#0f0f12]"
            style={{
              width: isVertical ? '48%' : '72%',
              aspectRatio: previewRatio,
            }}
          >
            <AspectGlyph width={project.width} height={project.height} />
            {/* Play affordance to signal "this is video content" */}
            <span aria-hidden="true" className="absolute text-xl text-vf-text-tertiary/70">▶</span>
          </div>

          {busy && (
            <div className="absolute inset-0 flex items-center justify-center bg-vf-overlay-scrim text-xs text-vf-text-secondary">
              Working…
            </div>
          )}

          <span className="absolute bottom-2 left-2 inline-flex items-center gap-1 rounded-pill bg-black/60 px-2 py-0.5 text-2xs text-vf-text-primary backdrop-blur">
            <AspectGlyph width={project.width} height={project.height} />
            {project.aspectRatio === "custom"
              ? `${project.width}×${project.height}`
              : project.aspectRatio}
          </span>
        </div>
        <div className="relative flex items-center justify-between gap-2 px-3 py-2">
          <div className="min-w-0 flex-1">
            {isRenaming ? (
              <input
                ref={inputRef}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    const trimmed = draft.trim();
                    if (trimmed && trimmed !== project.title) {
                      onRename(trimmed);
                    }
                    setIsRenaming(false);
                  }
                  if (e.key === "Escape") {
                    setIsRenaming(false);
                    setDraft(project.title);
                  }
                }}
                onBlur={() => {
                  const trimmed = draft.trim();
                  if (trimmed && trimmed !== project.title) {
                    onRename(trimmed);
                  }
                  setIsRenaming(false);
                }}
                className="w-full text-sm font-medium bg-vf-surface-2 border border-vf-accent rounded px-1 py-0.5 text-vf-text-primary"
                onClick={(e) => e.stopPropagation()}
              />
            ) : (
              <div className="truncate text-sm font-medium text-vf-text-primary" title={project.title}>
                {project.title}
              </div>
            )}
            <div className="text-xs text-vf-text-tertiary" title={project.updatedAt}>
              {relativeTime(project.updatedAt)}
            </div>
          </div>
          <button
            type="button"
            aria-label="Project actions"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            data-testid="project-actions-btn"
            onClick={(e) => {
              e.stopPropagation();
              setMenuOpen((v) => !v);
            }}
            className="relative z-10 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-sm text-vf-icon-muted hover:bg-vf-surface-3 hover:text-vf-text-primary"
          >
            <span aria-hidden="true">⋯</span>
          </button>
        </div>
      </div>

      {menuOpen && (
        <div
          ref={menuRef}
          role="menu"
          data-testid="project-card-menu"
          className="absolute right-2 top-full z-dropdown mt-1 w-40 overflow-hidden rounded-md border border-vf-border-subtle bg-vf-surface-3 py-1 shadow-vf-2"
        >
          <button
            role="menuitem"
            type="button"
            className="block w-full px-3 py-1.5 text-left text-sm text-vf-text-primary hover:bg-vf-surface-4"
            onClick={() => {
              setMenuOpen(false);
              onOpen();
            }}
          >
            Open
          </button>
          <button
            role="menuitem"
            type="button"
            className="block w-full px-3 py-1.5 text-left text-sm text-vf-text-primary hover:bg-vf-surface-4"
            onClick={() => {
              setMenuOpen(false);
              setIsRenaming(true);
              setDraft(project.title);
            }}
          >
            Rename
          </button>
          <button
            role="menuitem"
            type="button"
            className="block w-full px-3 py-1.5 text-left text-sm text-vf-text-primary hover:bg-vf-surface-4"
            onClick={() => {
              setMenuOpen(false);
              onDuplicate();
            }}
          >
            Duplicate
          </button>
          <button
            role="menuitem"
            type="button"
            className="block w-full px-3 py-1.5 text-left text-sm text-vf-danger-fg hover:bg-vf-surface-4"
            onClick={() => {
              setMenuOpen(false);
              onDelete();
            }}
          >
            Delete
          </button>
        </div>
      )}
    </li>
  );
}

function AccountMenu() {
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const dismiss = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", dismiss);
    return () => document.removeEventListener("mousedown", dismiss);
  }, [open]);

  const label = user?.displayName || user?.email || "Account";

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-label="Account menu"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex h-8 items-center gap-1 rounded-pill border border-vf-border-default px-2 text-xs text-vf-text-secondary hover:bg-vf-surface-2"
      >
        <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-vf-surface-3 text-vf-text-primary">
          ◑
        </span>
        <span className="max-w-[140px] truncate">{label}</span>
        <span aria-hidden="true">▾</span>
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-dropdown mt-1 w-56 overflow-hidden rounded-md border border-vf-border-subtle bg-vf-surface-3 py-1 shadow-vf-2"
        >
          {user && (
            <div className="border-b border-vf-border-subtle px-3 py-2">
              {user.displayName && (
                <div className="truncate text-sm font-medium text-vf-text-primary">
                  {user.displayName}
                </div>
              )}
              <div className="truncate text-xs text-vf-text-tertiary">{user.email}</div>
            </div>
          )}
          <button
            role="menuitem"
            type="button"
            className="block w-full px-3 py-1.5 text-left text-sm text-vf-text-primary hover:bg-vf-surface-4"
            onClick={() => {
              setOpen(false);
              void logout();
            }}
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}

export default function Dashboard() {
  const navigate = useNavigate();
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<ProjectSummary | null>(null);

  const refresh = useCallback(async () => {
    const items = await listProjects();
    setProjects(items);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    listProjects()
      .then((items) => {
        if (cancelled) return;
        setProjects(items);
        // First-session mechanic (§6): a brand-new creator with no projects gets the
        // flag set on first load; it's cleared on their first successful export. Only
        // set on a genuinely empty dashboard so returning creators aren't re-flagged.
        if (items.length === 0) markFirstSession();
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleDuplicate = useCallback(
    async (id: string) => {
      setBusyId(id);
      try {
        await duplicateProject(id);
        await refresh();
      } finally {
        setBusyId(null);
      }
    },
    [refresh],
  );

  const handleRename = useCallback(
    (id: string, newTitle: string) => {
      setBusyId(id);
      try {
        renameProject(id, newTitle);
        // Refresh the list so the card title updates (works for both LS and API paths via listProjects)
        void refresh();
      } finally {
        setBusyId(null);
      }
    },
    [refresh],
  );

  const confirmDelete = useCallback(async () => {
    if (!pendingDelete) return;
    const id = pendingDelete.id;
    setPendingDelete(null);
    await deleteProject(id);
    await refresh();
  }, [pendingDelete, refresh]);

  const isEmpty = !loading && projects.length === 0;

  return (
    <div className="flex min-h-full flex-col bg-vf-bg-app">
      {/* App header (§4.0) — 56px, matches the editor top bar for continuity. */}
      <header className="flex h-topbar shrink-0 items-center justify-between border-b border-vf-border-subtle bg-vf-surface-1 px-6">
        <div className="flex items-center gap-2">
          <span
            aria-hidden="true"
            className="inline-flex h-6 w-6 items-center justify-center rounded-sm bg-vf-accent-subtle text-vf-accent-text"
          >
            ◣
          </span>
          <span className="text-md font-bold tracking-tight text-vf-text-primary">VideoForge</span>
        </div>
        <AccountMenu />
      </header>

      <main className="flex-1 px-6 py-8">
        {loading ? (
          <div
            role="status"
            aria-live="polite"
            className="mx-auto flex max-w-[560px] flex-col items-center py-20 text-center text-sm text-vf-text-secondary"
          >
            Loading your projects…
          </div>
        ) : isEmpty ? (
          <div className="mx-auto flex max-w-[560px] flex-col items-center py-20 text-center">
            <div
              aria-hidden="true"
              className="mb-6 inline-flex h-16 w-16 items-center justify-center rounded-xl bg-vf-accent-subtle text-3xl text-vf-accent-text"
            >
              ▶
            </div>
            <h1 className="text-2xl font-bold text-vf-text-primary">Drop a video to start</h1>
            <p className="mt-3 text-base text-vf-text-secondary">
              Import → arrange → export — usually under 10 minutes. What you cut is what you get.
            </p>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
              {/* Non-amber: amber is reserved for the single Export CTA + brand (§2.3). */}
              <Button variant="secondary" size="lg" onClick={() => navigate("/new")} data-testid="new-project-btn">
                + New project
              </Button>
              {/* Script Studio entry — selection sky-blue, never amber. */}
              <Button
                variant="secondary"
                size="lg"
                className="border-vf-selection/60 text-vf-text-primary"
                leadingIcon={<Sparkles className="h-4 w-4 text-vf-selection" aria-hidden="true" />}
                onClick={() => navigate("/script")}
                data-testid="script-studio-btn"
              >
                Start from a script
              </Button>
            </div>
          </div>
        ) : (
          <>
            <div className="mb-6 flex items-center justify-between">
              <h1 className="text-xl font-bold text-vf-text-primary">Your projects</h1>
              <div className="flex items-center gap-2">
                {/* Script Studio entry — selection sky-blue, never amber. */}
                <Button
                  variant="secondary"
                  className="border-vf-selection/60"
                  leadingIcon={<Sparkles className="h-4 w-4 text-vf-selection" aria-hidden="true" />}
                  onClick={() => navigate("/script")}
                  data-testid="script-studio-btn"
                >
                  From a script
                </Button>
                {/* Non-amber: amber is reserved for the single Export CTA + brand (§2.3). */}
                <Button variant="secondary" onClick={() => navigate("/new")} data-testid="new-project-btn">
                  + New
                </Button>
              </div>
            </div>
            <ul
              role="list"
              className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-4"
            >
              {/* Persistent create-tile, always first (§4.2). */}
              <li>
                <button
                  type="button"
                  onClick={() => navigate("/new")}
                  data-testid="new-project-btn"
                  className="flex h-full min-h-[180px] w-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-vf-border-default bg-vf-surface-1 text-vf-text-secondary hover:border-vf-border-strong hover:bg-vf-surface-2"
                >
                  <span aria-hidden="true" className="text-2xl">
                    +
                  </span>
                  <span className="text-sm font-medium">New project</span>
                </button>
              </li>
              {projects.map((p) => (
                <ProjectCard
                  key={p.id}
                  project={p}
                  busy={busyId === p.id}
                  onOpen={() => navigate(`/editor/${p.id}`)}
                  onDuplicate={() => handleDuplicate(p.id)}
                  onDelete={() => setPendingDelete(p)}
                  onRename={(newTitle) => handleRename(p.id, newTitle)}
                />
              ))}
            </ul>
          </>
        )}
      </main>

      <Modal
        open={pendingDelete !== null}
        onClose={() => setPendingDelete(null)}
        title="Delete project"
        widthClassName="max-w-[440px]"
        footer={
          <>
            <Button variant="ghost" onClick={() => setPendingDelete(null)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              className="bg-vf-danger-bg hover:bg-vf-danger-fg active:bg-vf-danger-bg"
              onClick={confirmDelete}
            >
              Delete
            </Button>
          </>
        }
      >
        <p className="text-sm text-vf-text-secondary">
          Delete &ldquo;{pendingDelete?.title}&rdquo;? This can&rsquo;t be undone.
        </p>
      </Modal>
    </div>
  );
}
