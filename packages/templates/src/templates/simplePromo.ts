// ─────────────────────────────────────────────────────────────────────────────
// Template 5 — Simple Promo (Templates_Spec §3 #5, Templates_Design §3 T5).
//
// Clean product/service announcement: 3 photo-or-video slots (opening scene zoom-in,
// closing scene zoom-out, a final logo/brand still — no Ken Burns), 4 editable text
// overlays (brand name, feature 1, feature 2, CTA). 600ms scene crossfade, 300ms cut
// into the logo card. Neutral clarity grade, music slot with short fades. 9:16.
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

const K = "simple-promo";
const k = (s: string): string => id(`${K}:${s}`);

export const SIMPLE_PROMO_ID = id("template:simple-promo");

const VIDEO_TRACK = k("video");
const OVERLAY_TRACK = k("overlay");
const AUDIO_TRACK = k("audio");

// Scene 1 (8s) → 600ms xfade → Scene 2 (7s) → 300ms cut → Logo (2s).
const SCENE1 = { start: 0, end: 8000 };
const SCENE2 = { start: 7400, end: 14400 };
const LOGO = { start: 14100, end: 16100 };
const DURATION = LOGO.end;

const assets = PLACEHOLDER_ASSET_IDS.slice(16, 19);
const SCENE1_CLIP = k("scene-1");
const SCENE2_CLIP = k("scene-2");
const LOGO_CLIP = k("logo");

const clips = [
  mediaSlotClip({
    clipId: SCENE1_CLIP, trackId: VIDEO_TRACK, assetId: assets[0]!,
    startMs: SCENE1.start, endMs: SCENE1.end, colorGrade: GRADES.promo,
    kenBurns: { startScale: 1.0, endScale: 1.1 },
  }),
  mediaSlotClip({
    clipId: SCENE2_CLIP, trackId: VIDEO_TRACK, assetId: assets[1]!,
    startMs: SCENE2.start, endMs: SCENE2.end, colorGrade: GRADES.promo,
    kenBurns: { startScale: 1.1, endScale: 1.0 }, // reverse zoom (Iris T5)
  }),
  mediaSlotClip({
    clipId: LOGO_CLIP, trackId: VIDEO_TRACK, assetId: assets[2]!,
    startMs: LOGO.start, endMs: LOGO.end, colorGrade: GRADES.promo,
    // No Ken Burns — the logo holds crisply still.
  }),
];

const BRAND_ID = k("brand");
const FEAT1_ID = k("feature-1");
const FEAT2_ID = k("feature-2");
const CTA_ID = k("cta");
const brandText = "Your Brand";
const feat1Text = "Made for you";
const feat2Text = "In stores now";
const ctaText = "Visit us today";

const overlays = [
  textOverlay({
    overlayId: BRAND_ID, trackId: OVERLAY_TRACK, text: brandText,
    startMs: 400, endMs: 7600, canvasX: 8, canvasY: 28, width: 84, height: 14,
    fontSize: 134, fontWeight: 800,
  }),
  textOverlay({
    overlayId: FEAT1_ID, trackId: OVERLAY_TRACK, text: feat1Text,
    startMs: 1200, endMs: 7600, canvasX: 8, canvasY: 40, width: 84, height: 8,
    fontSize: 67, fontWeight: 500, color: "#FFFFFFD9",
  }),
  textOverlay({
    overlayId: FEAT2_ID, trackId: OVERLAY_TRACK, text: feat2Text,
    startMs: 8000, endMs: 14000, canvasX: 8, canvasY: 40, width: 84, height: 8,
    fontSize: 67, fontWeight: 500, color: "#FFFFFFD9",
  }),
  textOverlay({
    overlayId: CTA_ID, trackId: OVERLAY_TRACK, text: ctaText,
    startMs: 8400, endMs: 14400, canvasX: 8, canvasY: 84, width: 84, height: 10,
    fontSize: 86, fontWeight: 700,
  }),
];

const transitions = [
  crossfade({ transitionId: k("xf-1"), trackId: VIDEO_TRACK, fromClipId: SCENE1_CLIP, toClipId: SCENE2_CLIP, durationMs: 600 }),
  crossfade({ transitionId: k("xf-2"), trackId: VIDEO_TRACK, fromClipId: SCENE2_CLIP, toClipId: LOGO_CLIP, durationMs: 300 }),
];

const MUSIC_CLIP = k("music");
const audio = audioSlotClip({
  clipId: MUSIC_CLIP, trackId: AUDIO_TRACK, assetId: PLACEHOLDER_AUDIO_ASSET_IDS.promo,
  startMs: 0, endMs: DURATION, gain: 100, fadeInMs: 500, fadeOutMs: 1000,
});

const document: Project = {
  schemaVersion: 1,
  revision: 1,
  id: id("template:simple-promo:doc"),
  title: "Simple Promo",
  description: "A clean product or service highlight — intro, scenes, CTA.",
  canvas: { ...CANVAS_9_16 },
  tracks: [
    videoTrack(VIDEO_TRACK, "Scenes", clips),
    audioTrack(AUDIO_TRACK, "Promo music", [audio]),
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

const mediaSlots: TemplateSlot[] = [
  { id: "scene-1", kind: "video", label: "Opening scene", index: 1, total: 3, target: { type: "clip", clipId: SCENE1_CLIP, trackId: VIDEO_TRACK }, placeholder: { kind: "asset", assetId: assets[0]! }, optional: true },
  { id: "scene-2", kind: "video", label: "Closing scene", index: 2, total: 3, target: { type: "clip", clipId: SCENE2_CLIP, trackId: VIDEO_TRACK }, placeholder: { kind: "asset", assetId: assets[1]! }, optional: true },
  { id: "logo", kind: "image", label: "Logo / brand mark", index: 3, total: 3, target: { type: "clip", clipId: LOGO_CLIP, trackId: VIDEO_TRACK }, placeholder: { kind: "asset", assetId: assets[2]! }, optional: true },
];
const textSlots: TemplateSlot[] = [
  { id: "brand", kind: "text", label: "Brand name", index: 1, total: 4, target: { type: "overlay", overlayId: BRAND_ID }, placeholder: { kind: "text", text: brandText }, optional: true },
  { id: "feature-1", kind: "text", label: "Feature 1", index: 2, total: 4, target: { type: "overlay", overlayId: FEAT1_ID }, placeholder: { kind: "text", text: feat1Text }, optional: true },
  { id: "feature-2", kind: "text", label: "Feature 2", index: 3, total: 4, target: { type: "overlay", overlayId: FEAT2_ID }, placeholder: { kind: "text", text: feat2Text }, optional: true },
  { id: "cta", kind: "text", label: "Call to action", index: 4, total: 4, target: { type: "overlay", overlayId: CTA_ID }, placeholder: { kind: "text", text: ctaText }, optional: true },
];

export const simplePromo: Template = {
  manifest: {
    id: SIMPLE_PROMO_ID,
    name: "Simple Promo",
    description: "A clean product or service announcement.",
    durationMs: DURATION,
    aspectRatio: "9:16",
    meta: "16s · 3 clips",
    tags: ["ken-burns", "xfade", "text"],
    slots: [...mediaSlots, ...textSlots],
  },
  document,
};
