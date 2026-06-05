// ─────────────────────────────────────────────────────────────────────────────
// Template 3 — Photo Memories (Templates_Spec §3 #3, Templates_Design §3 T3).
//
// Nostalgic slideshow: 6 photo slots (subtle 1.06 Ken Burns), 2 editable text
// overlays (album title, closing), + one editable caption block per photo (6 blocks),
// 1000ms slow dissolves, warm-matte grade. 9:16.
// ─────────────────────────────────────────────────────────────────────────────

import type { Project } from "@videoforge/project-schema";
import {
  captionBlock,
  captionTrack,
  CANVAS_9_16,
  crossfade,
  GRADES,
  id,
  mediaSlotClip,
  overlayTrack,
  TEMPLATE_CREATED_AT,
  TEMPLATE_OWNER_ID,
  TEMPLATE_WORKSPACE_ID,
  textOverlay,
  videoTrack,
} from "../authoring.js";
import { PLACEHOLDER_ASSET_IDS } from "../placeholders.js";
import type { Template, TemplateSlot } from "../types.js";

const K = "photo-memories";
const k = (s: string): string => id(`${K}:${s}`);

export const PHOTO_MEMORIES_ID = id("template:photo-memories");

const XFADE = 1000;
const PHOTOS = [
  { start: 0, end: 5000 },
  { start: 4000, end: 9000 },
  { start: 8000, end: 13000 },
  { start: 12000, end: 17000 },
  { start: 16000, end: 21000 },
  { start: 20000, end: 25000 },
] as const;

const VIDEO_TRACK = k("video");
const OVERLAY_TRACK = k("overlay");
const CAPTION_TRACK = k("captions");

const assets = PLACEHOLDER_ASSET_IDS.slice(9, 15);
const clipIds = PHOTOS.map((_, i) => k(`photo-${i + 1}`));

// Subtle zoom-in (Iris T3: 1.06). Slot 4 reads as the emotional peak (same ramp here).
const KB = { startScale: 1.0, endScale: 1.06 };

const clips = PHOTOS.map((p, i) =>
  mediaSlotClip({
    clipId: clipIds[i]!,
    trackId: VIDEO_TRACK,
    assetId: assets[i]!,
    startMs: p.start,
    endMs: p.end,
    colorGrade: GRADES.memories,
    kenBurns: KB,
  }),
);

const TITLE_ID = k("title");
const CLOSING_ID = k("closing");
const titleText = "Our Memories";
const closingText = "Some moments stay forever";

const overlays = [
  textOverlay({
    overlayId: TITLE_ID, trackId: OVERLAY_TRACK, text: titleText,
    startMs: 200, endMs: 4800, canvasX: 8, canvasY: 8, width: 84, height: 10,
    fontSize: 72, fontWeight: 600, color: "#FFF8EB",
  }),
  textOverlay({
    overlayId: CLOSING_ID, trackId: OVERLAY_TRACK, text: closingText,
    startMs: 20500, endMs: 25000, canvasX: 8, canvasY: 46, width: 84, height: 12,
    fontSize: 56, fontWeight: 400, italic: true, color: "#FFF8EB",
  }),
];

// One editable caption block per photo (timing locked to each slot; user types text).
const captionDefaults = [
  "Summer 2019",
  "The whole crew",
  "Best day",
  "Golden hour",
  "Right here",
  "Always",
];
const blockIds = PHOTOS.map((_, i) => k(`cap-${i + 1}`));
const blocks = PHOTOS.map((p, i) =>
  captionBlock({ blockId: blockIds[i]!, text: captionDefaults[i]!, startMs: p.start + 300, endMs: p.end - 300 }),
);

const transitions = clipIds.slice(0, -1).map((from, i) =>
  crossfade({ transitionId: k(`xf-${i + 1}`), trackId: VIDEO_TRACK, fromClipId: from, toClipId: clipIds[i + 1]!, durationMs: XFADE }),
);

const document: Project = {
  schemaVersion: 1,
  revision: 1,
  id: id("template:photo-memories:doc"),
  title: "Photo Memories",
  description: "A slideshow-style retrospective — 6 photos, gentle Ken Burns, captions.",
  canvas: { ...CANVAS_9_16 },
  tracks: [
    videoTrack(VIDEO_TRACK, "Photos", clips),
    overlayTrack(OVERLAY_TRACK, "Text", overlays),
  ],
  captionTracks: [captionTrack({ trackId: CAPTION_TRACK, name: "Captions", blocks })],
  transitions,
  markers: [],
  exportPresets: [],
  ownerId: TEMPLATE_OWNER_ID,
  workspaceId: TEMPLATE_WORKSPACE_ID,
  collaborators: [{ userId: TEMPLATE_OWNER_ID, role: "admin" }],
  isPublic: false,
  templateId: null,
  createdAt: TEMPLATE_CREATED_AT,
  updatedAt: TEMPLATE_CREATED_AT,
};

const mediaSlots: TemplateSlot[] = clipIds.map((clipId, i) => ({
  id: `photo-${i + 1}`,
  kind: "image",
  label: `Photo ${i + 1}`,
  index: i + 1,
  total: 6,
  target: { type: "clip", clipId, trackId: VIDEO_TRACK },
  placeholder: { kind: "asset", assetId: assets[i]! },
  optional: true,
}));

const textSlots: TemplateSlot[] = [
  { id: "title", kind: "text", label: "Album title", index: 1, total: 8, target: { type: "overlay", overlayId: TITLE_ID }, placeholder: { kind: "text", text: titleText }, optional: true },
  { id: "closing", kind: "text", label: "Closing line", index: 2, total: 8, target: { type: "overlay", overlayId: CLOSING_ID }, placeholder: { kind: "text", text: closingText }, optional: true },
  ...blockIds.map((blockId, i): TemplateSlot => ({
    id: `caption-${i + 1}`,
    kind: "text",
    label: `Caption ${i + 1}`,
    index: i + 3,
    total: 8,
    target: { type: "captionBlock", captionTrackId: CAPTION_TRACK, blockId },
    placeholder: { kind: "text", text: captionDefaults[i]! },
    optional: true,
  })),
];

export const photoMemories: Template = {
  manifest: {
    id: PHOTO_MEMORIES_ID,
    name: "Photo Memories",
    description: "A gentle slideshow retrospective.",
    durationMs: 25000,
    aspectRatio: "9:16",
    meta: "25s · 6 photos",
    tags: ["ken-burns", "xfade", "text", "captions"],
    slots: [...mediaSlots, ...textSlots],
  },
  document,
};
