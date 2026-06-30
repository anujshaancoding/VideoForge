/**
 * Command Editing grammar — the SINGLE source of truth for the structured typeahead.
 *
 * Honors PRD §3 (v1 action matrix), §4 (out of scope), and AC-1 (single config object
 * drives both the dropdown and the command-string serialization). The structured slots
 * SERIALIZE to a command string that the existing `parseEditCommandLocal` already handles
 * (Design Brief decision #8 / §7.4) — so we reuse the tested parser/validation/apply
 * pipeline unchanged.
 *
 * Slot order: ACTION -> PROPERTY/OBJECT -> VALUE -> POSITION?
 *
 * This file is pure/headless: no React, no network, deterministic. It only describes the
 * grammar; `suggest.ts` consumes it to produce suggestions and the serialized command.
 */

/** The four ordered slot kinds. POSITION is optional and spatial-only (v1: text overlay). */
export type SlotKind = "action" | "property" | "value" | "position";

/**
 * Value descriptor kinds.
 * - `time`   : a single timecode (HH:MM:SS.mmm / M:SS / Ns), parsed via `parseTimeToSeconds`.
 * - `range`  : a start..end pair of timecodes.
 * - `amount` : a numeric magnitude with a unit (e.g. percent), optionally signed by action.
 * - `enum`   : one of a fixed option set (no free typing accepted as a value).
 * - `text`   : an arbitrary quoted string (e.g. caption / overlay copy).
 * - `none`   : the property implies its own value (e.g. `mute`); no VALUE slot is shown.
 */
export type ValueKind = "time" | "range" | "amount" | "enum" | "text" | "none";

export interface EnumOption {
  /** Canonical token used when serializing to the command string. */
  readonly value: string;
  /** Plain-language label shown in the dropdown. */
  readonly label: string;
  /** Optional secondary descriptor copy. */
  readonly hint?: string;
}

/**
 * Numeric bounds for `amount` / `time` / `range` descriptors. Units are informational for
 * the UI; the parser itself derives sign from the action (increase vs. decrease).
 */
export interface ValueBounds {
  readonly min: number;
  readonly max: number;
  readonly unit: "percent" | "ms" | "seconds";
  /** For `amount`: the connector word emitted before the number ("by" | "to"). */
  readonly connector?: "by" | "to";
}

export interface ValueDescriptor {
  readonly kind: ValueKind;
  /** Plain-language prompt copy for the VALUE slot ("By how much?", "When?", ...). */
  readonly prompt: string;
  /** Bounds + unit for numeric descriptors (`amount` | `time` | `range`). */
  readonly bounds?: ValueBounds;
  /** Options for `enum` descriptors. */
  readonly options?: readonly EnumOption[];
  /** Placeholder copy shown when the slot input is empty. */
  readonly placeholder?: string;
  /**
   * For `text` descriptors: also accept an optional trailing time range so the user can
   * type `"caption" from 0:02 to 0:05` (captions only). Text overlays leave this unset, so
   * their value stays a bare quoted string.
   */
  readonly allowTiming?: boolean;
}

export interface PropertyNode {
  /** Canonical token serialized into the command string (e.g. "brightness"). */
  readonly value: string;
  /** Plain-language label shown in the dropdown. */
  readonly label: string;
  /** Optional secondary descriptor copy. */
  readonly hint?: string;
  /** The VALUE descriptor for this property. */
  readonly valueDescriptor: ValueDescriptor;
  /** Whether this property exposes the optional POSITION slot (v1: text overlay only). */
  readonly hasPosition?: boolean;
  /**
   * Marks a property whose apply-code does NOT yet exist in `applyAIEditPlan`
   * (PRD §3 "Needs-apply-code"). Represented in the grammar for the spike; UI may surface
   * it, but the apply branch is out of scope here. v1: "text overlay".
   */
  readonly needsApplyCode?: boolean;
}

