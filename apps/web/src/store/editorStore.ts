// ─────────────────────────────────────────────────────────────────────────────
// VideoForge editor store — the single source of edit state for apps/web.
//
// PUBLIC API (the contract — packages depend on this exact surface):
//   useEditorStore        Zustand hook (Immer middleware)
//   State                 { project, selection, playheadMs, isPlaying, zoom, pxPerSecond }
//   Actions               loadProject, setPlayhead, play, pause, togglePlay, select,
//                         clearSelection, addClipFromAsset, moveClip, trimClip,
//                         splitAtPlayhead, deleteSelected, duplicateSelected, addTrack,
//                         setTrackMute, setTrackSolo, setZoom, undo, redo
//   Selectors             selectAllTracks, selectClip, selectProjectDurationMs
//   canUndo() / canRedo() via state flags
//
// DOMAIN INVARIANTS enforced here (§18):
//   • time is integer MILLISECONDS everywhere
//   • trimIn/trimOut are measured from the SOURCE asset origin
//   • canvas geometry (canvasX/Y/width/height) is PERCENT 0–100
//   • ids are UUID v4
//   • TRACK ARRAY INDEX = z-order (video index 0 = bottom) and audio mix order
//   • transitions are TOP-LEVEL objects referencing fromClipId/toClipId
//
// Undo/redo is an Immer-patch stack (src/store/history.ts) capped at 200; only the
// `project` is versioned. Mutations go through `commit()` so every undoable change
// records a patch pair. Pure navigation (playhead, zoom, selection, play/pause)
// does NOT push undo.
// ─────────────────────────────────────────────────────────────────────────────

import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import { v4 as uuidv4 } from "uuid";
import {
  sampleProject,
  type Clip,
  type OverlayClip,
  type Project,
  type Track,
  type TextOverlay,
  type CaptionBlock,
  type Keyframe,
  type ColorGrade,
  type KenBurns,
  type ClipTransform,
} from "@videoforge/project-schema";
import {
  canRedo as historyCanRedo,
  canUndo as historyCanUndo,
  createHistory,
  pushHistory,
  recordedProduce,
  redo as historyRedo,
  undo as historyUndo,
  type History,
} from "./history.js";

// ── M4 creative-layer types ───────────────────────────────────────────────────
// ColorGrade / KenBurns are now first-class §18 Clip fields (schema package); we
// re-export them here so existing importers (Inspector etc.) keep working.
export type { ColorGrade, KenBurns } from "@videoforge/project-schema";

// ── Types ───────────────────────────────────────────────────────────────────

export type SelectionKind = "clip" | "overlay" | "caption" | "track" | null;

export interface Selection {
  kind: SelectionKind;
  id: string | null;
}

export type AddTrackKind = "video" | "audio" | "voiceover" | "overlay";

export interface EditorState {
  project: Project;
  selection: Selection;
  /** Playhead position on the timeline, integer ms. */
  playheadMs: number;
  isPlaying: boolean;
  /** Zoom expressed as pixels-per-second (the canonical timeline scale). */
  zoom: number;
  /** Computed alias of `zoom` (px per second) — kept in sync on every setZoom. */
  pxPerSecond: number;

  // Undo/redo bookkeeping (history is plain data; flags mirror it for the UI).
  _history: History;
  _canUndo: boolean;
  _canRedo: boolean;
}

export interface EditorActions {
  loadProject: (p: Project) => void;
  setPlayhead: (ms: number) => void;
  play: () => void;
  pause: () => void;
  togglePlay: () => void;
  select: (kind: SelectionKind, id: string | null) => void;
  clearSelection: () => void;
  /**
   * Add a clip referencing `assetId` to `trackId` at `atMs`. `sourceDurationMs` is
   * the asset's real source length (from the asset registry); when omitted the clip
   * falls back to a default span. The clip spans the full source (trimIn=0).
   */
  addClipFromAsset: (
    assetId: string,
    trackId: string,
    atMs: number,
    sourceDurationMs?: number,
  ) => void;
  /**
   * Add a clip as an on-canvas picture-in-picture: a new video track on TOP of the
   * z-order (last video track = topmost) with a centred 50%-size transform. Used by
   * drag-media-onto-canvas. Returns nothing; selects the new clip.
   */
  addClipToCanvas: (assetId: string, atMs: number, sourceDurationMs?: number) => void;
  moveClip: (clipId: string, toTrackId: string, startMs: number) => void;
  trimClip: (clipId: string, edge: "start" | "end", newMs: number) => void;
  splitAtPlayhead: () => void;
  deleteSelected: () => void;
  duplicateSelected: () => void;
  addTrack: (kind: AddTrackKind) => void;
  setTrackMute: (trackId: string, muted: boolean) => void;
  setTrackSolo: (trackId: string, solo: boolean) => void;
  // DESIGN-PORT-STUB: lock toggle the timeline TrackHeader needs; mirrors setTrackMute/Solo.
  setTrackLocked: (trackId: string, locked: boolean) => void;
  setZoom: (z: number) => void;
  undo: () => void;
  redo: () => void;

  // ── M4: Keyframe animation ──────────────────────────────────────────────────
  /** Add a keyframe for `property` at `ms` on the given clip. */
  addKeyframe: (
    clipId: string,
    trackId: string,
    ms: number,
    property: string,
    value: number,
  ) => void;
  removeKeyframe: (clipId: string, trackId: string, keyframeId: string) => void;
  updateKeyframe: (
    clipId: string,
    trackId: string,
    keyframeId: string,
    value: number,
  ) => void;

