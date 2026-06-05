// ─────────────────────────────────────────────────────────────────────────────
// Template 4 — Motivational Quote (Templates_Spec §3 #4, Templates_Design §3 T4).
//
// Typographic-first single-message piece: 1 background video/photo slot (heavy dark
// grade so the type breathes; barely-perceptible 1.04 Ken Burns), 2 editable text
// overlays (quote, attribution). Single slot → no boundary crossfade; the clip carries
// fade-in/out instead. A quiet music slot (50% gain). 9:16.
//
// Iris's dark gradient scrim is expressed via the clip's heavy color grade + the text
// overlays' outline/shadow rather than a separate image-overlay asset — keeping the
// document to MVP color-grade/text features with no extra bundled-asset dependency.
// ─────────────────────────────────────────────────────────────────────────────

import type { Project } from "@videoforge/project-schema";
import {
  audioSlotClip,
  audioTrack,
  CANVAS_9_16,
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

const K = "motivational-quote";
const k = (s: string): string => id(`${K}:${s}`);

export const MOTIVATIONAL_QUOTE_ID = id("template:motivational-quote");

const VIDEO_TRACK = k("video");
const OVERLAY_TRACK = k("overlay");
const AUDIO_TRACK = k("audio");

const DURATION = 12000;
const BG_ASSET = PLACEHOLDER_ASSET_IDS[15]!;
const BG_CLIP = k("background");

const bg = mediaSlotClip({
  clipId: BG_CLIP, trackId: VIDEO_TRACK, assetId: BG_ASSET,
  startMs: 0, endMs: DURATION, colorGrade: GRADES.quote,
  kenBurns: { startScale: 1.0, endScale: 1.04 },
});
// Single-slot fade-from-black / fade-to-black (Iris T4: fadeIn/fadeOut 800).
bg.fadeInMs = 800;
bg.fadeOutMs = 800;

const QUOTE_ID = k("quote");
const ATTR_ID = k("attribution");
const quoteText = "The best way out is always through.";
const attrText = "— Robert Frost";

const overlays = [
  textOverlay({
    overlayId: QUOTE_ID, trackId: OVERLAY_TRACK, text: quoteText,
    startMs: 800, endMs: 11200, canvasX: 8, canvasY: 35, width: 84, height: 24,
    fontSize: 134, fontWeight: 700, align: "left",
  }),
  textOverlay({
    overlayId: ATTR_ID, trackId: OVERLAY_TRACK, text: attrText,
    startMs: 1400, endMs: 11200, canvasX: 8, canvasY: 62, width: 84, height: 8,
    fontSize: 58, fontWeight: 400, align: "left", color: "#FFFFFFA6",
  }),
];

const MUSIC_CLIP = k("music");
// Quiet ambient bed (Iris: 50% gain).
const audio = audioSlotClip({
  clipId: MUSIC_CLIP, trackId: AUDIO_TRACK, assetId: PLACEHOLDER_AUDIO_ASSET_IDS.quote,
  startMs: 0, endMs: DURATION, gain: 50, fadeInMs: 800, fadeOutMs: 800,
});

const document: Project = {
  schemaVersion: 1,
  revision: 1,
  id: id("template:motivational-quote:doc"),
  title: "Motivational Quote",
  description: "A visually bold single-message video — large centre quote.",
  canvas: { ...CANVAS_9_16 },
  tracks: [
    videoTrack(VIDEO_TRACK, "Background", [bg]),
    audioTrack(AUDIO_TRACK, "Ambient music", [audio]),
    overlayTrack(OVERLAY_TRACK, "Text", overlays),
  ],
  captionTracks: [],
  transitions: [],
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

const mediaSlots: TemplateSlot[] = [
  { id: "background", kind: "video", label: "Background clip", index: 1, total: 1, target: { type: "clip", clipId: BG_CLIP, trackId: VIDEO_TRACK }, placeholder: { kind: "asset", assetId: BG_ASSET }, optional: true },
];
const textSlots: TemplateSlot[] = [
  { id: "quote", kind: "text", label: "Quote", index: 1, total: 2, target: { type: "overlay", overlayId: QUOTE_ID }, placeholder: { kind: "text", text: quoteText }, optional: true },
  { id: "attribution", kind: "text", label: "Attribution", index: 2, total: 2, target: { type: "overlay", overlayId: ATTR_ID }, placeholder: { kind: "text", text: attrText }, optional: true },
];

export const motivationalQuote: Template = {
  manifest: {
    id: MOTIVATIONAL_QUOTE_ID,
    name: "Motivational Quote",
    description: "A bold, typographic single-message video.",
    durationMs: DURATION,
    aspectRatio: "9:16",
    meta: "12s · 1 clip",
    tags: ["ken-burns", "text"],
    slots: [...mediaSlots, ...textSlots],
  },
  document,
};
