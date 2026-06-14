import { useMemo, useRef } from "react";
import {
  selectClip,
  useEditorStore,
  MIN_CLIP_SPEED,
  MAX_CLIP_SPEED,
  type ColorGrade,
  type KenBurns,
} from "../../store/editorStore.js";
import { parseCaptions } from "../../lib/captions.js";
import type {
  CaptionBlock,
  Clip,
  OverlayClip,
  Project,
  TextOverlay,
  Track,
} from "@videoforge/project-schema";
import { msToTimecode } from "@videoforge/project-schema";
import { Button, cx, Slider, Tooltip } from "../ui/index.js";
import { resolveManifest } from "../../store/templateStore.js";
import TemplateSlotPanel from "./TemplateSlotPanel.js";
import { Music, Video, Type, Trash2, Copy, MousePointer2 } from "lucide-react";

// Inspector — right context panel (§7.B). Content swaps by selection:
//   • media video clip → Properties (transform + speed) + Color + Keyframes + Ken Burns
//   • media audio clip → volume / pan / fades + Animate ◇
//   • text overlay     → font / size / color / outline + transform + Animate ◇
//   • caption block    → Caption Editor table (#/start/end/text inline)
//   • nothing          → empty state ("Select a clip to edit its properties.")
//
// M4: color grade, keyframe add/remove, Ken Burns toggle are fully wired to the store.

export default function Inspector() {
  const selection = useEditorStore((s) => s.selection);
  const project = useEditorStore((s) => s.project);
  const deleteSelected = useEditorStore((s) => s.deleteSelected);
  const duplicateSelected = useEditorStore((s) => s.duplicateSelected);

  const clip = useEditorStore((s) =>
    selection.kind === "clip" && selection.id ? selectClip(s, selection.id) : null,
  );

  const { overlay, overlayTrack } = useMemo(() => {
    if (selection.kind !== "overlay" || !selection.id) return { overlay: null, overlayTrack: null };
    for (const t of project.tracks) {
      if (t.type !== "overlay") continue;
      const ov = t.clips.find((c) => c.id === selection.id);
      if (ov) return { overlay: ov, overlayTrack: t };
    }
    return { overlay: null, overlayTrack: null };
  }, [selection, project]);

  const clipTrack = useMemo<Track | null>(() => {
    if (!clip) return null;
    return project.tracks.find((t) => t.id === clip.trackId) ?? null;
  }, [clip, project]);

  // Template-derived project → resolve its (rewritten) manifest so the slot-fill panel
  // is available. null for ordinary (non-template) projects.
  const manifest = resolveManifest(project);

  // Empty state (§7.B.0): nothing selected. For template projects, surface the
  // guided slot-fill panel here (Templates_Design §2); otherwise the plain prompt.
  if (!selection.id || selection.kind === null) {
    if (manifest) {
      return (
        <aside
          role="complementary"
          aria-label="Inspector"
          className="flex h-full min-h-0 flex-col overflow-y-auto bg-vf-surface-1 p-4"
        >
          <TemplateSlotPanel manifest={manifest} />
        </aside>
      );
    }
    return (
      <aside
        role="complementary"
        aria-label="Inspector"
        className="flex h-full min-h-0 flex-col bg-vf-surface-1"
      >
        <div className="flex shrink-0 flex-col items-center gap-2 border-b border-vf-border-subtle px-6 py-6 text-center">
          <MousePointer2 className="h-8 w-8 text-vf-text-disabled" aria-hidden="true" />
          <p className="text-sm text-vf-text-tertiary">Select a clip to edit its properties.</p>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <CanvasInspector />
        </div>
      </aside>
    );
  }

  const header = (icon: React.ReactNode, name: string, sub: string) => (
    <div className="flex shrink-0 items-center gap-2 border-b border-vf-border-subtle px-4 py-3">
      <span aria-hidden="true" className="text-vf-text-secondary">{icon}</span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-vf-text-primary">{name}</div>
        <div className="truncate text-2xs text-vf-text-tertiary">{sub}</div>
      </div>
      <Tooltip label="Delete">
        <Button
          variant="ghost"
          size="sm"
          aria-label="Delete selected"
          onClick={deleteSelected}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </Tooltip>
      <Tooltip label="Duplicate">
        <Button
          variant="ghost"
          size="sm"
          aria-label="Duplicate selected"
          onClick={duplicateSelected}
        >
          <Copy className="h-4 w-4" />
        </Button>
      </Tooltip>
    </div>
  );

  // Caption selection → Caption Editor table (§7.C).
  if (selection.kind === "caption") {
    return (
      <aside role="complementary" aria-label="Caption editor" className="flex h-full min-h-0 flex-col bg-vf-surface-1">
        <CaptionEditor selectedId={selection.id} />
      </aside>
    );
  }

  return (
    <aside role="complementary" aria-label="Inspector" className="flex h-full min-h-0 flex-col bg-vf-surface-1">
      {selection.kind === "clip" && clip ? (
        clipTrack && (clipTrack.type === "audio" || clipTrack.type === "voiceover") ? (
          <>
            {header(<Music className="h-4 w-4" />, `audio ${clip.id.slice(0, 6)}`, clipTrack.name)}
            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              <AudioInspector clip={clip} track={clipTrack} />
            </div>
          </>
        ) : (
          <>
            {(() => {
              // If this clip is the target of a template slot, surface that in the header for clarity
              // ("this clip is filling the 'Moment 1' slot").
              let sub = clipTrack?.name ?? '';
              if (manifest) {
                const slotForClip = manifest.slots.find(s => s.target.type === 'clip' && s.target.clipId === clip.id);
                if (slotForClip) {
                  sub = `Slot: ${slotForClip.label} • ${sub}`.trim();
                }
              }
              return header(<Video className="h-4 w-4" />, `clip ${clip.id.slice(0, 6)}`, sub);
            })()}
            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              <VideoClipInspector clip={clip} />
            </div>
          </>
        )
      ) : selection.kind === "overlay" && overlay ? (
        <>
          {header(<Type className="h-4 w-4" />, overlay.kind === "text" ? `"${(overlay as TextOverlay).text}"` : overlay.kind, overlayTrack?.name ?? "")}
          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            <OverlayInspector overlay={overlay} />
          </div>
        </>
      ) : selection.kind === "track" ? (
        <TrackInspector trackId={selection.id} project={project} />
      ) : (
        <div className="flex flex-1 items-center justify-center p-6 text-center text-sm text-vf-text-tertiary">
          Selected a {selection.kind}; no inspector for this type yet.
        </div>
      )}
    </aside>
  );
}

