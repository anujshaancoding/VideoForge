// ─────────────────────────────────────────────────────────────────────────────
// AudioEngine — Web Audio graph for VideoForge timeline preview (§5.1, §7).
//
// One AudioContext lives for the entire session (never recreated on play/pause).
// AudioContext.currentTime is the MASTER CLOCK; the PreviewEngine reads it so video
// frames chase audio and A/V never drifts.
//
// Mix model mirrors the FFmpeg export (packages/ffmpeg-graph) so preview==export:
//   • Only audio + voiceover tracks contribute (video-track audio is not mixed —
//     embedded audio is carried by a LINKED audio clip on an audio track).
//   • Each CLIP is scheduled at its timeline position with its trim offset + speed
//     (the old engine played only each track's FIRST clip, from t=0, ignoring trims
//     and timeline position — so preview audio never matched the export).
//   • Per-clip gain + leading fade-in (from `keyframes.gain`); per-track volume/pan;
//     mute/solo gating recomputed live whenever the project changes.
//
// Source URLs are resolved per asset from the asset registry (store/assetStore) —
// never synthesised.
// ─────────────────────────────────────────────────────────────────────────────

import type { Project, Clip, Track } from "@videoforge/project-schema";
import { getAssetMeta } from "../store/assetStore.js";
import { computeAudibleTrackIds, computeClipPlayback, isAudioTrack } from "./audioMix.js";

interface TrackChain {
  gain: GainNode;   // track volume × mute/solo gate
  pan: StereoPannerNode;
}

/** Volume-envelope point (absolute-timeline ms; value = percent gain 0–200). */
interface VolumeEnvelopePoint {
  timeMs: number;
  value: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// SHARED volume-envelope sampler (§3.4). MUST stay byte-identical to
// `sampleVolumeEnvelope` in packages/ffmpeg-graph/buildFilterComplex.ts — that is
// the canonical export-side twin; this is the preview mirror (the same shared-helper
// discipline as ColorGrader.eqParams ↔ colorGradeExtOf). Piecewise-LINEAR gain
// percent at absolute-timeline `timeMs`, clamping to the first/last point at the
// ends, returning `fallback` (the flat track `volume`) for an empty envelope.
// `points` MUST be time-sorted (the store keeps volumeEnvelope sorted on author).
// Preview==export depends on this formula matching the export expression exactly.
// ─────────────────────────────────────────────────────────────────────────────
function sampleVolumeEnvelope(
  points: VolumeEnvelopePoint[],
  timeMs: number,
  fallback: number,
): number {
  if (points.length === 0) return fallback;
  if (points.length === 1 || timeMs <= points[0]!.timeMs) return points[0]!.value;
  const last = points[points.length - 1]!;
  if (timeMs >= last.timeMs) return last.value;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i]!;
    const b = points[i + 1]!;
    if (timeMs >= a.timeMs && timeMs <= b.timeMs) {
      const span = b.timeMs - a.timeMs;
      const u = span > 0 ? (timeMs - a.timeMs) / span : 0;
      return a.value + (b.value - a.value) * u;
    }
  }
  return last.value;
}

/** True when the envelope actually automates (≥2 points and not all-equal). */
function envelopeIsActive(points: VolumeEnvelopePoint[]): boolean {
  return points.length >= 2 && !points.every((p) => p.value === points[0]!.value);
}

export class AudioEngine {
  private ctx: AudioContext;
  private masterGain: GainNode;
  private trackChains: Map<string, TrackChain> = new Map();
  /** Decoded buffers pooled per assetId. */
  private buffers: Map<string, AudioBuffer> = new Map();
  /** assetId currently being fetched/decoded (dedupe concurrent loads). */
  private loading: Set<string> = new Set();
  /** Live scheduled sources, so pause() can stop them all. */
  private activeSources: AudioBufferSourceNode[] = [];
  private _isPlaying = false;
  private project: Project | null = null;

  constructor() {
    this.ctx = new AudioContext();
    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.value = 1.0;
    this.masterGain.connect(this.ctx.destination);
  }

  /** The shared AudioContext — PreviewEngine reads .currentTime from this. */
  get audioCtx(): AudioContext {
    return this.ctx;
  }

