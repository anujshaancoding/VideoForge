// ─────────────────────────────────────────────────────────────────────────────
// PreviewEngine — Canvas 2D composite loop for VideoForge (§5.1).
//
// Decodes proxy media and composites it to an HTMLCanvasElement. Timing is slaved
// to AudioContext.currentTime (the AudioEngine master clock) — never wall-clock —
// so A/V drift is structurally impossible.
//
// Source resolution: clips reference media by `sourceAssetId` only. The engine
// resolves each id → a real, presigned proxy URL via the asset registry
// (store/assetStore). It does NOT synthesise URLs (the old code guessed
// `localhost:9000/proxy/<id>.mp4`, which never matched MinIO and never decoded).
//
// Decoders are pooled PER ASSET (one HTMLVideoElement / HTMLImageElement per
// source), so a track with many clips — or several clips sharing one source —
// all render correctly (the old code only ever decoded each track's FIRST clip).
//
// All visible video clips at the playhead are composited bottom-up (track array
// index 0 = bottom layer, §18 z-order), then overlay tracks on top.
//
// Color grade: applied here so preview matches the FFmpeg `eq` export. The match
// is done with an offscreen WebGL pass (see ColorGrader) rather than CSS filters,
// which use different math/colour-space and break preview==export parity.
// ─────────────────────────────────────────────────────────────────────────────

import type { AudioEngine } from "./AudioEngine.js";
import type { Clip, Project, TextOverlay, ImageOverlay, Keyframe } from "@videoforge/project-schema";
// Shared text-overlay layout — the ONE percent→pixel/size/floor/outline-scale formula
// the FFmpeg export also consumes, so preview geometry == export drawtext (§7.5).
// `weightToInterFile` is export-only; preview keeps the CSS `Inter` family.
import { layoutTextOverlay, weightToInterFace, DEFAULT_LINE_HEIGHT } from "@videoforge/project-schema";

/**
 * CSS numeric weight of the bundled Inter face a numeric weight buckets into.
 * Keyed on weightToInterFace() (the export's single source of truth) so the preview
 * canvas snaps to the SAME Inter face the export selects — no preview≠export drift.
 */
const INTER_FACE_CSS_WEIGHT: Record<string, number> = {
  Regular: 400,
  Medium: 500,
  SemiBold: 600,
  Bold: 700,
  ExtraBold: 800,
};
import { getAssetMeta } from "../store/assetStore.js";
import { ColorGrader } from "./ColorGrader.js";
import { useEditorStore } from "../store/editorStore.js";
import { isPlaceholderClip } from "../lib/templates.js";
import { resolveManifest } from "../store/templateStore.js";

// ── Clip-colour palette (stub fallback while a proxy loads / is unresolved) ────
const CLIP_PALETTE = ["#2BC4B0", "#22A0C4", "#5B8DEF", "#7C6BEF", "#9E6BEF", "#2BC48A"];
function colourForSource(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return CLIP_PALETTE[h % CLIP_PALETTE.length]!;
}

/** Maps demo-video:xxx asset ids (used by templates) to their public static video URL. */
const DEMO_VIDEO_SRC: Record<string, string> = {
  "demo-video:summer-sale": "/demo-videos/summer-sale-demo.mp4",
  "demo-video:product-launch": "/demo-videos/product-launch-demo.mp4",
  "demo-video:ig-reel": "/demo-videos/ig-reel-demo.mp4",
};

/** Minimum gap between store playhead emits (ms): keeps setState out of the per-frame hot path.
    Slightly higher during sustained playback to reduce main-thread pressure and help sustain ≥1× realtime. */
const PLAYHEAD_EMIT_INTERVAL_MS = 66; // ~15 fps UI updates is plenty for timecode/scrub feel while playing

// ── Per-asset decoder (pooled by sourceAssetId) ───────────────────────────────

interface AssetDecoder {
  kind: "video" | "image";
  proxyUrl: string;
  videoEl: HTMLVideoElement | null;
  imageEl: HTMLImageElement | null;
  /** Last asset-relative seconds we asked the <video> to seek to. */
  lastSeekSec: number;
  /** True once metadata / image bytes are ready to draw. */
  ready: boolean;
  /** True while waiting for a `seeked` event (one in-flight seek at a time). */
  seeking: boolean;
  /** True once at least one real frame has been drawn — suppresses the stub flash. */
  everReady: boolean;
}

// ── Callbacks ────────────────────────────────────────────────────────────────

export interface PreviewEngineCallbacks {
  onPlayheadUpdate: (ms: number) => void;
  onPlaybackEnded: () => void;
}

// ── PreviewEngine ────────────────────────────────────────────────────────────

export class PreviewEngine {
  private canvas: HTMLCanvasElement | null = null;
  private ctx2d: CanvasRenderingContext2D | null = null;
  private rafId = 0;

  private project: Project | null = null;
  private audioEngine: AudioEngine | null = null;
  private grader: ColorGrader | null = null;

  private isPlaying = false;
  /** audioCtx.currentTime when play() was last called. */
  private playStartAudioTime = 0;
  /** playheadMs value when play() was last called. */
  private playStartMs = 0;
  /** performance.now() of the last store playhead emit (throttle). */
  private lastEmitAt = 0;

  /** sourceAssetId → decoder state */
  private decoders: Map<string, AssetDecoder> = new Map();

  /** demo-video:xxx → HTMLVideoElement for template demo content (bypasses normal asset registry) */
  private demoVideoEls: Map<string, HTMLVideoElement> = new Map();

  /** thumbnailUrl → HTMLImageElement for fallback when video decoder not ready yet */
  private thumbnailImages: Map<string, HTMLImageElement> = new Map();

  private onPlayheadUpdate: ((ms: number) => void) | null = null;
  private onPlaybackEnded: (() => void) | null = null;

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  init(
    canvas: HTMLCanvasElement,
    audio: AudioEngine,
    callbacks: PreviewEngineCallbacks,
  ): void {
    this.canvas = canvas;
    this.ctx2d = canvas.getContext("2d");
    this.audioEngine = audio;
    this.onPlayheadUpdate = callbacks.onPlayheadUpdate;
    this.onPlaybackEnded = callbacks.onPlaybackEnded;
    this.grader = new ColorGrader();
    this._drawFrame(this.playStartMs);
  }

