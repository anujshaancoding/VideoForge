/**
 * Command Bar — the structured, typeahead-driven edit bar (user-facing name:
 * "Command Bar"). It is the single edit-command surface in the editor (the old
 * free-text bar has been removed). A thin React interaction layer over the pure
 * engine in `apps/web/src/ai-edit/{grammar,suggest}.ts`:
 *
 *   slots ──getSuggestions──▶ dropdown
 *   slots ──getSlotMachineState──▶ current slot / advance / complete
 *   slots ──planFromSlots(context)──▶ { command, plan } ──validateEditPlan──▶ preview
 *
 * It reuses the existing preview panel (preview-before-apply) and the
 * `applyAIEditPlan` store action — rendering logic is NOT forked. No parsing,
 * schema, or apply code is reimplemented here; this file is additive UI only.
 *
 * Mounted unconditionally in Editor.tsx, focused via ⌘K / `vf:focus-ai-edit`.
 * Chrome/Edge, React 18, keyboard-first. Design Brief + PRD compliant: sky-blue
 * (`--vf-selection`) Run button (NOT amber), removable pills, ghost text, 9-grid
 * position picker, ARIA combobox. On a complete ranged command it sets the
 * transient `commandDryRunRange` so the Timeline paints a dry-run highlight band
 * (§7.3/§8.6); cleared on apply/cancel/blur/Esc.
 *
 * NOTE: the `ai-edit/` directory + `AIEdit*`/`applyAIEditPlan` identifiers are kept
 * as internal module names to avoid churn — the user-facing copy is "Command Bar".
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { ChevronRight, Clock, Command, X } from "lucide-react";
import { buildTimelineContext } from "../../../ai-edit/context.js";
import {
  COMMAND_GRAMMAR,
  findAction,
  findProperty,
  type SlotKind,
} from "../../../ai-edit/grammar.js";
import {
  getSlotMachineState,
  getSuggestions,
  planFromSlots,
  type CommandSlots,
  type Suggestion,
} from "../../../ai-edit/suggest.js";
import type { EditPlan, ValidationResult } from "../../../ai-edit/types.js";
import { validateEditPlan } from "../../../ai-edit/validation.js";
import { useEditorStore } from "../../../store/editorStore.js";
import { cx } from "../../ui/cx.js";
import AIEditPreviewPanel from "./AIEditPreviewPanel.js";

// `CommandSlots` is readonly (engine contract). A mutable mirror lets the bar build
// the next slot set imperatively before handing an immutable value back to state.
type MutableSlots = { -readonly [K in keyof CommandSlots]: CommandSlots[K] };

// ── Pending plan (mirrors the old bar's shape for the preview panel) ──
interface PendingPlan {
  command: string;
  plan: EditPlan;
  validation: ValidationResult;
}

// ── Slot pill styling (Design Brief §4.2 — slot-differentiated fills) ──
const SLOT_PILL_CLASS: Record<Exclude<SlotKind, never>, string> = {
  action: "border-vf-border-default",
  // OBJECT pill: faint sky-blue border to anchor it as the semantic heart.
  property: "border-vf-selection/40",
  value: "border-vf-border-default",
  position: "border-vf-border-default",
};

/** A read-only target descriptor resolved from selection → playhead → none. */
interface ResolvedTarget {
  label: string;
  error: boolean;
}

/**
 * Derive the timeline ms range a plan will affect, for the dry-run highlight band
 * (Design Brief §7.3/§8.6). Plan action targets are in SECONDS (parser contract);
 * we return integer ms. Resolution, in priority order:
 *   1. an action carrying an explicit start/end range (trim/cut/delete/zoom/caption)
 *   2. a point edit (split/move) → the affected clip's full range (so the band shows
 *      WHICH clip is touched), resolving the clip from the action's clipId or the
 *      clip whose range contains the point.
 * Returns `null` for plans with no spatial/temporal footprint (e.g. mute, aspect
 * ratio, brightness on the whole clip) — nothing to highlight.
 */
