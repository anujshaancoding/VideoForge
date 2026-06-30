import { describe, expect, it } from "vitest";
import { validateProject, type Track, type TextOverlay, type Clip } from "@videoforge/project-schema";
import {
  assemblePlannedProject,
  arrangeAssets,
  EXPORTABLE_TEXT_STYLE_KEYS,
  type AssemblePlannedInput,
  type PlacedAsset,
} from "../assemblePlanned.js";
import { planFromHeuristic, type ScenePlan } from "../plan.js";

const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const SCRIPT =
  "Welcome to VideoForge. Paste a script and get a draft.\n\nIt is that simple.";

function asset(id: string, n: number): string {
  return `00000000-0000-4000-8000-00000000${String(n).padStart(4, "0")}`;
}

/** A 3-scene plan + probed VO durations, deterministic. */
function fixture(overrides: Partial<AssemblePlannedInput> = {}): AssemblePlannedInput {
  const plan: ScenePlan = planFromHeuristic(SCRIPT);
  const n = plan.scenes.length;
  return {
    plan,
    vo: Array.from({ length: n }, (_, i) => ({
      sceneIndex: i,
      voiceAssetId: asset("vo", 100 + i),
      durationMs: 2000 + i * 500,
    })),
    voiceId: "piper-en-us-amy",
    seed: "planned-fixture-001",
    title: "Planned Draft",
    ...overrides,
  };
}

const videoTrackOf = (doc: { tracks: Track[] }) =>
  doc.tracks.find((t) => t.type === "video")! as Extract<Track, { type: "video" }>;
const voTrackOf = (doc: { tracks: Track[] }) =>
  doc.tracks.find((t) => t.type === "voiceover")! as Extract<Track, { type: "voiceover" }>;
const overlayTracksOf = (doc: { tracks: Track[] }) =>
  doc.tracks.filter((t) => t.type === "overlay") as Extract<Track, { type: "overlay" }>[];
const audioTrackOf = (doc: { tracks: Track[] }) =>
  doc.tracks.find((t) => t.type === "audio") as Extract<Track, { type: "audio" }> | undefined;

describe("assemblePlannedProject — schema validity (AC-3)", () => {
  it("emits a Project that passes validateProject() (no assets, no music)", () => {
    const { document } = assemblePlannedProject(fixture());
    const r = validateProject(document);
    if (!r.ok) throw new Error(JSON.stringify(r.errors?.slice(0, 8), null, 2));
    expect(r.ok).toBe(true);
  });

  it("emits a valid Project with assets + music", () => {
    const assets: PlacedAsset[] = [
      { assetId: asset("a", 1), mediaType: "video", durationMs: 1200, uploadOrder: 0 },
      { assetId: asset("a", 2), mediaType: "photo", uploadOrder: 1 },
    ];
    const { document } = assemblePlannedProject(
      fixture({ assets, music: { assetId: asset("m", 9), durationMs: 4000 } }),
    );
    const r = validateProject(document);
    if (!r.ok) throw new Error(JSON.stringify(r.errors?.slice(0, 8), null, 2));
    expect(r.ok).toBe(true);
  });

  it("track layout: video + voiceover + 2 overlays (+ audio when music), 1 caption track", () => {
    const noMusic = assemblePlannedProject(fixture());
    expect(noMusic.document.tracks.map((t) => t.type)).toEqual([
      "video",
      "voiceover",
      "overlay",
      "overlay",
    ]);
    expect(noMusic.document.captionTracks).toHaveLength(1);

    const withMusic = assemblePlannedProject(fixture({ music: { assetId: asset("m", 9), durationMs: 4000 } }));
    expect(withMusic.document.tracks.map((t) => t.type)).toEqual([
      "video",
      "voiceover",
      "overlay",
      "overlay",
      "audio",
    ]);
  });

  it("stays within Free-tier track caps", () => {
    const { document } = assemblePlannedProject(fixture({ music: { assetId: asset("m", 9), durationMs: 4000 } }));
    const count = (type: Track["type"]) => document.tracks.filter((t) => t.type === type).length;
    expect(count("video")).toBeLessThanOrEqual(3);
    expect(count("audio")).toBeLessThanOrEqual(2);
    expect(count("voiceover")).toBeLessThanOrEqual(1);
    expect(count("overlay")).toBeLessThanOrEqual(2);
    expect(document.captionTracks.length).toBeLessThanOrEqual(1);
  });

  it("all generated ids are lowercase UUID v4", () => {
    const { document } = assemblePlannedProject(
      fixture({
        assets: [{ assetId: asset("a", 1), mediaType: "video", durationMs: 800, uploadOrder: 0 }],
        music: { assetId: asset("m", 9), durationMs: 1000 },
      }),
    );
    const ids: string[] = [document.id];
    for (const t of document.tracks) {
      ids.push(t.id);
      if ("clips" in t) for (const c of t.clips) ids.push(c.id);
    }
    for (const ct of document.captionTracks) {
      ids.push(ct.id);
      for (const b of ct.blocks) ids.push(b.id);
    }
    for (const v of ids) expect(v, v).toMatch(UUID_V4_RE);
  });
});

