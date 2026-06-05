// Project persistence — wraps the real @videoforge/api backend.
// Falls back to localStorage when the API is unreachable so the editor remains
// usable offline (e.g. during local development without the backend running).

import {
  newProject as schemaNewProject,
  sampleProject,
  type Project,
} from '@videoforge/project-schema';
import {
  apiListProjects,
  apiGetProject,
  apiCreateProject,
  apiPatchProject,
  apiDeleteProject,
  apiDuplicateProject,
  ApiError,
} from './api.js';

const LS_KEY = 'videoforge.projects.v1';

/**
 * Decide whether a thrown API error is a *genuine offline* condition (so the
 * localStorage fallback is the right, intended behaviour) or a *server-reachable*
 * failure such as 401/403/404/409/5xx (so falling back to local — possibly the
 * seeded sampleProject — would MASK the real server document and then let autosave
 * overwrite it with stale data).
 *
 * The api client throws `ApiError` for any non-2xx response (server reachable) and a
 * native `TypeError` ("Failed to fetch") when the network itself is down. So: only a
 * non-ApiError (network) failure is treated as offline.
 */
function isOfflineError(err: unknown): boolean {
  return !(err instanceof ApiError);
}

// ── localStorage fallback helpers ─────────────────────────────────────────────

function lsReadAll(): Record<string, Project> {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, Project>) : {};
  } catch {
    return {};
  }
}

function lsWriteAll(map: Record<string, Project>): void {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(map));
  } catch {
    // quota exceeded — non-fatal
  }
}

function lsEnsureSeeded(map: Record<string, Project>): Record<string, Project> {
  if (Object.keys(map).length === 0) {
    map[sampleProject.id] = sampleProject;
    lsWriteAll(map);
  }
  return map;
}

// ── Public types ───────────────────────────────────────────────────────────────

export interface ProjectSummary {
  id: string;
  title: string;
  aspectRatio: string;
  width: number;
  height: number;
  updatedAt: string;
}

export interface CreateProjectInput {
  title: string;
  width: number;
  height: number;
  frameRate?: number;
  /**
   * Optional pre-built project document (create-from-template). When present it is
   * persisted as-is via POST /projects (Core honours a supplied `document`); when
   * absent a fresh blank project is seeded. The caller owns/stamps the document's
   * identity (see cloneTemplateToProject) — we don't mutate it here.
   */
  document?: Project;
}

// ── API-backed functions ───────────────────────────────────────────────────────

