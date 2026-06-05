# VideoForge — Text-Overlay Export Spec (drawtext parity)

**Author:** Forge (Principal Engineer / Architect) · **Date:** 2026-06-04
**Status:** Design — approved to build (CEO) · **Type:** Spec only (no implementation in this doc)
**Owner of the surface:** Reel (export graph) · **Guarded by:** Forge (invariant)
**Parent docs / source of truth:**
`packages/project-schema/src/types.ts` (§ TextOverlay / TextStyle / OverlayBase),
`apps/web/src/engine/PreviewEngine.ts` (`_drawOverlays`),
`apps/web/src/components/editor/CanvasStage.tsx` (viewport/backing-store math),
`packages/ffmpeg-graph/src/buildFilterComplex.ts` (overlay skip header ~line 25; captions→`subtitles` path; `clipBox`; `msToSec`).

---

## 0. Mandate & the invariant

The CEO approved rendering text overlays into the exported MP4 so that **text shown in the preview canvas also appears in the export, matching frame-for-frame**. This extends the load-bearing product invariant — *what you cut is what you get* — to the text-overlay surface.

Today, text overlays are **preview-only**. `buildFilterComplex.ts` (header, lines 22–27) explicitly states:

> "Solid `drawtext`-able text and image overlays are also out of the M0 spine here (the editor-shell CanvasStage renders them in preview). Captions are the proven text→export parity surface (§22.3)."

This spec defines the canonical **`TextOverlay` → FFmpeg `drawtext`** mapping that closes that gap. The non-negotiable acceptance criterion: a frame extracted from the export at time *t* is SSIM/PSNR-indistinguishable (within the §22.3 golden thresholds) from the preview canvas at the same *t*, for text content, font, size, position, colour, weight, opacity, outline, and timing.

**Scope (in):** Solid-fill `TextOverlay` (the `kind: "text"` overlay) — text, geometry, fontSize, fontWeight, color, align, opacity, outline, timing, multi-line.
**Scope (out, this wave):** gradient text fill, per-character `letterSpacing`, `shadow` blur, `backgroundColor` box, `rotation ≠ 0`, entrance/exit `animation`, keyframed geometry. These are listed in §9 (Deferred) with the rule the builder must follow when it meets them (rasterise-or-omit, never silently mis-render). Image/shape/lottie/sticker overlays remain out of scope (separate rasterise-PNG path, §10.3 of the main spec).

---

## 1. Source of truth: the data model

From `packages/project-schema/src/types.ts`. A `TextOverlay extends OverlayBase`:

| Field | Type / units | Notes |
|---|---|---|
| `kind` | `"text"` | Discriminator. |
| `text` | `string` | Raw text. **May contain `\n`** (multi-line). |
| `startOnTimeline` | `Millis` (int ms) | Timeline-relative. |
| `endOnTimeline` | `Millis` (int ms) | Exclusive end (preview uses `>= start && < end`). |
| `canvasX` | `Percent` 0–100 | **Top-left** anchor X, % of canvas width. |
| `canvasY` | `Percent` 0–100 | **Top-left** anchor Y, % of canvas height. |
| `width` | `Percent` 0–100 | Box width, % of canvas width. |
| `height` | `Percent` 0–100 | Box height, % of canvas height. |
| `rotation` | degrees | **0 for this wave** (see §9). |
| `opacity` | 0–100 | Whole-overlay alpha. |
| `style.fontFamily` | `string` | **See §2 — the canvas IGNORES this and renders Inter.** |
| `style.fontSize` | number, "logical px at canvas resolution" | i.e. px at `canvas.width × canvas.height`. |
| `style.fontWeight` | number (e.g. 400/600/700) | Mapped to a weight-specific Inter TTF (§4.2). |
| `style.italic?` | boolean | Maps to Inter Italic face if set (§4.2). |
| `style.color` | `HexColor` `#RRGGBB[AA]` | Solid fill. |
| `style.align` | `"left"\|"center"\|"right"` | Horizontal anchor within the box. |
| `style.lineHeight?` | number | Multiplier; default per §6. |
| `style.outline?` | `{ width, color, position }` | Stroke. Default new overlay: `{width:2, color:"#000000", position:"outside"}`. |
| `style.gradient?`, `style.letterSpacing?`, `style.shadow?`, `style.backgroundColor?` | — | **Deferred (§9).** |

Default new overlay (`editorStore.addTextOverlay`, lines 995–1018) — the canonical example used throughout this spec:

```
canvasX: 5, canvasY: 80, width: 90, height: 15, rotation: 0, opacity: 100
text: <user text>
style: { fontFamily: "sans-serif", fontSize: 48, fontWeight: 600,
         color: "#FFFFFF", align: "center",
         outline: { color: "#000000", width: 2, position: "outside" } }
```

> Note the default `fontFamily` is the string `"sans-serif"`, **not** `"Inter"`. This is harmless today only because the canvas hardcodes Inter (§2). The export MUST use the same resolution rule, or preview and export will diverge for every existing overlay. This is the single highest-risk parity trap and is treated as **Risk R1** (§8).

---

## 2. What the canvas ACTUALLY renders (ground truth we must match)

`PreviewEngine._drawOverlays` (lines 395–445) is the authority. Export must match **this code**, not the data model's nominal fields. The exact behaviour:

```js
// per visible text overlay:
const x  = (ov.canvasX / 100) * w;     // w,h = canvas BACKING-STORE px (see §3)
const y  = (ov.canvasY / 100) * h;
const bw = (ov.width   / 100) * w;
const bh = (ov.height  / 100) * h;
ctx.globalAlpha = clamp(ov.opacity / 100, 0, 1);

const size = Math.max(12, (style.fontSize / project.canvas.height) * h);
ctx.fillStyle = style.color || "#FFFFFF";
ctx.font = `${style.fontWeight || 600} ${size}px Inter, sans-serif`;   // <-- font family HARDCODED
ctx.textAlign   = align === "right" ? "right" : align === "left" ? "left" : "center";
ctx.textBaseline = "middle";
const tx = align === "left" ? x : align === "right" ? x + bw : x + bw/2;
if (outline && outline.width > 0) {
  ctx.lineWidth   = outline.width;
  ctx.strokeStyle = outline.color;
  ctx.strokeText(text, tx, y + bh/2);   // stroke UNDER fill, full lineWidth (center-stroked)
}
ctx.fillText(text, tx, y + bh/2);       // single call — NO wrapping, NO \n handling
```

Seven facts the export mapping is built on:

1. **Font family is hardcoded to `Inter, sans-serif`.** `style.fontFamily` is never read. Whatever the data says, the canvas draws **Inter** (falling back to the platform sans only if Inter failed to load — which on a supported Chrome/Edge desktop with the Google-Fonts `<link>` it does not). **Export must therefore render Inter, ignoring `fontFamily`, for byte-parity with the current canvas.**
2. **Font size** = `(style.fontSize / canvas.height) * h`, floored at 12px, where `h` is the **backing-store height** (§3), NOT `canvas.height`. So `fontSize` is interpreted as px-at-full-canvas-height and linearly rescaled to whatever surface it is drawn on. The export draws at full render height, so the scale is exact (§5).
3. **Vertical anchor is the box center**, via `textBaseline="middle"` at `y + bh/2`. The text is **not** top-aligned in the box; it is centered on the box's vertical midpoint.
4. **Horizontal anchor depends on `align`**: left → box left edge (`x`); center → box horizontal center (`x + bw/2`); right → box right edge (`x + bw`).
5. **Outline**: `strokeText` is drawn **before** `fillText` (so the fill sits on top), with `lineWidth = outline.width`. Canvas strokes are **center-aligned** on the glyph path (half inside, half outside) regardless of `outline.position`. The `position` field is currently ignored by the canvas.
6. **No wrapping, no newline handling.** It is a single `fillText(text, …)`. The browser's `fillText` renders `\n` as a single un-rendered control (no line break). So today, a multi-line overlay shows as **one line** in preview. The export must reproduce whatever the canvas does (§6 defines the chosen, slightly-improved behaviour and the canvas change that keeps both sides identical).
7. **Opacity** is `globalAlpha` applied to both stroke and fill.

---

## 3. The coordinate frame: backing store vs render resolution

`CanvasStage` (lines 117–123) sizes the canvas backing store:

```js
const scale = Math.min(1, 720 / Math.max(canvasW, canvasH));
canvas.width  = round(canvasW * scale);   // = w in PreviewEngine
canvas.height = round(canvasH * scale);   // = h in PreviewEngine
```

So for a 1080×1920 project, `scale = 720/1920 = 0.375`, and the preview backing store is **405×720**. The CSS then stretches that to the on-screen viewport, but **all of the engine's pixel math runs in the 405×720 space.**

This is the key insight that makes parity *exact rather than approximate*: **every quantity the canvas computes is a pure linear function of the project's percent/logical inputs and the surface dimensions.** Because the export renders at the full project resolution `Rh × Rw` and the preview renders at `scale·canvasH × scale·canvasW` (same aspect ratio, uniform scale `scale`), every derived pixel value differs only by the constant factor `scale`:

- position: `x_preview = (canvasX/100)·(scale·canvasW)` and `x_export = (canvasX/100)·Rw`.
- size: `size_preview = (fontSize/canvasH)·(scale·canvasH) = fontSize·scale` (ignoring the 12px floor); `size_export = (fontSize/canvasH)·Rh`.

When the export resolution equals the project canvas (`Rw=canvasW, Rh=canvasH`) the two are related by exactly `scale`. When they differ (e.g. project canvas 1080×1920 but export downscaled to a smaller preset), the same percent formulas still hold against the **export** resolution, which is what the user will receive — the preview is just a smaller-but-geometrically-identical view of the same composition. **Conclusion: the export expresses geometry against the render resolution `(Rw, Rh)` using the identical percent formulas; uniform scale guarantees frame-for-frame parity.** (See §8 R1/R5 for the floor and downscale caveats.)

> Throughout the rest of this spec, **`Rw`/`Rh`** = the export render resolution in pixels (e.g. 1080/1920), `Ch` = `project.canvas.height` (the logical height the `fontSize` is authored against).

---

## 4. Font: the exact TTF that must be bundled

### 4.1 Decision

**The canvas renders Inter** (hardcoded, §2.1), loaded in the browser from Google Fonts via `apps/web/index.html` (`family=Inter:wght@400;500;600;700;800`). The export must render the **same Inter glyph outlines**. Therefore:

> **Bundle the official Inter static TTFs in the render-worker image and point `drawtext fontfile=` at the weight-matched file.**