describe("assemblePlannedProject — VO timing is the source of truth (AC-7)", () => {
  it("VO clips are back-to-back from t=0 using probed durations", () => {
    const input = fixture();
    const { document, manifest } = assemblePlannedProject(input);
    const vo = voTrackOf(document);
    let cursor = 0;
    input.vo.forEach((v, i) => {
      const clip = vo.clips[i]!;
      expect(clip.startOnTimeline).toBe(cursor);
      expect(clip.endOnTimeline).toBe(cursor + v.durationMs);
      expect(manifest.scenes[i]!.startMs).toBe(clip.startOnTimeline);
      expect(manifest.scenes[i]!.endMs).toBe(clip.endOnTimeline);
      cursor += v.durationMs;
    });
  });

  it("rejects mismatched vo count and non-positive durations", () => {
    expect(() => assemblePlannedProject(fixture({ vo: [] }))).toThrow(/SceneVo input/i);
    const bad = fixture();
    bad.vo[0] = { ...bad.vo[0]!, durationMs: 0 };
    expect(() => assemblePlannedProject(bad)).toThrow(/positive integer/i);
  });
});

describe("assemblePlannedProject — export-subset guard (AC-6, WYCIWYG frontier)", () => {
  it("every authored text overlay uses ONLY export-rendered style keys", () => {
    const { document } = assemblePlannedProject(fixture());
    const allowed = new Set<string>(EXPORTABLE_TEXT_STYLE_KEYS);
    const forbidden = ["gradient", "shadow", "letterSpacing", "backgroundColor"];
    for (const track of overlayTracksOf(document)) {
      for (const ov of track.clips) {
        expect(ov.kind).toBe("text");
        const card = ov as TextOverlay;
        for (const key of Object.keys(card.style)) {
          expect(allowed.has(key), `forbidden style key "${key}"`).toBe(true);
        }
        for (const f of forbidden) expect(f in card.style, `must not set "${f}"`).toBe(false);
        expect(card.rotation).toBe(0);
        // `animation` must carry ONLY keys the exporter actually renders. Today that is:
        // {} (static) OR a `typewriter` reveal (the big-caption track) — both are driven
        // by the SHARED captionTypewriter helper, so preview == export. Any OTHER animation
        // key would be an export-dropped lie (in/out/loop presets are not yet rendered).
        const animKeys = Object.keys(card.animation);
        for (const k of animKeys) {
          expect(k === "typewriter", `forbidden animation key "${k}"`).toBe(true);
        }
        if (card.animation.typewriter) {
          // Shape guard: a non-empty words[] of timeline-absolute {text,startMs,endMs}.
          expect(Array.isArray(card.animation.typewriter.words)).toBe(true);
          expect(card.animation.typewriter.words.length).toBeGreaterThan(0);
          for (const wd of card.animation.typewriter.words) {
            expect(typeof wd.text).toBe("string");
            expect(Number.isInteger(wd.startMs)).toBe(true);
            expect(Number.isInteger(wd.endMs)).toBe(true);
            expect(wd.endMs).toBeGreaterThanOrEqual(wd.startMs);
            // Reveal windows stay inside the overlay's [startOnTimeline,endOnTimeline].
            expect(wd.startMs).toBeGreaterThanOrEqual(card.startOnTimeline);
            expect(wd.endMs).toBeLessThanOrEqual(card.endOnTimeline);
          }
        }
      }
    }
  });

  it("all overlay geometry is percent within 0-100 and inside the canvas", () => {
    const { document } = assemblePlannedProject(fixture());
    for (const track of overlayTracksOf(document)) {
      for (const ov of track.clips as TextOverlay[]) {
        for (const v of [ov.canvasX, ov.canvasY, ov.width, ov.height, ov.opacity]) {
          expect(v).toBeGreaterThanOrEqual(0);
          expect(v).toBeLessThanOrEqual(100);
        }
        expect(ov.canvasX + ov.width).toBeLessThanOrEqual(100);
        expect(ov.canvasY + ov.height).toBeLessThanOrEqual(100);
      }
    }
  });
});

