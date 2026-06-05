// Debounced autosave hook. Fires 3s after the last project mutation and persists
// the document to the API (with an offline localStorage fallback via saveProject).
// Exposes saveStatus for the StatusBar.
//
// Reliability guarantees (the "settings vanish on reload" fix):
//   • ARMED-ONLY: autosave persists a project id ONLY after the editor has
//     successfully loaded/hydrated that project from the server (armAutosave()).
//     This prevents the seed `sampleProject` — or a stale doc loaded during an
//     auth race — from being PATCHed over the user's real saved document on mount.
//   • SESSION-AWARE: while no auth session is live (token not yet restored after a
//     reload), a save is deferred and re-tried shortly, never sent against the
//     wrong/empty state during the 401-before-refresh window.
//   • FLUSH-ON-HIDE: a pending debounced save is flushed on `visibilitychange`
//     (hidden) and `pagehide`, so the last <3s of edits survive a reload/close.

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Project } from '@videoforge/project-schema';
import { useEditorStore } from '../store/editorStore.js';
import { hasSession } from './api.js';
import { saveProject } from './projectStore.js';

export type SaveStatus = 'saved' | 'saving' | 'unsaved' | 'error';

const DEBOUNCE_MS = 3000;
/** How long to wait before re-attempting a save deferred by a transient auth race. */
const SESSION_RETRY_MS = 400;

// ── Arming signal ───────────────────────────────────────────────────────────────
// The editor route calls armAutosave(id) once it has hydrated the store from the
// project document fetched for that id. Until then autosave is a no-op, so the
// initial seed state is never persisted back over the server.
let armedProjectId: string | null = null;

/** Allow autosave to persist `projectId` (call after a successful load/hydrate). */
export function armAutosave(projectId: string): void {
  armedProjectId = projectId;
}

/** Disarm autosave (call on editor unmount so a stale id can't be saved later). */
export function disarmAutosave(): void {
  armedProjectId = null;
}

// ── Imperative immediate-save (Ctrl/Cmd+S) ──────────────────────────────────────
// The active hook publishes its flush function here so the editor's keyboard
// handler can force an immediate save without prop-drilling.
let activeFlush: (() => void) | null = null;

/** Force an immediate save of the armed project (Ctrl/Cmd+S). No-op if unarmed. */
export function saveNow(): void {
  activeFlush?.();
}

/**
 * True when `next` differs from `prev` ONLY in `revision`. Immer's structural
 * sharing keeps every nested field referentially identical when we mutate just
 * `revision`, so a shallow per-key compare (ignoring `revision`) is exact + cheap.
 */
function isRevisionOnlyChange(prev: Project, next: Project): boolean {
  if (prev === next) return true;
  const a = prev as unknown as Record<string, unknown>;
  const b = next as unknown as Record<string, unknown>;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) {
    if (k === 'revision') continue;
    if (a[k] !== b[k]) return false;
  }
  return true;
}

export function useAutosave(): SaveStatus {
  const [status, setStatus] = useState<SaveStatus>('saved');
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savingRef = useRef(false);
  /** True while there is an unsaved edit that has not yet been persisted. */
  const dirtyRef = useRef(false);
  /**
   * The last project reference we've "accounted for" (either as the baseline or
   * after our own revision bump). Shared with the subscription so the post-save
   * revision write doesn't read back as a fresh user edit → save loop.
   */
  const accountedRef = useRef(useEditorStore.getState().project);

  const triggerSave = useCallback(async (keepalive = false) => {
    if (savingRef.current) return;

    const state = useEditorStore.getState();
    const { project } = state;

    // Only persist a project the editor has explicitly armed (loaded from server).
    if (armedProjectId == null || project.id !== armedProjectId) return;

    // Auth race: no live session yet (token still being restored after a reload).
    // Defer — do NOT save against a possibly-wrong state — and retry shortly. Keep
    // the status as 'unsaved' so the edit is clearly still pending. (A flush-on-hide
    // can't retry — the page is going away — so we skip the deferral there.)
    if (!hasSession()) {
      if (keepalive) return;
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => void triggerSave(), SESSION_RETRY_MS);
      return;
    }

    savingRef.current = true;
    dirtyRef.current = false;
    setStatus('saving');

    const savedAtRevision = project.revision;
    try {
      const saved = await saveProject(project, savedAtRevision, { keepalive });
      // Bump the stored revision to the server's, without pushing an undo entry.
      // (Immer middleware: mutate the draft; never return a partial. Note `s.project`
      // is a draft proxy here, so we can't compare it by reference to `project` —
      // gate on id + the pre-save revision so we don't clobber a newer in-flight
      // edit that already advanced the doc.)
      useEditorStore.setState((s) => {
        if (s.project.id === project.id && s.project.revision === savedAtRevision) {
          s.project.revision = saved.revision;
        }
      });
      // Account for our own revision write so the subscription below doesn't treat
      // the new project reference as a fresh edit (which would loop the autosave).
      accountedRef.current = useEditorStore.getState().project;
      // If more edits landed mid-save, schedule another pass.
      setStatus(dirtyRef.current ? 'unsaved' : 'saved');
      if (dirtyRef.current) {
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => void triggerSave(), DEBOUNCE_MS);
      }
    } catch {
      // Server-reachable failure (saveProject only throws when NOT offline). Mark
      // the edit dirty again and retry on the next debounce window.
      dirtyRef.current = true;
      setStatus('error');
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => void triggerSave(), DEBOUNCE_MS);
    } finally {
      savingRef.current = false;
    }
  }, []);

  useEffect(() => {
    // Subscribe to ALL store changes; compare project identity to detect mutations.
    accountedRef.current = useEditorStore.getState().project;
    const unsub = useEditorStore.subscribe((s) => {
      if (s.project === accountedRef.current) return;
      const prev = accountedRef.current;
      accountedRef.current = s.project;
      // Ignore mutations to a project that isn't the armed one (e.g. the seed before
      // load, or a load() swapping the doc in) — those must not trigger a save.
      if (armedProjectId == null || s.project.id !== armedProjectId) return;
      // Ignore a change that differs ONLY in `revision` (our own save bookkeeping or
      // a load) — that's not a user edit and must not (re)trigger a save loop.
      if (isRevisionOnlyChange(prev, s.project)) return;
      dirtyRef.current = true;
      setStatus('unsaved');
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => void triggerSave(), DEBOUNCE_MS);
    });
    return () => {
      unsub();
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [triggerSave]);

  // Flush a pending save when the page is being hidden/unloaded so the last edits
  // (still inside the debounce window) are not lost on reload/close. We fire on
  // `visibilitychange→hidden` (the reliable signal on modern browsers) and on
  // `pagehide`. saveProject uses fetch under the hood; the request is best-effort.
  // The same flush is published for the Ctrl/Cmd+S imperative save.
  useEffect(() => {
    const flush = (keepalive: boolean) => {
      if (!dirtyRef.current || savingRef.current) return;
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      void triggerSave(keepalive);
    };
    // Page is being torn down → use keepalive so the request still completes.
    const onHide = () => flush(true);
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flush(true);
    };
    // Ctrl/Cmd+S → a normal (non-keepalive) immediate save while the page stays.
    const flushNow = () => flush(false);
    activeFlush = flushNow;
    window.addEventListener('pagehide', onHide);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      if (activeFlush === flushNow) activeFlush = null;
      window.removeEventListener('pagehide', onHide);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [triggerSave]);

  return status;
}