// ── Reusable section + property-row primitives ───────────────────────────────────
function Section({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section className="mb-5">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-2xs font-semibold uppercase tracking-wide text-vf-text-tertiary">{title}</h3>
        {action}
      </div>
      <div className="flex flex-col gap-2">{children}</div>
    </section>
  );
}

// ── Canvas inspector (empty-selection / project-level) ───────────────────────────
// Background-color control. `canvas.backgroundColor` is rendered IDENTICALLY in the
// preview (PreviewEngine fillRect + pad color) and the export (buildFilterComplex
// `color=` base + per-clip `pad=...:color=`), so editing it here stays invariant-safe
// (preview == export). There is no dedicated store action for the canvas field, so we
// patch it via setState with an immer recipe — the same direct-mutation pattern the
// CanvasStage inline text editor already uses (kept undo-history-free intentionally,
// like that editor; a first-class setCanvasBackground action is a store-owner change).
function CanvasInspector() {
  const bgColor = useEditorStore((s) => s.project.canvas.backgroundColor) || "#111111";
  const aspectRatio = useEditorStore((s) => s.project.canvas.aspectRatio);
  const setBg = (hex: string) =>
    useEditorStore.setState((s) => {
      s.project.canvas.backgroundColor = hex;
    });

  return (
    <Section title="Canvas">
      <div className="flex items-center gap-2">
        <label className="w-24 shrink-0 text-xs text-vf-text-secondary" htmlFor="canvas-bg-color">
          Background
        </label>
        <input
          id="canvas-bg-color"
          type="color"
          value={bgColor}
          aria-label="Canvas background color"
          onChange={(e) => setBg(e.target.value)}
          className="h-7 w-10 cursor-pointer rounded-sm border border-vf-border-default bg-vf-surface-2"
        />
        <span className="text-xs text-vf-text-primary vf-tnum">{bgColor}</span>
      </div>
      <p className="text-2xs text-vf-text-tertiary">
        ⓘ Fills letterbox/pillarbox bars + gaps. Renders identically in preview and export ({aspectRatio}).
      </p>
    </Section>
  );
}

