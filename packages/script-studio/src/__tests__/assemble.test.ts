import { describe, expect, it } from "vitest";
import { validateProject, type Track, type TextOverlay } from "@videoforge/project-schema";
import {
  assembleScript,
  EXPORTABLE_TEXT_STYLE_KEYS,
  type AssembleScriptInput,
} from "../assemble.js";
import { segmentScript } from "../segment.js";

const UUID_V4_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const SCRIPT = "Welcome to VideoForge. Paste a script and get a draft.\n\nIt is that simple.";

/** A canonical, fully-specified assembly input used across the suite. */
function fixtureInput(overrides: Partial<AssembleScriptInput> = {}): AssembleScriptInput {
  const segCount = segmentScript(SCRIPT).length;
  return {
    script: SCRIPT,
    voiceId: "piper-en-us-amy",
    seed: "fixture-script-001",
    title: "Script Draft",
    segments: Array.from({ length: segCount }, (_, i) => ({
      voiceAssetId: `00000000-0000-4000-8000-00000000${String(100 + i).padStart(4, "0")}`,
      durationMs: 2000 + i * 500,
    })),
    ...overrides,
  };
}

describe("assembleScript — schema validity (AC-3)", () => {
  it("emits a Project that passes validateProject()", () => {
    const { document } = assembleScript(fixtureInput());
    const result = validateProject(document);
    if (!result.ok) {
      throw new Error(`validateProject failed:\n${JSON.stringify(result.errors?.slice(0, 8), null, 2)}`);
    }
    expect(result.ok).toBe(true);
  });

  it("emits exactly the expected track shape (voiceover + overlay + 1 caption track)", () => {
    const { document } = assembleScript(fixtureInput());
    const types = document.tracks.map((t) => t.type);
    expect(types).toEqual(["voiceover", "overlay"]);
    expect(document.captionTracks).toHaveLength(1);
  });

  it("emits one VO clip, one text card, and one caption block per segment", () => {
    const input = fixtureInput();
    const { document, manifest } = assembleScript(input);
    const n = segmentScript(SCRIPT).length;
    const vo = document.tracks.find((t) => t.type === "voiceover")! as Extract<Track, { type: "voiceover" }>;
    const overlay = document.tracks.find((t) => t.type === "overlay")! as Extract<Track, { type: "overlay" }>;
    expect(vo.clips).toHaveLength(n);
    expect(overlay.clips).toHaveLength(n);
    expect(document.captionTracks[0]!.blocks).toHaveLength(n);
    expect(manifest.segments).toHaveLength(n);
  });

  it("all generated element ids are lowercase UUID v4", () => {
    const { document } = assembleScript(fixtureInput());
    const ids: string[] = [document.id, document.ownerId, document.workspaceId];
    for (const t of document.tracks) {
      ids.push(t.id);
      if (t.type === "voiceover") for (const c of t.clips) ids.push(c.id);
      if (t.type === "overlay") for (const ov of t.clips) ids.push(ov.id);
    }
    for (const ct of document.captionTracks) {
      ids.push(ct.id);
      for (const b of ct.blocks) ids.push(b.id);
    }
    for (const idVal of ids) expect(idVal, idVal).toMatch(UUID_V4_RE);
  });
});

describe("assembleScript — export-subset guard (AC-6, the WYCIWYG frontier)", () => {
  it("every text card uses ONLY export-rendered drawtext style keys", () => {
    const { document } = assembleScript(fixtureInput());
    const allowed = new Set<string>(EXPORTABLE_TEXT_STYLE_KEYS);
    const forbidden = ["gradient", "shadow", "letterSpacing", "backgroundColor"];
    const overlay = document.tracks.find((t) => t.type === "overlay")! as Extract<Track, { type: "overlay" }>;
    for (const ov of overlay.clips) {
      expect(ov.kind).toBe("text");
      const card = ov as TextOverlay;
      // No style key outside the export-rendered subset.
      for (const key of Object.keys(card.style)) {
        expect(allowed.has(key), `forbidden style key "${key}"`).toBe(true);
      }
      // Explicitly assert the high-risk dropped properties are absent.
      for (const f of forbidden) {
        expect(f in card.style, `card must not set "${f}"`).toBe(false);
      }
      // Overlay-level properties the exporter drops must be inert.
      expect(card.rotation).toBe(0);
      expect(card.animation).toEqual({});
    }
  });

  it("text-card outline (which the export DOES render) is present and well-formed", () => {
    const { document } = assembleScript(fixtureInput());
    const overlay = document.tracks.find((t) => t.type === "overlay")! as Extract<Track, { type: "overlay" }>;
    for (const ov of overlay.clips) {
      const card = ov as TextOverlay;
      expect(card.style.outline).toBeDefined();
      expect(card.style.outline!.width).toBeGreaterThan(0);
    }
  });
});

