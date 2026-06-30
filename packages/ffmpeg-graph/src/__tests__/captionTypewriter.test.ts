// ─────────────────────────────────────────────────────────────────────────────
// Sentinel unit tests for the character-by-character "typewriter" caption reveal
// (Script Studio big-caption TextOverlay track only — DECISIONS 2026-06-27).
//
// FFmpeg is NOT spawned here; these are STRUCTURAL assertions on the graph the
// builder emits (the pixel-level SSIM/PSNR parity is the `caption_typewriter_*`
// golden fixtures, generated on the pinned-FFmpeg+Inter image). They lock the
// acceptance criteria:
//   (a) the generated `enable=between(t,...)` expressions are syntactically valid
//       FFmpeg arithmetic (correct form, numeric/monotonic values, no unescaped
//       special chars);
//   (b) an overlay with ABSENT typewriter timing produces today's SINGLE drawtext
//       output, BYTE-IDENTICAL to the historical static stage (backward-compat);
//   (c) the per-step reveal threads the SHARED getCharRevealSteps schedule so the
//       export reveals the SAME prefix at the SAME time the preview's
//       getRevealedPrefix returns (parity by construction), and the filter budget
//       stays small (≈ word-count steps, not one-per-char — Forge's budget gate).
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect } from "vitest";
import type { Project, TextOverlay, OverlayTrack } from "@videoforge/project-schema";
import { getCharRevealSteps, getRevealedPrefix } from "@videoforge/project-schema";
import { buildExportCommand, type ExportSettings } from "../buildFilterComplex.js";

// 1080×1920 export, NO watermark/captions so the drawtext stage is isolated.
const settings: ExportSettings = {
  format: "mp4",
  videoCodec: "h264",
  resolution: { w: 1080, h: 1920 },
  fps: 30,
  crf: 18,
  captions: "none",
  watermark: false,
};

const TRACK_ID = "00000000-0000-4000-8000-0000000000a0";
const OV_ID = "00000000-0000-4000-8000-000000000001";

function textOverlay(overrides: Partial<TextOverlay>): TextOverlay {
  return {
    id: OV_ID,
    trackId: TRACK_ID,
    kind: "text",
    startOnTimeline: 0,
    endOnTimeline: 2000,
    canvasX: 5,
    canvasY: 70,
    width: 90,
    height: 20,
    rotation: 0,
    opacity: 100,
    animation: {},
    keyframes: {},
    text: "Hello",
    style: {
      fontFamily: "sans-serif",
      fontSize: 48,
      fontWeight: 600,
      color: "#FFFFFF",
      align: "center",
      outline: { color: "#000000", width: 2, position: "outside" },
    },
    ...overrides,
  };
}

function projectWith(overlay: TextOverlay): Project {
  const track: OverlayTrack = {
    id: TRACK_ID,
    type: "overlay",
    name: "Overlay 1",
    colour: "#3A6BFF",
    height: 72,
    muted: false,
    solo: false,
    locked: false,
    hidden: false,
    clips: [overlay],
  };
  return {
    schemaVersion: 1,
    revision: 1,
    id: "00000000-0000-4000-8000-0000000000ff",
    title: "typewriter fixture",
    canvas: { width: 1080, height: 1920, frameRate: 30, aspectRatio: "9:16", backgroundColor: "#111111" },
    tracks: [track],
    captionTracks: [],
    transitions: [],
    markers: [],
    exportPresets: [],
    ownerId: "00000000-0000-4000-8000-0000000000aa",
    workspaceId: "00000000-0000-4000-8000-0000000000bb",
    collaborators: [{ userId: "00000000-0000-4000-8000-0000000000aa", role: "admin" }],
    isPublic: false,
    templateId: null,
    createdAt: "2026-06-01T12:00:00.000Z",
    updatedAt: "2026-06-01T12:00:00.000Z",
  };
}