// ── Video clip inspector (Properties · Color · Keyframes · Ken Burns) ─────────────
function VideoClipInspector({ clip }: { clip: Clip }) {
  const setClipColorGrade = useEditorStore((s) => s.setClipColorGrade);
  const setClipOpacity = useEditorStore((s) => s.setClipOpacity);
  const setClipTransform = useEditorStore((s) => s.setClipTransform);
  const setClipSpeed = useEditorStore((s) => s.setClipSpeed);
  const addKeyframe = useEditorStore((s) => s.addKeyframe);
  const removeKeyframe = useEditorStore((s) => s.removeKeyframe);
  const setClipKenBurns = useEditorStore((s) => s.setClipKenBurns);
  const setPlayhead = useEditorStore((s) => s.setPlayhead);
  // Not subscribed — read on demand in handlers so the whole Inspector doesn't
  // re-render on every playhead tick during playback / scrub.

  // Color grade: prefer the first-class field, fall back to a legacy effects entry.
  const cgEffect = clip.effects.find((e) => e.type === "colorGrade" && e.enabled)?.params;
  const numFromEffect = (k: string): number =>
    typeof cgEffect?.[k] === "number" ? (cgEffect[k] as number) : 0;
  const grade: ColorGrade = clip.colorGrade ?? {
    brightness: numFromEffect("brightness"),
    contrast: numFromEffect("contrast"),
    saturation: numFromEffect("saturation"),
  };

  const kenBurns: KenBurns | null | undefined = clip.kenBurns;

  // Keyframe arrays for opacity and scale.
  const opacityKfs = clip.keyframes["opacity"] ?? [];
  const scaleKfs = clip.keyframes["scale"] ?? [];

  /** Format milliseconds as M:SS.mmm */
  const fmtMs = (totalMs: number): string => {
    const totalSec = Math.floor(totalMs / 1000);
    const frac = totalMs % 1000;
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    return `${m}:${String(s).padStart(2, "0")}.${String(frac).padStart(3, "0")}`;
  };

  const onGradeChange = (key: keyof ColorGrade, val: number) => {
    setClipColorGrade(clip.id, clip.trackId, { ...grade, [key]: val });
  };

  const onResetGrade = () => {
    setClipColorGrade(clip.id, clip.trackId, { brightness: 0, contrast: 0, saturation: 0 });
  };

  const onAddKeyframe = (property: string, value: number) => {
    addKeyframe(clip.id, clip.trackId, useEditorStore.getState().playheadMs, property, value);
  };

  const onRemoveKeyframe = (kfId: string) => {
    removeKeyframe(clip.id, clip.trackId, kfId);
  };

  // On-canvas transform box (percent of canvas, x/y top-left, w/h size). ABSENT means
  // the clip fills the frame — surface that as the full-frame default so the numeric
  // fields read sensibly, EXACTLY mirroring CanvasStage's FULL_FRAME drag default and
  // the export's clipBox (no transform → fill). Editing any field writes the WHOLE
  // ClipTransform via the existing setClipTransform action — the same field the preview
  // and the FFmpeg export both consume, so the numbers stay WYSIWYG (preview == export).
  const tf = clip.transform ?? { x: 0, y: 0, width: 100, height: 100 };
  const onTransformChange = (key: "x" | "y" | "width" | "height", raw: number) => {
    const v = Number.isFinite(raw) ? Math.round(Math.max(0, Math.min(100, raw)) * 100) / 100 : 0;
    setClipTransform(clip.id, clip.trackId, { ...tf, [key]: v });
  };

  const onToggleKenBurns = () => {
    setClipKenBurns(
      clip.id,
      clip.trackId,
      kenBurns ? null : { startScale: 1.0, endScale: 1.5 },
    );
  };

  // Current opacity/scale: first keyframe value or sensible default.
  const currentOpacity =
    opacityKfs.length > 0 && typeof opacityKfs[0]!.value === "number"
      ? (opacityKfs[0]!.value as number)
      : 100;
  const currentScale =
    scaleKfs.length > 0 && typeof scaleKfs[0]!.value === "number"
      ? (scaleKfs[0]!.value as number)
      : 100;

  return (
    <>
      <Section title="Transform">
        {/* Numeric X/Y/W/H (percent of canvas, 0–100) — the same percent model the
            on-canvas drag box uses. Bound to setClipTransform; preview and export both
            honour clip.transform, so typed values are WYSIWYG. Mirrors the overlay
            position-input pattern, just with the full x/y/w/h box. */}
        <div className="grid grid-cols-2 gap-2">
          {([
            ["x", "X"],
            ["y", "Y"],
            ["width", "W"],
            ["height", "H"],
          ] as Array<["x" | "y" | "width" | "height", string]>).map(([key, label]) => (
            <div key={key} className="flex items-center gap-2">
              <label
                className="w-6 shrink-0 text-xs text-vf-text-secondary"
                htmlFor={`clip-tf-${key}`}
              >
                {label}
              </label>
              <input
                id={`clip-tf-${key}`}
                type="number"
                min={0}
                max={100}
                step={1}
                value={Math.round((tf[key] ?? 0) * 100) / 100}
                aria-label={`Transform ${label}`}
                onChange={(e) => onTransformChange(key, Number(e.target.value))}
                className="h-7 w-full rounded-sm border border-vf-border-default bg-vf-surface-2 px-2 text-xs text-vf-text-primary vf-tnum"
              />
              <span className="text-2xs text-vf-text-tertiary">%</span>
            </div>
          ))}
        </div>
        <Slider
          label="Opacity"
          value={currentOpacity}
          min={0}
          max={100}
          valueLabel={`${currentOpacity}%`}
          onChange={(v) => setClipOpacity(clip.id, clip.trackId, v)}
        />
        <p className="text-2xs text-vf-text-tertiary">
          ⓘ X/Y/W/H are percent of canvas (same as dragging on the canvas). Pan/zoom is via
          Ken Burns; scale/opacity animate via Keyframes below.
        </p>
      </Section>

      <Section title="Timing">
        {/* Speed: editable 0.1×–16× (writes clip.speed — the same field the export
            graph's setpts/atempo consume, so preview and export stay in lockstep). */}
        <Slider
          label="Speed"
          value={clip.speed}
          min={MIN_CLIP_SPEED}
          max={MAX_CLIP_SPEED}
          step={0.05}
          valueLabel={`${clip.speed.toFixed(2)}×`}
          onChange={(v) => setClipSpeed(clip.id, clip.trackId, v)}
        />
        <div className="flex items-center gap-2">
          <label className="w-24 shrink-0 text-xs text-vf-text-secondary" htmlFor="clip-speed-input">
            Exact
          </label>
          <input
            id="clip-speed-input"
            type="number"
            min={MIN_CLIP_SPEED}
            max={MAX_CLIP_SPEED}
            step={0.05}
            value={clip.speed}
            aria-label="Clip speed"
            onChange={(e) => setClipSpeed(clip.id, clip.trackId, Number(e.target.value))}
            className="h-7 w-20 rounded-sm border border-vf-border-default bg-vf-surface-2 px-2 text-xs text-vf-text-primary vf-tnum"
          />
          <span className="text-2xs text-vf-text-tertiary">×</span>
        </div>
        <p className="text-2xs text-vf-text-tertiary">ⓘ Audio pitch preserved on export.</p>
      </Section>

      {/* ── Color (M4: fully wired to setClipColorGrade) ── */}
      <Section
        title="Color"
        action={
          <button
            type="button"
            className="text-2xs text-vf-text-tertiary hover:text-vf-text-primary"
            onClick={onResetGrade}
          >
            Reset
          </button>
        }
      >
        <Slider
          label="Brightness"
          value={grade.brightness}
          min={-100}
          max={100}
          valueLabel={String(grade.brightness)}
          onChange={(v) => onGradeChange("brightness", v)}
        />
        <Slider
          label="Contrast"
          value={grade.contrast}
          min={-100}
          max={100}
          valueLabel={String(grade.contrast)}
          onChange={(v) => onGradeChange("contrast", v)}
        />
        <Slider
          label="Saturation"
          value={grade.saturation}
          min={-100}
          max={100}
          valueLabel={String(grade.saturation)}
          onChange={(v) => onGradeChange("saturation", v)}
        />
        <p className="text-2xs text-vf-text-tertiary">
          ⓘ Applied live in preview; exported via FFmpeg eq — preview and export match.
        </p>
      </Section>

      {/* ── Keyframes (M4: opacity + scale) ── */}
      <Section title="Keyframes">
        {/* Opacity keyframe row */}
        <div className="flex items-center gap-2">
          <label className="w-16 shrink-0 text-xs text-vf-text-secondary">Opacity</label>
          <div className="flex h-7 w-14 items-center justify-end rounded-sm border border-vf-border-default bg-vf-surface-2 px-2 text-xs text-vf-text-primary vf-tnum">
            {currentOpacity}
          </div>
          <button
            type="button"
            title="Add opacity keyframe at playhead"
            aria-label="Add opacity keyframe at playhead"
            className="flex h-6 items-center gap-0.5 rounded-sm px-1.5 text-2xs text-vf-text-tertiary hover:bg-vf-surface-3 hover:text-vf-accent-text"
            onClick={() => onAddKeyframe("opacity", currentOpacity)}
          >
            <span aria-hidden="true">◆</span>
            <span>Add</span>
          </button>
        </div>
        {opacityKfs.map((kf) => (
          <KeyframeRow
            key={kf.id ?? `opacity-${kf.timeMs}`}
            kf={kf}
            propLabel="opacity"
            fmtMs={fmtMs}
            onJump={setPlayhead}
            onRemove={kf.id ? () => onRemoveKeyframe(kf.id!) : undefined}
          />
        ))}

        {/* Scale keyframe row */}
        <div className="mt-1 flex items-center gap-2">
          <label className="w-16 shrink-0 text-xs text-vf-text-secondary">Scale</label>
          <div className="flex h-7 w-14 items-center justify-end rounded-sm border border-vf-border-default bg-vf-surface-2 px-2 text-xs text-vf-text-primary vf-tnum">
            {currentScale}
          </div>
          <button
            type="button"
            title="Add scale keyframe at playhead"
            aria-label="Add scale keyframe at playhead"
            className="flex h-6 items-center gap-0.5 rounded-sm px-1.5 text-2xs text-vf-text-tertiary hover:bg-vf-surface-3 hover:text-vf-accent-text"
            onClick={() => onAddKeyframe("scale", currentScale)}
          >
            <span aria-hidden="true">◆</span>
            <span>Add</span>
          </button>
        </div>
        {scaleKfs.map((kf) => (
          <KeyframeRow
            key={kf.id ?? `scale-${kf.timeMs}`}
            kf={kf}
            propLabel="scale"
            fmtMs={fmtMs}
            onJump={setPlayhead}
            onRemove={kf.id ? () => onRemoveKeyframe(kf.id!) : undefined}
          />
        ))}
      </Section>

      {/* ── Ken Burns effect (M4) ── */}
      <Section title="Ken Burns">
        <div className="flex items-center justify-between">
          <span className="text-xs text-vf-text-secondary">Slow zoom-in</span>
          <button
            type="button"
            role="switch"
            aria-checked={!!kenBurns}
            onClick={onToggleKenBurns}
            className={cx(
              "relative h-5 w-9 rounded-pill transition-colors",
              kenBurns ? "bg-vf-accent" : "bg-vf-surface-sunken",
            )}
          >
            <span
              className={cx(
                "absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform",
                kenBurns ? "translate-x-4" : "translate-x-0.5",
              )}
            />
            <span className="sr-only">
              {kenBurns ? "Disable Ken Burns" : "Enable Ken Burns"}
            </span>
          </button>
        </div>
        {kenBurns && (
          <p className="text-2xs text-vf-text-tertiary">
            ⓘ Zooms {kenBurns.startScale}× → {kenBurns.endScale}× over the clip duration.
            Exported via FFmpeg zoompan.
          </p>
        )}
      </Section>
    </>
  );
}

