import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { selectProjectDurationMs, useEditorStore } from '../../store/editorStore.js';
import { Button, cx, Modal } from '../ui/index.js';
import { apiCreateExport, apiPollExportComplete, apiGetDownloadUrl, ApiError } from '../../lib/api.js';
import { wsClient } from '../../lib/wsClient.js';
import { clearFirstSession, isFirstSession } from '../../lib/firstSession.js';
import { trackEvent } from '../../lib/analytics.js';
import { resolveManifest } from '../../store/templateStore.js';
import { pruneUnfilledSlots, unfilledMediaSlotCount } from '../../lib/templates.js';

// ExportModal (§8.2) — MP4/H.264, ≤1080p Free-tier cap, social presets.
// Real flow: POST /api/v1/exports → poll until COMPLETE → mint download URL.

type Preset = '9:16' | '16:9' | '1:1' | 'custom';
type CaptionMode = 'none' | 'burn' | 'sidecar';
type Phase = 'config' | 'exporting' | 'done' | 'error' | 'ratelimited';

const PRESETS: Record<Exclude<Preset, 'custom'>, { w: number; h: number; label: string }> = {
  '9:16': { w: 1080, h: 1920, label: 'TikTok / Reels' },
  '16:9': { w: 1920, h: 1080, label: 'YouTube' },
  '1:1': { w: 1080, h: 1080, label: 'Instagram feed' },
};

function estimateSizeMb(w: number, h: number, fps: number, durationMs: number): number {
  const mbitps = Math.max(1, (w * h * fps) / 2_000_000);
  return Math.max(1, Math.round((mbitps * durationMs) / 8_000));
}

function estimateTimeLabel(durationMs: number): string {
  const renderSec = Math.max(1, Math.round(durationMs / 4000));
  return renderSec < 90 ? `~ ${renderSec} sec` : `~ ${Math.round(renderSec / 60)} min`;
}

interface ExportModalProps {
  open: boolean;
  onClose: () => void;
}