  get isPlaying(): boolean {
    return this._isPlaying;
  }

  /** Master monitor gain (preview-only; does NOT affect export). */
  setMasterVolume(volume: number): void {
    this.masterGain.gain.setTargetAtTime(Math.max(0, volume / 100), this.ctx.currentTime, 0.02);
  }

  private isAudioTrack(t: Track): t is Extract<Track, { type: "audio" | "voiceover" }> {
    return isAudioTrack(t);
  }

  /** Which audio/voiceover tracks are audible per mute/solo (mirrors export). */
  private audibleTrackIds(project: Project): Set<string> {
    return computeAudibleTrackIds(project);
  }

  private ensureChain(trackId: string): TrackChain {
    let chain = this.trackChains.get(trackId);
    if (!chain) {
      const gain = this.ctx.createGain();
      const pan = this.ctx.createStereoPanner();
      gain.connect(pan);
      pan.connect(this.masterGain);
      chain = { gain, pan };
      this.trackChains.set(trackId, chain);
    }
    return chain;
  }

  /** Decode (once) the audio buffer for an asset from its presigned proxy URL. */
  private async ensureBuffer(assetId: string): Promise<void> {
    if (this.buffers.has(assetId) || this.loading.has(assetId)) return;
    const url = getAssetMeta(assetId)?.proxyUrl;
    if (!url) return;
    this.loading.add(assetId);
    try {
      const res = await fetch(url);
      if (!res.ok) return;
      const arrayBuffer = await res.arrayBuffer();
      const buf = await this.ctx.decodeAudioData(arrayBuffer);
      this.buffers.set(assetId, buf);
      // If we're mid-playback, schedule any clips of this asset that are still ahead.
      if (this._isPlaying && this.project) this._scheduleNewlyLoaded(assetId);
    } catch {
      // Network/decode failure is non-fatal in preview.
    } finally {
      this.loading.delete(assetId);
    }
  }

  /**
   * Sync against the full project: ensure a chain per audio/voiceover track, apply
   * track volume/pan + mute/solo gating live, and kick off buffer decodes. Called
   * whenever the project changes (incl. mute/solo toggles).
   */
  updateProject(project: Project): void {
    this.project = project;
    const audible = this.audibleTrackIds(project);
    const now = this.ctx.currentTime;

    for (const track of project.tracks) {
      if (!this.isAudioTrack(track)) continue;
      const chain = this.ensureChain(track.id);
      const gate = audible.has(track.id) ? 1 : 0;
      const env = track.volumeEnvelope as VolumeEnvelopePoint[];
      if (gate === 1 && this._isPlaying && envelopeIsActive(env)) {
        // Automated + audible + playing: schedule the piecewise-linear curve along
        // the master clock so the audible gain follows the points in real time.
        this._scheduleTrackEnvelope(chain.gain, env, this._currentTimelineMs());
      } else {
        // Flat / paused path (no active envelope, muted, or scrubbing while paused):
        // set the STATIC sampled gain at the current position. Cancel any pending
        // envelope ramps first so this value wins. For an empty envelope this is
        // exactly the legacy `track.volume / 100` behaviour (sampler fallback).
        chain.gain.gain.cancelScheduledValues(now);
        const flat = gate === 1 ? this._sampleTrackGainMul(env, track.volume, this._currentTimelineMs()) : 0;
        chain.gain.gain.setTargetAtTime(flat, now, 0.02);
      }
      chain.pan.pan.setTargetAtTime(track.pan / 100, now, 0.02);
      for (const clip of track.clips) void this.ensureBuffer(clip.sourceAssetId);
    }

    // Drop chains for tracks that no longer exist.
    for (const id of [...this.trackChains.keys()]) {
      if (!project.tracks.some((t) => t.id === id && this.isAudioTrack(t))) {
        const chain = this.trackChains.get(id);
        chain?.gain.disconnect();
        chain?.pan.disconnect();
        this.trackChains.delete(id);
      }
    }
  }

