// ─────────────────────────────────────────────────────────────────────────────
// AudioEngine — Web Audio graph for VideoForge timeline preview (§5.1, §7).
//
// One AudioContext lives for the entire session (never recreated on play/pause).
// Each audio/voiceover track gets its own gain + stereo-panner node chain.
// AudioContext.currentTime is the master clock: the PreviewEngine reads it to
// keep video frames in sync.
//
// Stub-URL detection: any proxyUrl containing 'stub.local' is skipped silently
// (no decode attempted). Real proxy URLs follow the http://localhost:9000/…
// pattern used by the local MinIO/S3 proxy.
// ─────────────────────────────────────────────────────────────────────────────

import type { Project } from "@videoforge/project-schema";

interface TrackNodes {
  source: AudioBufferSourceNode | null;
  gain: GainNode;
  pan: StereoPannerNode;
  buffer: AudioBuffer | null;
  proxyUrl: string;
}

const isStubUrl = (url: string): boolean =>
  !url || url.includes("stub.local") || url.startsWith("blob:stub");

export class AudioEngine {
  private ctx: AudioContext;
  private trackNodes: Map<string, TrackNodes> = new Map();
  private masterGain: GainNode;
  private _isPlaying = false;

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

  /**
   * Load (or reload) a single audio track's buffer from its proxy URL.
   * Stub URLs are silently ignored. Calling this while playing is a no-op for
   * the active source; restart playback to hear the new buffer.
   */
  async loadTrack(
    trackId: string,
    proxyUrl: string,
    volume: number,
    pan: number,
    muted: boolean,
  ): Promise<void> {
    // Reuse existing nodes if the URL hasn't changed.
    const existing = this.trackNodes.get(trackId);
    if (existing && existing.proxyUrl === proxyUrl && existing.buffer) return;

    // Tear down old nodes gracefully.
    if (existing) {
      existing.source?.stop();
      existing.gain.disconnect();
      existing.pan.disconnect();
    }

    const gainNode = this.ctx.createGain();
    gainNode.gain.value = muted ? 0 : volume / 100;

    const panNode = this.ctx.createStereoPanner();
    panNode.pan.value = pan / 100; // spec: -100…+100 → -1…+1

    gainNode.connect(panNode);
    panNode.connect(this.masterGain);

    const nodes: TrackNodes = {
      source: null,
      gain: gainNode,
      pan: panNode,
      buffer: null,
      proxyUrl,
    };
    this.trackNodes.set(trackId, nodes);

    if (isStubUrl(proxyUrl)) return;

    try {
      const res = await fetch(proxyUrl);
      if (!res.ok) return;
      const arrayBuffer = await res.arrayBuffer();
      nodes.buffer = await this.ctx.decodeAudioData(arrayBuffer);
    } catch {
      // Network / decode failures are non-fatal in preview.
    }
  }

  /**
   * Schedule all loaded audio tracks to play from `fromMs`.
   * Uses ctx.currentTime math so A/V stays in sync.
   */
  playAll(fromMs: number): void {
    this._isPlaying = true;

    const offsetSec = fromMs / 1000;

    for (const [, nodes] of this.trackNodes) {
      if (!nodes.buffer) continue;
      this._startSource(nodes, offsetSec);
    }

    // Resume context if it was suspended (browser autoplay policy).
    if (this.ctx.state === "suspended") {
      void this.ctx.resume();
    }
  }

  private _startSource(nodes: TrackNodes, offsetSec: number): void {
    // Stop any previously running source for this track.
    try {
      nodes.source?.stop();
    } catch {
      // already stopped
    }
    nodes.source = null;

    if (!nodes.buffer) return;
    const duration = nodes.buffer.duration;
    if (offsetSec >= duration) return; // nothing left to play

    const src = this.ctx.createBufferSource();
    src.buffer = nodes.buffer;
    src.connect(nodes.gain);
    // Play the asset from `offsetSec` within its buffer, starting immediately.
    src.start(this.ctx.currentTime, Math.max(0, offsetSec));
    nodes.source = src;
  }

  /** Stop all audio sources immediately. Does NOT suspend the AudioContext. */
  pauseAll(): void {
    this._isPlaying = false;
    for (const [, nodes] of this.trackNodes) {
      try {
        nodes.source?.stop();
      } catch {
        // already stopped
      }
      nodes.source = null;
    }
  }

  setTrackMute(trackId: string, muted: boolean): void {
    const nodes = this.trackNodes.get(trackId);
    if (!nodes) return;
    // Ramp to zero/one over 20ms to avoid clicks.
    nodes.gain.gain.setTargetAtTime(muted ? 0 : 1, this.ctx.currentTime, 0.02);
  }

  setTrackVolume(trackId: string, volume: number): void {
    const nodes = this.trackNodes.get(trackId);
    if (!nodes) return;
    nodes.gain.gain.setTargetAtTime(volume / 100, this.ctx.currentTime, 0.02);
  }

  setTrackPan(trackId: string, pan: number): void {
    const nodes = this.trackNodes.get(trackId);
    if (!nodes) return;
    nodes.pan.pan.value = pan / 100;
  }

  /**
   * Solo mode: if `soloActive` is true, mute every track EXCEPT the soloed one;
   * otherwise restore all tracks to their stored mute state.
   */
  setTrackSolo(trackId: string, soloActive: boolean, allTrackIds: string[]): void {
    for (const id of allTrackIds) {
      const nodes = this.trackNodes.get(id);
      if (!nodes) continue;
      const targetVol = soloActive && id !== trackId ? 0 : 1;
      nodes.gain.gain.setTargetAtTime(targetVol, this.ctx.currentTime, 0.02);
    }
  }

  /**
   * Sync audio nodes against the full project: load any new audio/voiceover tracks,
   * and update gain/pan for existing ones. Called whenever the project changes.
   */
  updateProject(project: Project): void {
    for (const track of project.tracks) {
      if (track.type !== "audio" && track.type !== "voiceover") continue;
      // Use the first clip's source as a representative proxy URL (MVP).
      const firstClip = track.clips[0];
      if (!firstClip) continue;
      // Build a deterministic proxy URL (real backend uses localhost:9000).
      const proxyUrl = `http://localhost:9000/proxy/${firstClip.sourceAssetId}.m4a`;
      void this.loadTrack(track.id, proxyUrl, track.volume, track.pan, track.muted);
    }
  }

  /** Tear down the context on component unmount. */
  destroy(): void {
    this.pauseAll();
    void this.ctx.close();
  }
}