export interface ActionNode {
  /** Canonical token (e.g. "increase"). May be an alias group — see `aliases`. */
  readonly value: string;
  /** Plain-language label shown in the dropdown. */
  readonly label: string;
  /** Plain-language prompt copy for the ACTION slot ("What do you want to do?"). */
  readonly prompt: string;
  /** Optional secondary descriptor copy. */
  readonly hint?: string;
  /** Valid properties/objects for this action. */
  readonly properties: readonly PropertyNode[];
}

export interface CommandGrammar {
  /** Plain-language prompts per slot, surfaced as dropdown headers / hints. */
  readonly prompts: Readonly<Record<SlotKind, string>>;
  /** The ordered action nodes. */
  readonly actions: readonly ActionNode[];
  /**
   * 9-anchor POSITION map for spatial objects. Each anchor serializes to its `value` token
   * and resolves to percent canvas geometry (PRD §3 "Position slot"). Apply-code is out of
   * scope for the spike; this is the grammar representation only.
   */
  readonly positionAnchors: readonly PositionAnchor[];
}

export interface PositionAnchor {
  /** Token serialized into the command string (e.g. "bottom-center"). */
  readonly value: string;
  /** Plain-language label. */
  readonly label: string;
  /** Numpad-style key (PRD §5.1 / Design Brief §5.1): 1=BL .. 9=TR. */
  readonly key: number;
  /** Percent canvas geometry (0–100) the anchor maps to. */
  readonly geometry: { readonly canvasX: number; readonly canvasY: number; readonly width: number };
  /** Whether this is the default anchor when POSITION is omitted (bottom-center). */
  readonly default?: boolean;
}

// ---------------------------------------------------------------------------
// Shared value descriptors
// ---------------------------------------------------------------------------

/** by N% effect descriptor (brightness/contrast/saturation), magnitude 1–100. */
const EFFECT_AMOUNT: ValueDescriptor = {
  kind: "amount",
  prompt: "By how much?",
  bounds: { min: 1, max: 100, unit: "percent", connector: "by" },
  placeholder: "by 10%",
};

/** volume to N%, 0–200. */
const VOLUME_AMOUNT: ValueDescriptor = {
  kind: "amount",
  prompt: "To what level?",
  bounds: { min: 0, max: 200, unit: "percent", connector: "to" },
  placeholder: "to 80%",
};

const TRIM_RANGE: ValueDescriptor = {
  kind: "range",
  prompt: "From when to when?",
  bounds: { min: 0, max: Number.POSITIVE_INFINITY, unit: "seconds" },
  placeholder: "0:30 to 0:43",
};

const DELETE_RANGE: ValueDescriptor = {
  kind: "range",
  prompt: "Which range to remove?",
  bounds: { min: 0, max: Number.POSITIVE_INFINITY, unit: "seconds" },
  placeholder: "0:30 to 0:43",
};

const ZOOM_RANGE: ValueDescriptor = {
  kind: "range",
  prompt: "Over which range?",
  bounds: { min: 0, max: Number.POSITIVE_INFINITY, unit: "seconds" },
  placeholder: "0:10 to 0:25",
};

const AT_TIME: ValueDescriptor = {
  kind: "time",
  prompt: "When?",
  bounds: { min: 0, max: Number.POSITIVE_INFINITY, unit: "seconds" },
  placeholder: "at 0:30",
};

const CAPTION_TEXT: ValueDescriptor = {
  kind: "text",
  // Accepts a quoted string, optionally followed by a time range. Untimed captions default
  // to the playhead window; `"…" from 0:02 to 0:05` sets explicit timing.
  prompt: "What should it say, and when?",
  placeholder: '"Hello world" (optionally: from 0:02 to 0:05)',
  allowTiming: true,
};

const TEXT_OVERLAY_TEXT: ValueDescriptor = {
  kind: "text",
  prompt: "What should the text say?",
  placeholder: '"Hello world"',
};

const NO_VALUE: ValueDescriptor = {
  kind: "none",
  prompt: "",
};

