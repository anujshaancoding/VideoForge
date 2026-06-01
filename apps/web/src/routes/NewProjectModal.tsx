import { useCallback, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { createProject } from "../lib/projectStore.js";
import { Button, Field, Modal } from "../components/ui/index.js";
import { cx } from "../components/ui/cx.js";

// New Project modal (§4.3) — the HERO aspect-ratio chooser. Five proportional,
// equally-weighted tiles with NO pre-selected default (radiogroup; arrow keys move
// roving focus; Space/Enter selects). Create is disabled until a ratio is chosen.
// Choosing → createProject(canvasConfig) → navigate to /editor/:id. Rendered as a
// route over the dashboard so context is never lost.

type RatioId = "9:16" | "16:9" | "1:1" | "4:5" | "custom";

interface RatioPreset {
  id: RatioId;
  label: string;
  hint: string;
  width: number;
  height: number;
}

// Logical resolutions per Spec §2.2 (Free-tier export caps at 1080p, all satisfy).
const PRESETS: RatioPreset[] = [
  { id: "9:16", label: "Vertical", hint: "TikTok · Reels · Shorts", width: 1080, height: 1920 },
  { id: "16:9", label: "Horizontal", hint: "YouTube · desktop", width: 1920, height: 1080 },
  { id: "1:1", label: "Square", hint: "Instagram feed", width: 1080, height: 1080 },
  { id: "4:5", label: "Portrait", hint: "Instagram portrait", width: 1080, height: 1350 },
  { id: "custom", label: "Custom", hint: "your size", width: 1080, height: 1080 },
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

export default function NewProjectModal() {
  const navigate = useNavigate();
  const close = useCallback(() => navigate("/"), [navigate]);

  const [selected, setSelected] = useState<RatioId | null>(null);
  const [title, setTitle] = useState("");
  const [customW, setCustomW] = useState("1080");
  const [customH, setCustomH] = useState("1080");
  const [creating, setCreating] = useState(false);
  const tileRefs = useRef<Array<HTMLButtonElement | null>>([]);

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

  const canCreate =
    selected !== null && (selected !== "custom" || customValidation.valid) && !creating;

  // Roving tabindex across the radiogroup (§4.3 / §19.4).
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

  const handleCreate = useCallback(async () => {
    if (!canCreate || selected === null) return;
    const preset = PRESETS.find((p) => p.id === selected)!;
    const width = selected === "custom" ? customValidation.w : preset.width;
    const height = selected === "custom" ? customValidation.h : preset.height;
    setCreating(true);
    try {
      const project = await createProject({ title, width, height });
      navigate(`/editor/${project.id}`);
    } catch {
      // createProject falls back to localStorage on network error and only
      // rejects on unexpected failures — re-enable the button so the user can retry.
      setCreating(false);
    }
  }, [canCreate, selected, customValidation, title, navigate]);

  // First tile owns the tabindex when nothing is chosen; otherwise the chosen tile.
  const rovingIndex =
    selected === null ? 0 : Math.max(0, PRESETS.findIndex((p) => p.id === selected));

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
            onClick={handleCreate}
          >
            {creating ? "Creating…" : "Create project"}
          </Button>
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
                onSelect={() => setSelected(preset.id)}
                onKeyDown={onTileKeyDown(i)}
              />
            ))}
          </div>
          <p className="mt-2 text-2xs text-vf-text-tertiary">
            Nothing is pre-selected — pick the orientation for your video.
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
