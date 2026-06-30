import { describe, expect, it } from "vitest";
import { validateEditPlan } from "../validation.js";
import type { EditPlan, TimelineContext } from "../types.js";

const context: TimelineContext = {
  duration: 20,
  aspectRatio: "16:9",
  clips: [{ id: "clip-1", name: "Clip", startTime: 0, endTime: 20, trackId: "video-1", trackType: "video" }],
  tracks: [{ id: "video-1", type: "video" }, { id: "audio-1", type: "audio" }],
};

describe("validateEditPlan", () => {
  it("accepts valid edit plans", () => {
    const plan: EditPlan = {
      summary: "Trim",
      requiresConfirmation: false,
      actions: [{ id: "a", type: "trim", target: { startTime: 1, endTime: 2 } }],
    };
    expect(validateEditPlan(plan, context).valid).toBe(true);
  });

  it("rejects out-of-range times", () => {
    const plan: EditPlan = {
      summary: "Trim",
      requiresConfirmation: false,
      actions: [{ id: "a", type: "trim", target: { startTime: 10, endTime: 30 } }],
    };
    expect(validateEditPlan(plan, context).errors).toContain("Time range is outside the video duration.");
  });

  it("requires confirmation for destructive edits", () => {
    const plan: EditPlan = {
      summary: "Delete",
      requiresConfirmation: false,
      actions: [{ id: "a", type: "delete_range", target: { startTime: 1, endTime: 2 } }],
    };
    expect(validateEditPlan(plan, context).requiresConfirmation).toBe(true);
  });
});
