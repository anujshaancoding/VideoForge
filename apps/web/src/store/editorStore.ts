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

/** After undo/redo or structural delete, ensure the current selection still exists in the project.
 * If the element was removed, clear the selection so the inspector doesn't show stale "Selected a overlay". */
function validateSelection(project: Project, sel: Selection): Selection {
  if (!sel.id || !sel.kind) return { kind: null, id: null };
  for (const track of project.tracks) {
    const clips = (track as any).clips as Array<{ id: string }> | undefined;
    if ((sel.kind === "clip" || sel.kind === "overlay") && clips?.some((c) => c.id === sel.id)) {
      return sel;
    }
    if (sel.kind === "track" && track.id === sel.id) return sel;
  }
  for (const ct of project.captionTracks || []) {
    if (sel.kind === "caption") {
      if (ct.id === sel.id) return sel;
      if ((ct as any).blocks?.some((b: any) => b.id === sel.id)) return sel;
    }
  }
  return { kind: null, id: null };
}

/** Drop any multi-selected clip ids that no longer exist (after undo/redo/delete). */
function pruneSelectedClipIds(project: Project, ids: string[]): string[] {
  if (ids.length === 0) return ids;
  const live = new Set<string>();
  for (const track of project.tracks) {
    const clips = (track as any).clips as Array<{ id: string }> | undefined;
    if (clips && (track.type === "video" || track.type === "audio" || track.type === "voiceover")) {
      for (const c of clips) live.add(c.id);
    }
  }
  const kept = ids.filter((id) => live.has(id));
  return kept.length === ids.length ? ids : kept;
}

export type AddTrackKind = "video" | "audio" | "voiceover" | "overlay";

export interface EditorState {
  project: Project;
  selection: Selection;
  /**
   * Multi-selection of MEDIA clip ids (timeline marquee / Shift/Ctrl-click / group
   * move + delete). The single-clip `selection` above remains the "primary" (the
   * last clip touched) so existing single-selection consumers (Inspector, Canvas,
   * TemplateSlotPanel) keep working unchanged. Invariants kept in sync by the
   * selection actions below:
   *   • when a single clip is selected, selectedClipIds === { that id }
   *   • when selecting a non-clip (overlay/caption/track) or clearing, this is empty
   *   • `selection.id` is always the most recently added member (or null when empty)
   * Stored as a string[] (not a Set) so it stays Immer/structural-clone friendly.
   */
  selectedClipIds: string[];
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
  /** Simple local clipboard for copy/paste of selected clip/overlay (in-memory, not persisted). */
  clipboard: any | null;

  /** Client-side placeholder labels for template apply (synthetic or manifest-driven hints).
      Keyed by clipId → label shown in timeline dashed blocks and canvas grey rects. */
  placeholderLabels: Record<string, string>;
  /** When set, Editor should auto-switch the left rail to 'media' (used by placeholder clicks). */
  pendingMediaOpenFor: string | null;
  /** Timestamp (ms) until which we should suppress scary "Save failed" UI in StatusBar.
      Set after applying a template (the project is "new" from template and may not be
      persisted to the user's account yet). */
  suppressSaveErrorUntil: number | null;
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
   * Add/toggle a single media clip in the multi-selection (Shift/Ctrl-click). The
   * toggled clip becomes the primary `selection` (or, when toggled off, the primary
   * falls back to the last remaining member). Non-clip selections are replaced.
   */
  toggleClipSelection: (clipId: string) => void;
  /** Replace the multi-selection with exactly these media clip ids (marquee result). */
  selectClips: (clipIds: string[]) => void;
  /** True when a media clip id is part of the current multi-selection. */
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
  /**
   * Move every clip in `clipIds` by the same timeline delta as ONE undo step (group
   * drag). `anchorClipId`/`anchorToStartMs` describe where the dragged (anchor) clip
   * should land; the delta is applied to all selected clips (and their linked-audio
   * partners). Clips on locked tracks are skipped. No cross-track move for the group
   * (the anchor may change lane via the single-clip path; the group preserves lanes).
   */
  groupMoveClips: (clipIds: string[], anchorClipId: string, anchorToStartMs: number) => void;
  trimClip: (clipId: string, edge: "start" | "end", newMs: number) => void;
  splitAtPlayhead: () => void;
  deleteSelected: () => void;
  /**
   * Ripple delete (§3.3): remove the selected (or given) media clip — and its
   * linked-audio partner if any — then close the gap by shifting every later clip
   * on the affected track(s) left by the removed clip's span. Undoable like every
   * structural edit (funnels through commit()).
   */
  rippleDelete: (clipId?: string) => void;
  duplicateSelected: () => void;
  copySelected: () => void;
  paste: () => void;
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