  /** Push a new project snapshot; (re)creates decoders for newly-referenced assets. */
  setProject(project: Project): void {
    this.project = project;
    this._syncDecoders(project);
    if (!this.isPlaying) this._drawFrame(this.playStartMs);
  }

  play(fromMs: number): void {
    if (!this.audioEngine) return;
    this.playStartMs = fromMs;
    const ctx = this.audioEngine.audioCtx;
    this.playStartAudioTime = ctx.currentTime;
    this.isPlaying = true;
    this.audioEngine.playAll(fromMs);
    // Autoplay policy: on a fresh page load / reload the AudioContext is created
    // SUSPENDED (no prior user gesture), so `currentTime` — our master clock — is
    // frozen. We captured `playStartAudioTime` from that frozen clock, so without
    // this the playhead never advances and the video sits stuck on one frame.
    // Re-anchor the clock the instant the context actually starts running so the
    // playhead begins ticking from `fromMs` exactly when audio begins.
    if (ctx.state !== "running") {
      void ctx.resume().then(() => {
        if (!this.isPlaying) return;
        // While suspended getCurrentMs() == playStartMs (frozen), so this preserves
        // the intended start position and just rebases onto the now-running clock.
        this.playStartMs = this.getCurrentMs();
        this.playStartAudioTime = ctx.currentTime;
      }).catch(() => undefined);
    }
    // Force an immediate timecode push and reset throttle so the UI updates
    // right away when the user hits Play (prevents the "button changed but time stuck at 00:00" symptom).
    this.lastEmitAt = 0;
    this.onPlayheadUpdate?.(Math.round(fromMs));
    cancelAnimationFrame(this.rafId);
    this._drawLoop();
  }

  pause(): void {
    this.isPlaying = false;
    this.audioEngine?.pauseAll();
    cancelAnimationFrame(this.rafId);
    this.playStartMs = this.getCurrentMs();
    this.lastEmitAt = 0;
    // Stop every pooled <video> so none keep advancing in the background.
    for (const d of this.decoders.values()) {
      if (d.videoEl && !d.videoEl.paused) d.videoEl.pause();
    }
  }

  seekTo(ms: number): void {
    this.playStartMs = Math.max(0, ms);
    this.playStartAudioTime = this.audioEngine?.audioCtx.currentTime ?? 0;
    this.lastEmitAt = 0;
    if (!this.isPlaying) this._drawFrame(this.playStartMs);
  }

  /** Current playhead in ms, synced to AudioContext while playing. */
  getCurrentMs(): number {
    if (!this.isPlaying || !this.audioEngine) return this.playStartMs;
    const elapsed = (this.audioEngine.audioCtx.currentTime - this.playStartAudioTime) * 1000;
    return Math.max(0, this.playStartMs + elapsed);
  }

  destroy(): void {
    this.isPlaying = false;
    cancelAnimationFrame(this.rafId);
    for (const decoder of this.decoders.values()) {
      if (decoder.videoEl) {
        decoder.videoEl.src = "";
        decoder.videoEl.load();
      }
    }
    this.decoders.clear();
    for (const v of this.demoVideoEls.values()) {
      v.src = "";
      v.load();
    }
    this.demoVideoEls.clear();
    for (const img of this.thumbnailImages.values()) {
      try { img.src = ""; } catch {}
    }
    this.thumbnailImages.clear();
    this.grader?.destroy();
    this.grader = null;
    this.canvas = null;
    this.ctx2d = null;
  }

  // ── Private: draw loop ─────────────────────────────────────────────────────

  private _drawLoop(): void {
    if (!this.isPlaying) return;

    const currentMs = this.getCurrentMs();

    // Throttle the store playhead emit so we don't setState every animation frame
    // (the spec mandates refs, not setState, in the RAF loop — §3.3). The canvas
    // itself still redraws every frame from the engine's own clock.
    const now = typeof performance !== "undefined" ? performance.now() : 0;
    if (now - this.lastEmitAt >= PLAYHEAD_EMIT_INTERVAL_MS) {
      this.lastEmitAt = now;
      this.onPlayheadUpdate?.(Math.round(currentMs));
    }

    const durationMs = this._projectDurationMs();
    if (durationMs > 0 && currentMs >= durationMs) {
      this.isPlaying = false;
      cancelAnimationFrame(this.rafId);
      this.playStartMs = durationMs;
      this.audioEngine?.pauseAll();
      this.onPlayheadUpdate?.(durationMs);
      this.onPlaybackEnded?.();
      this._drawFrame(durationMs);
      return;
    }

    this._drawFrame(currentMs);
    this.rafId = requestAnimationFrame(() => this._drawLoop());
  }

  // ── Private: single-frame composite ────────────────────────────────────────

  private _drawFrame(playheadMs: number): void {
    const canvas = this.canvas;
    const ctx = this.ctx2d;
    const project = this.project;
    if (!canvas || !ctx || !project) return;

    const w = canvas.width;
    const h = canvas.height;

    ctx.fillStyle = project.canvas.backgroundColor || "#111111";
    ctx.fillRect(0, 0, w, h);

    // Visible video clips at this playhead, bottom-up (track array order = z-order).
    const videoTracks = project.tracks.filter((t) => t.type === "video");
    const visibleClips: Clip[] = [];
    for (const track of videoTracks) {
      for (const clip of track.clips) {
        if (playheadMs >= clip.startOnTimeline && playheadMs < clip.endOnTimeline) {
          visibleClips.push(clip);
        }
      }
    }

    // Only show the generic "No clip at the playhead" message when there is literally
    // no video content (real or placeholder) at the current time. Template placeholders
    // will draw their own grey rect + label below.
    const hasAnyVideoContent = visibleClips.length > 0;
    if (!hasAnyVideoContent) {
      ctx.fillStyle = "#5A6273";
      ctx.font = "14px Inter, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("No clip at the playhead", w / 2, h / 2);
      ctx.textAlign = "left";
    }

    for (const clip of visibleClips) {
      this._drawVideoClip(ctx, clip, playheadMs, w, h);
    }

    // Pause any <video> elements belonging to clips that are not visible at the
    // current playhead. With per-clip decoders this prevents a PiP (or any layered
    // video) from continuing to advance its own timeline when it is off-screen.
    if (this.isPlaying) {
      const visibleClipIds = new Set(visibleClips.map((c) => c.id));
      for (const [key, d] of this.decoders) {
        if (d.videoEl && !d.videoEl.paused && !visibleClipIds.has(key)) {
          d.videoEl.pause();
        }
      }
    }

    this._drawOverlays(ctx, project, playheadMs, w, h);
  }

