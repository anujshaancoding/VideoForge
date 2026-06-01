// ─────────────────────────────────────────────────────────────────────────────
// PreviewEngine — Canvas 2D composite loop for VideoForge (§5.1).
//
// Decodes proxy video frames and composites them to an HTMLCanvasElement.
// Timing is slaved to AudioContext.currentTime (master clock) — never wall-clock
// — so A/V drift is structurally impossible.
//
// Two modes:
//   1. Stub URL ('stub.local' in url): coloured-rect placeholder (same as the
//      old CanvasStage.tsx rAF stub). No VideoDecoder or fetch.
//   2. Real proxy URL (http://localhost:9000/…): HTMLVideoElement seek + drawImage
//      — simpler than raw chunk parsing, still uses browser hardware decode.
//
// Up to 4 video tracks are composited bottom-up (track array index 0 = bottom
// layer per §18 z-order rules).
// ─────────────────────────────────────────────────────────────────────────────

import type { AudioEngine } from "./AudioEngine.js";
import type { Clip, Project, TextOverlay } from "@videoforge/project-schema";

// ── Clip-colour palette (mirrors CanvasStage.tsx stub) ────────────────────────
const CLIP_PALETTE = ["#2BC4B0", "#22A0C4", "#5B8DEF", "#7C6BEF", "#9E6BEF", "#2BC48A"];
function colourForSource(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return CLIP_PALETTE[h % CLIP_PALETTE.length]!;
}

const isStubUrl = (url: string): boolean =>
  !url || url.includes("stub.local") || url.startsWith("blob:stub") || url === "";

// ── Per-track video decoder (HTMLVideoElement approach) ──────────────────────

interface TrackDecoder {
  proxyUrl: string;
  videoEl: HTMLVideoElement | null;
  /** Last time we triggered a seek (asset-relative seconds). */
  lastSeekSec: number;
  /** True once metadata (duration, dimensions) is loaded. */
  metaReady: boolean;
  /** True while we're waiting for a seeked event. */
  seeking: boolean;
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

  private isPlaying = false;
  /** audioCtx.currentTime when play() was last called. */
  private playStartAudioTime = 0;
  /** playheadMs value when play() was last called. */
  private playStartMs = 0;

  /** trackId → decoder state */
  private decoders: Map<string, TrackDecoder> = new Map();

  private onPlayheadUpdate: ((ms: number) => void) | null = null;
  private onPlaybackEnded: (() => void) | null = null;

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  /**
   * Attach to a canvas and supply Zustand store callbacks.
   * Must be called once on component mount before any other method.
   */
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

