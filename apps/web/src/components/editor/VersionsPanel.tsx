// VersionsPanel — "never lose your work" version history (CEO-greenlit 2026-06-14).
//
// A modal opened from the StatusBar. Lists the project's saved versions (newest
// first), with auto/named badges + relative timestamps, a "Save version" action
// (named snapshot of the current document), and per-version Restore (confirmed,
// then loaded into the editor via the store's loadProject — history is preserved
// server-side, so a restore is itself recoverable).
//
// Brand: dark-first surfaces, sky-blue (vf-selection) for the active/named accent;
// amber is reserved for Export, so it is NOT used here; no purple.

import { useCallback, useEffect, useState } from 'react';
import { History, Save, RotateCcw } from 'lucide-react';
import type { Project } from '@videoforge/project-schema';
import { Button, Modal, cx } from '../ui/index.js';
import { useEditorStore } from '../../store/editorStore.js';
import {
  apiCreateVersion,
  apiListVersions,
  apiRestoreVersion,
  type ProjectVersionSummary,
} from '../../lib/api.js';
import { onVersionsChanged, emitVersionsChanged } from '../../lib/useAutosave.js';
import { relativeTime } from '../../lib/projectStore.js';

interface VersionsPanelProps {
  open: boolean;
  onClose: () => void;
}

export default function VersionsPanel({ open, onClose }: VersionsPanelProps) {
  const projectId = useEditorStore((s) => s.project.id);
  const loadProject = useEditorStore((s) => s.loadProject);

  const [versions, setVersions] = useState<ProjectVersionSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  /** versionId currently being restored (drives per-row busy state + confirm). */
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setVersions(await apiListVersions(projectId));
    } catch {
      setError('Could not load version history.');
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  // Load on open + refresh whenever a version is created (auto tick or manual save).
  useEffect(() => {
    if (!open) return;
    void refresh();
    const unsub = onVersionsChanged(() => void refresh());
    return unsub;
  }, [open, refresh]);

  const handleSaveVersion = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      const { project } = useEditorStore.getState();
      const label = new Date().toLocaleString();
      await apiCreateVersion(project.id, { kind: 'named', label, document: project });
      emitVersionsChanged();
    } catch {
      setError('Could not save a version. Try again.');
    } finally {
      setSaving(false);
    }
  }, []);

  const handleRestore = useCallback(
    async (versionId: string) => {
      setRestoringId(versionId);
      setConfirmId(null);
      setError(null);
      try {
        const { document } = await apiRestoreVersion(projectId, versionId);
        loadProject(document as Project);
        onClose();
      } catch {
        setError('Restore failed. Your current work is unchanged.');
      } finally {
        setRestoringId(null);
      }
    },
    [projectId, loadProject, onClose],
  );

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={
        <span className="flex items-center gap-2">
          <History className="h-4 w-4 text-vf-selection" aria-hidden="true" />
          Version history
        </span>
      }
      widthClassName="max-w-[480px]"
      footer={
        <div className="flex w-full items-center justify-between">
          <Button
            variant="secondary"
            leadingIcon={<Save className="h-4 w-4" aria-hidden="true" />}
            onClick={() => void handleSaveVersion()}
            disabled={saving}
          >
            {saving ? 'Saving version…' : 'Save version'}
          </Button>
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
        </div>
      }
    >
      <p className="mb-3 text-xs text-vf-text-tertiary">
        VideoForge auto-saves a snapshot every 30 minutes while you edit, plus any
        you save manually. Restoring keeps your history — nothing is lost.
      </p>

      {error ? (
        <p role="alert" className="mb-3 rounded-md bg-vf-danger-subtle px-3 py-2 text-xs text-vf-danger-fg">
          {error}
        </p>
      ) : null}

      {loading && versions.length === 0 ? (
        <p className="py-6 text-center text-sm text-vf-text-tertiary">Loading…</p>
      ) : versions.length === 0 ? (
        <p className="py-6 text-center text-sm text-vf-text-tertiary">
          No versions yet. Save one to start your history.
        </p>
      ) : (
        <ul className="flex max-h-[50vh] flex-col gap-1 overflow-y-auto">
          {versions.map((v) => {
            const isConfirming = confirmId === v.id;
            const isRestoring = restoringId === v.id;
            return (
              <li
                key={v.id}
                className="flex items-center gap-3 rounded-md bg-vf-surface-2 px-3 py-2"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm text-vf-text-primary">
                      {v.label ?? relativeTime(v.createdAt)}
                    </span>
                    <span
                      className={cx(
                        'shrink-0 rounded-sm px-1.5 py-0.5 text-2xs font-medium',
                        v.kind === 'named'
                          ? 'bg-vf-selection/20 text-vf-selection'
                          : 'bg-vf-surface-3 text-vf-text-tertiary',
                      )}
                    >
                      {v.kind === 'named' ? 'Named' : 'Auto'}
                    </span>
                  </div>
                  <span className="vf-tnum text-2xs text-vf-text-tertiary">
                    {relativeTime(v.createdAt)}
                  </span>
                </div>

                {isConfirming ? (
                  <div className="flex shrink-0 items-center gap-1">
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => void handleRestore(v.id)}
                      disabled={isRestoring}
                    >
                      Confirm
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setConfirmId(null)}>
                      Cancel
                    </Button>
                  </div>
                ) : (
                  <Button
                    size="sm"
                    variant="ghost"
                    leadingIcon={<RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />}
                    onClick={() => setConfirmId(v.id)}
                    disabled={restoringId != null}
                  >
                    {isRestoring ? 'Restoring…' : 'Restore'}
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Modal>
  );
}