  private _drawVideoClip(
    ctx: CanvasRenderingContext2D,
    clip: Clip,
    playheadMs: number,
    w: number,
    h: number,
  ): void {
    // Demo videos for templates — these have real playable video content (generated
    // short demo clips) so the template preview feels like it has actual video playing.
    if (clip.sourceAssetId?.startsWith("demo-video:")) {
      this._drawDemoVideoClip(ctx, clip, playheadMs, w, h);
      return;
    }

    // 1. Official template manifest placeholders (the real ones from @videoforge/templates
    //    when applied via the Templates panel). This makes the video slots show the
    //    proper labeled grey placeholder UI with the slot name (e.g. "Your product video here").
    const currentProject = this.project;
    if (currentProject) {
      const manifest = resolveManifest(currentProject);
      if (manifest && isPlaceholderClip(currentProject, manifest, clip.id)) {
        const slot = manifest.slots.find(
          (s) => s.target.type === "clip" && s.target.clipId === clip.id
        );
        const label = slot?.label || "Replace with your media";
        this._drawPlaceholderRect(ctx, clip, w, h, label, playheadMs);
        return;
      }
    }

    // 2. Client-driven placeholders (synthetic templates created in TemplatesPanel).
    const phLabel = useEditorStore.getState().placeholderLabels?.[clip.id];
    if (phLabel) {
      this._drawPlaceholderRect(ctx, clip, w, h, phLabel, playheadMs);
      return;
    }

    // Prefer per-clip decoder (new for layered videos / PiP). Fall back to old asset key
    // for any legacy decoders that might still exist during transition.
    let decoder = this.decoders.get(clip.id);
    if (!decoder) decoder = this.decoders.get(clip.sourceAssetId);
    if (!decoder || !decoder.ready) {
      // Only show the loading state (thumb preferred, else colour stub) before the
      // FIRST real frame; never flash it back over a clip that has already rendered
      // (prevents the previous "blue screen" / stub overlay during playback).
      if (!decoder?.everReady) this._drawVideoLoadingState(ctx, clip, w, h);
      return;
    }

    let drawable: CanvasImageSource | null = null;
    if (decoder.kind === "video" && decoder.videoEl) {
      const videoEl = decoder.videoEl;
      const timelineOffset = playheadMs - clip.startOnTimeline;
      const assetSec = (clip.trimIn + timelineOffset * clip.speed) / 1000;
      if (this.isPlaying) {
        // PLAY the muted element so frames flow continuously. Seeking every frame
        // kept readyState below HAVE_CURRENT_DATA, so the stub painted over the
        // video (the blue overlay). Audio is the AudioEngine's job; this element
        // stays muted. Correct drift from the master clock only past a (now looser) threshold.
        const rate = clip.speed > 0 ? clip.speed : 1;
        if (videoEl.playbackRate !== rate) videoEl.playbackRate = rate;
        // Throttle .play() attempts — repeated calls while already playing add overhead.
        const now = (typeof performance !== "undefined" ? performance.now() : Date.now());
        if (videoEl.paused && (now - ((decoder as any)._lastPlayAttempt || 0) > 120)) {
          (decoder as any)._lastPlayAttempt = now;
          void videoEl.play().catch(() => undefined);
        }
        const DRIFT_TOLERANCE_SEC = 0.6; // looser to reduce main-thread seek/decode stalls during playback
        if (!decoder.seeking && Math.abs(videoEl.currentTime - assetSec) > DRIFT_TOLERANCE_SEC) {
          decoder.seeking = true;
          decoder.lastSeekSec = assetSec;
          videoEl.currentTime = Math.max(0, Math.min(assetSec, videoEl.duration || assetSec));
        }
      } else {
        // Paused / scrubbing: pause the element and seek to the exact frame.
        if (!videoEl.paused) videoEl.pause();
        const SEEK_THRESHOLD_SEC = 0.033; // ~1 frame at 30fps — less aggressive seeking while paused/scrubbing
        if (Math.abs(decoder.lastSeekSec - assetSec) > SEEK_THRESHOLD_SEC && !decoder.seeking) {
          decoder.seeking = true;
          decoder.lastSeekSec = assetSec;
          videoEl.currentTime = Math.max(0, Math.min(assetSec, videoEl.duration || assetSec));
        }
      }
      if (videoEl.readyState >= 2 /* HAVE_CURRENT_DATA */) {
        drawable = videoEl;
        decoder.everReady = true;
      }
    } else if (decoder.kind === "image" && decoder.imageEl) {
      drawable = decoder.imageEl;
      decoder.everReady = true;
    }

    if (!drawable) {
      if (!decoder.everReady) this._drawVideoLoadingState(ctx, clip, w, h);
      return;
    }

    // Destination rect on the canvas: the clip's PiP box if it has a transform,
    // else the full frame. Mirrors the export (scale-to-box + overlay-at-position),
    // so a moved/resized clip looks identical in the export — fidelity invariant.
    const tf = clip.transform;
    let sx = tf ? (tf.x / 100) * w : 0;
    let sy = tf ? (tf.y / 100) * h : 0;
    let sw = tf ? (tf.width / 100) * w : w;
    let sh = tf ? (tf.height / 100) * h : h;

    // Ken Burns scale ramp (matches the export `zoompan` direction), centred on the box.
    if (clip.kenBurns) {
      const { startScale, endScale } = clip.kenBurns;
      const clipDuration = clip.endOnTimeline - clip.startOnTimeline;
      const progress = clipDuration > 0
        ? Math.max(0, Math.min(1, (playheadMs - clip.startOnTimeline) / clipDuration))
        : 0;
      const scale = startScale + (endScale - startScale) * progress;
      const cx = sx + sw / 2;
      const cy = sy + sh / 2;
      sw *= scale;
      sh *= scale;
      sx = cx - sw / 2;
      sy = cy - sh / 2;
    }

    try {
      if (clip.colorGrade && this.grader) {
        // Offscreen WebGL `eq`-equivalent pass → parity with the FFmpeg export.
        const graded = this.grader.apply(drawable, w, h, clip.colorGrade);
        if (graded) drawable = graded;
      }
      // Per-clip opacity: interpolated across the 'opacity' keyframes at the current
      // playhead (matches the export's keyframe curve — §3.7 / preview==export). With
      // 0/1 keyframe this is just the constant value, exactly as before.
      const opacity = this._clipOpacity(clip, playheadMs);
      const prevAlpha = ctx.globalAlpha;
      if (opacity < 100) ctx.globalAlpha = opacity / 100;

      // The display rect (PiP box, or full frame) — also the flip pivot.
      const rx = tf ? (tf.x / 100) * w : 0;
      const ry = tf ? (tf.y / 100) * h : 0;
      const rw = tf ? (tf.width / 100) * w : w;
      const rh = tf ? (tf.height / 100) * h : h;

      ctx.save();
      // Clip a PiP box so Ken Burns / overscan / flip don't spill outside it.
      if (tf) {
        ctx.beginPath();
        ctx.rect(rx, ry, rw, rh);
        ctx.clip();
      }
      // Mirror around the rect centre (matches export hflip/vflip).
      if (clip.flipH || clip.flipV) {
        const mx = rx + rw / 2;
        const my = ry + rh / 2;
        ctx.translate(mx, my);
        ctx.scale(clip.flipH ? -1 : 1, clip.flipV ? -1 : 1);
        ctx.translate(-mx, -my);
      }
      ctx.drawImage(drawable, sx, sy, sw, sh);
      ctx.restore();
      ctx.globalAlpha = prevAlpha;
    } catch {
      this._drawStubRect(ctx, clip, w, h);
    }
  }

