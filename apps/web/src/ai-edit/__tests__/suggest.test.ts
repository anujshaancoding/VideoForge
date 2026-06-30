import { describe, expect, it } from "vitest";
import {
  getSlotMachineState,
  getSuggestions,
  parseValueSuggestion,
  planFromSlots,
  serializeCommand,
  type CommandSlots,
} from "../suggest.js";
import { COMMAND_GRAMMAR, findAction, findProperty } from "../grammar.js";
import type { TimelineContext } from "../types.js";

const context: TimelineContext = {
  duration: 120,
  aspectRatio: "16:9",
  activeClipId: "clip-1",
  activeTrackId: "video-1",
  clips: [{ id: "clip-1", name: "Clip", startTime: 0, endTime: 120, trackId: "video-1", trackType: "video" }],
  tracks: [
    { id: "video-1", type: "video" },
    { id: "audio-1", type: "audio" },
    { id: "caption-1", type: "caption" },
  ],
};

describe("getSuggestions — progressive disclosure", () => {
  it("offers all actions at the empty action slot", () => {
    const suggestions = getSuggestions({}, "");
    expect(suggestions.every((s) => s.kind === "action")).toBe(true);
    expect(suggestions.map((s) => s.value)).toContain("increase");
    expect(suggestions.map((s) => s.value)).toContain("add");
  });

  it("filters actions by typed prefix", () => {
    const suggestions = getSuggestions({}, "inc");
    expect(suggestions[0]?.value).toBe("increase");
  });

  it("scopes property suggestions to the chosen action (increase -> effects only)", () => {
    const suggestions = getSuggestions({ action: "increase" }, "");
    expect(suggestions.map((s) => s.value).sort()).toEqual(["brightness", "contrast", "saturation"]);
    expect(suggestions.every((s) => s.kind === "property")).toBe(true);
  });

  it("scopes property suggestions for add to its valid objects", () => {
    const suggestions = getSuggestions({ action: "add" }, "");
    expect(suggestions.map((s) => s.value)).toEqual(["transition", "caption", "zoom", "text"]);
  });

  it("offers enum options for change -> aspect ratio", () => {
    const suggestions = getSuggestions({ action: "change", property: "aspect ratio" }, "");
    expect(suggestions.every((s) => s.kind === "enum")).toBe(true);
    expect(suggestions.map((s) => s.value)).toEqual(["9:16", "16:9", "1:1", "4:5"]);
  });

  it("offers the 9 anchors at the position slot for text overlay", () => {
    const suggestions = getSuggestions({ action: "add", property: "text", value: '"Hi"' }, "");
    expect(suggestions).toHaveLength(9);
    expect(suggestions.every((s) => s.kind === "anchor")).toBe(true);
  });
});

describe("getSuggestions — live-parsed value options (distinct from enums)", () => {
  it("typing a timecode yields a parsed-value time option pinned first", () => {
    const suggestions = getSuggestions({ action: "add", property: "transition" }, "0:30");
    expect(suggestions[0]?.kind).toBe("parsed-value");
    expect(suggestions[0]?.label).toBe("time: 0:30");
    expect(suggestions[0]?.insert).toBe("at 0:30");
  });

  it("typing 'by 10' on an effect yields a parsed amount option", () => {
    const suggestions = getSuggestions({ action: "increase", property: "brightness" }, "by 10");
    expect(suggestions[0]?.kind).toBe("parsed-value");
    expect(suggestions[0]?.insert).toBe("by 10%");
  });

  it("typing a range yields a parsed range option", () => {
    const suggestion = parseValueSuggestion(findEffectRangeDescriptor(), "0:30 to 0:43");
    expect(suggestion?.kind).toBe("parsed-value");
    expect(suggestion?.insert).toBe("0:30 to 0:43");
    expect(suggestion?.label).toBe("range: 0:30 – 0:43");
  });

  it("does not produce a parsed option for unparseable text", () => {
    expect(parseValueSuggestion(findTimeDescriptor(), "bloop")).toBeNull();
  });

  it("enum slot does not accept free typing as a parsed value", () => {
    const suggestions = getSuggestions({ action: "change", property: "aspect ratio" }, "bloop");
    expect(suggestions.some((s) => s.kind === "parsed-value")).toBe(false);
    // no enum matches "bloop" either
    expect(suggestions).toHaveLength(0);
  });
});

describe("getSlotMachineState", () => {
  it("walks action -> property -> value for increase brightness", () => {
    expect(getSlotMachineState({}).currentSlot).toBe("action");
    expect(getSlotMachineState({ action: "increase" }).currentSlot).toBe("property");
    const atValue = getSlotMachineState({ action: "increase", property: "brightness" });
    expect(atValue.currentSlot).toBe("value");
    expect(atValue.isComplete).toBe(false);
    const complete = getSlotMachineState({ action: "increase", property: "brightness", value: "by 10%" });
    expect(complete.isComplete).toBe(true);
    expect(complete.currentSlot).toBe(null);
  });

  it("treats mute as complete with no value slot", () => {
    const state = getSlotMachineState({ action: "mute", property: "audio" });
    expect(state.isComplete).toBe(true);
    expect(state.currentSlot).toBe(null);
  });

  it("treats fade in as complete with no value slot", () => {
    const state = getSlotMachineState({ action: "fade", property: "in" });
    expect(state.isComplete).toBe(true);
  });

  it("text overlay is complete after value (position optional) but offers position slot", () => {
    const state = getSlotMachineState({ action: "add", property: "text", value: '"Hi"' });
    expect(state.isComplete).toBe(true);
    expect(state.currentSlot).toBe("position");
  });
});

