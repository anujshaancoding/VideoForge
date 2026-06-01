// ─────────────────────────────────────────────────────────────────────────────
// Unit tests for the §10.3 FFmpeg command builder. Drives the canonical
// sampleProject fixture from @videoforge/project-schema and asserts the graph
// honours "what you cut is what you get": trims, transition, mix, captions,
// watermark — and that the builder is pure/deterministic.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect } from "vitest";
import { sampleProject } from "@videoforge/project-schema";
import {
  buildExportCommand,
  captionsToSrt,
  atempoChain,
  type ExportSettings,
} from "../buildFilterComplex.js";

// 1080p 9:16 export with burned-in captions and the Free-tier watermark on.
const burnSettings: ExportSettings = {
  format: "mp4",
  videoCodec: "h264",
  resolution: { w: 1080, h: 1920 },
  fps: 30,
  crf: 20,
  captions: "burn",
  watermark: true,
};

describe("buildExportCommand — trims (-ss/-to from source origin, §10.3/§3.8)", () => {
  it("emits accurate-seek -ss/-to for each clip's trimIn/trimOut", () => {
    const { args } = buildExportCommand(sampleProject, burnSettings);
    const joined = args.join(" ");

    // VIDEO_CLIP_A: trimIn 1000 → -ss 1, trimOut 5000 → -to 5.
    expect(joined).toContain("-ss 1 -to 5 -i asset:");
    // VIDEO_CLIP_B: trimIn 0 → -ss 0, trimOut 4500 → -to 4.5.
    expect(joined).toContain("-ss 0 -to 4.5 -i asset:");
    // AUDIO_CLIP: trimIn 0 → -ss 0, trimOut 8000 → -to 8.
    expect(joined).toContain("-ss 0 -to 8 -i asset:");
  });

  it("places -ss/-to BEFORE -i (accurate seek) on every clip input", () => {
    const { inputs } = buildExportCommand(sampleProject, burnSettings);
    const clipInputs = inputs.filter((i) => i.kind === "clip");
    expect(clipInputs.length).toBeGreaterThan(0);
    for (const inp of clipInputs) {
      expect(inp.preArgs[0]).toBe("-ss");
      expect(inp.preArgs[2]).toBe("-to");
    }
  });
});

describe("buildExportCommand — crossfade transition (xfade, §6.4/§10.3)", () => {
  it("emits an xfade between the two adjacent video clips", () => {
    const { filterComplex } = buildExportCommand(sampleProject, burnSettings);
    expect(filterComplex).toMatch(/xfade=transition=fade:duration=0\.5:offset=/);
  });

  it("computes the xfade offset from the FROM clip's timeline length minus duration", () => {
    // CLIP_A timeline length = 4000ms, transition 500ms → offset 3500ms = 3.5s.
    const { filterComplex } = buildExportCommand(sampleProject, burnSettings);
    expect(filterComplex).toContain("xfade=transition=fade:duration=0.5:offset=3.5");
  });
});

describe("buildExportCommand — audio mix (amix normalize=0 + alimiter, §10.3 D-6)", () => {
  it("sums tracks with amix=...:normalize=0 and applies an alimiter master", () => {
    const { filterComplex } = buildExportCommand(sampleProject, burnSettings);
    expect(filterComplex).toMatch(/amix=inputs=2:normalize=0/);
    expect(filterComplex).toContain("alimiter=");
  });

  it("preserves pitch via atempo only when speed != 1 (none in the fixture)", () => {
    const { filterComplex } = buildExportCommand(sampleProject, burnSettings);
    // All sample clips are speed=1, so no atempo should appear.
    expect(filterComplex).not.toContain("atempo=");
  });
});

describe("buildExportCommand — mute/solo gating (§10.3 B-8/X-6)", () => {
  it("drops a muted audio track from the amix inputs", () => {
    const muted = structuredClone(sampleProject);
    // Mute the Music (audio) track → only the voiceover survives → single track, no amix master.
    const audioTrack = muted.tracks.find((t) => t.type === "audio")!;
    audioTrack.muted = true;
    const { filterComplex } = buildExportCommand(muted, burnSettings);
    // Two audible → master amix; one audible → alimiter directly, no master amix=inputs=2.
    expect(filterComplex).not.toContain("amix=inputs=2:normalize=0");
    expect(filterComplex).toContain("alimiter=");
  });

  it("when a track is soloed, all non-soloed audio tracks are dropped", () => {
    const soloed = structuredClone(sampleProject);
    const voice = soloed.tracks.find((t) => t.type === "voiceover")!;
    voice.solo = true;
    const { inputs } = buildExportCommand(soloed, burnSettings);
    // Only video clips + the soloed voice clip + subtitles + watermark should be inputs;
    // the music audio clip must NOT be present.
    const assetInputs = inputs.filter((i) => i.kind === "clip").map((i) => i.assetId);
    // Music asset id from the fixture must be absent.
    expect(assetInputs).not.toContain("c8d9e0f1-6576-4789-b9a4-1f2031425365");
  });
});