  /** Schedule every audible clip at its correct timeline position from `fromMs`. */
  playAll(fromMs: number): void {
    this._isPlaying = true;
    this.playFromMs = fromMs;
    this.playStartCtxTime = this.ctx.currentTime;
    this._stopAllSources();
    if (this.ctx.state === "suspended") void this.ctx.resume();
    if (!this.project) return;

    const audible = this.audibleTrackIds(this.project);
    for (const track of this.project.tracks) {
      if (!this.isAudioTrack(track) || !audible.has(track.id)) continue;
      // §3.4: lay the track volume-envelope curve onto the gain node along the clock
      // BEFORE scheduling clips, so the audible gain follows the points (flat tracks
      // were already set by updateProject and are left untouched here).
      const env = track.volumeEnvelope as VolumeEnvelopePoint[];
      if (envelopeIsActive(env)) this._scheduleTrackEnvelope(this.ensureChain(track.id).gain, env, fromMs);
      for (const clip of track.clips) this._scheduleClip(track.id, clip, fromMs);
    }
  }

  private playFromMs = 0;
  private playStartCtxTime = 0;

  /** Current timeline position (ms) from the master clock; playFromMs when paused. */
  private _currentTimelineMs(): number {
    if (!this._isPlaying) return this.playFromMs;
    return this.playFromMs + (this.ctx.currentTime - this.playStartCtxTime) * 1000;
  }

  /** Track gain multiplier at timeline `timeMs` honouring its envelope (or flat volume). */
  private _sampleTrackGainMul(env: VolumeEnvelopePoint[], volume: number, timeMs: number): number {
    return sampleVolumeEnvelope(env, timeMs, volume) / 100;
  }

  /**
   * Schedule the piecewise-linear gain curve onto `gainNode` from the timeline
   * position `fromMs` forward, using setValueAtTime + linearRampToValueAtTime so the
   * audible gain follows the SAME points the export emits (preview==export). The
   * curve is seeded at `now` with the exact sampled value, then a ramp is laid to
   * every envelope point still ahead (and a flat hold at the last point's value).
   * Maps absolute-timeline ms → ctx time via the master clock.
   */
  private _scheduleTrackEnvelope(gainNode: GainNode, points: VolumeEnvelopePoint[], fromMs: number): void {
    const now = this.ctx.currentTime;
    // ctx time at which the timeline reaches `tMs` (playStartCtxTime corresponds to playFromMs).
    const ctxAt = (tMs: number) => this.playStartCtxTime + (tMs - this.playFromMs) / 1000;
    gainNode.gain.cancelScheduledValues(now);
    // Seed: exact gain at the start position (clamps before-first / after-last internally).
    gainNode.gain.setValueAtTime(sampleVolumeEnvelope(points, fromMs, points[0]!.value) / 100, now);
    // Ramp to each point ahead of `fromMs`; points are time-sorted.
    for (const p of points) {
      if (p.timeMs <= fromMs) continue;
      const when = Math.max(now, ctxAt(p.timeMs));
      gainNode.gain.linearRampToValueAtTime(p.value / 100, when);
    }
    // Hold the last value after the final point (clamp-after-last == constant end).
    const last = points[points.length - 1]!;
    if (last.timeMs > fromMs) {
      gainNode.gain.setValueAtTime(last.value / 100, Math.max(now, ctxAt(last.timeMs)));
    }
  }

