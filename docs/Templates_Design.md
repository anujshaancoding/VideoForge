# VideoForge — Templates Feature Design
**Author:** Iris, Head of Design · Zentrix Studio
**Date:** 2026-06-04
**Status:** Implementable spec — ready for Pixel

> This document extends `Design_Instructions_MVP.md` (the source of truth for all tokens, layout constants, and brand rules). Every `--vf-*` token below resolves to that file's §2 definitions. This spec adds no new tokens unless explicitly stated.

---

## Contents
1. [Template Gallery / Picker — New Project Flow UX](#1-template-gallery--picker--new-project-flow-ux)
2. [Media Slot — The In-Editor Placeholder](#2-media-slot--the-in-editor-placeholder)
3. [Visual + Motion Language — Per Template](#3-visual--motion-language--per-template)
4. [Token Addendum — Templates-Specific Values](#4-token-addendum--templates-specific-values)

---

## 1. Template Gallery / Picker — New Project Flow UX

### 1.1 Where Templates Live in the New Project Modal

The existing `NewProjectModal.tsx` shows two sequential decisions: (1) aspect-ratio chooser, (2) project name field. Templates add a **third, optional decision** inserted between them — a collapsible "Start from a template" strip. The structure becomes:

```
┌──────────────────────────── New project ───────────────────────────┐
│                                                                     │
│  Choose an aspect ratio          (nothing pre-selected)             │
│  ┌──────┐  ┌────────────┐  ┌──────┐  ┌──────┐  ┌──────────┐        │
│  │ 9:16 │  │    16:9    │  │ 1:1  │  │ 4:5  │  │  Custom  │        │
│  └──────┘  └────────────┘  └──────┘  └──────┘  └──────────┘        │
│  (reactive hint line)                                               │
│                                                                     │
│  ────────────────────────────────────────────────────────────────   │
│                                                                     │
│  Or start from a template   [optional — collapses if not chosen]    │
│                                                                     │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐       │
│  │ THUMB   │ │ THUMB   │ │ THUMB   │ │ THUMB   │ │ THUMB   │       │
│  │  [9:16] │ │  [9:16] │ │  [9:16] │ │  [9:16] │ │  [9:16] │       │
│  │Birthday │ │ Travel  │ │ Memory  │ │Motivate │ │  Promo  │       │
│  │ 15–30 s │ │ 30–60 s │ │ 20–40 s │ │ 10–15 s │ │ 15–20 s │       │
│  └─────────┘ └─────────┘ └─────────┘ └─────────┘ └─────────┘       │
│                                                                     │
│  Project name (optional)   [ Untitled project ____________ ]        │
│                                                                     │
│                                        [ Cancel ]  [ Create ▸ ]    │
└─────────────────────────────────────────────────────────────────────┘
```

**Rules:**
- If the user selects a template card, the matching aspect ratio tile is **auto-selected** (the template owns a canonical ratio — 9:16 for all five launch templates). The user can still override by clicking a different ratio tile; the template card deselects silently.
- If the user has already chosen an aspect ratio that does not match the selected template, the card shows a soft inline badge: `"Will open at 9:16"` — not a block, not a warning.
- Selecting a template does NOT lock them in. The "Create project" button remains the single commit point. Template is optional; the empty-project path is unchanged.
- The template strip has no scroll at 5 cards. If the library grows beyond 8, it gains a `←` `→` scroll pair (same mechanism as the media panel grid).

---

### 1.2 Template Card Anatomy

Card dimensions at the 5-across grid (inside the modal's `max-w-[600px]`):
- Card width: **100px** (5 cards × 100 + 4 gaps × 8px = 532px — fits the 600px modal with 34px side padding)
- Card height: **164px** (thumbnail 120px + metadata zone 44px)
- Radius: `--vf-radius-lg` = `12px` (matches the "onboarding/empty-state cards" bucket in §2.8)

```
┌────────────────────────┐
│                        │  ← 120px thumbnail area
│     static poster      │
│     image (9:16        │
│     letterboxed to     │
│     the card's 16:9    │
│     region)            │
│                        │
│  [ratio badge: 9:16]   │  ← bottom-left of thumbnail, 2xs label
├────────────────────────┤
│  Birthday              │  ← template name, text-sm font-semibold text-vf-text-primary
│  15–30 s · 3 photos    │  ← meta: duration · slot count, 2xs text-vf-text-tertiary
└────────────────────────┘
```

**States:**

| State | Surface | Border | Treatment |
|---|---|---|---|
| Default | `--vf-surface-2` | `1px --vf-border-subtle` | Static poster image in thumbnail |
| Hover | `--vf-surface-3` | `1px --vf-border-default` | Poster cross-fades to a 3 s **animated preview loop** (CSS-level, no audio, reduced to 0 under `prefers-reduced-motion`). Thumbnail gains a `Play ▶` icon overlay at center, 24×24, `--vf-icon-default` on `rgba(0,0,0,0.40)` pill. Transition: `180ms` `--vf-ease-standard`. |
| Selected | `--vf-surface-3` | `2px --vf-selection` (`#3B9EFF`) | Same animated preview runs. A sky-blue check badge `✓` replaces the play icon overlay. The metadata zone gets a `--vf-accent-subtle` wash behind the name. **Note: the amber accent is NOT used here — selection is always sky-blue.** |
| Focus-visible | — | `--vf-focus-ring` 2px + 2px offset | Keyboard-navigable via arrow keys within the row (roving tabindex, same pattern as the ratio tiles). |
| Disabled (ratio mismatch, if ever added) | — | `opacity: 0.45` | Not used at launch — all 5 templates are 9:16. |

**The ratio badge** (bottom-left of thumbnail, always visible):
- `background: rgba(0,0,0,0.56)` pill
- `border-radius: --vf-radius-pill`
- `padding: 2px 6px`
- `font-size: --vf-text-2xs` (11px), `font-weight: 500`, `color: #F4F6FB`
- Text: `"9:16"` — pure ratio, no prose

**Thumbnail aspect ratio note:** The card itself is nearly square (100×120 thumbnail area) but the template's canonical ratio is 9:16. The thumbnail renders the poster frame **letterboxed** (pillarboxed, technically — narrow vertical content centered inside the wider card thumbnail area), with `--vf-surface-sunken` fill on the side bars. This way the actual composition is visible without distortion, and the card grid stays even.

---

### 1.3 "Start from a template" section header

```
Or start from a template
```

- `font-size: --vf-text-sm` (13px), `font-weight: 500`, `color: --vf-text-secondary`
- Preceded and followed by a hairline `--vf-border-subtle` rule that visually separates the section from the ratio chooser above and the name field below
- No chevron / toggle — the section is always visible when templates exist. It is a soft invite, not a collapsible accordion.
- Screen-reader: `<section aria-labelledby="tpl-heading">` with an `id="tpl-heading"` on the heading, `role="radiogroup"` on the card strip (identical roving-tabindex pattern to the ratio tiles).

---

### 1.4 Create button behavior with a template selected

- Label changes to **"Use template →"** (replaces "Create project") when a template card is selected. Same button, same disabled rules (ratio must be selected — auto-selected by the template, so it is always satisfied when a card is chosen).
- The primary button variant (amber `--vf-accent` fill, `--vf-text-inverse` label) is unchanged — this is still the one primary CTA, no extra amber anywhere.
- On click → `createProject(canvasConfig, templateId)` → navigate to `/editor/:id` with the project pre-filled (media slots on the timeline, text overlays at canonical positions, Ken Burns + crossfade transitions already authored as the template's clip graph).

---

## 2. Media Slot — The In-Editor Placeholder

A media slot is a **placeholder clip on the timeline and canvas** that ships with the template and represents one piece of user-provided media (a photo or video). The user replaces it with their own asset; until they do, the slot shows a visual prompt. This is the core affordance that makes templates feel guided without being rigid.

### 2.1 Slot on the Timeline

A slot is a **video-track clip** in the timeline, identical in shape and interaction to any other clip block — trim handles, drag-to-move, context-menu — but with a distinct visual state:

```
┌────── Slot Clip Block (default unresolved state) ─────────────────────┐
│  [↕ icon] Drop your photo or video here           [slot index: 1 of 3]│
└───────────────────────────────────────────────────────────────────────┘
```

- **Background:** `--vf-surface-2` with a `1px dashed --vf-border-default` border. The dashed border distinguishes it from solid-border real clips.
- **Icon:** `ImagePlus` (Lucide) at `--vf-icon-md` (20px), `--vf-icon-muted` color, centered vertically at left margin.
- **Label text:** `"Drop your photo or video here"`, `text-xs font-medium text-vf-text-tertiary`
- **Slot index badge:** `"1 of 3"`, `text-2xs text-vf-text-disabled`, right-aligned inside the clip block
- **Duration:** fixed by the template (e.g. 5 s for a photo slot, inherits Ken Burns preset). The user cannot extend or shorten below the template-authored min unless they replace the asset with a longer source.
- Once the user drops an asset onto the slot (or clicks it → select a file), the slot resolves to a normal clip — the dashed border is replaced by the standard teal video clip appearance, the placeholder label disappears, and the thumbnail filmstrip renders.

**Slot resolution interaction (two paths):**
1. **Drag from Left Panel:** drag any image or video asset from the media library onto the slot block. The slot highlights with a `2px solid --vf-selection` border as the asset passes over it (drop target affordance). On drop, the asset is trimmed to the slot's duration (or the clip's in-point is used if shorter).
2. **Click the slot block:** opens the system file picker directly (same as a media import, but scoped to replacing this one slot). After selection the slot resolves.

### 2.2 Slot on the Canvas

When the playhead is positioned over an unresolved slot, the canvas preview shows:

```
┌──────────────────────────────────────────────┐
│                                              │
│    ┌──────────────────────────────────┐      │
│    │  [ImagePlus icon 32px]           │      │
│    │  Drop your photo                 │      │
│    │  or video here                   │      │
│    │                                  │      │  ← 9:16 canvas
│    │  Slot 1 of 3                     │      │
│    └──────────────────────────────────┘      │
│                                              │
└──────────────────────────────────────────────┘
```

- The canvas renders the slot as a dark fill (`--vf-surface-sunken` = `#080A0F`) with a centered vertical stack: icon + two-line label + slot index.
- The rounded container inside the canvas: `border: 1px dashed --vf-border-default`, `border-radius: --vf-radius-md`, padding 24px, max-width 70% of canvas width.
- `ImagePlus` icon at 32×32px, `--vf-icon-muted`.
- Label: `"Drop your photo or video here"`, `text-md font-medium text-vf-text-secondary` (16px — large text threshold, stays legible at typical canvas preview size).
- Sub-label: `"Slot 1 of 3"`, `text-sm text-vf-text-tertiary`.
- Any text overlays from the template that are positioned over this slot **render on top** in the canvas preview — the user can read the template's title or caption even before their media is placed. This is the key interaction affordance: text stays, media is a fill-in.
- The canvas selection bounding box (sky-blue 8-handle box) appears when the user clicks the slot on canvas, and right-panel inspector shows a single "Replace media" button (primary ghost variant, NOT amber — amber is reserved for Export).

### 2.3 Resolved Slot

Once resolved, the slot clip behaves entirely as a standard clip:
- Dashed border → solid `1px --vf-border-subtle` (then `2px --vf-selection` if selected)
- Timeline block fills with the video track teal (`--vf-track-video-fill`)
- Thumbnail filmstrip renders at `height - 4px` inside the block
- The Ken Burns effect applied by the template is preserved as keyframes in the clip's transform properties, visible in the right-panel inspector
- The user can remove Ken Burns by clearing the keyframes, but the template default is applied and labeled `"Ken Burns (template default)"` in the inspector for discoverability

---

## 3. Visual + Motion Language — Per Template

All five templates share these **base rules** derived from the brand token system:

**Shared typographic system (in-video text overlays):**
- **Title:** Inter, 700, size calculated as `~6% of canvas height` for 9:16 → 115px at 1920px tall. Tailwind equivalent: `text-5xl` rendered into the canvas via the `drawtext` overlay. Color: `#FFFFFF` with `text_bordercolor=#000000 text_borderw=2` (FFmpeg drawtext shadow, not a design token — this is export params).
- **Body / subtitle:** Inter, 500, `~3.5% of canvas height` → 67px at 1920px tall. Color: `#FFFFFF` or template-specific (see below).
- **Caption text (CC track):** `--vf-text-primary` style, pill blocks (`--vf-radius-pill`), font 14px on a semi-transparent dark pill — standard VideoForge caption rendering, not template-customized.
- Uppercase tracking for display titles: `letter-spacing: 0.04em` (tighter than `--vf-text-3xl`'s `-0.02em` because these render into video canvas, not UI — different legibility context).

**Shared motion defaults:**
- **Ken Burns:** always a slow `zoom-in` (scale 1.0 → 1.12) + subtle pan over the clip duration, implemented via the existing keyframe system on the clip's transform properties. Zoom rate: linear over the clip duration. Pan direction is template-specified (see each template). The keyframe values (x/y/width/height in percent, 0–100) are authored into the project JSON by the template instantiation.
- **Crossfade transitions:** 0.6 s at all clip boundaries by default (`xfade=fade` filter at 600ms). The template pre-authors the `transitionMs: 600` field on each clip boundary in the project schema.
- **Color grade:** handled by the clip's `colorGrade` property (`brightness`, `contrast`, `saturation` as –100–100 sliders per the inspector spec). Values below are relative to the default (0, 0, 0).

---

### Template 1 — Birthday

**Concept:** warm, personal, celebratory — but restrained and editorial, not clip-art. Feels like a well-produced Instagram reel, not a greeting-card template.

**Aspect ratio:** 9:16 (1080 × 1920). Duration: 15–30 s.

**Slots:** 4 photo/video slots (5 s each at default, Ken Burns applied).

**Color treatment:**
- Warm color grade per slot: `brightness: +8, contrast: +12, saturation: +15` — slight warm push, enhances skin tones and golden-hour shots.
- Overlay tint at the beginning (0–2 s): a soft warm vignette gradient overlay on the overlay track: `radial-gradient(ellipse, transparent 40%, rgba(255, 90, 20, 0.28) 100%)`. This is a semi-transparent image overlay clip, not a filter.

**Typography:**
- Title card (slot 1 overlay): `"[Name]'s Birthday"` — Inter 700, all-caps, white, centered, `y: 15%` from top.
- Year sub-label: Inter 400, smaller (50% of title size), `--vf-accent-secondary` color (`#FFC24D`) — the gold secondary brand accent is appropriate here as a decorative in-video element, not a UI control.
- Closing card (after slot 4): `"Make a wish ✦"` — Inter 500 italic, white, centered.

**Ken Burns direction:**
- Slot 1: slow zoom-in from center, no pan.
- Slot 2: zoom-in from bottom-left → drift toward center.
- Slot 3: zoom-in from top-right → drift left.
- Slot 4: slow zoom-in from center, slight upward drift — feels like the climax beat.

**Crossfade:** 0.8 s (slightly longer — softens the celebratory mood). Override `transitionMs: 800`.

**Audio:** The template includes a placeholder audio slot labeled `"Birthday music"` on A1 — unresolved by default, prompts the user to add their own track. The template does not bundle a licensed track.

---

### Template 2 — Travel Recap

**Concept:** cinematic travel montage, landscape-first but also works with vertical clips. Bold title, fast cuts with crossfades, a sense of movement and geography.

**Aspect ratio:** 9:16 (1080 × 1920). Duration: 30–60 s.

**Slots:** 6 photo/video slots (variable duration: first slot 8 s, slots 2–5 5 s each, last slot 7 s). Video slots encouraged — the template's Ken Burns is more dramatic and benefits from motion source material.

**Color treatment:**
- Cinematic grade per slot: `brightness: -5, contrast: +20, saturation: -8` — slightly desaturated, high-contrast. Feels like a Lightroom travel preset.
- A subtle letterbox bars effect on the top and bottom of every slot: two black semi-transparent image overlays at `y: 0, height: 6%` and `y: 94%, height: 6%` on the overlay track. This gives the 9:16 crop a widescreen feel.

**Typography:**
- Opening title: destination name, Inter 800 all-caps, white, centered, with a subtle `drop_shadow` (FFmpeg drawtext `shadowx=3 shadowy=3 shadowcolor=0x00000066`). Positioned at `y: 45%` (center of frame minus letterbox bars).
- Date sub-label: Inter 400, tertiary color (`rgba(255,255,255,0.70)`), `y: 56%`.
- A small country/location tag may float bottom-left (`y: 88%`, `x: 5%`) on individual slots — styled as a pill with dark background and white text. Implemented as a drawtext overlay clip on the overlay track, scoped to the slot's duration.

**Ken Burns direction:**
- Slow but wide lateral pans to suggest travel/movement. Slot 1: left → right. Slot 2: slight zoom-in from right. Slots 3–4: alternating left-right pans (creates natural edit rhythm). Slot 5: upward drift (reveals sky or skyline). Slot 6: slow zoom-out from center — the closing, expansive beat.

**Crossfade:** 0.5 s (snappier cuts suit the energetic travel feel). Override `transitionMs: 500`.

**Audio:** A1 slot placeholder labeled `"Travel music"`. The template authors in a volume envelope that fades in over 1 s at the start and fades out over 2 s at the end (keyframed volume property on the audio clip — the existing inspector's volume envelope system).

---

### Template 3 — Photo Memories

**Concept:** nostalgic, quiet, personal. The most "classic slideshow" of the five — but elevated by deliberate pacing and a consistent visual tone. Works for family milestones, retrospectives, anniversaries.

**Aspect ratio:** 9:16 (1080 × 1920). Duration: 20–40 s.

**Slots:** 5 photo slots (4 s each plus 1 s transition = 25 s base). Photos only — video slots technically work but the template is paced for stills.

**Color treatment:**
- Warm-matte grade: `brightness: +3, contrast: +8, saturation: -12` — desaturated warmth, like old film prints.
- Optionally a very slight grain texture can be suggested in the design brief to the user ("add a grain overlay for a film feel") — but grain is not a current VideoForge capability (color-grade only covers brightness/contrast/saturation). This is a future note, not a shipped spec.

**Typography:**
- Date or occasion label: Inter 600, `y: 8%`, centered, warm white (`rgba(255,248,235,0.92)`) — not pure white, a warm off-white that matches the grade.
- Each slot may carry an optional caption clip on the CC track — the template pre-creates 5 empty caption blocks aligned to each slot's timing so the user only needs to type the text.
- Closing card: `"Some moments stay forever"` — Inter 400 italic, `y: 48%`, warm white. 3 s hold on a black frame at the very end (a 1 s fade-to-black using the last slot's outgoing cross-fade).

**Ken Burns direction:**
- All slots: slow, gentle zoom-in from center. Pan is minimal or absent — the point is calm, not movement. Scale 1.0 → 1.06 over the full duration (more subtle than the 1.12 default). Override the keyframe end-value to `1.06`.
- Slot 4 exception: upward drift, slow, to suggest memory floating upward — the emotional peak.

**Crossfade:** 1.0 s (longest of all five — the slow dissolve is the nostalgic feel). Override `transitionMs: 1000`.

**Audio:** A1 slot placeholder labeled `"Memory music"` with a 1.5 s fade-in and 3 s fade-out.

---

### Template 4 — Motivational Quote

**Concept:** single-idea, high-impact, typographic-first. The media is background atmosphere; the quote is the content. Works as a standalone piece or a series. Clean, confident, no clutter.

**Aspect ratio:** 9:16 (1080 × 1920). Duration: 10–15 s.

**Slots:** 1 video or photo slot (the background). The quote text is the primary content.

**Color treatment:**
- The slot's media is heavily treated to become an atmosphere, not the subject: `brightness: -25, contrast: +15, saturation: -40` — very dark, nearly monochrome, heavily underexposed. The type sits on top and breathes.
- A dark gradient overlay on the overlay track: `linear-gradient(180deg, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0.30) 50%, rgba(0,0,0,0.70) 100%)`. This ensures the quote text always clears contrast regardless of the underlying image.

**Typography:**
- Quote body: Inter 700, `y: 35%`, centered, left-aligned (the typographic choice that reads most deliberately), white, `font-size` ~7% canvas height → 134px at 1920px. Line-height: 1.2.
- Attribution: Inter 400, `y: 62%` (placed below the quote), `rgba(255,255,255,0.65)`, `font-size` ~3% → 58px.
- A thin horizontal rule between quote and attribution: a 1px white line overlay clip, opacity 40%, width 40% of canvas, centered.
- Optional: a 4px vertical rule at the left edge of the quote text block — this is a drawtext overlay approximation and gives the design a "pull quote" editorial look.

**Ken Burns direction:**
- Very slow, barely perceptible zoom-in (scale 1.0 → 1.04 over 12 s). The focus is the text, not the image movement. Drift direction: none (locked center). The calm of minimal motion matches the quote format.

**Crossfade:** No cross-fade to other clips (single slot template). A 0.8 s fade-from-black at the start and fade-to-black at the end, both implemented as FFmpeg fade filters on the single clip (`fade=in,t=0,d=0.8` and `fade=out,t=duration-0.8,d=0.8`). These are authored as clip-level `fadeIn: 800` and `fadeOut: 800` properties in the project schema.

**Audio:** A1 slot placeholder labeled `"Ambient or music track"`. Volume: quiet — the template authors in a volume envelope at 50% (`volume: -0.5` normalized) to not overwhelm the reading experience.

---

### Template 5 — Simple Promo

**Concept:** clean product or service announcement. Bold but not busy. Works for a restaurant special, a pop-up event, a freelance portfolio piece. The user fills in their own branding colors implicitly (by choosing background media that carries their brand).

**Aspect ratio:** 9:16 (1080 × 1920). Duration: 15–20 s.

**Slots:** 2 video or photo slots — an opening scene (8 s) and a closing scene (7 s). Plus 1 logo slot: a 2 s still image slot at the very end for a logo/brand mark (photo slot).

**Color treatment:**
- Clean, neutral grade: `brightness: 0, contrast: +10, saturation: +10` — slight clarity boost, no heavy warming or cooling. The product/service media carries the visual identity.
- A bottom bar overlay: a dark semi-transparent rectangle at `y: 78%, height: 22%` — creates a clean zone for the CTA text so it never fights with the background. This is a solid-color overlay clip on the overlay track.

**Typography:**
- Primary headline: Inter 800, white, centered, `y: 28%`. Size ~7% canvas height → 134px.
- Supporting detail line: Inter 500, white, `rgba(255,255,255,0.85)`, centered, `y: 40%`. Size ~3.5% → 67px.
- CTA text inside the bottom bar: Inter 700, white, centered, `y: 85%`. Size ~4.5% → 86px. This is the "Call to action" slot — the user replaces the placeholder text.
- Closing slide (logo slot): white background clip (solid color, full frame) with the logo image slot centered. Text overlay below logo: Inter 500, dark (`#1A1A1A`), `y: 62%`.

**Ken Burns direction:**
- Slot 1 (opening): slow zoom-in from center. Scale 1.0 → 1.10 over 8 s. Creates energy and focus.
- Slot 2 (closing scene): slow zoom-out from center. Scale 1.10 → 1.0 over 7 s. The reverse zoom creates a satisfying "landing" feeling before the logo card.
- Logo slot: no Ken Burns — static hold. The logo should be crisply still.

**Crossfade:** 0.6 s between slot 1 and slot 2. 0.3 s cut (fast dissolve) from slot 2 into the logo card — snappier, businesslike. Override individual clip boundary `transitionMs` values: slot 1→2 = 600, slot 2→logo = 300.

**Audio:** A1 slot placeholder labeled `"Promo music"` with a 0.5 s fade-in and 1 s fade-out.

---

## 4. Token Addendum — Templates-Specific Values

All values below are additive to `Design_Instructions_MVP.md §2`. No existing token is overridden.

### 4.1 New CSS custom properties (emit on `:root` alongside existing `--vf-*` tokens)

```css
/* ── Templates: slot states ── */
--vf-slot-border:           #3A4357;         /* = --vf-border-default; dashed border on unresolved slots */
--vf-slot-bg:               #080A0F;         /* = --vf-surface-sunken; canvas preview fill for unresolved slots */
--vf-slot-icon:             #8A93A8;         /* = --vf-icon-muted; ImagePlus icon inside slot */
--vf-slot-label:            #8A93A8;         /* = --vf-text-tertiary; "Drop your photo…" label */

/* ── Templates: gallery ── */
--vf-tpl-card-bg:           #1A1F2B;         /* = --vf-surface-2; default card surface */
--vf-tpl-card-bg-hover:     #232A38;         /* = --vf-surface-3; hover/selected card surface */
--vf-tpl-card-border:       #262D3B;         /* = --vf-border-subtle; default card border */
--vf-tpl-badge-bg:          rgba(0,0,0,0.56);/* ratio badge background */
--vf-tpl-badge-text:        #F4F6FB;         /* = --vf-text-primary; ratio badge text */

/* ── Templates: in-video text overlays (for reference in template JSON authoring — not UI tokens) ── */
--vf-tpl-overlay-white:     rgba(255,255,255,1.00);   /* full white title text */
--vf-tpl-overlay-soft:      rgba(255,255,255,0.70);   /* secondary/attribution text */
--vf-tpl-overlay-warm:      rgba(255,248,235,0.92);   /* warm off-white (Photo Memories) */
--vf-tpl-overlay-scrim:     rgba(0,0,0,0.56);         /* bottom bar promo scrim */
--vf-tpl-overlay-vignette:  rgba(255,90,20,0.28);     /* birthday warm vignette */
```

### 4.2 Template card Tailwind classes (reference implementation)

```tsx
// Default state
className="
  flex flex-col rounded-lg border border-vf-tpl-card-border
  bg-vf-tpl-card-bg overflow-hidden
  transition-colors duration-[var(--vf-motion-base)]
  cursor-pointer focus-visible:outline-none focus-visible:ring-2
  focus-visible:ring-[var(--vf-focus-ring)] focus-visible:ring-offset-2
  focus-visible:ring-offset-[var(--vf-surface-4)]
"

// Hover modifier
"hover:border-vf-border-default hover:bg-vf-tpl-card-bg-hover"

// Selected modifier (applied when aria-checked="true")
"border-2 border-vf-selection bg-vf-tpl-card-bg-hover"
```

### 4.3 Slot clip timeline block Tailwind classes

```tsx
// Unresolved slot — on the timeline, replaces the solid TYPE_TINT class
className="
  flex items-center gap-2 rounded-xs
  border border-dashed border-vf-slot-border
  bg-vf-surface-2
  px-2 py-1 h-full w-full overflow-hidden
"

// Label inside the slot
labelClassName="text-xs font-medium text-vf-slot-label truncate"

// Slot index badge (right-aligned)
badgeClassName="text-2xs text-vf-text-disabled ml-auto flex-shrink-0"
```

### 4.4 Ken Burns keyframe values (for template JSON authoring)

These are project-schema values, not CSS tokens. Expressed as `transform` keyframe objects in the project's clip array. The `x/y/width/height` fields are canvas percentages (0–100).

| Template | Slot | t=0 transform | t=end transform | Note |
|---|---|---|---|---|
| All (default) | any | `{x:0,y:0,w:100,h:100}` | `{x:-6,y:-6,w:112,h:112}` | 1.12 zoom-in, centered |
| Photo Memories | all | `{x:0,y:0,w:100,h:100}` | `{x:-3,y:-3,w:106,h:106}` | Subtle 1.06 zoom |
| Photo Memories | slot 4 | `{x:0,y:0,w:100,h:100}` | `{x:-3,y:-6,w:106,h:106}` | Upward drift |
| Motivational Quote | 1 | `{x:0,y:0,w:100,h:100}` | `{x:-2,y:-2,w:104,h:104}` | Barely perceptible 1.04 |
| Simple Promo | slot 1 | `{x:0,y:0,w:100,h:100}` | `{x:-5,y:-5,w:110,h:110}` | 1.10 zoom-in |
| Simple Promo | slot 2 | `{x:-5,y:-5,w:110,h:110}` | `{x:0,y:0,w:100,h:100}` | Zoom-out (reverse) |
| Travel | slot 1 | `{x:0,y:0,w:112,h:112}` | `{x:-12,y:0,w:112,h:112}` | Lateral pan L→R |
| Travel | slot 5 | `{x:0,y:0,w:112,h:112}` | `{x:0,y:-12,w:112,h:112}` | Upward drift |

**Ken Burns transition curve:** Linear interpolation on `x/y` (constant velocity drift). Ease-in-out on `width/height` (the zoom scale) for a more filmic feel. Matches existing keyframe `interpolation: "ease"` on the scale dimension and `"linear"` on position.

### 4.5 Crossfade `transitionMs` override per template

| Template | Default boundary duration |
|---|---|
| Birthday | 800 ms |
| Travel Recap | 500 ms |
| Photo Memories | 1000 ms |
| Motivational Quote | No boundary crossfade — fade-in/fade-out only (`fadeIn: 800, fadeOut: 800`) |
| Simple Promo | 600 ms (slot 1→2) / 300 ms (slot 2→logo card) |

### 4.6 Color grade values per template (authored into each clip's `colorGrade` property)

All values are on the –100 to +100 scale matching the existing inspector spec.

| Template | `brightness` | `contrast` | `saturation` |
|---|---|---|---|
| Birthday | +8 | +12 | +15 |
| Travel Recap | -5 | +20 | -8 |
| Photo Memories | +3 | +8 | -12 |
| Motivational Quote | -25 | +15 | -40 |
| Simple Promo | 0 | +10 | +10 |

---

## Appendix: Design Guardrail Checklist

For Pixel to verify before shipping:

- [ ] Amber `--vf-accent` (#FF7A1A) appears **zero times** in the template gallery or slot UI. Selection is sky-blue `--vf-selection` (#3B9EFF) only.
- [ ] Template card `aria-checked` + `role="radio"` + roving tabindex — same a11y pattern as the ratio tiles.
- [ ] Hover preview loop is gated by `prefersReducedMotion` — no animation runs under `prefers-reduced-motion: reduce`.
- [ ] Slot clip blocks use `border-style: dashed` exclusively — no other clip type should ever be dashed.
- [ ] The `"Use template →"` button label swap is announced via `aria-live="polite"` on the hint line below the grid (same element as the ratio reactive hint).
- [ ] Ken Burns keyframe values are authored into the project JSON at template-create time — the user never sees raw keyframe numbers unless they open the Inspector and click into the transform timeline.
- [ ] Color grade values are per-clip (authored on each slot clip at create time), not global canvas settings — so the user can override grade on any individual slot without affecting others.
- [ ] All five template poster images are static WebP at 200×240px (100×120 CSS px × 2x), served from the same asset origin as the app. No external image CDN dependency for MVP.
