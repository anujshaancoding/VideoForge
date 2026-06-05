import { describe, it, expect, beforeEach } from "vitest";
import { sampleProject, type Clip, type Project, type Track } from "@videoforge/project-schema";
import {
  useEditorStore,
  selectProjectDurationMs,
  canUndo,
  canRedo,
  DEFAULT_PX_PER_SECOND,
} from "../editorStore.js";

// These exercise the REAL Zustand store (Immer middleware), which is the source of
// truth for every timeline edit. They pin the bug-prone invariants: the A/V link
// group staying in sync across move/trim/split, transition cleanup on delete,
// crossfade dedupe/clamp, clamping of mix params, and undo/redo over patches.

const get = () => useEditorStore.getState();

/** Fresh deep clone of the sample project so each test starts isolated. */
function loadFresh(): Project {
  const clone = structuredClone(sampleProject) as Project;
  get().loadProject(clone);
  return get().project;
}

const mediaTracks = (p: Project) =>
  p.tracks.filter((t): t is Extract<Track, { clips: Clip[] }> =>
    t.type === "video" || t.type === "audio" || t.type === "voiceover",
  );
const trackByType = (p: Project, type: Track["type"]) => p.tracks.find((t) => t.type === type)!;
const findClip = (p: Project, id: string): Clip | undefined =>
  mediaTracks(p).flatMap((t) => t.clips).find((c) => c.id === id);

let videoTrackId: string;
let audioTrackId: string;
let voiceTrackId: string;
let videoClipA: string;
let videoClipB: string;
let audioClipId: string;
let voiceClipId: string;

beforeEach(() => {
  const p = loadFresh();
  // loadProject deliberately preserves the view zoom; reset it for test isolation
  // since the Zustand store is a module singleton shared across tests.
  get().setZoom(DEFAULT_PX_PER_SECOND);
  videoTrackId = trackByType(p, "video").id;
  audioTrackId = trackByType(p, "audio").id;
  voiceTrackId = trackByType(p, "voiceover").id;
  const vt = trackByType(p, "video") as Extract<Track, { clips: Clip[] }>;
  videoClipA = vt.clips[0]!.id;
  videoClipB = vt.clips[1]!.id;
  audioClipId = (trackByType(p, "audio") as Extract<Track, { clips: Clip[] }>).clips[0]!.id;
  voiceClipId = (trackByType(p, "voiceover") as Extract<Track, { clips: Clip[] }>).clips[0]!.id;
});

describe("addClipFromAsset", () => {
  it("appends a clip spanning the real source duration and selects it", () => {
    const before = (trackByType(get().project, "video") as any).clips.length;
    get().addClipFromAsset("asset-x", videoTrackId, 1000, 6000);
    const p = get().project;
    const vt = trackByType(p, "video") as Extract<Track, { clips: Clip[] }>;
    expect(vt.clips.length).toBe(before + 1);
    const added = vt.clips.find((c) => c.sourceAssetId === "asset-x")!;
    expect(added.startOnTimeline).toBe(1000);
    expect(added.endOnTimeline).toBe(7000); // start + 6000
    expect(added.trimIn).toBe(0);
    expect(added.trimOut).toBe(6000);
    expect(get().selection).toEqual({ kind: "clip", id: added.id });
  });

  it("falls back to the default span when source duration is unknown", () => {
    get().addClipFromAsset("asset-y", videoTrackId, 0);
    const added = (trackByType(get().project, "video") as any).clips.find(
      (c: Clip) => c.sourceAssetId === "asset-y",
    );
    expect(added.endOnTimeline).toBe(4000); // DEFAULT_NEW_CLIP_MS
  });

  it("creates a linked audio clip on an audio track for a video import (A/V link)", () => {
    const audioBefore = (trackByType(get().project, "audio") as any).clips.length;
    get().addClipFromAsset("asset-vid", videoTrackId, 0, 5000);
    const p = get().project;
    const added = (trackByType(p, "video") as any).clips.find(
      (c: Clip) => c.sourceAssetId === "asset-vid",
    ) as Clip;
    expect(added.linkedClipId).not.toBeNull();
    const audio = trackByType(p, "audio") as Extract<Track, { clips: Clip[] }>;
    expect(audio.clips.length).toBe(audioBefore + 1);
    const linked = findClip(p, added.linkedClipId!)!;
    expect(linked.linkedClipId).toBe(added.id); // bidirectional link
    expect(linked.startOnTimeline).toBe(added.startOnTimeline);
  });
});

