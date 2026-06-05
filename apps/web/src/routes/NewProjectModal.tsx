import { useCallback, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { v4 as uuidv4 } from "uuid";
import { listManifests, getTemplate, type TemplateManifest } from "@videoforge/templates";
import { createProject } from "../lib/projectStore.js";
import { cloneTemplateToProject } from "../lib/templates.js";
import { useTemplateStore } from "../store/templateStore.js";
import { Button, Field, Modal } from "../components/ui/index.js";
import { cx } from "../components/ui/cx.js";

// New Project modal (§4.3) — the HERO aspect-ratio chooser. Five proportional,
// equally-weighted tiles with NO pre-selected default (radiogroup; arrow keys move
// roving focus; Space/Enter selects). Create is disabled until a ratio is chosen.
// Choosing → createProject(canvasConfig) → navigate to /editor/:id. Rendered as a
// route over the dashboard so context is never lost.
//
// Templates (Templates_Design §1): an optional "Or start from a template" section
// between the ratio chooser and the name field. Picking a template card auto-selects
// its canonical ratio (9:16 for all 5), swaps the Create label to "Use template →",
// and on commit clones the template document into a fresh project. Selection is
// sky-blue (--vf-selection) — never amber (amber is reserved for the Export CTA).

type RatioId = "9:16" | "16:9" | "1:1" | "4:5" | "custom";

// ── CEO decision flip (ROADMAP Now #6) ──────────────────────────────────────────
// The chooser is equal-weight with NO pre-selected default (CEO's call). The CEO's
// pending "9:16-vs-equal" decision is a ONE-LINE flip here: set this to "9:16" (or any
// RatioId) to pre-select that tile on open; leave `null` for the equal-weight chooser.
const DEFAULT_RATIO: RatioId | null = null;

interface RatioPreset {
  id: RatioId;
  label: string;
  hint: string;
  /** Reactive one-liner shown under the tiles when this ratio is selected. */
  reactiveHint: string;
  width: number;
  height: number;
}

// Logical resolutions per Spec §2.2 (Free-tier export caps at 1080p, all satisfy).
const PRESETS: RatioPreset[] = [
  { id: "9:16", label: "Vertical", hint: "TikTok · Reels · Shorts", reactiveHint: "Vertical · best for TikTok, Reels, Shorts", width: 1080, height: 1920 },
  { id: "16:9", label: "Horizontal", hint: "YouTube · desktop", reactiveHint: "Horizontal · best for YouTube and desktop", width: 1920, height: 1080 },
  { id: "1:1", label: "Square", hint: "Instagram feed", reactiveHint: "Square · best for the Instagram feed", width: 1080, height: 1080 },
  { id: "4:5", label: "Portrait", hint: "Instagram portrait", reactiveHint: "Portrait · best for Instagram portrait posts", width: 1080, height: 1350 },
  { id: "custom", label: "Custom", hint: "your size", reactiveHint: "Custom · set your own width and height", width: 1080, height: 1080 },
];

const CUSTOM_MIN = 360;
const CUSTOM_MAX = 4096;

function RatioTile({
  preset,
  selected,
  onSelect,
  registerRef,
  tabIndex,
  onKeyDown,
}: {
  preset: RatioPreset;
  selected: boolean;
  onSelect: () => void;
  registerRef: (el: HTMLButtonElement | null) => void;
  tabIndex: number;
  onKeyDown: (e: React.KeyboardEvent) => void;
}) {
  // Inner rectangle drawn at the TRUE aspect ratio — the shape IS the information.
  const max = 48;
  const ratio = preset.width / preset.height;
  const w = ratio >= 1 ? max : Math.round(max * ratio);
  const h = ratio >= 1 ? Math.round(max / ratio) : max;
  return (
    <button
      ref={registerRef}
      type="button"
      role="radio"
      aria-checked={selected}
      tabIndex={tabIndex}
      onClick={onSelect}
      onKeyDown={onKeyDown}
      className={cx(
        "flex h-[120px] flex-col items-center justify-center gap-2 rounded-md border bg-vf-surface-1 px-2 transition-colors",
        "duration-[var(--vf-motion-duration)]",
        selected
          ? "border-2 border-vf-accent bg-vf-accent-subtle"
          : "border-vf-border-subtle hover:border-vf-border-strong hover:bg-vf-surface-2",
      )}
    >
      <span
        aria-hidden="true"
        className={cx("border", selected ? "border-vf-accent-text" : "border-vf-text-tertiary")}
        style={{ width: `${w}px`, height: `${h}px` }}
      />
      <span className="flex items-center gap-1 text-sm font-medium text-vf-text-primary">
        {preset.id === "custom" ? "Custom" : preset.id}
        {selected && (
          <span className="text-vf-accent-text" aria-hidden="true">
            ✓
          </span>
        )}
      </span>
      <span className="text-2xs text-vf-text-tertiary">{preset.label}</span>
    </button>
  );
}

// ── Template card (Templates_Design §1.2) — selection is sky-blue, NEVER amber ─────
function TemplateCard({
  manifest,
  selected,
  onSelect,
  registerRef,
  tabIndex,
  onKeyDown,
}: {
  manifest: TemplateManifest;
  selected: boolean;
  onSelect: () => void;
  registerRef: (el: HTMLButtonElement | null) => void;
  tabIndex: number;
  onKeyDown: (e: React.KeyboardEvent) => void;
}) {
  return (
    <button
      ref={registerRef}
      type="button"
      role="radio"
      aria-checked={selected}
      aria-label={`${manifest.name} — ${manifest.meta}`}
      tabIndex={tabIndex}
      onClick={onSelect}
      onKeyDown={onKeyDown}
      data-testid={`template-card-${manifest.id}`}
      className={cx(
        "flex flex-col overflow-hidden rounded-lg border text-left transition-colors",
        "duration-[var(--vf-motion-duration)] focus-visible:outline-none focus-visible:ring-2",
        "focus-visible:ring-[var(--vf-focus-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-vf-surface-4",
        selected
          ? "border-2 border-vf-selection bg-vf-surface-3"
          : "border-vf-border-subtle bg-vf-surface-2 hover:border-vf-border-default hover:bg-vf-surface-3",
      )}
    >
      {/* Poster region — a representative composite, letterboxed for the 9:16 content.
          A static gradient stands in until poster WebP assets are bundled (Iris §1.2). */}
      <div className="relative flex h-[110px] items-center justify-center bg-vf-surface-sunken">
        <div
          aria-hidden="true"
          className="h-[96px] w-[54px] rounded-sm bg-gradient-to-b from-vf-surface-3 to-vf-surface-4"
        />
        {/* Ratio badge (bottom-left), always visible. */}
        <span className="absolute bottom-1 left-1 rounded-pill bg-black/56 px-1.5 py-0.5 text-2xs font-medium text-vf-text-primary">
          {manifest.aspectRatio}
        </span>
        {/* Selected → sky-blue check badge (replaces the hover play overlay). */}
        {selected && (
          <span
            aria-hidden="true"
            className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-pill bg-vf-selection text-2xs text-white"
          >
            ✓
          </span>
        )}
      </div>
      <div className={cx("flex flex-col gap-0.5 px-2 py-1.5", selected && "bg-vf-accent-subtle")}>
        <span className="truncate text-sm font-semibold text-vf-text-primary">{manifest.name}</span>
        <span className="truncate text-2xs text-vf-text-tertiary">{manifest.meta}</span>
      </div>
    </button>
  );
}

export default function NewProjectModal() {
  const navigate = useNavigate();
  const close = useCallback(() => navigate("/"), [navigate]);
  const setManifestForProject = useTemplateStore((s) => s.setManifestForProject);

  // Equal-weight chooser by default (DEFAULT_RATIO === null). Flip DEFAULT_RATIO to a
  // RatioId to ship a pre-selected default (the CEO's pending 9:16 decision).
  const [selected, setSelected] = useState<RatioId | null>(DEFAULT_RATIO);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [customW, setCustomW] = useState("1080");
  const [customH, setCustomH] = useState("1080");
  const [creating, setCreating] = useState(false);
  const tileRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const cardRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const manifests = useMemo(() => listManifests(), []);

  const customValidation = useMemo(() => {
    const w = Number(customW);
    const h = Number(customH);
    const valid =
      Number.isInteger(w) &&
      Number.isInteger(h) &&
      w >= CUSTOM_MIN &&
      w <= CUSTOM_MAX &&
      h >= CUSTOM_MIN &&
      h <= CUSTOM_MAX;
    const ratio = valid ? (w / h).toFixed(2) : null;
    return { w, h, valid, ratio };
  }, [customW, customH]);

  const selectedPreset = selected === null ? null : PRESETS.find((p) => p.id === selected) ?? null;

  const canCreate =
    selected !== null && (selected !== "custom" || customValidation.valid) && !creating;

  // Roving tabindex across the ratio radiogroup (§4.3 / §19.4).
  const focusTile = (index: number) => {
    const clamped = (index + PRESETS.length) % PRESETS.length;
    tileRefs.current[clamped]?.focus();
    setSelected(PRESETS[clamped]!.id);
  };

  const onTileKeyDown = (index: number) => (e: React.KeyboardEvent) => {
    switch (e.key) {
      case "ArrowRight":
      case "ArrowDown":
        e.preventDefault();
        focusTile(index + 1);
        break;
      case "ArrowLeft":
      case "ArrowUp":
        e.preventDefault();
        focusTile(index - 1);
        break;
      case " ":
      case "Enter":
        e.preventDefault();
        setSelected(PRESETS[index]!.id);
        break;
    }
  };

  // Picking a template auto-selects its canonical ratio (9:16 for all 5, Iris §1.1).
  const selectTemplate = (manifest: TemplateManifest) => {
    setSelectedTemplateId(manifest.id);
    const ratioId = PRESETS.find((p) => p.id === manifest.aspectRatio)?.id ?? "9:16";
    setSelected(ratioId);
  };

  // Choosing a DIFFERENT ratio silently deselects the template (Iris §1.1).
  const selectRatio = (id: RatioId) => {
    setSelected(id);
    const tplRatio = selectedTemplateId
      ? manifests.find((m) => m.id === selectedTemplateId)?.aspectRatio
      : null;
    if (tplRatio && tplRatio !== id) setSelectedTemplateId(null);
  };

  const focusCard = (index: number) => {
    const clamped = (index + manifests.length) % manifests.length;
    cardRefs.current[clamped]?.focus();
    selectTemplate(manifests[clamped]!);
  };

  const onCardKeyDown = (index: number) => (e: React.KeyboardEvent) => {
    switch (e.key) {
      case "ArrowRight":
      case "ArrowDown":
        e.preventDefault();
        focusCard(index + 1);
        break;
      case "ArrowLeft":
      case "ArrowUp":
        e.preventDefault();
        focusCard(index - 1);
        break;
      case " ":
      case "Enter":
        e.preventDefault();
        selectTemplate(manifests[index]!);
        break;
    }
  };

  const handleCreate = useCallback(async () => {
    if (!canCreate || selected === null) return;
    const preset = PRESETS.find((p) => p.id === selected)!;
    const width = selected === "custom" ? customValidation.w : preset.width;
    const height = selected === "custom" ? customValidation.h : preset.height;
    setCreating(true);
    try {
      if (selectedTemplateId) {
        // Create-from-template: clone → persist supplied document → open in editor.
        const template = getTemplate(selectedTemplateId);
        if (!template) throw new Error("template not found");
        const { document, manifest } = cloneTemplateToProject(template, {
          title,
          ownerId: uuidv4(),
          workspaceId: uuidv4(),
        });
        const project = await createProject({
          title: document.title,
          width: document.canvas.width,
          height: document.canvas.height,
          frameRate: document.canvas.frameRate,
          document,
        });
        // Stash the rewritten manifest so the editor's slot-fill panel + export prune
        // can address the cloned document's elements (not persisted server-side).
        setManifestForProject(project.id, manifest);
        navigate(`/editor/${project.id}`);
        return;
      }
      const project = await createProject({ title, width, height });
      navigate(`/editor/${project.id}`);
    } catch {
      // createProject falls back to localStorage on network error and only
      // rejects on unexpected failures — re-enable the button so the user can retry.
      setCreating(false);
    }
  }, [canCreate, selected, customValidation, title, selectedTemplateId, navigate, setManifestForProject]);

  // First tile owns the tabindex when nothing is chosen; otherwise the chosen tile.
  const rovingIndex =
    selected === null ? 0 : Math.max(0, PRESETS.findIndex((p) => p.id === selected));
  const cardRovingIndex = selectedTemplateId
    ? Math.max(0, manifests.findIndex((m) => m.id === selectedTemplateId))
    : 0;

  return (
    <Modal
      open
      onClose={close}
      title="New project"
      widthClassName="max-w-[600px]"
      footer={
        <>
          <Button variant="ghost" onClick={close}>
            Cancel
          </Button>
          <Button
            variant="primary"
            aria-disabled={!canCreate}
            disabled={!canCreate}
            // Explain WHY the Create button is disabled when no ratio is chosen yet (§19.4).
            aria-describedby={selected === null ? "vf-create-hint" : undefined}
            onClick={handleCreate}
          >
            {creating ? "Creating…" : selectedTemplateId ? "Use template →" : "Create project"}
          </Button>
          <span id="vf-create-hint" className="sr-only">
            Choose an aspect ratio first
          </span>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        <div>
          <div className="mb-3 text-md font-semibold text-vf-text-primary">
            Choose an aspect ratio
          </div>
          <div
            role="radiogroup"
            aria-label="Aspect ratio"
            className="grid grid-cols-5 gap-2"
          >
            {PRESETS.map((preset, i) => (
              <RatioTile
                key={preset.id}
                preset={preset}
                selected={selected === preset.id}
                tabIndex={i === rovingIndex ? 0 : -1}
                registerRef={(el) => {
                  tileRefs.current[i] = el;
                }}
                onSelect={() => selectRatio(preset.id)}
                onKeyDown={onTileKeyDown(i)}
              />
            ))}
          </div>
          {/* Reactive hint line: reflects the chosen ratio / template; falls back to the
              equal-weight prompt when nothing is selected. aria-live so SRs hear the change. */}
          <p className="mt-2 min-h-[1rem] text-2xs text-vf-text-tertiary" aria-live="polite">
            {selectedTemplateId
              ? `${manifests.find((m) => m.id === selectedTemplateId)?.name} · opens at ${manifests.find((m) => m.id === selectedTemplateId)?.aspectRatio}`
              : selectedPreset
                ? selectedPreset.reactiveHint
                : "Nothing is pre-selected — pick the orientation for your video."}
          </p>
        </div>

        {selected === "custom" && (
          <div className="flex flex-col gap-3 rounded-md border border-vf-border-subtle bg-vf-surface-2 p-4">
            <div className="grid grid-cols-2 gap-3">
              <Field
                label="Width (px)"
                type="number"
                inputMode="numeric"
                min={CUSTOM_MIN}
                max={CUSTOM_MAX}
                value={customW}
                onChange={(e) => setCustomW(e.target.value)}
                error={
                  !customValidation.valid && customW !== ""
                    ? `Must be ${CUSTOM_MIN}–${CUSTOM_MAX}px`
                    : undefined
                }
              />
              <Field
                label="Height (px)"
                type="number"
                inputMode="numeric"
                min={CUSTOM_MIN}
                max={CUSTOM_MAX}
                value={customH}
                onChange={(e) => setCustomH(e.target.value)}
                error={
                  !customValidation.valid && customH !== ""
                    ? `Must be ${CUSTOM_MIN}–${CUSTOM_MAX}px`
                    : undefined
                }
              />
            </div>
            {customValidation.ratio && (
              <p className="text-xs text-vf-text-tertiary" aria-live="polite">
                ≈ {customValidation.ratio}:1 — unusual ratios for social are fine.
              </p>
            )}
          </div>
        )}

        {/* ── Or start from a template (Templates_Design §1) ── */}
        <section aria-labelledby="tpl-heading" className="flex flex-col gap-3">
          <div className="border-t border-vf-border-subtle pt-4">
            <div id="tpl-heading" className="text-sm font-medium text-vf-text-secondary">
              Or start from a template
            </div>
          </div>
          <div role="radiogroup" aria-labelledby="tpl-heading" className="grid grid-cols-5 gap-2">
            {manifests.map((m, i) => (
              <TemplateCard
                key={m.id}
                manifest={m}
                selected={selectedTemplateId === m.id}
                tabIndex={i === cardRovingIndex ? 0 : -1}
                registerRef={(el) => {
                  cardRefs.current[i] = el;
                }}
                onSelect={() => selectTemplate(m)}
                onKeyDown={onCardKeyDown(i)}
              />
            ))}
          </div>
        </section>

        <Field
          label="Project name (optional)"
          placeholder="Untitled project"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
      </div>
    </Modal>
  );
}
