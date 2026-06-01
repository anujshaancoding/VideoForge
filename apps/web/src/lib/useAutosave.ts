// Debounced autosave hook. Fires 3s after the last project mutation
// and patches the document to the API. Exposes saveStatus for the StatusBar.

import { useCallback, useEffect, useRef, useState } from 'react';
import { useEditorStore } from '../store/editorStore.js';
import { apiPatchProject } from './api.js';

export type SaveStatus = 'saved' | 'saving' | 'unsaved' | 'error';

const DEBOUNCE_MS = 3000;

export function useAutosave(): SaveStatus {
  const [status, setStatus] = useState<SaveStatus>('saved');
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savingRef = useRef(false);

  const triggerSave = useCallback(async () => {
    if (savingRef.current) return;
    savingRef.current = true;
    setStatus('saving');

    const state = useEditorStore.getState();
    const { project } = state;

    try {
      const updated = await apiPatchProject(project.id, {
        document: project,
        baseRevision: project.revision,
      });
      // Bump the revision in the store without pushing an undo entry
      useEditorStore.setState((s) => ({
        project: { ...s.project, revision: updated.revision },
      }));
      setStatus('saved');
    } catch {
      setStatus('error');
    } finally {
      savingRef.current = false;
    }
  }, []);

  useEffect(() => {
    // Subscribe to ALL store changes; compare project identity to detect mutations.
    let prevProject = useEditorStore.getState().project;
    const unsub = useEditorStore.subscribe((s) => {
      if (s.project === prevProject) return;
      prevProject = s.project;
      setStatus('unsaved');
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => void triggerSave(), DEBOUNCE_MS);
    });
    return () => {
      unsub();
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [triggerSave]);

  return status;
}