describe("assemblePlannedProject — bottom narration subtitle sequence", () => {
  it("emits one bottom overlay per ~5-word phrase of the narration, tiling each scene window", () => {
    const input = fixture();
    const { document, manifest } = assemblePlannedProject(input);
    const bigTrack = overlayTracksOf(document)[1]!; // [small, big]
    // Scene 1 voiceoverText ("Paste a script and get a draft.") = 7 words → ceil(7/5) = 2.
    const scene1 = manifest.scenes[1]!;
    expect(scene1.bigCaptionOverlayIds).toHaveLength(2);
    const sceneOverlays = (bigTrack.clips as TextOverlay[]).filter((o) =>
      scene1.bigCaptionOverlayIds.includes(o.id),
    );
    // Positioned in the bottom band (synced subtitle).
    expect(sceneOverlays[0]!.canvasY).toBe(72);
    // Contiguous and within the window.
    expect(sceneOverlays[0]!.startOnTimeline).toBe(scene1.startMs);
    expect(sceneOverlays[sceneOverlays.length - 1]!.endOnTimeline).toBe(scene1.endMs);
    for (let i = 1; i < sceneOverlays.length; i++) {
      expect(sceneOverlays[i]!.startOnTimeline).toBe(sceneOverlays[i - 1]!.endOnTimeline);
    }
  });

  it("uses per-word timings when present", () => {
    const input = fixture();
    // Give scene 0 ("Welcome to VideoForge.") explicit word timings.
    input.vo[0] = {
      ...input.vo[0]!,
      words: [
        { text: "Welcome", startMs: 0, endMs: 500 },
        { text: "to", startMs: 500, endMs: 700 },
        { text: "VideoForge.", startMs: 700, endMs: 2000 },
      ],
    };
    const { document, manifest } = assemblePlannedProject(input);
    const bigTrack = overlayTracksOf(document)[1]!;
    const scene0 = manifest.scenes[0]!;
    const o = (bigTrack.clips as TextOverlay[]).filter((x) => scene0.bigCaptionOverlayIds.includes(x.id));
    // 3 words, 1 chunk; spans first.start..last.end (offset 0).
    expect(o).toHaveLength(1);
    expect(o[0]!.startOnTimeline).toBe(0);
    expect(o[0]!.endOnTimeline).toBe(scene0.endMs);
  });
});

describe("assemblePlannedProject — caption track (sidecar)", () => {
  it("emits one CaptionBlock per scene with words[] when provided", () => {
    const input = fixture();
    input.vo[0] = {
      ...input.vo[0]!,
      words: [{ text: "Welcome", startMs: 0, endMs: 500 }],
    };
    const { document } = assemblePlannedProject(input);
    const blocks = document.captionTracks[0]!.blocks;
    expect(blocks).toHaveLength(input.vo.length);
    expect(blocks[0]!.words).toBeDefined();
    expect(blocks[0]!.words![0]).toEqual({ text: "Welcome", startMs: 0, endMs: 500 });
    expect(blocks[1]!.words).toBeUndefined();
  });
});

