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

describe("newProject", () => {
  it("produces a valid empty project", () => {
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
    expect(p.tracks).toEqual([]);
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