/** A single keyframe list entry — click to jump, × to remove. */
function KeyframeRow({
  kf,
  propLabel,
  fmtMs,
  onJump,
  onRemove,
}: {
  kf: { id?: string; timeMs: number; value: number | string };
  propLabel: string;
  fmtMs: (ms: number) => string;
  onJump: (ms: number) => void;
  onRemove?: (() => void) | undefined;
}) {
  return (
    <div
      className="flex cursor-pointer items-center gap-1 rounded-sm px-1 hover:bg-vf-surface-2"
      onClick={() => onJump(kf.timeMs)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === "Enter" && onJump(kf.timeMs)}
    >
      <span className="text-2xs text-vf-accent-text" aria-hidden="true">
        ✦
      </span>
      <span className="flex-1 text-2xs text-vf-text-secondary vf-tnum">
        {fmtMs(kf.timeMs)}
        <span className="ml-1 text-vf-text-tertiary">
          {propLabel}={String(kf.value)}
        </span>
      </span>
      {onRemove && (
        <button
          type="button"
          aria-label="Remove keyframe"
          className="ml-auto text-2xs text-vf-text-disabled hover:text-red-400"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
        >
          ×
        </button>
      )}
    </div>
  );
}

// ── Track volume-envelope editor (§3.4) — piecewise-linear gain over time ─────────
// Authors the per-track `volumeEnvelope` points (absolute-timeline ms + percent gain).
// The SAME points drive the preview (AudioEngine) and the export (buildFilterComplex)
// through the shared sampler, so "what you cut is what you get" for automated volume.
// Brand: sky-blue (vf-selection) selection/affordances — never amber/purple.
function VolumeEnvelopeEditor({ track }: { track: Extract<Track, { type: "audio" | "voiceover" }> }) {
  const addPoint = useEditorStore((s) => s.addVolumeEnvelopePoint);
  const updatePoint = useEditorStore((s) => s.updateVolumeEnvelopePoint);
  const removePoint = useEditorStore((s) => s.removeVolumeEnvelopePoint);
  const playheadMs = useEditorStore((s) => s.playheadMs);
  const points = track.volumeEnvelope;

  return (
    <Section
      title="Volume envelope"
      action={
        <button
          type="button"
          onClick={() => addPoint(track.id, Math.round(playheadMs), track.volume)}
          className="flex h-6 items-center gap-0.5 rounded-sm px-1.5 text-2xs text-vf-text-tertiary hover:bg-vf-surface-3 hover:text-vf-selection"
          title="Add a point at the playhead"
        >
          + Point
        </button>
      }
    >
      {points.length === 0 ? (
        <p className="text-2xs text-vf-text-tertiary">
          No automation — track volume ({track.volume}%) applies flat. Add points to fade volume over time.
        </p>
      ) : (
        <div className="flex flex-col gap-1">
          {points.map((p, i) => (
            <div key={i} className="flex items-center gap-1.5 rounded-sm border border-vf-border-subtle px-1.5 py-1">
              <span className="text-2xs text-vf-selection tabular-nums" aria-hidden="true">◆</span>
              <label className="flex items-center gap-1 text-2xs text-vf-text-tertiary">
                t
                <input
                  type="number"
                  min={0}
                  step={100}
                  value={p.timeMs}
                  onChange={(e) => updatePoint(track.id, i, { timeMs: Number(e.target.value) })}
                  className="w-16 rounded-sm bg-vf-surface-sunken px-1 py-0.5 text-2xs text-vf-text-primary tabular-nums outline-none focus-visible:outline focus-visible:outline-1 focus-visible:outline-vf-selection"
                  aria-label={`Point ${i + 1} time in ms`}
                />
                ms
              </label>
              <label className="ml-auto flex items-center gap-1 text-2xs text-vf-text-tertiary">
                <input
                  type="number"
                  min={0}
                  max={200}
                  step={1}
                  value={p.value}
                  onChange={(e) => updatePoint(track.id, i, { value: Number(e.target.value) })}
                  className="w-14 rounded-sm bg-vf-surface-sunken px-1 py-0.5 text-2xs text-vf-text-primary tabular-nums outline-none focus-visible:outline focus-visible:outline-1 focus-visible:outline-vf-selection"
                  aria-label={`Point ${i + 1} gain percent`}
                />
                %
              </label>
              <button
                type="button"
                onClick={() => removePoint(track.id, i)}
                className="rounded-sm p-0.5 text-vf-text-tertiary hover:bg-vf-surface-3 hover:text-vf-text-primary"
                title="Remove point"
                aria-label={`Remove point ${i + 1}`}
              >
                <Trash2 className="h-3 w-3" aria-hidden="true" />
              </button>
            </div>
          ))}
          <p className="text-2xs text-vf-text-tertiary">ⓘ Gain ramps linearly between points; renders identically in preview and export.</p>
        </div>
      )}
    </Section>
  );
}

