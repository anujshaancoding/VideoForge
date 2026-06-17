import { useCallback, useEffect, useRef, useState } from 'react';
import { Upload, Image as ImageIcon, Video, CheckCircle2, AlertTriangle } from 'lucide-react';
import { Button, cx, Modal } from '../ui/index.js';
import { useEditorStore } from '../../store/editorStore.js';
import { useAssetStore } from '../../store/assetStore.js';
import { uploadAsset, UploadError, kindFromMime } from '../../lib/uploadAsset.js';
import { arrangeScript } from '../../lib/scriptStudio.js';
import { ApiError } from '../../lib/api.js';
import type { Project } from '@videoforge/project-schema';

// Auto-arrange (Contract D, step 5) — the "fill your shots" tray. The user uploads
// their own images/videos through the EXISTING presign→PUT→confirm→poll upload flow
// (lib/uploadAsset), then we POST /script/arrange with the new assetIds so the pure
// placement step slots them into each scene's probed VO window, and refresh the
// editor with the placed footage.
//
// Brand: this is NOT the Export CTA, so the primary action uses the sky-blue
// selection accent (amber stays reserved for Export).

type Phase = 'pick' | 'uploading' | 'arranging' | 'done' | 'error';

interface UploadItem {
  localId: string;
  name: string;
  kind: 'video' | 'audio' | 'image';
  status: 'uploading' | 'processing' | 'ready' | 'error';
  progress: number;
  assetId?: string;
  errorMsg?: string;
}