We bundle **Inter**, vendored at a pinned version, as **static per-weight TTF files** (not the variable font, not `fontconfig` family lookup). Rationale:
- **Determinism over convenience.** `drawtext` with an explicit `fontfile=/abs/path.ttf` is reproducible and independent of any system `fontconfig` cache. Using `font=Inter` (family name) would depend on fontconfig state inside the image and is a silent-drift hazard for goldens.
- **Variable-font weight axis is a parity hazard.** libfreetype/`drawtext` instancing of a variable font's `wght` axis is not guaranteed to match Chrome's variable-font rendering. Static per-weight masters remove that variable.
- **Inter, not "a similar sans".** The canvas literally draws Inter; any substitute font (DejaVu Sans, Liberation Sans — the distro defaults that ship in `node:20-bookworm-slim`) has different glyph outlines and metrics and would fail the golden gate.

### 4.2 Files to bundle and the weight→file map

Vendor the Inter **hinted static OTC/TTF** release (pin a specific Inter version, e.g. Inter 4.x, recorded in the PR). Place under a stable path in the image, e.g. `/usr/share/fonts/inter/`:

| Inter face | File | Selected when |
|---|---|---|
| Regular | `Inter-Regular.ttf` | weight ≤ 450, not italic |
| Medium | `Inter-Medium.ttf` | 450 < weight ≤ 550 |
| SemiBold | `Inter-SemiBold.ttf` | 550 < weight ≤ 650 |
| Bold | `Inter-Bold.ttf` | 650 < weight ≤ 750 |
| ExtraBold | `Inter-ExtraBold.ttf` | weight > 750 |
| Italic variants | `Inter-Italic.ttf`, `Inter-MediumItalic.ttf`, … | `style.italic === true` (same weight buckets) |

The bucket boundaries mirror the five weights the browser actually has available (`400;500;600;700;800` from the Google-Fonts `<link>`). The canvas, asked for an arbitrary `fontWeight`, lets the browser pick the **nearest available** loaded weight; the export's bucketing reproduces that nearest-weight selection. **The boundaries above are part of the contract and MUST be implemented identically on both sides** (see §7 / Risk R2).

> Files bundled: a minimum of `Inter-Regular`, `Inter-Medium`, `Inter-SemiBold`, `Inter-Bold`, `Inter-ExtraBold` (the five `<link>` weights), plus their Italic counterparts. Total ~2–3 MB; committed to the worker build context or fetched at image-build time from a pinned Inter release URL (mirror the FFmpeg-pin approach in the Dockerfile, lines 14–29).

### 4.3 Where bundled

In `apps/render-worker/Dockerfile`, after the FFmpeg install block:
- `COPY` the vendored `apps/render-worker/assets/fonts/inter/*.ttf` into `/usr/share/fonts/inter/` (vendoring the TTFs in-repo is preferred over a network fetch, for build determinism — same reasoning the golden gate pins FFmpeg).
- The graph builder emits an **absolute fontfile path token** (mirroring `asset:`/`watermark:` tokens); the worker substitutes the real path from an env var `INTER_FONT_DIR` (default `/usr/share/fonts/inter`). This keeps `buildFilterComplex` pure (no fs) — identical to how `watermark:vf` is resolved in `worker.ts`.

---

## 5. Position & size mapping (the math)

### 5.1 Geometry → export pixels

Let an overlay have `canvasX, canvasY, width, height` (percent). Define box, in export px:

```
boxX = round( (canvasX / 100) * Rw )
boxY = round( (canvasY / 100) * Rh )
boxW = round( (width    / 100) * Rw )
boxH = round( (height   / 100) * Rh )
```

### 5.2 Size

```
fontPx = max( 12 * (Rh / (scalePreviewToCanvas)) ... )   ← see note
```

Practically, since the canvas computes `size = (fontSize / Ch) * h_backing` and the export draws at full height, the export font size in pixels is:

```
fontPx = round( (style.fontSize / Ch) * Rh )
```

When `Rh == Ch` (the common case: export at project resolution) this is just `style.fontSize`. The **12px floor** in the canvas (`Math.max(12, …)`) is in *backing-store* px; to reproduce parity the export must apply the floor scaled to render resolution: `fontPx = max( round(12 * Rh / (scale·Ch)), round((fontSize/Ch)*Rh) )` — but because `scale = min(1, 720/max(Cw,Ch))`, the cleanest equivalent is to **mirror the canvas exactly**: compute the floor against the *same* surface. To avoid a second formula on the export side, §7 mandates a **shared helper** that takes `(fontSize, Ch, surfaceH)` and returns the pixel size; preview calls it with `surfaceH = h_backing`, export calls it with `surfaceH = Rh`. (See Risk R5 — the floor is the one nonlinearity; the shared helper neutralises it.)

`drawtext` uses **fontsize in pixels** directly: `fontsize=<fontPx>`.

### 5.3 Anchor → `drawtext` x/y expressions

`drawtext` positions text by the **top-left of the rendered text box**, and exposes `text_w`/`text_h` (rendered text metrics) and `line_h`. The canvas anchors by `textAlign` (horizontal) and `textBaseline="middle"` (vertical center of the box). We translate:

**Vertical (always, all alignments):** canvas draws the text vertically centered on `boxY + boxH/2`. drawtext top-left y must therefore be:

```
y = (boxY + boxH/2) - text_h/2
```
→ `y='${boxY} + ${boxH}/2 - text_h/2'`  (with boxY, boxH as integer literals)

**Horizontal, by `align`:**

| align | canvas anchor | drawtext `x` expression |
|---|---|---|
| `left` | left edge `boxX`, left-anchored | `x=${boxX}` |
| `center` | center `boxX + boxW/2`, center-anchored | `x='${boxX} + ${boxW}/2 - text_w/2'` |
| `right` | right edge `boxX + boxW`, right-anchored | `x='${boxX} + ${boxW} - text_w'` |

These expressions reproduce, exactly, `tx` and `y + bh/2` + `textAlign`/`textBaseline="middle"` from the canvas.

> **Multi-line note:** when the text has N lines (§6), `text_h` is the full block height across all lines, so `(boxY+boxH/2) - text_h/2` vertically centers the **whole block** on the box midpoint — matching a canvas that draws the block centered (the canvas change in §6.2 centers the block the same way). For horizontal centering of a multi-line block, drawtext centers **each line independently** within `text_w` only if `text_align` is set; see §6.3.

---

## 6. Multi-line / wrapping

### 6.1 The problem

`drawtext` does **not** auto-wrap. The canvas (§2.6) also does **not** wrap and does not even break on `\n` (single `fillText`). So three behaviours are possible: (a) match the canvas's current broken behaviour (everything on one line, `\n` dropped) — faithful but a poor product; (b) honour explicit `\n` in `text` as hard line breaks on both sides; (c) auto-wrap to the box width on both sides.

### 6.2 Decision: honour explicit `\n` (option b), and fix the canvas to match

We choose **(b): explicit newlines are hard breaks; no auto-wrap in this wave.** Rationale: it is deterministic, requires no font-metrics measurement in the pure graph builder, and is trivially reproducible by `drawtext`. Auto-wrap (c) is deferred (§9) because pixel-identical wrapping requires the builder to measure Inter glyph advances — a font-metrics dependency we will not put in the pure, fs-free graph package this wave.

This requires a **small, surgical canvas change** (Pixel task, §11.2): `PreviewEngine._drawOverlays` must split `text` on `\n` and draw each line, vertically centering the block on `boxY + boxH/2` using `lineHeight` (default `1.2`). Without this change, preview shows one line and export shows N lines → parity breaks. **This is the only required preview change.** (Spec'd precisely in §11.2.)

### 6.3 Mapping to `drawtext`

`drawtext` renders embedded newlines when the text contains them. Two requirements:

1. **Pre-process `text`:** the builder splits on `\n` and **re-joins with the drawtext-escaped newline** so a single `drawtext` call renders the block. drawtext interprets a literal backslash-n in the text as a line break when the text is provided inline; the builder emits each `\n` as an escaped newline (see §7 escaping). For >1 line, prefer the **`textfile=`** approach (§7.4) to sidestep inline-escaping fragility — the worker writes the (already line-split) text to a temp file, exactly as it writes the SRT today (`worker.ts` writes `captionsToSrt`).
2. **`line_spacing`:** set `line_spacing = round(fontPx * (lineHeight - 1))` so inter-line gap matches the canvas's `lineHeight` (default `1.2`). With `lineHeight=1.2` and `fontPx=48`, `line_spacing = round(48*0.2) = 10`.
3. **Per-line horizontal alignment:** set drawtext `text_align` to match `align` (`L`/`C`/`R` within the box). The x/y expressions in §5.3 position the block; `text_align` aligns ragged lines inside it. (If the installed FFmpeg build predates `text_align`, fall back to single-line only and defer multi-line — but 6.1.1, the pinned build, supports it.)

> The canvas change in §11.2 and the `line_spacing`/`text_align` here MUST use the **same** `lineHeight` default (`1.2`) and the same split rule (`text.split("\n")`, no trimming) so the line boxes coincide.

---

## 7. Escaping, weight mapping & the shared formula (the contract)

### 7.1 Text escaping — the load-bearing detail

`drawtext`'s text argument is parsed twice (filtergraph tokeniser, then drawtext's own expansion). The following characters in `TextOverlay.text` (and in `color`/`fontfile` values) MUST be escaped, in this order of concern:

| Char | Why | Handling |
|---|---|---|
| `\` (backslash) | drawtext escape char | escape first: `\` → `\\` |
| `'` (single quote) | filter-arg string delimiter | `'` → `\'` (and the whole value is NOT wrapped in additional quotes when using `textfile`) |
| `:` (colon) | option separator inside the filter | `:` → `\:` |
| `%` (percent) | drawtext `%{...}` expansion / strftime | `%` → `\%` (disable expansion) |
| `\n` (newline) | line break (see §6) | per §6.3: real newline in `textfile`, or escaped sequence inline |
| `,` `;` `[` `]` | filtergraph separators | only relevant inline; `textfile=` avoids these entirely |