  // ── Templates panel (in-editor apply) client placeholder support ─────────────
  /** Set a label for a placeholder clip (used by TemplatesPanel synthetic + real applies). */
  setPlaceholderLabel: (clipId: string, label: string) => void;
  /** Clear all placeholder labels (on new load / blank). */
  clearPlaceholders: () => void;
  /** Select a placeholder clip and signal the left rail to switch to Media for filling it. */
  requestOpenMediaForPlaceholder: (clipId: string) => void;

  // ── M4: Per-clip gain + fades ─────────────────────────────────────────────────
  setClipGain: (clipId: string, trackId: string, gain: number) => void;
  setClipFade: (clipId: string, trackId: string, edge: "in" | "out", ms: number) => void;

  // ── M4: Per-track audio mix ───────────────────────────────────────────────────
  setTrackVolume: (trackId: string, volume: number) => void;
  setTrackPan: (trackId: string, pan: number) => void;

  // ── §3.4: Per-track volume-envelope automation (piecewise-linear gain over time) ─
  /** Replace the whole envelope (points are kept time-sorted; values clamped 0–200). */
  setVolumeEnvelope: (trackId: string, points: Array<{ timeMs: number; value: number }>) => void;
  /** Add one point (time-sorted insert). Returns silently if the track is not audio. */
  addVolumeEnvelopePoint: (trackId: string, timeMs: number, value: number) => void;
  /** Patch the point at index `index` (time and/or value); re-sorts by time. */
  updateVolumeEnvelopePoint: (trackId: string, index: number, patch: { timeMs?: number; value?: number }) => void;
  /** Remove the point at index `index`. */
  removeVolumeEnvelopePoint: (trackId: string, index: number) => void;

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
      return { name: "Video", colour: "#2BC4B0", height: 80 }; // taller for easier trim handles
    case "audio":
      return { name: "Audio", colour: "#7C9CFF", height: 64 };
    case "voiceover":
      return { name: "Voice Over", colour: "#FF6B6B", height: 64 };
    case "overlay":
      return { name: "Overlays", colour: "#FF9EC4", height: 64 };
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
    hidden: false,
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
      selectedClipIds: [],
      playheadMs: 0,
      isPlaying: false,
      zoom: DEFAULT_PX_PER_SECOND,
      pxPerSecond: DEFAULT_PX_PER_SECOND,
      _history: createHistory(HISTORY_LIMIT),
      _canUndo: false,
      _canRedo: false,
      clipboard: null,
      placeholderLabels: {},
      pendingMediaOpenFor: null,  // one-shot: Editor sub consumes it to switch left rail to Media for placeholders
      suppressSaveErrorUntil: null,

      // ── Project lifecycle ──
      loadProject: (p) =>
        set((s) => {
          // Normalize hidden on tracks so any legacy doc (saved before the field
          // was required) becomes valid for prune/export and internal checks.
          const normalized = {
            ...p,
            tracks: p.tracks.map((t) => ({
              ...t,
              hidden: typeof (t as any).hidden === "boolean" ? (t as any).hidden : false,
            })),
            captionTracks: p.captionTracks.map((ct) => ({
              ...ct,
              hidden: typeof (ct as any).hidden === "boolean" ? (ct as any).hidden : false,
            })),
          } as typeof p;
          s.project = normalized;
          s.selection = { kind: null, id: null };
          s.selectedClipIds = [];
          s.playheadMs = 0;
          s.isPlaying = false;
          // A freshly loaded project starts a new history timeline.
          s._history = createHistory(HISTORY_LIMIT);
          s._canUndo = false;
          s._canRedo = false;
          s.placeholderLabels = {};
          s.suppressSaveErrorUntil = null;
          // Intentionally do NOT clear pendingMediaOpenFor here.
          // Template apply does loadProject(...) then shortly after calls
          // requestOpenMediaForPlaceholder for the first placeholder slot.
          // The Editor subscription will consume + clear the flag.
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
          // Keep the multi-selection in lockstep with the primary: a plain clip
          // select collapses the group to that one clip; selecting anything else
          // (overlay/caption/track) or nothing clears the group.
          s.selectedClipIds = kind === "clip" && id ? [id] : [];
        }),
      clearSelection: () =>
        set((s) => {
          s.selection = { kind: null, id: null };
          s.selectedClipIds = [];
        }),

