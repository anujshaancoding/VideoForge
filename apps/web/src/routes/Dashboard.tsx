import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  deleteProjectSync as deleteProject,
  duplicateProjectSync as duplicateProject,
  listProjectsSync as listProjects,
  relativeTime,
  type ProjectSummary,
} from "../lib/projectStore.js";
import { Button, Modal } from "../components/ui/index.js";
import { cx } from "../components/ui/cx.js";

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
  busy,
}: {
  project: ProjectSummary;
  onOpen: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  busy: boolean;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const dismiss = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", dismiss);
    return () => document.removeEventListener("mousedown", dismiss);
  }, [menuOpen]);

  return (
    <li className="relative">
      <div
        role="button"
        tabIndex={0}
        onClick={onOpen}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onOpen();
          }
        }}
        className={cx(
          "group flex cursor-pointer flex-col overflow-hidden rounded-xl border border-vf-border-subtle bg-vf-surface-1",
          "transition-colors duration-[var(--vf-motion-duration)] hover:border-vf-border-strong hover:bg-vf-surface-2",
        )}
      >
        <div className="relative flex aspect-video items-center justify-center bg-vf-surface-2">
          <AspectGlyph width={project.width} height={project.height} />
          {busy && (
            <div className="absolute inset-0 flex items-center justify-center bg-vf-overlay-scrim text-xs text-vf-text-secondary">
              Working…
            </div>
          )}
          <span className="absolute bottom-2 left-2 inline-flex items-center gap-1 rounded-pill bg-vf-surface-sunken/80 px-2 py-0.5 text-2xs text-vf-text-secondary">
            <AspectGlyph width={project.width} height={project.height} />
            {project.aspectRatio === "custom"
              ? `${project.width}×${project.height}`
              : project.aspectRatio}
          </span>
        </div>
        <div className="flex items-center justify-between gap-2 px-3 py-2">
          <div className="min-w-0">
            <div className="truncate text-sm font-medium text-vf-text-primary" title={project.title}>
              {project.title}
            </div>
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
            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-sm text-vf-icon-muted hover:bg-vf-surface-3 hover:text-vf-text-primary"
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

export default function Dashboard() {
  const navigate = useNavigate();
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<ProjectSummary | null>(null);

  const refresh = useCallback(() => setProjects(listProjects()), []);
  useEffect(() => refresh(), [refresh]);

  const handleDuplicate = useCallback(
    (id: string) => {
      setBusyId(id);
      duplicateProject(id);
      refresh();
      setBusyId(null);
    },
    [refresh],
  );

  const confirmDelete = useCallback(() => {
    if (!pendingDelete) return;
    deleteProject(pendingDelete.id);
    setPendingDelete(null);
    refresh();
  }, [pendingDelete, refresh]);

  const isEmpty = projects.length === 0;

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
        <button
          type="button"
          aria-label="Account menu"
          className="inline-flex h-8 items-center gap-1 rounded-pill border border-vf-border-default px-2 text-xs text-vf-text-secondary hover:bg-vf-surface-2"
        >
          <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-vf-surface-3 text-vf-text-primary">
            ◑
          </span>
          <span aria-hidden="true">▾</span>
        </button>
      </header>

      <main className="flex-1 px-6 py-8">
        {isEmpty ? (
          <div className="mx-auto flex max-w-[560px] flex-col items-center py-20 text-center">
            <div
              aria-hidden="true"
              className="mb-6 inline-flex h-16 w-16 items-center justify-center rounded-xl bg-vf-accent-subtle text-3xl text-vf-accent-text"
            >
              ▶
            </div>
            <h1 className="text-2xl font-bold text-vf-text-primary">Create your first video</h1>
            <p className="mt-3 text-base text-vf-text-secondary">
              Import footage, cut it on a real multi-track timeline, and export an MP4 that matches
              your edit exactly — what you cut is what you get.
            </p>
            <div className="mt-8">
              <Button variant="primary" size="lg" onClick={() => navigate("/new")}>
                + New project
              </Button>
            </div>
          </div>
        ) : (
          <>
            <div className="mb-6 flex items-center justify-between">
              <h1 className="text-xl font-bold text-vf-text-primary">Your projects</h1>
              <Button variant="primary" onClick={() => navigate("/new")}>
                + New
              </Button>
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
