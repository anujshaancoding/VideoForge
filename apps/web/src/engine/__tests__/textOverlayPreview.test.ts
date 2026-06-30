// ─────────────────────────────────────────────────────────────────────────────
// PreviewEngine — text-overlay preview parity (Text_Overlay_Export_Spec.md §11.2).
//
// These tests pin the two Pixel changes that make the canvas preview match the
// export's `drawtext` for text overlays:
//   1. `_drawOverlays` draws text geometry from the SHARED `layoutTextOverlay`
//      helper (same px math as the export) — not bespoke inline arithmetic.
//   2. Multi-line text is split on "\n" (no trimming) and the whole block is
//      vertically centred on the box mid-line with line pitch
//      fontPx * DEFAULT_LINE_HEIGHT (1.2) — the SAME split rule + line height the
//      export uses (§6.2 / R6). Today's single-`fillText` (newlines dropped) is the
//      divergence being fixed.
//
// We drive the real engine: a fake canvas hands it a RECORDING 2D context, and
// `setProject` (engine paused) triggers a single composite, so the `fillText`/
// `strokeText` calls captured ARE the overlay draw. Geometry assertions are derived
// independently from `layoutTextOverlay` so a future drift in either side fails here.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect } from "vitest";
import {
  layoutTextOverlay,
  DEFAULT_LINE_HEIGHT,
  getRevealedPrefix,
  type Project,
  type TextOverlay,
  type Track,
} from "@videoforge/project-schema";
import { PreviewEngine } from "../PreviewEngine.js";

// ── Recording 2D context ──────────────────────────────────────────────────────
// jsdom has no canvas; we record the text draws and the context state at call time.

interface TextCall {
  op: "fill" | "stroke";
  text: string;
  x: number;
  y: number;
  font: string;
  lineWidth: number;
  textAlign: string;
  textBaseline: string;
}

function makeRecordingCanvas(width: number, height: number): {
  canvas: HTMLCanvasElement;
  calls: TextCall[];
} {
  const calls: TextCall[] = [];
  const ctx = {
    // mutable drawing state the engine sets before each text draw
    font: "",
    lineWidth: 0,
    textAlign: "left",
    textBaseline: "alphabetic",
    fillStyle: "",
    strokeStyle: "",
    globalAlpha: 1,
    // no-op surface ops the composite path touches
    fillRect: () => {},
    strokeRect: () => {},
    clearRect: () => {},
    drawImage: () => {},
    beginPath: () => {},
    rect: () => {},
    clip: () => {},
    save: () => {},
    restore: () => {},
    translate: () => {},
    scale: () => {},
    fillText(text: string, x: number, y: number) {
      calls.push({
        op: "fill", text, x, y,
        font: this.font, lineWidth: this.lineWidth,
        textAlign: this.textAlign, textBaseline: this.textBaseline,
      });
    },
    strokeText(text: string, x: number, y: number) {
      calls.push({
        op: "stroke", text, x, y,
        font: this.font, lineWidth: this.lineWidth,
        textAlign: this.textAlign, textBaseline: this.textBaseline,
      });
    },
  };
  const canvas = {
    width,
    height,
    getContext: (id: string) => (id === "2d" ? ctx : null),
  } as unknown as HTMLCanvasElement;
  return { canvas, calls };
}

// ── Minimal AudioEngine stub (PreviewEngine only reads audioCtx + play/pause) ──
function makeAudio() {
  return {
    audioCtx: { currentTime: 0 },
    playAll: () => {},
    pauseAll: () => {},
  } as unknown as Parameters<PreviewEngine["init"]>[1];
}

// ── Project / overlay fixtures ────────────────────────────────────────────────
// 1080×1920 canvas; the preview backing store the engine sees is the canvas we pass
// it (here full 1080×1920 so px assertions read cleanly — the helper is uniform-scale
// so the assertions hold at any surface size).
const CANVAS_W = 1080;
const CANVAS_H = 1920;

