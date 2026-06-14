// ─────────────────────────────────────────────────────────────────────────────
// A VALID sample Project (§18) used by ffmpeg-graph tests and the web store seed.
//
// 9:16 portrait, 1080x1920, schemaVersion = current. Contains:
//   • 1 video track with 2 trimmed clips and a crossfade Transition between them
//   • 1 audio track with a clip carrying a volume keyframe + a linked audio clipId
//   • 1 caption track with 2 blocks
//   • 1 overlay track with a text overlay
// All times are integer ms; all canvas geometry is percent 0–100; all ids UUID v4.
//
// NOTE: ids are hardcoded UUID v4 literals (not generated) so the fixture is
// deterministic across test runs — cross-references (transitions, linkedClipId)
// must stay stable.
// ─────────────────────────────────────────────────────────────────────────────

import type { Project } from "../types.js";

// Stable UUID v4 literals -------------------------------------------------------
const PROJECT_ID = "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d";
const OWNER_ID = "4f3a6c2e-1b8d-4e2a-9c7f-0a1b2c3d4e5f";
const WORKSPACE_ID = "7c9e6679-7425-40de-944b-e07fc1f90ae7";

const VIDEO_TRACK_ID = "1d2e3f40-5a6b-4c7d-8e9f-0a1b2c3d4e5a";
const AUDIO_TRACK_ID = "2e3f4051-6b7c-4d8e-9f0a-1b2c3d4e5f6b";
const VOICE_TRACK_ID = "3f405162-7c8d-4e9f-a01b-2c3d4e5f6a7c";
const OVERLAY_TRACK_ID = "40516273-8d9e-4f01-b12c-3d4e5f6a7b8d";
const CAPTION_TRACK_ID = "51627384-9e0f-4012-823d-4e5f6a7b8c9e";

const VIDEO_CLIP_A = "62738495-0f10-4123-934e-5f6a7b8c9d0f";
const VIDEO_CLIP_B = "738495a6-1021-4234-a45f-6a7b8c9d0e10";
const AUDIO_CLIP = "8495a6b7-2132-4345-b560-7b8c9d0e1f21";
const VOICE_CLIP = "95a6b7c8-3243-4456-8671-8c9d0e1f2032";

const ASSET_VIDEO_A = "a6b7c8d9-4354-4567-9782-9d0e1f203143";
const ASSET_VIDEO_B = "b7c8d9e0-5465-4678-a893-0e1f20314254";
const ASSET_AUDIO = "c8d9e0f1-6576-4789-b9a4-1f2031425365";
const ASSET_VOICE = "d9e0f102-7687-489a-8ab5-203142536476";

const TRANSITION_ID = "e0f10213-8798-49ab-9bc6-314253647587";
const TEXT_OVERLAY_ID = "f1021324-98a9-4abc-8cd7-425364758698";
const CAPTION_BLOCK_1 = "02132435-a9ba-4bcd-9de8-5364758697a9";
const CAPTION_BLOCK_2 = "13243546-bacb-4cde-8ef9-647586978aba";
const MARKER_ID = "24354657-cbdc-4def-9f0a-7586978a9bcb";

/** Current schema version (kept in sync with CURRENT_SCHEMA_VERSION in index.ts). */
const SCHEMA_VERSION = 1;