**Decision: use `textfile=` for all non-trivial text** (anything with `:` `'` `%` `\` or a newline, i.e. the common case), so the *content* never passes through the filtergraph tokeniser at all — only the **filename** does, and the builder controls that (a fixed token like `overlaytext:<overlayId>.txt`). This is the same mechanism the captions path already trusts (`subtitles=...captions.srt`, `worker.ts` writes the file). Inline `text=` is reserved for the trivial alphanumeric case and still goes through the escape table above. This neutralises the entire class of escaping bugs (Risk R3).

> **Disable expansion:** always emit `expansion=none` on the drawtext filter (or rely on `textfile` + `%`-escaping). Either way, `%{...}` in user text must render literally, never expand.

### 7.2 Color & opacity

- `style.color` `#RRGGBB` → drawtext `fontcolor=0xRRGGBB`. If `#RRGGBBAA`, split alpha out (drawtext supports `fontcolor=0xRRGGBB@<a>` where `a∈[0,1]`).
- Whole-overlay `opacity` (0–100) multiplies into the alpha: `fontcolor=0xRRGGBB@${(opacity/100)*colorAlpha}`. Apply the **same** product to the outline color `bordercolor`. This reproduces the canvas `globalAlpha` (which scales both stroke and fill).

### 7.3 Weight → fontfile

Map `style.fontWeight` (and `style.italic`) to the bundled file via the **exact buckets in §4.2**. The builder emits a fontfile **token** (e.g. `font:Inter-SemiBold`); the worker substitutes `${INTER_FONT_DIR}/Inter-SemiBold.ttf`. Pure builder, no fs.

### 7.4 Outline (stroke)

Canvas: `strokeText` with `lineWidth = outline.width` (center-stroked) drawn under the fill. drawtext maps to:

```
borderw=<round(outline.width * Rh/h_surface_used_by_canvas)>   bordercolor=0x<outline.color>@<opacity>
```

`drawtext`'s `borderw` draws an **outset** border of the given pixel width; the canvas center-strokes (half the width visually outsets). For a `width:2` outline this is a ≤1px difference at preview scale and within the golden tolerance, but to be exact the spec mandates the **shared border-width helper** (§7.5) and notes the half-width nuance in Risk R4. (When `outline.width === 0` or absent, omit `borderw`.)

> **Stroke scaling:** `outline.width` is authored in the canvas's pixel space (it is used directly as `lineWidth` against the backing store). To match, it must be scaled to render resolution by the same factor as `fontPx`: `borderw = round(outline.width * Rh / Ch)` (since the canvas's `h_backing = scale·Ch` and export uses `Rh`, the ratio reduces to `Rh/Ch` after the shared helper accounts for `scale`). Put this in the shared helper too.

### 7.5 ONE shared formula (mandatory)

To guarantee the two sides cannot drift, **the percent→pixel, size, floor, and stroke-scale math live in ONE function exported from `packages/ffmpeg-graph`** (a pure helper, no fs), and the preview imports and calls it. Proposed surface:

```ts
// packages/ffmpeg-graph/src/textOverlayLayout.ts  (pure)
export interface TextLayout {
  boxX: number; boxY: number; boxW: number; boxH: number;  // px on the target surface
  fontPx: number;       // floored, scaled
  borderPx: number;     // scaled outline width
  lineSpacing: number;  // px gap between lines
  anchorX: number;      // px (left/center/right reference point)
}
export function layoutTextOverlay(
  ov: TextOverlay,
  surfaceW: number,   // preview: backing-store w; export: Rw
  surfaceH: number,   // preview: backing-store h; export: Rh
  canvasH: number,    // project.canvas.height (Ch) — fontSize reference
): TextLayout;
```

- **Preview** (`PreviewEngine._drawOverlays`) calls `layoutTextOverlay(ov, w, h, project.canvas.height)` and uses the returned px values instead of its inline arithmetic.
- **Export** (`buildFilterComplex`) calls `layoutTextOverlay(ov, Rw, Rh, project.canvas.height)` and feeds the px values into the `drawtext` expressions in §5.3 / §6.3.

Because both sides consume the same function, the 12px floor, the rounding, and the stroke/line-spacing scale are **identical by construction** — this is the structural mechanism that upholds the invariant for text overlays, exactly as the shared `buildExportCommand` upholds it for media clips. This is the single most important recommendation in this spec.

> **Helper home — verified import edges.** `apps/web/package.json` already depends on `@videoforge/project-schema` (`workspace:*`) but **NOT** on `@videoforge/ffmpeg-graph`. `ffmpeg-graph` itself already depends on `project-schema`. Therefore: **put `layoutTextOverlay()` + `weightToInterFile()` in `@videoforge/project-schema`** (both the preview and the graph builder already import it; no new dependency edge, no risk of pulling the whole graph builder into the web bundle). `buildFilterComplex` imports the same helper from `project-schema`. Either way: ONE function, both sides — but `project-schema` is the lower-risk home given the existing edges.

---

## 8. Parity risks & mitigations (what MUST be identical)