function makeTextOverlay(text: string, overrides: Partial<TextOverlay> = {}): TextOverlay {
  return {
    id: "ov-1",
    trackId: "ot-1",
    kind: "text",
    startOnTimeline: 0,
    endOnTimeline: 3000,
    canvasX: 5,
    canvasY: 80,
    width: 90,
    height: 15,
    rotation: 0,
    opacity: 100,
    animation: {},
    keyframes: {},
    text,
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

function makeProject(overlay: TextOverlay): Project {
  const overlayTrack: Track = {
    id: "ot-1",
    type: "overlay",
    name: "Overlay 1",
    colour: "#FF7A1A",
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
    id: "proj-1",
    title: "t",
    canvas: {
      width: CANVAS_W,
      height: CANVAS_H,
      frameRate: 30,
      aspectRatio: "9:16",
      backgroundColor: "#111111",
    },
    tracks: [overlayTrack],
    captionTracks: [],
    transitions: [],
    markers: [],
    exportPresets: [],
    ownerId: "u",
    workspaceId: "w",
    collaborators: [{ userId: "u", role: "admin" }],
    isPublic: false,
    templateId: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

/**
 * Render one overlay (engine paused) and return ONLY the overlay's text draws.
 * The composite also paints a "No clip at the playhead" placeholder (no video clip
 * in the fixture) — engine chrome unrelated to the overlay, filtered out here.
 */
const PLACEHOLDER = "No clip at the playhead";
function renderOverlay(overlay: TextOverlay): TextCall[] {
  return renderOverlayAt(overlay, 0);
}

/** Render one overlay (engine paused) at a specific playhead, returning its text draws. */
function renderOverlayAt(overlay: TextOverlay, playheadMs: number): TextCall[] {
  const { canvas, calls } = makeRecordingCanvas(CANVAS_W, CANVAS_H);
  const engine = new PreviewEngine();
  engine.init(canvas, makeAudio(), {
    onPlayheadUpdate: () => {},
    onPlaybackEnded: () => {},
  });
  engine.setProject(makeProject(overlay));
  calls.length = 0; // discard the setProject() composite at playhead 0
  engine.seekTo(playheadMs); // paused ⇒ composites one frame at this playhead
  return calls.filter((c) => c.text !== PLACEHOLDER);
}

describe("PreviewEngine text overlay — shared layout helper (§11.2.1)", () => {
  it("draws from layoutTextOverlay: fontPx, anchorX, borderPx, Inter family", () => {
    const ov = makeTextOverlay("Hello");
    const L = layoutTextOverlay(ov, CANVAS_W, CANVAS_H, CANVAS_H);
    const calls = renderOverlay(ov);

    const fill = calls.find((c) => c.op === "fill" && c.text === "Hello")!;
    const stroke = calls.find((c) => c.op === "stroke" && c.text === "Hello")!;
    expect(fill).toBeDefined();
    expect(stroke).toBeDefined();

    // Font size comes from the shared helper (round((48/1920)*1920) = 48), NOT bespoke math.
    expect(L.fontPx).toBe(48);
    // Font family is the hardcoded CSS Inter chain (R1) — the engine renders
    // `Inter, system-ui, sans-serif` (system-ui is a harmless fallback that only
    // applies if the bundled Inter face fails to load; Inter always wins in practice,
    // so preview still matches the export's Inter rasterisation). The data's
    // fontFamily ("sans-serif") is ignored.
    expect(fill.font).toBe(`${ov.style.fontWeight} ${L.fontPx}px Inter, system-ui, sans-serif`);
    expect(fill.font).toContain("Inter, system-ui, sans-serif");
    expect(fill.font.startsWith(`${ov.style.fontWeight} ${L.fontPx}px Inter`)).toBe(true); // Inter leads, not the data's family

    // Horizontal anchor + vertical centre come straight from the helper.
    expect(fill.x).toBe(L.anchorX);
    expect(fill.y).toBeCloseTo(L.boxY + L.boxH / 2, 6); // single line ⇒ box mid-line
    expect(fill.textBaseline).toBe("middle");

    // Outline width is the helper's scaled borderPx (round(2 * 1) = 2), drawn UNDER fill.
    expect(L.borderPx).toBe(2);
    expect(stroke.lineWidth).toBe(L.borderPx);
    expect(calls.indexOf(stroke)).toBeLessThan(calls.indexOf(fill)); // stroke before fill
  });

  it("honours align=left (anchorX = box left edge)", () => {
    const ov = makeTextOverlay("L", {
      style: { ...makeTextOverlay("L").style, align: "left" },
    });
    const L = layoutTextOverlay(ov, CANVAS_W, CANVAS_H, CANVAS_H);
    const fill = renderOverlay(ov).find((c) => c.op === "fill")!;
    expect(L.anchorX).toBe(L.boxX);
    expect(fill.x).toBe(L.boxX);
    expect(fill.textAlign).toBe("left");
  });

  it("omits the stroke when there is no outline", () => {
    const { outline: _drop, ...styleNoOutline } = makeTextOverlay("NoStroke").style;
    void _drop;
    const ov = makeTextOverlay("NoStroke", { style: styleNoOutline });
    const calls = renderOverlay(ov);
    expect(calls.some((c) => c.op === "fill" && c.text === "NoStroke")).toBe(true);
    expect(calls.some((c) => c.op === "stroke")).toBe(false);
  });
});

describe("PreviewEngine text overlay — multi-line block (§11.2.2 / R6)", () => {
  it("splits text on \\n (no trimming) into one draw per line", () => {
    const calls = renderOverlay(makeTextOverlay("line one\n line two\nthird"));
    const fills = calls.filter((c) => c.op === "fill");
    expect(fills.map((c) => c.text)).toEqual(["line one", " line two", "third"]); // leading space kept
  });

  it("strokes AND fills every line (outline on each)", () => {
    const calls = renderOverlay(makeTextOverlay("a\nb"));
    expect(calls.filter((c) => c.op === "fill").map((c) => c.text)).toEqual(["a", "b"]);
    expect(calls.filter((c) => c.op === "stroke").map((c) => c.text)).toEqual(["a", "b"]);
  });

  it("vertically centres the whole block on the box mid-line at pitch fontPx*1.2", () => {
    const ov = makeTextOverlay("one\ntwo\nthree");
    const L = layoutTextOverlay(ov, CANVAS_W, CANVAS_H, CANVAS_H);
    const fills = renderOverlay(ov).filter((c) => c.op === "fill");

    const pitch = L.fontPx * DEFAULT_LINE_HEIGHT;
    expect(DEFAULT_LINE_HEIGHT).toBe(1.2);
    const centerY = L.boxY + L.boxH / 2;
    const expectedFirstY = centerY - ((fills.length - 1) * pitch) / 2;

    // Each line sits one pitch below the previous.
    fills.forEach((c, i) => {
      expect(c.y).toBeCloseTo(expectedFirstY + i * pitch, 6);
    });
    // Block is symmetric about the box mid-line: mean baseline == centerY.
    const meanY = fills.reduce((s, c) => s + c.y, 0) / fills.length;
    expect(meanY).toBeCloseTo(centerY, 6);
    // The middle line lands exactly on the mid-line (odd line count).
    expect(fills[1]!.y).toBeCloseTo(centerY, 6);
  });

  it("single line is unchanged: drawn exactly at the box mid-line (no visual regression)", () => {
    const ov = makeTextOverlay("solo");
    const L = layoutTextOverlay(ov, CANVAS_W, CANVAS_H, CANVAS_H);
    const fills = renderOverlay(ov).filter((c) => c.op === "fill");
    expect(fills).toHaveLength(1);
    expect(fills[0]!.y).toBeCloseTo(L.boxY + L.boxH / 2, 6);
  });
});

// ── Typewriter character-by-character reveal (Script Studio big-caption track) ──
// The preview must render ONLY the revealed prefix at the playhead, from the SHARED
// getRevealedPrefix helper the export also consumes. Geometry/font/anchor stay
// derived from the full overlay; only the rendered string grows. Absent timing ⇒
// full text (byte-identical to the static path) — the backward-compat guardrail.
describe("PreviewEngine text overlay — typewriter reveal", () => {
  // "Hi all" over [0,1000): word "Hi" reveals across [0,500), "all" across [500,1000).
  // Even-distribution within each word; the space before "all" reveals at 500.
  const twOverlay = (): TextOverlay =>
    makeTextOverlay("Hi all", {
      startOnTimeline: 0,
      endOnTimeline: 1000,
      animation: {
        typewriter: {
          words: [
            { text: "Hi", startMs: 0, endMs: 500 },
            { text: "all", startMs: 500, endMs: 1000 },
          ],
        },
      },
    });

  it("renders only the revealed prefix at the playhead (matches getRevealedPrefix)", () => {
    const ov = twOverlay();
    for (const t of [0, 250, 500, 750, 999]) {
      const expected = getRevealedPrefix(ov, t);
      const fills = renderOverlayAt(ov, t).filter((c) => c.op === "fill");
      // Single-line caption ⇒ exactly one fill of the revealed prefix (or none if empty).
      if (expected.length === 0) {
        expect(fills).toHaveLength(0);
      } else {
        expect(fills.map((c) => c.text)).toEqual([expected]);
      }
    }
  });

  it("reveal is a growing prefix that ends at the full text", () => {
    const ov = twOverlay();
    expect(getRevealedPrefix(ov, 0)).toBe("H"); // first char of "Hi" at t=0
    expect(getRevealedPrefix(ov, 999)).toBe("Hi all"); // fully revealed by the end
  });

  it("revealed prefix keeps the SAME anchor + box-centre y as the static full text", () => {
    const ov = twOverlay();
    const L = layoutTextOverlay(ov, CANVAS_W, CANVAS_H, CANVAS_H);
    const fill = renderOverlayAt(ov, 250).filter((c) => c.op === "fill")[0]!;
    expect(fill.x).toBe(L.anchorX);
    expect(fill.y).toBeCloseTo(L.boxY + L.boxH / 2, 6); // single line ⇒ box mid-line, no shift
  });

  it("absent typewriter timing ⇒ full text at every playhead (static, no regression)", () => {
    const ov = makeTextOverlay("Static caption", {
      startOnTimeline: 0,
      endOnTimeline: 1000,
    });
    for (const t of [0, 500, 999]) {
      const fills = renderOverlayAt(ov, t).filter((c) => c.op === "fill");
      expect(fills.map((c) => c.text)).toEqual(["Static caption"]);
    }
  });
});
