import { beforeEach, describe, expect, it } from "vitest";
import { sampleProject, validateProject } from "@videoforge/project-schema";
import { useEditorStore } from "../editorStore.js";
import type { EditPlan } from "../../ai-edit/types.js";

function load() {
  useEditorStore.getState().loadProject(structuredClone(sampleProject));
}

function firstVideoClip() {
  const project = useEditorStore.getState().project;
  const track = project.tracks.find((item) => item.type === "video");
  if (!track || track.type !== "video") throw new Error("missing video track");
  return { track, clip: track.clips[0]! };
}

function overlayTrack() {
  const project = useEditorStore.getState().project;
  const track = project.tracks.find((item) => item.type === "overlay");
  if (!track || track.type !== "overlay") throw new Error("missing overlay track");
  return track;
}

describe("applyAIEditPlan", () => {
  beforeEach(load);

  it("applies trim as an undoable operation", () => {
    const { clip } = firstVideoClip();
    const result = useEditorStore.getState().applyAIEditPlan({
      summary: "Trim",
      requiresConfirmation: false,
      actions: [{ id: "a", type: "trim", target: { clipId: clip.id, startTime: 1, endTime: 2 } }],
    });
    expect(result.applied).toBe(1);
    expect(firstVideoClip().clip.startOnTimeline).toBe(1000);
    useEditorStore.getState().undo();
    expect(firstVideoClip().clip.startOnTimeline).toBe(clip.startOnTimeline);
  });

  it("applies delete ranges", () => {
    const plan: EditPlan = {
      summary: "Delete",
      requiresConfirmation: true,
      actions: [{ id: "a", type: "delete_range", target: { startTime: 0, endTime: 1 } }],
    };
    expect(useEditorStore.getState().applyAIEditPlan(plan).applied).toBe(1);
  });

  it("applies color effects, aspect ratio, volume, zoom, and captions", () => {
    const { clip } = firstVideoClip();
    const audio = useEditorStore.getState().project.tracks.find((item) => item.type === "audio");
    const volumeTarget = audio ? { trackId: audio.id } : undefined;
    const result = useEditorStore.getState().applyAIEditPlan({
      summary: "Multi",
      requiresConfirmation: true,
      actions: [
        { id: "brightness", type: "adjust_effect", effect: { kind: "brightness", value: 10 }, target: { clipId: clip.id } },
        { id: "contrast", type: "adjust_effect", effect: { kind: "contrast", value: -15 }, target: { clipId: clip.id } },
        { id: "aspect", type: "change_aspect_ratio", aspectRatio: "9:16" },
        { id: "zoom", type: "add_zoom", target: { clipId: clip.id, startTime: 0, endTime: 1 }, zoom: { fromScale: 1, toScale: 1.35 } },
        { id: "volume", type: "adjust_audio", audio: { volume: 20 }, target: volumeTarget },
        { id: "caption", type: "add_caption", caption: { text: "Hello world", startTime: 0, endTime: 1 } },
      ],
    });
    expect(result.applied).toBe(6);
    expect(firstVideoClip().clip.colorGrade).toMatchObject({ brightness: 10, contrast: -15 });
    expect(useEditorStore.getState().project.canvas.aspectRatio).toBe("9:16");
    expect(firstVideoClip().clip.kenBurns).toMatchObject({ startScale: 1, endScale: 1.35 });
    expect(useEditorStore.getState().project.captionTracks[0]?.blocks.at(-1)?.text).toBe("Hello world");
  });
});

describe("applyAIEditPlan — split (Command Editing v1)", () => {
  beforeEach(load);

  it("splits the targeted clip into two at the requested time and reverts in one undo", () => {
    const { track, clip } = firstVideoClip();
    const before = track.clips.length;
    const result = useEditorStore.getState().applyAIEditPlan({
      summary: "Split",
      requiresConfirmation: false,
      // clip A spans 0–4000ms; split at 2s.
      actions: [{ id: "s", type: "split_clip", target: { clipId: clip.id, time: 2 } }],
    });
    expect(result.applied).toBe(1);
    const after = firstVideoClip().track;
    expect(after.clips.length).toBe(before + 1);
    const left = after.clips.find((c) => c.id === clip.id)!;
    expect(left.endOnTimeline).toBe(2000);
    expect(left.trimOut).toBe(3000); // trimIn 1000 + 2000ms @ speed 1
    const right = after.clips.find((c) => c.startOnTimeline === 2000)!;
    expect(right.trimIn).toBe(3000);
    expect(right.endOnTimeline).toBe(4000);
    // AC-3: one atomic undo restores the original clip count.
    useEditorStore.getState().undo();
    expect(firstVideoClip().track.clips.length).toBe(before);
  });

  it("pushes a warning when the split time is outside the targeted clip", () => {
    const { clip } = firstVideoClip();
    const result = useEditorStore.getState().applyAIEditPlan({
      summary: "Split",
      requiresConfirmation: false,
      actions: [{ id: "s", type: "split_clip", target: { clipId: clip.id, time: 999 } }],
    });
    expect(result.applied).toBe(0);
    expect(result.warnings.length).toBeGreaterThan(0);
  });
});

