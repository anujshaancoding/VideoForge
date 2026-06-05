# VideoForge — Templates Feature Spec

**Author:** Vera (Head of Product) · **Date:** 2026-06-04
**Status:** Draft · **Scope:** Post-MVP, CEO-approved pull-forward
**Parent docs:** `docs/MVP_Scope.md`, `docs/VideoForge_Spec_v1.1.md`, `packages/project-schema/src/types.ts`

---

## 0. Context & Mandate

The CEO has approved pulling this feature forward from Phase 1 into the active build cycle. Templates are additive — they do not touch the fidelity invariant, the export pipeline, or any existing MVP scope item. They are pure project-creation sugar: a pre-built project JSON (the same `Project` document the editor already understands) shipped with a curated set of placeholder clips and pre-authored text overlays. Nothing new needs to be invented in the data model; `templateId?: UUID | null` is already present in the `Project` type (§18.2).

**Scope of this spec:** browser-based template gallery, user-selectable via the "New Project" flow, pre-populated editor experience, customization model, and export path. No AI, no server-side template rendering, no collaboration, no paid-tier gating at launch (Free watermark applies as normal).

---

## 1. User Flow

### 1.1 Entry Point — New Project Modal (Expanded)

The existing `NewProjectModal` shows a canvas-ratio chooser ("Start blank"). Templates are surfaced as a second creation path in the same modal — **not** a separate page or route.

```
Dashboard
  └── "New project" CTA
        └── NewProjectModal
              ├── [TAB] Start blank  (existing flow, unchanged)
              └── [TAB] Start from a template  ← NEW
                    └── Template Gallery  (4–5 cards in a 2-column grid)
                          └── [Pick a template card]
                                └── Editor opens, pre-filled project
                                      ├── Media slots show placeholder UI ("Drop your photo/clip here")
                                      ├── Text overlays pre-authored (editable)
                                      └── [Export] → standard Free-tier watermarked MP4
```

The two tabs ("Start blank" / "Start from a template") use equal visual weight — neither is the default. The ratio chooser from the blank flow is hidden on the template tab; each template bakes in its own aspect ratio (all 5 ship as 9:16 vertical, matching the MVP default). The tab selection persists within the session only; it does not become a default.

### 1.2 Template Gallery

- Renders as a 2-column grid of thumbnail cards (max 4–5 cards; all fit above the fold at standard viewport height, no scroll required).
- Each card shows: a static preview thumbnail (a representative composite frame, not a video), the template name, and a one-line description.
- Hover/focus state: sky-blue ring (`--vf-selection`) + "Use this template" label appears.
- No search, no categories, no pagination in this release.

### 1.3 Pick → Editor Opens Pre-Filled

On selecting a template and clicking "Create" (or double-clicking the card):

1. The API creates a new `Project` document by deep-cloning the template's canonical project JSON, assigning a new `id`, `ownerId`, `workspaceId`, `createdAt`, `updatedAt`, and preserving `templateId` set to the source template's UUID.
2. The editor opens identically to a blank project, except:
   - The timeline is pre-populated with placeholder clips and pre-authored text overlays.
   - The project title defaults to `"<Template Name> — [date]"` (user can rename immediately).
3. The media library panel is empty (the user's own assets, not the template's). Placeholder clips in the timeline display their "empty slot" UI until the user fills them.

### 1.4 Customise → Export

The user workflow inside the editor is exactly the existing edit loop:

1. **Fill media slots** — drag a photo or clip from the media panel onto a placeholder clip in the timeline, or click the placeholder to open a file picker. Text overlays are editable by clicking on them in the canvas or the timeline.
2. **Review & adjust** — the user may change text content, adjust clip duration within the allowed range (see §2.4), or rearrange the order of filled slots.
3. **Export** — identical to the standard export flow (Export CTA in amber, modal, MP4/H.264 ≤ 1080p, Free watermark). No template-specific export restrictions.

---

## 2. Customisation Model

### 2.1 Core Principle

Templates must stay easy and stay impressive. The constraint is: a first-time user with zero video editing experience must be able to produce a polished-looking 30–40 second video in under 10 minutes. That means the number of decisions the user must make is kept small. Timing, transitions, layout, and style are pre-decided by the template; the user only supplies their own media and their own words.