  /**
   * Per-clip opacity (0–100) at the given absolute-timeline playhead, INTERPOLATED
   * across the clip's `opacity` keyframes (§3.7 keyframe engine). With 0 keyframes →
   * 100; with 1 keyframe (or all equal) → that constant value, identical to the old
   * first-keyframe behaviour. With ≥2 distinct keyframes → the sampled curve.
   *
   * THE INVARIANT: this MUST sample the exact same curve the export emits. The
   * per-segment easing→value math lives in the shared helpers below (_easedProgress /
   * _sampleKeyframes), which are a verbatim twin of buildFilterComplex.ts's
   * easedProgress / sampleNumericKeyframes — the same shared-helper discipline as
   * layoutTextOverlay. Keyframe `timeMs` is ABSOLUTE timeline ms (the editor authors
   * it from the global playhead), so we sample with `playheadMs` directly.
   */
  private _clipOpacity(clip: Clip, playheadMs: number): number {
    const kfs = this._numericKeyframes(clip, "opacity");
    if (kfs.length === 0) return 100;
    const v = this._sampleKeyframes(kfs, playheadMs, 100);
    return Math.max(0, Math.min(100, v));
  }

  /** Numeric, time-ordered keyframes for a property (drops non-numeric). Twin of the export. */
  private _numericKeyframes(
    clip: Clip,
    property: string,
  ): Array<{ timeMs: number; value: number; easing: Keyframe["easing"] }> {
    const raw = clip.keyframes[property];
    if (!raw || raw.length === 0) return [];
    const out: Array<{ timeMs: number; value: number; easing: Keyframe["easing"] }> = [];
    for (const kf of raw) {
      if (typeof kf.value === "number") out.push({ timeMs: kf.timeMs, value: kf.value, easing: kf.easing });
    }
    return out.sort((a, b) => a.timeMs - b.timeMs);
  }

  /**
   * SHARED easing curve — MUST be byte-identical to buildFilterComplex.ts easedProgress.
   * `hold` steps (stays at the start value); ease* use the standard quadratic curves;
   * everything else (linear/bezier) is linear. The Inspector only authors "linear"
   * today; the rest are supported for forward-compat with the schema's easing field.
   */
  private _easedProgress(
    u: number,
    easing: Keyframe["easing"],
  ): number {
    const x = u < 0 ? 0 : u > 1 ? 1 : u;
    switch (easing) {
      case "hold":
        return 0;
      case "easeIn":
        return x * x;
      case "easeOut":
        return x * (2 - x);
      case "easeInOut":
        return x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2;
      case "bezier":
      case "linear":
      default:
        return x;
    }
  }

  /**
   * SHARED sampler — value of a numeric keyframe track at absolute-timeline `timeMs`,
   * clamping the constant ends. MUST match buildFilterComplex.ts sampleNumericKeyframes.
   */
  private _sampleKeyframes(
    kfs: Array<{ timeMs: number; value: number; easing: Keyframe["easing"] }>,
    timeMs: number,
    fallback: number,
  ): number {
    if (kfs.length === 0) return fallback;
    if (kfs.length === 1 || timeMs <= kfs[0]!.timeMs) return kfs[0]!.value;
    const last = kfs[kfs.length - 1]!;
    if (timeMs >= last.timeMs) return last.value;
    for (let i = 0; i < kfs.length - 1; i++) {
      const a = kfs[i]!;
      const b = kfs[i + 1]!;
      if (timeMs >= a.timeMs && timeMs <= b.timeMs) {
        const span = b.timeMs - a.timeMs;
        const u = span > 0 ? (timeMs - a.timeMs) / span : 0;
        const e = this._easedProgress(u, a.easing);
        return a.value + (b.value - a.value) * e;
      }
    }
    return last.value;
  }