const ASPECT_ENUM: ValueDescriptor = {
  kind: "enum",
  prompt: "Which aspect ratio?",
  options: [
    { value: "9:16", label: "9:16", hint: "Vertical / Reels" },
    { value: "16:9", label: "16:9", hint: "Landscape" },
    { value: "1:1", label: "1:1", hint: "Square" },
    { value: "4:5", label: "4:5", hint: "Portrait feed" },
  ],
  placeholder: "to 9:16",
};

// ---------------------------------------------------------------------------
// Property nodes
// ---------------------------------------------------------------------------

const brightness: PropertyNode = { value: "brightness", label: "brightness", hint: "Lightness", valueDescriptor: EFFECT_AMOUNT };
const contrast: PropertyNode = { value: "contrast", label: "contrast", hint: "Tonal range", valueDescriptor: EFFECT_AMOUNT };
const saturation: PropertyNode = { value: "saturation", label: "saturation", hint: "Color intensity", valueDescriptor: EFFECT_AMOUNT };
const volume: PropertyNode = { value: "volume", label: "volume", hint: "Audio level", valueDescriptor: VOLUME_AMOUNT };

const EFFECT_PROPERTIES: readonly PropertyNode[] = [brightness, contrast, saturation];

// ---------------------------------------------------------------------------
// The single grammar config object
// ---------------------------------------------------------------------------

export const COMMAND_GRAMMAR: CommandGrammar = {
  prompts: {
    action: "What do you want to do?",
    property: "What to change?",
    value: "What value?",
    position: "Where on the canvas?",
  },

  actions: [
    {
      value: "increase",
      label: "increase",
      prompt: "What do you want to do?",
      hint: "Raise a property value",
      properties: EFFECT_PROPERTIES,
    },
    {
      value: "decrease",
      label: "decrease",
      prompt: "What do you want to do?",
      hint: "Lower a property value",
      properties: EFFECT_PROPERTIES,
    },
    {
      value: "set",
      label: "set",
      prompt: "What do you want to do?",
      hint: "Assign an exact value",
      properties: [volume],
    },
    {
      value: "add",
      label: "add",
      prompt: "What do you want to do?",
      hint: "Insert a new element",
      properties: [
        {
          value: "transition",
          label: "transition",
          hint: "Crossfade at a cut point",
          valueDescriptor: {
            kind: "time",
            prompt: "When?",
            bounds: { min: 0, max: Number.POSITIVE_INFINITY, unit: "seconds" },
            placeholder: "at 0:30",
          },
        },
        { value: "caption", label: "caption", hint: "Subtitle / lower-third text", valueDescriptor: CAPTION_TEXT },
        { value: "zoom", label: "zoom", hint: "Ken Burns zoom", valueDescriptor: ZOOM_RANGE },
        {
          // v1 NEW (PRD item 14). Apply-code now lives in `applyAIEditPlan`
          // (`add_text_overlay` branch) — the spike's `needsApplyCode` flag is gone.
          value: "text",
          label: "text overlay",
          hint: "On-canvas text element",
          valueDescriptor: TEXT_OVERLAY_TEXT,
          hasPosition: true,
        },
      ],
    },
    {
      value: "change",
      label: "change",
      prompt: "What do you want to do?",
      hint: "Change a project setting",
      properties: [{ value: "aspect ratio", label: "aspect ratio", hint: "Canvas shape", valueDescriptor: ASPECT_ENUM }],
    },
    {
      value: "split",
      label: "split",
      prompt: "What do you want to do?",
      hint: "Split the clip at a time",
      properties: [{ value: "clip", label: "clip", hint: "The targeted clip", valueDescriptor: AT_TIME }],
    },
    {
      value: "trim",
      label: "trim",
      prompt: "What do you want to do?",
      hint: "Shorten the clip to a range",
      properties: [{ value: "clip", label: "clip", hint: "The targeted clip", valueDescriptor: TRIM_RANGE }],
    },
    {
      value: "delete",
      label: "delete",
      prompt: "What do you want to do?",
      hint: "Remove a timeline range",
      properties: [{ value: "range", label: "range", hint: "A start..end span", valueDescriptor: DELETE_RANGE }],
    },
    {
      value: "move",
      label: "move",
      prompt: "What do you want to do?",
      hint: "Move the clip to a time",
      properties: [{ value: "clip", label: "clip", hint: "The targeted clip", valueDescriptor: AT_TIME }],
    },
    {
      value: "fade",
      label: "fade",
      prompt: "What do you want to do?",
      hint: "Audio fade in or out",
      properties: [
        { value: "in", label: "fade in", hint: "Ramp audio up", valueDescriptor: NO_VALUE },
        { value: "out", label: "fade out", hint: "Ramp audio down", valueDescriptor: NO_VALUE },
      ],
    },
    {
      value: "mute",
      label: "mute",
      prompt: "What do you want to do?",
      hint: "Silence the clip or track",
      properties: [{ value: "audio", label: "audio", hint: "The clip's audio", valueDescriptor: NO_VALUE }],
    },
  ],

  positionAnchors: [
    { value: "top-left", label: "top-left", key: 7, geometry: { canvasX: 10, canvasY: 10, width: 80 } },
    { value: "top-center", label: "top-center", key: 8, geometry: { canvasX: 10, canvasY: 10, width: 80 } },
    { value: "top-right", label: "top-right", key: 9, geometry: { canvasX: 10, canvasY: 10, width: 80 } },
    { value: "center-left", label: "center-left", key: 4, geometry: { canvasX: 10, canvasY: 45, width: 80 } },
    { value: "center", label: "center", key: 5, geometry: { canvasX: 10, canvasY: 45, width: 80 } },
    { value: "center-right", label: "center-right", key: 6, geometry: { canvasX: 10, canvasY: 45, width: 80 } },
    { value: "bottom-left", label: "bottom-left", key: 1, geometry: { canvasX: 10, canvasY: 80, width: 80 } },
    { value: "bottom-center", label: "bottom-center", key: 2, geometry: { canvasX: 10, canvasY: 80, width: 80 }, default: true },
    { value: "bottom-right", label: "bottom-right", key: 3, geometry: { canvasX: 10, canvasY: 80, width: 80 } },
  ],
};

