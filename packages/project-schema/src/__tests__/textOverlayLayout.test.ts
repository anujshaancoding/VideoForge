// ─────────────────────────────────────────────────────────────────────────────
// Unit tests for the shared text-overlay layout math (Text_Overlay_Export_Spec.md
// §5/§7.5). This is the ONE formula the preview canvas and the FFmpeg export both
// consume — so these tests lock the contract that keeps them from drifting:
//   • percent→pixel box geometry
//   • fontPx = (fontSize/canvasH)*surfaceH, with the scaled 12px floor (R5)
//   • borderPx / lineSpacing scaling
//   • align→anchorX
//   • weight→Inter-face bucketing (R2) + italic file names
//   • uniform-scale parity: preview px == export px * scale
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect } from "vitest";
import {
  layoutTextOverlay,
  weightToInterFace,
  weightToInterFile,
  DEFAULT_LINE_HEIGHT,
  FONT_PX_FLOOR,
} from "../textOverlayLayout.js";
import type { TextOverlay } from "../types.js";

// The §1 default overlay from the spec (Appendix A worked example). fontFamily is
// intentionally "sans-serif" — the canvas ignores it and renders Inter (R1); the
// layout math does not read it at all.
function makeOverlay(overrides: Partial<TextOverlay> = {}): TextOverlay {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    trackId: "00000000-0000-4000-8000-0000000000a0",
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
    text: "Hello",
    style: {
      fontFamily: "sans-serif",
      fontSize: 48,
      fontWeight: 600,
      color: "#FFFFFF",
      align: "center",
      outline: { color: "#000000", width: 2, position: "outside" },
      ...(overrides.style ?? {}),
    },
    ...overrides,
  };
}

describe("layoutTextOverlay — box geometry (percent→export px, §5.1)", () => {
  it("matches the Appendix A worked example at 1080×1920", () => {
    const ov = makeOverlay();
    const L = layoutTextOverlay(ov, 1080, 1920, 1920);
    expect(L.boxX).toBe(54); // round(0.05*1080)
    expect(L.boxY).toBe(1536); // round(0.80*1920)
    expect(L.boxW).toBe(972); // round(0.90*1080)
    expect(L.boxH).toBe(288); // round(0.15*1920)
  });

  it("rounds box geometry to integer pixels", () => {
    const ov = makeOverlay({ canvasX: 33, canvasY: 33, width: 33, height: 33 });
    const L = layoutTextOverlay(ov, 1080, 1920, 1920);
    // 0.33*1080 = 356.4 → 356; 0.33*1920 = 633.6 → 634.
    expect(L.boxX).toBe(356);
    expect(L.boxY).toBe(634);
    expect(L.boxW).toBe(356);
    expect(L.boxH).toBe(634);
  });
});

describe("layoutTextOverlay — font size + 12px floor (§5.2 / R5)", () => {
  it("fontPx = fontSize when render height == canvas height", () => {
    const ov = makeOverlay({ style: { ...makeOverlay().style, fontSize: 48 } });
    expect(layoutTextOverlay(ov, 1080, 1920, 1920).fontPx).toBe(48); // round((48/1920)*1920)
  });

  it("scales fontPx linearly to the surface height", () => {
    const ov = makeOverlay({ style: { ...makeOverlay().style, fontSize: 48 } });
    // Preview backing store for a 1080×1920 project is 405×720 (scale 0.375).
    expect(layoutTextOverlay(ov, 405, 720, 1920).fontPx).toBe(18); // round((48/1920)*720)
  });

  it("applies the 12px floor scaled to the surface for a sub-floor font (R5)", () => {
    // fontSize 20 on a 1920-tall canvas → (20/1920)*1920 = 20 at full res (above floor),
    // but on the 720-tall preview → (20/1920)*720 = 7.5 → floored to round(12*720/1920)=4.5→5.
    const ov = makeOverlay({ style: { ...makeOverlay().style, fontSize: 20 } });
    const exportL = layoutTextOverlay(ov, 1080, 1920, 1920);
    const previewL = layoutTextOverlay(ov, 405, 720, 1920);
    expect(exportL.fontPx).toBe(20); // unfloored at full res
    // Preview: max(round(12*0.375), round(20*0.375)) = max(5, 8) = 8 (size wins, still > floor).
    expect(previewL.fontPx).toBe(8);
  });

  it("the floor wins when the scaled size is below it", () => {
    // fontSize 8 on a 1920 canvas at full res: max(round(12), round(8)) = 12.
    const ov = makeOverlay({ style: { ...makeOverlay().style, fontSize: 8 } });
    expect(layoutTextOverlay(ov, 1080, 1920, 1920).fontPx).toBe(FONT_PX_FLOOR);
  });
});

describe("layoutTextOverlay — outline scaling (§7.4)", () => {
  it("scales outline width by surfaceH/canvasH", () => {
    const ov = makeOverlay();
    expect(layoutTextOverlay(ov, 1080, 1920, 1920).borderPx).toBe(2); // round(2 * 1)
    expect(layoutTextOverlay(ov, 405, 720, 1920).borderPx).toBe(1); // round(2 * 0.375) = round(0.75)
  });

  it("returns borderPx 0 when there is no outline or width 0", () => {
    const noOutline = makeOverlay({ style: { ...makeOverlay().style, outline: undefined } });
    expect(layoutTextOverlay(noOutline, 1080, 1920, 1920).borderPx).toBe(0);
    const zero = makeOverlay({
      style: { ...makeOverlay().style, outline: { color: "#000000", width: 0, position: "outside" } },
    });
    expect(layoutTextOverlay(zero, 1080, 1920, 1920).borderPx).toBe(0);
  });
});

