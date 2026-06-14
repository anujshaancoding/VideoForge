import { useMemo } from "react";
import type { TemplateManifest, TemplateSlot } from "@videoforge/templates";
import { useEditorStore } from "../../store/editorStore.js";
import { isSlotFilled } from "../../lib/templates.js";
import { useAssetStore, type AssetKind } from "../../store/assetStore.js";
import { cx } from "../ui/cx.js";

function durationLabel(ms: number | null): string {
  if (!ms) return '';
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

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
    <section aria-label="Template slots" className="flex flex-col gap-3 p-3 bg-vf-surface-2/60 rounded-xl border border-vf-border-subtle" data-testid="template-slot-panel">
      <header className="flex items-baseline justify-between px-1">
        <div>
          <h3 className="text-sm font-semibold text-vf-text-primary tracking-[-0.2px]">Fill your template</h3>
          <p className="text-[10px] text-vf-text-tertiary mt-0.5">
            {filledMedia} of {mediaSlots.length} filled
          </p>
        </div>
        <div className="text-[10px] px-2 py-0.5 rounded-full bg-vf-surface-3 text-vf-accent-text font-medium tabular-nums">
          {Math.round((filledMedia / Math.max(1, mediaSlots.length)) * 100)}%
        </div>
      </header>

      {mediaSlots.length > 0 && (
        <div className="space-y-2">
          {mediaSlots.map((slot) => (
            <MediaSlotRow key={slot.id} slot={slot} onSelectClip={(id) => select("clip", id)} />
          ))}
        </div>
      )}

      {textSlots.length > 0 && (
        <div className="pt-1 border-t border-vf-border-subtle/70">
          <div className="text-[10px] font-semibold uppercase tracking-widest text-vf-text-tertiary px-1 mb-1.5">Text</div>
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
  onSelectClip: _onSelectClip,
}: {
  slot: TemplateSlot;
  onSelectClip?: (clipId: string) => void;
}) {
  const project = useEditorStore((s) => s.project);
  const replaceClipAsset = useEditorStore((s) => s.replaceClipAsset);
  const assets = useAssetStore((s) => s.assets);
  const filled = isSlotFilled(project, slot);
  const selectedClipId = useEditorStore((s) => s.selection.kind === 'clip' ? s.selection.id : null);

  const targetClipId = slot.target.type === "clip" ? slot.target.clipId : null;
  const isSelected = selectedClipId != null && selectedClipId === targetClipId;

  // Real imported assets only for filling. Exclude any sentinel/placeholder asset ids
  // that belong to *unfilled* slots (those are the demo visuals; picking one would
  // not change sourceAssetId and would leave isSlotFilled false, breaking count/timeline/export sync).
  const options = useMemo(() => {
    const wantKinds: AssetKind[] = slot.kind === "image" ? ["image"] : ["video", "image"];
    const placeholderIds = new Set<string>();
    if (slot.placeholder.kind === "asset") placeholderIds.add(slot.placeholder.assetId);
    // Also collect other unfilled media slot placeholders of same kind for broader exclusion
    // (in case multiple slots share visual language).
    return Object.values(assets).filter((a) => {
      if (!wantKinds.includes(a.kind)) return false;
      if (!(a.proxyUrl !== null || a.thumbnailUrl !== null)) return false;
      if (placeholderIds.has(a.id)) return false;
      return true;
    });
  }, [assets, slot.kind, slot.placeholder]);

  const onChoose = (assetId: string) => {
    if (!assetId || slot.target.type !== "clip") return;
    const meta = assets[assetId];
    replaceClipAsset(slot.target.clipId, slot.target.trackId, assetId, meta?.durationMs ?? undefined);
    // Intentionally do NOT auto-select the clip here: keeps the full slot overview
    // (with live counts + other empty rows) visible so the user can continue filling.
  };

  // For filled slot, show beautiful filled state with thumb + actions
  if (filled) {
    // Simple beautiful filled state (asset details can be shown in inspector once selected)
    return (
      <div className={cx(
        "group flex items-center gap-3 rounded-xl border px-3 py-2.5 transition-all",
        isSelected ? "border-vf-accent bg-vf-surface-3 shadow-sm" : "border-vf-border-subtle bg-vf-surface-2 hover:border-vf-border-strong"
      )}>
        <div className="flex-shrink-0 w-10 h-7 rounded bg-vf-success-subtle flex items-center justify-center text-[10px] text-vf-success-fg font-medium">FILLED</div>
        <div className="min-w-0 flex-1">
          <div className="text-xs font-semibold text-vf-text-primary truncate">{slot.label} — filled with imported media</div>
          <div className="text-[10px] text-vf-text-tertiary">Click clip in timeline or canvas for properties • Replace via media rail</div>
        </div>
      </div>
    );
  }

  // Empty / selectable state with beautiful chooser
  return (
    <div className={cx(
      "rounded-xl border px-3 py-2.5 transition-all",
      isSelected ? "border-vf-accent bg-vf-surface-3" : "border-dashed border-vf-border-default bg-vf-surface-2/70"
    )}>
      <div className="flex items-center gap-2 mb-2">
        <span aria-hidden className="text-vf-icon-muted">▦</span>
        <div className="min-w-0 flex-1">
          <div className="text-xs font-medium text-vf-text-primary">{slot.label}</div>
          <div className="text-[10px] text-vf-text-disabled">{slot.index} of {slot.total} • empty</div>
        </div>
        {slot.target.type === 'clip' && <button onClick={() => _onSelectClip && _onSelectClip((slot.target as any).clipId)} className="text-[11px] px-1.5 py-0.5 rounded text-vf-accent-text hover:bg-vf-surface-3 hover:underline">Select in timeline</button>}
      </div>

      {/* Premium visual chooser */}
      <div className="flex flex-wrap gap-1.5">
        {options.length === 0 ? (
          <div className="text-[10px] italic text-vf-text-tertiary/80 px-1">Import real media in the left rail to fill this slot</div>
        ) : (
          options.slice(0, 4).map((a) => {
            const meta = assets[a.id];
            const dur = meta?.durationMs ? durationLabel(meta.durationMs) : '';
            const thumb = meta?.thumbnailUrl;
            return (
              <button
                key={a.id}
                onClick={() => slot.target.type === 'clip' && onChoose(a.id)}
                className="flex-1 min-w-[92px] text-left rounded-lg border border-vf-border-default bg-vf-surface-3 hover:border-vf-accent hover:bg-vf-surface-4 active:bg-vf-accent-subtle p-1.5 transition text-[10px] flex gap-2 items-center"
                title={`Fill ${slot.label} with this ${a.kind}`}
              >
                <div className="w-6 h-5 flex-shrink-0 rounded overflow-hidden border border-vf-border-subtle bg-vf-surface-sunken" style={thumb ? {background: `url(${thumb}) center/cover no-repeat`} : {}} />
                <div className="min-w-0">
                  <div className="font-medium text-vf-text-primary truncate">{a.kind} {dur}</div>
                  <div className="text-vf-text-tertiary text-[9px]">imported</div>
                </div>
              </button>
            );
          })
        )}
      </div>
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
