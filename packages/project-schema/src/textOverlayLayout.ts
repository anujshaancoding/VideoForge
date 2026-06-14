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

// ─────────────────────────────────────────────────────────────────────────────
// TEXT METRICS — the underline-rule subsystem (the queued underline milestone).
//
// THE PROBLEM (company/DECISIONS.md 2026-06-10): FFmpeg `drawtext` has NO underline.
// To honour the invariant (preview == export, frame-for-frame) we draw the underline
// as a FILLED RULE (a box/line) under the glyphs. The rule's WIDTH must be the rendered
// text width — but the two renderers measure text differently: the browser exposes
// `ctx.measureText`, FFmpeg exposes `text_w`, and the two do NOT agree at the pixel
// level (and `text_w` is only available inside drawtext's own expression evaluator,
// not as a number we can hand to a `drawbox`). If preview used `measureText` and the
// export used `text_w`, the underline geometry would diverge → a preview≠export lie,
// which the invariant forbids.
//
// THE FIX: ONE shared text-metrics function — `measureTextWidth` — computes the width
// from an Inter advance-width table that lives HERE, in the shared package, so BOTH
// sides compute the SAME width from the SAME table. `underlineRule` then derives the
// box geometry (x, y, width, thickness) from that width + the shared `TextLayout`.
// Preview draws a filled rect at that geometry; export emits a `drawbox` at the same
// geometry. They agree BY CONSTRUCTION, exactly like `layoutTextOverlay` does for the
// glyphs themselves.
//
// ACCURACY CAVEAT (honest): the table is an EM-normalised advance-width APPROXIMATION
// for the bundled Inter faces — not the exact per-glyph hinted advances libfreetype /
// Skia produce. So the underline width will not match the glyph run to the sub-pixel.
// That is acceptable per the milestone rule: a consistent-but-slightly-imperfect
// underline (identical on BOTH sides) is fine; a preview≠export underline is not. The
// rule is centred under the run (left edge offset from the anchor by the same shared
// math on both sides), so any small width error is symmetric and identical in preview
// and export. Kerning and the weight axis are not modelled beyond the per-weight scale
// factor below; the visible effect on a horizontal rule is negligible.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Inter advance widths, normalised to the em (1.0 = one font-size unit), measured from
 * the upright Inter Regular face. Covers ASCII; unlisted code points fall back to
 * {@link DEFAULT_ADVANCE_EM} (≈ a lowercase-letter advance). These are a compact
 * approximation — see the ACCURACY CAVEAT above — but they are the SAME numbers on
 * both the preview and export sides, which is the property the invariant needs.
 */
const INTER_ADVANCE_EM: Readonly<Record<string, number>> = {
  " ": 0.282,
  "!": 0.291,
  '"': 0.401,
  "#": 0.636,
  $: 0.575,
  "%": 0.804,
  "&": 0.668,
  "'": 0.235,
  "(": 0.35,
  ")": 0.35,
  "*": 0.453,
  "+": 0.596,
  ",": 0.273,
  "-": 0.341,
  ".": 0.273,
  "/": 0.385,
  "0": 0.575,
  "1": 0.575,
  "2": 0.575,
  "3": 0.575,
  "4": 0.575,
  "5": 0.575,
  "6": 0.575,
  "7": 0.575,
  "8": 0.575,
  "9": 0.575,
  ":": 0.273,
  ";": 0.273,
  "<": 0.596,
  "=": 0.596,
  ">": 0.596,
  "?": 0.483,
  "@": 0.876,
  A: 0.654,
  B: 0.641,
  C: 0.668,
  D: 0.696,
  E: 0.595,
  F: 0.573,
  G: 0.71,
  H: 0.722,
  I: 0.27,
  J: 0.514,
  K: 0.642,
  L: 0.555,
  M: 0.876,
  N: 0.736,
  O: 0.741,
  P: 0.627,
  Q: 0.741,
  R: 0.652,
  S: 0.612,
  T: 0.6,
  U: 0.711,
  V: 0.642,
  W: 0.93,
  X: 0.634,
  Y: 0.61,
  Z: 0.616,
  "[": 0.35,
  "\\": 0.385,
  "]": 0.35,
  "^": 0.596,
  _: 0.45,
  "`": 0.4,
  a: 0.564,
  b: 0.6,
  c: 0.532,
  d: 0.6,
  e: 0.563,
  f: 0.354,
  g: 0.6,
  h: 0.593,
  i: 0.25,
  j: 0.25,
  k: 0.545,
  l: 0.25,
  m: 0.901,
  n: 0.593,
  o: 0.586,
  p: 0.6,
  q: 0.6,
  r: 0.383,
  s: 0.508,
  t: 0.367,
  u: 0.593,
  v: 0.529,
  w: 0.79,
  x: 0.534,
  y: 0.529,
  z: 0.498,
  "{": 0.35,
  "|": 0.27,
  "}": 0.35,
  "~": 0.596,
};

