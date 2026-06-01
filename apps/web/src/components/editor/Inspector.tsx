import { useMemo } from "react";
import {
  selectClip,
  useEditorStore,
  type ColorGrade,
  type KenBurns,
} from "../../store/editorStore.js";
import type {
  CaptionBlock,
  Clip,
  OverlayClip,
  TextOverlay,
  Track,
} from "@videoforge/project-schema";
import { msToTimecode } from "@videoforge/project-schema";
import { Button, cx, Slider } from "../ui/index.js";

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

  // Empty state (§7.B.0): nothing selected.
  if (!selection.id || selection.kind === null) {
    return (
      <aside
        role="complementary"
        aria-label="Inspector"
        className="flex h-full flex-col items-center justify-center gap-2 bg-vf-surface-1 px-6 text-center"
      >
        <span aria-hidden="true" className="text-2xl text-vf-text-disabled">
          ◇
        </span>
        <p className="text-sm text-vf-text-tertiary">Select a clip to edit its properties.</p>
      </aside>
    );
  }

  const header = (icon: string, name: string, sub: string) => (
    <div className="flex shrink-0 items-center gap-2 border-b border-vf-border-subtle px-4 py-3">
      <span aria-hidden="true">{icon}</span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-vf-text-primary">{name}</div>
        <div className="truncate text-2xs text-vf-text-tertiary">{sub}</div>
      </div>
      <Button
        variant="ghost"
        size="sm"
        aria-label="Delete selected"
        onClick={deleteSelected}
        title="Delete (Del)"
      >
        ⌫
      </Button>
      <Button
        variant="ghost"
        size="sm"
        aria-label="Duplicate selected"
        onClick={duplicateSelected}
        title="Duplicate (Ctrl+D)"
      >
        ⧉
      </Button>
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
            {header("♪", `audio ${clip.id.slice(0, 6)}`, clipTrack.name)}
            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              <AudioInspector clip={clip} />
            </div>
          </>
        ) : (
          <>
            {header("▣", `clip ${clip.id.slice(0, 6)}`, clipTrack?.name ?? "")}
            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              <VideoClipInspector clip={clip} />
            </div>
          </>
        )
      ) : selection.kind === "overlay" && overlay ? (
        <>
          {header("T", overlay.kind === "text" ? `"${(overlay as TextOverlay).text}"` : overlay.kind, overlayTrack?.name ?? "")}
          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            <OverlayInspector overlay={overlay} />
          </div>
        </>
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

/** A property row: label · numeric value (read-only display) · keyframe diamond. */
function PropRow({
  label,
  value,
  unit,
  keyframable,
}: {
  label: string;
  value: number | string;
  unit?: string;
  keyframable?: boolean;
}) {
  return (
    <div className="flex items-center gap-2">
      <label className="w-24 shrink-0 text-xs text-vf-text-secondary">{label}</label>
      <div className="flex h-7 flex-1 items-center justify-end rounded-sm border border-vf-border-default bg-vf-surface-2 px-2 text-xs text-vf-text-primary vf-tnum">
        {value}
        {unit && <span className="ml-0.5 text-vf-text-tertiary">{unit}</span>}
      </div>
      {keyframable && <KeyframeDiamond label={label} />}
    </div>
  );
}

/** Keyframe diamond toggle (visual, §7.B.5). */
function KeyframeDiamond({ label }: { label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={false}
      aria-label={`Animate ${label}`}
      title={`Animate ${label}`}
      className="flex h-6 w-6 items-center justify-center rounded-sm text-vf-text-tertiary hover:text-vf-accent-text"
    >
      <span aria-hidden="true">◇</span>
    </button>
  );
}

// ── Video clip inspector (Properties · Color · Keyframes · Ken Burns) ─────────────
function VideoClipInspector({ clip }: { clip: Clip }) {
  const setClipColorGrade = useEditorStore((s) => s.setClipColorGrade);
  const addKeyframe = useEditorStore((s) => s.addKeyframe);
  const removeKeyframe = useEditorStore((s) => s.removeKeyframe);
  const setClipKenBurns = useEditorStore((s) => s.setClipKenBurns);
  const setPlayhead = useEditorStore((s) => s.setPlayhead);
  const playheadMs = useEditorStore((s) => s.playheadMs);

  // Color grade: prefer M4 extension field, fall back to effects array (legacy).
  const cgExt = (clip as unknown as { colorGrade?: ColorGrade }).colorGrade;
  const cgEffect = clip.effects.find((e) => e.type === "colorGrade" && e.enabled)?.params;
  const numFromEffect = (k: string): number =>
    typeof cgEffect?.[k] === "number" ? (cgEffect[k] as number) : 0;
  const grade: ColorGrade = cgExt ?? {
    brightness: numFromEffect("brightness"),
    contrast: numFromEffect("contrast"),
    saturation: numFromEffect("saturation"),
  };

  const kenBurns = (clip as unknown as { kenBurns?: KenBurns }).kenBurns;

  // Keyframe arrays for opacity and scale (with optional id extension field).
  type KfWithId = { id?: string; timeMs: number; value: number | string };
  const opacityKfs = (clip.keyframes["opacity"] ?? []) as KfWithId[];
  const scaleKfs = (clip.keyframes["scale"] ?? []) as KfWithId[];

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
    addKeyframe(clip.id, clip.trackId, playheadMs, property, value);
  };

  const onRemoveKeyframe = (kfId: string) => {
    removeKeyframe(clip.id, clip.trackId, kfId);
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
        <PropRow label="Position X" value={"50.0"} unit="%" keyframable />
        <PropRow label="Position Y" value={"50.0"} unit="%" keyframable />
        <PropRow label="Scale" value={"100.0"} unit="%" keyframable />
        <PropRow label="Rotation" value={"0.0"} unit="°" keyframable />
        <PropRow label="Opacity" value={"100"} unit="%" keyframable />
      </Section>

      <Section title="Timing">
        <PropRow label="Speed" value={clip.speed.toFixed(2)} unit="×" />
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

// ── Audio clip inspector (volume / pan / fades) ──────────────────────────────────
function AudioInspector({ clip }: { clip: Clip }) {
  return (
    <>
      <Section title="Clip">
        <PropRow label="Gain" value={(clip.gain ?? 100).toString()} unit="%" />
        {/* MVP-STUB: fade + envelope writes wired in M4. */}
        <PropRow label="Fade in" value={"0.00"} unit="s" />
        <PropRow label="Fade out" value={"0.00"} unit="s" />
        <div className="flex items-center justify-between">
          <span className="text-xs text-vf-text-secondary">Volume envelope</span>
          <KeyframeDiamond label="Volume envelope" />
        </div>
      </Section>
      <Section title="Track (applies to all clips)">
        <Slider label="Volume" value={100} min={0} max={200} valueLabel="100%" />
        <Slider label="Pan" value={0} min={-100} max={100} valueLabel="0" />
      </Section>
      <p className="text-2xs text-vf-text-tertiary">ⓘ Master monitor volume is preview-only and does not change your export.</p>
    </>
  );
}

// ── Text overlay inspector (drawtext-subset, §7.B.4) ─────────────────────────────
function OverlayInspector({ overlay }: { overlay: OverlayClip }) {
  if (overlay.kind !== "text") {
    return (
      <Section title="Properties">
        <PropRow label="Position X" value={overlay.canvasX.toFixed(1)} unit="%" keyframable />
        <PropRow label="Position Y" value={overlay.canvasY.toFixed(1)} unit="%" keyframable />
        <PropRow label="Opacity" value={overlay.opacity} unit="%" keyframable />
      </Section>
    );
  }
  const t = overlay as TextOverlay;
  return (
    <>
      <Section title="Text">
        {/* MVP-STUB: text-content write wired in M4. */}
        <textarea
          defaultValue={t.text}
          aria-label="Text content"
          className="h-16 w-full resize-none rounded-sm border border-vf-border-default bg-vf-surface-2 p-2 text-sm text-vf-text-primary"
        />
        <PropRow label="Font" value={t.style.fontFamily} />
        <PropRow label="Size" value={t.style.fontSize} unit="px" />
        <div className="flex items-center gap-2">
          <label className="w-24 shrink-0 text-xs text-vf-text-secondary">Color</label>
          <span className="h-5 w-5 rounded-sm border border-vf-border-default" style={{ backgroundColor: t.style.color }} aria-hidden="true" />
          <span className="text-xs text-vf-text-primary vf-tnum">{t.style.color}</span>
        </div>
        <PropRow label="Outline" value={t.style.outline ? `${t.style.outline.width}px` : "none"} />
        <PropRow label="Opacity" value={t.opacity} unit="%" keyframable />
        <p className="text-2xs text-vf-text-tertiary">ⓘ Styles shown here render identically in your export (no server rasterization).</p>
      </Section>
      <Section title="Properties (transform)">
        <PropRow label="Position X" value={t.canvasX.toFixed(1)} unit="%" keyframable />
        <PropRow label="Position Y" value={t.canvasY.toFixed(1)} unit="%" keyframable />
        <PropRow label="Rotation" value={t.rotation.toFixed(1)} unit="°" keyframable />
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

  const blocks: CaptionBlock[] = captionTracks[0]?.blocks ?? [];

  return (
    <>
      <div className="flex shrink-0 items-center justify-between border-b border-vf-border-subtle px-4 py-3">
        <h2 className="text-sm font-semibold text-vf-text-primary">Caption editor</h2>
        <Button variant="secondary" size="sm">
          Import .srt
        </Button>
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
                    defaultValue={b.text}
                    aria-label={`Caption ${i + 1} text`}
                    className="w-full rounded-sm border border-transparent bg-transparent px-1 text-vf-text-primary hover:border-vf-border-subtle focus:border-vf-border-default"
                    onClick={(e) => e.stopPropagation()}
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