      /** Shift/Ctrl-click: add `clipId` if absent, else remove it. */
      toggleClipSelection: (clipId) =>
        set((s) => {
          const has = s.selectedClipIds.includes(clipId);
          if (has) {
            s.selectedClipIds = s.selectedClipIds.filter((id) => id !== clipId);
            // Primary falls back to the last remaining member (or nothing).
            const last = s.selectedClipIds[s.selectedClipIds.length - 1] ?? null;
            s.selection = last ? { kind: "clip", id: last } : { kind: null, id: null };
          } else {
            s.selectedClipIds = [...s.selectedClipIds, clipId];
            s.selection = { kind: "clip", id: clipId };
          }
        }),

      /** Marquee result: replace the multi-selection with exactly `clipIds`. */
      selectClips: (clipIds) =>
        set((s) => {
          const ids = [...new Set(clipIds)];
          s.selectedClipIds = ids;
          const last = ids[ids.length - 1] ?? null;
          s.selection = last ? { kind: "clip", id: last } : { kind: null, id: null };
        }),

      // Client placeholder labels (for TemplatesPanel apply flow + canvas/timeline rendering)
      setPlaceholderLabel: (clipId, label) =>
        set((s) => {
          s.placeholderLabels = { ...s.placeholderLabels, [clipId]: label };
        }),
      clearPlaceholders: () =>
        set((s) => {
          s.placeholderLabels = {};
          // pendingMediaOpenFor is a separate one-shot UI signal; leave it alone here.
        }),

      /** Called when a placeholder clip is clicked in timeline/canvas to request the media rail opens. */
      requestOpenMediaForPlaceholder: (clipId: string) =>
        set((s) => {
          s.pendingMediaOpenFor = clipId;
          s.selection = { kind: "clip", id: clipId };
          s.selectedClipIds = [clipId];
        }),