// ── Audio clip inspector (volume / pan / fades) — fully wired ─────────────────────
function AudioInspector({ clip, track }: { clip: Clip; track: Track | null }) {
  const setClipGain = useEditorStore((s) => s.setClipGain);
  const setClipFade = useEditorStore((s) => s.setClipFade);
  const setTrackVolume = useEditorStore((s) => s.setTrackVolume);
  const setTrackPan = useEditorStore((s) => s.setTrackPan);

  const gain = clip.gain ?? 100;
  const fadeInS = (clip.fadeInMs ?? 0) / 1000;
  const fadeOutS = (clip.fadeOutMs ?? 0) / 1000;
  // Track volume/pan only exist on audio-bearing tracks.
  const trackVol = track && (track.type === "audio" || track.type === "voiceover") ? track.volume : 100;
  const trackPan = track && (track.type === "audio" || track.type === "voiceover") ? track.pan : 0;
  const maxFadeS = Math.max(0, (clip.endOnTimeline - clip.startOnTimeline) / 1000);

  return (
    <>
      <Section title="Clip">
        <Slider
          label="Gain"
          value={gain}
          min={0}
          max={200}
          valueLabel={`${gain}%`}
          onChange={(v) => setClipGain(clip.id, clip.trackId, v)}
        />
        <Slider
          label="Fade in"
          value={Math.round(fadeInS * 10)}
          min={0}
          max={Math.max(1, Math.round(maxFadeS * 10))}
          valueLabel={`${fadeInS.toFixed(1)}s`}
          onChange={(v) => setClipFade(clip.id, clip.trackId, "in", (v / 10) * 1000)}
        />
        <Slider
          label="Fade out"
          value={Math.round(fadeOutS * 10)}
          min={0}
          max={Math.max(1, Math.round(maxFadeS * 10))}
          valueLabel={`${fadeOutS.toFixed(1)}s`}
          onChange={(v) => setClipFade(clip.id, clip.trackId, "out", (v / 10) * 1000)}
        />
      </Section>
      {track && (track.type === "audio" || track.type === "voiceover") && (
        <Section title={`Track · ${track.name} (applies to all its clips)`}>
          <Slider
            label="Volume"
            value={trackVol}
            min={0}
            max={200}
            valueLabel={`${trackVol}%`}
            onChange={(v) => setTrackVolume(track.id, v)}
          />
          <Slider
            label="Pan"
            value={trackPan}
            min={-100}
            max={100}
            valueLabel={trackPan === 0 ? "C" : trackPan < 0 ? `${-trackPan}L` : `${trackPan}R`}
            onChange={(v) => setTrackPan(track.id, v)}
          />
        </Section>
      )}
      {track && (track.type === "audio" || track.type === "voiceover") && (
        <VolumeEnvelopeEditor track={track} />
      )}
      <p className="text-2xs text-vf-text-tertiary">ⓘ Fades + gain/pan render identically in preview and export.</p>
    </>
  );
}

