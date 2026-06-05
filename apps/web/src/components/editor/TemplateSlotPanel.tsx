import { useMemo } from "react";
import type { TemplateManifest, TemplateSlot } from "@videoforge/templates";
import { useEditorStore } from "../../store/editorStore.js";
import { isSlotFilled } from "../../lib/templates.js";
import { useAssetStore, type AssetKind } from "../../store/assetStore.js";
import { cx } from "../ui/cx.js";

// Template slot-fill panel (Templates_Architecture §4.4, Templates_Design §2).
// Driven by the (rewritten) manifest for the open template-derived project. Each slot:
//   • media → "N of M" badge + a picker of the user's imported library assets →
//     replaceClipAsset (the new store action). The drag-from-MediaPanel path fills the
//     same way (a drop onto a placeholder clip swaps its asset on the timeline).
//   • text  → inline copy edit → updateOverlay / updateCaption.
// Filled state is the STRUCTURAL check (isSlotFilled), so it survives reloads.

export default function TemplateSlotPanel({ manifest }: { manifest: TemplateManifest }) {
  const project = useEditorStore((s) => s.project);
  const select = useEditorStore((s) => s.select);

  const mediaSlots = useMemo(() => manifest.slots.filter((s) => s.kind !== "text"), [manifest]);
  const textSlots = useMemo(() => manifest.slots.filter((s) => s.kind === "text"), [manifest]);

  const filledMedia = mediaSlots.filter((s) => isSlotFilled(project, s)).length;

  return (
    <section aria-label="Template slots" className="flex flex-col gap-4" data-testid="template-slot-panel">
      <header className="flex flex-col gap-1">
        <h3 className="text-sm font-semibold text-vf-text-primary">Fill your template</h3>
        <p className="text-2xs text-vf-text-tertiary">
          {filledMedia} of {mediaSlots.length} media slots filled · edit the text below.
        </p>
      </header>

      {mediaSlots.length > 0 && (
        <div className="flex flex-col gap-2">
          <h4 className="text-2xs font-semibold uppercase tracking-wide text-vf-text-tertiary">Media</h4>
          {mediaSlots.map((slot) => (
            <MediaSlotRow key={slot.id} slot={slot} onSelectClip={(id) => select("clip", id)} />
          ))}
        </div>
      )}

      {textSlots.length > 0 && (
        <div className="flex flex-col gap-2">
          <h4 className="text-2xs font-semibold uppercase tracking-wide text-vf-text-tertiary">Text</h4>
          {textSlots.map((slot) => (
            <TextSlotRow key={slot.id} slot={slot} />
          ))}
        </div>
      )}
    </section>
  );
}

function MediaSlotRow({
  slot,
  onSelectClip,
}: {
  slot: TemplateSlot;
  onSelectClip: (clipId: string) => void;
}) {
  const project = useEditorStore((s) => s.project);
  const replaceClipAsset = useEditorStore((s) => s.replaceClipAsset);
  const assets = useAssetStore((s) => s.assets);
  const filled = isSlotFilled(project, slot);

  // Library assets eligible for this slot kind (image slots take images; video slots
  // take video or image). The placeholder/sentinel assets are excluded by kind/url.
  const options = useMemo(() => {
    const wantKinds: AssetKind[] = slot.kind === "image" ? ["image"] : ["video", "image"];
    return Object.values(assets).filter(
      (a) => wantKinds.includes(a.kind) && (a.proxyUrl !== null || a.thumbnailUrl !== null),
    );
  }, [assets, slot.kind]);

  const onChoose = (assetId: string) => {
    if (!assetId || slot.target.type !== "clip") return;
    const meta = assets[assetId];
    onSelectClip(slot.target.clipId);
    replaceClipAsset(slot.target.clipId, slot.target.trackId, assetId, meta?.durationMs ?? undefined);
  };

  return (
    <div
      className={cx(
        "flex items-center gap-2 rounded-md border px-2 py-1.5",
        filled ? "border-vf-border-subtle bg-vf-surface-2" : "border-dashed border-vf-border-default bg-vf-surface-2",
      )}
    >
      <span
        aria-hidden="true"
        className={cx("flex h-5 w-5 items-center justify-center rounded-sm text-2xs", filled ? "text-vf-success-fg" : "text-vf-icon-muted")}
      >
        {filled ? "✓" : "▦"}
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-xs font-medium text-vf-text-primary">{slot.label}</div>
        <div className="text-2xs text-vf-text-disabled">{slot.index} of {slot.total}</div>
      </div>
      {/* Pick from imported library assets. Ghost styling — NOT amber (Iris §2.2). */}
      <select
        aria-label={`Fill ${slot.label}`}
        value=""
        onChange={(e) => onChoose(e.target.value)}
        disabled={options.length === 0}
        className="h-7 max-w-[120px] rounded-sm border border-vf-border-default bg-vf-surface-3 px-1.5 text-2xs text-vf-text-primary disabled:opacity-50"
      >
        <option value="">{options.length === 0 ? "Import media first" : filled ? "Replace…" : "Add…"}</option>
        {options.map((a) => (
          <option key={a.id} value={a.id}>
            {a.kind} · {a.id.slice(0, 6)}
          </option>
        ))}
      </select>
    </div>
  );
}

function TextSlotRow({ slot }: { slot: TemplateSlot }) {
  const project = useEditorStore((s) => s.project);
  const updateOverlay = useEditorStore((s) => s.updateOverlay);
  const updateCaption = useEditorStore((s) => s.updateCaption);

  // Read the current text from the document by the slot's target.
  const currentText = useMemo(() => {
    if (slot.target.type === "overlay") {
      for (const t of project.tracks) {
        if (t.type !== "overlay") continue;
        const ov = t.clips.find((c) => c.id === (slot.target.type === "overlay" ? slot.target.overlayId : ""));
        if (ov && ov.kind === "text") return ov.text;
      }
    } else if (slot.target.type === "captionBlock") {
      const ct = project.captionTracks.find((c) => c.id === (slot.target.type === "captionBlock" ? slot.target.captionTrackId : ""));
      const block = ct?.blocks.find((b) => b.id === (slot.target.type === "captionBlock" ? slot.target.blockId : ""));
      if (block) return block.text;
    }
    return "";
  }, [project, slot]);

  const onChange = (text: string) => {
    if (slot.target.type === "overlay") updateOverlay(slot.target.overlayId, { text });
    else if (slot.target.type === "captionBlock") updateCaption(slot.target.blockId, { text });
  };

  return (
    <label className="flex flex-col gap-1">
      <span className="text-2xs text-vf-text-tertiary">{slot.label}</span>
      <input
        type="text"
        value={currentText}
        aria-label={slot.label}
        onChange={(e) => onChange(e.target.value)}
        className="h-7 rounded-sm border border-vf-border-default bg-vf-surface-2 px-2 text-xs text-vf-text-primary focus:border-vf-selection focus:outline-none"
      />
    </label>
  );
}
