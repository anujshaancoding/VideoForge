/**
 * Slot/suggestion engine for Command Editing — pure, headless, deterministic.
 *
 * Responsibilities (no React, no network):
 *  1. Progressive disclosure: given the accepted slots + the in-progress text for the current
 *     slot, return the ordered list of valid next suggestions (only what is valid next),
 *     including live-parsed value options (e.g. typing "0:30" yields a parsed time option).
 *  2. Serialization: turn a completed slot set into the command STRING that the existing
 *     `parseEditCommandLocal` accepts, and expose a helper that runs
 *     slots -> string -> `parseEditCommandLocal` -> `EditPlan`.
 *  3. A tiny state machine: current slot, canAdvance, isComplete, what the next slot is.
 *
 * Honors Design Brief decision #8 (§7.4): the structured slots SERIALIZE to a command string
 * the existing parser handles, so the tested parser/validation/apply pipeline is reused
 * unchanged. This module adds NO new parser logic.
 */

import {
  COMMAND_GRAMMAR,
  GRAMMAR_ACTION_TYPES,
  defaultPositionAnchor,
  findAction,
  findProperty,
  type ActionNode,
  type CommandGrammar,
  type PropertyNode,
  type SlotKind,
  type ValueDescriptor,
} from "./grammar.js";
import { parseEditCommandLocal } from "./parser.js";
import { formatSeconds, parseTimeToSeconds } from "./time.js";
import type { EditPlan, TimelineContext } from "./types.js";

// ---------------------------------------------------------------------------
// Slot state
// ---------------------------------------------------------------------------

/** The user's accepted selections so far. Tokens are canonical grammar values. */
export interface CommandSlots {
  readonly action?: string;
  readonly property?: string;
  /**
   * The serialized VALUE fragment, already in command-string form (e.g. "by 10%",
   * "0:30 to 0:43", "at 0:30", '"Hello"'). For `none`-kind properties this is omitted.
   */
  readonly value?: string;
  /** Position anchor token (spatial objects only, e.g. "bottom-center"). */
  readonly position?: string;
}

/** Categories a suggestion can belong to, so the UI can style/group them. */
export type SuggestionKind = "action" | "property" | "enum" | "parsed-value" | "anchor";

export interface Suggestion {
  /** The canonical token this suggestion inserts into the current slot. */
  readonly value: string;
  /** Display label. */
  readonly label: string;
  /** Secondary descriptor copy. */
  readonly hint?: string;
  /** Which slot this fills + how to render it. */
  readonly kind: SuggestionKind;
  /**
   * For `parsed-value` suggestions: the canonical command-string fragment to store in
   * `slots.value` when accepted (e.g. "at 0:30", "by 10%", "0:30 to 0:43").
   */
  readonly insert?: string;
}

// ---------------------------------------------------------------------------
// State machine
// ---------------------------------------------------------------------------

export interface SlotMachineState {
  /** The slot the user is currently filling. `null` when the command is complete. */
  readonly currentSlot: SlotKind | null;
  /** The next slot after the current one, or `null` if none. */
  readonly nextSlot: SlotKind | null;
  /** True when every required slot is filled (POSITION is optional). */
  readonly isComplete: boolean;
  /** True when the current slot has a value and the machine can move to the next slot. */
  readonly canAdvance: boolean;
}

/** Does the chosen action/property require a VALUE slot? (`none`-kind => no value slot.) */
function hasValueSlot(property: PropertyNode | undefined): boolean {
  return property !== undefined && property.valueDescriptor.kind !== "none";
}

/** Does the chosen property expose the optional POSITION slot? */
function hasPositionSlot(property: PropertyNode | undefined): boolean {
  return property?.hasPosition === true;
}

/**
 * Auto-fill a deterministic single-option PROPERTY slot so the user can type the value
 * directly — "trim 0:01 to 0:03" instead of the clunky "trim · clip · 0:01 to 0:03", and
 * "split at 0:20" / "delete 0:05 to 0:06" / "set 80%" without an extra obvious pick.
 *
 * Only the property slot is auto-resolved, and only when the action exposes exactly one
 * property (trim/split/move → "clip", delete → "range", set → "volume", mute → "audio").
 * Multi-option actions (increase/decrease/add/fade) still prompt for the property, since
 * there the choice is meaningful. Idempotent.
 */