function dryRunRangeFromPlan(
  plan: EditPlan,
  context: { clips: ReadonlyArray<{ id: string; startTime: number; endTime: number }> },
): { startMs: number; endMs: number } | null {
  const toMs = (seconds: number) => Math.max(0, Math.round(seconds * 1000));
  for (const action of plan.actions) {
    const target = (action as { target?: { startTime?: number; endTime?: number; time?: number; clipId?: string } }).target;
    if (!target) continue;

    // 1. Explicit range.
    if (typeof target.startTime === "number" && typeof target.endTime === "number" && target.endTime > target.startTime) {
      return { startMs: toMs(target.startTime), endMs: toMs(target.endTime) };
    }

    // 2. Point edit (split/move) → resolve the affected clip's range.
    const point = typeof target.time === "number" ? target.time : target.startTime;
    if (typeof point === "number") {
      const clip =
        (target.clipId ? context.clips.find((c) => c.id === target.clipId) : undefined) ??
        context.clips.find((c) => point >= c.startTime && point < c.endTime);
      if (clip) return { startMs: toMs(clip.startTime), endMs: toMs(clip.endTime) };
    }
  }
  return null;
}

export default function CommandEditBar() {
  const project = useEditorStore((state) => state.project);
  const selection = useEditorStore((state) => state.selection);
  const playheadMs = useEditorStore((state) => state.playheadMs);
  const applyAIEditPlan = useEditorStore((state) => state.applyAIEditPlan);
  const setCommandDryRunRange = useEditorStore((state) => state.setCommandDryRunRange);

  const [slots, setSlots] = useState<CommandSlots>({});
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<PendingPlan | null>(null);
  const [loading, setLoading] = useState(false);
  const [notAvailable, setNotAvailable] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  const liveRef = useRef<HTMLDivElement>(null);

  // ── Timeline context: selection (clip) wins, rebuilt live as selection changes ──
  const context = useMemo(
    () => buildTimelineContext(project, selection.kind === "clip" ? selection.id : undefined),
    [project, selection],
  );

  // ── Target pill: (1) selected clip, (2) clip at playhead, (3) inline error ──
  const target = useMemo<ResolvedTarget>(() => {
    if (selection.kind === "clip" && selection.id) {
      const clip = context.clips.find((c) => c.id === selection.id);
      return { label: clip ? clip.name : "selected clip", error: false };
    }
    const playheadSeconds = playheadMs / 1000;
    const atPlayhead = context.clips.find(
      (c) => playheadSeconds >= c.startTime && playheadSeconds < c.endTime,
    );
    if (atPlayhead) return { label: `${atPlayhead.name} (at playhead)`, error: false };
    return { label: "No clip selected or at playhead", error: true };
  }, [selection, context, playheadMs]);

  const machine = useMemo(() => getSlotMachineState(slots), [slots]);
  const suggestions = useMemo<Suggestion[]>(
    () => (machine.currentSlot ? getSuggestions(slots, query) : []),
    [slots, query, machine.currentSlot],
  );

  // The chosen property tells us whether the POSITION slot (9-grid) applies.
  const currentProperty = useMemo(() => {
    const action = slots.action ? findAction(COMMAND_GRAMMAR, slots.action) : undefined;
    return action && slots.property ? findProperty(action, slots.property) : undefined;
  }, [slots.action, slots.property]);
  const showPositionGrid = machine.currentSlot === "position" && currentProperty?.hasPosition === true;

  // ── Ghost text: shortest suggestion completing the typed prefix ──
  const ghost = useMemo(() => {
    if (!query.trim() || suggestions.length === 0) return "";
    const top = suggestions[0];
    if (!top || top.kind === "parsed-value") return "";
    const lower = query.trim().toLowerCase();
    if (top.value.toLowerCase().startsWith(lower)) return top.value.slice(query.trim().length);
    if (top.label.toLowerCase().startsWith(lower)) return top.label.slice(query.trim().length);
    return "";
  }, [query, suggestions]);

  // Clamp the highlight whenever the suggestion list changes.
  useEffect(() => {
    setHighlight((h) => (suggestions.length === 0 ? 0 : Math.min(h, suggestions.length - 1)));
  }, [suggestions]);

  // ── ⌘K + vf:focus-ai-edit focus wiring (preserved from the old bar) ──
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.code === "KeyK") {
        event.preventDefault();
        inputRef.current?.focus();
        setOpen(true);
      }
    };
    document.addEventListener("keydown", onKeyDown, { capture: true });
    return () => document.removeEventListener("keydown", onKeyDown, { capture: true });
  }, []);

  useEffect(() => {
    const onFocus = () => {
      inputRef.current?.focus();
      setOpen(true);
    };
    window.addEventListener("vf:focus-ai-edit", onFocus);
    return () => window.removeEventListener("vf:focus-ai-edit", onFocus);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(null), 2600);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  // Always clear the transient dry-run band when the bar unmounts (leaving the editor),
  // so a stale highlight can never linger on the timeline.
  useEffect(() => () => setCommandDryRunRange(null), [setCommandDryRunRange]);

  // ── Live region announcements (Design Brief §6.1) ──
  const announce = useCallback((message: string) => {
    if (liveRef.current) liveRef.current.textContent = message;
  }, []);

  // ── Slot mutation: write a value into the current slot + advance focus ──
  const setSlot = useCallback((kind: SlotKind, value: string) => {
    setSlots((prev) => {
      const next: MutableSlots = { ...prev };
      if (kind === "action") {
        // Changing action invalidates downstream slots.
        return { action: value };
      }
      if (kind === "property") {
        next.property = value;
        delete next.value;
        delete next.position;
        return next;
      }
      if (kind === "value") {
        next.value = value;
        return next;
      }
      next.position = value;
      return next;
    });
    setQuery("");
    setHighlight(0);
    setNotAvailable(null);
  }, []);

  // ── Accept a suggestion into the current slot ──
  const acceptSuggestion = useCallback(
    (suggestion: Suggestion) => {
      const slot = machine.currentSlot;
      if (!slot) return;
      // parsed-value / enum / anchor carry the exact string to insert; action/property
      // use their canonical token.
      const inserted = suggestion.insert ?? suggestion.value;
      setSlot(slot, inserted);
      announce(`${suggestion.label} accepted.`);
      // Keep the input focused; the dropdown re-scopes to the next slot automatically.
      requestAnimationFrame(() => inputRef.current?.focus());
    },
    [machine.currentSlot, setSlot, announce],
  );

  // ── Remove the last accepted pill (Backspace on empty input) ──
  const removeLastPill = useCallback(() => {
    setSlots((prev) => {
      const next: MutableSlots = { ...prev };
      if (next.position !== undefined) {
        delete next.position;
      } else if (next.value !== undefined) {
        delete next.value;
      } else if (next.property !== undefined) {
        delete next.property;
      } else if (next.action !== undefined) {
        delete next.action;
      }
      return next;
    });
    setQuery("");
    setHighlight(0);
    setNotAvailable(null);
    setOpen(true);
  }, []);

  // Remove a specific pill AND everything to its right (later slots depend on earlier).
  const removePillAndAfter = useCallback((slot: SlotKind) => {
    setSlots((prev) => {
      const order: SlotKind[] = ["action", "property", "value", "position"];
      const idx = order.indexOf(slot);
      const next: MutableSlots = { ...prev };
      for (const s of order.slice(idx)) delete next[s];
      return next;
    });
    setQuery("");
    setHighlight(0);
    setNotAvailable(null);
    requestAnimationFrame(() => inputRef.current?.focus());
  }, []);

  const resetBar = useCallback(() => {
    setSlots({});
    setQuery("");
    setHighlight(0);
    setNotAvailable(null);
    setOpen(false);
    setCommandDryRunRange(null);
  }, [setCommandDryRunRange]);

  // ── Run: slots → string → existing parser → plan → validate → preview ──
  const run = useCallback(() => {
    if (!machine.isComplete) return;
    if (target.error) {
      setToast("No clip selected or at playhead");
      return;
    }
    setLoading(true);
    setNotAvailable(null);
    try {
      const { command, plan } = planFromSlots(slots, context);
      if (!command || !plan) {
        // Remaining gap: any slot combination the parser still can't represent.
        // (split / move / text-overlay now produce real plans — Command Editing v1.)
        setNotAvailable("That command isn't available yet.");
        return;
      }
      const validation = validateEditPlan(plan, context);
      setPending({
        command,
        plan: { ...plan, requiresConfirmation: validation.requiresConfirmation },
        validation,
      });
      // Dry-run highlight (Design Brief §7.3/§8.6): paint a translucent band over the
      // ms range this command will affect so the user sees the footprint before apply.
      setCommandDryRunRange(dryRunRangeFromPlan(plan, context));
      setOpen(false);
    } finally {
      setLoading(false);
    }
  }, [machine.isComplete, target.error, slots, context, setCommandDryRunRange]);

  const applyPending = useCallback(() => {
    if (!pending || !pending.validation.valid) return;
    const result = applyAIEditPlan(pending.plan);
    if (result.errors.length > 0) {
      setToast(result.errors[0] ?? "Could not apply edits");
      return;
    }
    const suffix = result.warnings.length > 0 ? ` (${result.warnings[0]})` : "";
    setToast(
      result.applied > 0
        ? `Applied ${result.applied} edit${result.applied === 1 ? "" : "s"}${suffix}`
        : "Command understood, but no edit was applied",
    );
    setPending(null);
    resetBar();
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [applyAIEditPlan, pending, resetBar]);

  // ── Keyboard map (Design Brief §6.2) ──
  const onInputKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLInputElement>) => {
      // Numpad 1–9 selects a 9-grid anchor directly when the POSITION grid is open.
      if (showPositionGrid && /^[1-9]$/.test(event.key)) {
        const anchor = COMMAND_GRAMMAR.positionAnchors.find((a) => a.key === Number(event.key));
        if (anchor) {
          event.preventDefault();
          acceptSuggestion({ value: anchor.value, label: anchor.label, kind: "anchor", insert: anchor.value });
          return;
        }
      }

      switch (event.key) {
        case "ArrowDown":
          event.preventDefault();
          if (!open) setOpen(true);
          setHighlight((h) => (suggestions.length === 0 ? 0 : (h + 1) % suggestions.length));
          break;
        case "ArrowUp":
          event.preventDefault();
          setHighlight((h) => (suggestions.length === 0 ? 0 : (h - 1 + suggestions.length) % suggestions.length));
          break;
        case "ArrowRight":
          // Accept ghost completion when the caret is at the end.
          if (ghost && event.currentTarget.selectionStart === query.length) {
            event.preventDefault();
            setQuery(query + ghost);
          }
          break;
        case "Enter": {
          event.preventDefault();
          const picked = suggestions[highlight];
          if (open && picked) {
            acceptSuggestion(picked);
          } else if (machine.isComplete) {
            run();
          }
          break;
        }
        case "Tab": {
          if (open && suggestions.length > 0) {
            event.preventDefault();
            const picked = suggestions[highlight];
            if (picked) acceptSuggestion(picked);
          }
          // else: let Tab move focus to the Run button naturally.
          break;
        }
        case "Backspace":
          if (query.length === 0) {
            event.preventDefault();
            removeLastPill();
          }
          break;
        case "Escape":
          event.preventDefault();
          if (open) {
            setOpen(false);
          } else if (slots.action) {
            resetBar();
          }
          break;
        default:
          break;
      }
    },
    [
      machine.isComplete,
      showPositionGrid,
      open,
      suggestions,
      highlight,
      ghost,
      query,
      slots.action,
      acceptSuggestion,
      removeLastPill,
      resetBar,
      run,
    ],
  );

  const placeholder = useMemo(() => {
    if (slots.action === undefined) return "Type a command or press Space to browse…";
    if (machine.currentSlot) return COMMAND_GRAMMAR.prompts[machine.currentSlot];
    return "";
  }, [slots.action, machine.currentSlot]);

  const slotHeader = machine.currentSlot ? COMMAND_GRAMMAR.prompts[machine.currentSlot] : "";

  // ── Accepted pills, in slot order ──
  const pills: { slot: SlotKind; label: string }[] = [];
  if (slots.action) pills.push({ slot: "action", label: slots.action });
  if (slots.property) {
    const action = findAction(COMMAND_GRAMMAR, slots.action ?? "");
    const prop = action ? findProperty(action, slots.property) : undefined;
    pills.push({ slot: "property", label: prop?.label ?? slots.property });
  }
  if (slots.value) pills.push({ slot: "value", label: slots.value });
  if (slots.position) pills.push({ slot: "position", label: slots.position });

  const runEnabled = machine.isComplete && !target.error;

  return (
    <div className="relative border-b border-vf-border-subtle bg-vf-surface-1 px-3 py-2">
      {pending && (
        <AIEditPreviewPanel
          command={pending.command}
          plan={pending.plan}
          validation={pending.validation}
          onApply={applyPending}
          onCancel={() => {
            // Cancel ABANDONS the command: clear the preview AND the built pills so the
            // bar returns to an empty state ready for a fresh command (no leftover pills).
            setPending(null);
            resetBar();
            requestAnimationFrame(() => inputRef.current?.focus());
          }}
        />
      )}

      <div
        role="group"
        aria-label="Command Bar"
        className="flex items-start gap-2"
      >
        <div className="mt-1 rounded bg-vf-surface-3 p-1 text-vf-selection">
          <Command className="h-4 w-4" aria-hidden="true" />
        </div>

        {/* Pill row + the single live input for the current slot */}
        <div className="relative min-w-0 flex-1">
          {/* Clicking the empty row whitespace focuses the input (pointer affordance);
              keyboard users reach the input directly via Tab / ⌘K, so no key handler is
              needed on this presentational container. */}
          <div
            role="presentation"
            className="flex min-h-9 flex-wrap items-center gap-2 rounded border border-vf-border-subtle bg-vf-bg-app px-2 py-1.5 focus-within:border-vf-selection"
            onMouseDown={(e) => {
              if (e.target === e.currentTarget) inputRef.current?.focus();
            }}
          >
            {/* Context (target) pill — read-only, dashed, auto-resolved */}
            <span
              role="status"
              aria-label={`Target: ${target.label}`}
              className={cx(
                "inline-flex h-6 items-center gap-1 rounded-pill border border-dashed px-2 text-xs",
                target.error
                  ? "border-vf-danger-fg/50 text-vf-danger-fg"
                  : "border-vf-border-strong text-vf-text-secondary",
              )}
            >
              {target.label}
            </span>

            {pills.map((pill) => (
              <span
                key={pill.slot}
                aria-label={`${pill.slot}: ${pill.label}. Press Backspace to remove.`}
                className={cx(
                  "inline-flex h-6 items-center gap-1 rounded-pill border bg-vf-surface-3 px-2 text-xs font-medium text-vf-text-primary",
                  SLOT_PILL_CLASS[pill.slot],
                )}
              >
                <span className={pill.slot === "value" || pill.slot === "position" ? "font-mono" : undefined}>
                  {pill.label}
                </span>
                <button
                  type="button"
                  tabIndex={-1}
                  aria-label={`Remove '${pill.label}'`}
                  onClick={(e) => {
                    e.stopPropagation();
                    removePillAndAfter(pill.slot);
                  }}
                  className="text-vf-icon-muted hover:text-vf-text-primary"
                >
                  <X className="h-3 w-3" aria-hidden="true" />
                </button>
              </span>
            ))}

            {/* Current-slot input + ghost text overlay */}
            {machine.currentSlot && (
              <span className="relative inline-flex min-w-[8rem] flex-1 items-center">
                <input
                  ref={inputRef}
                  role="combobox"
                  aria-expanded={open}
                  aria-haspopup="listbox"
                  aria-controls="vf-cmd-slot-list"
                  aria-autocomplete="list"
                  aria-label={`${slotHeader} (step ${slotStepNumber(machine.currentSlot)} of 4)`}
                  aria-activedescendant={
                    open && suggestions[highlight] ? `vf-cmd-opt-${highlight}` : undefined
                  }
                  value={query}
                  placeholder={placeholder}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setOpen(true);
                    setHighlight(0);
                  }}
                  onFocus={() => setOpen(true)}
                  onBlur={() => {
                    // Abandoning the bar without running clears the dry-run band. While a
                    // preview is pending, the band is intentional — leave it (apply/cancel
                    // clear it). The dropdown's option mousedown calls preventDefault, so
                    // accepting a suggestion does not blur the input.
                    if (!pending) setCommandDryRunRange(null);
                  }}
                  onKeyDown={onInputKeyDown}
                  className="w-full bg-transparent text-sm text-vf-text-primary outline-none placeholder:text-vf-text-tertiary"
                />
                {ghost && (
                  <span
                    aria-hidden="true"
                    className="pointer-events-none absolute left-0 whitespace-pre text-sm text-vf-text-tertiary/80"
                  >
                    <span className="invisible">{query}</span>
                    {ghost}
                  </span>
                )}
              </span>
            )}
          </div>

          {/* Dropdown (progressive disclosure) */}
          {open && machine.currentSlot && (
            <div
              className="absolute left-0 top-full z-[200] mt-1 max-h-[280px] min-w-[280px] overflow-auto rounded-md border border-vf-border-default bg-vf-surface-4 shadow-vf-3"
            >
              <div className="px-3 py-1.5 text-2xs uppercase tracking-[0.06em] text-vf-text-tertiary">
                {slotHeader}
              </div>

              {showPositionGrid && <PositionGrid selected={query} onPick={acceptSuggestion} />}

              {/* ARIA combobox listbox. Plain <div>s carry the listbox/option roles so the
                  WAI-ARIA combobox pattern is honored without misusing native list elements.
                  Options are selected via the input's keyboard map and pointer mousedown. */}
              <div id="vf-cmd-slot-list" role="listbox" aria-label={`${slotHeader} suggestions`}>
                {suggestions.length === 0 ? (
                  <div className="px-3 py-2 text-xs text-vf-text-tertiary">
                    No matches{query.trim() ? ` for "${query.trim()}"` : ""}
                  </div>
                ) : (
                  suggestions.map((s, i) => (
                    <div
                      id={`vf-cmd-opt-${i}`}
                      key={`${s.kind}-${s.value}`}
                      role="option"
                      tabIndex={-1}
                      aria-selected={i === highlight}
                      onMouseEnter={() => setHighlight(i)}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        acceptSuggestion(s);
                      }}
                      className={cx(
                        "flex h-9 cursor-pointer items-center gap-2 px-3 text-sm",
                        i === highlight
                          ? "border-l-2 border-vf-selection bg-vf-surface-3 text-vf-text-primary"
                          : "border-l-2 border-transparent text-vf-text-secondary hover:bg-vf-surface-2",
                      )}
                    >
                      {s.kind === "parsed-value" && (
                        <Clock className="h-3.5 w-3.5 text-vf-selection" aria-hidden="true" />
                      )}
                      <span className="text-vf-text-primary">{s.label}</span>
                      {s.hint && <span className="ml-auto text-xs text-vf-text-tertiary">{s.hint}</span>}
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {notAvailable && (
            <div className="mt-1 text-xs text-vf-warning-fg">{notAvailable}</div>
          )}
        </div>

        {/* Run button — sky-blue (--vf-selection) when active, NEVER amber. */}
        <button
          type="button"
          onClick={run}
          aria-disabled={!runEnabled}
          aria-label={`Run command${slots.action ? `: ${[slots.action, slots.property, slots.value, slots.position].filter(Boolean).join(" ")}` : ""}`}
          className={cx(
            "mt-0.5 inline-flex h-9 items-center gap-1 rounded px-3 text-xs font-semibold",
            runEnabled
              ? "bg-vf-selection text-white"
              : "cursor-not-allowed bg-vf-surface-3 text-vf-text-disabled",
          )}
        >
          {loading ? (
            <Clock className="h-4 w-4 animate-spin text-vf-selection" aria-hidden="true" />
          ) : (
            <>
              Run
              {runEnabled && <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />}
            </>
          )}
        </button>
      </div>

      <div ref={liveRef} role="status" aria-live="polite" aria-atomic="true" className="sr-only" />

      {toast && (
        <div className="absolute right-3 top-2 z-[60] rounded border border-vf-border-subtle bg-vf-surface-3 px-3 py-1.5 text-xs text-vf-text-primary shadow-vf-2">
          {toast}
        </div>
      )}
    </div>
  );
}

/** 1-based slot step for the ARIA "step N of 4" label. */
function slotStepNumber(slot: SlotKind): number {
  return { action: 1, property: 2, value: 3, position: 4 }[slot];
}

/** 9-grid anchor picker (Design Brief §5.1). Rows are visual (top→bottom). */
function PositionGrid({
  selected,
  onPick,
}: {
  selected: string;
  onPick: (s: Suggestion) => void;
}) {
  // Visual order: top row first. Numpad keys: 7 8 9 / 4 5 6 / 1 2 3.
  const order = [7, 8, 9, 4, 5, 6, 1, 2, 3];
  const anchors = order
    .map((key) => COMMAND_GRAMMAR.positionAnchors.find((a) => a.key === key))
    .filter((a): a is NonNullable<typeof a> => a !== undefined);
  return (
    <div className="px-3 py-2">
      <div className="grid w-[148px] grid-cols-3 gap-1" role="group" aria-label="Position anchor grid">
        {anchors.map((anchor) => {
          const isSelected = selected === anchor.value;
          return (
            <button
              key={anchor.value}
              type="button"
              aria-label={`${anchor.label} (key ${anchor.key})`}
              aria-pressed={isSelected}
              onMouseDown={(e) => {
                e.preventDefault();
                onPick({ value: anchor.value, label: anchor.label, kind: "anchor", insert: anchor.value });
              }}
              className={cx(
                "relative flex h-11 w-11 items-center justify-center rounded border text-xs",
                isSelected
                  ? "border-vf-selection bg-vf-selection/20 text-vf-text-primary"
                  : "border-vf-border-subtle bg-vf-surface-3 text-vf-text-secondary hover:brightness-110",
              )}
            >
              <span className="absolute left-1 top-0.5 text-2xs text-vf-text-tertiary">{anchor.key}</span>
              {abbreviate(anchor.value)}
              {isSelected && <span className="absolute bottom-1 h-1 w-1 rounded-full bg-vf-selection" />}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** "top-left" → "TL", "center" → "C", etc. */
function abbreviate(value: string): string {
  const parts = value.split("-");
  if (parts.length === 1) return "C";
  return parts.map((p) => p[0]!.toUpperCase()).join("");
}