| # | Risk | Why it breaks parity | Mitigation (mandatory) |
|---|---|---|---|
| **R1** | **`fontFamily` ignored by canvas.** Data says `"sans-serif"`; canvas draws Inter. | If export reads `style.fontFamily` it would pick a different (or fontconfig-default) font → totally different glyphs. | Export **ignores `style.fontFamily`** and always uses bundled Inter (the weight-mapped file). Documented as the rule; enforced by golden fixture `overlay_text_default` whose data has `fontFamily:"sans-serif"` yet must render Inter. |
| **R2** | **Weight rounding.** Canvas asks browser for nearest *loaded* weight (400/500/600/700/800); export must pick the same bucket. | A `fontWeight:680` rendering as Inter-Bold in preview but Inter-SemiBold in export = visibly different stroke. | The §4.2 bucket boundaries are the contract; implement them in the **shared helper / a shared `weightToInterFile()`** so both sides bucket identically. |
| **R3** | **Text escaping.** `:`,`'`,`%`,`\`,newlines in user text. | Mis-escape → filtergraph parse error (export fails) or wrong text (e.g. `%{...}` expands to a timestamp). | Use **`textfile=`** for all non-trivial text (content bypasses the tokeniser) + `expansion=none`; escape table (§7.1) for the inline fast path. Fuzz fixture with `He said: "50% off" \ \n line2`. |
| **R4** | **Antialiasing / hinting / sub-pixel position.** Chrome (skia, `-webkit-font-smoothing:antialiased`, `text-rendering:optimizeLegibility`) vs libfreetype in `drawtext`. Sub-pixel glyph positions + grayscale-AA edges differ at the pixel level. | Hard edges/halos differ → low-level pixel diffs even when "the same". | (a) Same **Inter outlines** (identical vector source) removes the dominant term. (b) Goldens use **SSIM ≥ 0.985 / PSNR ≥ 38 dB** (§22.3), which tolerate sub-pixel AA differences — the gate is calibrated for exactly this. (c) Round positions to integer px on both sides (the shared helper rounds). (d) Outline: accept the center-stroke vs outset half-width nuance (≤1px) as within tolerance; if a fixture fails, switch the canvas to draw the stroke as an outset (double the lineWidth and clip) — **canvas-side change, specified as the fallback only if the golden fails.** |
| **R5** | **The 12px floor (nonlinearity).** `Math.max(12, …)` is the one place the size math is not a pure linear scale of inputs. | Tiny fonts (e.g. `fontSize:20` on a 1920-tall canvas → 7.5px backing → floored to 12px) scale differently between a 405-tall preview and a 1920-tall export. | The **shared helper** applies the floor against the surface it is told to render on; preview passes backing-store H, export passes `Rh`. Add a fixture with a sub-floor font to lock this. |
| **R6** | **Multi-line block centering & line spacing.** | If canvas centers the first baseline while drawtext centers the block, vertical offset diverges with line count. | §6.2 canvas change centers the **block**; §6.3 sets `line_spacing` and `text_align` from the **same** `lineHeight`; vertical y uses `text_h` (full block) on the export. Fixture `overlay_text_multiline`. |
| **R7** | **Inter version drift.** A different Inter release changes outlines/metrics. | Goldens shift silently if the bundled Inter version changes. | **Pin the Inter version** (vendored TTFs committed, or a pinned download URL), recorded in the PR — same discipline as the FFmpeg 6.1.1 pin. A bump is a reviewed event that regenerates goldens. |

**The non-negotiable "must be IDENTICAL on both sides" list:** (1) the font (Inter, same version); (2) the weight→face bucketing; (3) the percent→pixel + size + floor + stroke-scale formula (the shared helper); (4) the `lineHeight` default and `\n`-split rule; (5) the anchor convention (top-left box, vertical center, align-based horizontal). All five are enforced structurally by sharing code (R1, R2, R3, R5, R6) or by pinning (R7), not by parallel hand-written math.

---

## 9. Deferred sub-features — the rule the builder MUST follow

The builder must **never silently mis-render** a style it does not support. For each deferred field, when present and non-default, the builder either (a) rasterises the overlay to an RGBA PNG and composites via `overlay` (the §10.3 "real export" path the header anticipates), or (b) emits a clearly-marked comment and renders the supported subset, matching whatever the canvas currently does:

| Deferred field | This-wave behaviour | Future |
|---|---|---|
| `style.gradient` | Canvas already can't do gradient text in `drawtext`; preview path for gradient is the rasterise path. **For this wave, if `gradient` set, omit it and render solid `color`** (and the canvas must do the same, which it does — `_drawOverlays` ignores gradient). | Rasterise-to-PNG overlay. |
| `style.shadow` (blur) | Omit (drawtext has only a hard `shadowx/y`, no blur). Canvas ignores it today too. | Rasterise. |
| `style.backgroundColor` | Omit text box background. Canvas ignores it today. | drawtext `box=1:boxcolor=` (no blur) once the canvas draws it. |
| `style.letterSpacing` | Omit (drawtext has no per-char tracking). Canvas ignores it. | Rasterise or manual layout. |
| `rotation ≠ 0` | Not rendered (canvas doesn't rotate text either; matches). | `rotate`/PNG. |
| `animation` (in/out/loop), keyframed `canvasX`/`opacity` | Static for the overlay's full `[start,end)` window. Matches the canvas, which draws static overlays. | Per-frame `enable`/`alpha` expressions. |
| Auto-wrap to box width | Not done; explicit `\n` only (§6). | Font-metrics-driven wrap (out of the pure builder). |

The guiding rule (same as the existing header comment for image/lottie overlays): **honest omission with a comment beats inventing behaviour the preview doesn't have.** Parity holds because the canvas omits the same things.

---

## 10. The `drawtext` path in `buildFilterComplex` (where & how)

### 10.1 Where it slots into the graph

The overlay-text stage runs **after the video composite + captions, before/after the watermark**. Concretely, in `buildExportCommand` it is a new stage inserted **between §4 (captions `subtitles`) and §5 (watermark)** so text overlays sit **above** the video and captions but **below** the mandatory Free-tier watermark (the watermark must always win — §10.2 of the main spec). The chain becomes:

```
… → [baseLabel] (video composite, §3)
   → [vsub]     (captions burn, §4 — unchanged)
   → [vtext]    (NEW: drawtext per text overlay, §10.2)
   → [vout]     (watermark or copy, §5 — unchanged)
