// ─────────────────────────────────────────────────────────────────────────────
// Text-overlay layout — the ONE shared percent→pixel / size / floor / stroke /
// line-spacing formula, and the weight→Inter-TTF map.
//
// THE PARITY MECHANISM (Text_Overlay_Export_Spec.md §7.5, the single most
// important recommendation): the preview canvas (apps/web `PreviewEngine`) and the
// export graph (`@videoforge/ffmpeg-graph` `buildFilterComplex`) BOTH call these
// pure functions, so the geometry, the 12px floor, the rounding, the stroke scale
// and the weight→face bucketing are identical BY CONSTRUCTION — they cannot drift.
// This is the text-overlay analogue of the shared `buildExportCommand` that already
// upholds "what you cut is what you get" for media clips.
//
// HOME = `@videoforge/project-schema` (Forge §7.5 / Appendix B.1): `apps/web` already
// depends on this package and does NOT depend on `ffmpeg-graph`, so putting the
// helper here lets the preview import it without pulling the graph builder (and all
// its compositing logic) into the web bundle. `ffmpeg-graph` already depends on
// `project-schema`, so the export side imports it from here too. ONE function, both
// sides, no new dependency edge.
//
// PURE: no fs, no Date, no random — same inputs ⇒ same output (unit-testable).
//
// ── The ground truth this reproduces ─────────────────────────────────────────────
// `PreviewEngine._drawOverlays` (the authority) computes, per visible text overlay,
// on a surface that is `w × h` pixels (the canvas BACKING STORE — for a 1080×1920
// project that is 405×720, a uniform `scale = min(1, 720/max(Cw,Ch))` of the canvas):
//
//   x  = (canvasX / 100) * w;   y  = (canvasY / 100) * h;
//   bw = (width   / 100) * w;   bh = (height  / 100) * h;
//   size = Math.max(12, (style.fontSize / project.canvas.height) * h);
//   tx   = align==="left" ? x : align==="right" ? x+bw : x+bw/2;   // horizontal anchor
//   // text drawn with textBaseline="middle" at y + bh/2            // vertical anchor
//   // outline: ctx.lineWidth = outline.width (used against the backing store)
//
// The export renders the SAME composition at the full render resolution `Rw × Rh`.
// Because every quantity above is a pure LINEAR function of percent/logical inputs
// and the surface size, the preview (surface `scale·Cw × scale·Ch`) and the export
// (surface `Rw × Rh`) differ only by the uniform factor `scale` — so a frame at time
// t in the export matches the preview at t. The ONE nonlinearity is the 12px floor;
// expressing it as `12 * surfaceH/canvasH` (§5.2) keeps it a linear function of the
// surface, so it scales uniformly too and the two sides agree.
// ─────────────────────────────────────────────────────────────────────────────

import type { TextOverlay } from "./types.js";

/** Default line-height multiplier when `style.lineHeight` is unset (spec §6.2/§6.3). */
export const DEFAULT_LINE_HEIGHT = 1.2;

/** The canvas's font-size floor, in pixels at the canvas's logical height (spec §2.2 / R5). */
export const FONT_PX_FLOOR = 12;

/**
 * Layout result for one text overlay, in pixels on the TARGET SURFACE the helper
 * was asked about (preview: backing-store px; export: render-resolution px).
 *
 * `boxX/boxY/boxW/boxH` describe the overlay box. `anchorX` is the horizontal
 * reference point matching the canvas's `tx` (left edge / centre / right edge per
 * `align`). The vertical anchor is always the box mid-line `boxY + boxH/2` (the
 * canvas draws with `textBaseline="middle"` there); the export converts that to a
 * drawtext top-left y via `text_h` (§5.3).
 */
export interface TextLayout {
  /** Box top-left X (px on the target surface). */
  boxX: number;
  /** Box top-left Y (px). */
  boxY: number;
  /** Box width (px). */
  boxW: number;
  /** Box height (px). */
  boxH: number;
  /** Font size in px (floored at the scaled 12px floor, §5.2). drawtext `fontsize=`. */
  fontPx: number;
  /** Outline/stroke width in px (scaled). drawtext `borderw=`; 0 ⇒ no border. */
  borderPx: number;
  /** Inter-line gap in px = round(fontPx * (lineHeight - 1)). drawtext `line_spacing=`. */
  lineSpacing: number;
  /**
   * Horizontal anchor point in px, matching the canvas `tx`:
   *   left   → boxX
   *   center → boxX + boxW/2
   *   right  → boxX + boxW
   */
  anchorX: number;
}

/**
 * Compute the canonical pixel layout for a text overlay on a given surface.
 *
 * Call it with the SAME overlay + canvasH on both sides; pass the surface you are
 * drawing on:
 *   • preview: `layoutTextOverlay(ov, backingW, backingH, project.canvas.height)`
 *   • export:  `layoutTextOverlay(ov, Rw,        Rh,        project.canvas.height)`
 *
 * @param ov        the text overlay (geometry in percent; `style` for size/weight/outline).
 * @param surfaceW  target surface width in px (preview backing-store w, or export Rw).
 * @param surfaceH  target surface height in px (preview backing-store h, or export Rh).
 * @param canvasH   project.canvas.height — the logical height `style.fontSize` is authored against.
 */
