import { describe, it, expect } from "vitest";
import {
  ProjectSchema,
  parseProject,
  validateProject,
  newProject,
  sampleProject,
  CURRENT_SCHEMA_VERSION,
  msToTimecode,
  timecodeToMs,
  type Project,
  type Track,
  type Clip,
} from "../index.js";

// Deep clone helper so tests never mutate the shared fixture.
const clone = (p: Project): Project => JSON.parse(JSON.stringify(p)) as Project;

// Strict-safe accessors (the suite runs under `noUncheckedIndexedAccess`).
function expectDefined<T>(value: T | undefined, msg: string): T {
  if (value === undefined) throw new Error(`expected defined: ${msg}`);
  return value;
}
function clipsOf(track: Track | undefined): Clip[] {
  if (track && (track.type === "video" || track.type === "audio" || track.type === "voiceover")) {
    return track.clips;
  }
  return [];
}

describe("sampleProject fixture", () => {
  it("validates against the schema", () => {
    const result = validateProject(sampleProject);
    expect(result.ok).toBe(true);
    expect(result.errors).toBeNull();
  });

  it("is stamped with the current schema version", () => {
    expect(sampleProject.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
  });

  it("has a crossfade transition referencing two adjacent video clips", () => {
    const t = expectDefined(sampleProject.transitions[0], "transition[0]");
    expect(t.type).toBe("crossfade");
    const videoTrack = sampleProject.tracks.find((tr) => tr.id === t.trackId);
    expect(videoTrack?.type).toBe("video");
    const clipIds = clipsOf(videoTrack).map((c) => c.id);
    expect(clipIds).toContain(t.fromClipId);
    expect(clipIds).toContain(t.toClipId);
  });

  it("has a linked audio<->voiceover clip pair", () => {
    const audioClip = clipsOf(sampleProject.tracks.find((tr) => tr.type === "audio"))[0];
    const voiceClip = clipsOf(sampleProject.tracks.find((tr) => tr.type === "voiceover"))[0];
    expect(audioClip?.linkedClipId).toBe(voiceClip?.id);
    expect(voiceClip?.linkedClipId).toBe(audioClip?.id);
  });

  it("has 2 caption blocks on a single caption track", () => {
    expect(sampleProject.captionTracks).toHaveLength(1);
    const ct = expectDefined(sampleProject.captionTracks[0], "captionTracks[0]");
    expect(ct.blocks).toHaveLength(2);
  });
});

describe("invariant enforcement", () => {
  it("rejects negative time (ms must be ≥ 0)", () => {
    const bad = clone(sampleProject);
    const track = bad.tracks[0];
    const clip = expectDefined(clipsOf(track)[0], "video clip[0]");
    clip.startOnTimeline = -100;
    expect(validateProject(bad).ok).toBe(false);
  });

  it("rejects non-integer milliseconds", () => {
    const bad = clone(sampleProject);
    const clip = expectDefined(clipsOf(bad.tracks[0])[0], "video clip[0]");
    clip.endOnTimeline = 4000.5;
    expect(validateProject(bad).ok).toBe(false);
  });

  it("rejects a malformed (non-v4) uuid", () => {
    const bad = clone(sampleProject);
    bad.id = "not-a-uuid";
    expect(validateProject(bad).ok).toBe(false);
  });

  it("rejects a non-v4 uuid (wrong version nibble)", () => {
    const bad = clone(sampleProject);
    // version nibble must be 4; this one is 1.
    bad.ownerId = "9b1deb4d-3b7d-1bad-9bdd-2b0d7b3dcb6d";
    expect(validateProject(bad).ok).toBe(false);
  });

  it("rejects percent > 100 on overlay geometry", () => {
    const bad = clone(sampleProject);
    const overlayTrack = bad.tracks.find((t) => t.type === "overlay");
    if (overlayTrack && overlayTrack.type === "overlay") {
      const overlay = expectDefined(overlayTrack.clips[0], "overlay clip[0]");
      overlay.canvasX = 150;
    }
    expect(validateProject(bad).ok).toBe(false);
  });

  it("rejects more than 4 caption tracks", () => {
    const bad = clone(sampleProject);
    const ct = expectDefined(bad.captionTracks[0], "captionTracks[0]");
    bad.captionTracks = [ct, ct, ct, ct, ct];
    expect(validateProject(bad).ok).toBe(false);
  });

  it("rejects unknown extra fields (strict)", () => {
    const bad = clone(sampleProject) as Project & { bogus?: unknown };
    bad.bogus = true;
    expect(validateProject(bad).ok).toBe(false);
  });

  it("parseProject throws on invalid input", () => {
    expect(() => parseProject({ schemaVersion: 1 })).toThrow();
  });
});

describe("M4 creative-layer clip fields (regression: must NOT 422)", () => {
  // The editor writes colorGrade / kenBurns / keyframe-id the instant a user touches
  // an M4 feature. These previously failed the strict schema → autosave 422 + export
  // rejection. This locks them in as valid.
  function firstVideoClip(p: Project): Clip {
    const t = p.tracks.find((tr) => tr.type === "video");
    return expectDefined(clipsOf(t)[0], "first video clip");
  }

  it("accepts a per-clip colorGrade", () => {
    const ok = clone(sampleProject);
    firstVideoClip(ok).colorGrade = { brightness: 10, contrast: -5, saturation: 20 };
    expect(validateProject(ok).ok).toBe(true);
  });

  it("accepts a kenBurns pan-zoom", () => {
    const ok = clone(sampleProject);
    firstVideoClip(ok).kenBurns = { startScale: 1.0, endScale: 1.4 };
    expect(validateProject(ok).ok).toBe(true);
  });

  it("accepts keyframes carrying a UUID id", () => {
    const ok = clone(sampleProject);
    firstVideoClip(ok).keyframes["opacity"] = [
      { id: "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d", timeMs: 0, value: 100, easing: "linear" },
    ];
    expect(validateProject(ok).ok).toBe(true);
  });

  it("still rejects an out-of-range colorGrade value", () => {
    const bad = clone(sampleProject);
    firstVideoClip(bad).colorGrade = { brightness: 999, contrast: 0, saturation: 0 };
    expect(validateProject(bad).ok).toBe(false);
  });
});

describe("newProject", () => {
  it("produces a valid project seeded with one empty video track", () => {
    const p = newProject({
      title: "My Reel",
      canvasWidth: 1080,
      canvasHeight: 1920,
      frameRate: 30,
    });
    expect(() => parseProject(p)).not.toThrow();
    expect(p.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(p.revision).toBe(1);
    expect(p.canvas.aspectRatio).toBe("9:16");
    // A fresh project ships with a single empty video lane so there is somewhere to
    // drop the first clip (an editor with zero tracks reads as broken).
    expect(p.tracks).toHaveLength(1);
    expect(p.tracks[0]).toMatchObject({ type: "video", clips: [] });
    expect(p.captionTracks).toEqual([]);
  });

  it("derives common aspect ratios and falls back to custom", () => {
    expect(
      newProject({ title: "a", canvasWidth: 1920, canvasHeight: 1080, frameRate: 30 }).canvas
        .aspectRatio,
    ).toBe("16:9");
    expect(
      newProject({ title: "b", canvasWidth: 1080, canvasHeight: 1080, frameRate: 30 }).canvas
        .aspectRatio,
    ).toBe("1:1");
    expect(
      newProject({ title: "c", canvasWidth: 1000, canvasHeight: 333, frameRate: 30 }).canvas
        .aspectRatio,
    ).toBe("custom");
  });
});

describe("round-trip parse", () => {
  it("survives JSON stringify -> parse -> validate unchanged", () => {
    const json = JSON.stringify(sampleProject);
    const back = parseProject(JSON.parse(json));
    expect(back).toEqual(sampleProject);
  });

  it("ProjectSchema.parse returns an equal object", () => {
    expect(ProjectSchema.parse(sampleProject)).toEqual(sampleProject);
  });
});

describe("timecode helpers", () => {
  it("formats ms to timecode at 30fps", () => {
    expect(msToTimecode(0, 30)).toBe("00:00:00");
    expect(msToTimecode(1000, 30)).toBe("00:01:00");
    expect(msToTimecode(1500, 30)).toBe("00:01:15"); // 0.5s = 15 frames @30
    expect(msToTimecode(3_661_000, 30)).toBe("01:01:01:00");
  });

  it("round-trips ms -> timecode -> ms at frame granularity", () => {
    const fps = 30;
    for (const ms of [0, 33, 1000, 1500, 8000, 3_661_000]) {
      const tc = msToTimecode(ms, fps);
      const back = timecodeToMs(tc, fps);
      // Within one frame of the original (timecode is frame-quantised).
      expect(Math.abs(back - ms)).toBeLessThanOrEqual(Math.round(1000 / fps));
    }
  });

  it("throws on malformed timecode", () => {
    expect(() => timecodeToMs("abc", 30)).toThrow();
    expect(() => timecodeToMs("1:2:3:4:5", 30)).toThrow();
  });
});

describe("Clip.transform (on-canvas PiP)", () => {
  it("accepts a valid transform on a media clip", () => {
    const p = clone(sampleProject);
    const vt = p.tracks.find((t) => t.type === "video");
    expectDefined(clipsOf(vt)[0], "video clip[0]").transform = {
      x: 25,
      y: 25,
      width: 50,
      height: 50,
    };
    expect(validateProject(p).ok).toBe(true);
  });

  it("rejects a transform with non-positive width", () => {
    const p = clone(sampleProject);
    const vt = p.tracks.find((t) => t.type === "video");
    expectDefined(clipsOf(vt)[0], "video clip[0]").transform = {
      x: 0,
      y: 0,
      width: 0,
      height: 50,
    };
    expect(validateProject(p).ok).toBe(false);
  });
});