```

### 10.2 The stage (models the captions/zoompan structure)

For each `OverlayTrack`, for each `kind:"text"` overlay (z-order = track array order, then clip order — matching the canvas loop in `_drawOverlays`, which iterates tracks then clips):

1. Compute `layoutTextOverlay(ov, Rw, Rh, Ch)` (§7.5).
2. Resolve `fontfile` token (§7.3) and, for non-trivial text, declare a `textfile` input token `overlaytext:<id>.txt` (mirrors the `subtitles` input declaration in §4, lines 463–476) so the worker materialises the file.
3. Build the filter:

```
[<vin>]drawtext=
   fontfile=<FONT_TOKEN>:
   textfile=<TEXTFILE_TOKEN>          (or text='<escaped>')
   :fontsize=<fontPx>
   :fontcolor=0x<RRGGBB>@<opacity*colorAlpha>
   :x=<§5.3 x-expr>
   :y='<boxY> + <boxH>/2 - text_h/2'
   :borderw=<borderPx>:bordercolor=0x<outline.color>@<opacity>
   :line_spacing=<lineSpacing>:text_align=<L|C|R>
   :expansion=none
   :enable='between(t,<startSec>,<endSec>)'
[<vout>]
```

where `startSec = msToSec(ov.startOnTimeline)` and `endSec = msToSec(ov.endOnTimeline)` — **reusing the existing `msToSec` helper** (lines 101–105), exactly as the overlay/xfade stages do. Chain multiple overlays by threading `[vtextN] → [vtextN+1]`.

4. **Timing** is the existing `enable='between(t,start,end)'` idiom already used for clip overlays (line 453) and matches the canvas's `playheadMs >= start && < end` test. (Note `between` is inclusive on both ends; the ≤1-frame difference at the exclusive end vs the canvas's `< end` is below the golden sampling resolution — sample fixtures strictly inside the window.)

### 10.3 Worker changes (`apps/render-worker/worker.ts`)

Mirror the captions/watermark resolution already present:
- Substitute the `font:Inter-*` token → `${INTER_FONT_DIR}/Inter-*.ttf` in `substituteInputPaths` (lines 249–272).
- For each `overlaytext:<id>.txt` token, **write the line-split text to a temp file** (exactly like the SRT write at lines 447–454) and substitute the path. Clean up in the `finally` (line 508).
- No new spawn logic; the same `spawnFfmpeg` runs the augmented graph.

---

## 11. Build breakdown (Reel / Pixel split)

### 11.1 Reel — export side (`packages/ffmpeg-graph` + `apps/render-worker`)

1. **`textOverlayLayout.ts`** (pure): the shared `layoutTextOverlay()` + `weightToInterFile()` (§4.2, §7.5). **Home: `@videoforge/project-schema`** (verified: `apps/web` already imports it; it does NOT import `ffmpeg-graph` — see §7.5). `buildFilterComplex` imports it from there. Unit-tested in isolation (no FFmpeg).
2. **`buildFilterComplex.ts`**: add the drawtext stage (§10.1–10.2). Declare font + textfile input tokens. Reuse `msToSec`, `enable` idiom, percent helpers. Remove text from the "out of scope" header comment (lines 22–27) and replace with the new contract reference.
3. **`worker.ts`**: token substitution for `font:*` and `overlaytext:*`; write the per-overlay text temp file (mirror SRT); env `INTER_FONT_DIR`. Cleanup in `finally`.
4. **`Dockerfile`**: vendor + `COPY` the pinned Inter TTFs to `/usr/share/fonts/inter/`; set `ENV INTER_FONT_DIR=/usr/share/fonts/inter`. (Add the TTFs under `apps/render-worker/assets/fonts/inter/`.)
5. **Goldens / fixtures** (`fixtures/projects/index.ts`, `scripts/generate-fixtures.ts`, `golden.test.ts`): add overlay-text fixtures and re-baseline. **Critical:** the golden gate currently runs `watermark:false, captions:none`; the new fixtures must enable the text path and the **golden environment must have the bundled Inter** (so `generate:fixtures --goldens` and the CI gate both run in the pinned-FFmpeg + Inter image). New fixtures:
   - `overlay_text_default` — the §1 default overlay (`fontFamily:"sans-serif"` → must render Inter; locks R1).
   - `overlay_text_aligns` — left/center/right at the three corners (locks §5.3 anchors).
   - `overlay_text_multiline` — 2–3 lines via `\n` (locks §6 / R6).
   - `overlay_text_escape` — `He said: "50% off" \` (locks R3).
   - `overlay_text_subfloor` — tiny fontSize hitting the 12px floor (locks R5).
   - `overlay_text_weight_opacity` — `fontWeight:700`, `opacity:60`, coloured outline (locks R2 + alpha).

   Goldens are regenerated only via the reviewer-gated `pnpm generate:fixtures --goldens` in the pinned image (per the existing discipline in `renderHarness.ts` / `generate-fixtures.ts`). **Note:** pixel-goldens run in CI on the FFmpeg image — the fixture render must therefore have Inter present in that image, which item 4 guarantees.

### 11.2 Pixel — preview side (`apps/web`) — keep MINIMAL

The strategy is **match export to the existing canvas**, so Pixel's change is deliberately small. Exactly two changes:

1. **Adopt the shared layout helper.** Replace the inline arithmetic in `PreviewEngine._drawOverlays` (lines 413–428) with a call to `layoutTextOverlay(ov, w, h, project.canvas.height)` and draw from its returned px values. This guarantees the size/floor/position/stroke math is **the same code** as the export. *(No visual change for single-line overlays — it is a refactor to the shared formula.)*
2. **Multi-line rendering (the one behavioural change).** Split `text` on `\n`, draw each line with `fillText`/`strokeText`, vertically centering the block on `boxY + boxH/2` using `lineHeight` (default `1.2`, i.e. line pitch `= fontPx * lineHeight`). This makes preview show N lines (matching the export) instead of today's single dropped-newline line. Use the **same** `lineHeight` and split rule the export uses (§6).

**No font change is required in the browser** — the canvas already renders Inter (the export is being matched *to* it). The data model's `fontFamily` is intentionally left ignored by both sides (R1); a future "font picker" feature would change both sides + the bundled fonts together, out of scope here.

> Optional (not required for parity, product nicety): the text-overlay inspector could expose a "Wrap" toggle later — but auto-wrap is deferred (§9) and would need the shared metrics, so it is **not** in this wave.

### 11.3 Why Pixel changes the canvas at all

The CEO brief asks "match export to the existing canvas; but if the canvas must change to be drawtext-reproducible, specify exactly what." The answer: **the canvas needs exactly one behavioural change — multi-line `\n` rendering (§11.2.2)** — because today's single-`fillText` drops newlines, which `drawtext` cannot un-drop without also dropping them (and dropping them is the worse product). Everything else (font, size, position, outline, opacity, timing) is already drawtext-reproducible as-is, so the export is built to match it. The helper adoption (§11.2.1) is a *refactor*, not a behaviour change, and exists to make drift structurally impossible.

---

## 12. Invariant confirmation

After this work:
- The export `filter_complex` renders each `TextOverlay` with the **same Inter font, the same px geometry, the same size (incl. floor), the same outline/opacity, and the same timing window** as `PreviewEngine` draws on the canvas — because both consume **one shared layout function** and **one bundled, pinned Inter**, and the export ignores `fontFamily` exactly as the canvas does.
- The only canvas behaviour change (multi-line) is mirrored on both sides from the same split rule + `lineHeight`.
- The golden-frame gate (SSIM ≥ 0.985 / PSNR ≥ 38 dB) gains text fixtures that **fail loudly** if the two sides ever drift.

⇒ **Preview text and exported text are the same. "What you cut is what you get" now holds for text overlays.**

---

## Appendix A — Worked example (the default overlay, export at 1080×1920)

Project canvas `1080×1920` (`Ch=1920`), export `Rw=1080, Rh=1920`. Default overlay from §1:
`canvasX:5, canvasY:80, width:90, height:15, opacity:100, fontSize:48, fontWeight:600, color:#FFFFFF, align:center, outline:{width:2,color:#000000}`, `text:"Hello"`, `start:0, end:3000`.