export function resolveImpliedSlots(slots: CommandSlots, grammar: CommandGrammar = COMMAND_GRAMMAR): CommandSlots {
  if (!slots.action || slots.property) return slots;
  const action = findAction(grammar, slots.action);
  if (action && action.properties.length === 1) {
    return { ...slots, property: action.properties[0]!.value };
  }
  return slots;
}

export function getSlotMachineState(rawSlots: CommandSlots, grammar: CommandGrammar = COMMAND_GRAMMAR): SlotMachineState {
  const slots = resolveImpliedSlots(rawSlots, grammar);
  const action = slots.action ? findAction(grammar, slots.action) : undefined;
  const property = action && slots.property ? findProperty(action, slots.property) : undefined;

  const needsValue = hasValueSlot(property);
  const needsPosition = hasPositionSlot(property);

  if (!slots.action) {
    return { currentSlot: "action", nextSlot: "property", isComplete: false, canAdvance: false };
  }
  if (!slots.property) {
    return { currentSlot: "property", nextSlot: needsValueAfterProperty(action), isComplete: false, canAdvance: false };
  }
  if (needsValue && !slots.value) {
    return { currentSlot: "value", nextSlot: needsPosition ? "position" : null, isComplete: false, canAdvance: false };
  }
  if (needsPosition && !slots.position) {
    // POSITION is optional: complete is true (default anchor applies) but the user may still fill it.
    return { currentSlot: "position", nextSlot: null, isComplete: true, canAdvance: true };
  }
  return { currentSlot: null, nextSlot: null, isComplete: true, canAdvance: true };
}

/** After the property slot, the next slot depends on the *possible* properties of the action. */
function needsValueAfterProperty(action: ActionNode | undefined): SlotKind | null {
  if (!action) return null;
  // If every property of this action is `none`-kind, there is no value slot.
  const anyValued = action.properties.some((property) => property.valueDescriptor.kind !== "none");
  return anyValued ? "value" : null;
}

// ---------------------------------------------------------------------------
// Suggestions (progressive disclosure)
// ---------------------------------------------------------------------------

function startsWith(token: string, query: string): boolean {
  return token.toLowerCase().startsWith(query.trim().toLowerCase());
}

function includesQuery(token: string, query: string): boolean {
  return token.toLowerCase().includes(query.trim().toLowerCase());
}

/** Filter helper: prefix matches first, then substring matches, query empty => all. */
function filterByQuery<T extends { value: string; label: string }>(items: readonly T[], query: string): T[] {
  const q = query.trim();
  if (!q) return [...items];
  const prefix = items.filter((item) => startsWith(item.value, q) || startsWith(item.label, q));
  const rest = items.filter(
    (item) => !prefix.includes(item) && (includesQuery(item.value, q) || includesQuery(item.label, q)),
  );
  return [...prefix, ...rest];
}

/**
 * Live-parse the in-progress text for a VALUE slot into a `parsed-value` suggestion,
 * distinct from enum picks. Returns `null` when the text does not parse for this descriptor.
 *
 * - `time`   : "0:30" / "at 0:30" -> "time: 00:30.000" option, inserts "at 0:30".
 * - `range`  : "0:30 to 0:43" -> "range: ..." option, inserts "0:30 to 0:43".
 * - `amount` : "10" / "10%" / "by 10%" -> "10%" option, inserts e.g. "by 10%".
 * - `text`   : quoted "..." -> accept-as-text option.
 */
