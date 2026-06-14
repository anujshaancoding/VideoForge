// ─────────────────────────────────────────────────────────────────────────────
// Shared clip-FIT geometry — the ONE math that decides how a clip's source pixels
// fill its on-canvas transform box (logos / picture-in-picture / image stickers).
//
// THE INVARIANT (CLAUDE.md): preview == export. The preview canvas (PreviewEngine)
// and the FFmpeg export (buildFilterComplex) MUST place/scale a fitted image the
// same way. The export half is a pure FFmpeg filter chain that operates on the
// source's `iw/ih` at filter time (so the headless builder needs no intrinsic
// dimensions); the preview half computes the equivalent draw rect from the loaded
// image's `naturalWidth/naturalHeight`. Both are derived HERE so they can't drift.
//
//   • "fill"    — stretch the source to exactly the box (may distort). DEFAULT.
//   • "contain" — scale to fit INSIDE the box preserving aspect (letterbox, no crop).
//   • "cover"   — scale to FILL the box preserving aspect (crop overflow, no bars).
//
// All three modes yield a region that occupies the SAME box on the canvas, so the
// box's top-left placement (overlay=x:y on export) is unchanged across fit modes.
// ─────────────────────────────────────────────────────────────────────────────

import type { ClipFit } from "./types.js";

/** Normalise an optional fit to the concrete default ("fill") used by both sides. */
export function normalizeClipFit(fit: ClipFit | undefined): ClipFit {
  return fit === "contain" || fit === "cover" ? fit : "fill";
}

/**
 * Preview draw geometry for `ctx.drawImage(img, sx,sy,sw,sh, dx,dy,dw,dh)` — the
 * 9-arg form — so the canvas reproduces the export's scale/pad/crop exactly.
 *
 *   • fill    → draw the whole source into the whole box (stretch).
 *   • contain → draw the whole source into a CENTRED sub-rect of the box that
 *               preserves aspect (the box remainder shows the canvas background,
 *               matching the export's `pad=...:color=<bg>`).
 *   • cover   → draw a CENTRED sub-rect of the SOURCE (the part that survives the
 *               crop) into the whole box, matching the export's `crop=w:h`.
 *
 * @param fit       the clip fit (undefined ⇒ "fill").
 * @param box       the destination box on the canvas, in pixels (x/y top-left, w/h).
 * @param srcW,srcH the source's intrinsic dimensions in pixels (e.g. img.naturalWidth).
 *                  If either is ≤ 0 (not yet loaded) we fall back to "fill" geometry.
 */
export function clipFitRects(
  fit: ClipFit | undefined,
  box: { x: number; y: number; w: number; h: number },
  srcW: number,
  srcH: number,
): { sx: number; sy: number; sw: number; sh: number; dx: number; dy: number; dw: number; dh: number } {
  const fillRect = {
    sx: 0,
    sy: 0,
    sw: srcW > 0 ? srcW : 1,
    sh: srcH > 0 ? srcH : 1,
    dx: box.x,
    dy: box.y,
    dw: box.w,
    dh: box.h,
  };
  const mode = normalizeClipFit(fit);
  if (mode === "fill" || srcW <= 0 || srcH <= 0 || box.w <= 0 || box.h <= 0) return fillRect;

  const boxAR = box.w / box.h;
  const srcAR = srcW / srcH;

  if (mode === "contain") {
    // Whole source into a centred sub-rect of the box (letterbox).
    let dw = box.w;
    let dh = box.h;
    if (srcAR > boxAR) {
      // Source wider than box → width-bound; bars top/bottom.
      dh = box.w / srcAR;
    } else {
      // Source taller than box → height-bound; bars left/right.
      dw = box.h * srcAR;
    }
    return {
      sx: 0,
      sy: 0,
      sw: srcW,
      sh: srcH,
      dx: box.x + (box.w - dw) / 2,
      dy: box.y + (box.h - dh) / 2,
      dw,
      dh,
    };
  }

  // cover: centred sub-rect of the SOURCE into the whole box (crop overflow).
  let sw = srcW;
  let sh = srcH;
  if (srcAR > boxAR) {
    // Source wider than box → crop the sides.
    sw = srcH * boxAR;
  } else {
    // Source taller than box → crop top/bottom.
    sh = srcW / boxAR;
  }
  return {
    sx: (srcW - sw) / 2,
    sy: (srcH - sh) / 2,
    sw,
    sh,
    dx: box.x,
    dy: box.y,
    dw: box.w,
    dh: box.h,
  };
}

/**
 * Export half — the FFmpeg `scale`/`pad`/`crop` filter steps that fill a `w×h` box
 * for the given fit. The output is ALWAYS exactly `w×h`, so the caller's downstream
 * `overlay=x:y` placement is identical across fit modes (only the inner content
 * scaling/cropping differs).
 *
 *   • fill    → ["scale=w:h"]
 *   • contain → ["format=rgba", "scale=w:h:force_original_aspect_ratio=decrease",
 *                "pad=w:h:(ow-iw)/2:(oh-ih)/2:color=#00000000"]
 *   • cover   → ["scale=w:h:force_original_aspect_ratio=increase", "crop=w:h"]
 *
 * CONTAIN PARITY: the letterbox area is padded with TRANSPARENT (not the canvas bg),
 * on an rgba stream, so the export composites the same way the preview canvas does —
 * the bars reveal whatever is UNDER the clip (a lower track / the canvas), NOT an
 * opaque rectangle painted over it. (A logo with a contain fit must not stamp a solid
 * box over the footage behind it.) The downstream overlay blends the alpha plane.
 *
 * Pure (no I/O); deterministic given the same inputs.
 */
export function clipFitScaleSteps(fit: ClipFit | undefined, w: number, h: number): string[] {
  const mode = normalizeClipFit(fit);
  if (mode === "contain") {
    return [
      // rgba first so `pad` can write a TRANSPARENT (alpha=0) letterbox the overlay blends.
      "format=rgba",
      `scale=${w}:${h}:force_original_aspect_ratio=decrease`,
      `pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:color=#00000000`,
    ];
  }
  if (mode === "cover") {
    return [`scale=${w}:${h}:force_original_aspect_ratio=increase`, `crop=${w}:${h}`];
  }
  return [`scale=${w}:${h}`];
}