describe("assemblePlannedProject — b-roll placement fit", () => {
  function brollFor(input: AssemblePlannedInput, sceneIndex: number): Clip[] {
    const { document, manifest } = assemblePlannedProject(input);
    const v = videoTrackOf(document);
    const ids = manifest.scenes[sceneIndex]!.videoClipIds;
    return v.clips.filter((c) => ids.includes(c.id));
  }

  it("empty assets → empty video track (text-card-only first build)", () => {
    const { document } = assemblePlannedProject(fixture());
    expect(videoTrackOf(document).clips).toHaveLength(0);
  });

  it("video longer than window → single clip trimmed to the window", () => {
    const input = fixture(); // scene 0 window = 2000ms
    input.assets = [{ assetId: asset("a", 1), mediaType: "video", durationMs: 5000, uploadOrder: 0 }];
    const clips = brollFor(input, 0);
    expect(clips).toHaveLength(1);
    expect(clips[0]!.trimOut).toBe(2000);
    expect(clips[0]!.endOnTimeline - clips[0]!.startOnTimeline).toBe(2000);
  });

  it("video shorter than window → looped back-to-back clips tiling the window (no speed change)", () => {
    const input = fixture(); // scene 1 window = 2500ms
    input.assets = [{ assetId: asset("a", 1), mediaType: "video", durationMs: 1000, uploadOrder: 0 }];
    const clips = brollFor(input, 1).sort((a, b) => a.startOnTimeline - b.startOnTimeline);
    // 2500 / 1000 → 3 clips (1000 + 1000 + 500).
    expect(clips).toHaveLength(3);
    expect(clips.every((c) => c.speed === 1)).toBe(true);
    expect(clips[0]!.trimOut).toBe(1000);
    expect(clips[2]!.trimOut).toBe(500);
    // Contiguous, tiles the full window.
    const win = input.vo[1]!.durationMs;
    const start = clips[0]!.startOnTimeline;
    expect(clips[clips.length - 1]!.endOnTimeline - start).toBe(win);
    for (let i = 1; i < clips.length; i++) {
      expect(clips[i]!.startOnTimeline).toBe(clips[i - 1]!.endOnTimeline);
    }
  });

  it("photo asset → single clip spanning the whole window", () => {
    const input = fixture();
    input.assets = [{ assetId: asset("a", 2), mediaType: "photo", uploadOrder: 0 }];
    const clips = brollFor(input, 0);
    expect(clips).toHaveLength(1);
    expect(clips[0]!.startOnTimeline).toBe(0);
    expect(clips[0]!.endOnTimeline).toBe(input.vo[0]!.durationMs);
  });

  it("a photo asset carrying revealWipe attaches the whiteboard reveal to its clip", () => {
    const input = fixture();
    input.assets = [
      {
        assetId: asset("a", 2),
        mediaType: "photo",
        uploadOrder: 0,
        revealWipe: { direction: "top", durationMs: 1700, easing: "linear" },
      },
    ];
    const clips = brollFor(input, 0);
    expect(clips[0]!.revealWipe).toEqual({ direction: "top", durationMs: 1700, easing: "linear" });
  });

  it("a photo asset WITHOUT revealWipe leaves the clip's reveal unset (byte-compatible)", () => {
    const input = fixture();
    input.assets = [{ assetId: asset("a", 2), mediaType: "photo", uploadOrder: 0 }];
    const clips = brollFor(input, 0);
    expect(clips[0]!.revealWipe).toBeUndefined();
  });

  it("round-robin assigns asset i % N to scene i; a no-asset gap is possible only when N===0", () => {
    const input = fixture(); // 3 scenes
    input.assets = [
      { assetId: asset("a", 1), mediaType: "photo", uploadOrder: 0 },
      { assetId: asset("a", 2), mediaType: "photo", uploadOrder: 1 },
    ];
    const { document, manifest } = assemblePlannedProject(input);
    const v = videoTrackOf(document);
    const clipById = new Map(v.clips.map((c) => [c.id, c]));
    // scene 0 → asset 0, scene 1 → asset 1, scene 2 → asset 0 (round-robin).
    expect(clipById.get(manifest.scenes[0]!.videoClipIds[0]!)!.sourceAssetId).toBe(asset("a", 1));
    expect(clipById.get(manifest.scenes[1]!.videoClipIds[0]!)!.sourceAssetId).toBe(asset("a", 2));
    expect(clipById.get(manifest.scenes[2]!.videoClipIds[0]!)!.sourceAssetId).toBe(asset("a", 1));
  });
});