describe("buildExportCommand — burned-in captions (subtitles filter, §10.3/§22.3)", () => {
  it("includes a subtitles filter and a subtitles input when captions:'burn'", () => {
    const { filterComplex, inputs } = buildExportCommand(sampleProject, burnSettings);
    expect(filterComplex).toContain("subtitles");
    expect(inputs.some((i) => i.kind === "subtitles")).toBe(true);
  });

  it("omits the subtitles filter when captions:'none'", () => {
    const { filterComplex, inputs } = buildExportCommand(sampleProject, {
      ...burnSettings,
      captions: "none",
    });
    expect(filterComplex).not.toContain("subtitles");
    expect(inputs.some((i) => i.kind === "subtitles")).toBe(false);
  });

  it("serialises caption blocks to deterministic, time-ordered SRT", () => {
    const srt = captionsToSrt(sampleProject.captionTracks[0]!);
    expect(srt).toContain("00:00:00,500 --> 00:00:03,500");
    expect(srt).toContain("Up to 50% off this weekend.");
    expect(srt).toContain("Shop now before it's gone.");
    // First block index is 1 and appears before the second.
    expect(srt.indexOf("Up to 50%")).toBeLessThan(srt.indexOf("Shop now"));
  });
});

describe("buildExportCommand — Free-tier watermark (final overlay, §10.2/§10.3)", () => {
  it("appends a watermark input + overlay when watermark:true", () => {
    const { filterComplex, inputs, outputLabel } = buildExportCommand(sampleProject, burnSettings);
    expect(inputs.some((i) => i.kind === "watermark")).toBe(true);
    // ~10% width, 70% opacity, bottom-right inset.
    expect(filterComplex).toContain("scale=108:-1"); // 10% of 1080
    expect(filterComplex).toContain("colorchannelmixer=aa=0.7");
    expect(filterComplex).toContain("overlay=W-w-16:H-h-16");
    expect(outputLabel).toBe("[vout]");
  });

  it("emits no watermark input when watermark:false", () => {
    const { inputs, filterComplex } = buildExportCommand(sampleProject, {
      ...burnSettings,
      watermark: false,
    });
    expect(inputs.some((i) => i.kind === "watermark")).toBe(false);
    expect(filterComplex).not.toContain("overlay=W-w-16:H-h-16");
  });
});

describe("buildExportCommand — color grade (eq, §6.1/§10.3)", () => {
  it("maps the enabled colorGrade effect to an eq filter", () => {
    // Fixture CLIP_B has contrast:8, saturation:12 → eq contrast 1.08, saturation 1.12.
    const { filterComplex } = buildExportCommand(sampleProject, burnSettings);
    expect(filterComplex).toContain("eq=brightness=0:contrast=1.08:saturation=1.12");
  });
});

describe("buildExportCommand — scale/pad to output resolution (§10.2)", () => {
  it("scales+pads each video clip to the target resolution", () => {
    const { filterComplex } = buildExportCommand(sampleProject, burnSettings);
    expect(filterComplex).toContain("scale=1080:1920:force_original_aspect_ratio=decrease");
    expect(filterComplex).toContain("pad=1080:1920");
  });
});

describe("buildExportCommand — encoder argv (§3.8)", () => {
  it("targets H.264/CRF/yuv420p and AAC stereo", () => {
    const { args } = buildExportCommand(sampleProject, burnSettings);
    const joined = args.join(" ");
    expect(joined).toContain("-c:v libx264");
    expect(joined).toContain("-crf 20");
    expect(joined).toContain("-pix_fmt yuv420p");
    expect(joined).toContain("-c:a aac");
    expect(joined).toContain("-r 30");
  });
});

describe("buildExportCommand — determinism (pure builder, MVP_Scope §3.8)", () => {
  it("produces byte-identical output for the same input", () => {
    const a = buildExportCommand(sampleProject, burnSettings);
    const b = buildExportCommand(sampleProject, burnSettings);
    expect(a.filterComplex).toBe(b.filterComplex);
    expect(a.args).toEqual(b.args);
    expect(a.inputs).toEqual(b.inputs);
    expect(a.outputLabel).toBe(b.outputLabel);
  });
});

describe("atempoChain — speed decomposition into 0.5–2.0 factors (§5.1)", () => {
  it("returns a single factor when in range", () => {
    expect(atempoChain(1.5)).toEqual(["1.5"]);
    expect(atempoChain(0.5)).toEqual(["0.5"]);
  });

  it("chains factors for speeds above 2x", () => {
    // 4x → 2 * 2
    expect(atempoChain(4)).toEqual(["2", "2"]);
    // 8x → 2 * 2 * 2
    expect(atempoChain(8)).toEqual(["2", "2", "2"]);
  });

  it("chains factors for speeds below 0.5x", () => {
    // 0.25x → 0.5 * 0.5
    expect(atempoChain(0.25)).toEqual(["0.5", "0.5"]);
  });
});

describe("buildExportCommand — speed clips emit setpts/atempo (§3.3/§5.1)", () => {
  it("applies setpts on video and atempo on audio for a 2x clip", () => {
    const sped = structuredClone(sampleProject);
    const vt = sped.tracks.find((t) => t.type === "video")!;
    vt.clips[0]!.speed = 2;
    const at = sped.tracks.find((t) => t.type === "audio")!;
    at.clips[0]!.speed = 2;
    const { filterComplex } = buildExportCommand(sped, burnSettings);
    expect(filterComplex).toContain("setpts=0.5*PTS");
    expect(filterComplex).toContain("atempo=2");
  });
});
