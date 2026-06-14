// ─────────────────────────────────────────────────────────────────────────────
// @videoforge/ffmpeg-graph — headless FFmpeg `filter_complex` command builder.
//
// THE BET (MVP_Scope.md §1, §3.8): the export FFmpeg `filter_complex` is generated
// from the EXACT SAME non-destructive §18 project JSON the client preview renders,
// so "what you cut is what you get" holds by construction. This module is the M0
// spine — built first, pure (no fs / no spawn / no Date / no random), and therefore
// fully unit-testable + deterministic (same Project + ExportSettings ⇒ same output).
//
// Spec map (VideoForge_Spec_v1.1.md §10.3 "FFmpeg Command Architecture"):
//   • Each source clip => an input, trimmed with -ss/-to from the SOURCE origin.   (§10.3, §3.8 "Per-clip -ss/-to")
//   • Per-clip speed: video setpts, audio atempo (pitch-preserving on export).      (§5.1, §3.3)
//   • Video tracks composited BOTTOM-UP via an `overlay` chain (index 0 = bottom).  (§10.3, §18.3 z-order)
//   • Per-clip opacity + one color-grade `eq` (brightness/contrast/saturation).     (§6.1, §10.3)
//   • Crossfade transitions via `xfade` between adjacent clip outputs.              (§6.4, §10.3)
//   • Per-track audio chain volume->pan then amix=inputs=N:normalize=0 + alimiter.  (§7.1, §10.3, D-6)
//   • Mute/solo gating drops inputs from amix.                                      (§3.2, §10.3, B-8/X-6)
//   • Burned-in captions via the `subtitles` filter.                               (§10.3, §22.3)
//   • Final mandatory Free-tier branding watermark overlay.                        (§10.2, §10.3, X-12)
//   • Scale/pad to the target output resolution (<= 1080p).                        (§10.2, MVP_Scope §0.2)
//
// MVP-STUB note: real export pre-rasterises gradient/blur text, Lottie/SVG/stickers
// to RGBA PNG sequences and composites them via `overlay` (§10.3). The MVP graph
// honestly omits those overlay inputs and emits clearly-marked comments instead of
// inventing input files this pure builder cannot produce. IMAGE/shape/lottie/sticker
// overlays remain out of the M0 spine here (the editor-shell CanvasStage renders them
// in preview). Captions are the proven text→export parity surface (§22.3).
//
// TEXT OVERLAYS are now rendered into the export via a `drawtext` stage (§10 of
// Text_Overlay_Export_Spec.md): each `kind:"text"` overlay burns in with the SAME
// Inter font, geometry, size (incl. the 12px floor), outline, opacity and timing the
// preview canvas draws — geometry/size come from the SHARED `layoutTextOverlay` helper
// in `@videoforge/project-schema` (the same function the preview calls), so the two
// sides cannot drift. `style.fontFamily` is intentionally IGNORED: the canvas hardcodes
// Inter, and parity demands the export do the same (R1). Deferred sub-features
// (gradient/shadow/letterSpacing/backgroundColor/rotation/animation) are honestly
// omitted, matching what the canvas omits today (§9).
// ─────────────────────────────────────────────────────────────────────────────

import type {
  Project,
  Track,
  VideoTrack,
  AudioTrack,
  VoiceOverTrack,
  Clip,
  CaptionTrack,
  CaptionStyle,
  OverlayTrack,
  TextOverlay,
  Transition,
  Effect,
} from "@videoforge/project-schema";
import { layoutTextOverlay, weightToInterFile } from "@videoforge/project-schema";

// ─────────────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * MVP export settings. Deliberately narrow: H.264 MP4 only, <= 1080p (MVP_Scope
 * §0.2 "Not multi-format export"). `captions` selects burned-in vs sidecar vs none;
 * `watermark` carries the resolved Free-tier branding entitlement (true on Free).
 */
export interface ExportSettings {
  format: "mp4";
  videoCodec: "h264";
  /** Target output resolution in logical pixels. Clamped to <= 1080p by the caller. */
  resolution: { w: number; h: number };
  /** Output frame rate, e.g. 24 | 25 | 30 | 50 | 60. */
  fps: number;
  /** libx264 Constant Rate Factor (0 lossless … 51 worst). Typical 18–28. */
  crf: number;
  /** "none" | "burn" (subtitles filter, hardcoded) | "sidecar" (.srt/.vtt, no burn). */
  captions: "none" | "burn" | "sidecar";
  /** Free-tier mandatory branding watermark (resolved at job creation, §21.11). */
  watermark: boolean;
}

/**
 * One declared FFmpeg input. `index` is the positional `-i` order and the
 * filtergraph stream index (`[0:v]`, `[1:a]`, …). `kind` records what the input is
 * so the worker can resolve `assetId`→S3 path; `subtitlesPath` flags the burned
 * caption file; `watermark` flags the synthetic branding asset.
 */
export interface InputSpec {
  index: number;
  kind: "clip" | "watermark" | "subtitles";
  /** Source asset id for clip inputs (resolved to a real file by the render worker). */
  assetId?: string;
  /** Owning clip id (for clip inputs) — lets the worker map trims back to the graph. */
  clipId?: string;
  /** Pre-input args attached to THIS input (e.g. `-ss`/`-to` accurate seek). */
  preArgs: string[];
  /** The `-i <path>` value; a placeholder token the worker substitutes (no fs here). */
  path: string;
}

/**
 * A per-overlay text file the worker must materialise before spawning FFmpeg. The
 * builder stays pure (no fs), so it emits the line-split `text` plus a sentinel
 * `token` it embedded in `filterComplex` at the overlay's `textfile=` option. The
 * worker writes `text` to a temp file (mirroring the SRT write) and string-replaces
 * `token` in `filterComplex` with the real temp-file path. Using `textfile=` (not
 * inline `text=`) means the user's text NEVER passes through the filtergraph
 * tokeniser — only the worker-controlled filename does — neutralising the entire
 * `:` `'` `%` `\` / newline escaping class (spec §7.1 / R3), exactly as the
 * `subtitles=` caption path is already trusted.
 */
export interface TextFileSpec {
  /** Sentinel string embedded in `filterComplex`; the worker swaps it for the temp path. */
  token: string;
  /** The overlay id this text belongs to (used by the worker to name the temp file). */
  overlayId: string;
  /** The overlay text, already split/normalised to real newlines (one drawtext block). */
  text: string;
}