describe("serializeCommand + planFromSlots round-trip (slots -> string -> EditPlan)", () => {
  const cases: Array<{ name: string; slots: CommandSlots; command: string; actionType: string }> = [
    {
      name: "increase brightness by 10%",
      slots: { action: "increase", property: "brightness", value: "by 10%" },
      command: "increase brightness by 10%",
      actionType: "adjust_effect",
    },
    {
      name: "decrease contrast by 15%",
      slots: { action: "decrease", property: "contrast", value: "by 15%" },
      command: "decrease contrast by 15%",
      actionType: "adjust_effect",
    },
    {
      name: "set volume to 80%",
      slots: { action: "set", property: "volume", value: "to 80%" },
      command: "set volume to 80%",
      actionType: "adjust_audio",
    },
    {
      name: "add transition at 0:30",
      slots: { action: "add", property: "transition", value: "at 0:30" },
      command: "add crossfade transition at 0:30",
      actionType: "add_transition",
    },
    {
      name: "trim 0:30 to 0:43",
      slots: { action: "trim", property: "clip", value: "0:30 to 0:43" },
      command: "trim 0:30 to 0:43",
      actionType: "trim",
    },
    {
      name: "delete 1:10 to 1:25",
      slots: { action: "delete", property: "range", value: "1:10 to 1:25" },
      command: "delete 1:10 to 1:25",
      actionType: "delete_range",
    },
    {
      name: "add zoom 0:10 to 0:25",
      slots: { action: "add", property: "zoom", value: "0:10 to 0:25" },
      command: "add zoom from 0:10 to 0:25",
      actionType: "add_zoom",
    },
    {
      name: "change aspect ratio to 9:16",
      slots: { action: "change", property: "aspect ratio", value: "to 9:16" },
      command: "change aspect ratio to 9:16",
      actionType: "change_aspect_ratio",
    },
    {
      name: "add caption",
      slots: { action: "add", property: "caption", value: '"Hello world" from 0:02 to 0:05' },
      command: 'add caption "Hello world" from 0:02 to 0:05',
      actionType: "add_caption",
    },
    {
      name: "fade in",
      slots: { action: "fade", property: "in" },
      command: "fade in",
      actionType: "adjust_audio",
    },
    {
      name: "mute audio",
      slots: { action: "mute", property: "audio" },
      command: "mute",
      actionType: "adjust_audio",
    },
  ];

  for (const testCase of cases) {
    it(`serializes "${testCase.name}" to the parser-ready string`, () => {
      expect(serializeCommand(testCase.slots)).toBe(testCase.command);
    });

    it(`round-trips "${testCase.name}" to a ${testCase.actionType} EditAction`, () => {
      const result = planFromSlots(testCase.slots, context);
      expect(result.command).toBe(testCase.command);
      expect(result.plan?.actions[0]?.type).toBe(testCase.actionType);
    });
  }

  it("propagates ripple via the position slot on delete", () => {
    const result = planFromSlots(
      { action: "delete", property: "range", value: "1:10 to 1:25", position: "ripple" },
      context,
    );
    expect(result.command).toBe("delete 1:10 to 1:25 ripple");
    expect(result.plan?.actions[0]).toMatchObject({ type: "delete_range", rippleDelete: true });
  });

  it("derives the negative sign for decrease via the existing parser", () => {
    const result = planFromSlots({ action: "decrease", property: "contrast", value: "by 15%" }, context);
    expect(result.plan?.actions[0]).toMatchObject({ effect: { value: -15 } });
  });
});

describe("Command Editing v1 — split/move/text now round-trip to real plans (parser gaps closed)", () => {
  it("split serializes AND parses to a split_clip action", () => {
    const result = planFromSlots({ action: "split", property: "clip", value: "at 0:30" }, context);
    expect(result.command).toBe("split at 0:30");
    expect(result.plan?.actions[0]).toMatchObject({ type: "split_clip", target: { time: 30, clipId: "clip-1" } });
  });

  it("move serializes AND parses to a move_clip action", () => {
    const result = planFromSlots({ action: "move", property: "clip", value: "at 0:30" }, context);
    expect(result.command).toBe("move clip at 0:30");
    expect(result.plan?.actions[0]).toMatchObject({ type: "move_clip", target: { startTime: 30, clipId: "clip-1" } });
  });

  it("add text overlay serializes AND parses to an add_text_overlay action with named anchor", () => {
    const result = planFromSlots(
      { action: "add", property: "text", value: '"Hello"', position: "bottom-center" },
      context,
    );
    expect(result.command).toBe('add text "Hello" at bottom-center');
    expect(result.plan?.actions[0]).toMatchObject({
      type: "add_text_overlay",
      text: "Hello",
      position: "bottom-center",
    });
  });

  it("add text overlay without a position omits the anchor (apply-code defaults to bottom-center)", () => {
    const result = planFromSlots({ action: "add", property: "text", value: '"Hello"' }, context);
    expect(result.command).toBe('add text "Hello"');
    const action = result.plan?.actions[0];
    expect(action?.type).toBe("add_text_overlay");
    expect(action && "position" in action ? action.position : undefined).toBeUndefined();
  });
});

// --- helpers -------------------------------------------------------------

function findTimeDescriptor() {
  const action = findAction(COMMAND_GRAMMAR, "add")!;
  return findProperty(action, "transition")!.valueDescriptor;
}

function findEffectRangeDescriptor() {
  const action = findAction(COMMAND_GRAMMAR, "trim")!;
  return findProperty(action, "clip")!.valueDescriptor;
}