- `boxX = round(0.05*1080)=54`, `boxY = round(0.80*1920)=1536`, `boxW = round(0.90*1080)=972`, `boxH = round(0.15*1920)=288`.
- `fontPx = round((48/1920)*1920)=48`.
- weight 600 → bucket (550,650] → `Inter-SemiBold.ttf`.
- `borderPx = round(2 * 1920/1920)=2`.
- align center → `x='54 + 972/2 - text_w/2'`; `y='1536 + 288/2 - text_h/2'`.
- filter:
  `[vsub]drawtext=fontfile=/usr/share/fonts/inter/Inter-SemiBold.ttf:text='Hello':fontsize=48:fontcolor=0xFFFFFF@1:x='54 + 972/2 - text_w/2':y='1536 + 288/2 - text_h/2':borderw=2:bordercolor=0x000000@1:line_spacing=10:text_align=C:expansion=none:enable='between(t,0,3)'[vtext]`

Preview (backing store 405×720, `scale=0.375`): `boxX=round(0.05*405)=20`, `fontPx=round((48/1920)*720)=18`, `borderPx=round(2*720/1920·(1/scale…))` → via the shared helper, the **same** function produces preview px from `(405,720,1920)` and export px from `(1080,1920,1920)`; the ratio `1080/405 = 1920/720 = 48/18·… = 1/scale`, so the two surfaces are the same composition scaled by `scale`. Sampling the export at `t=1.0s` and the preview at `t=1.0s` yields the same glyphs at the same relative positions ⇒ SSIM/PSNR pass.

---

## Appendix B — Open confirmations for Atlas/Reel/Pixel

1. **Helper home:** resolved to **`@videoforge/project-schema`** (verified: `apps/web` already depends on it and NOT on `ffmpeg-graph`). Flagged here only so Reel/Pixel ratify before coding.
2. **Inter delivery into the image:** vendored TTFs committed in-repo (preferred, deterministic) vs pinned download at build time (mirrors FFmpeg block). Default: vendored.
3. **Golden image must include Inter** so the CI pixel-gate renders the text path — confirm the CI FFmpeg image is the render-worker image (or add Inter to the golden CI step).
