// ─────────────────────────────────────────────────────────────────────────────
// Unit tests for the shared clip-FIT geometry (logos / PiP / image stickers). This
// is the ONE scale/pad/crop math the preview canvas (clipFitRects) and the FFmpeg
// export (clipFitScaleSteps) both consume, so these tests lock the contract that
// keeps preview == export:
//   • fill    — stretch the whole source into the whole box
//   • contain — fit inside the box preserving aspect (letterbox, no crop)
//   • cover   — fill the box preserving aspect (crop overflow, no bars)
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect } from "vitest";
import { clipFitRects, clipFitScaleSteps, normalizeClipFit } from "../clipFit.js";

describe("normalizeClipFit", () => {
  it("treats undefined / unknown / 'fill' as 'fill' (the byte-identical default)", () => {
    expect(normalizeClipFit(undefined)).toBe("fill");
    expect(normalizeClipFit("fill")).toBe("fill");
    expect(normalizeClipFit("none" as never)).toBe("fill");
  });
  it("passes through contain / cover", () => {
    expect(normalizeClipFit("contain")).toBe("contain");
    expect(normalizeClipFit("cover")).toBe("cover");
  });
});

describe("clipFitScaleSteps — export FFmpeg filter steps", () => {
  it("fill (default) is a single bare scale — byte-identical to the pre-fit graph", () => {
    expect(clipFitScaleSteps(undefined, 540, 960)).toEqual(["scale=540:960"]);
    expect(clipFitScaleSteps("fill", 540, 960)).toEqual(["scale=540:960"]);
  });

  it("contain scales-to-fit + pads with TRANSPARENT on rgba (reveals what's under the clip)", () => {
    const steps = clipFitScaleSteps("contain", 540, 960);
    expect(steps).toEqual([
      "format=rgba",
      "scale=540:960:force_original_aspect_ratio=decrease",
      "pad=540:960:(ow-iw)/2:(oh-ih)/2:color=#00000000",
    ]);
  });

  it("cover scales-to-fill + crops to the exact box", () => {
    expect(clipFitScaleSteps("cover", 540, 960)).toEqual([
      "scale=540:960:force_original_aspect_ratio=increase",
      "crop=540:960",
    ]);
  });

  it("every mode yields an output of EXACTLY the box size (so overlay placement is unchanged)", () => {
    // The last step of each chain is constrained to box dims (scale/pad/crop all =540:960).
    for (const fit of ["fill", "contain", "cover"] as const) {
      const steps = clipFitScaleSteps(fit, 540, 960);
      expect(steps.join(",")).toContain("540:960");
    }
  });
});

describe("clipFitRects — preview canvas drawImage rects", () => {
  const box = { x: 100, y: 200, w: 400, h: 400 }; // square box

  it("fill draws the whole source into the whole box (stretch)", () => {
    const r = clipFitRects("fill", box, 800, 400); // 2:1 source
    expect(r).toMatchObject({ sx: 0, sy: 0, sw: 800, sh: 400, dx: 100, dy: 200, dw: 400, dh: 400 });
  });

  it("contain (wide source into square box) letterboxes top/bottom, source uncropped", () => {
    const r = clipFitRects("contain", box, 800, 400); // 2:1 into 1:1
    // source uncropped
    expect(r.sx).toBe(0);
    expect(r.sy).toBe(0);
    expect(r.sw).toBe(800);
    expect(r.sh).toBe(400);
    // width-bound: dw = full box width, dh = box.w / srcAR = 400 / 2 = 200, centred vertically
    expect(r.dw).toBe(400);
    expect(r.dh).toBe(200);
    expect(r.dx).toBe(100);
    expect(r.dy).toBe(200 + (400 - 200) / 2); // 300
  });

  it("contain (tall source into square box) letterboxes left/right", () => {
    const r = clipFitRects("contain", box, 400, 800); // 1:2 into 1:1
    expect(r.dh).toBe(400);
    expect(r.dw).toBe(200); // box.h * srcAR = 400 * 0.5
    expect(r.dx).toBe(100 + (400 - 200) / 2); // 300
    expect(r.dy).toBe(200);
  });

  it("cover (wide source into square box) crops the SIDES, fills the whole box", () => {
    const r = clipFitRects("cover", box, 800, 400); // 2:1 into 1:1
    // dest is the whole box
    expect(r).toMatchObject({ dx: 100, dy: 200, dw: 400, dh: 400 });
    // source cropped horizontally to a centred square: sw = srcH*boxAR = 400*1 = 400
    expect(r.sh).toBe(400);
    expect(r.sw).toBe(400);
    expect(r.sx).toBe((800 - 400) / 2); // 200
    expect(r.sy).toBe(0);
  });

  it("cover (tall source into square box) crops top/bottom", () => {
    const r = clipFitRects("cover", box, 400, 800); // 1:2 into 1:1
    expect(r.sw).toBe(400);
    expect(r.sh).toBe(400); // srcW / boxAR
    expect(r.sx).toBe(0);
    expect(r.sy).toBe((800 - 400) / 2); // 200
  });

  it("falls back to fill geometry when source dims are unknown (not yet loaded)", () => {
    const r = clipFitRects("cover", box, 0, 0);
    expect(r).toMatchObject({ dx: 100, dy: 200, dw: 400, dh: 400 });
  });

  it("PREVIEW == EXPORT contain: same-aspect source neither crops nor letterboxes", () => {
    // A source whose AR already matches the box → contain leaves dest == box, src whole.
    const r = clipFitRects("contain", box, 400, 400); // 1:1 into 1:1
    expect(r).toMatchObject({ sx: 0, sy: 0, sw: 400, sh: 400, dx: 100, dy: 200, dw: 400, dh: 400 });
  });
});