export const sampleProject: Project = {
  schemaVersion: SCHEMA_VERSION,
  revision: 1,
  id: PROJECT_ID,
  title: "Summer Sale Promo",
  description: "VideoForge sample project — 9:16 reel with crossfade, captions and an overlay.",

  canvas: {
    width: 1080,
    height: 1920,
    frameRate: 30,
    aspectRatio: "9:16",
    backgroundColor: "#111111",
  },

  tracks: [
    // index 0 = bottom layer (z-order)
    {
      id: VIDEO_TRACK_ID,
      type: "video",
      name: "Video 1",
      colour: "#3A6BFF",
      height: 72,
      muted: false,
      solo: false,
      locked: false,
      hidden: false,
      clips: [
        {
          id: VIDEO_CLIP_A,
          sourceAssetId: ASSET_VIDEO_A,
          trackId: VIDEO_TRACK_ID,
          // Plays 0–4000ms on the timeline, trimmed from 1000–5000 of the source.
          startOnTimeline: 0,
          endOnTimeline: 4000,
          trimIn: 1000,
          trimOut: 5000,
          speed: 1,
          effects: [],
          keyframes: {},
          linkedClipId: null,
        },
        {
          id: VIDEO_CLIP_B,
          sourceAssetId: ASSET_VIDEO_B,
          trackId: VIDEO_TRACK_ID,
          // Overlaps clip A by 500ms so the crossfade transition has room.
          startOnTimeline: 3500,
          endOnTimeline: 8000,
          trimIn: 0,
          trimOut: 4500,
          speed: 1,
          effects: [
            {
              id: "35465768-dced-4ef0-8a1b-869789a9bcdc",
              type: "colorGrade",
              enabled: true,
              params: { contrast: 8, saturation: 12 },
            },
          ],
          keyframes: {},
          linkedClipId: null,
        },
      ],
    },

    // index 1 — audio (background music), carries mix fields + a volume keyframe.
    {
      id: AUDIO_TRACK_ID,
      type: "audio",
      name: "Music",
      colour: "#22C55E",
      height: 56,
      muted: false,
      solo: false,
      locked: false,
      hidden: false,
      volume: 100,
      pan: 0,
      volumeEnvelope: [
        { timeMs: 0, value: 100 },
        { timeMs: 7000, value: 40 }, // fade music down under the outro
      ],
      clips: [
        {
          id: AUDIO_CLIP,
          sourceAssetId: ASSET_AUDIO,
          trackId: AUDIO_TRACK_ID,
          startOnTimeline: 0,
          endOnTimeline: 8000,
          trimIn: 0,
          trimOut: 8000,
          speed: 1,
          gain: 100,
          effects: [],
          // Per-clip gain keyframe (fade-in over the first 800ms).
          keyframes: {
            gain: [
              { timeMs: 0, value: 0, easing: "easeOut" },
              { timeMs: 800, value: 100, easing: "linear" },
            ],
          },
          // Linked to the voice-over clip so they move together (A/V link group).
          linkedClipId: VOICE_CLIP,
        },
      ],
    },

    // index 2 — voice-over, the other half of the A/V link group.
    {
      id: VOICE_TRACK_ID,
      type: "voiceover",
      name: "Voice Over",
      colour: "#F59E0B",
      height: 56,
      muted: false,
      solo: false,
      locked: false,
      hidden: false,
      volume: 120,
      pan: 0,
      volumeEnvelope: [],
      isDuckingTrigger: true,
      clips: [
        {
          id: VOICE_CLIP,
          sourceAssetId: ASSET_VOICE,
          trackId: VOICE_TRACK_ID,
          startOnTimeline: 500,
          endOnTimeline: 6500,
          trimIn: 0,
          trimOut: 6000,
          speed: 1,
          gain: 100,
          effects: [],
          keyframes: {},
          linkedClipId: AUDIO_CLIP,
        },
      ],
    },

    // index 3 — overlay (top layer): a single text overlay.
    {
      id: OVERLAY_TRACK_ID,
      type: "overlay",
      name: "Overlays",
      colour: "#A855F7",
      height: 56,
      muted: false,
      solo: false,
      locked: false,
      hidden: false,
      clips: [
        {
          id: TEXT_OVERLAY_ID,
          trackId: OVERLAY_TRACK_ID,
          kind: "text",
          startOnTimeline: 1000,
          endOnTimeline: 3000,
          canvasX: 10,
          canvasY: 12,
          width: 80,
          height: 16,
          rotation: 0,
          opacity: 100,
          animation: {
            in: { preset: "fadeIn", durationMs: 300 },
            out: { preset: "fadeOut", durationMs: 300 },
            loop: null,
          },
          keyframes: {
            opacity: [
              { timeMs: 1000, value: 0, easing: "easeOut" },
              { timeMs: 1300, value: 100, easing: "linear" },
            ],
          },
          text: "Summer Sale",
          style: {
            fontFamily: "Inter",
            fontSize: 96,
            fontWeight: 800,
            italic: false,
            color: "#FFFFFF",
            align: "center",
            lineHeight: 1.1,
            outline: { width: 4, color: "#000000", position: "outside" },
            shadow: { color: "#00000080", offsetX: 0, offsetY: 4, blur: 8 },
            backgroundColor: null,
          },
        },
      ],
    },
  ],

  captionTracks: [
    {
      id: CAPTION_TRACK_ID,
      type: "caption",
      name: "Captions (EN)",
      colour: "#06B6D4",
      height: 48,
      muted: false,
      solo: false,
      locked: false,
      hidden: false,
      language: "en",
      style: {
        fontFamily: "Inter",
        fontSize: 56,
        color: "#FFFFFF",
        backgroundColor: "#000000A6",
        outline: { width: 2, color: "#000000" },
        position: "bottom",
        align: "center",
      },
      blocks: [
        {
          id: CAPTION_BLOCK_1,
          startMs: 500,
          endMs: 3500,
          text: "Up to 50% off this weekend.",
          words: [
            { text: "Up", startMs: 500, endMs: 800 },
            { text: "to", startMs: 800, endMs: 1000 },
            { text: "50%", startMs: 1000, endMs: 1600 },
            { text: "off", startMs: 1600, endMs: 2100 },
            { text: "this", startMs: 2100, endMs: 2700 },
            { text: "weekend.", startMs: 2700, endMs: 3500 },
          ],
        },
        {
          id: CAPTION_BLOCK_2,
          startMs: 3600,
          endMs: 7000,
          text: "Shop now before it's gone.",
          // No words[] — manual block; karaoke would synthesise even timing.
          styleOverride: { color: "#FFE08A" },
        },
      ],
    },
  ],

  transitions: [
    {
      id: TRANSITION_ID,
      trackId: VIDEO_TRACK_ID,
      fromClipId: VIDEO_CLIP_A,
      toClipId: VIDEO_CLIP_B,
      type: "crossfade",
      durationMs: 500,
      params: { easing: "linear" },
    },
  ],

  markers: [
    {
      id: MARKER_ID,
      timeMs: 3500,
      type: "chapter",
      label: "Offer",
      colour: "#FF7A1A",
      note: "Headline offer hits here.",
    },
  ],

  exportPresets: [],

  ownerId: OWNER_ID,
  workspaceId: WORKSPACE_ID,
  collaborators: [{ userId: OWNER_ID, role: "admin" }],
  isPublic: false,
  templateId: null,

  createdAt: "2026-06-01T12:00:00.000Z",
  updatedAt: "2026-06-01T12:00:00.000Z",
};

export default sampleProject;