describe("layoutTextOverlay — line spacing (§6.3)", () => {
  it("defaults lineHeight to 1.2 → lineSpacing = round(fontPx*0.2)", () => {
    const ov = makeOverlay(); // fontPx 48 at full res
    expect(DEFAULT_LINE_HEIGHT).toBe(1.2);
    expect(layoutTextOverlay(ov, 1080, 1920, 1920).lineSpacing).toBe(10); // round(48*0.2)
  });

  it("honours an explicit lineHeight", () => {
    const ov = makeOverlay({ style: { ...makeOverlay().style, lineHeight: 1.5 } });
    expect(layoutTextOverlay(ov, 1080, 1920, 1920).lineSpacing).toBe(24); // round(48*0.5)
  });

  it("never returns negative line spacing", () => {
    const ov = makeOverlay({ style: { ...makeOverlay().style, lineHeight: 0.8 } });
    expect(layoutTextOverlay(ov, 1080, 1920, 1920).lineSpacing).toBe(0);
  });
});

describe("layoutTextOverlay — horizontal anchor by align (§5.3)", () => {
  const ov = makeOverlay();
  it("left → boxX", () => {
    const L = layoutTextOverlay(makeOverlay({ style: { ...ov.style, align: "left" } }), 1080, 1920, 1920);
    expect(L.anchorX).toBe(L.boxX);
  });
  it("center → boxX + boxW/2", () => {
    const L = layoutTextOverlay(makeOverlay({ style: { ...ov.style, align: "center" } }), 1080, 1920, 1920);
    expect(L.anchorX).toBe(L.boxX + L.boxW / 2);
  });
  it("right → boxX + boxW", () => {
    const L = layoutTextOverlay(makeOverlay({ style: { ...ov.style, align: "right" } }), 1080, 1920, 1920);
    expect(L.anchorX).toBe(L.boxX + L.boxW);
  });
});

describe("layoutTextOverlay — uniform-scale parity (the invariant, §3)", () => {
  it("preview px == export px * scale for box + font (default overlay)", () => {
    const ov = makeOverlay();
    const scale = 720 / 1920; // 0.375
    const exp = layoutTextOverlay(ov, 1080, 1920, 1920);
    const prev = layoutTextOverlay(ov, 405, 720, 1920);
    expect(prev.boxX).toBe(Math.round(exp.boxX * scale)); // 20 == round(54*0.375)=20
    expect(prev.fontPx).toBe(Math.round(exp.fontPx * scale)); // 18 == round(48*0.375)=18
  });
});

describe("weightToInterFace — nearest-loaded-weight bucketing (§4.2 / R2)", () => {
  it("buckets the five canonical weights to their own faces", () => {
    expect(weightToInterFace(400)).toBe("Regular");
    expect(weightToInterFace(500)).toBe("Medium");
    expect(weightToInterFace(600)).toBe("SemiBold");
    expect(weightToInterFace(700)).toBe("Bold");
    expect(weightToInterFace(800)).toBe("ExtraBold");
  });

  it("applies the exact bucket boundaries from the contract", () => {
    expect(weightToInterFace(450)).toBe("Regular"); // ≤ 450
    expect(weightToInterFace(451)).toBe("Medium");
    expect(weightToInterFace(550)).toBe("Medium"); // ≤ 550
    expect(weightToInterFace(551)).toBe("SemiBold");
    expect(weightToInterFace(650)).toBe("SemiBold"); // ≤ 650
    expect(weightToInterFace(651)).toBe("Bold");
    expect(weightToInterFace(750)).toBe("Bold"); // ≤ 750
    expect(weightToInterFace(751)).toBe("ExtraBold");
    expect(weightToInterFace(900)).toBe("ExtraBold");
  });

  it("680 buckets to Bold (the R2 example)", () => {
    expect(weightToInterFace(680)).toBe("Bold");
  });
});

describe("weightToInterFile — TTF basenames (§7.3)", () => {
  it("maps weights to upright Inter TTF basenames", () => {
    expect(weightToInterFile(400)).toBe("Inter-Regular.ttf");
    expect(weightToInterFile(600)).toBe("Inter-SemiBold.ttf");
    expect(weightToInterFile(700)).toBe("Inter-Bold.ttf");
    expect(weightToInterFile(800)).toBe("Inter-ExtraBold.ttf");
  });

  it("maps italics to the Italic faces (Regular italic is just 'Inter-Italic')", () => {
    expect(weightToInterFile(400, true)).toBe("Inter-Italic.ttf");
    expect(weightToInterFile(600, true)).toBe("Inter-SemiBoldItalic.ttf");
    expect(weightToInterFile(700, true)).toBe("Inter-BoldItalic.ttf");
  });

  it("returns a bare basename, never an absolute path (purity for the graph builder)", () => {
    expect(weightToInterFile(600)).not.toContain("/");
  });
});