export default function AutoArrangeModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const projectId = useEditorStore((s) => s.project.id);
  const loadProject = useEditorStore((s) => s.loadProject);
  const registerFromRecord = useAssetStore((s) => s.registerFromRecord);

  const [phase, setPhase] = useState<Phase>('pick');
  const [items, setItems] = useState<UploadItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [placedCount, setPlacedCount] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Reset when the modal closes so a re-open starts clean.
  useEffect(() => {
    if (!open) {
      setPhase('pick');
      setItems([]);
      setError(null);
      setPlacedCount(0);
    }
  }, [open]);

  const patchItem = useCallback((localId: string, patch: Partial<UploadItem>) => {
    setItems((prev) => prev.map((it) => (it.localId === localId ? { ...it, ...patch } : it)));
  }, []);

  // Upload every picked file through the shared pipeline, collect ready assetIds,
  // then arrange them onto the timeline and refresh the editor.
  const handleFiles = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return;
      setError(null);
      setPhase('uploading');

      const seeded: UploadItem[] = files.map((f) => ({
        localId: crypto.randomUUID(),
        name: f.name,
        kind: kindFromMime(f.type),
        status: 'uploading',
        progress: 0,
      }));
      setItems((prev) => [...prev, ...seeded]);

      const readyAssetIds: string[] = [];
      await Promise.all(
        files.map(async (file, i) => {
          const localId = seeded[i]!.localId;
          try {
            const rec = await uploadAsset(file, {
              onAssetId: (id) => patchItem(localId, { assetId: id }),
              onProgress: (pct) => patchItem(localId, { progress: pct }),
              onProcessing: () => patchItem(localId, { status: 'processing' }),
            });
            registerFromRecord(rec);
            readyAssetIds.push(rec.id);
            patchItem(localId, { status: 'ready', assetId: rec.id, progress: 100 });
          } catch (err) {
            patchItem(localId, {
              status: 'error',
              errorMsg:
                err instanceof UploadError
                  ? err.message
                  : err instanceof Error
                    ? err.message
                    : 'Upload failed',
            });
          }
        }),
      );

      if (readyAssetIds.length === 0) {
        setError('No files uploaded successfully. Check the formats and try again.');
        setPhase('error');
        return;
      }

      // Arrange: pure placement slots the assets into the probed VO windows.
      setPhase('arranging');
      try {
        const { project } = await arrangeScript({ projectId, assetIds: readyAssetIds });
        // Refresh the editor with the placed footage (same path the editor uses on load).
        loadProject(project as Project);
        setPlacedCount(readyAssetIds.length);
        setPhase('done');
      } catch (err) {
        setError(
          err instanceof ApiError
            ? `Couldn't arrange the footage (${err.status}). Your uploads are saved in the media panel — try again.`
            : "Couldn't arrange the footage. Your uploads are saved in the media panel — try again.",
        );
        setPhase('error');
      }
    },
    [projectId, patchItem, registerFromRecord, loadProject],
  );

  const onPick = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files ?? []);
      e.target.value = '';
      void handleFiles(files);
    },
    [handleFiles],
  );

  const [dragOver, setDragOver] = useState(false);
  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const files = Array.from(e.dataTransfer.files ?? []);
      void handleFiles(files);
    },
    [handleFiles],
  );

  const busy = phase === 'uploading' || phase === 'arranging';

  return (
    <Modal
      open={open}
      onClose={busy ? () => {} : onClose}
      title="Auto-arrange your footage"
      widthClassName="max-w-[560px]"
      closeOnBackdrop={!busy}
      footer={
        phase === 'done' ? (
          <Button
            variant="primary"
            className="bg-vf-selection text-white hover:bg-vf-selection/90"
            onClick={onClose}
          >
            Done — back to editor
          </Button>
        ) : phase === 'error' ? (
          <>
            <Button variant="ghost" onClick={onClose}>
              Close
            </Button>
            <Button
              variant="primary"
              className="bg-vf-selection text-white hover:bg-vf-selection/90"
              onClick={() => {
                setPhase('pick');
                setError(null);
              }}
            >
              Try again
            </Button>
          </>
        ) : (
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            {busy ? 'Working…' : 'Cancel'}
          </Button>
        )
      }
    >
      {error && (
        <div
          role="alert"
          className="mb-4 rounded-md border border-vf-danger-fg/50 bg-vf-surface-2 p-3 text-sm text-vf-danger-fg"
        >
          {error}
        </div>
      )}

      {phase === 'pick' && (
        <>
          <p className="mb-4 text-sm text-vf-text-secondary">
            Upload the images and videos for your scenes. We'll place each one into its shot slot
            and trim it to the voiceover — the voice is the master clock.
          </p>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(e) => {
              if (e.dataTransfer.types.includes('Files')) {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'copy';
                setDragOver(true);
              }
            }}
            onDragLeave={(e) => {
              if (e.currentTarget === e.target) setDragOver(false);
            }}
            onDrop={onDrop}
            data-testid="arrange-dropzone"
            className={cx(
              'flex w-full flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-4 py-12 text-center transition-colors',
              dragOver
                ? 'border-vf-selection bg-vf-selection/10'
                : 'border-vf-border-default hover:border-vf-border-strong hover:bg-vf-surface-2',
            )}
          >
            <Upload className="h-8 w-8 text-vf-text-tertiary" aria-hidden="true" />
            <span className="text-sm font-medium text-vf-text-primary">
              Drop your images &amp; videos here
            </span>
            <span className="text-2xs text-vf-text-tertiary">or click to choose files</span>
            <span className="text-2xs text-vf-text-tertiary">MP4 · MOV · JPG · PNG</span>
          </button>
        </>
      )}

      {(phase === 'uploading' || phase === 'arranging') && (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-vf-text-secondary" aria-live="polite">
            {phase === 'arranging'
              ? 'Placing your footage into the scene slots…'
              : 'Uploading your footage…'}
          </p>
          <ul className="flex flex-col gap-2">
            {items.map((it) => {
              const Icon = it.kind === 'image' ? ImageIcon : Video;
              return (
                <li
                  key={it.localId}
                  className="flex items-center gap-3 rounded-md border border-vf-border-subtle bg-vf-surface-2 p-2.5"
                >
                  <Icon className="h-4 w-4 shrink-0 text-vf-text-tertiary" aria-hidden="true" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xs text-vf-text-primary" title={it.name}>
                      {it.name}
                    </div>
                    {it.status === 'uploading' && (
                      <div className="mt-1 h-1 w-full overflow-hidden rounded-pill bg-vf-surface-sunken">
                        <div
                          className="h-full rounded-pill bg-vf-selection transition-[width] duration-200"
                          style={{ width: `${it.progress}%` }}
                        />
                      </div>
                    )}
                  </div>
                  <span className="shrink-0 text-2xs text-vf-text-tertiary">
                    {it.status === 'uploading'
                      ? `${it.progress}%`
                      : it.status === 'processing'
                        ? 'Processing'
                        : it.status === 'ready'
                          ? 'Ready'
                          : 'Failed'}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {phase === 'done' && (
        <div className="flex flex-col items-center gap-3 py-6 text-center">
          <CheckCircle2 className="h-10 w-10 text-vf-success-fg" aria-hidden="true" />
          <p className="text-base font-medium text-vf-text-primary">Footage placed</p>
          <p className="max-w-sm text-sm text-vf-text-secondary">
            {placedCount} {placedCount === 1 ? 'clip was' : 'clips were'} slotted into your scenes
            and trimmed to the voiceover. Tweak anything on the timeline, then export.
          </p>
        </div>
      )}

      {phase === 'error' && items.some((it) => it.status === 'error') && (
        <ul className="mt-3 flex flex-col gap-1">
          {items
            .filter((it) => it.status === 'error')
            .map((it) => (
              <li
                key={it.localId}
                className="flex items-center gap-2 text-2xs text-vf-text-tertiary"
              >
                <AlertTriangle className="h-3.5 w-3.5 text-vf-danger-fg" aria-hidden="true" />
                <span className="truncate">
                  {it.name}: {it.errorMsg}
                </span>
              </li>
            ))}
        </ul>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept=".mp4,.mov,.jpg,.jpeg,.png,video/mp4,video/quicktime,image/jpeg,image/png"
        multiple
        aria-hidden="true"
        tabIndex={-1}
        className="sr-only"
        onChange={onPick}
        data-testid="arrange-file-input"
      />
    </Modal>
  );
}