/**
 * A font file reference the worker resolves against `INTER_FONT_DIR`. The builder
 * emits a sentinel `token` at the overlay's `fontfile=` option and records the bundled
 * Inter `file` basename (e.g. "Inter-SemiBold.ttf"); the worker string-replaces
 * `token` in `filterComplex` with `${INTER_FONT_DIR}/${file}` (spec §4.3 / §7.3),
 * keeping this builder free of any filesystem/path knowledge.
 */
export interface FontSpec {
  /** Sentinel string embedded in `filterComplex`; the worker swaps it for the abs path. */
  token: string;
  /** Bundled Inter static-TTF basename, e.g. "Inter-SemiBold.ttf". */
  file: string;
}

export interface BuildResult {
  /** Full argv (after the leading `ffmpeg`), deterministic and ready to spawn. */
  args: string[];
  /** The `-filter_complex` graph string (also embedded in `args`). */
  filterComplex: string;
  /** Ordered input declarations, index-aligned with the `-i` flags in `args`. */
  inputs: InputSpec[];
  /** The final mapped video pad label (e.g. "[vout]"). */
  outputLabel: string;
  /**
   * Per-overlay text files the worker must write + substitute into `filterComplex`
   * (text-overlay drawtext stage, §10.3). Empty when there are no text overlays.
   */
  textFiles: TextFileSpec[];
  /**
   * Inter font references the worker must resolve against `INTER_FONT_DIR` and
   * substitute into `filterComplex` (§4.3). Deduped; empty when no text overlays.
   */
  fonts: FontSpec[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Small deterministic helpers (no I/O, no locale, no float formatting surprises)
// ─────────────────────────────────────────────────────────────────────────────

/** Integer ms → fixed-precision seconds string (FFmpeg time unit). Deterministic. */
function msToSec(ms: number): string {
  // 3 decimals = ms precision; trim trailing zeros for stable, minimal output.
  const s = (ms / 1000).toFixed(3);
  return s.replace(/\.?0+$/, "") || "0";
}

/** Map UI color-grade params (centred on 0 / ±range) to FFmpeg `eq` parameters. */
function eqFromColorGrade(params: Record<string, number | string | boolean>): string {
  // UI convention (§6.1): brightness/contrast/saturation are user-centred values.
  //   brightness ∈ [-100,100] → eq.brightness ∈ [-1,1]
  //   contrast   ∈ [-100,100] → eq.contrast   ∈ [0,2]   (0 = neutral → 1.0)
  //   saturation ∈ [-100,100] → eq.saturation ∈ [0,2]   (0 = neutral → 1.0)
  const num = (k: string): number => (typeof params[k] === "number" ? (params[k] as number) : 0);
  const brightness = (num("brightness") / 100).toFixed(4).replace(/\.?0+$/, "") || "0";
  const contrast = (1 + num("contrast") / 100).toFixed(4).replace(/\.?0+$/, "") || "1";
  const saturation = (1 + num("saturation") / 100).toFixed(4).replace(/\.?0+$/, "") || "1";
  return `eq=brightness=${brightness}:contrast=${contrast}:saturation=${saturation}`;
}

/** Find the single enabled color-grade effect on a clip, if any (MVP: one grade). */
function colorGradeOf(clip: Clip): Effect | undefined {
  return clip.effects.find((e) => e.enabled && e.type === "colorGrade");
}

/**
 * M4: Read the direct `colorGrade` extension field (set by setClipColorGrade in
 * the editor store) and emit an `eq` filter string, or return null if absent.
 * The direct field takes precedence over the legacy `effects` array.
 */
function colorGradeExtOf(clip: Clip): string | null {
  const ext = clip.colorGrade;
  if (!ext) return null;
  const { brightness = 0, contrast = 0, saturation = 0 } = ext;
  const b = Math.max(-1, Math.min(1, brightness / 100)).toFixed(3);
  const c = Math.max(0, Math.min(2, 1 + contrast / 100)).toFixed(3);
  const s = Math.max(0, Math.min(3, 1 + saturation / 100)).toFixed(3);
  return `eq=brightness=${b}:contrast=${c}:saturation=${s}`;
}

/**
 * Per-clip PiP box in OUTPUT pixels, or null when the clip fills the frame (no
 * transform). `transform` is percent-of-canvas (x/y top-left, width/height size).
 * Dimensions are forced even (libx264/yuv420p) and the position is clamped to ints.
 * This is the export half of the preview↔export transform parity (PreviewEngine
 * draws the same box) — "what you cut is what you get" for moved/resized clips.
 */
function clipBox(
  clip: Clip,
  outW: number,
  outH: number,
): { w: number; h: number; x: number; y: number } | null {
  const t = clip.transform;
  if (!t) return null;
  const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);
  return {
    w: even((t.width / 100) * outW),
    h: even((t.height / 100) * outH),
    x: Math.round((t.x / 100) * outW),
    y: Math.round((t.y / 100) * outH),
  };
}

/**
 * M4: Read the `kenBurns` extension field and emit a `zoompan` filter string,
 * or return null if absent. Uses a slow linear zoom from startScale to endScale.
 */
function kenBurnsFilterOf(clip: Clip, outW: number, outH: number, fps: number): string | null {
  const ext = clip.kenBurns;
  if (!ext) return null;
  const { startScale, endScale } = ext;
  const clipDurationMs = clip.endOnTimeline - clip.startOnTimeline;
  const frames = Math.max(1, Math.round((clipDurationMs / 1000) * fps));
  // Zoom step per frame so we go from startScale to endScale over `frames` frames.
  const zoomStep = (endScale - startScale) / frames;
  const zBase = startScale.toFixed(4);
  const zStep = Math.abs(zoomStep).toFixed(6);
  // Zoompan: z expression ramps from startScale; x/y keep the center in frame.
  const zExpr = zoomStep >= 0
    ? `min(zoom+${zStep},${endScale.toFixed(4)})`
    : `max(zoom-${zStep},${endScale.toFixed(4)})`;
  return `zoompan=z='if(eq(on,1),${zBase},${zExpr})':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${outW}x${outH}:fps=${fps}`;
}

/** Track is audio-bearing (carries the mix fields)? */
function isAudioBearing(t: Track): t is AudioTrack | VoiceOverTrack {
  return t.type === "audio" || t.type === "voiceover";
}

/**
 * Resolve which audio-bearing tracks are audible per mute/solo (§10.3, B-8/X-6):
 * if ANY audio track is soloed, only soloed tracks survive; otherwise all non-muted.
 */
function audibleAudioTracks(tracks: Track[]): Array<AudioTrack | VoiceOverTrack> {
  const audio = tracks.filter(isAudioBearing);
  const anySolo = audio.some((t) => t.solo);
  return audio.filter((t) => (anySolo ? t.solo : !t.muted));
}

/**
 * FFmpeg `pan` filter expression for stereo balance from §18 `pan` ∈ [-100,100]
 * (WebAudio StereoPanner equal-power semantics ≈ FFmpeg `pan`). -100 = full left.
 */
function panExpr(pan: number): string {
  // Equal-power constant-energy pan to match the StereoPanner preview (§7.1).
  const theta = ((pan + 100) / 200) * (Math.PI / 2); // 0..π/2
  const l = Math.cos(theta).toFixed(4).replace(/\.?0+$/, "") || "0";
  const r = Math.sin(theta).toFixed(4).replace(/\.?0+$/, "") || "0";
  // stereo out: L = l*FL, R = r*FR (sources are stereo after channel handling).
  return `pan=stereo|c0=${l}*c0|c1=${r}*c1`;
}

/** Volume multiplier string from a percent gain (100 = 0 dB = ×1.0). */
function gainMul(percent: number): string {
  return (percent / 100).toFixed(4).replace(/\.?0+$/, "") || "0";
}

// ─────────────────────────────────────────────────────────────────────────────
// Output-duration bound — the catastrophic-runaway fix.
//
// The composite base is a SYNTHETIC `color=` lavfi source (§3 below). FFmpeg's
// `color` generates frames FOREVER unless given a `:d=` duration, and `overlay`
// follows its (infinite) main input — so with an empty/short timeline the encode
// never terminates (the dev-worker incident: empty track + watermark → ∞ render).
// We bound the export DETERMINISTICALLY from the project itself: the timeline
// length = the furthest point any clip / overlay / caption reaches. This is the
// SAME extent the client preview's playhead spans, so capping here UPHOLDS the
// WYCIWYG invariant (the MP4 is exactly as long as the timeline you previewed),
// it does not alter it. The bound is applied in TWO places (§3 base `:d=` + the
// `-t` output cap in §7) so neither a future graph change nor a stray infinite
// input can reintroduce an unbounded encode.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Empty-timeline export duration (ms). A project with NO clips, overlays, or
 * captions has zero intrinsic length; rather than emit an unbounded (or zero-frame
 * degenerate) command we produce a short, deterministic, BOUNDED canvas-only clip.
 * 1000ms matches the render-worker's existing `|| 1` (1-second) zero-duration
 * fallback (apps/render-worker/src/worker.ts `projectDurationSeconds`), so the
 * graph and the worker agree on the same minimal length.
 */
export const EMPTY_PROJECT_DURATION_MS = 1000;

/**
 * Total project/timeline duration in integer ms: the maximum `endOnTimeline` across
 * EVERY media + overlay clip plus the maximum caption `endMs`. This is the furthest
 * point the timeline reaches — identical to the preview playhead extent (parity) —
 * and therefore the deterministic length the export must be bounded to. Falls back to
 * {@link EMPTY_PROJECT_DURATION_MS} for an empty timeline (no clips/overlays/captions).
 * Pure: no I/O, no clock; same Project ⇒ same number.
 */
export function projectDurationMs(project: Project): number {
  let maxMs = 0;
  for (const track of project.tracks) {
    // The Track union includes CaptionTrack (no `clips`); video/audio/voiceover/overlay
    // all carry `clips[]` whose entries expose `endOnTimeline` (Clip and OverlayClip alike).
    if (!("clips" in track)) continue;
    for (const clip of track.clips as Array<{ endOnTimeline: number }>) {
      if (clip.endOnTimeline > maxMs) maxMs = clip.endOnTimeline;
    }
  }
  // Captions may also live in the dedicated captionTracks array; both extend the timeline.
  for (const ct of project.captionTracks) {
    for (const b of ct.blocks) {
      if (b.endMs > maxMs) maxMs = b.endMs;
    }
  }
  return maxMs > 0 ? maxMs : EMPTY_PROJECT_DURATION_MS;
}

// ─────────────────────────────────────────────────────────────────────────────
// Caption serialisation (for the burned-in subtitles input) — deterministic ASS-free
// SRT, since SRT round-trips through `subtitles` and the sidecar export alike.
// ─────────────────────────────────────────────────────────────────────────────

function msToSrtStamp(ms: number): string {
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  const milli = ms % 1000;
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${p(h)}:${p(m)}:${p(s)},${p(milli, 3)}`;
}

/**
 * Sanitise a caption block's text for SRT/libass: normalise every newline flavour
 * (CRLF, CR, the literal escape "\n") to a single real LF so multi-line blocks render
 * one cue line per line (and the BURN path via `subtitles` agrees with the SIDECAR
 * file byte-for-byte). `{`/`}` are libass override-code delimiters — an unescaped `{`
 * would silently swallow text until the next `}`; we escape both so user text renders
 * literally (matching the preview canvas, which draws the raw string). Pure.
 */
function sanitizeCaptionText(text: string): string {
  return text
    .replace(/\r\n?/g, "\n") // CRLF / lone CR → LF
    .replace(/\\n/g, "\n") // a literal backslash-n escape → real newline
    .replace(/[{}]/g, (ch) => (ch === "{" ? "\\{" : "\\}")); // neutralise libass override braces
}

/**
 * Serialise the FIRST caption track's blocks to an SRT string (MVP: 1 caption track,
 * MVP_Scope §1.6). Pure — the worker writes this to disk before invoking FFmpeg.
 * Exported so the sidecar-export path and tests can reuse the exact same bytes.
 * Text is sanitised ({@link sanitizeCaptionText}) so embedded newlines + `{`/`}` are
 * safe and the burn / sidecar / preview renderings cannot diverge.
 */
export function captionsToSrt(track: CaptionTrack): string {
  return (
    track.blocks
      .slice()
      // Stable ordering by start time so output is deterministic regardless of input order.
      .sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs)
      .map(
        (b, i) =>
          `${i + 1}\n${msToSrtStamp(b.startMs)} --> ${msToSrtStamp(b.endMs)}\n${sanitizeCaptionText(b.text)}`,
      )
      .join("\n\n") + "\n"
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Caption burn-in styling (invariant parity with PreviewEngine._drawCaptions).
//
// The preview styles captions from the track CaptionStyle: Inter 600, fontSize
// scaled to canvas height with a 14px floor, `style.color` fill, `style.outline`
// (width+color) stroke, and a top/center/bottom vertical anchor. The export's
// `subtitles` filter MUST pass the same intent via `force_style` (ASS), or libass
// renders its own defaults and export ≠ preview. This helper derives that string
// from the SAME CaptionStyle the preview reads. Pure (no I/O).
// ─────────────────────────────────────────────────────────────────────────────

/**
 * `#RRGGBB[AA]` → ASS `&HBBGGRR` (ASS colours are BGR hex, no alpha here — libass
 * `Outline`/`Primary` colours use `&HBBGGRR`; we keep them fully opaque to match the
 * preview, whose caption fill/stroke ignore per-colour alpha). Falls back to white.
 */
function hexToAssBgr(color: string | undefined): string {
  const c = (color ?? "#FFFFFF").replace(/^#/, "");
  const rgb = c.slice(0, 6).padEnd(6, "0").toUpperCase();
  const rr = rgb.slice(0, 2);
  const gg = rgb.slice(2, 4);
  const bb = rgb.slice(4, 6);
  return `&H${bb}${gg}${rr}`;
}

/**
 * Build the `subtitles` `force_style` argument from a track {@link CaptionStyle},
 * mirroring `PreviewEngine._drawCaptions`:
 *   • FontName=Inter (the canvas hardcodes Inter; parity demands the export do too).
 *   • Fontsize scaled to the OUTPUT height the SAME way the preview scales to its
 *     render height: `max(14, round(fontSize / canvasHeight * outH))`. The
 *     `subtitles` filter lays captions out at `PlayResY == outH` (the video frame
 *     height), so this output-px size lands at the preview's proportional size.
 *   • PrimaryColour from `style.color`; Outline width + OutlineColour from
 *     `style.outline` (0 when absent).
 *   • Alignment from `style.position`: bottom→2, center→5, top→8 (numpad anchors).
 *
 * @param canvasH the project canvas height (preview's `project.canvas.height`).
 * @param outH    the export render height (the surface libass lays out on).
 */
export function captionStyleToAssForceStyle(
  style: CaptionStyle,
  canvasH: number,
  outH: number,
): string {
  // Preview: size = max(14, (fontSize / canvasHeight) * renderHeight). Reproduce it
  // against the export height so the burned caption is proportionally identical.
  const scaled = canvasH > 0 ? (style.fontSize / canvasH) * outH : style.fontSize;
  const fontPx = Math.max(14, Math.round(scaled));
  const alignment = style.position === "top" ? 8 : style.position === "center" ? 5 : 2;
  const primary = hexToAssBgr(style.color);
  const parts = [
    "FontName=Inter",
    `Fontsize=${fontPx}`,
    `PrimaryColour=${primary}`,
    `Alignment=${alignment}`,
  ];
  if (style.outline && style.outline.width > 0) {
    parts.push(`Outline=${Math.max(0, Math.round(style.outline.width))}`);
    parts.push(`OutlineColour=${hexToAssBgr(style.outline.color)}`);
  } else {
    parts.push("Outline=0");
  }
  return parts.join(",");
}

// ─────────────────────────────────────────────────────────────────────────────
// Text-overlay drawtext stage (Text_Overlay_Export_Spec.md §10). Burns each
// `kind:"text"` overlay into the video between the captions burn and the watermark,
// reproducing the preview canvas exactly: SHARED `layoutTextOverlay` geometry/size,
// Inter (ignoring `style.fontFamily`, R1), `textfile=` for escape-safe text (R3),
// outline + opacity from the canvas, and `enable=between(t,start,end)` timing.
// Pure — emits sentinel tokens for the worker to substitute (no fs here).
// ─────────────────────────────────────────────────────────────────────────────

/** drawtext per-line horizontal alignment letter from the overlay `align` (§6.3). */
function textAlignLetter(align: "left" | "center" | "right"): "L" | "C" | "R" {
  return align === "left" ? "L" : align === "right" ? "R" : "C";
}

/** `style.color` (#RRGGBB[AA]) → { hex: "RRGGBB", alpha: 0..1 } for drawtext fontcolor. */
function parseHexColor(color: string): { hex: string; alpha: number } {
  const c = color.replace(/^#/, "");
  const rgb = c.slice(0, 6).toUpperCase();
  // 8-digit hex carries an alpha byte; split it out (drawtext: 0xRRGGBB@<a∈[0,1]>).
  const alpha = c.length >= 8 ? Number.parseInt(c.slice(6, 8), 16) / 255 : 1;
  return { hex: rgb.padEnd(6, "0"), alpha };
}

/** Format an alpha 0..1 as a stable, minimal decimal string for `@<a>`. */
function alphaStr(a: number): string {
  const clamped = Math.max(0, Math.min(1, a));
  return clamped.toFixed(4).replace(/\.?0+$/, "") || "0";
}

/**
 * Result of building the text-overlay stage: the chained filter parts (each
 * `[in]drawtext=...[out]`), the final output label, and the aux files/fonts the
 * worker must materialise/resolve and substitute into the graph.
 */
interface DrawtextStage {
  parts: string[];
  outLabel: string;
  textFiles: TextFileSpec[];
  fonts: FontSpec[];
}

/**
 * Build the drawtext chain for every `kind:"text"` overlay, threading `inLabel`
 * through one drawtext per overlay and returning the new output label. Z-order =
 * track array order then clip order, matching the preview's `_drawOverlays` loop.
 *
 * @param project   the §18 project (overlay tracks + canvas.height for fontSize ref).
 * @param inLabel   the video pad to draw on (post-captions, pre-watermark): "vsub"/base.
 * @param Rw,Rh     export render resolution (the surface the overlays are laid out on).
 */
function buildTextOverlayStage(
  project: Project,
  inLabel: string,
  Rw: number,
  Rh: number,
): DrawtextStage {
  const parts: string[] = [];
  const textFiles: TextFileSpec[] = [];
  const fontsByFile = new Map<string, FontSpec>(); // dedupe identical Inter faces
  const Ch = project.canvas.height;

  const overlayTracks = project.tracks.filter((t): t is OverlayTrack => t.type === "overlay");

  let current = inLabel;
  let n = 0;
  for (const track of overlayTracks) {
    for (const ov of track.clips) {
      if (ov.kind !== "text") continue; // image/shape/lottie/sticker stay out of scope (§9)
      const textOv = ov as TextOverlay;

      // Geometry + size from the SHARED helper (identical to the preview's call) — the
      // single mechanism that keeps export and preview from drifting (§5/§7.5).
      const L = layoutTextOverlay(textOv, Rw, Rh, Ch);

      // Font: weight (+ italic) → bundled Inter face (R2). Emit a sentinel token the
      // worker resolves to `${INTER_FONT_DIR}/<file>`; dedupe shared faces.
      const fontFile = weightToInterFile(textOv.style.fontWeight, textOv.style.italic ?? false);
      let font = fontsByFile.get(fontFile);
      if (!font) {
        font = { token: `__VF_FONT_${fontFile}__`, file: fontFile };
        fontsByFile.set(fontFile, font);
      }

      // Text: written VERBATIM to the textfile (worker materialises it). Embedded "\n"
      // are real newlines in the file → drawtext renders the multi-line block (§6.3). No
      // escaping/trimming here — the preview uses the identical `text.split("\n")` rule, so
      // the two sides' line boxes coincide; `textfile=` keeps the content out of the
      // filtergraph tokeniser entirely (R3).
      const textToken = `__VF_OVERLAYTEXT_${textOv.id}__`;
      textFiles.push({ token: textToken, overlayId: textOv.id, text: textOv.text });

      // Colour + opacity: fontcolor alpha = whole-overlay opacity × the colour's own
      // alpha; the SAME product goes on the outline (`bordercolor`), reproducing the
      // canvas `globalAlpha` which scales both stroke and fill (§7.2).
      const { hex, alpha: colorAlpha } = parseHexColor(textOv.style.color || "#FFFFFF");
      const a = alphaStr((textOv.opacity / 100) * colorAlpha);

      // Horizontal x-expression by align (§5.3): anchor − text_w fraction. Vertical y
      // always centres the (possibly multi-line) block on the box mid-line via text_h.
      const xExpr =
        textOv.style.align === "left"
          ? `${L.boxX}`
          : textOv.style.align === "right"
            ? `${L.boxX}+${L.boxW}-text_w`
            : `${L.boxX}+${L.boxW}/2-text_w/2`;
      const yExpr = `${L.boxY}+${L.boxH}/2-text_h/2`;

      // Outline: drawtext `borderw` (outset) reproduces the canvas centre-stroke within
      // the golden tolerance (R4); same alpha as the fill. Omit when there is none.
      const outline = textOv.style.outline;
      const borderOpts =
        L.borderPx > 0 && outline
          ? `:borderw=${L.borderPx}:bordercolor=0x${parseHexColor(outline.color).hex}@${a}`
          : "";

      const startSec = msToSec(textOv.startOnTimeline);
      const endSec = msToSec(textOv.endOnTimeline);
      const out = `vtext${n}`;

      // `expansion=none` so any `%{...}` in user text renders literally (R3). `textfile`
      // keeps content out of the tokeniser; only the worker-controlled token is inline.
      parts.push(
        `[${current}]drawtext=fontfile=${font.token}:textfile=${textToken}:fontsize=${L.fontPx}:` +
          `fontcolor=0x${hex}@${a}:x='${xExpr}':y='${yExpr}'${borderOpts}:` +
          `line_spacing=${L.lineSpacing}:text_align=${textAlignLetter(textOv.style.align)}:` +
          `expansion=none:enable='between(t,${startSec},${endSec})'[${out}]`,
      );
      current = out;
      n += 1;
    }
  }

  return { parts, outLabel: current, textFiles, fonts: [...fontsByFile.values()] };
}

// ─────────────────────────────────────────────────────────────────────────────
// The builder
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Translate a §18 {@link Project} + {@link ExportSettings} into a single, deterministic
 * FFmpeg command (argv + filter_complex). Pure: no fs, no spawn, no clock, no rng.
 *
 * Returned `inputs[].path` values are placeholder tokens (`asset:<id>`, `watermark:vf`,
 * `subtitles:captions.srt`) — the render worker substitutes real local paths after it
 * downloads originals from S3 (§10.2). This keeps the graph builder side-effect free
 * and unit-testable (MVP_Scope §3.8: "Built FIRST as a headless, unit-testable module").
 */
export function buildExportCommand(project: Project, settings: ExportSettings): BuildResult {
  const { resolution, fps, crf } = settings;
  const outW = resolution.w;
  const outH = resolution.h;

  // Deterministic output bound (the runaway-export fix). Derived from the SAME
  // timeline the preview spans, so it caps length without breaking WYCIWYG.
  const durationMs = projectDurationMs(project);
  const durationSec = msToSec(durationMs);

  const inputs: InputSpec[] = [];
  const filterParts: string[] = [];

  // Index of clips by id so transitions can find the chain labels they join.
  const videoTracks = project.tracks.filter((t): t is VideoTrack => t.type === "video");

  // ── 1. Declare inputs for every video clip and audio-bearing clip ──────────────
  // One -i per clip with accurate-seek trim from the SOURCE origin (§10.3, §3.8).
  // -ss/-to are PRE-input (placed before -i) so libavformat seeks accurately, and
  // they reference trimIn/trimOut measured from the asset origin (§18.3 invariant).
  const clipInputIndex = new Map<string, number>(); // clipId -> input index

  const declareClipInput = (clip: Clip): number => {
    const index = inputs.length;
    inputs.push({
      index,
      kind: "clip",
      assetId: clip.sourceAssetId,
      clipId: clip.id,
      // Accurate trim: -ss = trimIn, -to = trimOut, both from SOURCE asset origin.
      preArgs: ["-ss", msToSec(clip.trimIn), "-to", msToSec(clip.trimOut)],
      path: `asset:${clip.sourceAssetId}`,
    });
    clipInputIndex.set(clip.id, index);
    return index;
  };

  // Declare video clip inputs first (bottom-up, track index 0 first), then audio.
  for (const vt of videoTracks) {
    for (const clip of vt.clips) declareClipInput(clip);
  }
  const audibleTracks = audibleAudioTracks(project.tracks);
  for (const at of audibleTracks) {
    for (const clip of at.clips) declareClipInput(clip);
  }

  // ── 2. Per-clip VIDEO processing chain ─────────────────────────────────────────
  // For each video clip: speed (setpts) → color-grade (eq) → scale/pad to canvas →
  // opacity (format=rgba + colorchannelmixer aa). Output labeled [vc_<idx>].
  // Scaling to the OUTPUT resolution here makes every clip stream conformant for the
  // overlay/xfade compositing stages (§10.2 scale/pad, §10.3).
  const clipVideoLabel = new Map<string, string>();
  for (const vt of videoTracks) {
    for (const clip of vt.clips) {
      const idx = clipInputIndex.get(clip.id)!;
      const steps: string[] = [];

      // 2a. Speed: setpts compresses/expands PTS by 1/speed (§3.3, §5.1).
      if (clip.speed !== 1 && clip.speed > 0) {
        steps.push(`setpts=${(1 / clip.speed).toFixed(6).replace(/\.?0+$/, "")}*PTS`);
      } else {
        steps.push("setpts=PTS-STARTPTS");
      }

      // 2b. Color grade → eq (§6.1, §10.3). M4 direct field takes precedence over
      //     the legacy effects array. MVP: brightness/contrast/saturation only.
      const gradeExt = colorGradeExtOf(clip);
      if (gradeExt) {
        steps.push(gradeExt);
      } else {
        const grade = colorGradeOf(clip);
        if (grade) steps.push(eqFromColorGrade(grade.params));
      }

      // 2b1. Mirror (hflip/vflip) — applied before scale so the box geometry is
      //      unaffected. Preview applies the same mirror, keeping export parity.
      if (clip.flipH) steps.push("hflip");
      if (clip.flipV) steps.push("vflip");

      // 2b2. Ken Burns zoom-pan (M4). Applied after color grade, before scale/pad.
      //      zoompan outputs frames at the target resolution so scale/pad is a no-op.
      const kbFilter = kenBurnsFilterOf(clip, outW, outH, fps);
      if (kbFilter) steps.push(kbFilter);

      // 2c. Scale to the output canvas, OR to the clip's PiP box if it has a transform.
      //     No transform → fill the frame (aspect-fit + pad) EXACTLY as before, so
      //     existing projects export byte-identically. A transformed clip scales to its
      //     box (positioned by the overlay step §3 at the box's top-left).
      const bg = project.canvas.backgroundColor.replace("#", "0x");
      const box = clipBox(clip, outW, outH);
      if (box) {
        steps.push(`scale=${box.w}:${box.h}`, "setsar=1");
      } else {
        steps.push(
          `scale=${outW}:${outH}:force_original_aspect_ratio=decrease`,
          `pad=${outW}:${outH}:(ow-iw)/2:(oh-ih)/2:color=${bg}`,
          "setsar=1",
        );
      }

      // 2d. Per-clip opacity (§10.3). opacity 100 = opaque; <100 needs an alpha plane
      //     so the overlay chain can blend it. format=rgba then scale the alpha.
      const opacity = clipOpacityPercent(clip);
      if (opacity < 100) {
        const a = (opacity / 100).toFixed(4).replace(/\.?0+$/, "") || "0";
        steps.push("format=rgba", `colorchannelmixer=aa=${a}`);
      }

      const label = `vc${idx}`;
      filterParts.push(`[${idx}:v]${steps.join(",")}[${label}]`);
      clipVideoLabel.set(clip.id, label);
    }
  }

  // ── 3. Composite video BOTTOM-UP, weaving in crossfade transitions (§10.3, §6.4) ─
  // Within a track, adjacent clips joined by a `crossfade` Transition are combined
  // with `xfade`; the result is then overlaid onto the running composite. Track index
  // 0 is the bottom layer (§18.3): we start from a generated canvas-colour base so
  // gaps (no clip covering an area/time) export as the canvas background (§A-13).
  let baseLabel = "base";
  // A solid canvas-colour base spanning the project. Deterministic synthetic source.
  // `:d=<durationSec>` BOUNDS the source: a `color` lavfi without it generates frames
  // forever and `overlay` follows it → an unbounded encode (the empty-timeline runaway
  // incident). The duration is the timeline extent (projectDurationMs) so the base
  // covers exactly what the preview spans — parity preserved, runaway impossible.
  filterParts.push(
    `color=c=${project.canvas.backgroundColor.replace("#", "0x")}:s=${outW}x${outH}:r=${fps}:d=${durationSec}[${baseLabel}]`,
  );

  const transitionsByTrack = (trackId: string): Transition[] => {
    const startOf = (clipId: string): number =>
      videoTracks
        .flatMap((vt) => vt.clips)
        .find((c) => c.id === clipId)?.startOnTimeline ?? 0;
    return project.transitions
      .filter((t) => t.trackId === trackId && t.type === "crossfade")
      .slice()
      // Order by the FROM clip's timeline position so chained transitions fuse in order.
      .sort((a, b) => startOf(a.fromClipId) - startOf(b.fromClipId));
  };

  let compositeCounter = 0;
  for (const vt of videoTracks) {
    // Build this track's single video output, applying xfade across transition pairs.
    const trackTransitions = transitionsByTrack(vt.id);
    // Map each clip to its (possibly transition-fused) producing label.
    const fusedLabel = new Map<string, string>();
    for (const clip of vt.clips) fusedLabel.set(clip.id, clipVideoLabel.get(clip.id)!);

    for (const tr of trackTransitions) {
      const fromLabel = fusedLabel.get(tr.fromClipId);
      const toLabel = fusedLabel.get(tr.toClipId);
      if (!fromLabel || !toLabel) continue; // dangling reference — skip defensively
      const fromClip = vt.clips.find((c) => c.id === tr.fromClipId);
      if (!fromClip) continue;

      // xfade `offset` = when the crossfade begins on the FROM stream's local (origin-0)
      // timeline: the overlap starts durationMs before the FROM clip ends.
      const fromLenMs = fromClip.endOnTimeline - fromClip.startOnTimeline;
      const offsetMs = Math.max(0, fromLenMs - tr.durationMs);
      const out = `xf${compositeCounter++}`;
      filterParts.push(
        `[${fromLabel}][${toLabel}]xfade=transition=fade:duration=${msToSec(tr.durationMs)}:offset=${msToSec(offsetMs)}[${out}]`,
      );
      // Both clips are now represented by the fused output.
      fusedLabel.set(tr.fromClipId, out);
      fusedLabel.set(tr.toClipId, out);
    }

    // Group clips by their producing label (a transition fuses two clips into one).
    // `x`/`y` are the overlay top-left in output px from the clip's PiP box (0,0 when
    // it fills the frame). The first clip in a fused group sets the position.
    const groups = new Map<string, { startMs: number; endMs: number; x: number; y: number }>();
    for (const clip of vt.clips) {
      const label = fusedLabel.get(clip.id)!;
      const g = groups.get(label);
      const box = clipBox(clip, outW, outH);
      if (g) {
        g.startMs = Math.min(g.startMs, clip.startOnTimeline);
        g.endMs = Math.max(g.endMs, clip.endOnTimeline);
      } else {
        groups.set(label, {
          startMs: clip.startOnTimeline,
          endMs: clip.endOnTimeline,
          x: box?.x ?? 0,
          y: box?.y ?? 0,
        });
      }
    }

    // Overlay each group onto the running composite AT ITS TIMELINE POSITION. The clip
    // stream is origin-0 (setpts in §2 / xfade output); we DELAY it to startOnTimeline
    // with a PTS offset so the frames shown during the `enable` window are the correct
    // ones — this is the load-bearing "what you cut is what you get" placement (finding #4).
    // `enable` reveals the canvas base outside the window (gaps export as background, §A-13).
    for (const [label, g] of groups) {
      const startSec = msToSec(g.startMs);
      const endSec = msToSec(g.endMs);
      const placed = `pl${compositeCounter++}`;
      const next = `cmp${compositeCounter++}`;
      filterParts.push(
        `[${label}]setpts=PTS-STARTPTS+${startSec}/TB[${placed}]`,
        `[${baseLabel}][${placed}]overlay=${g.x}:${g.y}:enable='between(t,${startSec},${endSec})':eof_action=pass[${next}]`,
      );
      baseLabel = next;
    }
  }

  // ── 4. Burned-in captions via the `subtitles` filter (§10.3, §22.3) ─────────────
  // MVP: first caption track only. The worker writes captionsToSrt(track) to disk and
  // substitutes the path for the `subtitles:captions.srt` token below.
  let videoOut = baseLabel;
  if (settings.captions === "burn" && project.captionTracks.length > 0) {
    // Declare a logical subtitles input so the worker knows to materialise the file.
    const subIndex = inputs.length;
    inputs.push({
      index: subIndex,
      kind: "subtitles",
      preArgs: [],
      path: "subtitles:captions.srt",
    });
    const next = "vsub";
    // `subtitles` reads the file by path (not a stream), so reference the token path.
    // `force_style` carries the track CaptionStyle (color/size/outline/position) so the
    // burned captions match PreviewEngine._drawCaptions instead of libass defaults —
    // the export==preview invariant for captions (§22.3). Derived from the SAME
    // CaptionStyle the preview reads, scaled to the export height the same way.
    const capStyle = project.captionTracks[0]!.style;
    const forceStyle = captionStyleToAssForceStyle(capStyle, project.canvas.height, outH);
    filterParts.push(
      `[${videoOut}]subtitles=subtitles\\:captions.srt:force_style='${forceStyle}'[${next}]`,
    );
    videoOut = next;
  }

  // ── 4b. Text overlays via `drawtext` — ABOVE video+captions, BELOW the watermark
  // (§10.1: the Free-tier watermark must always win). Each `kind:"text"` overlay burns
  // in with the SHARED layout helper (so it matches the preview), Inter, escape-safe
  // `textfile=`, and `enable=between(t,...)` timing. No-op (label unchanged) when there
  // are no text overlays, so existing graphs/goldens are byte-identical.
  const textStage = buildTextOverlayStage(project, videoOut, outW, outH);
  for (const part of textStage.parts) filterParts.push(part);
  videoOut = textStage.outLabel;

  // ── 5. Mandatory Free-tier branding watermark — final overlay (§10.2, §10.3) ─────
  // Bottom-right, ~10% canvas width, 70% opacity (§10.2). Synthetic input the worker
  // resolves to the bundled branding asset. Only on Free (settings.watermark === true).
  if (settings.watermark) {
    const wmIndex = inputs.length;
    inputs.push({
      index: wmIndex,
      kind: "watermark",
      preArgs: [],
      path: "watermark:vf",
    });
    const wmW = Math.round(outW * 0.1);
    const scaled = "wm";
    const next = "vout";
    filterParts.push(
      `[${wmIndex}:v]scale=${wmW}:-1,format=rgba,colorchannelmixer=aa=0.7[${scaled}]`,
      // 16px inset from the bottom-right corner.
      `[${videoOut}][${scaled}]overlay=W-w-16:H-h-16[${next}]`,
    );
    videoOut = next;
  } else {
    // Ensure a stable, named final pad even with no watermark.
    const next = "vout";
    filterParts.push(`[${videoOut}]copy[${next}]`);
    videoOut = next;
  }
  const outputLabel = `[${videoOut}]`;

  // ── 6. AUDIO: per-track chain volume→pan, gated by mute/solo, then amix+alimiter ─
  // Each audible track becomes one stream [aT<n>]: its clips are placed on the
  // timeline (adelay) + per-clip gain + per-clip fades, mixed within the track, then
  // the track volume + pan apply. Tracks are summed with amix=normalize=0 (so loudness
  // == the preview mix, D-6) and an alimiter master prevents the non-normalised sum
  // from clipping (§10.3). Muted / non-soloed tracks are simply absent here (B-8/X-6).
  const trackAudioLabels: string[] = [];
  let aCounter = 0;
  for (const at of audibleTracks) {
    const clipLabels: string[] = [];
    for (const clip of at.clips) {
      const idx = clipInputIndex.get(clip.id)!;
      const steps: string[] = [];

      // Speed: atempo preserves pitch on export (§5.1, §3.3). atempo accepts 0.5–2.0;
      // chain factors for extreme speeds so the whole 0.1×–16× range is covered.
      if (clip.speed !== 1 && clip.speed > 0) {
        for (const f of atempoChain(clip.speed)) steps.push(`atempo=${f}`);
      }

      // Per-clip gain (§7.1). gain percent, 100 = 0 dB.
      const g = clip.gain ?? 100;
      if (g !== 100) steps.push(`volume=${gainMul(g)}`);

      // Per-clip linear fade in/out (§7.1, §3.2) from the clip's fade fields. afade
      // operates on the post-atempo local stream, whose duration is the trimmed span
      // divided by speed. Fade-out starts `fadeOut` before that local end.
      const speed = clip.speed > 0 ? clip.speed : 1;
      const localDurSec = (clip.trimOut - clip.trimIn) / 1000 / speed;
      const fadeInSec = (clip.fadeInMs ?? 0) / 1000;
      const fadeOutSec = (clip.fadeOutMs ?? 0) / 1000;
      if (fadeInSec > 0) {
        steps.push(`afade=t=in:st=0:d=${msToSec(Math.round(Math.min(fadeInSec, localDurSec) * 1000))}`);
      }
      if (fadeOutSec > 0) {
        const stSec = Math.max(0, localDurSec - fadeOutSec);
        steps.push(`afade=t=out:st=${msToSec(Math.round(stSec * 1000))}:d=${msToSec(Math.round(fadeOutSec * 1000))}`);
      }

      // Resample to a common rate so amix has matching layouts (deterministic).
      steps.push("aresample=48000");

      // Place on the timeline: adelay by the clip start (per-channel). asetpts resets.
      if (clip.startOnTimeline > 0) {
        steps.push(`adelay=${clip.startOnTimeline}|${clip.startOnTimeline}`);
      }

      const label = `ac${idx}`;
      filterParts.push(`[${idx}:a]${steps.join(",")}[${label}]`);
      clipLabels.push(label);
    }

    // Sum the track's own clips (if >1) before applying track-level volume/pan.
    let trackInner: string;
    if (clipLabels.length === 0) {
      continue; // empty audio track contributes nothing
    } else if (clipLabels.length === 1) {
      trackInner = clipLabels[0]!;
    } else {
      const mixed = `amx${aCounter}`;
      filterParts.push(
        `${clipLabels.map((l) => `[${l}]`).join("")}amix=inputs=${clipLabels.length}:normalize=0[${mixed}]`,
      );
      trackInner = mixed;
    }

    // Track chain: volume → pan (§10.3 per-track chain order). volume percent 0–200.
    const trackSteps: string[] = [];
    if (at.volume !== 100) trackSteps.push(`volume=${gainMul(at.volume)}`);
    if (at.pan !== 0) trackSteps.push(panExpr(at.pan));
    const aLabel = `aT${aCounter++}`;
    if (trackSteps.length > 0) {
      filterParts.push(`[${trackInner}]${trackSteps.join(",")}[${aLabel}]`);
    } else {
      filterParts.push(`[${trackInner}]anull[${aLabel}]`);
    }
    trackAudioLabels.push(aLabel);
  }

  // Master bus: amix=normalize=0 (sum, not 1/N) then alimiter to prevent clipping.
  let audioOut: string | null = null;
  if (trackAudioLabels.length === 1) {
    audioOut = "aout";
    filterParts.push(`[${trackAudioLabels[0]!}]alimiter=limit=0.98[${audioOut}]`);
  } else if (trackAudioLabels.length > 1) {
    const summed = "amaster";
    filterParts.push(
      `${trackAudioLabels.map((l) => `[${l}]`).join("")}amix=inputs=${trackAudioLabels.length}:normalize=0[${summed}]`,
    );
    audioOut = "aout";
    filterParts.push(`[${summed}]alimiter=limit=0.98[${audioOut}]`);
  }

  // ── 7. Assemble argv ────────────────────────────────────────────────────────────
  const filterComplex = filterParts.join(";");

  const args: string[] = [];
  // Deterministic global flags.
  args.push("-y", "-hide_banner", "-nostdin");

  // Inputs in declared order, each with its pre-input args (accurate seek etc.).
  for (const inp of inputs) {
    args.push(...inp.preArgs, "-i", inp.path);
  }

  args.push("-filter_complex", filterComplex);

  // Map video; map audio only if present.
  args.push("-map", outputLabel);
  if (audioOut) args.push("-map", `[${audioOut}]`);

  // Video encode: H.264, CRF, target fps, yuv420p for broad playback. (§3.8)
  args.push(
    "-c:v",
    "libx264",
    "-crf",
    String(crf),
    "-pix_fmt",
    "yuv420p",
    "-r",
    String(fps),
    "-preset",
    "medium",
  );

  // Audio encode: AAC stereo (MVP).
  if (audioOut) {
    args.push("-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2");
  }

  // Output-duration cap (the runaway-export fix, belt-and-suspenders with the base
  // `:d=` above). `-t` is an OUTPUT option (placed before the output filename) that
  // stops the encode at the timeline length even if some input were unbounded. Both
  // bounds derive from the same projectDurationMs, so they agree and parity holds:
  // the MP4 is exactly as long as the timeline the client previewed.
  args.push("-t", durationSec);

  // Sidecar caption note: when captions === "sidecar" the worker writes captionsToSrt()
  // to a .srt next to the MP4 (§10.1 Advanced) — no graph change, so nothing here.

  args.push("-movflags", "+faststart", "out.mp4");

  return {
    args,
    filterComplex,
    inputs,
    outputLabel,
    textFiles: textStage.textFiles,
    fonts: textStage.fonts,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// atempo decomposition: FFmpeg `atempo` only accepts 0.5–2.0 per instance, so a
// speed outside that range is expressed as a deterministic product of in-range
// factors (§5.1 pitch-preserving export across the 0.1×–16× range, MVP_Scope §3.3).
// ─────────────────────────────────────────────────────────────────────────────
export function atempoChain(speed: number): string[] {
  const factors: number[] = [];
  let remaining = speed;
  while (remaining > 2.0 + 1e-9) {
    factors.push(2.0);
    remaining /= 2.0;
  }
  while (remaining < 0.5 - 1e-9) {
    factors.push(0.5);
    remaining /= 0.5;
  }
  factors.push(remaining);
  return factors.map((f) => f.toFixed(6).replace(/\.?0+$/, ""));
}

// ─────────────────────────────────────────────────────────────────────────────
// Per-clip opacity.
//
// The §18 Clip type (video/audio) has no first-class `opacity` field — per-clip
// opacity for media clips is an MVP extension surfaced via keyframes in the editor
// and is OUT of the locked schema subset (MVP_Scope §0.4). To honour the contract's
// "per-clip opacity" requirement without mutating the shared schema, we read an
// optional constant `opacity` keyframe (first value, 0–100) when present, else 100.
// Pure standalone function — no prototype/global mutation.
// MVP-STUB: see §10.3 — full keyframed opacity animates via overlay alpha per frame.
// ─────────────────────────────────────────────────────────────────────────────
function clipOpacityPercent(clip: Clip): number {
  const kf = clip.keyframes["opacity"];
  if (kf && kf.length > 0 && typeof kf[0]!.value === "number") {
    const v = kf[0]!.value;
    return Math.max(0, Math.min(100, v));
  }
  return 100;
}