  private _drawStubRect(
    ctx: CanvasRenderingContext2D,
    clip: Clip,
    w: number,
    h: number,
  ): void {
    // Colored placeholder while a clip's proxy is still decoding / not ready.
    // No debug "loading · id" label (was leaking into production UI).
    // Respects the clip's transform box (PiP) so only the clip area shows the
    // stub colour instead of overpainting the entire canvas (dark surround remains).
    const tf = clip.transform;
    const rx = tf ? (tf.x / 100) * w : 0;
    const ry = tf ? (tf.y / 100) * h : 0;
    const rw = tf ? (tf.width / 100) * w : w;
    const rh = tf ? (tf.height / 100) * h : h;

    ctx.save();
    if (tf) {
      ctx.beginPath();
      ctx.rect(rx, ry, rw, rh);
      ctx.clip();
    }
    ctx.fillStyle = colourForSource(clip.sourceAssetId);
    ctx.fillRect(rx, ry, rw, rh);
    // Subtle bottom bar (scaled for small PiP boxes).
    const barH = Math.max(4, Math.min(18, rh * 0.12));
    ctx.fillStyle = "rgba(0,0,0,0.25)";
    ctx.fillRect(rx, ry + rh - barH, rw, barH);
    ctx.restore();
  }

  /**
   * Draws a thumbnail (from asset meta.thumbnailUrl) as a frozen-frame fallback
   * when the real video decoder is not yet ready (initial load, buffering, no proxy yet).
   * This prevents the solid colour stub ("blue screen") while still showing
   * meaningful content for the clip's on-canvas box (full or PiP transform).
   * Thumbnails are cached by URL in thumbnailImages (populated on demand).
   */
  private _drawThumbnailRect(
    ctx: CanvasRenderingContext2D,
    clip: Clip,
    w: number,
    h: number,
    thumbnailUrl: string,
  ): void {
    const tf = clip.transform;
    const rx = tf ? (tf.x / 100) * w : 0;
    const ry = tf ? (tf.y / 100) * h : 0;
    const rw = tf ? (tf.width / 100) * w : w;
    const rh = tf ? (tf.height / 100) * h : h;

    let img = this.thumbnailImages.get(thumbnailUrl);
    if (!img) {
      img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => {
        // Force a paint when paused so the thumb appears immediately after load.
        // During playback the next _drawFrame will see img.complete and use it.
        if (!this.isPlaying) this._drawFrame(this.playStartMs);
      };
      img.onerror = () => {
        // Keep the entry; caller will have fallen back or will retry on next draw.
      };
      img.src = thumbnailUrl;
      this.thumbnailImages.set(thumbnailUrl, img);
    }

    ctx.save();
    if (tf) {
      ctx.beginPath();
      ctx.rect(rx, ry, rw, rh);
      ctx.clip();
    }
    if (img.complete && img.naturalWidth > 0) {
      ctx.drawImage(img, rx, ry, rw, rh);
    } else {
      // Still loading the thumbnail bytes: dark fill inside the clip box
      // (prevents flash of palette colour and keeps the area distinct).
      ctx.fillStyle = "#1f2937";
      ctx.fillRect(rx, ry, rw, rh);
    }
    ctx.restore();
  }

  /**
   * Unified fallback used while a video clip's decoder is not ready or has
   * no current drawable frame. Prefers the asset's thumbnail (if present)
   * so the user sees a real frame from their media instead of a solid
   * colour stub. Only used before everReady to avoid flashing the still
   * back over live video during playback.
   */
  private _drawVideoLoadingState(
    ctx: CanvasRenderingContext2D,
    clip: Clip,
    w: number,
    h: number,
  ): void {
    const meta = getAssetMeta(clip.sourceAssetId);
    const thumbUrl = meta?.thumbnailUrl;
    if (thumbUrl) {
      this._drawThumbnailRect(ctx, clip, w, h, thumbUrl);
    } else {
      this._drawStubRect(ctx, clip, w, h);
    }
  }