describe("assemblePlannedProject — music duck envelope (parity-safe)", () => {
  it("ducks low under VO and is monotonic non-decreasing in time, value in [0,200]", () => {
    const input = fixture({ music: { assetId: asset("m", 9), durationMs: 10000 } });
    const { document } = assemblePlannedProject(input);
    const audio = audioTrackOf(document)!;
    const env = audio.volumeEnvelope;
    expect(env.length).toBeGreaterThan(0);
    // Sorted, integer ms, in-range.
    for (let i = 1; i < env.length; i++) {
      expect(env[i]!.timeMs).toBeGreaterThanOrEqual(env[i - 1]!.timeMs);
    }
    for (const kf of env) {
      expect(Number.isInteger(kf.timeMs)).toBe(true);
      expect(kf.value).toBeGreaterThanOrEqual(0);
      expect(kf.value).toBeLessThanOrEqual(200);
    }
    // With a music bed the timeline opens with a music-only intro swell at FULL bed
    // level (50), then ducks down to the low VO level (15) once VO starts.
    const atStart = env.find((kf) => kf.timeMs === 0);
    expect(atStart!.value).toBe(50);
    // No two keyframes share a timestamp.
    const times = env.map((k) => k.timeMs);
    expect(new Set(times).size).toBe(times.length);
  });

  it("music bed is looped/trimmed to project length (no atempo)", () => {
    const input = fixture({ music: { assetId: asset("m", 9), durationMs: 1000 } });
    const { document, manifest } = assemblePlannedProject(input);
    const audio = audioTrackOf(document)!;
    // Bed spans the FULL padded project: lead-in swell + VO span + lead-out swell.
    // (Default lead-in/out = 1200ms each when music is present.)
    const voEnd = manifest.scenes[manifest.scenes.length - 1]!.endMs;
    const projectEnd = voEnd + 1200; // + outro swell
    const sorted = [...audio.clips].sort((a, b) => a.startOnTimeline - b.startOnTimeline);
    expect(sorted[0]!.startOnTimeline).toBe(0);
    expect(sorted[sorted.length - 1]!.endOnTimeline).toBe(projectEnd);
    expect(audio.clips.every((c) => c.speed === 1)).toBe(true);
    expect(manifest.musicClipId).toBe(sorted[0]!.id);
  });

  it("flat volume stays at unity (envelope is the gain source)", () => {
    const input = fixture({ music: { assetId: asset("m", 9), durationMs: 5000 } });
    const { document } = assemblePlannedProject(input);
    expect(audioTrackOf(document)!.volume).toBe(100);
  });
});