export function parseValueSuggestion(descriptor: ValueDescriptor, raw: string): Suggestion | null {
  const text = raw.trim();
  if (!text) return null;

  switch (descriptor.kind) {
    case "time": {
      const stripped = text.replace(/^at\s+/i, "").trim();
      const seconds = parseTimeToSeconds(stripped);
      if (!Number.isFinite(seconds)) return null;
      return {
        value: stripped,
        label: `time: ${formatTimeLabel(seconds)}`,
        hint: "Accept this timecode",
        kind: "parsed-value",
        insert: `at ${stripped}`,
      };
    }
    case "range": {
      const range = parseRangeText(text);
      if (!range) return null;
      return {
        value: `${range.startRaw} to ${range.endRaw}`,
        label: `range: ${formatTimeLabel(range.start)} – ${formatTimeLabel(range.end)}`,
        hint: "Accept this range",
        kind: "parsed-value",
        insert: `${range.startRaw} to ${range.endRaw}`,
      };
    }
    case "amount": {
      const amount = parseAmountText(text);
      if (amount === null) return null;
      const connector = descriptor.bounds?.connector ?? "by";
      return {
        value: `${connector} ${amount}%`,
        label: `${connector} ${amount}%`,
        hint: "Accept this amount",
        kind: "parsed-value",
        insert: `${connector} ${amount}%`,
      };
    }
    case "text": {
      const quoted = parseQuotedText(text);
      if (quoted !== null) {
        return {
          value: `"${quoted}"`,
          label: `text: "${quoted}"`,
          hint: "Accept this text",
          kind: "parsed-value",
          insert: `"${quoted}"`,
        };
      }
      // Captions (allowTiming) may add an optional trailing range: `"…" from 0:02 to 0:05`.
      if (descriptor.allowTiming) {
        const timed = parseQuotedWithTiming(text);
        if (timed) {
          return {
            value: timed.insert,
            label: `caption: "${timed.text}" ${formatTimeLabel(timed.start)}–${formatTimeLabel(timed.end)}`,
            hint: "Accept this timed caption",
            kind: "parsed-value",
            insert: timed.insert,
          };
        }
      }
      return null;
    }
    default:
      return null;
  }
}

function formatTimeLabel(seconds: number): string {
  return formatSeconds(seconds);
}

function parseAmountText(text: string): number | null {
  const match = text.match(/(?:by|to)?\s*(\d+(?:\.\d+)?)\s*%?$/i);
  if (!match) return null;
  const amount = Number(match[1]);
  return Number.isFinite(amount) ? amount : null;
}

function parseQuotedText(text: string): string | null {
  const match = text.match(/^["“](.+?)["”]$/);
  if (match?.[1]) return match[1];
  return null;
}

/**
 * A quoted caption followed by an explicit range: `"Great tip" from 0:02 to 0:05`.
 * Serializes to a string `parseEditCommandLocal`'s caption rule accepts
 * (`add caption "…" from A to B`). Returns null when the text doesn't match.
 */
function parseQuotedWithTiming(
  text: string,
): { text: string; start: number; end: number; insert: string } | null {
  const match = text.match(/^["“](.+?)["”]\s+(?:from\s+)?([0-9:.]+)\s+(?:to|-|–|—)\s+([0-9:.]+)$/i);
  if (!match) return null;
  const caption = match[1];
  const startRaw = match[2];
  const endRaw = match[3];
  if (!caption || !startRaw || !endRaw) return null;
  const start = parseTimeToSeconds(startRaw);
  const end = parseTimeToSeconds(endRaw);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return { text: caption, start, end, insert: `"${caption}" from ${startRaw} to ${endRaw}` };
}

function parseRangeText(text: string): { start: number; end: number; startRaw: string; endRaw: string } | null {
  const match = text.match(/^(?:from\s+)?([0-9:.]+)\s+(?:to|-|–|—|and)\s+([0-9:.]+)$/i);
  if (!match) return null;
  const startRaw = (match[1] ?? "").trim();
  const endRaw = (match[2] ?? "").trim();
  const start = parseTimeToSeconds(startRaw);
  const end = parseTimeToSeconds(endRaw);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return { start, end, startRaw, endRaw };
}

/**
 * The ordered suggestions valid for the CURRENT slot, given accepted slots + in-progress
 * text. Progressive disclosure: only tokens valid at this position are returned.
 *
 * Ordering: a live `parsed-value` (if the text parses) is pinned first, followed by the
 * config-ordered enum/option list filtered by the query.
 */