describe("splitAtPlayhead", () => {
  it("splits the selected clip at the playhead, preserving source mapping", () => {
    get().select("clip", videoClipA); // 0–4000, trimIn 1000, trimOut 5000
    get().setPlayhead(2000);
    get().splitAtPlayhead();

    const vt = trackByType(get().project, "video") as Extract<Track, { clips: Clip[] }>;
    expect(vt.clips.length).toBe(3);
    const left = vt.clips.find((c) => c.id === videoClipA)!;
    expect(left.endOnTimeline).toBe(2000);
    expect(left.trimOut).toBe(3000); // trimIn 1000 + offset 2000
    const right = vt.clips.find((c) => c.startOnTimeline === 2000 && c.id !== videoClipA)!;
    expect(right.endOnTimeline).toBe(4000);
    expect(right.trimIn).toBe(3000);
    expect(right.trimOut).toBe(5000);
  });

  it("splits a linked A/V pair together and re-links the new right halves", () => {
    get().select("clip", audioClipId); // linked to voice clip
    get().setPlayhead(3000);
    get().splitAtPlayhead();

    const p = get().project;
    const audio = trackByType(p, "audio") as Extract<Track, { clips: Clip[] }>;
    const voice = trackByType(p, "voiceover") as Extract<Track, { clips: Clip[] }>;
    expect(audio.clips.length).toBe(2);
    expect(voice.clips.length).toBe(2);

    const audioRight = audio.clips.find((c) => c.startOnTimeline === 3000)!;
    const voiceRight = voice.clips.find((c) => c.startOnTimeline === 3000)!;
    expect(audioRight.linkedClipId).toBe(voiceRight.id);
    expect(voiceRight.linkedClipId).toBe(audioRight.id);
  });

  it("is a no-op when the playhead is outside every clip", () => {
    get().clearSelection();
    get().setPlayhead(999999);
    get().splitAtPlayhead();
    const vt = trackByType(get().project, "video") as Extract<Track, { clips: Clip[] }>;
    expect(vt.clips.length).toBe(2);
  });
});

describe("trimClip", () => {
  it("enforces a one-frame minimum on the end edge", () => {
    // frameRate 30 → min clip ≈ 33ms.
    get().trimClip(videoClipA, "end", 10);
    const clip = findClip(get().project, videoClipA)!;
    expect(clip.endOnTimeline).toBe(33);
    expect(clip.trimOut).toBe(1033); // trimIn 1000 + 33
  });

  it("shifts trimIn (asset-relative) when the start edge moves in", () => {
    get().trimClip(videoClipA, "start", 1000);
    const clip = findClip(get().project, videoClipA)!;
    expect(clip.startOnTimeline).toBe(1000);
    expect(clip.trimIn).toBe(2000); // original 1000 + delta 1000 × speed 1
  });
});

describe("moveClip", () => {
  it("shifts the linked partner by the same delta on a same-track move", () => {
    get().moveClip(audioClipId, audioTrackId, 2000); // delta +2000
    const p = get().project;
    const moved = findClip(p, audioClipId)!;
    const voice = findClip(p, voiceClipId)!;
    expect(moved.startOnTimeline).toBe(2000);
    expect(voice.startOnTimeline).toBe(2500); // 500 + 2000
    expect(voice.endOnTimeline).toBe(8500); // 6500 + 2000
  });

  it("relocates a clip to another track and updates its trackId", () => {
    get().moveClip(audioClipId, voiceTrackId, 0);
    const p = get().project;
    const audio = trackByType(p, "audio") as Extract<Track, { clips: Clip[] }>;
    expect(audio.clips.find((c) => c.id === audioClipId)).toBeUndefined();
    const moved = findClip(p, audioClipId)!;
    expect(moved.trackId).toBe(voiceTrackId);
  });
});

describe("duplicateSelected", () => {
  it("inserts an unlinked copy directly after the original and selects it", () => {
    get().select("clip", videoClipA); // 0–4000
    get().duplicateSelected();
    const p = get().project;
    const vt = trackByType(p, "video") as Extract<Track, { clips: Clip[] }>;
    expect(vt.clips.length).toBe(3);
    const copy = findClip(p, get().selection.id!)!;
    expect(copy.startOnTimeline).toBe(4000); // appended after the original end
    expect(copy.endOnTimeline).toBe(8000);
    expect(copy.linkedClipId).toBeNull();
  });
});

