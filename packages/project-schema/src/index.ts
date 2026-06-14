// ─────────────────────────────────────────────────────────────────────────────
// @videoforge/project-schema — public entry point.
//
// Re-exports the §18 TypeScript types, the Zod runtime validator, the sample
// fixture, the current schema version, and a small set of construction/formatting
// helpers consumed by the web store and the render pipeline.
// ─────────────────────────────────────────────────────────────────────────────

import { v4 as uuidv4 } from "uuid";
import type { Project } from "./types.js";

export * from "./types.js";
export * from "./schema.js";
export { sampleProject, default as sampleProjectDefault } from "./fixtures/sampleProject.js";

// Shared text-overlay layout — the ONE percent→pixel/size/floor/stroke formula +
// weight→Inter map that both the preview canvas and the FFmpeg export consume, so
// they cannot drift (Text_Overlay_Export_Spec.md §7.5). Pixel imports these in
// `apps/web` `PreviewEngine`; `@videoforge/ffmpeg-graph` imports them on the export side.
export {
  layoutTextOverlay,
  weightToInterFace,
  weightToInterFile,
  measureTextWidth,
  underlineRule,
  DEFAULT_LINE_HEIGHT,
  FONT_PX_FLOOR,
  DEFAULT_ADVANCE_EM,
  UNDERLINE_OFFSET_EM,
  UNDERLINE_THICKNESS_EM,
} from "./textOverlayLayout.js";
export type { TextLayout, InterFace, UnderlineRule } from "./textOverlayLayout.js";

/**
 * Current project schema version. Incremented only on breaking schema changes;
 * the server migrates older documents on open (§18.3). New documents are stamped
 * with this value.
 */
export const CURRENT_SCHEMA_VERSION = 1 as const;

/** Derive a coarse display aspect ratio label from canvas dimensions. */
function deriveAspectRatio(width: number, height: number): string {
  const known: Record<string, string> = {
    "16:9": "16:9",
    "9:16": "9:16",
    "1:1": "1:1",
    "4:5": "4:5",
    "21:9": "21:9",
  };
  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
  const g = gcd(width, height) || 1;
  const key = `${width / g}:${height / g}`;
  return known[key] ?? "custom";
}

export interface NewProjectOptions {
  title: string;
  canvasWidth: number;
  canvasHeight: number;
  frameRate: number;
}

/**
 * Construct a fresh, valid {@link Project} seeded from a title + canvas params.
 * Mirrors the server's `POST /api/v1/projects` seed (§18.3): empty track/caption/
 * transition/marker/preset arrays, `revision: 1`, current `schemaVersion`.
 *
 * The caller (web store) typically owns/overrides ids; sensible UUID v4 defaults
 * are generated here so the result validates immediately.
 */
export function newProject(opts: NewProjectOptions): Project {
  const now = new Date().toISOString();
  const ownerId = uuidv4();
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    revision: 1,
    id: uuidv4(),
    title: opts.title,
    canvas: {
      width: opts.canvasWidth,
      height: opts.canvasHeight,
      frameRate: opts.frameRate,
      aspectRatio: deriveAspectRatio(opts.canvasWidth, opts.canvasHeight),
      backgroundColor: "#111111",
    },
    // Seed a single empty video track so a fresh project has a visible lane to drop
    // clips onto (an editor with zero tracks reads as broken — there was nowhere to
    // add the first clip). Importing still auto-creates the right lane if no
    // suitable track exists (apps/web MediaPanel), so this is a UX default, not a
    // hard dependency.
    tracks: [
      {
        id: uuidv4(),
        type: "video",
        name: "Video 1",
        colour: "#3A6BFF",
        height: 72,
        muted: false,
        solo: false,
        locked: false,
        hidden: false,
        clips: [],
      },
    ],
    captionTracks: [],
    transitions: [],
    markers: [],
    exportPresets: [],
    ownerId,
    workspaceId: uuidv4(),
    collaborators: [{ userId: ownerId, role: "admin" }],
    isPublic: false,
    templateId: null,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Format integer milliseconds as a frame-accurate timecode `HH:MM:SS:FF`
 * (frames computed against `fps`). Hours are omitted when zero, yielding
 * `MM:SS:FF`. Time is never stored as frames — this is a display helper only.
 */
export function msToTimecode(ms: number, fps: number): string {
  if (!Number.isFinite(ms) || ms < 0) ms = 0;
  if (!Number.isFinite(fps) || fps <= 0) fps = 30;

  const totalFrames = Math.round((ms / 1000) * fps);
  const framesPerSecond = Math.round(fps);
  const totalSeconds = Math.floor(totalFrames / framesPerSecond);
  const frames = totalFrames % framesPerSecond;

  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const pad = (n: number, w = 2): string => String(n).padStart(w, "0");
  const ffWidth = String(framesPerSecond - 1).length;
  const tail = `${pad(minutes)}:${pad(seconds)}:${pad(frames, ffWidth)}`;
  return hours > 0 ? `${pad(hours)}:${tail}` : tail;
}

/**
 * Inverse of {@link msToTimecode}. Parses `HH:MM:SS:FF`, `MM:SS:FF`, or `MM:SS`
 * into integer milliseconds against `fps`. Throws on malformed input.
 */
export function timecodeToMs(timecode: string, fps: number): number {
  if (!Number.isFinite(fps) || fps <= 0) fps = 30;
  const parts = timecode.trim().split(":").map((p) => Number(p));
  if (parts.length < 2 || parts.length > 4 || parts.some((n) => !Number.isFinite(n) || n < 0)) {
    throw new Error(`Invalid timecode: "${timecode}"`);
  }

  let hours = 0;
  let minutes = 0;
  let seconds = 0;
  let frames = 0;

  if (parts.length === 4) {
    [hours, minutes, seconds, frames] = parts as [number, number, number, number];
  } else if (parts.length === 3) {
    [minutes, seconds, frames] = parts as [number, number, number];
  } else {
    [minutes, seconds] = parts as [number, number];
  }

  const totalSeconds = hours * 3600 + minutes * 60 + seconds;
  const fromSeconds = totalSeconds * 1000;
  const fromFrames = Math.round((frames / Math.round(fps)) * 1000);
  return fromSeconds + fromFrames;
}