describe("assemblePlannedProject — music swell (dynamic duck, parity-safe)", () => {
  const LEAD_IN = 1200;
  const LEAD_OUT = 1200;

  it("shifts VO to start at musicLeadInMs when music is present (timeline still starts at 0)", () => {
    const input = fixture({ music: { assetId: asset("m", 9), durationMs: 10000 } });
    const { document, manifest } = assemblePlannedProject(input);
    const vo = voTrackOf(document);
    // First VO clip starts at the lead-in offset, not 0.
    expect(vo.clips[0]!.startOnTimeline).toBe(LEAD_IN);
    expect(manifest.scenes[0]!.startMs).toBe(LEAD_IN);
    // Windows stay back-to-back from the offset using probed durations.
    let cursor = LEAD_IN;
    input.vo.forEach((v, i) => {
      expect(manifest.scenes[i]!.startMs).toBe(cursor);
      expect(manifest.scenes[i]!.endMs).toBe(cursor + v.durationMs);
      cursor += v.durationMs;
    });
    // The music bed extends through the outro swell past the last VO end.
    const audio = audioTrackOf(document)!;
    const last = [...audio.clips].sort((a, b) => a.endOnTimeline - b.endOnTimeline).at(-1)!;
    expect(last.endOnTimeline).toBe(cursor + LEAD_OUT);
  });

  it("honours custom musicLeadInMs / musicLeadOutMs (integer-ms, clamped ≥0)", () => {
    const input = fixture({
      music: { assetId: asset("m", 9), durationMs: 10000 },
      musicLeadInMs: 800,
      musicLeadOutMs: 400,
    });
    const { document, manifest } = assemblePlannedProject(input);
    expect(manifest.scenes[0]!.startMs).toBe(800);
    const voSpan = input.vo.reduce((a, v) => a + v.durationMs, 0);
    const audio = audioTrackOf(document)!;
    const last = [...audio.clips].sort((a, b) => a.endOnTimeline - b.endOnTimeline).at(-1)!;
    expect(last.endOnTimeline).toBe(800 + voSpan + 400);
  });

  it("envelope swells to full bed in the intro/outro and holds the low duck across VO", () => {
    const input = fixture({ music: { assetId: asset("m", 9), durationMs: 10000 } });
    const { document, manifest } = assemblePlannedProject(input);
    const env = audioTrackOf(document)!.volumeEnvelope;
    const voStart = manifest.scenes[0]!.startMs; // = LEAD_IN
    const voEnd = manifest.scenes[manifest.scenes.length - 1]!.endMs;
    const projectEnd = voEnd + LEAD_OUT;

    // Helper: gain value of the last keyframe at-or-before t (step/interp lower bound).
    const valueAt = (t: number) => {
      let v = env[0]!.value;
      for (const kf of env) {
        if (kf.timeMs <= t) v = kf.value;
        else break;
      }
      return v;
    };

    // Intro music-only region: full bed level (50) at t=0 and held until the ramp.
    expect(env[0]).toEqual({ timeMs: 0, value: 50 });
    expect(valueAt(Math.max(0, voStart - 200))).toBe(50);
    // Duck reaches and holds the low level (15) across the continuous VO span.
    expect(valueAt(voStart)).toBe(15);
    expect(valueAt(Math.round((voStart + voEnd) / 2))).toBe(15);
    expect(valueAt(voEnd - 1)).toBe(15);
    // Outro music-only region swells back to full bed level (50) through project end.
    expect(valueAt(projectEnd)).toBe(50);
    const lastKf = env[env.length - 1]!;
    expect(lastKf.timeMs).toBe(projectEnd);
    expect(lastKf.value).toBe(50);

    // Distinct swell keyframes exist (intro full, duck low, outro full → ≥3 values used).
    expect(env.some((k) => k.value === 50 && k.timeMs === 0)).toBe(true);
    expect(env.some((k) => k.value === 15)).toBe(true);
    expect(env.filter((k) => k.value === 50).length).toBeGreaterThanOrEqual(2);
  });

  it("no-music path is unchanged: VO starts at 0, no lead-in shift, no audio track", () => {
    const { document, manifest } = assemblePlannedProject(fixture()); // music omitted
    expect(voTrackOf(document).clips[0]!.startOnTimeline).toBe(0);
    expect(manifest.scenes[0]!.startMs).toBe(0);
    expect(audioTrackOf(document)).toBeUndefined();

    // Explicit null music + lead values provided → still no shift (lead applies only with music).
    const withNull = assemblePlannedProject(
      fixture({ music: null, musicLeadInMs: 5000, musicLeadOutMs: 5000 }),
    );
    expect(withNull.manifest.scenes[0]!.startMs).toBe(0);
  });
});