export function layoutTextOverlay(
  ov: TextOverlay,
  surfaceW: number,
  surfaceH: number,
  canvasH: number,
): TextLayout {
  const style = ov.style;

  // Box geometry — pure percent→pixel of the surface, rounded to integer px so both
  // sides land on identical pixel boundaries (R4: integer positions remove sub-pixel
  // drift between the two renderers).
  const boxX = Math.round((ov.canvasX / 100) * surfaceW);
  const boxY = Math.round((ov.canvasY / 100) * surfaceH);
  const boxW = Math.round((ov.width / 100) * surfaceW);
  const boxH = Math.round((ov.height / 100) * surfaceH);

  // Surface-to-canvas scale (the factor by which fontSize / outline px ride the
  // surface). canvasH is guarded > 0 (schema: fontSize/canvas height are positive).
  const surfaceScale = canvasH > 0 ? surfaceH / canvasH : 1;

  // Font size: (fontSize / canvasH) * surfaceH, floored at the 12px-canvas-floor
  // scaled to this surface (§5.2 / R5). Expressing the floor as `12 * surfaceScale`
  // keeps it a LINEAR function of the surface, so preview and export floors are the
  // same composition at different scale — the floor stops being a parity hazard.
  const fontPx = Math.max(
    Math.round(FONT_PX_FLOOR * surfaceScale),
    Math.round(style.fontSize * surfaceScale),
  );

  // Outline width: authored in canvas pixel space (the canvas uses it raw as
  // `lineWidth`); scale it to the surface by the same factor as the font (§7.4). 0 or
  // absent ⇒ no border.
  const rawOutline = style.outline && style.outline.width > 0 ? style.outline.width : 0;
  const borderPx = rawOutline > 0 ? Math.round(rawOutline * surfaceScale) : 0;

  // Inter-line spacing for multi-line text (§6.3): the EXTRA gap above one font height,
  // i.e. round(fontPx * (lineHeight - 1)). lineHeight defaults to 1.2 on both sides.
  const lineHeight = style.lineHeight ?? DEFAULT_LINE_HEIGHT;
  const lineSpacing = Math.max(0, Math.round(fontPx * (lineHeight - 1)));

  // Horizontal anchor (matches the canvas `tx`).
  const anchorX =
    style.align === "left" ? boxX : style.align === "right" ? boxX + boxW : boxX + boxW / 2;

  return { boxX, boxY, boxW, boxH, fontPx, borderPx, lineSpacing, anchorX };
}

// ─────────────────────────────────────────────────────────────────────────────
// Weight → Inter static-TTF face (spec §4.2 / R2).
//
// The browser canvas hardcodes `Inter, sans-serif` and, asked for an arbitrary
// fontWeight, lets the browser pick the NEAREST loaded weight from the five faces
// the Google-Fonts <link> loads: 400 / 500 / 600 / 700 / 800. The export reproduces
// that nearest-weight selection by bucketing fontWeight into the same five static
// Inter masters. THE BUCKET BOUNDARIES ARE PART OF THE CONTRACT and MUST be applied
// identically on both sides — which is why this lives in the shared package.
//
//   weight ≤ 450            → Regular   (400)
//   450 < weight ≤ 550      → Medium    (500)
//   550 < weight ≤ 650      → SemiBold  (600)
//   650 < weight ≤ 750      → Bold      (700)
//   weight > 750            → ExtraBold (800)
//
// `style.italic === true` selects the matching Italic face in the same bucket.
//
// Returns the BARE FILE BASENAME (e.g. "Inter-SemiBold.ttf") — NOT an absolute path.
// `buildFilterComplex` stays pure (no fs): it emits a `font:Inter-SemiBold.ttf`
// token and the render worker prefixes `${INTER_FONT_DIR}` to get the real path,
// exactly as it resolves `watermark:`/`subtitles:` tokens.
// ─────────────────────────────────────────────────────────────────────────────

/** Inter static faces bundled in the render-worker image (spec §4.2). */
export type InterFace =
  | "Regular"
  | "Medium"
  | "SemiBold"
  | "Bold"
  | "ExtraBold";

/** Bucket a numeric font weight into one of the five bundled Inter faces (§4.2). */
export function weightToInterFace(fontWeight: number): InterFace {
  if (fontWeight <= 450) return "Regular";
  if (fontWeight <= 550) return "Medium";
  if (fontWeight <= 650) return "SemiBold";
  if (fontWeight <= 750) return "Bold";
  return "ExtraBold";
}

/**
 * Map a font weight (+ optional italic) to the bundled Inter static-TTF FILE BASENAME
 * (e.g. `Inter-SemiBold.ttf`, `Inter-BoldItalic.ttf`). See the bucket table above.
 * The render worker resolves the basename to `${INTER_FONT_DIR}/<basename>`.
 */
export function weightToInterFile(fontWeight: number, italic = false): string {
  const face = weightToInterFace(fontWeight);
  // Inter italic faces are named "<Face>Italic", with the Regular italic being just
  // "Italic" (there is no "RegularItalic" in the Inter release).
  if (italic) {
    return face === "Regular" ? "Inter-Italic.ttf" : `Inter-${face}Italic.ttf`;
  }
  return `Inter-${face}.ttf`;
}