  /** 
   * Placeholder for unfilled template video slots.
   * Now renders a rich, animated "demo video" preview so templates feel alive
   * with actual moving video content (procedural for "Summer Sale Promo" etc.).
   * When the user drops real media, the real video takes over.
   * Respects the clip's transform box.
   */
  private _drawPlaceholderRect(
    ctx: CanvasRenderingContext2D,
    clip: Clip,
    w: number,
    h: number,
    label: string,
    playheadMs: number = 0,
  ): void {
    const isPlaying = this.isPlaying;
    const t = playheadMs / 1000; // seconds for easier animation

    const tf = clip.transform;
    const rx = tf ? (tf.x / 100) * w : 0;
    const ry = tf ? (tf.y / 100) * h : 0;
    const rw = tf ? (tf.width / 100) * w : w;
    const rh = tf ? (tf.height / 100) * h : h;

    ctx.save();
    if (tf) {
      ctx.beginPath();
      ctx.rect(rx, ry, rw, rh);
      ctx.clip();
    }

    // === Rich demo "video" content for the template slot ===
    // Cinematic dark background with moving light / sale energy
    const grad = ctx.createLinearGradient(rx, ry, rx, ry + rh);
    grad.addColorStop(0, "#0f172a");
    grad.addColorStop(0.5, "#1e2937");
    grad.addColorStop(1, "#0f172a");
    ctx.fillStyle = grad;
    ctx.fillRect(rx, ry, rw, rh);

    // Moving diagonal "promo beams" / light rays (feels like dynamic video)
    ctx.strokeStyle = "rgba(251, 191, 36, 0.15)"; // warm sale gold
    ctx.lineWidth = Math.max(2, rw * 0.008);
    const beamOffset = ((t * 45) % (rw + rh)) - rw * 0.2;
    for (let i = -1; i <= 2; i++) {
      const x1 = rx + beamOffset + i * (rw * 0.35);
      ctx.beginPath();
      ctx.moveTo(x1, ry);
      ctx.lineTo(x1 + rw * 0.6, ry + rh);
      ctx.stroke();
    }

    // Subtle pulsing vignette / focus on center "product" area
    const cx = rx + rw / 2;
    const cy = ry + rh * 0.48;
    const pulse = 0.85 + Math.sin(t * 2.2) * 0.08;

    // Central "product" placeholder shape (phone / box / bottle silhouette)
    ctx.fillStyle = "#334155";
    const prodW = rw * 0.22 * pulse;
    const prodH = rh * 0.38 * pulse;
    ctx.fillRect(cx - prodW / 2, cy - prodH / 2, prodW, prodH);

    // Screen/highlight on the "product"
    ctx.fillStyle = "rgba(148, 163, 184, 0.25)";
    ctx.fillRect(cx - prodW * 0.38, cy - prodH * 0.32, prodW * 0.76, prodH * 0.45);

    // Big animated "50% OFF" style sale text (demo content)
    ctx.fillStyle = "#f59e0b";
    ctx.font = `bold ${Math.max(14, Math.min(32, rw / 9))}px Inter, system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const saleScale = 0.92 + Math.sin(t * 3.5) * 0.06;
    ctx.save();
    ctx.translate(cx, cy - rh * 0.18);
    ctx.scale(saleScale, saleScale);
    ctx.fillText("50% OFF", 0, 0);
    ctx.restore();

    // "SUMMER SALE" small kicker
    ctx.fillStyle = "#e0e7ff";
    ctx.font = `${Math.max(8, Math.min(14, rw / 18))}px Inter, system-ui, sans-serif`;
    ctx.fillText("SUMMER SALE", cx, cy + rh * 0.08);

    // Moving particles / confetti / sparkles for energy (sale promo feel)
    ctx.fillStyle = "rgba(251, 191, 36, 0.7)";
    for (let i = 0; i < 6; i++) {
      const p = (t * 1.6 + i * 1.7) % 1;
      const px = rx + (0.2 + (i % 3) * 0.28) * rw + Math.sin(t * 2 + i) * 6;
      const py = ry + rh * (0.25 + p * 0.55);
      const size = 1.5 + Math.sin(t * 4 + i) * 0.8;
      ctx.beginPath();
      ctx.arc(px, py, size, 0, Math.PI * 2);
      ctx.fill();
    }

    // Classic video scan lines + the blue playhead scan line on top (our previous animation)
    ctx.strokeStyle = "rgba(15, 23, 42, 0.35)";
    ctx.lineWidth = 1;
    for (let y = ry + 6; y < ry + rh - 6; y += 3.5) {
      ctx.beginPath();
      ctx.moveTo(rx + 4, y);
      ctx.lineTo(rx + rw - 4, y);
      ctx.stroke();
    }

    // Prominent moving blue scan line (shows "playback is happening")
    ctx.strokeStyle = "rgba(96, 165, 250, 0.55)";
    ctx.lineWidth = Math.max(1.5, rw * 0.004);
    const scanY = ry + ((t * 38) % (rh * 0.82)) + rh * 0.09;
    ctx.beginPath();
    ctx.moveTo(rx + 6, scanY);
    ctx.lineTo(rx + rw - 6, scanY);
    ctx.stroke();

    // The user label / instruction (subtle, at bottom)
    ctx.fillStyle = "rgba(226, 232, 240, 0.85)";
    ctx.font = `${Math.max(9, Math.min(13, rw / 22))}px Inter, system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    const display = label.length > 28 ? label.slice(0, 25) + "…" : label;
    ctx.fillText(display, cx, ry + rh - Math.max(12, rh * 0.06));

    // Small "demo" badge so it's clear this is preview content
    if (isPlaying) {
      ctx.fillStyle = "rgba(52, 211, 153, 0.85)";
      ctx.font = `600 ${Math.max(7, Math.min(9, rw / 32))}px Inter, system-ui, sans-serif`;
      ctx.fillText("DEMO", cx, ry + rh * 0.14);
    }

    ctx.restore();
    ctx.textAlign = "left";
  }

  /**
   * Draws a real demo video (from /demo-videos/) for a template slot.
   * These are the "actual videos" added to the templates so the preview has
   * playable content out of the box. The video is controlled in sync with the
   * master playhead (same drift logic as normal clips).
   */
  private _drawDemoVideoClip(
    ctx: CanvasRenderingContext2D,
    clip: Clip,
    playheadMs: number,
    w: number,
    h: number,
  ): void {
    const key = clip.sourceAssetId!;
    const src = DEMO_VIDEO_SRC[key];
    if (!src) {
      this._drawPlaceholderRect(ctx, clip, w, h, "Demo video", playheadMs);
      return;
    }

    let videoEl = this.demoVideoEls.get(key);
    if (!videoEl) {
      videoEl = document.createElement("video");
      videoEl.muted = true;
      videoEl.playsInline = true;
      videoEl.loop = true;
      videoEl.preload = "auto";
      videoEl.src = src;
      videoEl.load();
      this.demoVideoEls.set(key, videoEl);
    }

    const tf = clip.transform;
    const rx = tf ? (tf.x / 100) * w : 0;
    const ry = tf ? (tf.y / 100) * h : 0;
    const rw = tf ? (tf.width / 100) * w : w;
    const rh = tf ? (tf.height / 100) * h : h;

    const timelineOffset = playheadMs - clip.startOnTimeline;
    const assetSec = (clip.trimIn + timelineOffset * clip.speed) / 1000;
    const rate = clip.speed > 0 ? clip.speed : 1;

    if (videoEl.playbackRate !== rate) videoEl.playbackRate = rate;

    if (this.isPlaying) {
      if (videoEl.paused) void videoEl.play().catch(() => undefined);
      const DRIFT_TOL = 0.35;
      if (Math.abs(videoEl.currentTime - assetSec) > DRIFT_TOL) {
        videoEl.currentTime = Math.max(0, Math.min(assetSec, videoEl.duration || 0));
      }
    } else {
      if (!videoEl.paused) videoEl.pause();
      const SEEK_TOL = 0.03;
      if (Math.abs(videoEl.currentTime - assetSec) > SEEK_TOL) {
        videoEl.currentTime = Math.max(0, Math.min(assetSec, videoEl.duration || 0));
      }
    }

    if (videoEl.readyState >= 2 && videoEl.videoWidth > 0) {
      try {
        ctx.save();
        if (tf) {
          ctx.beginPath();
          ctx.rect(rx, ry, rw, rh);
          ctx.clip();
        }
        ctx.drawImage(videoEl, rx, ry, rw, rh);
        ctx.restore();
      } catch {
        ctx.fillStyle = "#1f2937";
        ctx.fillRect(rx, ry, rw, rh);
      }
    } else {
      // Loading state for the demo video
      ctx.fillStyle = "#1f2937";
      ctx.fillRect(rx, ry, rw, rh);
      ctx.fillStyle = "#64748b";
      ctx.font = "12px Inter, system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("Loading demo video…", rx + rw / 2, ry + rh / 2);
      ctx.textAlign = "left";
    }
  }