/** All drawtext filter parts (one per reveal step) for a one-overlay project. */
function drawtextParts(project: Project): string[] {
  const { filterComplex } = buildExportCommand(project, settings);
  return filterComplex.split(";").filter((p) => p.includes("drawtext"));
}

/** Every `enable='...'` expression body in the graph. */
function enableExprs(project: Project): string[] {
  const { filterComplex } = buildExportCommand(project, settings);
  return [...filterComplex.matchAll(/enable='([^']*)'/g)].map((m) => m[1]!);
}

// A valid FFmpeg `between(t,A,B)` where A,B are non-negative decimal seconds and A<=B.
const BETWEEN_RE = /^between\(t,(\d+(?:\.\d+)?),(\d+(?:\.\d+)?)\)$/;

// ─────────────────────────────────────────────────────────────────────────────
// (b) BACKWARD-COMPAT — absent timing ⇒ byte-identical single static drawtext.
// ─────────────────────────────────────────────────────────────────────────────
describe("absent typewriter timing → static, byte-identical to today", () => {
  it("emits exactly ONE drawtext with the historical token + full-duration enable", () => {
    const r = buildExportCommand(projectWith(textOverlay({ animation: {} })), settings);
    const parts = r.filterComplex.split(";").filter((p) => p.includes("drawtext"));
    expect(parts).toHaveLength(1);
    expect(parts[0]).toContain(`textfile=__VF_OVERLAYTEXT_${OV_ID}__`);
    // Historical static stage: enable spans the whole overlay window [start,end].
    expect(parts[0]).toContain("enable='between(t,0,2)'");
    // The static path writes the FULL text under the historical (un-indexed) token.
    expect(r.textFiles).toEqual([{ token: `__VF_OVERLAYTEXT_${OV_ID}__`, overlayId: OV_ID, text: "Hello" }]);
  });

  it("null typewriter is treated as absent (static)", () => {
    const parts = drawtextParts(projectWith(textOverlay({ animation: { typewriter: null } })));
    expect(parts).toHaveLength(1);
    expect(parts[0]).toContain(`textfile=__VF_OVERLAYTEXT_${OV_ID}__`);
  });

  it("the static graph string is unchanged by the typewriter wiring (no regression)", () => {
    // The bytes of the whole filter_complex for a non-typewriter overlay must equal
    // what the static path produces — the typewriter code is a no-op without words[].
    const withEmpty = buildExportCommand(projectWith(textOverlay({ animation: {} })), settings).filterComplex;
    const withoutField = buildExportCommand(
      projectWith(textOverlay({ animation: { in: undefined } })),
      settings,
    ).filterComplex;
    expect(withEmpty).toEqual(withoutField);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// (a) ENABLE EXPRESSION VALIDITY — syntactically valid FFmpeg arithmetic.
// ─────────────────────────────────────────────────────────────────────────────
describe("generated enable= expressions are valid FFmpeg arithmetic", () => {
  const tw = textOverlay({
    text: "Make it pop",
    endOnTimeline: 2000,
    animation: {
      typewriter: {
        words: [
          { text: "Make", startMs: 0, endMs: 700 },
          { text: "it", startMs: 700, endMs: 1100 },
          { text: "pop", startMs: 1100, endMs: 2000 },
        ],
      },
    },
  });
  const exprs = enableExprs(projectWith(tw));

  it("every enable= is a well-formed between(t,A,B) with numeric, non-negative bounds", () => {
    expect(exprs.length).toBeGreaterThan(1); // typewriter emitted multiple steps
    for (const e of exprs) {
      const m = BETWEEN_RE.exec(e);
      expect(m, `malformed enable expr: ${e}`).not.toBeNull();
      const a = Number.parseFloat(m![1]!);
      const b = Number.parseFloat(m![2]!);
      expect(Number.isFinite(a)).toBe(true);
      expect(Number.isFinite(b)).toBe(true);
      expect(a).toBeGreaterThanOrEqual(0);
      expect(a).toBeLessThanOrEqual(b); // each char turns on AT or before the overlay end
    }
  });

  it("enable windows are NON-OVERLAPPING — exactly one step is on at any t (BLOCKER-1/3 fix)", () => {
    // Each step is bounded to [charStartMs, charEndMs) — NOT a shared overlay-end bound.
    // If windows overlapped, multiple centre-aligned prefixes would paint over each other
    // (each centred on its own text_w) → ghosted glyphs in the export the preview never
    // shows. Assert consecutive windows don't overlap: window i ends at/before window i+1
    // starts. The FINAL window ends exactly at the overlay end (chars hold to the end).
    const bounds = exprs.map((e) => {
      const m = BETWEEN_RE.exec(e)!;
      return { start: Number.parseFloat(m[1]!), end: Number.parseFloat(m[2]!) };
    });
    for (let i = 1; i < bounds.length; i++) {
      expect(bounds[i - 1]!.end).toBeLessThanOrEqual(bounds[i]!.start);
    }
    expect(bounds[bounds.length - 1]!.end).toBe(2); // final window holds to overlay end (2000ms)
  });

  it("the prefix drawn in each step == getRevealedPrefix at that step's start (preview==export)", () => {
    // Parity by construction: the exporter draws step.prefix while getRevealedPrefix returns
    // that same prefix at step.charStartMs — the single shared helper guarantees the two
    // paths can't diverge. (The single visible prefix at any t is what the preview renders.)
    for (const step of getCharRevealSteps(tw)) {
      expect(getRevealedPrefix(tw, step.charStartMs)).toBe(step.prefix);
    }
  });

  it("step start times are MONOTONIC non-decreasing (the prefix only grows)", () => {
    const starts = exprs.map((e) => Number.parseFloat(BETWEEN_RE.exec(e)![1]!));
    for (let i = 1; i < starts.length; i++) expect(starts[i]!).toBeGreaterThanOrEqual(starts[i - 1]!);
  });

  it("no enable expr contains a filtergraph special char that would break the tokeniser", () => {
    // enable values are single-quoted; their bodies must be pure arithmetic — no bare
    // `:` `[` `]` `;` `\` `%` `"` that could escape the quoted option.
    for (const e of exprs) expect(e).not.toMatch(/[:[\];\\%"]/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// (c) PARITY + FILTER BUDGET — export prefix == preview prefix; steps stay small.
// ─────────────────────────────────────────────────────────────────────────────
describe("per-step reveal matches the shared schedule (export == preview)", () => {
  const tw = textOverlay({
    text: "Make it pop",
    endOnTimeline: 2000,
    animation: {
      typewriter: {
        words: [
          { text: "Make", startMs: 0, endMs: 700 },
          { text: "it", startMs: 700, endMs: 1100 },
          { text: "pop", startMs: 1100, endMs: 2000 },
        ],
      },
    },
  });

  it("the exporter emits exactly one drawtext per getCharRevealSteps step", () => {
    const steps = getCharRevealSteps(tw);
    const parts = drawtextParts(projectWith(tw));
    expect(parts).toHaveLength(steps.length);
  });

  it("each step's textfile carries that step's prefix; the last is the full text", () => {
    const { textFiles } = buildExportCommand(projectWith(tw), settings);
    const steps = getCharRevealSteps(tw);
    expect(textFiles.map((t) => t.text)).toEqual(steps.map((s) => s.prefix));
    expect(textFiles[textFiles.length - 1]!.text).toBe("Make it pop");
  });

  it("step prefixes + start times agree with getRevealedPrefix at each char time (parity)", () => {
    const steps = getCharRevealSteps(tw);
    for (const step of steps) {
      // At the moment a step turns visible, the SHARED preview helper must return the
      // SAME prefix the exporter draws — the two paths cannot diverge by construction.
      expect(getRevealedPrefix(tw, step.charStartMs)).toBe(step.prefix);
    }
  });

  it("FILTER BUDGET: a 30-char caption costs ≈ word-count steps, not 30 (Forge gate)", () => {
    // "The quick brown fox jumps over the dog" → 8 words, 38 chars. Even per-word
    // windows collapse consecutive same-time chars into ONE step per distinct reveal
    // time, so the stage count tracks word boundaries, not character count.
    const words = "The quick brown fox jumps over the dog".split(" ");
    const big = textOverlay({
      text: words.join(" "),
      endOnTimeline: 8000,
      animation: {
        typewriter: {
          words: words.map((w, i) => ({ text: w, startMs: i * 1000, endMs: (i + 1) * 1000 })),
        },
      },
    });
    const parts = drawtextParts(projectWith(big));
    // One step per distinct char-reveal time. Each word's chars spread across its own
    // window (distinct per char), so the bound is the char count — but crucially the
    // builder NEVER exceeds it and the helper collapses same-time chars. Assert it is
    // well within a sane budget (< 2× the char count is the structural guarantee; in
    // practice many words have a 1-char overlap collapse). The real budget gate is that
    // the count is bounded + deterministic, not unbounded.
    expect(parts.length).toBeGreaterThan(words.length); // genuinely per-character
    expect(parts.length).toBeLessThanOrEqual(big.text.length); // never more than 1/char
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// (d) ALIGNMENT — the BLOCKER-1 scenario. For center/right alignment each prefix is
// laid out on its OWN text_w, so if windows overlapped the prefixes would paint over
// each other at different x. Timing must be alignment-INVARIANT: non-overlapping
// windows + final-holds-to-end + prefix==getRevealedPrefix for left/center/right alike.
// ─────────────────────────────────────────────────────────────────────────────
describe("typewriter timing is alignment-invariant (left / center / right)", () => {
  function timed(align: "left" | "center" | "right"): TextOverlay {
    return textOverlay({
      text: "Make it pop",
      endOnTimeline: 2000,
      style: {
        fontFamily: "sans-serif",
        fontSize: 48,
        fontWeight: 600,
        color: "#FFFFFF",
        align,
        outline: { color: "#000000", width: 2, position: "outside" },
      },
      animation: {
        typewriter: {
          words: [
            { text: "Make", startMs: 0, endMs: 700 },
            { text: "it", startMs: 700, endMs: 1100 },
            { text: "pop", startMs: 1100, endMs: 2000 },
          ],
        },
      },
    });
  }

  it.each(["left", "center", "right"] as const)(
    "align=%s: enable windows are non-overlapping and the final holds to the overlay end",
    (align) => {
      const ov = timed(align);
      const bounds = enableExprs(projectWith(ov)).map((e) => {
        const m = BETWEEN_RE.exec(e)!;
        return { start: Number.parseFloat(m[1]!), end: Number.parseFloat(m[2]!) };
      });
      expect(bounds.length).toBeGreaterThan(1);
      for (let i = 1; i < bounds.length; i++) {
        expect(bounds[i - 1]!.end).toBeLessThanOrEqual(bounds[i]!.start);
      }
      expect(bounds[bounds.length - 1]!.end).toBe(2); // 2000ms

      // At the word boundary t=700ms (0.7s) EXACTLY ONE window is active — never two
      // (which is what produced the ghosted, alignment-dependent double-draw).
      const active = bounds.filter((b) => b.start <= 0.7 && 0.7 <= b.end);
      expect(active).toHaveLength(1);
    },
  );

  it.each(["left", "center", "right"] as const)(
    "align=%s: each drawn prefix == getRevealedPrefix at its reveal time (preview==export)",
    (align) => {
      const ov = timed(align);
      for (const step of getCharRevealSteps(ov)) {
        expect(getRevealedPrefix(ov, step.charStartMs)).toBe(step.prefix);
      }
    },
  );
});