/** Advance for code points missing from {@link INTER_ADVANCE_EM} (≈ a lowercase letter). */
export const DEFAULT_ADVANCE_EM = 0.575;

/**
 * Per-weight horizontal scale on the Regular advances — heavier faces are slightly
 * wider. Keyed by the bucketed Inter face (so it matches `weightToInterFace`, the same
 * bucketing the export uses to pick the TTF). Approximate, identical on both sides.
 */
const FACE_ADVANCE_SCALE: Readonly<Record<InterFace, number>> = {
  Regular: 1.0,
  Medium: 1.012,
  SemiBold: 1.028,
  Bold: 1.045,
  ExtraBold: 1.062,
};

/**
 * Width of `text` rendered as Inter at `fontPx` and the given numeric `fontWeight`, in
 * pixels on the SAME surface `fontPx` is for. THE shared measurer — the preview and the
 * export both call this so the underline rule width is identical by construction.
 *
 * For multi-line text the width is the WIDEST line (the rule is drawn per line by the
 * callers; this helper measures one line's run when given a single line, and the widest
 * when given a `\n`-joined block — callers split first and measure per line).
 *
 * @param text     a single line of text (callers split on "\n" and measure each line).
 * @param fontPx   the rendered font size in px on the target surface.
 * @param fontWeight numeric weight; bucketed to a face via `weightToInterFace`.
 */
export function measureTextWidth(text: string, fontPx: number, fontWeight: number): number {
  const scale = FACE_ADVANCE_SCALE[weightToInterFace(fontWeight)];
  let em = 0;
  for (const ch of text) {
    em += INTER_ADVANCE_EM[ch] ?? DEFAULT_ADVANCE_EM;
  }
  return em * fontPx * scale;
}

/** Underline-rule box geometry (px on the target surface), per drawn line. */
export interface UnderlineRule {
  /** Box left edge (px). */
  x: number;
  /** Box top edge (px) — the underline sits below the glyph baseline. */
  y: number;
  /** Box width (px) = measured text width of the line. */
  width: number;
  /** Box height (px) = underline thickness. */
  height: number;
}

/**
 * Fraction of the font size the underline sits BELOW the text's vertical CENTRE
 * (`textBaseline="middle"` in the canvas; the export centres the block the same way).
 * Inter's baseline is ≈ 0.27·em below the centre of the cap-band; the underline then
 * sits a little below the baseline. ~0.34·em places the rule just under the descender
 * line, matching the visual a browser draws. Identical on both sides.
 */
export const UNDERLINE_OFFSET_EM = 0.34;

/** Underline thickness as a fraction of the font size (Inter's underline weight ≈ 0.06·em). */
export const UNDERLINE_THICKNESS_EM = 0.06;

/**
 * Compute the underline rule for ONE line of text, given the shared {@link TextLayout},
 * the line's vertical centre (`lineCenterY`, where the canvas draws it with
 * `textBaseline="middle"`), the line text, and the numeric weight.
 *
 * The width comes from {@link measureTextWidth}; the horizontal position is derived from
 * the SAME `align` anchor the glyphs use (`layout.anchorX`), so the rule sits exactly
 * under the run. Both the preview (filled rect) and the export (`drawbox`) call this and
 * draw the returned box — so they agree by construction (the invariant).
 *
 * @param layout      the shared layout for the overlay (anchorX, fontPx).
 * @param align       horizontal alignment (decides the rule's left edge from anchorX).
 * @param lineCenterY the y the line's text is centred on (canvas `textBaseline="middle"`).
 * @param line        the single line's text.
 * @param fontWeight  numeric weight (bucketed for the advance scale).
 */
export function underlineRule(
  layout: Pick<TextLayout, "anchorX" | "fontPx">,
  align: "left" | "center" | "right",
  lineCenterY: number,
  line: string,
  fontWeight: number,
): UnderlineRule {
  const width = measureTextWidth(line, layout.fontPx, fontWeight);
  // Left edge from the SAME anchor the glyphs use: left → at anchor; center → centred on
  // anchor; right → ending at anchor. This mirrors canvas `textAlign` and the export's
  // x-expression, so the rule tracks the run on both sides.
  const x =
    align === "left"
      ? layout.anchorX
      : align === "right"
        ? layout.anchorX - width
        : layout.anchorX - width / 2;
  const height = Math.max(1, Math.round(layout.fontPx * UNDERLINE_THICKNESS_EM));
  const y = Math.round(lineCenterY + layout.fontPx * UNDERLINE_OFFSET_EM);
  return { x: Math.round(x), y, width: Math.round(width), height };
}