/** All projects as dashboard summaries, newest-updated first. */
export async function listProjects(): Promise<ProjectSummary[]> {
  try {
    const items = await apiListProjects();
    return items
      .map((p) => {
        const doc = p.document as Project;
        return {
          id: p.id,
          title: p.name,
          aspectRatio: doc.canvas?.aspectRatio ?? '9:16',
          width: doc.canvas?.width ?? 1080,
          height: doc.canvas?.height ?? 1920,
          updatedAt: p.updatedAt,
        };
      })
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  } catch {
    // Fallback to localStorage when API is down
    const map = lsEnsureSeeded(lsReadAll());
    return Object.values(map)
      .map((p) => ({
        id: p.id,
        title: p.title,
        aspectRatio: p.canvas.aspectRatio,
        width: p.canvas.width,
        height: p.canvas.height,
        updatedAt: p.updatedAt,
      }))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
}

export async function getProject(id: string): Promise<Project | null> {
  try {
    const p = await apiGetProject(id);
    return p.document as Project;
  } catch (err) {
    // Server reachable but the request failed (401 auth race, 5xx, …): do NOT fall
    // back to the (possibly seeded) localStorage doc — that would mask the real
    // saved project and let autosave clobber it. Rethrow so the caller can
    // surface an error / retry instead of silently loading stale state.
    if (!isOfflineError(err)) throw err;
    // Genuinely offline → the local copy is the right fallback. Don't seed a
    // sample here: a missing id offline should read as "not found", not as the
    // sample project masquerading under the requested id.
    return lsReadAll()[id] ?? null;
  }
}

export async function createProject(input: CreateProjectInput): Promise<Project> {
  // Create-from-template supplies a fully-formed, identity-stamped document; the
  // blank flow seeds one. Either way the document is what we persist + return.
  const project =
    input.document ??
    schemaNewProject({
      title: input.title.trim() || 'Untitled project',
      canvasWidth: input.width,
      canvasHeight: input.height,
      frameRate: input.frameRate ?? 30,
    });
  try {
    await apiCreateProject({ name: project.title, document: project });
  } catch {
    // Fallback: persist locally (also covers the in-flight Core POST-document change —
    // until it lands, the document round-trips via localStorage so the editor opens
    // pre-filled in dev). Server-reachable failures still create via the seed path.
    const map = lsReadAll();
    map[project.id] = project;
    lsWriteAll(map);
  }
  return project;
}

export async function saveProject(
  project: Project,
  baseRevision: number,
  opts?: { keepalive?: boolean },
): Promise<Project> {
  try {
    const updated = await apiPatchProject(
      project.id,
      { document: project, baseRevision },
      opts,
    );
    // Mirror the successful save locally too, so an immediately-following offline
    // reload still sees the latest doc rather than a stale local copy.
    const map = lsReadAll();
    map[project.id] = { ...project, revision: updated.revision } as Project;
    lsWriteAll(map);
    return { ...project, revision: updated.revision } as Project;
  } catch (err) {
    // Only persist locally when genuinely offline. On a server-reachable failure
    // (401/409/5xx) rethrow so autosave surfaces 'error' and retries — silently
    // "succeeding" into localStorage would hide a real save failure.
    if (!isOfflineError(err)) throw err;
    const map = lsReadAll();
    map[project.id] = project;
    lsWriteAll(map);
    return project;
  }
}

export async function duplicateProject(id: string): Promise<Project | null> {
  try {
    const p = await apiDuplicateProject(id);
    return p.document as Project;
  } catch {
    const map = lsReadAll();
    const src = map[id];
    if (!src) return null;
    const now = new Date().toISOString();
    const copy: Project = {
      ...src,
      id: crypto.randomUUID(),
      title: `${src.title} (copy)`,
      revision: 1,
      createdAt: now,
      updatedAt: now,
    };
    map[copy.id] = copy;
    lsWriteAll(map);
    return copy;
  }
}

export async function deleteProject(id: string): Promise<void> {
  try {
    await apiDeleteProject(id);
  } catch {
    const map = lsReadAll();
    delete map[id];
    lsWriteAll(map);
  }
}

// Keep sync helpers for the existing code that expects synchronous calls
// (Dashboard currently uses sync calls — these are the sync localStorage paths):
export function listProjectsSync(): ProjectSummary[] {
  const map = lsEnsureSeeded(lsReadAll());
  return Object.values(map)
    .map((p) => ({
      id: p.id,
      title: p.title,
      aspectRatio: p.canvas.aspectRatio,
      width: p.canvas.width,
      height: p.canvas.height,
      updatedAt: p.updatedAt,
    }))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function getProjectSync(id: string): Project | null {
  return lsEnsureSeeded(lsReadAll())[id] ?? null;
}

export function createProjectSync(input: CreateProjectInput): Project {
  const project = schemaNewProject({
    title: input.title.trim() || 'Untitled project',
    canvasWidth: input.width,
    canvasHeight: input.height,
    frameRate: input.frameRate ?? 30,
  });
  const map = lsReadAll();
  map[project.id] = project;
  lsWriteAll(map);
  // Fire-and-forget sync to API
  void apiCreateProject({ name: project.title, document: project }).catch(() => {});
  return project;
}

export function renameProject(id: string, title: string): void {
  const map = lsReadAll();
  const p = map[id];
  if (!p) return;
  p.title = title.trim() || p.title;
  p.updatedAt = new Date().toISOString();
  lsWriteAll(map);
}

export function deleteProjectSync(id: string): void {
  const map = lsReadAll();
  delete map[id];
  lsWriteAll(map);
  void apiDeleteProject(id).catch(() => {});
}

export function duplicateProjectSync(id: string): Project | null {
  const map = lsReadAll();
  const src = map[id];
  if (!src) return null;
  const now = new Date().toISOString();
  const copy: Project = {
    ...src,
    id: crypto.randomUUID(),
    title: `${src.title} (copy)`,
    revision: 1,
    createdAt: now,
    updatedAt: now,
  };
  map[copy.id] = copy;
  lsWriteAll(map);
  void apiDuplicateProject(id).catch(() => {});
  return copy;
}

/** Relative "x ago" label (§4.2). */
export function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const diff = Date.now() - then;
  const sec = Math.round(diff / 1000);
  if (sec < 60) return 'just now';
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  if (day < 7) return `${day}d ago`;
  return new Date(iso).toLocaleDateString();
}
