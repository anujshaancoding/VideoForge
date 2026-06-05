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
import type { Clip, Project, TextOverlay, ImageOverlay } from "@videoforge/project-schema";
// Shared text-overlay layout — the ONE percent→pixel/size/floor/outline-scale formula
// the FFmpeg export also consumes, so preview geometry == export drawtext (§7.5).
// `weightToInterFile` is export-only; preview keeps the CSS `Inter` family.
import { layoutTextOverlay, DEFAULT_LINE_HEIGHT } from "@videoforge/project-schema";
import { getAssetMeta } from "../store/assetStore.js";
import { ColorGrader } from "./ColorGrader.js";

// ── Clip-colour palette (stub fallback while a proxy loads / is unresolved) ────
const CLIP_PALETTE = ["#2BC4B0", "#22A0C4", "#5B8DEF", "#7C6BEF", "#9E6BEF", "#2BC48A"];
function colourForSource(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return CLIP_PALETTE[h % CLIP_PALETTE.length]!;
}

/** Minimum gap between store playhead emits (ms): keeps setState out of the per-frame hot path. */
const PLAYHEAD_EMIT_INTERVAL_MS = 50;

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
    this.playStartAudioTime = this.audioEngine.audioCtx.currentTime;
    this.isPlaying = true;
    this.audioEngine.playAll(fromMs);
    cancelAnimationFrame(this.rafId);
    this._drawLoop();
  }

  pause(): void {
    this.isPlaying = false;
    this.audioEngine?.pauseAll();
    cancelAnimationFrame(this.rafId);
    this.playStartMs = this.getCurrentMs();
    // Stop every pooled <video> so none keep advancing in the background.
    for (const d of this.decoders.values()) {
      if (d.videoEl && !d.videoEl.paused) d.videoEl.pause();
    }
  }

  seekTo(ms: number): void {
    this.playStartMs = Math.max(0, ms);
    this.playStartAudioTime = this.audioEngine?.audioCtx.currentTime ?? 0;
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

    if (visibleClips.length === 0) {
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

    // Pause any pooled <video> whose clip isn't visible at this playhead so a
    // background clip doesn't keep playing once the playhead leaves it.
    if (this.isPlaying) {
      const visibleAssetIds = new Set(visibleClips.map((c) => c.sourceAssetId));
      for (const [assetId, d] of this.decoders) {
        if (d.videoEl && !d.videoEl.paused && !visibleAssetIds.has(assetId)) {
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
    const decoder = this.decoders.get(clip.sourceAssetId);
    if (!decoder || !decoder.ready) {
      // Only show the "loading" stub before the FIRST frame; never flash it back
      // over a clip that has already rendered (was the blue overlay during playback).
      if (!decoder?.everReady) this._drawStubRect(ctx, clip, w, h);
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
        // stays muted. Correct drift from the master clock only past a threshold.
        const rate = clip.speed > 0 ? clip.speed : 1;
        if (videoEl.playbackRate !== rate) videoEl.playbackRate = rate;
        if (videoEl.paused) void videoEl.play().catch(() => undefined);
        const DRIFT_TOLERANCE_SEC = 0.35;
        if (!decoder.seeking && Math.abs(videoEl.currentTime - assetSec) > DRIFT_TOLERANCE_SEC) {
          decoder.seeking = true;
          decoder.lastSeekSec = assetSec;
          videoEl.currentTime = Math.max(0, Math.min(assetSec, videoEl.duration || assetSec));
        }
      } else {
        // Paused / scrubbing: pause the element and seek to the exact frame.
        if (!videoEl.paused) videoEl.pause();
        const SEEK_THRESHOLD_SEC = 0.016; // ~half a frame at 30fps
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
      if (!decoder.everReady) this._drawStubRect(ctx, clip, w, h);
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
      // Per-clip opacity: first 'opacity' keyframe value (matches export clipOpacityPercent).
      const opacity = this._clipOpacity(clip);
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

  /** First 'opacity' keyframe value (0–100), or 100. Mirrors the export builder. */
  private _clipOpacity(clip: Clip): number {
    const kf = clip.keyframes["opacity"];
    if (kf && kf.length > 0 && typeof kf[0]!.value === "number") {
      return Math.max(0, Math.min(100, kf[0]!.value));
    }
    return 100;
  }

  private _drawStubRect(
    ctx: CanvasRenderingContext2D,
    clip: Clip,
    w: number,
    h: number,
  ): void {
    ctx.fillStyle = colourForSource(clip.sourceAssetId);
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = "rgba(0,0,0,0.45)";
    ctx.fillRect(0, h - 34, w, 34);
    ctx.fillStyle = "#F4F6FB";
    ctx.font = "16px 'IBM Plex Mono', monospace";
    ctx.textBaseline = "middle";
    ctx.fillText(`loading · ${clip.id.slice(0, 8)}`, 12, h - 17);
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
          ctx.font = `${style.fontWeight || 600} ${L.fontPx}px Inter, sans-serif`;
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

  // ── Private: decoder management (pooled per asset) ─────────────────────────

  /** Collect every (assetId → kind) referenced by video clips and image overlays. */
  private _referencedAssets(project: Project): Map<string, "video" | "image"> {
    const refs = new Map<string, "video" | "image">();
    for (const track of project.tracks) {
      if (track.type === "video") {
        for (const clip of track.clips) refs.set(clip.sourceAssetId, "video");
      } else if (track.type === "overlay") {
        for (const ov of track.clips) {
          if (ov.kind === "image") refs.set((ov as ImageOverlay).sourceAssetId, "image");
        }
      }
    }
    return refs;
  }

  private _syncDecoders(project: Project): void {
    const refs = this._referencedAssets(project);

    for (const [assetId, kind] of refs) {
      const meta = getAssetMeta(assetId);
      const proxyUrl = (kind === "image" ? meta?.thumbnailUrl ?? meta?.proxyUrl : meta?.proxyUrl) ?? "";
      const existing = this.decoders.get(assetId);
      if (existing && existing.proxyUrl === proxyUrl) continue; // unchanged

      // Tear down a stale element before replacing.
      if (existing?.videoEl) {
        existing.videoEl.src = "";
        existing.videoEl.load();
      }

      if (!proxyUrl) {
        // Not resolved yet — record a not-ready decoder so the clip draws the stub.
        this.decoders.set(assetId, {
          kind, proxyUrl: "", videoEl: null, imageEl: null,
          lastSeekSec: -1, ready: false, seeking: false, everReady: false,
        });
        continue;
      }

      if (kind === "image") {
        const imageEl = new Image();
        imageEl.crossOrigin = "anonymous";
        const decoder: AssetDecoder = {
          kind, proxyUrl, videoEl: null, imageEl,
          lastSeekSec: -1, ready: false, seeking: false, everReady: false,
        };
        this.decoders.set(assetId, decoder);
        imageEl.onload = () => { decoder.ready = true; if (!this.isPlaying) this._drawFrame(this.playStartMs); };
        imageEl.onerror = () => { decoder.ready = false; };
        imageEl.src = proxyUrl;
        continue;
      }

      const videoEl = document.createElement("video");
      videoEl.preload = "auto";
      videoEl.crossOrigin = "anonymous";
      videoEl.muted = true; // audio handled by AudioEngine
      videoEl.playsInline = true;
      const decoder: AssetDecoder = {
        kind, proxyUrl, videoEl, imageEl: null,
        lastSeekSec: -1, ready: false, seeking: false, everReady: false,
      };
      this.decoders.set(assetId, decoder);
      videoEl.onloadeddata = () => { decoder.ready = true; if (!this.isPlaying) this._drawFrame(this.playStartMs); };
      videoEl.onseeked = () => { decoder.seeking = false; if (!this.isPlaying) this._drawFrame(this.playStartMs); };
      videoEl.onerror = () => { decoder.ready = false; };
      videoEl.src = proxyUrl;
      videoEl.load();
    }

    // Drop decoders for assets no longer referenced.
    for (const id of [...this.decoders.keys()]) {
      if (!refs.has(id)) {
        const old = this.decoders.get(id);
        if (old?.videoEl) { old.videoEl.src = ""; old.videoEl.load(); }
        this.decoders.delete(id);
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