// ── Basic track inspector (for selection after "add track") ──────────────────────
function TrackInspector({ trackId, project }: { trackId: string | null; project: Project }) {
  const track = project.tracks.find((t: Track) => t.id === trackId) ?? null;
  const setTrackVolume = useEditorStore((s) => s.setTrackVolume);
  const setTrackPan = useEditorStore((s) => s.setTrackPan);
  const setTrackMute = useEditorStore((s) => s.setTrackMute);
  const setTrackSolo = useEditorStore((s) => s.setTrackSolo);

  if (!track) {
    return <div className="p-4 text-sm text-vf-text-tertiary">Track not found.</div>;
  }

  const isAudioTrack = track.type === "audio" || track.type === "voiceover";
  const vol = (track as any).volume ?? 100;
  const pan = (track as any).pan ?? 0;
  const muted = (track as any).muted ?? false;
  const solo = (track as any).solo ?? false;

  return (
    <aside role="complementary" aria-label="Track inspector" className="flex h-full min-h-0 flex-col bg-vf-surface-1">
      <div className="flex shrink-0 items-center gap-2 border-b border-vf-border-subtle px-4 py-3">
        <span aria-hidden="true">▤</span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-vf-text-primary">{track.name || `${track.type} track`}</div>
          <div className="truncate text-2xs text-vf-text-tertiary">{track.type} · {project.tracks.filter((t) => t.type === track.type).length} total</div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <Section title="Track">
          <label className="flex items-center justify-between text-xs">
            <span>Muted</span>
            <input type="checkbox" checked={muted} onChange={(e) => setTrackMute(track.id, e.target.checked)} />
          </label>
          <label className="flex items-center justify-between text-xs">
            <span>Solo</span>
            <input type="checkbox" checked={solo} onChange={(e) => setTrackSolo(track.id, e.target.checked)} />
          </label>

          {isAudioTrack && (
            <>
              <Slider
                label="Volume"
                value={vol}
                min={0}
                max={200}
                valueLabel={`${vol}%`}
                onChange={(v) => setTrackVolume(track.id, v)}
              />
              <Slider
                label="Pan"
                value={pan}
                min={-100}
                max={100}
                valueLabel={pan === 0 ? "C" : pan < 0 ? `${-pan}L` : `${pan}R`}
                onChange={(v) => setTrackPan(track.id, v)}
              />
            </>
          )}
        </Section>

        {isAudioTrack && (track.type === "audio" || track.type === "voiceover") && (
          <VolumeEnvelopeEditor track={track} />
        )}

        <p className="text-2xs text-vf-text-tertiary">
          {isAudioTrack
            ? "Track settings apply to all clips on this track. Mute/solo also affect export mix."
            : "Video track. Clip-level properties (trim, speed, transforms) are edited on individual clips."}
        </p>
        <p className="mt-2 text-2xs text-vf-text-tertiary">Drag media onto the track body on the timeline to add clips.</p>
      </div>
    </aside>
  );
}