describe("deleteSelected", () => {
  it("removes the clip and any transition that referenced it", () => {
    expect(get().project.transitions).toHaveLength(1);
    get().select("clip", videoClipA); // transition A→B references it
    get().deleteSelected();
    const p = get().project;
    expect(findClip(p, videoClipA)).toBeUndefined();
    expect(p.transitions).toHaveLength(0);
    expect(get().selection).toEqual({ kind: null, id: null });
  });
});

describe("addCrossfade / removeTransition", () => {
  it("does not duplicate an existing transition for the same pair", () => {
    get().addCrossfade(videoClipA); // A→B transition already exists
    expect(get().project.transitions).toHaveLength(1);
  });

  it("creates a clamped crossfade between a clip and the next on its track", () => {
    get().removeTransition(get().project.transitions[0]!.id);
    expect(get().project.transitions).toHaveLength(0);
    get().addCrossfade(videoClipA, 99999); // clamp to the shorter clip length
    const t = get().project.transitions[0]!;
    expect(t).toBeDefined();
    expect(t.type).toBe("crossfade");
    expect(t.fromClipId).toBe(videoClipA);
    expect(t.toClipId).toBe(videoClipB);
    expect(t.durationMs).toBeLessThanOrEqual(4500);
    expect(t.durationMs).toBeGreaterThanOrEqual(100);
  });

  it("is a no-op on the last clip of a track (no next clip)", () => {
    get().removeTransition(get().project.transitions[0]!.id);
    get().addCrossfade(videoClipB); // B is last
    expect(get().project.transitions).toHaveLength(0);
  });
});

describe("clamping of mix params", () => {
  it("clamps per-clip gain to 0–200", () => {
    get().setClipGain(audioClipId, audioTrackId, 999);
    expect(findClip(get().project, audioClipId)!.gain).toBe(200);
    get().setClipGain(audioClipId, audioTrackId, -50);
    expect(findClip(get().project, audioClipId)!.gain).toBe(0);
  });

  it("clamps a fade to the clip span", () => {
    const clip = findClip(get().project, audioClipId)!;
    const span = clip.endOnTimeline - clip.startOnTimeline;
    get().setClipFade(audioClipId, audioTrackId, "in", span + 5000);
    expect(findClip(get().project, audioClipId)!.fadeInMs).toBe(span);
  });

  it("clamps track volume to 0–200 and pan to -100–100", () => {
    get().setTrackVolume(audioTrackId, 500);
    get().setTrackPan(audioTrackId, -500);
    const t = trackByType(get().project, "audio") as Extract<Track, { type: "audio" }>;
    expect(t.volume).toBe(200);
    expect(t.pan).toBe(-100);
  });
});

describe("zoom", () => {
  it("clamps pxPerSecond into the allowed band and mirrors zoom", () => {
    get().setZoom(1);
    expect(get().zoom).toBe(10);
    expect(get().pxPerSecond).toBe(10);
    get().setZoom(100000);
    expect(get().zoom).toBe(800);
    expect(get().pxPerSecond).toBe(800);
  });
});

describe("captions", () => {
  it("imports caption blocks and edits a block in place", () => {
    get().importCaptions([
      { id: "cap-1", startMs: 0, endMs: 1000, text: "hello" },
    ] as any);
    expect(get().project.captionTracks[0]!.blocks).toHaveLength(1);
    get().updateCaption("cap-1", { text: "world", endMs: 2000 });
    const block = get().project.captionTracks[0]!.blocks[0]!;
    expect(block.text).toBe("world");
    expect(block.endMs).toBe(2000);
  });
});

