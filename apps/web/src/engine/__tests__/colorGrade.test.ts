import { describe, it, expect } from "vitest";
import { eqParams } from "../ColorGrader.js";

// The preview's WebGL grade MUST match the export's FFmpeg `eq` filter, or the
// "what you cut is what you get" invariant breaks. eqParams is the shared mapping;
// these tests pin it and assert it formats to the SAME string the ffmpeg-graph
// builder (colorGradeExtOf) emits.

describe("eqParams — UI (−100..100) → FFmpeg eq params", () => {
  it("maps a neutral grade to the identity transform", () => {
    expect(eqParams({ brightness: 0, contrast: 0, saturation: 0 })).toEqual({
      brightness: 0,
      contrast: 1,
      saturation: 1,
    });
  });

  it("maps mid-range values", () => {
    expect(eqParams({ brightness: 50, contrast: 50, saturation: 50 })).toEqual({
      brightness: 0.5,
      contrast: 1.5,
      saturation: 1.5,
    });
  });

  it("defaults missing channels to neutral", () => {
    expect(eqParams({} as never)).toEqual({ brightness: 0, contrast: 1, saturation: 1 });
  });

  it("clamps brightness to [-1, 1]", () => {
    expect(eqParams({ brightness: 200 } as never).brightness).toBe(1);
    expect(eqParams({ brightness: -200 } as never).brightness).toBe(-1);
  });

  it("clamps contrast to [0, 2]", () => {
    expect(eqParams({ contrast: 200 } as never).contrast).toBe(2);
    expect(eqParams({ contrast: -300 } as never).contrast).toBe(0);
  });

  it("clamps saturation to [0, 3]", () => {
    expect(eqParams({ saturation: 300 } as never).saturation).toBe(3);
    expect(eqParams({ saturation: -300 } as never).saturation).toBe(0);
  });

  it("formats byte-identically to the ffmpeg-graph colorGradeExtOf string", () => {
    // Replicates colorGradeExtOf's `.toFixed(3)` formatting (packages/ffmpeg-graph).
    const fmt = (g: Parameters<typeof eqParams>[0]) => {
      const e = eqParams(g);
      return `eq=brightness=${e.brightness.toFixed(3)}:contrast=${e.contrast.toFixed(
        3,
      )}:saturation=${e.saturation.toFixed(3)}`;
    };
    expect(fmt({ brightness: 0, contrast: 8, saturation: 12 })).toBe(
      "eq=brightness=0.000:contrast=1.080:saturation=1.120",
    );
    expect(fmt({ brightness: -20, contrast: 0, saturation: 0 })).toBe(
      "eq=brightness=-0.200:contrast=1.000:saturation=1.000",
    );
  });
});