  /** Set a constant per-clip opacity (0–100) as a single t=0 keyframe (export reads it). */
  setClipOpacity: (clipId: string, trackId: string, opacity: number) => void;

  /**
   * Set a clip's playback speed multiplier (0.1×–16×). Writes the schema/graph
   * `speed` field the export already consumes (setpts/atempo) — preview and export
   * stay in lockstep (WYCIWYG). Clamped to a sane MVP range; never ≤ 0 (schema: speed > 0).
   */
  setClipSpeed: (clipId: string, trackId: string, speed: number) => void;

  // ── M4: Per-clip color grade ────────────────────────────────────────────────
  setClipColorGrade: (clipId: string, trackId: string, grade: ColorGrade) => void;

  // ── M4: Ken Burns effect ────────────────────────────────────────────────────
  setClipKenBurns: (clipId: string, trackId: string, kb: KenBurns | null) => void;

  // ── Templates: fill a media slot ──────────────────────────────────────────────
  /**
   * Replace a clip's source asset (filling a template media slot). Keeps the clip's
   * timeline placement, effects, color grade, and Ken Burns intact; only swaps the
   * asset. When `newSourceDurationMs` is given, re-bases the trims onto the new source
   * so a shorter asset can't over-trim (trimIn=0, trimOut=min(trimOut, newSourceDur)).
   * Mirrors the existing setClip* shape; funnels through commit() so it is undoable +
   * autosaved. (Templates_Architecture §4.4.)
   */
  replaceClipAsset: (
    clipId: string,
    trackId: string,
    newAssetId: string,
    newSourceDurationMs?: number,
  ) => void;

  // ── On-canvas transform (PiP) ─────────────────────────────────────────────────
  /** Set (or clear) a clip's on-canvas transform box. Pass undefined to reset to full-frame. */
  setClipTransform: (clipId: string, trackId: string, transform: ClipTransform | undefined) => void;
  /** Mirror a clip horizontally/vertically (export hflip/vflip). */
  setClipFlip: (clipId: string, trackId: string, axis: "h" | "v", value: boolean) => void;
  /** Re-order a clip's video track in the z-stack (forward = on top). */
  moveClipLayer: (clipId: string, dir: "forward" | "backward") => void;
  /** Detach a clip from its A/V link partner so video + audio move/trim independently. */
  detachAudio: (clipId: string) => void;

  // ── M4: Per-clip gain + fades ─────────────────────────────────────────────────
  setClipGain: (clipId: string, trackId: string, gain: number) => void;
  setClipFade: (clipId: string, trackId: string, edge: "in" | "out", ms: number) => void;

  // ── M4: Per-track audio mix ───────────────────────────────────────────────────
  setTrackVolume: (trackId: string, volume: number) => void;
  setTrackPan: (trackId: string, pan: number) => void;

  // ── M4: Text overlay ────────────────────────────────────────────────────────
  /** Add a text overlay clip to the overlay track `trackId` at `startOnTimeline` ms. */
  addTextOverlay: (text: string, trackId: string, startOnTimeline: number) => void;
  /** Patch an overlay's editable fields (text, geometry, opacity, style). */
  updateOverlay: (overlayId: string, patch: Partial<OverlayClip>) => void;

  // ── M4: Crossfade transitions ─────────────────────────────────────────────────
  /** Create a crossfade between `clipId` and the next clip on its track. No-op if none. */
  addCrossfade: (clipId: string, durationMs?: number) => void;
  /** Remove a transition by id. */
  removeTransition: (transitionId: string) => void;

  // ── M4: Caption import + edit ─────────────────────────────────────────────────
  /** Replace the first captionTrack's blocks with the given parsed caption blocks. */
  importCaptions: (blocks: CaptionBlock[]) => void;
  /** Patch a caption block's editable fields (text, start/end). */
  updateCaption: (blockId: string, patch: Partial<Pick<CaptionBlock, "text" | "startMs" | "endMs">>) => void;
}

export type EditorStore = EditorState & EditorActions;

// ── Constants ─────────────────────────────────────────────────────────────────

/** Default timeline scale: 100 px per second of project time. */
export const DEFAULT_PX_PER_SECOND = 100;
const MIN_PX_PER_SECOND = 10;
const MAX_PX_PER_SECOND = 800;
const HISTORY_LIMIT = 200;

/** Per-clip speed multiplier bounds (MVP): 0.1× slow-mo … 16× fast-forward. */
export const MIN_CLIP_SPEED = 0.1;
export const MAX_CLIP_SPEED = 16;

// ── Internal helpers (pure, operate on a Project) ──────────────────────────────

const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));
const ms = (n: number): number => Math.max(0, Math.round(n));

/** Track kinds that carry media `Clip[]` (not overlay/caption). */
function isMediaTrack(
  t: Track,
): t is Extract<Track, { clips: Clip[] }> {
  return t.type === "video" || t.type === "audio" || t.type === "voiceover";
}

/**
 * Find the earliest start (≥ `notBefore`) on a track where a `span`-ms window fits
 * without overlapping any of `others` (the track's other clips). Used by duplicate so
 * a copy lands in the first free gap after the original instead of overlapping the
 * next clip on a packed track. Returns `notBefore` when nothing is in the way.
 */
