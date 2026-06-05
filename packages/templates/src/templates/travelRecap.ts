// ─────────────────────────────────────────────────────────────────────────────
// Template 2 — Travel Recap (Templates_Spec §3 #2, Templates_Design §3 T2).
//
// Cinematic montage: 5 photo-or-video slots (Ken Burns lateral pans via scale ramp),
// 3 editable text overlays (destination, moment label, closing), 500ms snappy
// crossfades, cinematic grade, music slot with fades. 9:16.
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

const K = "travel-recap";
const k = (s: string): string => id(`${K}:${s}`);

export const TRAVEL_RECAP_ID = id("template:travel-recap");

const XFADE = 500;
// First slot 8s, slots 2-4 6s, last 7s; 500ms overlaps. (Spec §3: 5 slots.)
const MOMENTS = [
  { start: 0, end: 8000 },
  { start: 7500, end: 13500 },
  { start: 13000, end: 19000 },
  { start: 18500, end: 24500 },
  { start: 24000, end: 31000 },
] as const;

const VIDEO_TRACK = k("video");
const OVERLAY_TRACK = k("overlay");
const AUDIO_TRACK = k("audio");

const assets = PLACEHOLDER_ASSET_IDS.slice(4, 9);
const clipIds = MOMENTS.map((_, i) => k(`moment-${i + 1}`));

const KB = { startScale: 1.0, endScale: 1.12 };

const clips = MOMENTS.map((m, i) =>
  mediaSlotClip({
    clipId: clipIds[i]!,
    trackId: VIDEO_TRACK,
    assetId: assets[i]!,
    startMs: m.start,
    endMs: m.end,
    colorGrade: GRADES.travel,
    kenBurns: KB,
  }),
);

const DEST_ID = k("destination");
const MOMENT_ID = k("moment-label");
const CLOSING_ID = k("closing");

const destText = "ICELAND";
const momentText = "Day three";
const closingText = "Until next time";

const overlays = [
  textOverlay({
    overlayId: DEST_ID, trackId: OVERLAY_TRACK, text: destText,
    startMs: 400, endMs: 7600, canvasX: 6, canvasY: 44, width: 88, height: 12,
    fontSize: 120, fontWeight: 800,
  }),
  textOverlay({
    overlayId: MOMENT_ID, trackId: OVERLAY_TRACK, text: momentText,
    startMs: 13200, endMs: 18800, canvasX: 6, canvasY: 84, width: 60, height: 8,
    fontSize: 54, fontWeight: 500, align: "left",
  }),
  textOverlay({
    overlayId: CLOSING_ID, trackId: OVERLAY_TRACK, text: closingText,
    startMs: 25000, endMs: 31000, canvasX: 6, canvasY: 46, width: 88, height: 10,
    fontSize: 64, fontWeight: 600,
  }),
];

const transitions = [
  crossfade({ transitionId: k("xf-1"), trackId: VIDEO_TRACK, fromClipId: clipIds[0]!, toClipId: clipIds[1]!, durationMs: XFADE }),
  crossfade({ transitionId: k("xf-2"), trackId: VIDEO_TRACK, fromClipId: clipIds[1]!, toClipId: clipIds[2]!, durationMs: XFADE }),
  crossfade({ transitionId: k("xf-3"), trackId: VIDEO_TRACK, fromClipId: clipIds[2]!, toClipId: clipIds[3]!, durationMs: XFADE }),
  crossfade({ transitionId: k("xf-4"), trackId: VIDEO_TRACK, fromClipId: clipIds[3]!, toClipId: clipIds[4]!, durationMs: XFADE }),
];

const MUSIC_CLIP = k("music");
const audio = audioSlotClip({
  clipId: MUSIC_CLIP, trackId: AUDIO_TRACK, assetId: PLACEHOLDER_AUDIO_ASSET_IDS.travel,
  startMs: 0, endMs: 31000, gain: 100, fadeInMs: 1000, fadeOutMs: 2000,
});

const document: Project = {
  schemaVersion: 1,
  revision: 1,
  id: id("template:travel-recap:doc"),
  title: "Travel Recap",
  description: "A punchy highlights reel from a trip — 5 moments, crossfades.",
  canvas: { ...CANVAS_9_16 },
  tracks: [
    videoTrack(VIDEO_TRACK, "Moments", clips),
    audioTrack(AUDIO_TRACK, "Travel music", [audio]),
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

const mediaSlots: TemplateSlot[] = clipIds.map((clipId, i) => ({
  id: `moment-${i + 1}`,
  kind: "video",
  label: `Moment ${i + 1}`,
  index: i + 1,
  total: 5,
  target: { type: "clip", clipId, trackId: VIDEO_TRACK },
  placeholder: { kind: "asset", assetId: assets[i]! },
  optional: true,
}));

const textSlots: TemplateSlot[] = [
  { id: "destination", kind: "text", label: "Destination", index: 1, total: 3, target: { type: "overlay", overlayId: DEST_ID }, placeholder: { kind: "text", text: destText }, optional: true },
  { id: "moment-label", kind: "text", label: "Moment label", index: 2, total: 3, target: { type: "overlay", overlayId: MOMENT_ID }, placeholder: { kind: "text", text: momentText }, optional: true },
  { id: "closing", kind: "text", label: "Closing line", index: 3, total: 3, target: { type: "overlay", overlayId: CLOSING_ID }, placeholder: { kind: "text", text: closingText }, optional: true },
];

export const travelRecap: Template = {
  manifest: {
    id: TRAVEL_RECAP_ID,
    name: "Travel Recap",
    description: "A cinematic highlights reel from a trip.",
    durationMs: 31000,
    aspectRatio: "9:16",
    meta: "31s · 5 clips",
    tags: ["ken-burns", "xfade", "text"],
    slots: [...mediaSlots, ...textSlots],
  },
  document,
};