describe("addTextOverlay", () => {
  it("pushes a text overlay onto the overlay track at the playhead and selects it", () => {
    const overlay = trackByType(get().project, "overlay") as Extract<Track, { type: "overlay" }>;
    const before = overlay.clips.length;
    get().addTextOverlay("Title", overlay.id, 1500);
    const after = trackByType(get().project, "overlay") as Extract<Track, { type: "overlay" }>;
    expect(after.clips.length).toBe(before + 1);
    const added = after.clips[after.clips.length - 1]!;
    expect(added.kind).toBe("text");
    expect((added as Extract<typeof added, { kind: "text" }>).text).toBe("Title");
    expect(added.startOnTimeline).toBe(1500);
    expect(added.endOnTimeline).toBeGreaterThan(added.startOnTimeline);
    expect(get().selection).toEqual({ kind: "overlay", id: added.id });
  });

  it("is a guarded no-op when the target track is not an overlay track", () => {
    const overlay = trackByType(get().project, "overlay") as Extract<Track, { type: "overlay" }>;
    const before = overlay.clips.length;
    // Pass a VIDEO track id — the action must not push an overlay onto it.
    get().addTextOverlay("Body", videoTrackId, 0);
    const vt = trackByType(get().project, "video") as Extract<Track, { clips: Clip[] }>;
    expect(vt.clips.every((c) => "sourceAssetId" in c)).toBe(true); // no text overlay leaked in
    const after = trackByType(get().project, "overlay") as Extract<Track, { type: "overlay" }>;
    expect(after.clips.length).toBe(before);
  });

  // Regression for the "Text caption not working" bug: a fresh project (newProject)
  // has NO overlay track, so the panel must create one on demand. addTrack('overlay')
  // followed by addTextOverlay reproduces that path end-to-end.
  it("works after creating an overlay track on demand (no overlay lane initially)", () => {
    // Strip every overlay track to simulate a freshly-created project.
    const p = structuredClone(get().project) as Project;
    p.tracks = p.tracks.filter((t) => t.type !== "overlay");
    get().loadProject(p);
    expect(get().project.tracks.some((t) => t.type === "overlay")).toBe(false);

    get().addTrack("overlay");
    const overlay = get().project.tracks.find((t) => t.type === "overlay") as
      | Extract<Track, { type: "overlay" }>
      | undefined;
    expect(overlay).toBeDefined();
    get().addTextOverlay("Caption style", overlay!.id, 2000);

    const after = get().project.tracks.find((t) => t.type === "overlay") as Extract<
      Track,
      { type: "overlay" }
    >;
    expect(after.clips).toHaveLength(1);
    expect((after.clips[0] as Extract<(typeof after.clips)[number], { kind: "text" }>).text).toBe(
      "Caption style",
    );
    expect(get().selection.kind).toBe("overlay");
  });
});

describe("undo / redo integration", () => {
  it("undoes and redoes a structural edit, and navigation is not undoable", () => {
    get().select("clip", videoClipA);
    get().deleteSelected();
    expect(findClip(get().project, videoClipA)).toBeUndefined();
    expect(canUndo()).toBe(true);

    get().undo();
    expect(findClip(get().project, videoClipA)).toBeDefined(); // restored
    expect(canRedo()).toBe(true);

    get().redo();
    expect(findClip(get().project, videoClipA)).toBeUndefined(); // re-applied
  });

  it("does not push undo history for playhead / zoom navigation", () => {
    expect(canUndo()).toBe(false);
    get().setPlayhead(1234);
    get().setZoom(200);
    get().play();
    get().pause();
    expect(canUndo()).toBe(false);
  });

  it("loadProject starts a clean history timeline", () => {
    get().select("clip", videoClipA);
    get().deleteSelected();
    expect(canUndo()).toBe(true);
    loadFresh();
    expect(canUndo()).toBe(false);
    expect(get().playheadMs).toBe(0);
    expect(get().isPlaying).toBe(false);
    expect(get().selection).toEqual({ kind: null, id: null });
  });
});

describe("on-canvas transform (PiP)", () => {
  it("sets and clears a clip's transform", () => {
    get().setClipTransform(videoClipA, videoTrackId, { x: 10, y: 10, width: 40, height: 40 });
    expect(findClip(get().project, videoClipA)!.transform).toEqual({
      x: 10,
      y: 10,
      width: 40,
      height: 40,
    });
    get().setClipTransform(videoClipA, videoTrackId, undefined);
    expect(findClip(get().project, videoClipA)!.transform).toBeUndefined();
  });

  it("setClipFlip toggles horizontal/vertical mirror", () => {
    get().setClipFlip(videoClipA, videoTrackId, "h", true);
    expect(findClip(get().project, videoClipA)!.flipH).toBe(true);
    get().setClipFlip(videoClipA, videoTrackId, "v", true);
    expect(findClip(get().project, videoClipA)!.flipV).toBe(true);
    get().setClipFlip(videoClipA, videoTrackId, "h", false);
    expect(findClip(get().project, videoClipA)!.flipH).toBe(false);
  });

  it("moveClipLayer reorders the clip's video track in the z-stack", () => {
    get().addClipToCanvas("a", 0, 1000); // adds a 2nd video track ON TOP, selects new clip
    const newId = get().selection.id!;
    const before = get().project.tracks.filter((t) => t.type === "video").map((t) => t.id);
    expect(before).toHaveLength(2);
    get().moveClipLayer(newId, "backward");
    const after = get().project.tracks.filter((t) => t.type === "video").map((t) => t.id);
    expect(after).toEqual([before[1], before[0]]); // swapped
  });

  it("addClipToCanvas adds a top video track with a centred PiP clip and selects it", () => {
    const videoTracksBefore = get().project.tracks.filter((t) => t.type === "video").length;
    get().addClipToCanvas("asset-pip", 0, 3000);
    const p = get().project;
    const videoTracks = p.tracks.filter((t): t is Extract<Track, { clips: Clip[] }> => t.type === "video");
    expect(videoTracks.length).toBe(videoTracksBefore + 1);
    const newClip = findClip(p, get().selection.id!)!;
    expect(newClip.sourceAssetId).toBe("asset-pip");
    expect(newClip.transform).toEqual({ x: 25, y: 25, width: 50, height: 50 });
    // Topmost video track (last in array, = top of z-order) holds the PiP clip.
    expect(videoTracks[videoTracks.length - 1]!.clips.some((c) => c.id === newClip.id)).toBe(true);
  });
});