export function getSuggestions(
  rawSlots: CommandSlots,
  query: string,
  grammar: CommandGrammar = COMMAND_GRAMMAR,
): Suggestion[] {
  // Resolve implied single-option property slots so the value slot becomes current and the
  // user can type the value directly (no dead-end on "trim"/"split"/"delete"/"set"/"move").
  const slots = resolveImpliedSlots(rawSlots, grammar);
  const state = getSlotMachineState(slots, grammar);
  const slot = state.currentSlot;
  if (slot === null) return [];

  switch (slot) {
    case "action": {
      return filterByQuery(grammar.actions, query).map((action) => ({
        value: action.value,
        label: action.label,
        ...(action.hint ? { hint: action.hint } : {}),
        kind: "action" as const,
      }));
    }
    case "property": {
      const action = slots.action ? findAction(grammar, slots.action) : undefined;
      if (!action) return [];
      return filterByQuery(action.properties, query).map((property) => ({
        value: property.value,
        label: property.label,
        ...(property.hint ? { hint: property.hint } : {}),
        kind: "property" as const,
      }));
    }
    case "value": {
      const property = currentProperty(slots, grammar);
      if (!property) return [];
      const descriptor = property.valueDescriptor;
      const suggestions: Suggestion[] = [];

      const parsed = parseValueSuggestion(descriptor, query);
      if (parsed) suggestions.push(parsed);

      if (descriptor.kind === "enum" && descriptor.options) {
        suggestions.push(
          ...filterByQuery(descriptor.options, query).map((option) => ({
            value: option.value,
            label: option.label,
            ...(option.hint ? { hint: option.hint } : {}),
            kind: "enum" as const,
            insert: option.value,
          })),
        );
      }
      return suggestions;
    }
    case "position": {
      return filterByQuery(grammar.positionAnchors, query).map((anchor) => ({
        value: anchor.value,
        label: anchor.label,
        hint: `Key ${anchor.key}`,
        kind: "anchor" as const,
        insert: anchor.value,
      }));
    }
    default:
      return [];
  }
}

function currentProperty(slots: CommandSlots, grammar: CommandGrammar): PropertyNode | undefined {
  const action = slots.action ? findAction(grammar, slots.action) : undefined;
  if (!action || !slots.property) return undefined;
  return findProperty(action, slots.property);
}

// ---------------------------------------------------------------------------
// Serialization: slots -> command string the existing parser accepts
// ---------------------------------------------------------------------------

/**
 * Serialize completed slots into a command STRING that `parseEditCommandLocal` accepts.
 *
 * Mappings (verified against parser.ts regexes):
 *  - increase/decrease + effect  -> "increase brightness by 10%"
 *  - set + volume                -> "set volume to 80%"
 *  - add + transition + at TIME  -> "add crossfade transition at 0:30"
 *  - add + caption + text/range  -> 'add caption "Hello" from 0:02 to 0:05'
 *  - add + zoom + range          -> "add zoom from 0:10 to 0:25"
 *  - change + aspect ratio       -> "change aspect ratio to 9:16"
 *  - trim + clip + range         -> "trim 0:30 to 0:43"
 *  - delete + range              -> "delete 0:30 to 0:43" (+ " ripple")
 *  - fade + in/out               -> "fade in" / "fade out"
 *  - mute + audio                -> "mute"
 *  - split + clip + at TIME      -> "split at 0:30"
 *  - move + clip + to TIME       -> "move clip to 0:10"
 *  - add + text + at ANCHOR      -> 'add text "Hello" at bottom-center'
 *
 * Returns `null` only for incomplete slot sets (missing a required value). Every v1
 * action — including split, move, and text overlay — now serializes to a parser-ready
 * string (Command Editing v1: the spike's parser gaps are closed).
 */
