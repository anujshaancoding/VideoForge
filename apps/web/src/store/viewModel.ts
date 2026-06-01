// ─────────────────────────────────────────────────────────────────────────────
// VideoForge view-model adapter (Foundation B).
//
// THE single bridge between OUR state source of truth (the Zustand editorStore +
// @videoforge/project-schema Project, all integer MILLISECONDS) and the design
// prototype's view shape (seconds-based TRACKS / CLIPS / RATIOS, see
// design-export/src/data.jsx). The ported editor components import ONLY from here
// (and from lib/format, components/icons, components/brand) — never from the raw
// store or the schema — so the visual layer matches the mockups while the data
// layer stays canonical.
//
// Direction of mapping:
//   store (ms, schema track union, captionTracks[])  ──derive──▶  TrackView/ClipView (sec)
//   component edits (sec)                             ──route──▶  store actions (ms)
//
// Anything the design view needs but the seeded sampleProject does not carry
// (a "short" lane label, a video `src` gradient key, an audio waveform `seed`) is
// derived DETERMINISTICALLY here from stable ids/indices — the schema is never
// mutated to satisfy the UI.
// ─────────────────────────────────────────────────────────────────────────────

import { useMemo } from "react";
import type {
  CaptionBlock,
  CaptionTrack,
  Clip,
  OverlayClip,
  Project,
  TextOverlay,
  Track,
} from "@videoforge/project-schema";
import {
  selectProjectDurationMs,
  useEditorStore,
  type SelectionKind,
} from "./editorStore";

// ─────────────────────────────────────────────────────────────────────────────
// View types (seconds-based — what the ported components consume)
// ─────────────────────────────────────────────────────────────────────────────

/** Lane "kind" understood by the timeline/canvas/inspector. The schema's
 *  `voiceover` track collapses to `audio` for display (same lane treatment). */
export type TrackViewType = "overlay" | "video" | "audio" | "caption";

export interface TrackView {
  id: string;
  type: TrackViewType;
  /** Full lane name, e.g. "intro.mp4" / "music.mp3" / "English". */
  name: string;
  /** Short lane badge, e.g. "V1" / "A1" / "OV" / "CC". Derived deterministically. */
  short: string;
  /** Rendered lane height in px (mirrors the schema track.height). */
  h: number;
  /** Audio pan, -100..100 (audio/voiceover only). */
  pan?: number;
  // Header toggles the timeline TrackHeader reads. Sourced from the schema track.
  mute?: boolean;
  solo?: boolean;
  locked?: boolean;
}

export type ClipViewType = "overlay" | "video" | "audio" | "caption";

export interface ClipView {
  id: string;
  /** Owning track id (the design prototype called this `track`; contract = `trackId`). */
  trackId: string;
  type: ClipViewType;
  /** Display name (clip/overlay label, caption text). */
  name: string;
  /** Timeline start, SECONDS. */
  start: number;
  /** Duration, SECONDS. */
  dur: number;
  /** Playback rate (video). */
  speed?: number;
  /** Linked partner clip id (A/V link group). */
  linked?: string;
  /** Video gradient key into SCENE_GRADS / SRC_COLOR. */
  src?: string;
  /** Overlay text content. */
  text?: string;
  /** Overlay kind ("text" | "logo" | …) — drives the canvas/timeline render. */
  kind?: string;
  /** Deterministic waveform seed (audio). */
  seed?: number;
}

export interface ProjectView {
  name: string;
  ratio: string;
  w: number;
  h: number;
  bg: string;
}

export interface TimelineView {
  tracks: TrackView[];
  clips: ClipView[];
  durationSec: number;
  fps: number;
  project: ProjectView;
}

export interface SelectionView {
  /** Currently-selected clip/overlay/caption/track id, or null. */
  sel: string | null;
  /** Select an item by id; `null` clears. Resolves the schema kind automatically. */
  select: (id: string | null) => void;
  clear: () => void;
}

