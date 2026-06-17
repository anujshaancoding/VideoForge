import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Sparkles, Music, Mic, Image as ImageIcon, Video, Info, Pencil } from 'lucide-react';
import { Button } from '../components/ui/index.js';
import { cx } from '../components/ui/cx.js';
import { wsClient } from '../lib/wsClient.js';
import {
  planScript,
  generateScript,
  VOICE_OPTIONS,
  DEFAULT_VOICE_ID,
  SKETCH_STYLE_OPTIONS,
  DEFAULT_SKETCH_STYLE,
  type SketchStyle,
  type ScenePlan,
  type PlannedScene,
  type PlanSource,
} from '../lib/scriptStudio.js';
import { ApiError } from '../lib/api.js';

// Script Studio v2 (Contract D) — paste a script → review the scene plan it needs →
// generate a real timeline → open it in the existing editor → auto-arrange your own
// footage. This route owns steps 1–3 (paste / plan-review / generate); the editor
// handoff (step 4) and Auto-arrange (step 5) live in the editor via AutoArrangeModal.
//
// Brand: dark-first; amber (#FF7A1A) is reserved for the Export CTA, so the primary
// action here ("Generate video") is the sky-blue selection accent, NOT amber.

type Step = 'paste' | 'review' | 'generating';

const MAX_SCRIPT_CHARS = 12_000; // bounded input → CPU-capped plan (≤40 scenes)
const WPM = 130;

function estDurationLabel(wordCount: number): string {
  const sec = Math.round((wordCount / WPM) * 60);
  if (sec < 60) return `~${sec}s`;
  return `~${Math.floor(sec / 60)}m ${sec % 60}s`;
}

