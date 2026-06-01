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

// ── M4 creative-layer extension types (not yet in §18 schema) ─────────────────

export interface ColorGrade {
  brightness: number; // UI centred: -100..100
  contrast: number;   // UI centred: -100..100
  saturation: number; // UI centred: -100..100
}

export interface KenBurns {
  startScale: number; // e.g. 1.0
  endScale: number;   // e.g. 1.5
}

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
  addClipFromAsset: (assetId: string, trackId: string, atMs: number) => void;
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

  // ── M4: Per-clip color grade ────────────────────────────────────────────────
  setClipColorGrade: (clipId: string, trackId: string, grade: ColorGrade) => void;

  // ── M4: Ken Burns effect ────────────────────────────────────────────────────
  setClipKenBurns: (clipId: string, trackId: string, kb: KenBurns | null) => void;

  // ── M4: Text overlay ────────────────────────────────────────────────────────
  /** Add a text overlay clip to the overlay track `trackId` at `startOnTimeline` ms. */
  addTextOverlay: (text: string, trackId: string, startOnTimeline: number) => void;

  // ── M4: Caption import ──────────────────────────────────────────────────────
  /** Replace the first captionTrack's blocks with the given parsed caption blocks. */
  importCaptions: (blocks: CaptionBlock[]) => void;
}

export type EditorStore = EditorState & EditorActions;

// ── Constants ─────────────────────────────────────────────────────────────────

/** Default timeline scale: 100 px per second of project time. */
export const DEFAULT_PX_PER_SECOND = 100;
const MIN_PX_PER_SECOND = 10;
const MAX_PX_PER_SECOND = 800;
/** Minimum clip duration so trims/splits can never collapse a clip to zero (ms). */
const MIN_CLIP_MS = 50;
const HISTORY_LIMIT = 200;

// ── Internal helpers (pure, operate on a Project) ──────────────────────────────

const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));
const ms = (n: number): number => Math.max(0, Math.round(n));

/** Track kinds that carry media `Clip[]` (not overlay/caption). */
function isMediaTrack(
  t: Track,
): t is Extract<Track, { clips: Clip[] }> {
  return t.type === "video" || t.type === "audio" || t.type === "voiceover";
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
 * MVP-STUB: asset durations are not yet resolved from a decoded media probe
 * (real WebCodecs/ffprobe is built later — Spec §10/§15). New clips dropped from
 * the media panel get a default 4s source span. The clip op itself is correct;
 * only the duration source is stubbed.
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
      addClipFromAsset: (assetId, trackId, atMs) => {
        const clipId = uuidv4();
        commit((project) => {
          const track = project.tracks.find((t) => t.id === trackId);
          if (!track || !isMediaTrack(track)) return;
          const start = ms(atMs);
          const clip: Clip = {
            id: clipId,
            sourceAssetId: assetId,
            trackId,
            startOnTimeline: start,
            endOnTimeline: start + DEFAULT_NEW_CLIP_MS,
            trimIn: 0,
            trimOut: DEFAULT_NEW_CLIP_MS,
            speed: 1,
            effects: [],
            keyframes: {},
            linkedClipId: null,
          };
          track.clips.push(clip);
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

          // Detach from the source track if it's actually moving tracks.
          if (from.id !== dest.id) {
            from.clips = from.clips.filter((c) => c.id !== clipId);
            // Reuse the same draft object reference where possible.
            const moved: Clip = { ...clip, trackId: dest.id };
            moved.startOnTimeline = newStart;
            moved.endOnTimeline = newStart + span;
            dest.clips.push(moved);
          } else {
            clip.startOnTimeline = newStart;
            clip.endOnTimeline = newStart + span;
          }
        });
      },

      trimClip: (clipId, edge, newMs) => {
        commit((project) => {
          const found = findClip(project, clipId);
          if (!found) return;
          const { clip } = found;
          const target = ms(newMs);

          if (edge === "start") {
            // Moving the start edge later trims into the source from its origin:
            // the head shift adds to trimIn (asset-relative). Cannot pass the end.
            const maxStart = clip.endOnTimeline - MIN_CLIP_MS;
            const newStart = clamp(target, 0, Math.max(0, maxStart));
            const delta = newStart - clip.startOnTimeline; // +later / -earlier
            clip.startOnTimeline = newStart;
            // trimIn shifts by the same source amount (scaled by speed), floored ≥ 0.
            clip.trimIn = Math.max(0, ms(clip.trimIn + delta * clip.speed));
          } else {
            // Moving the end edge: clamp to be after the start by MIN_CLIP_MS.
            const minEnd = clip.startOnTimeline + MIN_CLIP_MS;
            const newEnd = Math.max(minEnd, target);
            const delta = newEnd - clip.endOnTimeline;
            clip.endOnTimeline = newEnd;
            clip.trimOut = Math.max(clip.trimIn + MIN_CLIP_MS, ms(clip.trimOut + delta * clip.speed));
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
            const copy: Clip = {
              ...clip,
              id: newId,
              startOnTimeline: clip.endOnTimeline,
              endOnTimeline: clip.endOnTimeline + span,
              linkedClipId: null, // a duplicate is not part of the original link group
            };
            const idx = track.clips.findIndex((c) => c.id === clip.id);
            track.clips.splice(idx + 1, 0, copy);
          } else if (kind === "overlay") {
            const found = findOverlay(project, id);
            if (!found) return;
            const { clip, track } = found;
            const span = clip.endOnTimeline - clip.startOnTimeline;
            const copy = {
              ...clip,
              id: newId,
              startOnTimeline: clip.endOnTimeline,
              endOnTimeline: clip.endOnTimeline + span,
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
          // Keyframes are stored with a generated id embedded in a `id` field
          // (not in the §18 Keyframe type, so we attach it as an extension).
          const kf = {
            id: uuidv4(),
            timeMs: ms(msVal),
            value,
            easing: "linear" as const,
          } as unknown as import("@videoforge/project-schema").Keyframe & { id: string };
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
            clip.keyframes[prop] = clip.keyframes[prop]!.filter(
              (k) => (k as unknown as { id?: string }).id !== keyframeId,
            );
          }
        });
      },

      updateKeyframe: (clipId, trackId, keyframeId, value) => {
        commit((project) => {
          const found = findClipInTrack(project, clipId, trackId);
          if (!found) return;
          const { clip } = found;
          for (const prop of Object.keys(clip.keyframes)) {
            const kf = clip.keyframes[prop]!.find(
              (k) => (k as unknown as { id?: string }).id === keyframeId,
            );
            if (kf) { kf.value = value; return; }
          }
        });
      },

      // ── M4: Per-clip color grade ──────────────────────────────────────────
      setClipColorGrade: (clipId, trackId, grade) => {
        commit((project) => {
          const found = findClipInTrack(project, clipId, trackId);
          if (!found) return;
          // Store as a direct extension field using a type cast (MVP).
          (found.clip as unknown as Record<string, unknown>)["colorGrade"] = grade;
        });
      },

      // ── M4: Ken Burns ─────────────────────────────────────────────────────
      setClipKenBurns: (clipId, trackId, kb) => {
        commit((project) => {
          const found = findClipInTrack(project, clipId, trackId);
          if (!found) return;
          (found.clip as unknown as Record<string, unknown>)["kenBurns"] = kb ?? undefined;
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

      // ── M4: Caption import ─────────────────────────────────────────────────
      importCaptions: (blocks) => {
        commit((project) => {
          const ct = project.captionTracks[0];
          if (!ct) return;
          ct.blocks = blocks as CaptionBlock[];
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