describe("assembleScript — determinism (golden assembly)", () => {
  it("same script + same input durations ⇒ byte-identical document + manifest", () => {
    const a = assembleScript(fixtureInput());
    const b = assembleScript(fixtureInput());
    expect(JSON.stringify(a.document)).toBe(JSON.stringify(b.document));
    expect(JSON.stringify(a.manifest)).toBe(JSON.stringify(b.manifest));
  });

  it("a different seed changes the ids but not the structure", () => {
    const a = assembleScript(fixtureInput());
    const b = assembleScript(fixtureInput({ seed: "fixture-script-002" }));
    expect(a.document.id).not.toBe(b.document.id);
    expect(a.document.tracks.map((t) => t.type)).toEqual(b.document.tracks.map((t) => t.type));
  });

  it("matches a committed golden snapshot of the emitted document + manifest", () => {
    const { document, manifest } = assembleScript(fixtureInput());
    expect({ document, manifest }).toMatchSnapshot();
  });
});

describe("assembleScript — timing (AC-7) & ms-integer / percent-geometry sanity", () => {
  it("derives timeline windows from caller durations, laid back-to-back", () => {
    const input = fixtureInput();
    const { document, manifest } = assembleScript(input);
    const vo = document.tracks.find((t) => t.type === "voiceover")! as Extract<Track, { type: "voiceover" }>;
    let expectedStart = 0;
    input.segments.forEach((si, i) => {
      const clip = vo.clips[i]!;
      expect(clip.startOnTimeline).toBe(expectedStart);
      expect(clip.endOnTimeline).toBe(expectedStart + si.durationMs);
      // Manifest mirrors the document timing exactly.
      expect(manifest.segments[i]!.startMs).toBe(clip.startOnTimeline);
      expect(manifest.segments[i]!.endMs).toBe(clip.endOnTimeline);
      expectedStart += si.durationMs;
    });
  });

  it("honours an inter-segment gap deterministically", () => {
    const { document } = assembleScript(fixtureInput({ gapMs: 250 }));
    const vo = document.tracks.find((t) => t.type === "voiceover")! as Extract<Track, { type: "voiceover" }>;
    // Second clip starts after the first clip's end + the gap.
    expect(vo.clips[1]!.startOnTimeline).toBe(vo.clips[0]!.endOnTimeline + 250);
  });

  it("all timeline/trim/caption times are non-negative integers (ms)", () => {
    const { document } = assembleScript(fixtureInput());
    const isMs = (n: number) => Number.isInteger(n) && n >= 0;
    for (const t of document.tracks) {
      if (t.type === "voiceover") {
        for (const c of t.clips) {
          expect(isMs(c.startOnTimeline)).toBe(true);
          expect(isMs(c.endOnTimeline)).toBe(true);
          expect(isMs(c.trimIn)).toBe(true);
          expect(isMs(c.trimOut)).toBe(true);
        }
      }
      if (t.type === "overlay") {
        for (const ov of t.clips) {
          expect(isMs(ov.startOnTimeline)).toBe(true);
          expect(isMs(ov.endOnTimeline)).toBe(true);
        }
      }
    }
    for (const b of document.captionTracks[0]!.blocks) {
      expect(isMs(b.startMs)).toBe(true);
      expect(isMs(b.endMs)).toBe(true);
    }
  });

  it("all text-card geometry is percent within 0–100", () => {
    const { document } = assembleScript(fixtureInput());
    const overlay = document.tracks.find((t) => t.type === "overlay")! as Extract<Track, { type: "overlay" }>;
    for (const ov of overlay.clips) {
      const card = ov as TextOverlay;
      for (const v of [card.canvasX, card.canvasY, card.width, card.height, card.opacity]) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(100);
      }
      expect(card.canvasX + card.width).toBeLessThanOrEqual(100);
      expect(card.canvasY + card.height).toBeLessThanOrEqual(100);
    }
  });
});

describe("assembleScript — Free-tier plan limits (AC-8)", () => {
  it("stays within Free-tier track caps", () => {
    const { document } = assembleScript(fixtureInput());
    const count = (type: Track["type"]) => document.tracks.filter((t) => t.type === type).length;
    expect(count("video")).toBeLessThanOrEqual(3);
    expect(count("audio")).toBeLessThanOrEqual(2);
    expect(count("voiceover")).toBeLessThanOrEqual(1);
    expect(count("overlay")).toBeLessThanOrEqual(2);
    expect(document.captionTracks.length).toBeLessThanOrEqual(1);
  });
});

describe("assembleScript — input validation", () => {
  it("throws when segment-input count mismatches parsed segment count", () => {
    expect(() => assembleScript(fixtureInput({ segments: [{ voiceAssetId: "x", durationMs: 1000 }] }))).toThrow(
      /expected .* segment/i,
    );
  });

  it("throws on a non-positive or non-integer duration", () => {
    const bad = fixtureInput();
    bad.segments[0] = { voiceAssetId: bad.segments[0]!.voiceAssetId, durationMs: 0 };
    expect(() => assembleScript(bad)).toThrow(/positive integer/i);

    const bad2 = fixtureInput();
    bad2.segments[1] = { voiceAssetId: bad2.segments[1]!.voiceAssetId, durationMs: 1000.5 };
    expect(() => assembleScript(bad2)).toThrow(/positive integer/i);
  });

  it("produces an empty-timeline-safe document for an empty script (0 segments)", () => {
    const { document, manifest } = assembleScript({
      script: "",
      segments: [],
      voiceId: "piper-en-us-amy",
      seed: "empty",
      title: "Empty",
    });
    expect(validateProject(document).ok).toBe(true);
    expect(manifest.segments).toEqual([]);
  });
});