export function serializeCommand(rawSlots: CommandSlots, grammar: CommandGrammar = COMMAND_GRAMMAR): string | null {
  // Resolve implied single-option property slots so commands typed without the obvious
  // property pick (e.g. set → volume, mute → audio) still serialize correctly.
  const slots = resolveImpliedSlots(rawSlots, grammar);
  const { action, property, value, position } = slots;
  if (!action) return null;
  const actionNode = findAction(grammar, action);
  if (!actionNode) return null;
  const propertyNode = property ? findProperty(actionNode, property) : undefined;

  switch (action) {
    case "increase":
    case "decrease": {
      if (!propertyNode || !value) return null;
      // "increase brightness by 10%" — parser derives sign from increase/decrease.
      return `${action} ${propertyNode.value} ${value}`;
    }
    case "set": {
      // "set volume to 80%"
      if (!propertyNode || !value) return null;
      return `set ${propertyNode.value} ${value}`;
    }
    case "add": {
      if (!propertyNode) return null;
      switch (propertyNode.value) {
        case "transition":
          // Parser keys on "transition" + optional "at TIME"; "crossfade" forces the kind.
          return value ? `add crossfade transition ${value}` : "add crossfade transition";
        case "zoom":
          if (!value) return null;
          // Parser requires the word "from" to be optional but needs a range; emit "from".
          return `add zoom from ${normalizeRange(value)}`;
        case "caption":
          if (!value) return null;
          // value already carries the quoted text (+ optional range) in parser-ready form.
          return `add caption ${ensureCaptionFrom(value)}`;
        case "text":
          // Command Editing v1 (AC-9): parser now has an `add_text_overlay` rule.
          if (!value) return null;
          return position ? `add text ${value} at ${position}` : `add text ${value}`;
        default:
          return null;
      }
    }
    case "change": {
      // "change aspect ratio to 9:16" — parser only needs the ratio token present.
      if (!value) return null;
      const ratio = value.replace(/^to\s+/i, "").trim();
      return `change aspect ratio to ${ratio}`;
    }
    case "trim": {
      if (!value) return null;
      return `trim ${normalizeRange(value)}`;
    }
    case "delete": {
      if (!value) return null;
      const ripple = slots.position === "ripple" ? " ripple" : "";
      return `delete ${normalizeRange(value)}${ripple}`;
    }
    case "split": {
      // Command Editing v1: parser now has a `split_clip` rule ("split at 0:30").
      if (!value) return null;
      return `split ${value}`;
    }
    case "move": {
      // Command Editing v1: parser now has a `move_clip` rule ("move clip to 0:10").
      if (!value) return null;
      return `move clip ${value}`;
    }
    case "fade": {
      // "fade in" / "fade out"
      if (!propertyNode) return null;
      return `fade ${propertyNode.value}`;
    }
    case "mute": {
      return "mute";
    }
    default:
      return null;
  }
}

/** Strip a leading "from"/"at" and a trailing connector noise so ranges serialize cleanly. */
function normalizeRange(value: string): string {
  return value.replace(/^from\s+/i, "").trim();
}

/** Caption values may arrive as just the quoted text; the parser requires "from A to B" only
 *  when a range is present. Pass through as-is (text or text + range). */
function ensureCaptionFrom(value: string): string {
  return value.trim();
}

// ---------------------------------------------------------------------------
// slots -> string -> parseEditCommandLocal -> EditPlan
// ---------------------------------------------------------------------------

export interface CommandParseResult {
  /** The serialized command string, or `null` if the slots cannot be serialized. */
  readonly command: string | null;
  /** The parsed plan, or `null` if not serializable / parser produced no actions. */
  readonly plan: EditPlan | null;
}

/**
 * Run the full pipeline: slots -> command string -> `parseEditCommandLocal` -> `EditPlan`.
 * No new parser logic — this is the single seam the UI uses to obtain a plan from slots.
 */
export function planFromSlots(
  slots: CommandSlots,
  context: TimelineContext,
  grammar: CommandGrammar = COMMAND_GRAMMAR,
): CommandParseResult {
  const command = serializeCommand(slots, grammar);
  if (command === null) return { command: null, plan: null };
  const plan = parseEditCommandLocal(command, context);
  // DEFECT-1 / AC-1 hardening: the parser is grammar-unaware, so in principle a
  // serialized string could match a parser rule the grammar does NOT expose (e.g.
  // `remove_silence`). The Command Bar only ever submits grammar-bounded plans, so
  // filter the parsed actions down to grammar-representable types here — the single
  // slots->plan seam the bar uses — before the plan can reach `applyAIEditPlan`.
  const allowedActions = plan.actions.filter((action) => GRAMMAR_ACTION_TYPES.has(action.type));
  if (allowedActions.length === 0) return { command, plan: null };
  const boundedPlan: EditPlan = { ...plan, actions: allowedActions };
  return { command, plan: boundedPlan };
}

// ---------------------------------------------------------------------------
// Position anchor resolution (geometry helper for the future apply-code)
// ---------------------------------------------------------------------------

/** Resolve a position token (or the default) to its percent canvas geometry. */
export function resolvePositionGeometry(position: string | undefined, grammar: CommandGrammar = COMMAND_GRAMMAR) {
  const anchor = position
    ? grammar.positionAnchors.find((candidate) => candidate.value === position)
    : undefined;
  return (anchor ?? defaultPositionAnchor(grammar)).geometry;
}