export default function ExportModal({ open, onClose }: ExportModalProps) {
  const project = useEditorStore((s) => s.project);
  const durationMs = useEditorStore(selectProjectDurationMs);
  const hasCaptions = useEditorStore((s) => (s.project.captionTracks[0]?.blocks.length ?? 0) > 0);

  const initialPreset: Preset =
    project.canvas.aspectRatio === '16:9'
      ? '16:9'
      : project.canvas.aspectRatio === '9:16'
        ? '9:16'
        : project.canvas.aspectRatio === '1:1'
          ? '1:1'
          : 'custom';

  const [tab, setTab] = useState<'format' | 'captions'>('format');
  const [preset, setPreset] = useState<Preset>(initialPreset);
  const [resolution, setResolution] = useState<'720p' | '1080p'>('1080p');
  const [fps, setFps] = useState(project.canvas.frameRate);
  const [captions, setCaptions] = useState<CaptionMode>(hasCaptions ? 'burn' : 'none');
  const [sidecarFmt, setSidecarFmt] = useState<'.srt' | '.vtt'>('.srt');

  // Snapshot first-session at open so the watermark disclosure + TTFE event stay
  // consistent for THIS export even after the flag is cleared on download. Re-read each
  // time the modal opens (a creator's very first export only — clears on download).
  const [firstSession, setFirstSession] = useState(false);
  useEffect(() => {
    if (open) setFirstSession(isFirstSession());
  }, [open]);

  const [phase, setPhase] = useState<Phase>('config');
  const [progress, setProgress] = useState(0);
  const [etaSeconds, setEtaSeconds] = useState<number | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const abortRef = useRef(false);
  // The export currently being tracked; WS handlers compare against this to
  // ignore push events from older/unrelated exports (stale-closure guard).
  const activeExportIdRef = useRef<string | null>(null);
  // Cleanup callbacks for the WS subscriptions of the in-flight export.
  const wsUnsubsRef = useRef<Array<() => void>>([]);

  const teardownWs = useCallback(() => {
    for (const off of wsUnsubsRef.current) off();
    wsUnsubsRef.current = [];
    activeExportIdRef.current = null;
  }, []);

  // Ensure we never leak WS handlers if the component unmounts mid-export.
  useEffect(() => () => teardownWs(), [teardownWs]);

  const dims = useMemo(() => {
    const base =
      preset === 'custom'
        ? { w: project.canvas.width, h: project.canvas.height }
        : PRESETS[preset];
    const cap = resolution === '720p' ? 720 : 1080;
    const short = Math.min(base.w, base.h);
    if (short <= cap) return base;
    const scale = cap / short;
    return { w: Math.round(base.w * scale), h: Math.round(base.h * scale) };
  }, [preset, resolution, project.canvas.width, project.canvas.height]);

  const sizeMb = estimateSizeMb(dims.w, dims.h, fps, durationMs);
  const overCap = Math.min(project.canvas.width, project.canvas.height) > 1080;

  // Template empty-slot warning (Templates_Spec AC-7 / Templates_Architecture §5):
  // non-blocking — count unfilled media slots so the user knows they'll be dropped
  // from the export. Export stays ENABLED. `pruneUnfilledSlots` (lib/templates) removes
  // these placeholders from a clone of the doc before render so the graph stays valid.
  const unfilledSlots = useMemo(() => {
    const manifest = resolveManifest(project);
    return manifest ? unfilledMediaSlotCount(project, manifest) : 0;
  }, [project]);

  const handleExport = useCallback(async () => {
    setPhase('exporting');
    setProgress(0);
    setEtaSeconds(null);
    setErrorMsg(null);
    setDownloadUrl(null);
    setWarnings([]);
    abortRef.current = false;
    teardownWs();

    try {
      // WYCIWYG render-snapshot: send the EXACT document the preview used so the worker
      // renders precisely what's on screen. For a template-derived project we prune the
      // unfilled optional slots first (lib/templates) so the graph references only real,
      // resolvable media — a partially-filled template still produces a valid video. For a
      // normal project there's no manifest, so we send the current document unchanged.
      const manifest = resolveManifest(project);
      const document = manifest ? pruneUnfilledSlots(project, manifest) : project;

      const effectiveCaptions = hasCaptions ? captions : 'none';
      const rec = await apiCreateExport({
        projectId: project.id,
        settings: {
          format: 'mp4',
          videoCodec: 'h264',
          resolution: { w: dims.w, h: dims.h },
          fps,
          crf: 18,
          captions: effectiveCaptions,
          // Thread the chosen sidecar format so the worker writes the matching file
          // (.srt or .vtt) next to the MP4. Only meaningful for captions==='sidecar';
          // harmless extra field otherwise (the graph ignores it).
          ...(effectiveCaptions === 'sidecar' ? { sidecarFmt } : {}),
          watermark: true,
        },
        document,
      });

      // Surface proxy-downgrade warnings from the POST /exports response early.
      if (rec.warnings && rec.warnings.length > 0) setWarnings(rec.warnings);

      const exportId = rec.exportId;
      activeExportIdRef.current = exportId;

      // ── WebSocket push: resolves/rejects the terminal state, drives progress. ──
      const wsTerminal = new Promise<{ outputUrl: string | null }>((resolve, reject) => {
        const offProgress = wsClient.on('export:progress', (p) => {
          // Ignore events for any other export (stale-closure guard).
          if (p['exportId'] !== exportId || abortRef.current) return;
          const pct = Number(p['progress']);
          if (Number.isFinite(pct)) setProgress(Math.round(pct));
          const eta = p['etaSeconds'];
          setEtaSeconds(typeof eta === 'number' && Number.isFinite(eta) ? eta : null);
        });
        const offComplete = wsClient.on('export:complete', (p) => {
          if (p['exportId'] !== exportId || abortRef.current) return;
          // The complete event carries s3Key but not a signed URL; mint one below.
          resolve({ outputUrl: null });
        });
        const offFailed = wsClient.on('export:failed', (p) => {
          if (p['exportId'] !== exportId || abortRef.current) return;
          reject(new Error((p['message'] as string) ?? 'Export failed'));
        });
        wsUnsubsRef.current.push(offProgress, offComplete, offFailed);
      });

      // ── HTTP poll fallback: races the WS push; first terminal result wins. ──
      const pollTerminal = apiPollExportComplete(exportId, (pct) => {
        if (!abortRef.current) setProgress(pct);
      }).then((completed) => ({ outputUrl: completed.outputUrl }));

      const settled = await Promise.race([wsTerminal, pollTerminal]);

      // Stop listening once a terminal state is reached.
      teardownWs();

      if (abortRef.current) return;

      if (settled.outputUrl) {
        setDownloadUrl(settled.outputUrl);
        setPhase('done');
        return;
      }

      // Mint a fresh signed URL (WS complete path, or poll without outputUrl).
      const { downloadUrl: url } = await apiGetDownloadUrl(exportId);
      if (abortRef.current) return;
      setDownloadUrl(url);
      setPhase('done');
    } catch (err) {
      teardownWs();
      if (!abortRef.current) {
        // 429 = export rate-limit hit. Surface a friendly, non-failure state rather
        // than the generic red "Export failed" screen (the server allows 5/min).
        if (err instanceof ApiError && err.status === 429) {
          setPhase('ratelimited');
          return;
        }
        setErrorMsg(err instanceof Error ? err.message : String(err));
        setPhase('error');
      }
    }
  }, [project, dims, fps, captions, sidecarFmt, hasCaptions, teardownWs]);

  // Fire the TTFE (time-to-first-export) event + clear the first-session flag exactly
  // ONCE, on the first successful export's Download click (the brief's hook point).
  // Guarded so a second download click (fresh link) doesn't re-fire. trackEvent is a
  // dependency-free no-op until Anchor wires Sentry, so this is always safe.
  const ttfeFiredRef = useRef(false);
  const handleDownloadClick = useCallback(() => {
    if (!firstSession || ttfeFiredRef.current) return;
    ttfeFiredRef.current = true;
    const created = Date.parse(project.createdAt);
    const durationSinceCreateMs = Number.isFinite(created)
      ? Math.max(0, Date.now() - created)
      : null;
    trackEvent('ttfe:export_complete', {
      durationMs: durationSinceCreateMs, // ms from project create → first export
      projectId: project.id,
      aspectRatio: project.canvas.aspectRatio,
    });
    clearFirstSession();
  }, [firstSession, project.createdAt, project.id, project.canvas.aspectRatio]);

  const handleClose = () => {
    abortRef.current = true;
    teardownWs();
    setPhase('config');
    setProgress(0);
    setEtaSeconds(null);
    setWarnings([]);
    setDownloadUrl(null);
    setErrorMsg(null);
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title="Export video"
      widthClassName="max-w-[560px]"
      footer={
        phase === 'config' ? (
          <>
            <Button variant="ghost" onClick={handleClose}>Cancel</Button>
            <Button variant="primary" onClick={handleExport}>Export</Button>
          </>
        ) : phase === 'exporting' ? (
          <Button variant="ghost" onClick={handleClose}>Cancel</Button>
        ) : phase === 'done' ? (
          <>
            <Button variant="ghost" onClick={handleClose}>Close</Button>
            {downloadUrl && (
              <a
                href={downloadUrl}
                download="export.mp4"
                target="_blank"
                rel="noreferrer"
                onClick={handleDownloadClick}
                data-testid="download-mp4"
                className="inline-flex h-9 items-center justify-center gap-2 rounded-md bg-vf-accent px-3 text-sm font-medium text-vf-text-inverse hover:bg-vf-accent-hover"
              >
                Download MP4
              </a>
            )}
          </>
        ) : (
          <>
            <Button variant="ghost" onClick={handleClose}>Close</Button>
            <Button variant="primary" onClick={() => setPhase('config')}>Try again</Button>
          </>
        )
      }
    >
      {phase === 'exporting' && (
        <div className="flex flex-col items-center gap-4 py-8">
          <div className="h-2 w-full overflow-hidden rounded-full bg-vf-surface-3">
            <div
              className="h-full rounded-full bg-vf-accent transition-all duration-500"
              style={{ width: `${progress}%` }}
            />
          </div>
          <p className="text-sm text-vf-text-secondary" aria-live="polite">
            {progress > 0 ? `${progress}% — rendering…` : 'Queued, waiting for worker…'}
            {etaSeconds != null && etaSeconds > 0 && (
              <span className="ml-1 text-vf-text-tertiary vf-tnum">~{etaSeconds}s left</span>
            )}
          </p>
          {warnings.length > 0 && (
            <div className="flex w-full items-start gap-2 rounded-md border border-vf-warning-fg/40 bg-vf-surface-2 p-3 text-2xs text-vf-text-secondary">
              <span aria-hidden="true" className="text-vf-warning-fg">⚠</span>
              <div>
                {warnings.map((w, i) => (
                  <p key={i}>{w}</p>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {phase === 'done' && (
        <div className="flex flex-col items-center gap-3 py-8 text-center">
          <span aria-hidden="true" className="text-4xl text-vf-success-fg">✅</span>
          <p className="text-base font-medium text-vf-text-primary">Your export is ready</p>
          {/* Parity reveal (§6.5 / the invariant): state what just happened, at the exact
              moment the user holds the file and can verify it against the preview. */}
          <p className="max-w-sm text-sm text-vf-text-secondary">
            This MP4 was built from the same edit graph your preview used. Every trim, cut, and clip
            is exactly as you arranged it.
          </p>
          <p className="text-2xs text-vf-text-tertiary">
            Available for download for 7 days. Each click mints a fresh 1-hour link.
          </p>
          {warnings.length > 0 && (
            <div className="flex w-full items-start gap-2 rounded-md border border-vf-warning-fg/40 bg-vf-surface-2 p-3 text-left text-2xs text-vf-text-secondary">
              <span aria-hidden="true" className="text-vf-warning-fg">⚠</span>
              <div>
                {warnings.map((w, i) => (
                  <p key={i}>{w}</p>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {phase === 'error' && (
        <div className="flex flex-col items-center gap-3 py-8 text-center">
          <span aria-hidden="true" className="text-4xl">❌</span>
          <p className="text-base font-medium text-vf-danger-fg">Export failed</p>
          <p className="max-w-sm break-all text-sm text-vf-text-secondary">{errorMsg}</p>
        </div>
      )}

      {phase === 'ratelimited' && (
        // 429 rate-limit: a calm, recoverable info state (NOT the red failure screen).
        <div data-testid="export-ratelimited" className="flex flex-col items-center gap-3 py-8 text-center">
          <span aria-hidden="true" className="text-4xl text-vf-info-fg">⏳</span>
          <p className="text-base font-medium text-vf-text-primary">Hang on a moment</p>
          <p className="max-w-sm text-sm text-vf-text-secondary">
            You've hit the limit of 5 exports per minute. Give it a moment and try again — your edit
            is safe.
          </p>
        </div>
      )}

      {phase === 'config' && (
        <>
          {/* First-session watermark disclosure (§6.5): shown ONCE, before a creator's
              first export, so the watermark is never a surprise on the downloaded file. */}
          {firstSession && (
            <div
              data-testid="watermark-disclosure"
              className="mb-4 flex items-start gap-2 rounded-md border border-vf-info-fg/40 bg-vf-info-bg p-3 text-2xs text-vf-text-secondary"
            >
              <span aria-hidden="true" className="text-vf-info-fg">ⓘ</span>
              <span>
                Heads up: free-plan exports include a small VideoForge watermark in the
                bottom-right corner. Everything else is exactly as you arranged it.
              </span>
            </div>
          )}

          {/* Empty-slot warning (AC-7): non-blocking; Export stays enabled. */}
          {unfilledSlots > 0 && (
            <div
              data-testid="empty-slot-warning"
              className="mb-4 flex items-start gap-2 rounded-md border border-vf-warning-fg/40 bg-vf-surface-2 p-3 text-2xs text-vf-text-secondary"
            >
              <span aria-hidden="true" className="text-vf-warning-fg">⚠</span>
              <span>
                You have {unfilledSlots} unfilled {unfilledSlots === 1 ? 'slot' : 'slots'}. They'll be
                left out of the export so your video renders cleanly. You can still export now, or go
                back and add media.
              </span>
            </div>
          )}

          {/* Tabs */}
          <div role="tablist" aria-label="Export settings" className="mb-4 flex gap-1 border-b border-vf-border-subtle">
            {([['format', 'Format & Quality'], ['captions', 'Captions']] as Array<['format' | 'captions', string]>).map(
              ([key, label]) => (
                <button
                  key={key}
                  role="tab"
                  aria-selected={tab === key}
                  onClick={() => setTab(key)}
                  className={cx(
                    '-mb-px flex items-center gap-1 px-3 py-2 text-sm',
                    tab === key
                      ? 'border-b-2 border-vf-accent text-vf-text-primary'
                      : 'text-vf-text-secondary hover:text-vf-text-primary',
                  )}
                >
                  {label}
                  {key === 'captions' && hasCaptions && captions !== 'none' && (
                    <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-vf-accent" />
                  )}
                </button>
              ),
            )}
          </div>

          {tab === 'format' ? (
            <div className="flex flex-col gap-4">
              <fieldset>
                <legend className="mb-2 text-xs font-medium text-vf-text-secondary">Preset</legend>
                <div className="grid grid-cols-4 gap-2">
                  {(['9:16', '16:9', '1:1', 'custom'] as Preset[]).map((p) => {
                    const meta = p === 'custom' ? null : PRESETS[p];
                    return (
                      <button
                        key={p}
                        type="button"
                        aria-pressed={preset === p}
                        onClick={() => setPreset(p)}
                        className={cx(
                          'flex flex-col gap-0.5 rounded-md border p-3 text-left text-xs',
                          preset === p
                            ? 'border-vf-accent bg-vf-accent-subtle'
                            : 'border-vf-border-default bg-vf-surface-2 hover:border-vf-border-strong',
                        )}
                      >
                        <span className="font-medium text-vf-text-primary">{p === 'custom' ? '⚙ Custom' : p}</span>
                        <span className="text-2xs text-vf-text-tertiary">
                          {meta ? `${meta.label} · ${meta.w}×${meta.h}` : 'match project'}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </fieldset>

              <div className="flex items-center justify-between">
                <span className="text-xs text-vf-text-secondary">Format</span>
                <span className="text-xs text-vf-text-tertiary">MP4 · H.264</span>
              </div>

              <label className="flex items-center justify-between">
                <span className="text-xs text-vf-text-secondary">Resolution</span>
                <select
                  value={resolution}
                  onChange={(e) => setResolution(e.target.value as '720p' | '1080p')}
                  className="h-8 rounded-sm border border-vf-border-default bg-vf-surface-2 px-2 text-xs text-vf-text-primary"
                >
                  <option value="720p">720p</option>
                  <option value="1080p">1080p (max on your plan)</option>
                </select>
              </label>

              <label className="flex items-center justify-between">
                <span className="text-xs text-vf-text-secondary">Frame rate</span>
                <select
                  value={fps}
                  onChange={(e) => setFps(Number(e.target.value))}
                  className="h-8 rounded-sm border border-vf-border-default bg-vf-surface-2 px-2 text-xs text-vf-text-primary"
                >
                  {[24, 25, 30].map((f) => (
                    <option key={f} value={f}>{f} fps</option>
                  ))}
                </select>
              </label>

              <div className="flex items-start gap-2 rounded-md border border-vf-border-subtle bg-vf-surface-2 p-3 text-2xs text-vf-text-secondary">
                <span aria-hidden="true" className="text-vf-info-fg">ⓘ</span>
                <span>A small VideoForge watermark is added to exports on the free plan (bottom-right).</span>
              </div>

              {overCap && (
                <p className="text-2xs text-vf-text-tertiary">Canvas exceeds 1080p — export will be scaled down.</p>
              )}

              <div className="flex items-center justify-between rounded-md bg-vf-surface-sunken px-3 py-2 text-xs">
                <span className="text-vf-text-secondary">
                  Est. size <span className="vf-tnum text-vf-text-primary">~ {sizeMb} MB</span>
                </span>
                <span className="text-vf-text-secondary">
                  Est. time <span className="vf-tnum text-vf-text-primary">{estimateTimeLabel(durationMs)}</span>
                </span>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              <p className="text-sm text-vf-text-secondary">How should captions be exported?</p>
              {(['none', 'burn', 'sidecar'] as CaptionMode[]).map((val) => {
                const labels: Record<CaptionMode, [string, string]> = {
                  none: ['None', 'No captions in the output.'],
                  burn: ['Burned-in', 'Permanently drawn onto the video.'],
                  sidecar: ['Sidecar file', 'A separate .srt or .vtt download.'],
                };
                const [label, desc] = labels[val];
                const disabled = val !== 'none' && !hasCaptions;
                return (
                  <label
                    key={val}
                    className={cx(
                      'flex items-start gap-2 rounded-md border p-3',
                      captions === val ? 'border-vf-accent' : 'border-vf-border-subtle',
                      disabled ? 'opacity-50' : 'cursor-pointer hover:border-vf-border-strong',
                    )}
                  >
                    <input
                      type="radio"
                      name="captions"
                      checked={captions === val}
                      disabled={disabled}
                      onChange={() => setCaptions(val)}
                      className="mt-0.5 accent-vf-accent"
                    />
                    <div>
                      <div className="text-sm text-vf-text-primary">{label}</div>
                      <div className="text-2xs text-vf-text-tertiary">{desc}</div>
                      {val === 'sidecar' && captions === 'sidecar' && (
                        <select
                          value={sidecarFmt}
                          onChange={(e) => setSidecarFmt(e.target.value as '.srt' | '.vtt')}
                          className="mt-2 h-7 rounded-sm border border-vf-border-default bg-vf-surface-2 px-2 text-2xs"
                        >
                          <option value=".srt">.srt</option>
                          <option value=".vtt">.vtt</option>
                        </select>
                      )}
                    </div>
                  </label>
                );
              })}
            </div>
          )}
        </>
      )}
    </Modal>
  );
}
