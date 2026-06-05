import { describe, it, expect } from "vitest";
import { sampleProject, type Project, type Track } from "@videoforge/project-schema";
import { computeAudibleTrackIds, computeClipPlayback } from "../audioMix.js";

const clone = () => structuredClone(sampleProject) as Project;
const audioTrack = (p: Project) => p.tracks.find((t) => t.type === "audio")! as Extract<Track, { type: "audio" }>;
const voiceTrack = (p: Project) =>
  p.tracks.find((t) => t.type === "voiceover")! as Extract<Track, { type: "voiceover" }>;

describe("computeAudibleTrackIds — mute/solo gate", () => {
  it("audibles every non-muted audio/voiceover track when nothing is soloed", () => {
    const p = clone();
    const ids = computeAudibleTrackIds(p);
    expect(ids.has(audioTrack(p).id)).toBe(true);
    expect(ids.has(voiceTrack(p).id)).toBe(true);
    // Video tracks never contribute to the audio mix.
    expect(ids.has(p.tracks.find((t) => t.type === "video")!.id)).toBe(false);
  });

  it("drops a muted track", () => {
    const p = clone();
    audioTrack(p).muted = true;
    const ids = computeAudibleTrackIds(p);
    expect(ids.has(audioTrack(p).id)).toBe(false);
    expect(ids.has(voiceTrack(p).id)).toBe(true);
  });

  it("solo overrides mute: only soloed tracks are audible", () => {
    const p = clone();
    voiceTrack(p).solo = true;
    audioTrack(p).muted = false; // not muted, but should still be silenced by solo
    const ids = computeAudibleTrackIds(p);
    expect(ids.has(voiceTrack(p).id)).toBe(true);
    expect(ids.has(audioTrack(p).id)).toBe(false);
  });
});

describe("computeClipPlayback — scheduling math", () => {
  const clip = {
    startOnTimeline: 1000,
    endOnTimeline: 5000,
    trimIn: 200,
    trimOut: 4200,
    speed: 1,
  };

  it("schedules a clip whose start is ahead of the playhead with a delay", () => {
    const s = computeClipPlayback(clip, 0, 10, 10)!;
    expect(s.bufferOffsetSec).toBeCloseTo(0.2); // trimIn
    expect(s.whenSec).toBeCloseTo(11); // playStart 10 + (1000-0)/1000
    expect(s.playDurSec).toBeCloseTo(4.0); // (4200-200)/1000
    expect(s.speed).toBe(1);
  });

  it("advances into the buffer when the playhead is inside the clip", () => {
    const s = computeClipPlayback(clip, 3000, 10, 42)!;
    expect(s.bufferOffsetSec).toBeCloseTo(2.2); // (200 + (3000-1000)) / 1000
    expect(s.whenSec).toBe(42); // schedule immediately at now
    expect(s.playDurSec).toBeCloseTo(2.0); // 4.2 - 2.2
  });

  it("returns null when the playhead is past the clip end", () => {
    expect(computeClipPlayback(clip, 5000, 10, 10)).toBeNull();
    expect(computeClipPlayback(clip, 9999, 10, 10)).toBeNull();
  });

  it("accounts for playback speed when advancing into the buffer", () => {
    const fast = { startOnTimeline: 0, endOnTimeline: 2000, trimIn: 0, trimOut: 4000, speed: 2 };
    const s = computeClipPlayback(fast, 1000, 0, 5)!;
    // intoClip = (1000-0) * 2 = 2000ms into the source.
    expect(s.bufferOffsetSec).toBeCloseTo(2.0);
    expect(s.playDurSec).toBeCloseTo(2.0); // 4.0 - 2.0
    expect(s.speed).toBe(2);
  });

  it("returns null when the trim leaves nothing to play", () => {
    const empty = { startOnTimeline: 0, endOnTimeline: 4000, trimIn: 4000, trimOut: 4000, speed: 1 };
    expect(computeClipPlayback(empty, 0, 0, 0)).toBeNull();
  });
});