  private _drawOverlays(
    ctx: CanvasRenderingContext2D,
    project: Project,
    playheadMs: number,
    w: number,
    h: number,
  ): void {
    for (const track of project.tracks) {
      if (track.type !== "overlay") continue;
      for (const ov of track.clips) {
        if (playheadMs < ov.startOnTimeline || playheadMs >= ov.endOnTimeline) continue;
        const x = (ov.canvasX / 100) * w;
        const y = (ov.canvasY / 100) * h;
        const bw = (ov.width / 100) * w;
        const bh = (ov.height / 100) * h;
        ctx.globalAlpha = Math.max(0, Math.min(1, ov.opacity / 100));

        if (ov.kind === "text") {
          const textOv = ov as TextOverlay;
          const style = textOv.style;
          // Shared layout helper (project-schema §7.5): the SAME percent→pixel,
          // 12px-floor, outline-scale math the export's drawtext stage consumes, so
          // preview geometry cannot drift from the export. fontFamily stays the CSS
          // `Inter` family the canvas has always rendered (R1: export matches THIS).
          const L = layoutTextOverlay(textOv, w, h, project.canvas.height);
          ctx.fillStyle = style.color || "#FFFFFF";
          const s: any = style || {};
          // R1 premise: the export ALWAYS rasterizes bundled Inter (font-family is
          // not configurable server-side), so the preview MUST render Inter too — any
          // other family would be a preview≠export lie. The picker is removed from the
          // inspector; we hard-lock the canvas to Inter here regardless of any stored
          // legacy fontFamily value.
          // Snap the numeric weight through the SAME bucketing the export uses
          // (weightToInterFace) so both sides pick the identical Inter face.
          const cssWeight = INTER_FACE_CSS_WEIGHT[weightToInterFace(s.fontWeight || 600)] ?? 600;
          // Italic reads the §18 TextStyle field — the SAME field the export's
          // weightToInterFile() consumes — so preview and export never disagree.
          const italic = s.italic === true ? "italic " : "";
          ctx.font = `${italic}${cssWeight} ${L.fontPx}px Inter, system-ui, sans-serif`;
          ctx.textAlign =
            style.align === "right" ? "right" : style.align === "left" ? "left" : "center";
          ctx.textBaseline = "middle";
          const hasOutline = !!style.outline && L.borderPx > 0;
          if (hasOutline) {
            ctx.lineWidth = L.borderPx;
            ctx.strokeStyle = style.outline!.color;
          }
          // Multi-line: split on "\n" (no trimming) — the SAME rule the export uses
          // (spec §6.2/R6) — and vertically centre the whole block on the box mid-line
          // using line pitch = fontPx * DEFAULT_LINE_HEIGHT (1.2). For a single line
          // this is identical to the old single-fillText at y + bh/2 (no visual change).
          const lines = textOv.text.split("\n");
          const centerY = L.boxY + L.boxH / 2;
          const pitch = L.fontPx * DEFAULT_LINE_HEIGHT;
          const firstY = centerY - ((lines.length - 1) * pitch) / 2;
          for (let i = 0; i < lines.length; i++) {
            const lineY = firstY + i * pitch;
            if (hasOutline) ctx.strokeText(lines[i]!, L.anchorX, lineY);
            ctx.fillText(lines[i]!, L.anchorX, lineY);
          }
          ctx.textAlign = "left";
        } else if (ov.kind === "image") {
          const decoder = this.decoders.get((ov as ImageOverlay).sourceAssetId);
          if (decoder?.imageEl && decoder.ready) {
            try {
              ctx.drawImage(decoder.imageEl, x, y, bw, bh);
            } catch {
              this._strokePlaceholder(ctx, "image", x, y, bw, bh);
            }
          } else {
            this._strokePlaceholder(ctx, "image", x, y, bw, bh);
          }
        } else {
          this._strokePlaceholder(ctx, ov.kind, x, y, bw, bh);
        }
        ctx.globalAlpha = 1;
      }
    }
    // Burned-in captions preview (first caption track) so preview matches the export.
    this._drawCaptions(ctx, project, playheadMs, w, h);
  }

  private _strokePlaceholder(
    ctx: CanvasRenderingContext2D,
    label: string,
    x: number,
    y: number,
    bw: number,
    bh: number,
  ): void {
    ctx.strokeStyle = "#FF9EC4";
    ctx.lineWidth = 2;
    ctx.strokeRect(x, y, bw, bh);
    ctx.fillStyle = "#FF9EC4";
    ctx.font = "12px Inter, sans-serif";
    ctx.fillText(label, x + 4, y + 12);
  }

