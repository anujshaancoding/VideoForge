import { describe, expect, it } from "vitest";
import { parseEditCommandLocal } from "../parser.js";
import type { TimelineContext } from "../types.js";

const context: TimelineContext = {
  duration: 120,
  aspectRatio: "16:9",
  activeClipId: "clip-1",
  activeTrackId: "video-1",
  clips: [{ id: "clip-1", name: "Clip", startTime: 0, endTime: 120, trackId: "video-1", trackType: "video" }],
  tracks: [{ id: "video-1", type: "video" }, { id: "audio-1", type: "audio" }, { id: "caption-1", type: "caption" }],
};

describe("parseEditCommandLocal", () => {
  it("parses trim ranges", () => {
    const plan = parseEditCommandLocal("trim video from 0:30 to 0:43", context);
    expect(plan.actions[0]).toMatchObject({ type: "trim", target: { startTime: 30, endTime: 43 } });
  });

  it("parses bare trim ranges without the word from", () => {
    const plan = parseEditCommandLocal("trim 0:30 to 0:43", context);
    expect(plan.actions[0]).toMatchObject({ type: "trim", target: { startTime: 30, endTime: 43 } });
  });

  it("parses delete ranges as destructive", () => {
    const plan = parseEditCommandLocal("delete between 1:10 and 1:25", context);
    expect(plan.requiresConfirmation).toBe(true);
    expect(plan.actions[0]).toMatchObject({ type: "delete_range", target: { startTime: 70, endTime: 85 } });
  });

  it("parses transitions, effects, aspect, zoom, volume, mute, captions, and silence", () => {
    expect(parseEditCommandLocal("at 0:30 add fade transition", context).actions[0]?.type).toBe("add_transition");
    expect(parseEditCommandLocal("increase brightness by 10%", context).actions[0]).toMatchObject({ type: "adjust_effect", effect: { kind: "brightness", value: 10 } });
    expect(parseEditCommandLocal("decrease contrast by 15%", context).actions[0]).toMatchObject({ type: "adjust_effect", effect: { kind: "contrast", value: -15 } });
    expect(parseEditCommandLocal("make it 9:16", context).actions[0]).toMatchObject({ type: "change_aspect_ratio", aspectRatio: "9:16" });
    expect(parseEditCommandLocal("zoom in from 0:12 to 0:18", context).actions[0]).toMatchObject({ type: "add_zoom", target: { startTime: 12, endTime: 18 } });
    expect(parseEditCommandLocal("set volume to 20%", context).actions[0]).toMatchObject({ type: "adjust_audio", audio: { volume: 20 } });
    expect(parseEditCommandLocal("mute audio from 0:05 to 0:10", context).actions[0]).toMatchObject({ type: "adjust_audio", audio: { mute: true } });
    expect(parseEditCommandLocal("add caption \"Hello world\" from 0:02 to 0:05", context).actions[0]).toMatchObject({ type: "add_caption", caption: { text: "Hello world", startTime: 2, endTime: 5 } });
    expect(parseEditCommandLocal("remove silence longer than 1 second", context).actions[0]).toMatchObject({ type: "remove_silence", minSilenceDuration: 1 });
  });

  it("parses split at a time to a split_clip action targeting the active clip", () => {
    const plan = parseEditCommandLocal("split at 0:30", context);
    expect(plan.actions[0]).toMatchObject({ type: "split_clip", target: { time: 30, clipId: "clip-1" } });
  });

  it("parses move clip to a time to a move_clip action", () => {
    const plan = parseEditCommandLocal("move clip at 0:10", context);
    expect(plan.actions[0]).toMatchObject({ type: "move_clip", target: { startTime: 10, clipId: "clip-1" } });
  });

  it("does NOT treat 'remove' as a move command", () => {
    const plan = parseEditCommandLocal("remove silence longer than 1 second", context);
    expect(plan.actions.some((a) => a.type === "move_clip")).toBe(false);
  });

  it("parses add text overlay with a named anchor", () => {
    const plan = parseEditCommandLocal('add text "Hello" at bottom-center', context);
    expect(plan.actions[0]).toMatchObject({ type: "add_text_overlay", text: "Hello", position: "bottom-center" });
  });

  it("parses add text overlay without an anchor (position omitted)", () => {
    const plan = parseEditCommandLocal('add text "Hello"', context);
    const action = plan.actions[0];
    expect(action?.type).toBe("add_text_overlay");
    expect(action && "position" in action ? action.position : undefined).toBeUndefined();
  });

  it("reports invalid command as empty plan", () => {
    const plan = parseEditCommandLocal("make it cinematic", context);
    expect(plan.actions).toHaveLength(0);
  });
});
