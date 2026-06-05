// ─────────────────────────────────────────────────────────────────────────────
// Template 1 — Happy Birthday (Templates_Spec §3 #1, Templates_Design §3 T1).
//
// Warm, personal celebratory reel: 4 photo slots (Ken Burns), 3 editable text
// overlays (name title, caption line, closing wish), 800ms crossfades, warm grade,
// a placeholder background-music slot the user fills. 9:16.
// ─────────────────────────────────────────────────────────────────────────────

import type { Project } from "@videoforge/project-schema";
import {
  audioSlotClip,
  audioTrack,
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
import { PLACEHOLDER_ASSET_IDS, PLACEHOLDER_AUDIO_ASSET_IDS } from "../placeholders.js";
import type { Template, TemplateSlot } from "../types.js";

const K = "happy-birthday";
const k = (s: string): string => id(`${K}:${s}`);

export const HAPPY_BIRTHDAY_ID = id("template:happy-birthday");

// ── Slot layout (integer ms; 800ms overlaps for the crossfade) ──────────────────
const XFADE = 800;
const PHOTO = [
  { start: 0, end: 5000 },
  { start: 4200, end: 9200 },
  { start: 8400, end: 13400 },
  { start: 12600, end: 17600 },
] as const;

const VIDEO_TRACK = k("video");
const OVERLAY_TRACK = k("overlay");
const AUDIO_TRACK = k("audio");

const photoAssets = PLACEHOLDER_ASSET_IDS.slice(0, 4);
const photoClipIds = PHOTO.map((_, i) => k(`photo-${i + 1}`));

// Ken Burns: warm slow zoom-in (Iris T1). startScale→endScale ramp.
const KB = { startScale: 1.0, endScale: 1.12 };

const clips = PHOTO.map((p, i) =>
  mediaSlotClip({
    clipId: photoClipIds[i]!,
    trackId: VIDEO_TRACK,
    assetId: photoAssets[i]!,
    startMs: p.start,
    endMs: p.end,
    colorGrade: GRADES.birthday,
    kenBurns: KB,
  }),
);

// 3 editable text overlays: title (over photo 1), mid caption, closing wish.
const TITLE_ID = k("title");
const CAPTION_ID = k("caption");
const CLOSING_ID = k("closing");

const titleText = "Happy Birthday";
const captionText = "Another year of you";
const closingText = "Make a wish ✦";

const overlays = [
  textOverlay({
    overlayId: TITLE_ID, trackId: OVERLAY_TRACK, text: titleText,
    startMs: 200, endMs: 4800, canvasX: 8, canvasY: 14, width: 84, height: 14,
    fontSize: 115, fontWeight: 700,
  }),
  textOverlay({
    overlayId: CAPTION_ID, trackId: OVERLAY_TRACK, text: captionText,
    startMs: 8600, endMs: 13200, canvasX: 8, canvasY: 78, width: 84, height: 10,
    fontSize: 60, fontWeight: 500,
  }),
  textOverlay({
    overlayId: CLOSING_ID, trackId: OVERLAY_TRACK, text: closingText,
    startMs: 13000, endMs: 17600, canvasX: 8, canvasY: 44, width: 84, height: 12,
    fontSize: 72, fontWeight: 500, italic: true,
  }),
];

const transitions = [
  crossfade({ transitionId: k("xf-1"), trackId: VIDEO_TRACK, fromClipId: photoClipIds[0]!, toClipId: photoClipIds[1]!, durationMs: XFADE }),
  crossfade({ transitionId: k("xf-2"), trackId: VIDEO_TRACK, fromClipId: photoClipIds[1]!, toClipId: photoClipIds[2]!, durationMs: XFADE }),
  crossfade({ transitionId: k("xf-3"), trackId: VIDEO_TRACK, fromClipId: photoClipIds[2]!, toClipId: photoClipIds[3]!, durationMs: XFADE }),
];

// Background-music placeholder slot (user fills; the template ships no licensed track).
const MUSIC_CLIP = k("music");
const audio = audioSlotClip({
  clipId: MUSIC_CLIP, trackId: AUDIO_TRACK, assetId: PLACEHOLDER_AUDIO_ASSET_IDS.birthday,
  startMs: 0, endMs: 17600, gain: 100, fadeInMs: 800, fadeOutMs: 1500,
});

const document: Project = {
  schemaVersion: 1,
  revision: 1,
  id: id("template:happy-birthday:doc"),
  title: "Happy Birthday",
  description: "A warm birthday shoutout — 4 photos, Ken Burns, crossfades.",
  canvas: { ...CANVAS_9_16 },
  tracks: [
    videoTrack(VIDEO_TRACK, "Photos", clips),
    audioTrack(AUDIO_TRACK, "Birthday music", [audio]),
    overlayTrack(OVERLAY_TRACK, "Text", overlays),
  ],
  captionTracks: [],
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

const mediaSlots: TemplateSlot[] = photoClipIds.map((clipId, i) => ({
  id: `photo-${i + 1}`,
  kind: "image",
  label: `Photo ${i + 1}`,
  index: i + 1,
  total: 4,
  target: { type: "clip", clipId, trackId: VIDEO_TRACK },
  placeholder: { kind: "asset", assetId: photoAssets[i]! },
  optional: true,
}));

const textSlots: TemplateSlot[] = [
  { id: "title", kind: "text", label: "Name / title", index: 1, total: 3, target: { type: "overlay", overlayId: TITLE_ID }, placeholder: { kind: "text", text: titleText }, optional: true },
  { id: "caption", kind: "text", label: "Caption line", index: 2, total: 3, target: { type: "overlay", overlayId: CAPTION_ID }, placeholder: { kind: "text", text: captionText }, optional: true },
  { id: "closing", kind: "text", label: "Closing wish", index: 3, total: 3, target: { type: "overlay", overlayId: CLOSING_ID }, placeholder: { kind: "text", text: closingText }, optional: true },
];

export const happyBirthday: Template = {
  manifest: {
    id: HAPPY_BIRTHDAY_ID,
    name: "Happy Birthday",
    description: "A warm, personal birthday shoutout.",
    durationMs: 17600,
    aspectRatio: "9:16",
    meta: "18s · 4 photos",
    tags: ["ken-burns", "xfade", "text"],
    slots: [...mediaSlots, ...textSlots],
  },
  document,
};