### 2.2 User-Editable Slots (the "what you change")

| Slot type | What the user can do |
|---|---|
| **Media slot (video/photo)** | Replace the placeholder with their own video clip or photo. The slot's duration on the timeline is fixed (see §2.4). The user cannot add extra slots or delete existing slots in this release. |
| **Text overlay slot** | Click to edit the text content. Font, size, colour, and position are locked to the template style; only the text string is editable. |
| **Caption block (if template includes one)** | Edit the text content of pre-authored caption blocks. Timing is locked. |

### 2.3 Locked Elements (the "what stays as-is")

The following are set by the template and are not exposed for user editing in the Templates flow. They are still stored in the project JSON (they are not stripped), so a power user who exits the template flow and edits the project normally may touch them — but the Templates UI does not surface controls for them.

| Locked element | Reason |
|---|---|
| Clip timing (start/end on timeline, trimIn/trimOut per slot) | Preserves the 30–40 s overall duration and the template's rhythm. |
| Transitions (type, duration, placement) | Crossfades between slots are the template's style signature. Changing them is an advanced edit. |
| Track layout (which tracks exist, their order, count) | Free-tier track limits already constrain this; template structure must fit within them. |
| Text overlay style (font, size, colour, position, opacity) | Keeps the visual identity coherent. Text content is editable; style is not. |
| Ken Burns / keyframe animation settings on each slot | The "motion" feel is the template's value-add; changing it is out of scope. |
| Color grade settings | Template may apply a consistent grade across all clips; user cannot change it in this flow. |
| Audio track (background music clip, if present) | Background music is pre-licensed CC0 or royalty-free; user cannot swap it in this release (see §4 future scope). |

### 2.4 Media Slot Definition

A **media slot** is a `Clip` in the project JSON whose `sourceAssetId` is set to a well-known sentinel value (`"00000000-0000-0000-0000-000000000000"`, the "empty slot" UUID) rather than a real uploaded asset.

**User-facing representation:**
- In the canvas preview: a dark panel with a centered dashed rectangle and the label **"Drop your photo/clip here"** (or "Drop your video here" for video-only slots, "Drop your photo here" for photo-only slots). The slot's background colour is `#1A1A1A` (near-black) with a `#444444` dashed border at 1 px.
- In the timeline: the clip block is rendered with diagonal hash lines and the slot number (e.g. "Photo 1 of 4") instead of a thumbnail strip.
- The slot's duration on the timeline does not change when the user fills it — the placed media is trimmed or stretched (with a capped speed change) to fit. If the placed clip is shorter than the slot, the clip fills the slot at 1× speed and any remaining duration is padded with a freeze of the last frame. If the placed clip is longer than the slot, it is trimmed from the start (trimIn advanced) to fit.

**Accepted media types per slot:**
- Photo-only slots: JPG, PNG. Displayed as a static image for the slot duration (Ken Burns may be applied by the template).
- Video-only slots: MP4/H.264, MOV/H.264. Audio is accepted but muted in video slots that carry the template's background music — the template spec defines this per-slot.
- Photo-or-video slots: accept either.

**Slot annotations in the project JSON:**
The `Clip` type is extended with two optional fields for template slots only (no schema version bump required — they are additive optional fields):

```typescript
// Added to Clip (templates only; undefined on regular clips)
templateSlot?: {
  /** Human label shown on the placeholder UI, e.g. "Photo 1 of 4". */
  label: string;
  /** "photo" | "video" | "any". Drives the file-picker accept filter. */
  accepts: "photo" | "video" | "any";
  /** True while sourceAssetId === EMPTY_SLOT_UUID. */
  isEmpty: boolean;
};
```

### 2.5 Empty / Partial-Fill Behaviour

A user may attempt to export without filling all slots. The behaviour is:

| Condition | Behaviour |
|---|---|
| **All slots filled** | Normal export. No warning. |
| **One or more slots empty** | Pre-export: a non-blocking yellow inline warning appears in the export modal: "You have N unfilled slot(s). They will export as a dark placeholder with a 'VideoForge' watermark panel." The user can proceed or go back. |
| **Export with empty slots** | Empty slots render as the placeholder dark panel (same as the canvas preview). The Free watermark is applied as normal to the whole video. The video is still valid and downloadable. |
| **All slots empty** | Same as above. The export modal shows a stronger warning ("No media added yet — your video will show placeholder panels throughout.") but does not block export. |

