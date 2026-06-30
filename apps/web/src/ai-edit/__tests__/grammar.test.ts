import { describe, expect, it } from "vitest";
import {
  COMMAND_GRAMMAR,
  GRAMMAR_ACTION_TYPES,
  defaultPositionAnchor,
  findAction,
  findProperty,
} from "../grammar.js";
import type { ValueKind } from "../grammar.js";

const VALID_VALUE_KINDS: ReadonlySet<ValueKind> = new Set(["time", "range", "amount", "enum", "text", "none"]);

describe("COMMAND_GRAMMAR config integrity", () => {
  it("every action declares a prompt and at least one property", () => {
    for (const action of COMMAND_GRAMMAR.actions) {
      expect(action.prompt.length).toBeGreaterThan(0);
      expect(action.properties.length).toBeGreaterThan(0);
    }
  });

  it("every property has a valid value descriptor", () => {
    for (const action of COMMAND_GRAMMAR.actions) {
      for (const property of action.properties) {
        expect(VALID_VALUE_KINDS.has(property.valueDescriptor.kind)).toBe(true);
        // enum descriptors must carry options; amount/time/range carry bounds.
        if (property.valueDescriptor.kind === "enum") {
          expect(property.valueDescriptor.options?.length ?? 0).toBeGreaterThan(0);
        }
        if (["amount", "time", "range"].includes(property.valueDescriptor.kind)) {
          expect(property.valueDescriptor.bounds).toBeDefined();
        }
      }
    }
  });

  it("no action references a duplicate property token", () => {
    for (const action of COMMAND_GRAMMAR.actions) {
      const tokens = action.properties.map((property) => property.value);
      expect(new Set(tokens).size).toBe(tokens.length);
    }
  });

  it("action tokens are unique", () => {
    const tokens = COMMAND_GRAMMAR.actions.map((action) => action.value);
    expect(new Set(tokens).size).toBe(tokens.length);
  });

  it("covers the v1-YES action vocabulary from PRD §3", () => {
    const tokens = new Set(COMMAND_GRAMMAR.actions.map((action) => action.value));
    for (const expected of ["increase", "decrease", "set", "add", "change", "split", "trim", "delete", "move", "fade", "mute"]) {
      expect(tokens.has(expected)).toBe(true);
    }
  });

  it("exposes effect properties on increase/decrease and volume on set", () => {
    for (const action of ["increase", "decrease"] as const) {
      const node = findAction(COMMAND_GRAMMAR, action)!;
      expect(findProperty(node, "brightness")).toBeDefined();
      expect(findProperty(node, "contrast")).toBeDefined();
      expect(findProperty(node, "saturation")).toBeDefined();
    }
    expect(findProperty(findAction(COMMAND_GRAMMAR, "set")!, "volume")).toBeDefined();
  });

  it("marks text overlay as the only position-bearing property", () => {
    const positionProps = COMMAND_GRAMMAR.actions.flatMap((action) =>
      action.properties.filter((property) => property.hasPosition),
    );
    expect(positionProps).toHaveLength(1);
    expect(positionProps[0]?.value).toBe("text");
    // Apply-code now exists (`add_text_overlay` in applyAIEditPlan): the stale
    // `needsApplyCode` spike flag must be gone, not merely false.
    expect(positionProps[0]?.needsApplyCode).toBeUndefined();
  });

  it("defines exactly 9 position anchors with unique numpad keys and one default", () => {
    expect(COMMAND_GRAMMAR.positionAnchors).toHaveLength(9);
    const keys = COMMAND_GRAMMAR.positionAnchors.map((anchor) => anchor.key);
    expect(new Set(keys)).toEqual(new Set([1, 2, 3, 4, 5, 6, 7, 8, 9]));
    expect(COMMAND_GRAMMAR.positionAnchors.filter((anchor) => anchor.default)).toHaveLength(1);
    expect(defaultPositionAnchor(COMMAND_GRAMMAR).value).toBe("bottom-center");
  });

  it("position anchor geometry stays within percent bounds (0–100)", () => {
    for (const anchor of COMMAND_GRAMMAR.positionAnchors) {
      const { canvasX, canvasY, width } = anchor.geometry;
      expect(canvasX).toBeGreaterThanOrEqual(0);
      expect(canvasY).toBeGreaterThanOrEqual(0);
      expect(canvasX + width).toBeLessThanOrEqual(100);
    }
  });

  it("GRAMMAR_ACTION_TYPES is the grammar-reachable action-type allowlist (DEFECT-1)", () => {
    // Every grammar-reachable EditAction.type the Command Bar can emit is listed.
    for (const type of [
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
    ]) {
      expect(GRAMMAR_ACTION_TYPES.has(type)).toBe(true);
    }
    // Parser-matchable but NOT grammar-exposed types must be excluded so the bar can
    // never route them to apply (the invariant boundary this allowlist defends).
    expect(GRAMMAR_ACTION_TYPES.has("remove_silence")).toBe(false);
    expect(GRAMMAR_ACTION_TYPES.has("update_caption_style")).toBe(false);
  });
});