      /** Suppress "Save failed — retrying" UI in StatusBar for N ms (used after fresh template apply). */
      suppressSaveErrorsFor: (ms: number) =>
        set((s) => {
          s.suppressSaveErrorUntil = Date.now() + Math.max(1000, ms);
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
          s.selectedClipIds = [clipId];
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
          s.selectedClipIds = [clipId];
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

      groupMoveClips: (clipIds, anchorClipId, anchorToStartMs) => {
        commit((project) => {
          const anchor = findClip(project, anchorClipId);
          if (!anchor) return;
          // Delta is computed from the anchor's requested landing spot, then clamped
          // so NO selected clip is pushed before 0 (keeps the whole group in bounds).
          let delta = ms(anchorToStartMs) - anchor.clip.startOnTimeline;

          // Build the full set of clips to move: the selection + each one's linked
          // partner (so linked audio rides along even if it wasn't explicitly selected).
          const moveIds = new Set<string>();
          for (const id of clipIds) {
            const f = findClip(project, id);
            if (!f) continue;
            // Skip clips whose track is locked (respect locked-track constraint).
            if (f.track.locked) continue;
            moveIds.add(id);
            const linkedId = f.clip.linkedClipId ?? null;
            if (linkedId && findClip(project, linkedId)) moveIds.add(linkedId);
          }
          if (moveIds.size === 0) return;

          // Clamp the delta to the group's left edge so nothing crosses 0.
          let minStart = Infinity;
          for (const id of moveIds) {
            const f = findClip(project, id);
            if (f) minStart = Math.min(minStart, f.clip.startOnTimeline);
          }
          if (minStart + delta < 0) delta = -minStart;
          if (delta === 0) return;

          for (const id of moveIds) {
            const f = findClip(project, id);
            if (!f) continue;
            const span = f.clip.endOnTimeline - f.clip.startOnTimeline;
            const ns = Math.max(0, f.clip.startOnTimeline + delta);
            f.clip.startOnTimeline = ns;
            f.clip.endOnTimeline = ns + span;
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
        const { selection, selectedClipIds } = get();
        if (!selection.id || selection.kind === null) return;
        const { kind, id } = selection;
        commit((project) => {
          switch (kind) {
            case "clip": {
              // Group delete (§3 multi-select): remove EVERY selected media clip plus
              // each one's linked-audio partner, as a single undo step. Falls back to
              // the primary id when the multi-selection is empty/out of sync.
              const seeds = selectedClipIds.length > 0 ? selectedClipIds : [id];
              const removeIds = new Set<string>();
              for (const seed of seeds) {
                removeIds.add(seed);
                // The seed's own linked partner.
                const f = findClip(project, seed);
                const linked = (f?.clip.linkedClipId as string | null | undefined) ?? null;
                if (linked) removeIds.add(linked);
                // Any clip that links TO the seed (the reverse direction).
                for (const track of project.tracks) {
                  if (!isMediaTrack(track)) continue;
                  for (const c of track.clips) {
                    if ((c as any).linkedClipId === seed) removeIds.add(c.id);
                  }
                }
              }
              for (const track of project.tracks) {
                if (!isMediaTrack(track)) continue;
                track.clips = track.clips.filter((c) => !removeIds.has(c.id));
              }
              // Drop any transition that referenced a removed clip.
              project.transitions = project.transitions.filter(
                (t) => !removeIds.has(t.fromClipId) && !removeIds.has(t.toClipId),
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
          s.selectedClipIds = [];
        });
      },

      rippleDelete: (clipId) => {
        const { selection } = get();
        // Target the explicit clipId (context menu) else the selected media clip.
        const targetId = clipId ?? (selection.kind === "clip" ? selection.id : null);
        if (!targetId) return;
        commit((project) => {
          const found = findClip(project, targetId);
          if (!found) return;
          // The set of clips removed together (the clip + its linked-audio partner).
          const removedIds = new Set<string>([targetId]);
          const linkedId = found.clip.linkedClipId ?? null;
          if (linkedId && findClip(project, linkedId)) removedIds.add(linkedId);

          // Capture each removed clip's track + span BEFORE deletion so we can close
          // the gap on the correct lane by exactly the removed clip's length.
          const removals: Array<{ trackId: string; start: number; span: number }> = [];
          for (const id of removedIds) {
            const r = findClip(project, id);
            if (r) {
              removals.push({
                trackId: r.track.id,
                start: r.clip.startOnTimeline,
                span: r.clip.endOnTimeline - r.clip.startOnTimeline,
              });
            }
          }

          // Remove the clip(s).
          for (const track of project.tracks) {
            if (!isMediaTrack(track)) continue;
            track.clips = track.clips.filter((c) => !removedIds.has(c.id));
          }

          // Close the gap: on each affected track, shift every clip that started at or
          // after the removed clip's start left by that removal's span. Shift its linked
          // partner too is handled implicitly because the partner lives on its own track
          // and is shifted by that track's own removal record.
          for (const removal of removals) {
            const track = project.tracks.find((t) => t.id === removal.trackId);
            if (!track || !isMediaTrack(track)) continue;
            for (const c of track.clips) {
              if (c.startOnTimeline >= removal.start) {
                const span = c.endOnTimeline - c.startOnTimeline;
                const ns = Math.max(0, c.startOnTimeline - removal.span);
                c.startOnTimeline = ns;
                c.endOnTimeline = ns + span;
              }
            }
          }

          // Drop any transition that referenced a removed clip.
          project.transitions = project.transitions.filter(
            (t) => !removedIds.has(t.fromClipId) && !removedIds.has(t.toClipId),
          );
        });
        set((s) => {
          s.selection = { kind: null, id: null };
          s.selectedClipIds = [];
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
            s.selectedClipIds = kind === "clip" ? [newId] : [];
          });
        }
      },

      copySelected: () => {
        const { selection, project } = get();
        if (!selection.id || !selection.kind) return;
        let data: any = null;
        if (selection.kind === "clip") {
          const found = findClip(project, selection.id);
          if (found) data = { kind: "clip", clip: { ...found.clip }, trackType: found.track.type };
        } else if (selection.kind === "overlay") {
          const found = findOverlay(project, selection.id);
          if (found) data = { kind: "overlay", overlay: { ...found.clip } };
        }
        if (data) {
          set((s) => { (s as any).clipboard = data; });
        }
      },

      paste: () => {
        const { clipboard, playheadMs } = get();
        if (!clipboard) return;
        const newId = uuidv4();
        commit((p) => {
          if (clipboard.kind === "clip" && clipboard.clip) {
            const src = clipboard.clip as Clip;
            // Find a suitable target track (prefer same type or first video)
            let targetTrack = p.tracks.find((t: any) => t.type === clipboard.trackType) as any;
            if (!targetTrack) targetTrack = p.tracks.find((t: any) => t.type === "video") as any;
            if (!targetTrack) return;
            const span = src.endOnTimeline - src.startOnTimeline;
            const others = targetTrack.clips || [];
            const start = firstFreeSlotStart(others, span, Math.max(0, playheadMs));
            const copy: Clip = {
              ...src,
              id: newId,
              startOnTimeline: start,
              endOnTimeline: start + span,
              linkedClipId: null,
            };
            if (!targetTrack.clips) targetTrack.clips = [];
            targetTrack.clips.push(copy);
            // sort by time? existing code doesn't always, but ok
            targetTrack.clips.sort((a: any, b: any) => a.startOnTimeline - b.startOnTimeline);
          } else if (clipboard.kind === "overlay" && clipboard.overlay) {
            let ovTrack = p.tracks.find((t: any) => t.type === "overlay") as any;
            if (!ovTrack) {
              // create one on demand
              ovTrack = makeTrack("overlay", 1);
              p.tracks.push(ovTrack);
            }
            const src = clipboard.overlay as OverlayClip;
            const span = src.endOnTimeline - src.startOnTimeline;
            const others = ovTrack.clips || [];
            const start = firstFreeSlotStart(others, span, Math.max(0, playheadMs));
            const copy: OverlayClip = {
              ...src,
              id: newId,
              startOnTimeline: start,
              endOnTimeline: start + span,
            } as any;
            if (!ovTrack.clips) ovTrack.clips = [];
            ovTrack.clips.push(copy);
            ovTrack.clips.sort((a: any, b: any) => a.startOnTimeline - b.startOnTimeline);
          }
        });
        // select the pasted item
        set((s) => {
          const k = clipboard.kind === "clip" ? "clip" : "overlay";
          s.selection = { kind: k, id: newId };
          s.selectedClipIds = k === "clip" ? [newId] : [];
        });
      },

      // ── Track operations (undoable) ──
      addTrack: (kind) => {
        let newTrackId: string | null = null;
        commit((project) => {
          const sameKind = project.tracks.filter((t) => t.type === kind).length;
          // Insert: video tracks at the BOTTOM (index 0 = bottom z-order per §18),
          // every other kind appended above.
          const track = makeTrack(kind, sameKind + 1);
          newTrackId = track.id;
          if (kind === "video") project.tracks.unshift(track);
          else project.tracks.push(track);
        });
        // Select the new track so the Inspector immediately gives guidance
        // ("New Video track — drag clips from the media panel onto the timeline").
        if (newTrackId) {
          // Use the action so any listeners / inspector update.
          // We call the internal setter to avoid re-entrancy with commit.
          set((s) => {
            s.selection = { kind: "track", id: newTrackId };
            s.selectedClipIds = [];
          });
        }
      },
      moveTrack: (trackId: string, direction: "up" | "down") => {
        commit((project) => {
          const idx = project.tracks.findIndex((t) => t.id === trackId);
          if (idx < 0) return;
          const newIdx = direction === "up" ? idx - 1 : idx + 1;
          if (newIdx < 0 || newIdx >= project.tracks.length) return;
          const moved = project.tracks.splice(idx, 1)[0];
          if (!moved) return;
          project.tracks.splice(newIdx, 0, moved);
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

      setTrackSolo: (trackId: string, solo: boolean) => {
        commit((project) => {
          const track = project.tracks.find((t) => t.id === trackId);
          if (track) track.solo = solo;
          const ct = project.captionTracks.find((t) => t.id === trackId);
          if (ct) ct.solo = solo;
        });
      },
      setTrackHidden: (trackId: string, hidden: boolean) => {
        commit((project) => {
          const track = project.tracks.find((t) => t.id === trackId);
          if (track) (track as any).hidden = hidden;
          const ct = project.captionTracks.find((t) => t.id === trackId);
          if (ct) (ct as any).hidden = hidden;
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
        const nextSel = validateSelection(project, state.selection);
        const nextClipIds = pruneSelectedClipIds(project, state.selectedClipIds);
        set((s) => {
          s.project = project;
          s.selection = nextSel;
          s.selectedClipIds = nextClipIds;
          s._history = history;
          s._canUndo = historyCanUndo(history);
          s._canRedo = historyCanRedo(history);
        });
      },
      redo: () => {
        const state = get();
        if (!historyCanRedo(state._history)) return;
        const { state: project, history } = historyRedo(state.project, state._history);
        const nextSel = validateSelection(project, state.selection);
        const nextClipIds = pruneSelectedClipIds(project, state.selectedClipIds);
        set((s) => {
          s.project = project;
          s.selection = nextSel;
          s.selectedClipIds = nextClipIds;
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

      // ── §3.4: Per-track volume-envelope automation ───────────────────────
      // Points are {timeMs, value(percent 0–200)} in absolute-timeline ms, kept
      // time-sorted so the shared sampler (sampleVolumeEnvelope) reads them in
      // order on BOTH the preview (AudioEngine) and export (buildFilterComplex)
      // sides. Empty/1-point envelopes fall back to the flat `track.volume`.
      setVolumeEnvelope: (trackId, points) => {
        commit((project) => {
          const track = project.tracks.find((t) => t.id === trackId);
          if (!track || (track.type !== "audio" && track.type !== "voiceover")) return;
          track.volumeEnvelope = points
            .map((p) => ({ timeMs: ms(p.timeMs), value: clamp(Math.round(p.value), 0, 200) }))
            .sort((a, b) => a.timeMs - b.timeMs);
        });
      },

      addVolumeEnvelopePoint: (trackId, timeMs, value) => {
        commit((project) => {
          const track = project.tracks.find((t) => t.id === trackId);
          if (!track || (track.type !== "audio" && track.type !== "voiceover")) return;
          track.volumeEnvelope.push({ timeMs: ms(timeMs), value: clamp(Math.round(value), 0, 200) });
          track.volumeEnvelope.sort((a, b) => a.timeMs - b.timeMs);
        });
      },

      updateVolumeEnvelopePoint: (trackId, index, patch) => {
        commit((project) => {
          const track = project.tracks.find((t) => t.id === trackId);
          if (!track || (track.type !== "audio" && track.type !== "voiceover")) return;
          const point = track.volumeEnvelope[index];
          if (!point) return;
          if (patch.timeMs !== undefined) point.timeMs = ms(patch.timeMs);
          if (patch.value !== undefined) point.value = clamp(Math.round(patch.value), 0, 200);
          track.volumeEnvelope.sort((a, b) => a.timeMs - b.timeMs);
        });
      },

      removeVolumeEnvelopePoint: (trackId, index) => {
        commit((project) => {
          const track = project.tracks.find((t) => t.id === trackId);
          if (!track || (track.type !== "audio" && track.type !== "voiceover")) return;
          if (index < 0 || index >= track.volumeEnvelope.length) return;
          track.volumeEnvelope.splice(index, 1);
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
          s.selectedClipIds = [];
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