  private _drawCaptions(
    ctx: CanvasRenderingContext2D,
    project: Project,
    playheadMs: number,
    w: number,
    h: number,
  ): void {
    const ct = project.captionTracks[0];
    if (!ct || ct.muted) return;
    const block = ct.blocks.find((b) => playheadMs >= b.startMs && playheadMs < b.endMs);
    if (!block) return;
    const style = ct.style;
    const size = Math.max(14, (style.fontSize / project.canvas.height) * h);
    ctx.font = `600 ${size}px Inter, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    const cx = w / 2;
    const cy = style.position === "top" ? size * 1.5 : style.position === "center" ? h / 2 : h - size;
    if (style.outline && style.outline.width > 0) {
      ctx.lineWidth = style.outline.width * 2;
      ctx.strokeStyle = style.outline.color;
      ctx.strokeText(block.text, cx, cy);
    }
    ctx.fillStyle = style.color || "#FFFFFF";
    ctx.fillText(block.text, cx, cy);
    ctx.textAlign = "left";
  }

  // ── Private: decoder management (pooled per asset for images; per-clip for videos) ──
  // Video clips get a dedicated decoder (own <video> element + independent currentTime).
  // This prevents fast flickering when two video clips from the same source (or even
  // different sources) are visible at the same time (e.g. base video + PiP "one video
  // on top of another"). A single shared decoder cannot be at two different source
  // times simultaneously; per-clip decoders solve it cleanly.
  // Images can safely share (static).

  private _syncDecoders(project: Project): void {
    const activeKeys = new Set<string>();

    // 1. Image overlays: keep assetId-keyed decoders (safe to share the <img>)
    for (const track of project.tracks) {
      if (track.type !== "overlay") continue;
      for (const ov of track.clips) {
        if (ov.kind !== "image") continue;
        const assetId = (ov as ImageOverlay).sourceAssetId;
        const usageKey = assetId; // images stay asset-keyed
        activeKeys.add(usageKey);

        const meta = getAssetMeta(assetId);
        const proxyUrl = meta?.thumbnailUrl ?? meta?.proxyUrl ?? "";
        const existing = this.decoders.get(usageKey);
        if (existing && existing.proxyUrl === proxyUrl) continue;

        if (existing?.imageEl) {
          // no src to clear for img, just let it be replaced
        }

        if (!proxyUrl) {
          this.decoders.set(usageKey, {
            kind: "image", proxyUrl: "", videoEl: null, imageEl: null,
            lastSeekSec: -1, ready: false, seeking: false, everReady: false,
          });
          continue;
        }

        const imageEl = new Image();
        imageEl.crossOrigin = "anonymous";
        const decoder: AssetDecoder = {
          kind: "image", proxyUrl, videoEl: null, imageEl,
          lastSeekSec: -1, ready: false, seeking: false, everReady: false,
        };
        this.decoders.set(usageKey, decoder);
        imageEl.onload = () => { decoder.ready = true; if (!this.isPlaying) this._drawFrame(this.playStartMs); };
        imageEl.onerror = () => { decoder.ready = false; };
        imageEl.src = proxyUrl;
      }
    }

    // 2. Video track clips: *per-clip* decoders (keyed by clip.id) so each can have
    //    its own independent playback position / <video> element. This is the key
    //    fix for "video on top of video" flicker.
    for (const track of project.tracks) {
      if (track.type !== "video") continue;
      for (const clip of track.clips) {
        const assetId = clip.sourceAssetId;
        const usageKey = clip.id; // IMPORTANT: per clip, not per asset
        activeKeys.add(usageKey);

        const meta = getAssetMeta(assetId);
        const proxyUrl = meta?.proxyUrl ?? meta?.thumbnailUrl ?? "";
        let existing = this.decoders.get(usageKey);

        // If this clip switched assets (e.g. slot fill / replace), recreate the element
        if (existing && (existing as any)._assetId !== assetId) {
          if (existing.videoEl) {
            existing.videoEl.src = "";
            existing.videoEl.load();
          }
          existing = undefined;
        }

        const desiredKind = "video"; // video-track clips use video decoder (even for stills in some cases)
        if (existing && existing.proxyUrl === proxyUrl) continue;

        if (existing?.videoEl) {
          existing.videoEl.src = "";
          existing.videoEl.load();
        }

        if (!proxyUrl) {
          const decoder: AssetDecoder = {
            kind: desiredKind, proxyUrl: "", videoEl: null, imageEl: null,
            lastSeekSec: -1, ready: false, seeking: false, everReady: false,
          };
          (decoder as any)._assetId = assetId;
          this.decoders.set(usageKey, decoder);
          continue;
        }

        const videoEl = document.createElement("video");
        videoEl.preload = "auto";
        videoEl.crossOrigin = "anonymous";
        videoEl.muted = true;
        videoEl.playsInline = true;
        const decoder: AssetDecoder = {
          kind: desiredKind, proxyUrl, videoEl, imageEl: null,
          lastSeekSec: -1, ready: false, seeking: false, everReady: false,
        };
        (decoder as any)._assetId = assetId;
        this.decoders.set(usageKey, decoder);
        videoEl.onloadeddata = () => { decoder.ready = true; if (!this.isPlaying) this._drawFrame(this.playStartMs); };
        videoEl.onseeked = () => { decoder.seeking = false; if (!this.isPlaying) this._drawFrame(this.playStartMs); };
        videoEl.onerror = () => { decoder.ready = false; };
        videoEl.src = proxyUrl;
        videoEl.load();
      }
    }

    // 3. Drop anything (old asset keys for videos, removed clips, etc.) no longer needed
    for (const key of [...this.decoders.keys()]) {
      if (!activeKeys.has(key)) {
        const old = this.decoders.get(key);
        if (old?.videoEl) { old.videoEl.src = ""; old.videoEl.load(); }
        this.decoders.delete(key);
      }
    }
  }

  private _projectDurationMs(): number {
    if (!this.project) return 0;
    let end = 0;
    for (const track of this.project.tracks) {
      if (track.type === "caption") continue;
      for (const clip of track.clips) {
        if (clip.endOnTimeline > end) end = clip.endOnTimeline;
      }
    }
    for (const ct of this.project.captionTracks) {
      for (const block of ct.blocks) {
        if (block.endMs > end) end = block.endMs;
      }
    }
    return end;
  }
}