/**
 * The set of `EditAction.type` values the grammar can actually produce through the
 * Command Bar (serialize -> parse). It is the contract boundary between the grammar
 * and `applyAIEditPlan`: the bar may ONLY ever emit a plan whose actions are in this
 * set. Used by `planFromSlots` (the slots->plan seam) to drop any action type the
 * grammar does not represent, so an action the parser can match standalone (e.g.
 * `remove_silence`, `update_caption_style`) can never reach apply via the bar — even
 * if a future serializer/parser change would otherwise leak one (DEFECT-1 / AC-1).
 *
 * This deliberately mirrors the grammar's action/property matrix; it is asserted
 * against the grammar in grammar.test.ts so the two cannot silently drift.
 */
export const GRAMMAR_ACTION_TYPES: ReadonlySet<string> = new Set<string>([
  "trim",
  "cut",
  "delete_range",
  "add_transition",
  "add_effect",
  "adjust_effect",
  "add_caption",
  "change_aspect_ratio",
  "add_zoom",
  "adjust_audio",
  "split_clip",
  "move_clip",
  "add_text_overlay",
]);

/** Convenience lookup: action token -> ActionNode. */
export function findAction(grammar: CommandGrammar, value: string): ActionNode | undefined {
  return grammar.actions.find((action) => action.value === value);
}

/** Convenience lookup: property token within an action. */
export function findProperty(action: ActionNode, value: string): PropertyNode | undefined {
  return action.properties.find((property) => property.value === value);
}

/** The default position anchor (bottom-center) per PRD §3. */
export function defaultPositionAnchor(grammar: CommandGrammar): PositionAnchor {
  const found = grammar.positionAnchors.find((anchor) => anchor.default);
  // The config always contains a default anchor; this fallback keeps the type non-optional.
  return found ?? grammar.positionAnchors[grammar.positionAnchors.length - 1]!;
}
