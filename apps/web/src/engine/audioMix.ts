// ─────────────────────────────────────────────────────────────────────────────
// Pure audio-mix math for the AudioEngine (extracted so it is unit-testable
// without a live Web Audio context, per Pipeline §4.7).
//
// These functions are the timing-critical core of preview audio: which tracks are
// audible under mute/solo, and where/when/how-long to play a clip's buffer so it
// lands at the right timeline position with its trim + speed. They mirror the
// FFmpeg export mix model (packages/ffmpeg-graph) so preview == export.
// ─────────────────────────────────────────────────────────────────────────────

import type { Project, Clip, Track } from "@videoforge/project-schema";

type AudioTrack = Extract<Track, { type: "audio" | "voiceover" }>;

/** Only audio + voiceover tracks contribute to the mix (matches the export). */
export function isAudioTrack(t: Track): t is AudioTrack {
  return t.type === "audio" || t.type === "voiceover";
}

/**
 * The set of audio/voiceover track ids that are audible given mute/solo:
 *   • if ANY audio track is soloed, only soloed tracks are audible;
 *   • otherwise, every non-muted audio track is audible.
 * Mirrors the export's mute/solo gate exactly.
 */
export function computeAudibleTrackIds(project: Project): Set<string> {
  const audio = project.tracks.filter(isAudioTrack);
  const anySolo = audio.some((t) => t.solo);
  return new Set(
    audio.filter((t) => (anySolo ? t.solo : !t.muted)).map((t) => t.id),
  );
}

/** Where (buffer offset), when (ctx time) and how long to play a clip. */
export interface ClipPlayback {
  /** Offset into the decoded asset buffer, seconds. */
  bufferOffsetSec: number;
  /** Intended AudioContext start time, seconds (caller clamps to currentTime). */
  whenSec: number;
  /** Source-buffer seconds to play (before speed). */
  playDurSec: number;
  /** Effective playback rate (clip.speed, floored to a positive value). */
  speed: number;
}

/**
 * Compute the schedule for one clip relative to the master clock. Returns null
 * when the clip should not be scheduled (playhead already past its end, or the
 * trim leaves nothing to play).
 *
 * @param fromMs            timeline position playback started/resumed from
 * @param playStartCtxTime  AudioContext.currentTime captured when playback began
 * @param nowCtxTime        AudioContext.currentTime now (for mid-clip resume)
 */
export function computeClipPlayback(
  clip: Pick<Clip, "startOnTimeline" | "endOnTimeline" | "trimIn" | "trimOut" | "speed">,
  fromMs: number,
  playStartCtxTime: number,
  nowCtxTime: number,
): ClipPlayback | null {
  if (fromMs >= clip.endOnTimeline) return null; // already past this clip
  const speed = clip.speed > 0 ? clip.speed : 1;

  let bufferOffsetSec: number;
  let whenSec: number;
  if (fromMs <= clip.startOnTimeline) {
    // Playhead is before the clip: start at its trim head, delayed to its position.
    bufferOffsetSec = clip.trimIn / 1000;
    whenSec = playStartCtxTime + (clip.startOnTimeline - fromMs) / 1000;
  } else {
    // Playhead is inside the clip: advance into the buffer by the elapsed portion.
    const intoClipMs = (fromMs - clip.startOnTimeline) * speed;
    bufferOffsetSec = (clip.trimIn + intoClipMs) / 1000;
    whenSec = nowCtxTime;
  }

  const playDurSec = Math.max(0, clip.trimOut / 1000 - bufferOffsetSec);
  if (playDurSec <= 0) return null;
  return { bufferOffsetSec, whenSec, playDurSec, speed };
}
