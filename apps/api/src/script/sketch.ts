// ─────────────────────────────────────────────────────────────────────────────
// Script Studio v2 — sketch post-filter (the style + consistency lever).
//
//   applySketch(srcPath, style, dstPath, target?) -> writes a PNG sketch of srcPath
//
// A PURE, DETERMINISTIC image transform (sharp/libvips, no model, no rng, no
// network): identical input bytes ⇒ identical output, so sketch outputs are
// golden-testable. Running EVERY scene image through one uniform filter is what
// makes 30-40 independently-generated images read as one consistent hand —
// papering over base-model drift (see docs/Script_Studio_v2_Research_Tech.md).
//
// RESOLUTION: when `target` is given, the source is first resized (cover, lanczos3)
// to the export canvas size BEFORE filtering — so the frame fills a 1080×1920 video
// crisply (line art in particular thresholds razor-sharp at full res) instead of
// being a small square upscaled at export time.
//
// Three styles, all derived from the same graphite "dodge" sketch:
//   graphite — soft pencil shading (grayscale colour-dodge)
//   pen      — black ink line art (threshold of the dodge sketch)   ← default
//   color    — colored-pencil (original colour × deepened sketch × ink lines)
// ─────────────────────────────────────────────────────────────────────────────

import sharp from 'sharp';

export type SketchStyle = 'graphite' | 'pen' | 'color';

export const SKETCH_STYLES: readonly SketchStyle[] = ['graphite', 'pen', 'color'];

/** Default style (CEO pick 2026-06-16): pen ink line art — cleanest, most forgiving. */
export const DEFAULT_SKETCH_STYLE: SketchStyle = 'pen';

export interface SketchTarget {
  width: number;
  height: number;
}

export function isSketchStyle(v: unknown): v is SketchStyle {
  return typeof v === 'string' && (SKETCH_STYLES as readonly string[]).includes(v);
}

/** Load the source as RGB, optionally resized (cover) to the export canvas size. The
 *  shared base buffer every style derives from — one decode + one resize per image. */
async function loadBase(srcPath: string, target?: SketchTarget): Promise<Buffer> {
  let img = sharp(srcPath);
  if (target) {
    img = img.resize(target.width, target.height, { fit: 'cover', kernel: 'lanczos3' });
  }
  return img.removeAlpha().toColourspace('srgb').png().toBuffer();
}

/**
 * The graphite "dodge" sketch (grayscale), basis for every style:
 * gray ÷ (1 − blur(invert(gray)))  →  light paper with pencil strokes.
 */
async function dodgeGray(baseBuf: Buffer, sigma: number): Promise<Buffer> {
  const gray = await sharp(baseBuf).greyscale().toBuffer();
  const blurInv = await sharp(gray).negate().blur(sigma).toBuffer();
  return sharp(gray).composite([{ input: blurInv, blend: 'colour-dodge' }]).toBuffer();
}

/**
 * Render `srcPath` as a sketch in `style` and write a PNG to `dstPath`. If `target`
 * is given, output is exactly that size (cover). Deterministic. Throws on unreadable
 * input (caller treats as a real I/O error).
 */
export async function applySketch(
  srcPath: string,
  style: SketchStyle,
  dstPath: string,
  target?: SketchTarget,
): Promise<void> {
  const base = await loadBase(srcPath, target);

  if (style === 'graphite') {
    const sketch = await dodgeGray(base, 6);
    // gentle contrast so strokes read as graphite rather than washing out
    await sharp(sketch).linear(1.05, -6).png().toFile(dstPath);
    return;
  }

  if (style === 'pen') {
    // Ink line art = threshold the dodge sketch: paper → white, strokes → black.
    const sketch = await dodgeGray(base, 5);
    await sharp(sketch).blur(0.5).threshold(238).png().toFile(dstPath);
    return;
  }

  // color: original colour, paper-brightened, multiplied by a contrast-deepened
  // graphite sketch, with the ink lines multiplied on top for definition.
  const sketch = await dodgeGray(base, 6);
  const sketchDeep = await sharp(sketch).linear(1.4, -45).toColourspace('srgb').toBuffer();
  const ink = await sharp(sketch).blur(0.5).threshold(238).toColourspace('srgb').toBuffer();
  await sharp(base)
    .modulate({ brightness: 1.08, saturation: 1.4 })
    .composite([
      { input: sketchDeep, blend: 'multiply' },
      { input: ink, blend: 'multiply' },
    ])
    .png()
    .toFile(dstPath);
}