This is the least-surprising behaviour: the user always gets a valid MP4 and the placeholder preview matches the export (fidelity invariant is maintained because the placeholder render is just a solid-colour canvas frame — no special FFmpeg path needed).

---

## 3. The 5 Templates

All templates: 9:16 vertical, 30–40 s total duration, fit within Free-tier track limits (≤ 3 video / ≤ 2 audio / ≤ 2 overlay / ≤ 1 caption track). Background music is a single CC0 / royalty-free audio clip on the audio track (user cannot swap in this release).

| # | Name | Purpose | Media slots | Text slots |
|---|---|---|---|---|
| 1 | **Happy Birthday** | A warm, personal birthday shoutout — opening title, 4 photo memories, closing wish. 35 s. | 4 photo slots | 3 text overlays (opener name, caption line, closing wish) |
| 2 | **Travel Recap** | A punchy highlights reel from a trip — destination intro, 5 photo/video moments, credits outro. 40 s. | 5 photo-or-video slots | 3 text overlays (destination name, moment label, closing) |
| 3 | **Photo Memories** | A slideshow-style retrospective — 6 photos with a gentle Ken Burns pan, dates or captions, gentle fade outro. 36 s. | 6 photo slots | 2 text overlays (album title, closing) + 1 caption block per photo (6 blocks, text editable) |
| 4 | **Motivational Quote** | A visually bold single-message video — a dramatic background clip, a large centre quote, author attribution, subtle animation. 30 s. | 1 video slot (background) | 2 text overlays (quote text, attribution) |
| 5 | **Simple Promo** | A clean product or service highlight — brand/product name intro, 3 photo/video showcase slots, CTA outro. 38 s. | 3 photo-or-video slots | 4 text overlays (brand name, feature 1, feature 2, CTA) |

**Total media slots across all templates:** 19 · **Total text slots:** 19 (including caption blocks).

---

## 4. Scope Guardrails

### 4.1 What Ships in This Release (Only This)