describe("applyAIEditPlan — move (Command Editing v1)", () => {
  beforeEach(load);

  it("moves the targeted clip preserving duration and reverts in one undo", () => {
    const { clip } = firstVideoClip();
    const duration = clip.endOnTimeline - clip.startOnTimeline;
    const result = useEditorStore.getState().applyAIEditPlan({
      summary: "Move",
      requiresConfirmation: false,
      actions: [{ id: "m", type: "move_clip", target: { clipId: clip.id, startTime: 10 } }],
    });
    expect(result.applied).toBe(1);
    const moved = firstVideoClip().track.clips.find((c) => c.id === clip.id)!;
    expect(moved.startOnTimeline).toBe(10000);
    expect(moved.endOnTimeline - moved.startOnTimeline).toBe(duration);
    // AC-3: one atomic undo restores the original start.
    useEditorStore.getState().undo();
    expect(firstVideoClip().track.clips.find((c) => c.id === clip.id)!.startOnTimeline).toBe(clip.startOnTimeline);
  });
});

describe("applyAIEditPlan — add text overlay (AC-9)", () => {
  beforeEach(load);

  it("creates a schema-valid TextOverlay on the first overlay track at the bottom-center band", () => {
    const before = overlayTrack().clips.length;
    const result = useEditorStore.getState().applyAIEditPlan({
      summary: "Add text",
      requiresConfirmation: false,
      actions: [{ id: "t", type: "add_text_overlay", text: "Hello", position: "bottom-center" }],
    });
    expect(result.applied).toBe(1);
    const track = overlayTrack();
    expect(track.clips.length).toBe(before + 1);
    const created = track.clips.at(-1)!;
    expect(created.kind).toBe("text");
    if (created.kind !== "text") throw new Error("expected text overlay");
    expect(created.text).toBe("Hello");
    // bottom-center anchor => canvasY in the bottom third (PRD §AC-9 test).
    expect(created.canvasY).toBeGreaterThanOrEqual(66);
    expect(created.canvasX).toBe(10);
    expect(created.width).toBe(80);
    // Invariant: the whole project still validates against project-schema.
    expect(validateProject(useEditorStore.getState().project).ok).toBe(true);
  });

  it("defaults to the bottom-center anchor when no position is given", () => {
    const result = useEditorStore.getState().applyAIEditPlan({
      summary: "Add text",
      requiresConfirmation: false,
      actions: [{ id: "t", type: "add_text_overlay", text: "Default" }],
    });
    expect(result.applied).toBe(1);
    const created = overlayTrack().clips.at(-1)!;
    if (created.kind !== "text") throw new Error("expected text overlay");
    expect(created.canvasY).toBeGreaterThanOrEqual(66); // bottom-center default
  });

  it("reverts the created overlay in a single undo step (AC-3)", () => {
    const before = overlayTrack().clips.length;
    useEditorStore.getState().applyAIEditPlan({
      summary: "Add text",
      requiresConfirmation: false,
      actions: [{ id: "t", type: "add_text_overlay", text: "Undo me", position: "top-left" }],
    });
    expect(overlayTrack().clips.length).toBe(before + 1);
    useEditorStore.getState().undo();
    expect(overlayTrack().clips.length).toBe(before);
  });

  it("CREATES an overlay track when the project has none, then adds the text (D-6)", () => {
    // A fresh/blank project has no overlay track. "add text" must still work — it
    // creates an overlay track rather than erroring (found on a real blank project).
    const project = useEditorStore.getState().project;
    const stripped = {
      ...project,
      tracks: project.tracks.filter((t) => t.type !== "overlay"),
    };
    useEditorStore.getState().loadProject(structuredClone(stripped));
    expect(useEditorStore.getState().project.tracks.some((t) => t.type === "overlay")).toBe(false);

    const result = useEditorStore.getState().applyAIEditPlan({
      summary: "Add text",
      requiresConfirmation: false,
      actions: [{ id: "t", type: "add_text_overlay", text: "Hi there", position: "bottom-center" }],
    });
    expect(result.applied).toBe(1);
    expect(result.errors.length).toBe(0);
    const ov = useEditorStore.getState().project.tracks.find((t) => t.type === "overlay");
    expect(ov, "overlay track should have been created").toBeTruthy();
    if (!ov || ov.type !== "overlay") throw new Error("no overlay track");
    const added = ov.clips.at(-1)!;
    expect(added.kind === "text" && added.text).toBe("Hi there");
    // Whole project still schema-valid (invariant).
    expect(validateProject(useEditorStore.getState().project).ok).toBe(true);
  });
});