function firstFreeSlotStart(
  others: ReadonlyArray<{ startOnTimeline: number; endOnTimeline: number }>,
  span: number,
  notBefore: number,
): number {
  // Consider only clips that could collide at or after `notBefore`, in start order.
  const sorted = others
    .filter((c) => c.endOnTimeline > notBefore)
    .sort((a, b) => a.startOnTimeline - b.startOnTimeline);
  let candidate = notBefore;
  for (const c of sorted) {
    // The window [candidate, candidate+span) overlaps c → jump past c and retry.
    if (candidate < c.endOnTimeline && c.startOnTimeline < candidate + span) {
      candidate = c.endOnTimeline;
    }
  }
  return candidate;
}

/** Find a media clip by id across all media tracks; returns the clip + its track. */
function findClip(
  project: Project,
  clipId: string,
): { clip: Clip; track: Extract<Track, { clips: Clip[] }> } | null {
  for (const track of project.tracks) {
    if (!isMediaTrack(track)) continue;
    const clip = track.clips.find((c) => c.id === clipId);
    if (clip) return { clip, track };
  }
  return null;
}

/**
 * Find a media clip by id, optionally scoped to a specific trackId (faster).
 * Falls back to scanning all media tracks when trackId is unknown/incorrect.
 */
function findClipInTrack(
  project: Project,
  clipId: string,
  trackId: string,
): { clip: Clip; track: Extract<Track, { clips: Clip[] }> } | null {
  // Fast path: find directly in the named track.
  const namedTrack = project.tracks.find((t) => t.id === trackId);
  if (namedTrack && isMediaTrack(namedTrack)) {
    const clip = namedTrack.clips.find((c) => c.id === clipId);
    if (clip) return { clip, track: namedTrack };
  }
  // Fallback: scan all media tracks.
  return findClip(project, clipId);
}

/** Find an overlay clip by id across overlay tracks. */
function findOverlay(
  project: Project,
  overlayId: string,
): { clip: OverlayClip; track: Extract<Track, { type: "overlay" }> } | null {
  for (const track of project.tracks) {
    if (track.type !== "overlay") continue;
    const clip = track.clips.find((c) => c.id === overlayId);
    if (clip) return { clip, track };
  }
  return null;
}

/** Default lane height + header tint per track type (§2.5 track colors). */
function trackDefaults(kind: AddTrackKind): { name: string; colour: string; height: number } {
  switch (kind) {
    case "video":
      return { name: "Video", colour: "#2BC4B0", height: 72 };
    case "audio":
      return { name: "Audio", colour: "#7C9CFF", height: 56 };
    case "voiceover":
      return { name: "Voice Over", colour: "#FF6B6B", height: 56 };
    case "overlay":
      return { name: "Overlays", colour: "#FF9EC4", height: 56 };
  }
}

function makeTrack(kind: AddTrackKind, indexLabel: number): Track {
  const base = trackDefaults(kind);
  const common = {
    id: uuidv4(),
    name: `${base.name} ${indexLabel}`,
    colour: base.colour,
    height: base.height,
    muted: false,
    solo: false,
    locked: false,
  };
  switch (kind) {
    case "video":
      return { ...common, type: "video", clips: [] };
    case "overlay":
      return { ...common, type: "overlay", clips: [] };
    case "audio":
      return { ...common, type: "audio", volume: 100, pan: 0, volumeEnvelope: [], clips: [] };
    case "voiceover":
      return {
        ...common,
        type: "voiceover",
        volume: 100,
        pan: 0,
        volumeEnvelope: [],
        clips: [],
      };
  }
}

/**
 * Fallback clip span (ms) when an asset's real source duration is unknown (e.g. a
 * clip dropped before ffprobe metadata has arrived). Callers normally pass the real
 * `sourceDurationMs` from the asset registry, populated by the worker's ffprobe step.
 */
const DEFAULT_NEW_CLIP_MS = 4000;

// ── Store ──────────────────────────────────────────────────────────────────────