describe("detachAudio", () => {
  it("breaks the A/V link on both partner clips", () => {
    expect(findClip(get().project, audioClipId)!.linkedClipId).toBe(voiceClipId);
    get().detachAudio(audioClipId);
    expect(findClip(get().project, audioClipId)!.linkedClipId).toBeNull();
    expect(findClip(get().project, voiceClipId)!.linkedClipId).toBeNull();
  });
});

describe("selectProjectDurationMs", () => {
  it("returns the latest timeline end across all timed items", () => {
    // sample project: audio clip ends at 8000, video clip B ends at 8000.
    expect(selectProjectDurationMs(get())).toBe(8000);
  });
});

describe("replaceClipAsset (template slot fill)", () => {
  it("swaps the clip's source asset, keeping its timeline placement + effects", () => {
    const before = findClip(get().project, videoClipB)!;
    const placement = { start: before.startOnTimeline, end: before.endOnTimeline };
    const effectCount = before.effects.length;

    get().replaceClipAsset(videoClipB, videoTrackId, "fee1f00d-dead-4bee-8fed-0a1b2c3d4e5f");

    const after = findClip(get().project, videoClipB)!;
    expect(after.sourceAssetId).toBe("fee1f00d-dead-4bee-8fed-0a1b2c3d4e5f");
    expect(after.startOnTimeline).toBe(placement.start);
    expect(after.endOnTimeline).toBe(placement.end);
    expect(after.effects.length).toBe(effectCount); // color grade / effects untouched
  });

  it("re-bases trims onto a shorter new source so it can't over-trim", () => {
    // videoClipA: trimIn 1000, trimOut 5000 (4000ms window) in the sample project.
    get().replaceClipAsset(videoClipA, videoTrackId, "feedface-dead-4bee-8fed-0a1b2c3d4e60", 2500);
    const after = findClip(get().project, videoClipA)!;
    expect(after.trimIn).toBe(0);
    expect(after.trimOut).toBe(2500); // min(5000, 2500)
  });

  it("does not re-base trims when no source duration is supplied", () => {
    const before = findClip(get().project, videoClipA)!;
    const { trimIn, trimOut } = before;
    get().replaceClipAsset(videoClipA, videoTrackId, "feedface-dead-4bee-8fed-0a1b2c3d4e61");
    const after = findClip(get().project, videoClipA)!;
    expect(after.trimIn).toBe(trimIn);
    expect(after.trimOut).toBe(trimOut);
  });

  it("is undoable (one commit on the patch stack)", () => {
    const original = findClip(get().project, videoClipB)!.sourceAssetId;
    get().replaceClipAsset(videoClipB, videoTrackId, "feedface-dead-4bee-8fed-0a1b2c3d4e62");
    expect(canUndo()).toBe(true);
    get().undo();
    expect(findClip(get().project, videoClipB)!.sourceAssetId).toBe(original);
  });

  it("no-ops on an unknown clip id", () => {
    const before = JSON.stringify(get().project);
    get().replaceClipAsset("00000000-0000-4000-8000-999999999999", videoTrackId, "feedface-dead-4bee-8fed-0a1b2c3d4e63");
    expect(JSON.stringify(get().project)).toBe(before);
  });
});