// ── Per-scene editable row in the plan review ───────────────────────────────────
function SceneRow({
  index,
  scene,
  onChange,
}: {
  index: number;
  scene: PlannedScene;
  onChange: (patch: Partial<PlannedScene>) => void;
}) {
  const broll = scene.brollSuggestion;
  const MediaIcon = broll.mediaType === 'photo' ? ImageIcon : Video;
  const bigCaptionText = scene.bigCaptionWords.join(' ');

  return (
    <li
      data-testid="scene-row"
      className="rounded-lg border border-vf-border-subtle bg-vf-surface-1 p-4"
    >
      <div className="mb-3 flex items-center justify-between">
        <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-pill bg-vf-surface-3 px-2 text-2xs font-semibold text-vf-text-secondary">
          Scene {index + 1}
        </span>
        <span className="text-2xs text-vf-text-tertiary vf-tnum">
          {estDurationLabel(scene.voiceoverText.split(/\s+/).filter(Boolean).length)}
        </span>
      </div>

      {/* Voiceover (editable) */}
      <label className="mb-1 flex items-center gap-1 text-2xs font-medium uppercase tracking-wider text-vf-text-tertiary">
        <Mic className="h-3 w-3" aria-hidden="true" /> Voiceover
      </label>
      <textarea
        value={scene.voiceoverText}
        maxLength={600}
        onChange={(e) => onChange({ voiceoverText: e.target.value })}
        aria-label={`Voiceover for scene ${index + 1}`}
        data-testid="scene-voiceover"
        className="mb-3 min-h-[60px] w-full resize-y rounded-md border border-vf-border-default bg-vf-surface-2 p-2 text-sm text-vf-text-primary placeholder:text-vf-text-tertiary focus:border-vf-selection focus:outline-none"
      />

      {/* The b-roll this scene needs — a SHOT BRIEF (named, not fetched). */}
      <div className="mb-3 rounded-md border border-vf-border-subtle bg-vf-surface-2 p-3">
        <div className="mb-1 flex items-center gap-1.5 text-2xs font-medium uppercase tracking-wider text-vf-text-tertiary">
          <MediaIcon className="h-3.5 w-3.5" aria-hidden="true" />
          Shot you need · {broll.mediaType}
        </div>
        <p className="text-sm text-vf-text-primary">{broll.description}</p>
        {broll.keywords.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {broll.keywords.map((kw, k) => (
              <span
                key={k}
                className="rounded-pill border border-vf-border-subtle bg-vf-surface-1 px-2 py-0.5 text-2xs text-vf-text-secondary"
              >
                {kw}
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {/* Small caption (editable) */}
        <div>
          <label className="mb-1 block text-2xs font-medium uppercase tracking-wider text-vf-text-tertiary">
            Small caption
          </label>
          <input
            type="text"
            value={scene.smallCaption}
            maxLength={80}
            onChange={(e) => onChange({ smallCaption: e.target.value })}
            aria-label={`Small caption for scene ${index + 1}`}
            data-testid="scene-small-caption"
            className="w-full rounded-md border border-vf-border-default bg-vf-surface-2 p-2 text-sm text-vf-text-primary focus:border-vf-selection focus:outline-none"
          />
        </div>

        {/* Big caption words (editable as a space-separated string) */}
        <div>
          <label className="mb-1 block text-2xs font-medium uppercase tracking-wider text-vf-text-tertiary">
            Big caption (word-by-word)
          </label>
          <input
            type="text"
            value={bigCaptionText}
            onChange={(e) =>
              onChange({
                bigCaptionWords: e.target.value.split(/\s+/).filter(Boolean).slice(0, 60),
              })
            }
            aria-label={`Big caption for scene ${index + 1}`}
            data-testid="scene-big-caption"
            className="w-full rounded-md border border-vf-border-default bg-vf-surface-2 p-2 text-sm text-vf-text-primary focus:border-vf-selection focus:outline-none"
          />
        </div>
      </div>
    </li>
  );
}

export default function ScriptStudio() {
  const navigate = useNavigate();

  const [step, setStep] = useState<Step>('paste');
  const [script, setScript] = useState('');
  const [voiceId, setVoiceId] = useState(DEFAULT_VOICE_ID);
  const [title, setTitle] = useState('');
  const [withMusic, setWithMusic] = useState(true);
  const [sketchStyle, setSketchStyle] = useState<SketchStyle>(DEFAULT_SKETCH_STYLE);

  const [plan, setPlan] = useState<ScenePlan | null>(null);
  const [planSource, setPlanSource] = useState<PlanSource | null>(null);

  const [planning, setPlanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [genProgress, setGenProgress] = useState<number | null>(null);

  // WS subscription cleanup for the generate step (mirrors ExportModal's pattern).
  const wsUnsubsRef = useRef<Array<() => void>>([]);
  const teardownWs = useCallback(() => {
    for (const off of wsUnsubsRef.current) off();
    wsUnsubsRef.current = [];
  }, []);
  useEffect(() => {
    wsClient.connect();
    return () => {
      teardownWs();
      wsClient.disconnect();
    };
  }, [teardownWs]);

  const wordCount = useMemo(() => script.split(/\s+/).filter(Boolean).length, [script]);
  const canPlan = wordCount > 0 && !planning;

  // ── Step 1 → 2: plan the script ───────────────────────────────────────────────
  const handlePlan = useCallback(async () => {
    if (!canPlan) return;
    setPlanning(true);
    setError(null);
    try {
      const res = await planScript({ script: script.trim(), voiceId });
      setPlan(res.plan);
      setPlanSource(res.source);
      setStep('review');
    } catch (err) {
      setError(
        err instanceof ApiError
          ? `Couldn't plan the script (${err.status}). Try again.`
          : "Couldn't plan the script. Check your connection and try again.",
      );
    } finally {
      setPlanning(false);
    }
  }, [canPlan, script, voiceId]);

  const updateScene = useCallback((index: number, patch: Partial<PlannedScene>) => {
    setPlan((prev) => {
      if (!prev) return prev;
      const scenes = prev.scenes.map((s, i) => (i === index ? { ...s, ...patch } : s));
      return { scenes };
    });
  }, []);

  // ── Step 2 → 3: generate → open the project in the existing editor ────────────
  const handleGenerate = useCallback(async () => {
    if (!plan) return;
    setStep('generating');
    setGenProgress(0);
    setError(null);
    teardownWs();

    // Listen for the BullMQ `script` job progress/complete (long scripts run async).
    // Inline responses (≤ ~8 scenes) resolve via the HTTP call below; whichever
    // yields a projectId first wins (same race shape as ExportModal).
    const wsComplete = new Promise<string | null>((resolve) => {
      const offProgress = wsClient.on('script:progress', (p) => {
        const pct = Number(p['progress']);
        if (Number.isFinite(pct)) setGenProgress(Math.round(pct));
      });
      const offComplete = wsClient.on('script:complete', (p) => {
        const pid = typeof p['projectId'] === 'string' ? (p['projectId'] as string) : null;
        resolve(pid);
      });
      wsUnsubsRef.current.push(offProgress, offComplete);
    });

    try {
      const http = await generateScript({
        title: title.trim() || 'Script video',
        plan,
        voiceId,
        withMusic,
        sketchStyle,
      });
      // Inline (201) returns the projectId directly; the queued (202) path — long
      // scripts, or ANY sketch run — returns no projectId, so the id arrives via the
      // WS `script:complete` event instead.
      const projectId = http.projectId ?? (await wsComplete);
      teardownWs();
      if (!projectId) throw new Error('Generation finished without a project id.');

      // Hand off to the existing editor. The Auto-arrange affordance is surfaced
      // there via the ?arrange=1 flag so the user can upload + slot their footage.
      navigate(`/editor/${projectId}?arrange=1`);
    } catch (err) {
      teardownWs();
      setStep('review');
      setGenProgress(null);
      setError(
        err instanceof ApiError
          ? `Generation failed (${err.status}). Your plan is safe — try again.`
          : err instanceof Error
            ? err.message
            : 'Generation failed. Try again.',
      );
    }
  }, [plan, title, voiceId, withMusic, sketchStyle, navigate, teardownWs]);

  // ── Render ────────────────────────────────────────────────────────────────────
  return (
    <div className="flex min-h-full flex-col bg-vf-bg-app">
      {/* Header — matches the dashboard/editor top bar for continuity. */}
      <header className="flex h-topbar shrink-0 items-center gap-3 border-b border-vf-border-subtle bg-vf-surface-1 px-6">
        <button
          type="button"
          aria-label="Back to dashboard"
          onClick={() => navigate('/')}
          className="inline-flex h-8 w-8 items-center justify-center rounded-sm text-vf-icon-muted hover:bg-vf-surface-3 hover:text-vf-text-primary"
        >
          <ArrowLeft className="h-5 w-5" aria-hidden="true" />
        </button>
        <Sparkles className="h-5 w-5 text-vf-selection" aria-hidden="true" />
        <span className="text-md font-bold tracking-tight text-vf-text-primary">Script Studio</span>
      </header>

      <main className="mx-auto w-full max-w-[760px] flex-1 px-6 py-8">
        {error && (
          <div
            role="alert"
            data-testid="script-error"
            className="mb-4 rounded-md border border-vf-danger-fg/50 bg-vf-surface-2 p-3 text-sm text-vf-danger-fg"
          >
            {error}
          </div>
        )}

        {/* ── Step 1 — Paste & plan ── */}
        {step === 'paste' && (
          <section aria-labelledby="paste-heading" className="flex flex-col gap-5">
            <div>
              <h1 id="paste-heading" className="text-2xl font-bold text-vf-text-primary">
                Paste your script
              </h1>
              <p className="mt-2 text-sm text-vf-text-secondary">
                We'll break it into scenes, draw a sketch for each, voice it, and sync the
                drawings to the narration — into a fully editable video.
              </p>
            </div>

            <div>
              <textarea
                value={script}
                maxLength={MAX_SCRIPT_CHARS}
                onChange={(e) => setScript(e.target.value)}
                placeholder="Paste or write your video script here…"
                aria-label="Video script"
                data-testid="script-input"
                className="min-h-[260px] w-full resize-y rounded-lg border border-vf-border-default bg-vf-surface-1 p-4 text-sm leading-relaxed text-vf-text-primary placeholder:text-vf-text-tertiary focus:border-vf-selection focus:outline-none"
              />
              <div className="mt-1 flex items-center justify-between text-2xs text-vf-text-tertiary">
                <span className="vf-tnum">{wordCount} words</span>
                <span className="vf-tnum">{estDurationLabel(wordCount)} of voiceover</span>
              </div>
            </div>

            {/* Voice picker */}
            <fieldset>
              <legend className="mb-2 text-xs font-medium text-vf-text-secondary">Voice</legend>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {VOICE_OPTIONS.map((v) => (
                  <button
                    key={v.id}
                    type="button"
                    aria-pressed={voiceId === v.id}
                    data-testid={`voice-${v.id}`}
                    onClick={() => setVoiceId(v.id)}
                    className={cx(
                      'flex flex-col gap-0.5 rounded-md border p-3 text-left text-xs transition-colors',
                      voiceId === v.id
                        ? 'border-vf-selection bg-vf-selection/15'
                        : 'border-vf-border-default bg-vf-surface-2 hover:border-vf-border-strong',
                    )}
                  >
                    <span className="font-medium text-vf-text-primary">{v.label}</span>
                    <span className="text-2xs text-vf-text-tertiary">{v.hint}</span>
                  </button>
                ))}
              </div>
            </fieldset>

            <div className="flex items-center justify-end">
              <Button
                variant="primary"
                size="lg"
                className="bg-vf-selection text-white hover:bg-vf-selection/90 active:bg-vf-selection"
                onClick={handlePlan}
                disabled={!canPlan}
                data-testid="plan-btn"
              >
                {planning ? 'Planning…' : 'Plan scenes →'}
              </Button>
            </div>
          </section>
        )}

        {/* ── Step 2 — Plan review ── */}
        {step === 'review' && plan && (
          <section aria-labelledby="review-heading" className="flex flex-col gap-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h1 id="review-heading" className="text-2xl font-bold text-vf-text-primary">
                  Review the scene plan
                </h1>
                <p className="mt-1 text-sm text-vf-text-secondary">
                  {plan.scenes.length} {plan.scenes.length === 1 ? 'scene' : 'scenes'}. Edit any text
                  before generating — no footage exists yet.
                </p>
              </div>
              {/* "draft plan" badge when the heuristic fallback produced this (no API key). */}
              {planSource === 'heuristic' && (
                <span
                  data-testid="draft-plan-badge"
                  className="inline-flex shrink-0 items-center gap-1 rounded-pill border border-vf-warning-fg/50 bg-vf-surface-2 px-2.5 py-1 text-2xs font-medium text-vf-warning-fg"
                  title="Generated without an AI key — a quick draft you can edit."
                >
                  <Info className="h-3 w-3" aria-hidden="true" /> Draft plan
                </span>
              )}
            </div>

            <ul className="flex flex-col gap-3">
              {plan.scenes.map((scene, i) => (
                <SceneRow
                  key={i}
                  index={i}
                  scene={scene}
                  onChange={(patch) => updateScene(i, patch)}
                />
              ))}
            </ul>

            {/* Project options: title + background music toggle. */}
            <div className="flex flex-col gap-3 rounded-lg border border-vf-border-subtle bg-vf-surface-1 p-4">
              <label className="flex flex-col gap-1">
                <span className="text-xs font-medium text-vf-text-secondary">Project name (optional)</span>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Script video"
                  data-testid="script-title"
                  className="w-full rounded-md border border-vf-border-default bg-vf-surface-2 p-2 text-sm text-vf-text-primary placeholder:text-vf-text-tertiary focus:border-vf-selection focus:outline-none"
                />
              </label>

              {/* Sketch visuals — auto-illustrate each scene at $0 (Draw Things → filter). */}
              <fieldset>
                <legend className="mb-2 flex items-center gap-1.5 text-xs font-medium text-vf-text-secondary">
                  <Pencil className="h-3.5 w-3.5 text-vf-text-tertiary" aria-hidden="true" />
                  Sketch visuals
                  <span className="text-2xs text-vf-text-tertiary">(one drawing per scene, synced to the voice)</span>
                </legend>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {SKETCH_STYLE_OPTIONS.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      aria-pressed={sketchStyle === s.id}
                      data-testid={`sketch-${s.id}`}
                      onClick={() => setSketchStyle(s.id)}
                      className={cx(
                        'flex flex-col gap-0.5 rounded-md border p-3 text-left text-xs transition-colors',
                        sketchStyle === s.id
                          ? 'border-vf-selection bg-vf-selection/15'
                          : 'border-vf-border-default bg-vf-surface-2 hover:border-vf-border-strong',
                      )}
                    >
                      <span className="font-medium text-vf-text-primary">{s.label}</span>
                      <span className="text-2xs text-vf-text-tertiary">{s.hint}</span>
                    </button>
                  ))}
                </div>
              </fieldset>

              <label className="flex cursor-pointer items-center justify-between gap-3">
                <span className="flex items-center gap-2 text-sm text-vf-text-primary">
                  <Music className="h-4 w-4 text-vf-text-tertiary" aria-hidden="true" />
                  Background music
                  <span className="text-2xs text-vf-text-tertiary">(auto-ducked under the voice)</span>
                </span>
                <input
                  type="checkbox"
                  checked={withMusic}
                  onChange={(e) => setWithMusic(e.target.checked)}
                  data-testid="music-toggle"
                  className="h-4 w-4 accent-vf-selection"
                />
              </label>
            </div>

            <div className="flex items-center justify-between">
              <Button variant="ghost" onClick={() => setStep('paste')}>
                ← Back to script
              </Button>
              <Button
                variant="primary"
                size="lg"
                className="bg-vf-selection text-white hover:bg-vf-selection/90 active:bg-vf-selection"
                onClick={handleGenerate}
                data-testid="generate-btn"
              >
                Generate video →
              </Button>
            </div>
          </section>
        )}

        {/* ── Step 3 — Generating ── */}
        {step === 'generating' && (
          <section
            role="status"
            aria-live="polite"
            className="flex flex-col items-center gap-5 py-24 text-center"
          >
            <Sparkles className="h-10 w-10 animate-pulse text-vf-selection" aria-hidden="true" />
            <h1 className="text-xl font-bold text-vf-text-primary">Building your timeline…</h1>
            <p className="max-w-sm text-sm text-vf-text-secondary">
              Synthesizing the voiceover{sketchStyle !== 'none' ? ', drawing each scene' : ''}, timing
              the captions to the words, and laying it all to the voice. This opens in the editor
              automatically.
            </p>
            <div className="h-2 w-full max-w-sm overflow-hidden rounded-full bg-vf-surface-3">
              <div
                className="h-full rounded-full bg-vf-selection transition-all duration-500"
                style={{ width: `${genProgress ?? 8}%` }}
              />
            </div>
            {genProgress != null && genProgress > 0 && (
              <span className="text-2xs text-vf-text-tertiary vf-tnum">{genProgress}%</span>
            )}
          </section>
        )}
      </main>
    </div>
  );
}
