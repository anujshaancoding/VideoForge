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
// inventing input files this pure builder cannot produce. Solid `drawtext`-able text
// and image overlays are also out of the M0 spine here (the editor-shell CanvasStage
// renders them in preview). Captions are the proven text→export parity surface (§22.3).
// ─────────────────────────────────────────────────────────────────────────────

import type {
  Project,
  Track,
  VideoTrack,
  AudioTrack,
  VoiceOverTrack,
  Clip,
  CaptionTrack,
  Transition,
  Effect,
} from "@videoforge/project-schema";

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

export interface BuildResult {
  /** Full argv (after the leading `ffmpeg`), deterministic and ready to spawn. */
  args: string[];
  /** The `-filter_complex` graph string (also embedded in `args`). */
  filterComplex: string;
  /** Ordered input declarations, index-aligned with the `-i` flags in `args`. */
  inputs: InputSpec[];
  /** The final mapped video pad label (e.g. "[vout]"). */
  outputLabel: string;
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
  const ext = (clip as unknown as { colorGrade?: { brightness?: number; contrast?: number; saturation?: number } }).colorGrade;
  if (!ext) return null;
  const { brightness = 0, contrast = 0, saturation = 0 } = ext;
  const b = Math.max(-1, Math.min(1, brightness / 100)).toFixed(3);
  const c = Math.max(0, Math.min(2, 1 + contrast / 100)).toFixed(3);
  const s = Math.max(0, Math.min(3, 1 + saturation / 100)).toFixed(3);
  return `eq=brightness=${b}:contrast=${c}:saturation=${s}`;
}

/**
 * M4: Read the `kenBurns` extension field and emit a `zoompan` filter string,
 * or return null if absent. Uses a slow linear zoom from startScale to endScale.
 */
function kenBurnsFilterOf(clip: Clip, outW: number, outH: number, fps: number): string | null {
  const ext = (clip as unknown as { kenBurns?: { startScale: number; endScale: number } }).kenBurns;
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
 * Serialise the FIRST caption track's blocks to an SRT string (MVP: 1 caption track,
 * MVP_Scope §1.6). Pure — the worker writes this to disk before invoking FFmpeg.
 * Exported so the sidecar-export path and tests can reuse the exact same bytes.
 */
export function captionsToSrt(track: CaptionTrack): string {
  return (
    track.blocks
      .slice()
      // Stable ordering by start time so output is deterministic regardless of input order.
      .sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs)
      .map((b, i) => `${i + 1}\n${msToSrtStamp(b.startMs)} --> ${msToSrtStamp(b.endMs)}\n${b.text}`)
      .join("\n\n") + "\n"
  );
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

      // 2b2. Ken Burns zoom-pan (M4). Applied after color grade, before scale/pad.
      //      zoompan outputs frames at the target resolution so scale/pad is a no-op.
      const kbFilter = kenBurnsFilterOf(clip, outW, outH, fps);
      if (kbFilter) steps.push(kbFilter);

      // 2c. Scale + pad to the output canvas (§10.2). force_original_aspect_ratio so
      //     letter/pillar-boxing matches the preview's fit; pad fills with canvas bg.
      const bg = project.canvas.backgroundColor.replace("#", "0x");
      steps.push(
        `scale=${outW}:${outH}:force_original_aspect_ratio=decrease`,
        `pad=${outW}:${outH}:(ow-iw)/2:(oh-ih)/2:color=${bg}`,
        "setsar=1",
      );

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
  filterParts.push(
    `color=c=${project.canvas.backgroundColor.replace("#", "0x")}:s=${outW}x${outH}:r=${fps}[${baseLabel}]`,
  );

  const transitionsByTrack = (trackId: string): Transition[] =>
    project.transitions
      .filter((t) => t.trackId === trackId && t.type === "crossfade")
      .slice()
      .sort((a, b) => a.durationMs - b.durationMs); // stable

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

      // xfade `offset` = when the crossfade begins on the FROM stream's local timeline:
      // the overlap starts durationMs before the FROM clip ends (its timeline length).
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

    // Overlay every distinct fused label for this track onto the running composite,
    // positioned at the clip's timeline start (enable window via overlay `enable`).
    const placed = new Set<string>();
    for (const clip of vt.clips) {
      const label = fusedLabel.get(clip.id)!;
      if (placed.has(label)) continue;
      placed.add(label);
      const startSec = msToSec(clip.startOnTimeline);
      const endSec = msToSec(clip.endOnTimeline);
      const next = `cmp${compositeCounter++}`;
      // overlay onto the base; PTS shift so the clip appears at its timeline position,
      // and `enable` clips the visible window so gaps reveal the canvas base (§A-13).
      filterParts.push(
        `[${baseLabel}][${label}]overlay=0:0:enable='between(t,${startSec},${endSec})':eof_action=pass[${next}]`,
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
    filterParts.push(`[${videoOut}]subtitles=subtitles\\:captions.srt[${next}]`);
    videoOut = next;
  }

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

      // Per-clip linear fade in/out from the `gain` keyframes (afade, §7.1, §3.2).
      // MVP honours a leading fade-in (value rises from 0) as `afade=t=in`.
      const gainKfs = clip.keyframes["gain"];
      if (gainKfs && gainKfs.length >= 2) {
        const first = gainKfs[0]!;
        const second = gainKfs[1]!;
        if (typeof first.value === "number" && first.value === 0 && first.timeMs < second.timeMs) {
          const dur = msToSec(second.timeMs - first.timeMs);
          steps.push(`afade=t=in:st=0:d=${dur}`);
        }
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

  // Sidecar caption note: when captions === "sidecar" the worker writes captionsToSrt()
  // to a .srt next to the MP4 (§10.1 Advanced) — no graph change, so nothing here.

  args.push("-movflags", "+faststart", "out.mp4");

  return { args, filterComplex, inputs, outputLabel };
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