  /** Schedule a single clip relative to the master clock. */
  private _scheduleClip(trackId: string, clip: Clip, fromMs: number): void {
    const buffer = this.buffers.get(clip.sourceAssetId);
    if (!buffer) return; // not decoded yet — picked up by _scheduleNewlyLoaded

    // Where in the asset buffer (seconds) and when (ctx time) to start.
    const sched = computeClipPlayback(
      clip,
      fromMs,
      this.playStartCtxTime,
      this.ctx.currentTime,
    );
    if (!sched) return;
    const { bufferOffsetSec, whenSec, playDurSec, speed } = sched;
    if (bufferOffsetSec >= buffer.duration) return;

    const chain = this.ensureChain(trackId);
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = speed; // preview = pitch-shifted; export uses atempo

    // Per-clip gain + linear fade in/out (mirrors export afade in/out from clip fields).
    const clipGain = this.ctx.createGain();
    const baseGain = (clip.gain ?? 100) / 100;
    const startAt = Math.max(this.ctx.currentTime, whenSec);
    const wallDur = playDurSec / speed; // audible wall-clock seconds
    const endCtx = startAt + wallDur;
    const fadeInSec = (clip.fadeInMs ?? 0) / 1000;
    const fadeOutSec = (clip.fadeOutMs ?? 0) / 1000;

    clipGain.gain.cancelScheduledValues(startAt);

    // Timeline-ms playback begins into the clip's span (0 when starting at/before the
    // clip start). Fades are defined in timeline-ms from the clip's start/end and run
    // at wall-clock rate 1:1 (timeline seconds == audible wall seconds), so we can map
    // a fade boundary to a ctx time via `startAt + (boundaryMs - intoClipMs)/1000`.
    const intoClipMs = Math.max(0, fromMs - clip.startOnTimeline);
    const spanMs = clip.endOnTimeline - clip.startOnTimeline;

    if (fadeInSec > 0) {
      const fadeInMs = fadeInSec * 1000;
      if (intoClipMs < fadeInMs) {
        // Resuming before/inside the fade-in: seed the partially-ramped gain and
        // continue the SAME ramp to baseGain at the fade-in boundary — matching the
        // export's afade=t=in:st=0 (which always ramps from clip-local origin).
        const startFrac = fadeInMs > 0 ? intoClipMs / fadeInMs : 1;
        const rampEnd = Math.min(startAt + (fadeInMs - intoClipMs) / 1000, endCtx);
        clipGain.gain.setValueAtTime(baseGain * startFrac, startAt);
        clipGain.gain.linearRampToValueAtTime(baseGain, rampEnd);
      } else {
        clipGain.gain.setValueAtTime(baseGain, startAt);
      }
    } else {
      clipGain.gain.setValueAtTime(baseGain, startAt);
    }

    if (fadeOutSec > 0) {
      const fadeOutMs = fadeOutSec * 1000;
      const foBoundaryMs = spanMs - fadeOutMs; // clip-timeline ms where fade-out begins
      if (intoClipMs >= foBoundaryMs) {
        // Resuming already inside the fade-out: seed the partially-ramped gain and
        // continue ramping to 0 at the clip end (mirrors export afade=t=out).
        const outFrac = fadeOutMs > 0 ? (intoClipMs - foBoundaryMs) / fadeOutMs : 1;
        clipGain.gain.setValueAtTime(baseGain * (1 - Math.min(1, outFrac)), startAt);
        clipGain.gain.linearRampToValueAtTime(0, endCtx);
      } else {
        const foStart = Math.max(startAt, startAt + (foBoundaryMs - intoClipMs) / 1000);
        clipGain.gain.setValueAtTime(baseGain, foStart);
        clipGain.gain.linearRampToValueAtTime(0, endCtx);
      }
    }

    src.connect(clipGain);
    clipGain.connect(chain.gain);
    src.start(startAt, Math.max(0, bufferOffsetSec), playDurSec);
    this.activeSources.push(src);
  }

  /** When a buffer finishes decoding mid-playback, schedule its still-future clips. */
  private _scheduleNewlyLoaded(assetId: string): void {
    if (!this.project) return;
    const nowMs = this.playFromMs + (this.ctx.currentTime - this.playStartCtxTime) * 1000;
    const audible = this.audibleTrackIds(this.project);
    for (const track of this.project.tracks) {
      if (!this.isAudioTrack(track) || !audible.has(track.id)) continue;
      for (const clip of track.clips) {
        if (clip.sourceAssetId === assetId && clip.endOnTimeline > nowMs) {
          this._scheduleClip(track.id, clip, nowMs);
        }
      }
    }
  }

  private _stopAllSources(): void {
    for (const src of this.activeSources) {
      try { src.stop(); } catch { /* already stopped */ }
    }
    this.activeSources = [];
  }

  /** Stop all audio sources immediately. Does NOT suspend the AudioContext. */
  pauseAll(): void {
    this._isPlaying = false;
    this._stopAllSources();
  }

  destroy(): void {
    this.pauseAll();
    void this.ctx.close();
  }
}