    // Kick off a single draw to paint the current frame immediately.
    this._drawFrame(this.playStartMs);
  }

  /** Push a new project snapshot; re-creates decoders for changed track URLs. */
  setProject(project: Project): void {
    this.project = project;
    this._syncDecoders(project);
    if (!this.isPlaying) {
      // Repaint static frame at the current playhead.
      this._drawFrame(this.playStartMs);
    }
  }

  /**
   * Begin playback from `fromMs`. Delegates audio to AudioEngine (which owns
   * the AudioContext.currentTime master clock).
   */
  play(fromMs: number): void {
    if (!this.audioEngine) return;
    this.playStartMs = fromMs;
    this.playStartAudioTime = this.audioEngine.audioCtx.currentTime;
    this.isPlaying = true;
    this.audioEngine.playAll(fromMs);
    cancelAnimationFrame(this.rafId);
    this._drawLoop();
  }

  /** Pause playback; leaves the canvas at the current frame. */
  pause(): void {
    this.isPlaying = false;
    this.audioEngine?.pauseAll();
    cancelAnimationFrame(this.rafId);
    // Persist the last-computed ms as the new "origin" so seekTo/resume works.
    this.playStartMs = this.getCurrentMs();
  }

  /**
   * Seek to a specific ms while paused (or from an external scrub).
   * Draws the frame immediately.
   */
  seekTo(ms: number): void {
    this.playStartMs = Math.max(0, ms);
    this.playStartAudioTime = this.audioEngine?.audioCtx.currentTime ?? 0;
    if (!this.isPlaying) {
      this._drawFrame(this.playStartMs);
    }
  }

  /** Return the current playhead in ms, synced to AudioContext when playing. */
  getCurrentMs(): number {
    if (!this.isPlaying || !this.audioEngine) return this.playStartMs;
    const elapsed =
      (this.audioEngine.audioCtx.currentTime - this.playStartAudioTime) * 1000;
    return Math.max(0, this.playStartMs + elapsed);
  }

  /** Clean up on component unmount. */
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
    this.canvas = null;
    this.ctx2d = null;
  }

  // ── Private: draw loop ────────────────────────────────────────────────────

  private _drawLoop(): void {
    if (!this.isPlaying) return;

    const currentMs = this.getCurrentMs();
    this.onPlayheadUpdate?.(Math.round(currentMs));

    // Check for end-of-project.
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

  // ── Private: single-frame composite ───────────────────────────────────────

  private _drawFrame(playheadMs: number): void {
    const canvas = this.canvas;
    const ctx = this.ctx2d;
    const project = this.project;
    if (!canvas || !ctx || !project) return;

    const w = canvas.width;
    const h = canvas.height;

    // Background fill.
    ctx.fillStyle = project.canvas.backgroundColor || "#111111";
    ctx.fillRect(0, 0, w, h);

    // Collect visible video clips at this playhead (bottom-up by track array order = z-order).
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

    // Draw each visible video clip.
    for (const clip of visibleClips) {
      this._drawVideoClip(ctx, clip, playheadMs, w, h);
    }

    // Overlay tracks (text / image / shape / lottie / sticker).
    this._drawOverlays(ctx, project, playheadMs, w, h);

    // Safe zones are drawn by CanvasStage on top — not the engine's concern.
  }

  private _drawVideoClip(
    ctx: CanvasRenderingContext2D,
    clip: Clip,
    playheadMs: number,
    w: number,
    h: number,
  ): void {
    // Build proxy URL for this clip's source asset.
    const proxyUrl = `http://localhost:9000/proxy/${clip.sourceAssetId}.mp4`;

    if (isStubUrl(proxyUrl)) {
      // Fallback: colored rect stub.
      this._drawStubRect(ctx, clip, w, h);
      return;
    }

    const decoder = this.decoders.get(clip.trackId);
    if (!decoder || !decoder.metaReady || !decoder.videoEl) {
      // Decoder not ready yet — draw stub while loading.
      this._drawStubRect(ctx, clip, w, h);
      return;
    }

    const videoEl = decoder.videoEl;

    // Compute asset-relative time for this clip.
    const timelineOffset = playheadMs - clip.startOnTimeline;
    const assetSec = (clip.trimIn + timelineOffset * clip.speed) / 1000;

    // Trigger a seek if we've drifted more than half a frame (~16ms at 30fps).
    const SEEK_THRESHOLD_SEC = 0.016;
    if (Math.abs(decoder.lastSeekSec - assetSec) > SEEK_THRESHOLD_SEC && !decoder.seeking) {
      decoder.seeking = true;
      decoder.lastSeekSec = assetSec;
      videoEl.currentTime = Math.max(0, Math.min(assetSec, videoEl.duration || assetSec));
    }

    // Draw whatever frame the <video> currently has decoded.
    if (videoEl.readyState >= 2 /* HAVE_CURRENT_DATA */) {
      try {
        // M4: color grade via CSS filter (matches FFmpeg eq on export).
        type ClipExt = { colorGrade?: { brightness?: number; contrast?: number; saturation?: number }; kenBurns?: { startScale: number; endScale: number } };
        const clipExt = clip as unknown as ClipExt;

        // Apply color grade filter if present.
        if (clipExt.colorGrade) {
          const { brightness = 0, contrast = 0, saturation = 0 } = clipExt.colorGrade;
          const b = 1 + brightness / 100;
          const c = 1 + contrast / 100;
          const s = 1 + saturation / 100;
          ctx.filter = `brightness(${b}) contrast(${c}) saturate(${s})`;
        }

        // M4: Ken Burns — apply a CSS-like scale transform by drawing to a
        // scaled sub-region, centered, based on playhead progress within the clip.
        if (clipExt.kenBurns) {
          const { startScale, endScale } = clipExt.kenBurns;
          const clipDuration = clip.endOnTimeline - clip.startOnTimeline;
          const progress = clipDuration > 0
            ? (playheadMs - clip.startOnTimeline) / clipDuration
            : 0;
          const scale = startScale + (endScale - startScale) * Math.max(0, Math.min(1, progress));
          const sw = w * scale;
          const sh = h * scale;
          const dx = (w - sw) / 2;
          const dy = (h - sh) / 2;
          ctx.drawImage(videoEl, dx, dy, sw, sh);
        } else {
          ctx.drawImage(videoEl, 0, 0, w, h);
        }
        ctx.filter = "none"; // always reset
        return;
      } catch {
        ctx.filter = "none";
        // drawImage can throw if the video is in an error state.
      }
    }

    // While the first frame is loading, show stub.
    this._drawStubRect(ctx, clip, w, h);
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
    ctx.fillText(`video · ${clip.id.slice(0, 8)} (preview stub)`, 12, h - 17);
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
          const style = (ov as TextOverlay).style;
          const size = Math.max(12, (style.fontSize / project.canvas.height) * h);
          ctx.fillStyle = style.color || "#FFFFFF";
          ctx.font = `${style.fontWeight || 600} ${size}px Inter, sans-serif`;
          ctx.textAlign =
            style.align === "right" ? "right" : style.align === "left" ? "left" : "center";
          ctx.textBaseline = "middle";
          const tx =
            style.align === "left" ? x : style.align === "right" ? x + bw : x + bw / 2;
          if (style.outline && style.outline.width > 0) {
            ctx.lineWidth = style.outline.width;
            ctx.strokeStyle = style.outline.color;
            ctx.strokeText((ov as TextOverlay).text, tx, y + bh / 2);
          }
          ctx.fillText((ov as TextOverlay).text, tx, y + bh / 2);
          ctx.textAlign = "left";
        } else {
          // Non-text overlays: outlined placeholder box with kind label.
          ctx.strokeStyle = "#FF9EC4";
          ctx.lineWidth = 2;
          ctx.strokeRect(x, y, bw, bh);
          ctx.fillStyle = "#FF9EC4";
          ctx.font = "12px Inter, sans-serif";
          ctx.fillText(ov.kind, x + 4, y + 12);
        }
        ctx.globalAlpha = 1;
      }
    }
  }

  // ── Private: decoder management ───────────────────────────────────────────

  /**
   * Create / update one TrackDecoder per video track. Existing decoders whose
   * proxyUrl hasn't changed are left intact to avoid stalling the video element.
   */
  private _syncDecoders(project: Project): void {
    const activeTrackIds = new Set<string>();

    for (const track of project.tracks) {
      if (track.type !== "video") continue;
      activeTrackIds.add(track.id);

      // Use the first clip as a representative source for this track (MVP).
      const firstClip = track.clips[0];
      if (!firstClip) continue;

      const proxyUrl = `http://localhost:9000/proxy/${firstClip.sourceAssetId}.mp4`;

      const existing = this.decoders.get(track.id);
      if (existing && existing.proxyUrl === proxyUrl) continue; // no change

      // Tear down the old element.
      if (existing?.videoEl) {
        existing.videoEl.src = "";
        existing.videoEl.load();
      }

      if (isStubUrl(proxyUrl)) {
        this.decoders.set(track.id, {
          proxyUrl,
          videoEl: null,
          lastSeekSec: -1,
          metaReady: false,
          seeking: false,
        });
        continue;
      }

      const videoEl = document.createElement("video");
      videoEl.preload = "auto";
      videoEl.crossOrigin = "anonymous";
      videoEl.muted = true; // audio is handled by AudioEngine; suppress default <video> audio
      videoEl.playsInline = true;

      const decoder: TrackDecoder = {
        proxyUrl,
        videoEl,
        lastSeekSec: -1,
        metaReady: false,
        seeking: false,
      };
      this.decoders.set(track.id, decoder);

      videoEl.onloadedmetadata = () => {
        decoder.metaReady = true;
      };
      videoEl.onseeked = () => {
        decoder.seeking = false;
      };
      videoEl.onerror = () => {
        decoder.metaReady = false;
      };

      videoEl.src = proxyUrl;
      videoEl.load();
    }

    // Remove decoders for tracks that no longer exist.
    for (const id of this.decoders.keys()) {
      if (!activeTrackIds.has(id)) {
        const old = this.decoders.get(id);
        if (old?.videoEl) {
          old.videoEl.src = "";
          old.videoEl.load();
        }
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