export interface TransportView {
  isPlaying: boolean;
  togglePlay: () => void;
  play: () => void;
  pause: () => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// Constants ported from design-export/src/data.jsx (the VISUAL source of truth)
// ─────────────────────────────────────────────────────────────────────────────

/** Per-source clip header tint (CSS vars from tokens.css). */
export const SRC_COLOR: Record<string, string> = {
  intro: "var(--vf-src-0)",
  broll: "var(--vf-src-2)",
  closing: "var(--vf-src-3)",
};

/** Placeholder video-thumbnail gradient stops, keyed by source. */
export const SCENE_GRADS: Record<string, [string, string, string]> = {
  intro: ["#2a3a5e", "#1d2a44", "#33507a"],
  broll: ["#3a4a2e", "#26331f", "#4a5c38"],
  closing: ["#4a2e3e", "#331f2a", "#5c3848"],
  logo: ["#2e3a4a", "#1f2733", "#384a5c"],
};

export interface RatioOption {
  id: string;
  w: number;
  h: number;
  label: string;
  hint: string;
}

/** New-project aspect-ratio chooser options (NO pre-selected default — §4). */
export const RATIOS: RatioOption[] = [
  { id: "9:16", w: 1080, h: 1920, label: "Vertical", hint: "TikTok · Reels · Shorts" },
  { id: "16:9", w: 1920, h: 1080, label: "Horizontal", hint: "YouTube · desktop" },
  { id: "1:1", w: 1080, h: 1080, label: "Square", hint: "Instagram feed" },
  { id: "4:5", w: 1080, h: 1350, label: "Portrait", hint: "Instagram portrait" },
];

/** Ordered keys so consecutive video clips cycle through the gradient sources. */
const SRC_KEYS = ["intro", "broll", "closing"] as const;

// ─────────────────────────────────────────────────────────────────────────────
// Deterministic derivations (schema → view extras; never mutate the schema)
// ─────────────────────────────────────────────────────────────────────────────

const MS_PER_SEC = 1000;
const toSec = (ms: number): number => ms / MS_PER_SEC;

/** A pure 32-bit-ish hash of a string id → positive int. Used for waveform seeds
 *  so an audio clip's waveform is stable across renders without storing a seed. */
function hashId(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  // Keep it small + positive; rng() in lib/format reduces mod 2147483647.
  return (h >>> 0) % 2147483646 || 7;
}

/** Schema track type → the view's lane kind (voiceover folds into audio). */
function viewTrackType(t: Track): TrackViewType {
  switch (t.type) {
    case "video":
      return "video";
    case "audio":
    case "voiceover":
      return "audio";
    case "overlay":
      return "overlay";
    case "caption":
      return "caption";
  }
}

/** True for schema tracks carrying media `Clip[]` (video/audio/voiceover). */
function isMediaTrack(t: Track): t is Extract<Track, { clips: Clip[] }> {
  return t.type === "video" || t.type === "audio" || t.type === "voiceover";
}

/**
 * Build the seconds-based view of the whole project.
 *
 * Lane order (top→bottom) matches the design mockup: overlay → video →
 * audio/voiceover → caption. The schema stores tracks bottom→top (video index 0
 * = bottom z-order, §18); we regroup for display only — the store array is left
 * untouched, so z-order semantics are preserved.
 */
function buildTimelineView(project: Project, durationMs: number): TimelineView {
  const tracks: TrackView[] = [];
  const clips: ClipView[] = [];

  // Per-type running counters → stable "short" labels (V1, A1, OV, CC…).
  const shortPrefix: Record<TrackViewType, string> = {
    overlay: "OV",
    video: "V",
    audio: "A",
    caption: "CC",
  };
  const shortCount: Record<TrackViewType, number> = {
    overlay: 0,
    video: 0,
    audio: 0,
    caption: 0,
  };
  const shortFor = (type: TrackViewType): string => {
    shortCount[type] += 1;
    // Overlay/caption use a bare prefix (matches OV / CC in the mockup).
    return type === "overlay" || type === "caption"
      ? shortPrefix[type]
      : `${shortPrefix[type]}${shortCount[type]}`;
  };

  const pushTrack = (t: Track | CaptionTrack): void => {
    const type = viewTrackType(t);
    const short = shortFor(type);

    if (isMediaTrack(t)) {
      // First clip's name doubles as the lane label (mirrors data.jsx "intro.mp4").
      const firstClip = t.clips[0];
      const laneName = mediaTrackLabel(t, firstClip);
      const view: TrackView = {
        id: t.id,
        type,
        name: laneName,
        short,
        h: t.height,
        mute: t.muted,
        solo: t.solo,
        locked: t.locked,
      };
      if (type === "audio") view.pan = (t as Extract<Track, { pan: number }>).pan;
      tracks.push(view);

      for (const clip of t.clips) clips.push(mediaClipView(clip, type, t.name));
      // Assign deterministic src keys to this track's video clips.
      if (type === "video") assignVideoSrc(clips, t.clips);
      return;
    }

    if (t.type === "overlay") {
      tracks.push({
        id: t.id,
        type: "overlay",
        name: t.name,
        short,
        h: t.height,
        mute: t.muted,
        solo: t.solo,
        locked: t.locked,
      });
      for (const ov of t.clips) clips.push(overlayClipView(ov));
      return;
    }

    // Caption track.
    const captionLabel = languageLabel(t.language) || t.name;
    tracks.push({
      id: t.id,
      type: "caption",
      name: captionLabel,
      short,
      h: t.height,
      mute: t.muted,
      solo: t.solo,
      locked: t.locked,
    });
    for (const block of t.blocks) clips.push(captionBlockView(block, t.id));
  };

  // Group + order the schema tracks for top→bottom display.
  const overlay = project.tracks.filter((t) => t.type === "overlay");
  const video = project.tracks.filter((t) => t.type === "video");
  const audio = project.tracks.filter(
    (t) => t.type === "audio" || t.type === "voiceover",
  );

  for (const t of overlay) pushTrack(t);
  for (const t of video) pushTrack(t);
  for (const t of audio) pushTrack(t);
  for (const ct of project.captionTracks) pushTrack(ct);

  return {
    tracks,
    clips,
    durationSec: toSec(durationMs),
    fps: project.canvas.frameRate,
    project: {
      name: project.title,
      ratio: project.canvas.aspectRatio,
      w: project.canvas.width,
      h: project.canvas.height,
      bg: project.canvas.backgroundColor,
    },
  };
}

/** Lane label for a media track — prefer the first clip's display name. */
function mediaTrackLabel(
  track: Extract<Track, { clips: Clip[] }>,
  firstClip: Clip | undefined,
): string {
  if (firstClip) {
    const guess = clipDisplayName(firstClip, track.type);
    if (guess) return guess;
  }
  return track.name;
}

/** Best-effort human file name for a media clip (the schema has no name field). */
function clipDisplayName(clip: Clip, trackType: Track["type"]): string {
  if (trackType === "video") {
    return videoFileName(clip);
  }
  if (trackType === "voiceover") return "voice over";
  return "music.mp3";
}

/** Map a video clip to a believable file name by its source-key bucket. */
function videoFileName(clip: Clip): string {
  const key = srcKeyFor(clip);
  return key === "intro" ? "intro.mp4" : key === "broll" ? "b-roll.mp4" : "closing.mp4";
}

/** Deterministic source-key bucket for a video clip (stable by id hash). */
function srcKeyFor(clip: Clip): (typeof SRC_KEYS)[number] {
  const idx = hashId(clip.id) % SRC_KEYS.length;
  return SRC_KEYS[idx] ?? "intro";
}

/** Build a media (video/audio) ClipView. */
function mediaClipView(
  clip: Clip,
  type: TrackViewType,
  trackName: string,
): ClipView {
  const view: ClipView = {
    id: clip.id,
    trackId: clip.trackId,
    type: type === "video" ? "video" : "audio",
    name:
      type === "video"
        ? videoFileName(clip)
        : trackName || (type === "audio" ? "music.mp3" : "audio"),
    start: toSec(clip.startOnTimeline),
    dur: toSec(clip.endOnTimeline - clip.startOnTimeline),
  };
  if (clip.speed !== 1) view.speed = clip.speed;
  if (clip.linkedClipId) view.linked = clip.linkedClipId;
  if (type === "audio") view.seed = hashId(clip.id);
  return view;
}

/** Assign each video clip a SCENE_GRADS source key (deterministic by id). */
function assignVideoSrc(views: ClipView[], schemaClips: Clip[]): void {
  for (const sc of schemaClips) {
    const v = views.find((x) => x.id === sc.id);
    if (v && v.type === "video") v.src = srcKeyFor(sc);
  }
}

/** Build an overlay ClipView. */
function overlayClipView(ov: OverlayClip): ClipView {
  // Treat a tiny logo-ish text overlay as the "logo" kind from the mockup; else text.
  const kind = ov.kind === "text" ? "text" : "logo";
  const text = ov.kind === "text" ? (ov as TextOverlay).text : "VF";
  return {
    id: ov.id,
    trackId: ov.trackId,
    type: "overlay",
    name: text,
    start: toSec(ov.startOnTimeline),
    dur: toSec(ov.endOnTimeline - ov.startOnTimeline),
    text,
    kind,
  };
}

/** Build a caption ClipView from a caption block. */
function captionBlockView(block: CaptionBlock, trackId: string): ClipView {
  return {
    id: block.id,
    trackId,
    type: "caption",
    name: block.text,
    start: toSec(block.startMs),
    dur: toSec(block.endMs - block.startMs),
  };
}

/** Friendly language label for a BCP-47 tag. */
function languageLabel(lang: string): string {
  const map: Record<string, string> = {
    en: "English",
    es: "Spanish",
    fr: "French",
    de: "German",
  };
  return map[lang.toLowerCase()] ?? lang.toUpperCase();
}

// ─────────────────────────────────────────────────────────────────────────────
// Selection-kind resolution (the view selects by bare id; the store needs a kind)
// ─────────────────────────────────────────────────────────────────────────────

/** Resolve which schema entity an id refers to → the store's SelectionKind. */
function resolveSelectionKind(project: Project, id: string): SelectionKind {
  for (const track of project.tracks) {
    if (track.type === "caption") continue;
    if (track.type === "overlay") {
      if (track.clips.some((c) => c.id === id)) return "overlay";
    } else if (track.clips.some((c) => c.id === id)) {
      return "clip";
    }
    if (track.id === id) return "track";
  }
  for (const ct of project.captionTracks) {
    if (ct.id === id) return "track";
    if (ct.blocks.some((b) => b.id === id)) return "caption";
  }
  // Unknown id — default to clip so a stray select still routes somewhere sane.
  return "clip";
}

// ─────────────────────────────────────────────────────────────────────────────
// Hooks (the public surface the components import)
// ─────────────────────────────────────────────────────────────────────────────

/** The full seconds-based timeline view, recomputed when the project changes. */
export function useTimelineView(): TimelineView {
  const project = useEditorStore((s) => s.project);
  const durationMs = useEditorStore(selectProjectDurationMs);
  return useMemo(
    () => buildTimelineView(project, durationMs),
    [project, durationMs],
  );
}

/** Playhead position in SECONDS (store stores ms). */
export function usePlayheadSec(): number {
  return useEditorStore((s) => toSec(s.playheadMs));
}

/** Setter for the playhead in SECONDS → store ms. */
export function useSetPlayheadSec(): (sec: number) => void {
  const setPlayhead = useEditorStore((s) => s.setPlayhead);
  return (sec: number) => setPlayhead(Math.round(sec * MS_PER_SEC));
}

/** Transport controls (NOT undoable). */
export function useTransport(): TransportView {
  const isPlaying = useEditorStore((s) => s.isPlaying);
  const togglePlay = useEditorStore((s) => s.togglePlay);
  const play = useEditorStore((s) => s.play);
  const pause = useEditorStore((s) => s.pause);
  return { isPlaying, togglePlay, play, pause };
}

/**
 * Timeline scale in PIXELS-PER-SECOND. The store's canonical scale is also px/sec
 * (DEFAULT_PX_PER_SECOND = 100), so this is a direct read of `pxPerSecond`.
 */
export function usePxPerSec(): number {
  return useEditorStore((s) => s.pxPerSecond);
}

/** Selection bridge: components select by bare id; we resolve the schema kind. */
export function useSelection(): SelectionView {
  const selId = useEditorStore((s) => s.selection.id);
  const select = useEditorStore((s) => s.select);
  const clearSelection = useEditorStore((s) => s.clearSelection);

  return {
    sel: selId,
    select: (id: string | null) => {
      if (id == null) {
        clearSelection();
        return;
      }
      const project = useEditorStore.getState().project;
      select(resolveSelectionKind(project, id), id);
    },
    clear: clearSelection,
  };
}