- The 5 templates listed in §3. No additional templates in this release, however much they are requested.
- The template gallery tab in `NewProjectModal`.
- Placeholder clip UI in the canvas and timeline.
- `templateSlot` field on `Clip` (additive, backward-compatible).
- Empty-slot export path (dark panel render — no new FFmpeg filter; a solid black `color` source covers it).
- Pre-authored project JSON fixtures for all 5 templates, checked in under `apps/api/src/templates/` as static JSON files (served by the API, not stored in the user's workspace).
- CC0 background music for each template (5 short audio clips, stored in S3 as public read, referenced by a well-known asset UUID that is pre-seeded in every workspace — same mechanism as placeholder UUIDs).

### 4.2 Explicitly Out of Scope for This Release

The following items are future scope. Do not build them now; do not design for them now. Collect the requests and bring them to Vera via Atlas.

| Item | Future phase |
|---|---|
| User-uploadable / custom templates | Phase 1 |
| More than 5 templates | Phase 1 (after usage data shows which categories to expand) |
| Template preview as a short looping video (animated thumbnail) | Phase 1 |
| Per-slot style customisation (font, colour, position) | Phase 1 |
| Swapping the template's background music | Phase 1 |
| AI-assisted template suggestion ("pick one based on your media") | Phase 2 |
| 16:9 / 1:1 template variants | Phase 1 (all ship 9:16 only at launch) |
| Template marketplace / community submissions | Phase 2+ |
| Horizontal or square aspect ratios per template | Phase 1 |
| Adding / removing slots from a template | Phase 1 |
| Pro/paid-only templates (no watermark variants) | Phase 1 (requires Stripe billing) |
| Cross-device / mobile template editing | Phase 4 (mobile) |

### 4.3 Invariants That Must Not Be Broken

- **Fidelity invariant:** placeholder slots render identically in preview and export. The dark panel is a solid-colour canvas frame; in FFmpeg it is a `color=c=black:size=WxH:duration=D` source. Preview renders it as a filled rect on the canvas. They match by construction.
- **Free-tier limits:** templates must fit within existing track ceilings. No template may require more than 3 video, 2 audio, 2 overlay, or 1 caption track.
- **Watermark:** the Free watermark applies to all template exports identically to blank-project exports. No exception.
- **Chrome/Edge only:** template gallery uses the same browser gate as the rest of the editor. No changes.
- **No new dependencies:** templates are static JSON + 5 audio files. No new npm packages, no new services, no new DB tables (templates are pre-seeded fixtures, not workspace rows).

---

## 5. Acceptance Criteria

All criteria must be verified by Sentinel (Playwright e2e + manual review) before this feature ships.

### AC-1: Discovery and entry

> **Given** a logged-in user on the Dashboard, **when** they click "New project", **then** the `NewProjectModal` renders two equal-weight tabs: "Start blank" and "Start from a template". The "Start from a template" tab is not the default selection (neither is); either tab can be reached with a single click / keyboard navigation.

### AC-2: Template gallery renders all 5 templates

> **Given** the user has clicked "Start from a template", **then** all 5 template cards are visible without scrolling (at 1280×800 viewport), each showing a thumbnail, name, and one-line description. No search, filter, or pagination UI is present.

### AC-3: Creating a project from a template

> **Given** the user selects any template card and confirms, **then** the editor opens with (a) a project title defaulting to `"<Template Name> — <date>"`, (b) the timeline pre-populated with clips matching the template's slot count, (c) the canvas preview showing all unfilled slots as dark panels with "Drop your photo/clip here" labels, (d) the media library panel empty (no pre-loaded assets).

### AC-4: The `templateId` field is set

> **Given** a project created from a template, **when** the project is fetched via `GET /api/v1/projects/:id`, **then** the response JSON has `templateId` set to the source template's UUID (not `null`). A blank project created from the "Start blank" tab has `templateId: null`.

### AC-5: Filling a media slot

> **Given** an unfilled media slot in the timeline, **when** the user drags an uploaded photo or clip from the media panel onto that slot, **then** (a) the placeholder UI disappears and is replaced by the media thumbnail, (b) the canvas preview shows the media content, (c) the slot's start/end times on the timeline are unchanged, and (d) the `sourceAssetId` on that clip is updated to the placed asset's UUID.

### AC-6: Text overlay editing

> **Given** a pre-authored text overlay in the template, **when** the user clicks the overlay on the canvas or its clip block in the timeline, **then** a text-edit cursor appears allowing the text string to be changed. Font, size, colour, and position controls are not shown (or are shown but disabled with a clear tooltip: "Style is set by the template"). The edited text is saved on blur (or on Ctrl+S auto-save, same as any other edit).

### AC-7: Empty-slot export warning

> **Given** the user clicks Export with one or more unfilled slots, **then** the export modal shows a yellow inline warning listing the count of unfilled slots and the message "They will export as a dark placeholder panel." The Export/Render button remains enabled; the user can proceed or dismiss.

### AC-8: Empty-slot export fidelity

> **Given** the user exports a template project with at least one unfilled slot, **then** (a) the downloaded MP4 renders the unfilled slot(s) as a solid dark panel — identical to the canvas preview — for the slot's full duration, (b) the fidelity invariant holds (no ghost footage, no timing mismatch), (c) the Free watermark is present as normal.

### AC-9: Full fill-and-export round trip (the happy path)

> **Given** a new user with no prior VideoForge experience, **when** they (1) click "New project → Start from a template", (2) pick any template, (3) drag their own photos/clips into all media slots, (4) edit at least one text overlay, and (5) click Export, **then** a watermarked MP4 is downloaded whose duration is 30–40 seconds and whose visual content matches the canvas preview (golden-frame SSIM ≥ 0.985). Median time from step 1 to downloaded MP4 is under 10 minutes.

### AC-10: TTFE gate is not regressed

> **Given** the Templates feature has shipped, **when** the TTFE metric is measured across template-originated projects (cohort: `templateId != null`), **then** median TTFE for template projects is ≤ 8 minutes (tighter than the 10-minute blank-project target, because templates remove the "what do I put here?" decision overhead). If this target is missed, it is escalated to Vera before release.

### AC-11: No fidelity regression on blank projects

> **Given** the Templates feature has shipped, **when** the full golden-frame fixture matrix is run (trim, split, stacking, linked-audio move, speed, color-grade, transform-keyframe, crossfade, burned-in caption), **then** all fixtures pass at the existing SSIM/PSNR thresholds. Templates touch no rendering or export code paths; this is a regression safety net.

### AC-12: Free-tier limits enforced on templates

> **Given** any of the 5 templates, **when** the resulting project is validated against `packages/project-schema`'s `validate()`, **then** it passes JSON Schema validation and track counts are within Free-tier ceilings. This is verified in CI by including all 5 template JSON fixtures in the schema-validation test suite.

### AC-13: Accessibility — keyboard navigation

> **Given** a user navigating with keyboard only, **when** they reach the "Start from a template" tab, **then** they can navigate all template cards with Tab/arrow keys, select a card with Enter/Space, and create the project without using a mouse. All cards have visible focus rings (sky-blue `--vf-selection`), appropriate `aria-label` values, and the gallery is announced as a list region.

---

## 6. Data Model Notes

No schema version bump is required. Changes are:

1. `Clip.templateSlot` (additive optional field) — populated only on clips within a template-derived project. Undefined on all existing and blank projects. See §2.4 for the type definition.
2. `Project.templateId` — already present in the `Project` type. The API's project-create endpoint (`POST /api/v1/projects`) accepts an optional `sourceTemplateId` body parameter; if provided, it deep-clones the template fixture, sets `templateId`, and returns the new project. No new DB table: templates are static JSON fixtures on disk, not workspace rows.
3. **Empty slot sentinel UUID:** `EMPTY_SLOT_UUID = "00000000-0000-0000-0000-000000000000"`. The JSON Schema validator must permit this value for `sourceAssetId` when `templateSlot.isEmpty === true` (add a conditional validation rule). For export, the render worker detects `EMPTY_SLOT_UUID` and substitutes a `color=c=#111111` FFmpeg source. This is the only new code path in the render worker.

**Backward compatibility:** all 5 changes are additive. Existing projects, the existing editor, and the existing golden-frame test fixtures are unaffected.

---

## 7. Open Questions / Decisions Needed

| # | Question | Owner | Notes |
|---|---|---|---|
| Q1 | Who authors the 5 template project JSON fixtures? | Vera + Iris | Iris designs the layout/style; Vera signs off on slot counts and timing. Pixel implements the placeholder UI. The JSONs are hand-authored (no template builder needed for 5 templates). |
| Q2 | Where do the CC0 background music clips come from? | Vera + Core | Must be genuinely CC0 / royalty-free with no attribution requirement. Proposed: Pixabay Music or Free Music Archive. Core pre-seeds their S3 keys as well-known constants. This is a CEO scope-gate item if any licensing cost is incurred. |
| Q3 | Should the template gallery be accessible to unauthenticated users (marketing/landing page)? | Vera + Echo | This spec covers the in-app flow only (post-login). A public preview on the marketing site is future scope (Echo to propose separately). |
| Q4 | Do we track per-template usage analytics? | Vera + Anchor | Recommended: yes, a single `template_project_created` event with `templateId` and `templateName`. Zero-cost addition; Anchor adds it to the existing Sentry events pattern. |

---

## 8. Dependencies & Sequencing

This feature has no hard dependencies on any in-flight MVP work. It can be built in parallel with M4 or immediately after M4 completes, in a dedicated sprint. Estimated effort:

| Owner | Work | Estimate |
|---|---|---|
| Vera + Iris | 5 template designs + JSON fixture authoring | 2–3 days |
| Pixel | Gallery tab in `NewProjectModal`, placeholder clip UI, slot-fill interaction | 2–3 eng-days |
| Core | `POST /api/v1/projects` template-clone path, empty-slot sentinel validation | 1 eng-day |
| Reel | Empty-slot `color` source in render worker | 0.5 eng-days |
| Sentinel | Playwright e2e for AC-3 through AC-9, schema-validation CI for AC-12 | 1 eng-day |

**Total estimated effort:** ~7–8 eng-days + 2–3 design-days.

---

*Spec owner: Vera. Questions via Atlas. Any scope change to the template list or the customisation model is a Scope gate — queue in `company/DECISIONS.md`.*