// ── Text overlay inspector (drawtext-subset, §7.B.4) — fully wired ────────────────
function OverlayInspector({ overlay }: { overlay: OverlayClip }) {
  const updateOverlay = useEditorStore((s) => s.updateOverlay);

  if (overlay.kind !== "text") {
    return (
      <Section title="Properties">
        <Slider label="Position X" value={Math.round(overlay.canvasX ?? 0)} min={0} max={100} valueLabel={`${(overlay.canvasX ?? 0).toFixed(0)}%`} onChange={(v) => updateOverlay(overlay.id, { canvasX: v })} />
        <Slider label="Position Y" value={Math.round(overlay.canvasY ?? 0)} min={0} max={100} valueLabel={`${(overlay.canvasY ?? 0).toFixed(0)}%`} onChange={(v) => updateOverlay(overlay.id, { canvasY: v })} />
        <Slider label="Opacity" value={Math.round(overlay.opacity ?? 100)} min={0} max={100} valueLabel={`${overlay.opacity ?? 100}%`} onChange={(v) => updateOverlay(overlay.id, { opacity: v })} />
      </Section>
    );
  }
  const t = overlay as TextOverlay;
  const patchStyle = (patch: Partial<TextOverlay["style"]>) =>
    updateOverlay(t.id, { style: { ...t.style, ...patch } } as Partial<OverlayClip>);

  return (
    <>
      <Section title="Text">
        <textarea
          value={t.text}
          onChange={(e) => updateOverlay(t.id, { text: e.target.value } as Partial<OverlayClip>)}
          aria-label="Text content"
          className="h-16 w-full resize-none rounded-sm border border-vf-border-default bg-vf-surface-2 p-2 text-sm text-vf-text-primary"
        />
        <div className="flex items-center gap-2">
          <label className="w-24 shrink-0 text-xs text-vf-text-secondary">Size</label>
          <input
            type="number"
            min={8}
            max={400}
            value={t.style.fontSize}
            onChange={(e) => patchStyle({ fontSize: Math.max(8, Number(e.target.value) || 8) })}
            aria-label="Font size"
            className="h-7 w-20 rounded-sm border border-vf-border-default bg-vf-surface-2 px-2 text-xs text-vf-text-primary vf-tnum"
          />
          <span className="text-2xs text-vf-text-tertiary">px</span>
        </div>
        <div className="flex items-center gap-2">
          <label className="w-24 shrink-0 text-xs text-vf-text-secondary">Color</label>
          <input
            type="color"
            value={t.style.color}
            onChange={(e) => patchStyle({ color: e.target.value })}
            aria-label="Text color"
            className="h-7 w-10 cursor-pointer rounded-sm border border-vf-border-default bg-vf-surface-2"
          />
          <span className="text-xs text-vf-text-primary vf-tnum">{t.style.color}</span>
        </div>

        {/* F06: B / I / U toggles (match Canva floating toolbar). We only write §18-valid
            TextStyle fields (fontWeight, italic, underline) — all render identically in
            the FFmpeg export, so the document always passes export validation. Underline
            is end-to-end: drawtext has no underline, so the export draws a filled rule
            (drawbox) under the text and the preview draws the matching rect, both from the
            SHARED `underlineRule` text-metrics helper, so preview == export. We write the
            schema `underline` field — NOT the old bad `textDecoration` key. */}
        <div className="flex items-center gap-2">
          <label className="w-24 shrink-0 text-xs text-vf-text-secondary">Style</label>
          <div className="flex gap-1">
            {[
              { key: "B", label: "B", title: "Bold (⌘B)", active: (t.style.fontWeight || 600) >= 700, toggle: () => patchStyle({ fontWeight: (t.style.fontWeight || 600) >= 700 ? 400 : 700 }) },
              { key: "I", label: "I", title: "Italic (⌘I)", active: t.style.italic === true, toggle: () => patchStyle({ italic: !t.style.italic }) },
              { key: "U", label: "U", title: "Underline (⌘U)", active: t.style.underline === true, toggle: () => patchStyle({ underline: !t.style.underline }) },
            ].map((b) => (
              <button
                key={b.key}
                title={b.title}
                onClick={b.toggle}
                aria-pressed={b.active}
                className={cx(
                  "h-7 w-7 rounded border text-xs font-semibold",
                  b.key === "I" && "italic",
                  b.key === "U" && "underline",
                  b.active
                    ? "border-vf-accent bg-vf-accent text-white"
                    : "border-vf-border-default bg-vf-surface-2 text-vf-text-primary hover:bg-vf-surface-3"
                )}
              >
                {b.label}
              </button>
            ))}
          </div>
        </div>

        {/* F13: Alignment L/C/R (Shift+⌘L/C/R) */}
        <div className="flex items-center gap-2">
          <label className="w-24 shrink-0 text-xs text-vf-text-secondary">Align</label>
          <div className="flex gap-1">
            {[
              { key: "left", label: "L", title: "Left (⇧⌘L)" },
              { key: "center", label: "C", title: "Center (⇧⌘C)" },
              { key: "right", label: "R", title: "Right (⇧⌘R)" },
            ].map((a) => {
              const active = (t.style.align || "left") === a.key;
              return (
                <button
                  key={a.key}
                  title={a.title}
                  onClick={() => patchStyle({ align: a.key as any })}
                  className={cx(
                    "h-7 w-7 rounded border text-xs font-semibold",
                    active
                      ? "border-vf-accent bg-vf-accent text-white"
                      : "border-vf-border-default bg-vf-surface-2 text-vf-text-primary hover:bg-vf-surface-3"
                  )}
                >
                  {a.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Font-family picker removed (invariant): the export always rasterizes the
            bundled Inter face (R1) — offering other families would preview a font the
            export can't honor. Text always renders Inter on both sides. */}

        <Slider label="Opacity" value={Math.round(t.opacity)} min={0} max={100} valueLabel={`${t.opacity}%`} onChange={(v) => updateOverlay(t.id, { opacity: v })} />
        <p className="text-2xs text-vf-text-tertiary">ⓘ Styles shown here render identically in your export (no server rasterization).</p>
      </Section>
      <Section title="Properties (transform)">
        <Slider label="Position X" value={Math.round(t.canvasX ?? 0)} min={0} max={100} valueLabel={`${(t.canvasX ?? 0).toFixed(0)}%`} onChange={(v) => updateOverlay(t.id, { canvasX: v })} />
        <Slider label="Position Y" value={Math.round(t.canvasY ?? 0)} min={0} max={100} valueLabel={`${(t.canvasY ?? 0).toFixed(0)}%`} onChange={(v) => updateOverlay(t.id, { canvasY: v })} />
        {/* Rotation slider removed (invariant): neither the preview nor the export
            honors TextOverlay.rotation, so the control was a dead/lying affordance. */}
      </Section>
    </>
  );
}

// ── Caption Editor (table; §7.C) ─────────────────────────────────────────────────
function CaptionEditor({ selectedId }: { selectedId: string | null }) {
  const captionTracks = useEditorStore((s) => s.project.captionTracks);
  const fps = useEditorStore((s) => s.project.canvas.frameRate);
  const select = useEditorStore((s) => s.select);
  const setPlayhead = useEditorStore((s) => s.setPlayhead);
  const updateCaption = useEditorStore((s) => s.updateCaption);
  const importCaptions = useEditorStore((s) => s.importCaptions);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const blocks: CaptionBlock[] = captionTracks[0]?.blocks ?? [];

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      const parsed = parseCaptions(await file.text()) as CaptionBlock[];
      importCaptions(parsed);
    } catch {
      // Silently ignore parse errors for MVP (mirrors MediaPanel's import).
    }
  };

  return (
    <>
      <div className="flex shrink-0 items-center justify-between border-b border-vf-border-subtle px-4 py-3">
        <h2 className="text-sm font-semibold text-vf-text-primary">Caption editor</h2>
        <Button variant="secondary" size="sm" onClick={() => fileInputRef.current?.click()}>
          Import .srt / .vtt
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".srt,.vtt"
          aria-hidden="true"
          aria-label="Import captions .srt or .vtt file"
          tabIndex={-1}
          className="sr-only"
          onChange={handleImport}
          data-testid="caption-import-input"
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        <table role="grid" className="w-full border-collapse text-2xs">
          <thead>
            <tr className="text-vf-text-tertiary">
              <th className="w-6 px-1 py-1 text-left font-medium">#</th>
              <th className="px-1 py-1 text-left font-medium">Start</th>
              <th className="px-1 py-1 text-left font-medium">End</th>
              <th className="px-1 py-1 text-left font-medium">Text</th>
            </tr>
          </thead>
          <tbody>
            {blocks.map((b, i) => (
              <tr
                key={b.id}
                onClick={() => {
                  select("caption", b.id);
                  setPlayhead(b.startMs);
                }}
                className={cx(
                  "cursor-pointer border-l-2 align-top",
                  selectedId === b.id ? "border-vf-accent bg-vf-surface-3" : "border-transparent hover:bg-vf-surface-2",
                )}
              >
                <td className="px-1 py-1 text-vf-text-tertiary vf-tnum">{i + 1}</td>
                <td className="px-1 py-1 text-vf-text-secondary vf-tnum">{msToTimecode(b.startMs, fps)}</td>
                <td className="px-1 py-1 text-vf-text-secondary vf-tnum">{msToTimecode(b.endMs, fps)}</td>
                <td className="px-1 py-1">
                  <input
                    value={b.text}
                    aria-label={`Caption ${i + 1} text`}
                    className="w-full rounded-sm border border-transparent bg-transparent px-1 text-vf-text-primary hover:border-vf-border-subtle focus:border-vf-border-default"
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => updateCaption(b.id, { text: e.target.value })}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-3 text-2xs text-vf-text-tertiary">
          {blocks.length} block{blocks.length === 1 ? "" : "s"} · captions improve accessibility and reach.
        </p>
      </div>
    </>
  );
}