describe("assemblePlannedProject — determinism (golden)", () => {
  it("same input ⇒ byte-identical document + manifest", () => {
    const make = () =>
      assemblePlannedProject(
        fixture({
          assets: [
            { assetId: asset("a", 1), mediaType: "video", durationMs: 900, uploadOrder: 0 },
            { assetId: asset("a", 2), mediaType: "photo", uploadOrder: 1 },
          ],
          music: { assetId: asset("m", 9), durationMs: 3000 },
        }),
      );
    const a = make();
    const b = make();
    expect(JSON.stringify(a.document)).toBe(JSON.stringify(b.document));
    expect(JSON.stringify(a.manifest)).toBe(JSON.stringify(b.manifest));
  });

  it("matches a committed golden snapshot", () => {
    const { document, manifest } = assemblePlannedProject(
      fixture({
        assets: [{ assetId: asset("a", 1), mediaType: "video", durationMs: 900, uploadOrder: 0 }],
        music: { assetId: asset("m", 9), durationMs: 3000 },
      }),
    );
    expect({ document, manifest }).toMatchSnapshot();
  });
});

describe("arrangeAssets — re-place onto existing scene windows", () => {
  it("fills the b-roll track from a built (empty-broll) project, keeping windows", () => {
    const built = assemblePlannedProject(fixture()); // no assets → empty video track
    expect(videoTrackOf(built.document).clips).toHaveLength(0);

    const assets: PlacedAsset[] = [
      { assetId: asset("a", 1), mediaType: "photo", uploadOrder: 0 },
      { assetId: asset("a", 2), mediaType: "video", durationMs: 600, uploadOrder: 1 },
    ];
    const arranged = arrangeAssets(built.document, built.manifest, assets);
    const r = validateProject(arranged.document);
    if (!r.ok) throw new Error(JSON.stringify(r.errors?.slice(0, 8), null, 2));
    expect(r.ok).toBe(true);

    const v = videoTrackOf(arranged.document);
    expect(v.clips.length).toBeGreaterThan(0);
    // Windows unchanged.
    arranged.manifest.scenes.forEach((m, i) => {
      expect(m.startMs).toBe(built.manifest.scenes[i]!.startMs);
      expect(m.endMs).toBe(built.manifest.scenes[i]!.endMs);
      expect(m.videoClipIds.length).toBeGreaterThan(0);
    });
    // Other tracks untouched (same VO clip ids).
    expect(voTrackOf(arranged.document).clips.map((c) => c.id)).toEqual(
      voTrackOf(built.document).clips.map((c) => c.id),
    );
  });

  it("does not mutate the input document/manifest and is deterministic + idempotent", () => {
    const built = assemblePlannedProject(fixture());
    const before = JSON.stringify(built.document);
    const assets: PlacedAsset[] = [{ assetId: asset("a", 1), mediaType: "photo", uploadOrder: 0 }];
    const a = arrangeAssets(built.document, built.manifest, assets);
    const b = arrangeAssets(built.document, built.manifest, assets);
    expect(JSON.stringify(built.document)).toBe(before); // unmutated
    expect(JSON.stringify(a.document)).toBe(JSON.stringify(b.document)); // deterministic
    // Re-arranging the already-arranged doc with the same assets is stable.
    const c = arrangeAssets(a.document, a.manifest, assets);
    expect(JSON.stringify(c.document)).toBe(JSON.stringify(a.document));
  });

  it("replacing assets swaps the b-roll without touching captions/VO", () => {
    const built = assemblePlannedProject(fixture());
    const a1 = arrangeAssets(built.document, built.manifest, [
      { assetId: asset("a", 1), mediaType: "photo", uploadOrder: 0 },
    ]);
    const a2 = arrangeAssets(a1.document, a1.manifest, [
      { assetId: asset("a", 2), mediaType: "photo", uploadOrder: 0 },
    ]);
    const v = videoTrackOf(a2.document);
    expect(v.clips.every((c) => c.sourceAssetId === asset("a", 2))).toBe(true);
    expect(a2.document.captionTracks).toEqual(built.document.captionTracks);
  });
});