export const useEditorStore = create<EditorStore>()(
  immer((set, get) => {
    /**
     * Run an undoable mutation against `project`, record the patch pair, and update
     * the history + flags. All structural edits funnel through here so undo/redo is
     * uniform and the 200-entry cap is enforced in one place.
     */
    const commit = (recipe: (project: Project) => void): void => {
      const state = get();
      const { next, entry } = recordedProduce(state.project, recipe);
      if (entry.patches.length === 0) return; // no-op recipe — skip
      const history = pushHistory(state._history, entry);
      set((s) => {
        s.project = next;
        s._history = history;
        s._canUndo = historyCanUndo(history);
        s._canRedo = historyCanRedo(history);
      });
    };

    return {
      // ── Initial state (seeded from the sample project) ──
      project: sampleProject,
      selection: { kind: null, id: null },
      playheadMs: 0,
      isPlaying: false,
      zoom: DEFAULT_PX_PER_SECOND,
      pxPerSecond: DEFAULT_PX_PER_SECOND,
      _history: createHistory(HISTORY_LIMIT),
      _canUndo: false,
      _canRedo: false,

      // ── Project lifecycle ──
      loadProject: (p) =>
        set((s) => {
          s.project = p;
          s.selection = { kind: null, id: null };
          s.playheadMs = 0;
          s.isPlaying = false;
          // A freshly loaded project starts a new history timeline.
          s._history = createHistory(HISTORY_LIMIT);
          s._canUndo = false;
          s._canRedo = false;
        }),

      // ── Transport / navigation (NOT undoable) ──
      setPlayhead: (msVal) =>
        set((s) => {
          s.playheadMs = ms(msVal);
        }),
      play: () =>
        set((s) => {
          s.isPlaying = true;
        }),
      pause: () =>
        set((s) => {
          s.isPlaying = false;
        }),
      togglePlay: () =>
        set((s) => {
          s.isPlaying = !s.isPlaying;
        }),

      // ── Selection (NOT undoable) ──
      select: (kind, id) =>
        set((s) => {
          s.selection = { kind, id };
        }),
      clearSelection: () =>
        set((s) => {
          s.selection = { kind: null, id: null };
        }),

      // ── Clip operations (undoable) ──
      addClipFromAsset: (assetId, trackId, atMs, sourceDurationMs) => {
        const clipId = uuidv4();
        const linkedAudioId = uuidv4();
        commit((project) => {
          const track = project.tracks.find((t) => t.id === trackId);
          if (!track || !isMediaTrack(track)) return;
          const start = ms(atMs);
          // Use the real source duration when known; otherwise the default span.
          const span = sourceDurationMs && sourceDurationMs > 0 ? ms(sourceDurationMs) : DEFAULT_NEW_CLIP_MS;
          const clip: Clip = {
            id: clipId,
            sourceAssetId: assetId,
            trackId,
            startOnTimeline: start,
            endOnTimeline: start + span,
            trimIn: 0,
            trimOut: span,
            speed: 1,
            effects: [],
            keyframes: {},
            linkedClipId: null,
          };
          track.clips.push(clip);

          // Audio Link (§3.2): a video clip carries its embedded audio as a linked
          // audio clip on an audio track, so the audio is audible AND stays in sync on
          // move/split. Reuse an existing audio/voiceover track; else create one within
          // the Free-tier cap (2 audio). Skip if no track is available.
          if (track.type === "video") {
            let audioTrack = project.tracks.find(
              (t): t is Extract<Track, { clips: Clip[] }> => t.type === "audio" || t.type === "voiceover",
            );
            if (!audioTrack) {
              const audioCount = project.tracks.filter((t) => t.type === "audio").length;
              if (audioCount < 2) {
                const created = makeTrack("audio", audioCount + 1);
                project.tracks.push(created);
                if (isMediaTrack(created)) audioTrack = created;
              }
            }
            if (audioTrack) {
              const audioClip: Clip = {
                id: linkedAudioId,
                sourceAssetId: assetId,
                trackId: audioTrack.id,
                startOnTimeline: start,
                endOnTimeline: start + span,
                trimIn: 0,
                trimOut: span,
                speed: 1,
                effects: [],
                keyframes: {},
                linkedClipId: clipId,
              };
              clip.linkedClipId = linkedAudioId;
              audioTrack.clips.push(audioClip);
            }
          }
        });
        set((s) => {
          s.selection = { kind: "clip", id: clipId };
        });
      },

      addClipToCanvas: (assetId, atMs, sourceDurationMs) => {
        const clipId = uuidv4();
        commit((project) => {
          const span =
            sourceDurationMs && sourceDurationMs > 0 ? ms(sourceDurationMs) : DEFAULT_NEW_CLIP_MS;
          const start = ms(atMs);
          // New video track PUSHED to the end of the array → topmost in z-order
          // (video tracks composite bottom-up, last = on top), so the PiP sits above
          // the base footage. Centred at 50% size.
          const videoCount = project.tracks.filter((t) => t.type === "video").length;
          const track = makeTrack("video", videoCount + 1);
          if (!isMediaTrack(track)) return;
          project.tracks.push(track);
          track.clips.push({
            id: clipId,
            sourceAssetId: assetId,
            trackId: track.id,
            startOnTimeline: start,
            endOnTimeline: start + span,
            trimIn: 0,
            trimOut: span,
            speed: 1,
            effects: [],
            keyframes: {},
            linkedClipId: null,
            transform: { x: 25, y: 25, width: 50, height: 50 },
          });
        });
        set((s) => {
          s.selection = { kind: "clip", id: clipId };
        });
      },

      moveClip: (clipId, toTrackId, startMs) => {
        commit((project) => {
          const found = findClip(project, clipId);
          if (!found) return;
          const dest = project.tracks.find((t) => t.id === toTrackId);
          if (!dest || !isMediaTrack(dest)) return;

          const { clip, track: from } = found;
          const span = clip.endOnTimeline - clip.startOnTimeline;
          const newStart = ms(startMs);
          const delta = newStart - clip.startOnTimeline;
          const linkedId = clip.linkedClipId ?? null;

          // Detach from the source track if it's actually moving tracks.
          if (from.id !== dest.id) {
            from.clips = from.clips.filter((c) => c.id !== clipId);
            const moved: Clip = { ...clip, trackId: dest.id };
            moved.startOnTimeline = newStart;
            moved.endOnTimeline = newStart + span;
            dest.clips.push(moved);
          } else {
            clip.startOnTimeline = newStart;
            clip.endOnTimeline = newStart + span;
          }

          // Audio Link: shift the linked partner by the same delta on its own track.
          if (linkedId && delta !== 0) {
            const linked = findClip(project, linkedId);
            if (linked) {
              const lspan = linked.clip.endOnTimeline - linked.clip.startOnTimeline;
              const ns = Math.max(0, linked.clip.startOnTimeline + delta);
              linked.clip.startOnTimeline = ns;
              linked.clip.endOnTimeline = ns + lspan;
            }
          }
        });
      },

      trimClip: (clipId, edge, newMs) => {
        commit((project) => {
          const found = findClip(project, clipId);
          if (!found) return;
          const { clip } = found;
          // 1-frame minimum (§3.3) derived from the project frame rate, not a fixed ms.
          const minClip = Math.max(1, Math.round(1000 / (project.canvas.frameRate || 30)));
          const target = ms(newMs);

          // Apply a trim to one clip; returns the {edge,newPos} delta for linked sync.
          const applyTrim = (c: Clip): void => {
            if (edge === "start") {
              // Moving the start edge trims into the source from its origin: the head
              // shift adds to trimIn (asset-relative). Cannot reach/cross the end.
              const maxStart = c.endOnTimeline - minClip;
              const newStart = clamp(target, 0, Math.max(0, maxStart));
              const delta = newStart - c.startOnTimeline;
              c.startOnTimeline = newStart;
              // trimIn shifts by the source amount (× speed); clamp ≥ 0 and < trimOut.
              const minSourceSpan = Math.max(1, Math.round(minClip * c.speed));
              c.trimIn = clamp(ms(c.trimIn + delta * c.speed), 0, c.trimOut - minSourceSpan);
            } else {
              // Moving the end edge: clamp to be after the start by one frame.
              const minEnd = c.startOnTimeline + minClip;
              const newEnd = Math.max(minEnd, target);
              const delta = newEnd - c.endOnTimeline;
              c.endOnTimeline = newEnd;
              const minSourceSpan = Math.max(1, Math.round(minClip * c.speed));
              c.trimOut = Math.max(c.trimIn + minSourceSpan, ms(c.trimOut + delta * c.speed));
            }
          };

          applyTrim(clip);
          // Audio Link: trim the linked partner identically so A/V stays aligned.
          const linkedId = clip.linkedClipId ?? null;
          if (linkedId) {
            const linked = findClip(project, linkedId);
            if (linked) applyTrim(linked.clip);
          }
        });
      },

      splitAtPlayhead: () => {
        const { playheadMs, selection } = get();
        const playhead = ms(playheadMs);
        // New ids generated outside the recipe so they're stable across patch replay.
        const newClipId = uuidv4();
        const newLinkedId = uuidv4();

        commit((project) => {
          // Determine which clip to split: the selected media clip if it straddles
          // the playhead, else the first media clip under the playhead.
          let primaryId: string | null =
            selection.kind === "clip" ? selection.id : null;

          const straddles = (c: Clip): boolean =>
            playhead > c.startOnTimeline && playhead < c.endOnTimeline;

          if (!primaryId || !findClip(project, primaryId) || !straddles(findClip(project, primaryId)!.clip)) {
            primaryId = null;
            for (const track of project.tracks) {
              if (!isMediaTrack(track)) continue;
              const hit = track.clips.find(straddles);
              if (hit) {
                primaryId = hit.id;
                break;
              }
            }
          }
          if (!primaryId) return;

          // Split a single media clip in place; returns the new (right-hand) id used.
          const splitOne = (clipId: string, useId: string): void => {
            const found = findClip(project, clipId);
            if (!found || !straddles(found.clip)) return;
            const { clip, track } = found;
            const offset = playhead - clip.startOnTimeline; // timeline ms into the clip
            // Source split point honours playback speed (asset-relative).
            const sourceSplit = ms(clip.trimIn + offset * clip.speed);

            const right: Clip = {
              ...clip,
              id: useId,
              startOnTimeline: playhead,
              endOnTimeline: clip.endOnTimeline,
              trimIn: sourceSplit,
              trimOut: clip.trimOut,
              // Effects/keyframes are shallow-copied with the spread; deep refs are
              // acceptable for the MVP split (Immer freezes; no later mutation aliases).
              linkedClipId: clip.linkedClipId ?? null,
            };
            // Left half keeps the original id; clamp its tail to the playhead.
            clip.endOnTimeline = playhead;
            clip.trimOut = sourceSplit;

            const idx = track.clips.findIndex((c) => c.id === clip.id);
            track.clips.splice(idx + 1, 0, right);
          };

          // Split the primary clip, and split its linked A/V partner at the same
          // playhead so linked audio/video stay in sync (§18 A/V link group).
          const primary = findClip(project, primaryId);
          const linkedId = primary?.clip.linkedClipId ?? null;
          splitOne(primaryId, newClipId);
          if (linkedId && findClip(project, linkedId)) {
            splitOne(linkedId, newLinkedId);
            // Re-link the two new right halves to each other.
            const newRight = findClip(project, newClipId);
            const newLinkedRight = findClip(project, newLinkedId);
            if (newRight && newLinkedRight) {
              newRight.clip.linkedClipId = newLinkedId;
              newLinkedRight.clip.linkedClipId = newClipId;
            }
          }
        });
      },

      deleteSelected: () => {
        const { selection } = get();
        if (!selection.id || selection.kind === null) return;
        const { kind, id } = selection;
        commit((project) => {
          switch (kind) {
            case "clip": {
              for (const track of project.tracks) {
                if (!isMediaTrack(track)) continue;
                track.clips = track.clips.filter((c) => c.id !== id);
              }
              // Drop any transition that referenced the removed clip.
              project.transitions = project.transitions.filter(
                (t) => t.fromClipId !== id && t.toClipId !== id,
              );
              break;
            }
            case "overlay": {
              for (const track of project.tracks) {
                if (track.type !== "overlay") continue;
                track.clips = track.clips.filter((c) => c.id !== id);
              }
              break;
            }
            case "caption": {
              for (const ct of project.captionTracks) {
                ct.blocks = ct.blocks.filter((b) => b.id !== id);
              }
              break;
            }
            case "track": {
              project.tracks = project.tracks.filter((t) => t.id !== id);
              project.captionTracks = project.captionTracks.filter((t) => t.id !== id);
              break;
            }
          }
        });
        set((s) => {
          s.selection = { kind: null, id: null };
        });
      },

      duplicateSelected: () => {
        const { selection } = get();
        if (!selection.id) return;
        const { kind, id } = selection;
        const newId = uuidv4();
        commit((project) => {
          if (kind === "clip") {
            const found = findClip(project, id);
            if (!found) return;
            const { clip, track } = found;
            const span = clip.endOnTimeline - clip.startOnTimeline;
            // Place the copy in the first free slot AFTER the original rather than at
            // the original's end — on a packed track that would overlap the next clip.
            const others = track.clips.filter((c) => c.id !== clip.id);
            const start = firstFreeSlotStart(others, span, clip.endOnTimeline);
            const copy: Clip = {
              ...clip,
              id: newId,
              startOnTimeline: start,
              endOnTimeline: start + span,
              linkedClipId: null, // a duplicate is not part of the original link group
            };
            const idx = track.clips.findIndex((c) => c.id === clip.id);
            track.clips.splice(idx + 1, 0, copy);
          } else if (kind === "overlay") {
            const found = findOverlay(project, id);
            if (!found) return;
            const { clip, track } = found;
            const span = clip.endOnTimeline - clip.startOnTimeline;
            const others = track.clips.filter((c) => c.id !== clip.id);
            const start = firstFreeSlotStart(others, span, clip.endOnTimeline);
            const copy = {
              ...clip,
              id: newId,
              startOnTimeline: start,
              endOnTimeline: start + span,
            } as OverlayClip;
            const idx = track.clips.findIndex((c) => c.id === clip.id);
            track.clips.splice(idx + 1, 0, copy);
          }
        });
        if (kind === "clip" || kind === "overlay") {
          set((s) => {
            s.selection = { kind, id: newId };
          });
        }
      },

      // ── Track operations (undoable) ──
      addTrack: (kind) => {
        commit((project) => {
          const sameKind = project.tracks.filter((t) => t.type === kind).length;
          // Insert: video tracks at the BOTTOM (index 0 = bottom z-order per §18),
          // every other kind appended above.
          const track = makeTrack(kind, sameKind + 1);
          if (kind === "video") project.tracks.unshift(track);
          else project.tracks.push(track);
        });
      },

      setTrackMute: (trackId, muted) => {
        commit((project) => {
          const track = project.tracks.find((t) => t.id === trackId);
          if (track) track.muted = muted;
          const ct = project.captionTracks.find((t) => t.id === trackId);
          if (ct) ct.muted = muted;
        });
      },

      setTrackSolo: (trackId, solo) => {
        commit((project) => {
          const track = project.tracks.find((t) => t.id === trackId);
          if (track) track.solo = solo;
          const ct = project.captionTracks.find((t) => t.id === trackId);
          if (ct) ct.solo = solo;
        });
      },

      // DESIGN-PORT-STUB: lock toggle for the timeline TrackHeader (no lock op was
      // in the original public API). Mirrors setTrackMute/Solo; flips `locked`.
      setTrackLocked: (trackId, locked) => {
        commit((project) => {
          const track = project.tracks.find((t) => t.id === trackId);
          if (track) track.locked = locked;
          const ct = project.captionTracks.find((t) => t.id === trackId);
          if (ct) ct.locked = locked;
        });
      },

      // ── Zoom (NOT undoable) ──
      setZoom: (z) =>
        set((s) => {
          const next = clamp(Math.round(z), MIN_PX_PER_SECOND, MAX_PX_PER_SECOND);
          s.zoom = next;
          s.pxPerSecond = next;
        }),

      // ── Undo / redo (patch replay) ──
      undo: () => {
        const state = get();
        if (!historyCanUndo(state._history)) return;
        const { state: project, history } = historyUndo(state.project, state._history);
        set((s) => {
          s.project = project;
          s._history = history;
          s._canUndo = historyCanUndo(history);
          s._canRedo = historyCanRedo(history);
        });
      },
      redo: () => {
        const state = get();
        if (!historyCanRedo(state._history)) return;
        const { state: project, history } = historyRedo(state.project, state._history);
        set((s) => {
          s.project = project;
          s._history = history;
          s._canUndo = historyCanUndo(history);
          s._canRedo = historyCanRedo(history);
        });
      },

      // ── M4: Keyframe animation ─────────────────────────────────────────────
      addKeyframe: (clipId, trackId, msVal, property, value) => {
        commit((project) => {
          const found = findClipInTrack(project, clipId, trackId);
          if (!found) return;
          const { clip } = found;
          if (!clip.keyframes[property]) clip.keyframes[property] = [];
          const kf: Keyframe = {
            id: uuidv4(),
            timeMs: ms(msVal),
            value,
            easing: "linear",
          };
          // Insert in time order.
          const arr = clip.keyframes[property]!;
          const insertAt = arr.findIndex((k) => k.timeMs > msVal);
          if (insertAt === -1) arr.push(kf);
          else arr.splice(insertAt, 0, kf);
        });
      },

      removeKeyframe: (clipId, trackId, keyframeId) => {
        commit((project) => {
          const found = findClipInTrack(project, clipId, trackId);
          if (!found) return;
          const { clip } = found;
          for (const prop of Object.keys(clip.keyframes)) {
            clip.keyframes[prop] = clip.keyframes[prop]!.filter((k) => k.id !== keyframeId);
          }
        });
      },

      updateKeyframe: (clipId, trackId, keyframeId, value) => {
        commit((project) => {
          const found = findClipInTrack(project, clipId, trackId);
          if (!found) return;
          const { clip } = found;
          for (const prop of Object.keys(clip.keyframes)) {
            const kf = clip.keyframes[prop]!.find((k) => k.id === keyframeId);
            if (kf) { kf.value = value; return; }
          }
        });
      },

      setClipOpacity: (clipId, trackId, opacity) => {
        commit((project) => {
          const found = findClipInTrack(project, clipId, trackId);
          if (!found) return;
          const v = clamp(Math.round(opacity), 0, 100);
          const arr = found.clip.keyframes["opacity"] ?? [];
          const atZero = arr.find((k) => k.timeMs === 0);
          if (atZero) atZero.value = v;
          else arr.unshift({ id: uuidv4(), timeMs: 0, value: v, easing: "linear" });
          found.clip.keyframes["opacity"] = arr;
        });
      },

      setClipSpeed: (clipId, trackId, speed) => {
        commit((project) => {
          const found = findClipInTrack(project, clipId, trackId);
          if (!found) return;
          // Clamp to the MVP range; guard against NaN/≤0 (schema requires speed > 0).
          const v = Number.isFinite(speed) ? speed : 1;
          found.clip.speed = clamp(v, MIN_CLIP_SPEED, MAX_CLIP_SPEED);
        });
      },

      // ── M4: Per-clip color grade ──────────────────────────────────────────
      setClipColorGrade: (clipId, trackId, grade) => {
        commit((project) => {
          const found = findClipInTrack(project, clipId, trackId);
          if (!found) return;
          found.clip.colorGrade = grade;
        });
      },

      // ── M4: Ken Burns ─────────────────────────────────────────────────────
      setClipKenBurns: (clipId, trackId, kb) => {
        commit((project) => {
          const found = findClipInTrack(project, clipId, trackId);
          if (!found) return;
          found.clip.kenBurns = kb;
        });
      },

      // ── Templates: fill a media slot (swap the clip's source asset) ─────────
      replaceClipAsset: (clipId, trackId, newAssetId, newSourceDurationMs) => {
        commit((project) => {
          const found = findClipInTrack(project, clipId, trackId);
          if (!found) return;
          found.clip.sourceAssetId = newAssetId;
          // Re-base trims onto the new source so a shorter asset can't over-trim.
          if (newSourceDurationMs && newSourceDurationMs > 0) {
            found.clip.trimIn = 0;
            found.clip.trimOut = Math.min(found.clip.trimOut, ms(newSourceDurationMs));
          }
        });
      },

      setClipTransform: (clipId, trackId, transform) => {
        commit((project) => {
          const found = findClipInTrack(project, clipId, trackId);
          if (!found) return;
          if (transform) found.clip.transform = transform;
          else delete found.clip.transform;
        });
      },

      setClipFlip: (clipId, trackId, axis, value) => {
        commit((project) => {
          const found = findClipInTrack(project, clipId, trackId);
          if (!found) return;
          if (axis === "h") found.clip.flipH = value;
          else found.clip.flipV = value;
        });
      },

      moveClipLayer: (clipId, dir) => {
        commit((project) => {
          const found = findClip(project, clipId);
          if (!found || found.track.type !== "video") return;
          // Array indices of the video tracks (z-order: later index = on top).
          const videoIdx = project.tracks
            .map((t, i) => ({ t, i }))
            .filter((e) => e.t.type === "video")
            .map((e) => e.i);
          const pos = videoIdx.findIndex((i) => project.tracks[i]!.id === found.track.id);
          const targetPos = dir === "forward" ? pos + 1 : pos - 1;
          if (pos < 0 || targetPos < 0 || targetPos >= videoIdx.length) return;
          const a = videoIdx[pos]!;
          const b = videoIdx[targetPos]!;
          const tmp = project.tracks[a]!;
          project.tracks[a] = project.tracks[b]!;
          project.tracks[b] = tmp;
        });
      },

      detachAudio: (clipId) => {
        commit((project) => {
          const found = findClip(project, clipId);
          if (!found) return;
          const partnerId = found.clip.linkedClipId ?? null;
          found.clip.linkedClipId = null;
          if (partnerId) {
            const partner = findClip(project, partnerId);
            if (partner) partner.clip.linkedClipId = null;
          }
        });
      },

      // ── M4: Per-clip gain + fades ────────────────────────────────────────
      setClipGain: (clipId, trackId, gain) => {
        commit((project) => {
          const found = findClipInTrack(project, clipId, trackId);
          if (!found) return;
          found.clip.gain = clamp(Math.round(gain), 0, 200);
        });
      },

      setClipFade: (clipId, trackId, edge, msVal) => {
        commit((project) => {
          const found = findClipInTrack(project, clipId, trackId);
          if (!found) return;
          const span = found.clip.endOnTimeline - found.clip.startOnTimeline;
          const v = clamp(ms(msVal), 0, span);
          if (edge === "in") found.clip.fadeInMs = v;
          else found.clip.fadeOutMs = v;
        });
      },

      // ── M4: Per-track audio mix ──────────────────────────────────────────
      setTrackVolume: (trackId, volume) => {
        commit((project) => {
          const track = project.tracks.find((t) => t.id === trackId);
          if (track && (track.type === "audio" || track.type === "voiceover")) {
            track.volume = clamp(Math.round(volume), 0, 200);
          }
        });
      },

      setTrackPan: (trackId, pan) => {
        commit((project) => {
          const track = project.tracks.find((t) => t.id === trackId);
          if (track && (track.type === "audio" || track.type === "voiceover")) {
            track.pan = clamp(Math.round(pan), -100, 100);
          }
        });
      },

      // ── M4: Text overlay ──────────────────────────────────────────────────
      addTextOverlay: (text, trackId, startOnTimeline) => {
        const overlayId = uuidv4();
        commit((project) => {
          const track = project.tracks.find((t) => t.id === trackId && t.type === "overlay");
          if (!track || track.type !== "overlay") return;
          const start = ms(startOnTimeline);
          const overlay: TextOverlay = {
            id: overlayId,
            trackId,
            kind: "text",
            startOnTimeline: start,
            endOnTimeline: start + 3000,
            canvasX: 5,
            canvasY: 80,
            width: 90,
            height: 15,
            rotation: 0,
            opacity: 100,
            animation: {},
            keyframes: {},
            text,
            style: {
              fontFamily: "sans-serif",
              fontSize: 48,
              fontWeight: 600,
              color: "#FFFFFF",
              align: "center",
              outline: { color: "#000000", width: 2, position: "outside" },
            },
          };
          track.clips.push(overlay);
        });
        set((s) => {
          s.selection = { kind: "overlay", id: overlayId };
        });
      },

      updateOverlay: (overlayId, patch) => {
        commit((project) => {
          const found = findOverlay(project, overlayId);
          if (!found) return;
          // Object.assign keeps the discriminated-union `kind` intact (callers never patch it).
          Object.assign(found.clip, patch);
        });
      },

      // ── M4: Crossfade transitions ──────────────────────────────────────────
      addCrossfade: (clipId, durationMs = 500) => {
        const transitionId = uuidv4();
        commit((project) => {
          const found = findClip(project, clipId);
          if (!found || found.track.type !== "video") return;
          // Find the next clip on the same track by timeline order.
          const ordered = [...found.track.clips].sort(
            (a, b) => a.startOnTimeline - b.startOnTimeline,
          );
          const idx = ordered.findIndex((c) => c.id === clipId);
          const next = idx >= 0 ? ordered[idx + 1] : undefined;
          if (!next) return;
          // Don't duplicate an existing transition for this pair.
          if (
            project.transitions.some(
              (t) => t.fromClipId === clipId && t.toClipId === next.id,
            )
          )
            return;
          // Clamp duration to the shorter of the two clips' lengths.
          const fromLen = found.clip.endOnTimeline - found.clip.startOnTimeline;
          const toLen = next.endOnTimeline - next.startOnTimeline;
          const dur = clamp(ms(durationMs), 100, Math.max(100, Math.min(fromLen, toLen)));
          project.transitions.push({
            id: transitionId,
            trackId: found.track.id,
            fromClipId: clipId,
            toClipId: next.id,
            type: "crossfade",
            durationMs: dur,
            params: {},
          });
        });
      },

      removeTransition: (transitionId) => {
        commit((project) => {
          project.transitions = project.transitions.filter((t) => t.id !== transitionId);
        });
      },

      // ── M4: Caption import + edit ──────────────────────────────────────────
      importCaptions: (blocks) => {
        commit((project) => {
          const ct = project.captionTracks[0];
          if (!ct) return;
          ct.blocks = blocks as CaptionBlock[];
        });
      },

      updateCaption: (blockId, patch) => {
        commit((project) => {
          for (const ct of project.captionTracks) {
            const block = ct.blocks.find((b) => b.id === blockId);
            if (block) {
              if (patch.text !== undefined) block.text = patch.text;
              if (patch.startMs !== undefined) block.startMs = ms(patch.startMs);
              if (patch.endMs !== undefined) block.endMs = ms(patch.endMs);
              return;
            }
          }
        });
      },
    };
  }),
);

// ── Selectors (plain functions over state) ──────────────────────────────────────

/** All media + caption tracks in z-order (array index = z-order, §18). */
export function selectAllTracks(s: EditorState): Track[] {
  return s.project.tracks;
}

/** A media clip by id, or null. */
export function selectClip(s: EditorState, id: string): Clip | null {
  return findClip(s.project, id)?.clip ?? null;
}

/** Total project duration in ms = the latest timeline end across all timed items. */
export function selectProjectDurationMs(s: EditorState): number {
  let end = 0;
  for (const track of s.project.tracks) {
    if (track.type === "caption") continue;
    for (const clip of track.clips) {
      if (clip.endOnTimeline > end) end = clip.endOnTimeline;
    }
  }
  for (const ct of s.project.captionTracks) {
    for (const block of ct.blocks) {
      if (block.endMs > end) end = block.endMs;
    }
  }
  return end;
}

// ── Imperative flag accessors (the contract's canUndo()/canRedo()) ───────────────

/** True when there is at least one undoable step on the stack. */
export function canUndo(): boolean {
  return useEditorStore.getState()._canUndo;
}

/** True when there is at least one redoable step on the stack. */
export function canRedo(): boolean {
  return useEditorStore.getState()._canRedo;
}
