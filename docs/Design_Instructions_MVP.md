# 🎨 VideoForge — MVP Design Instructions

> A precise design brief for the VideoForge MVP (Phase 0). Detailed enough for **Claude design** to produce the actual visual design and for a frontend engineer to implement it. Scoped strictly to the MVP in [MVP_Scope.md](MVP_Scope.md); behaviour refs (`§n`) point at [VideoForge_Spec_v1.1.md](VideoForge_Spec_v1.1.md). Brand and screens are **inspired by Canva's approachability but deliberately NOT a clone** — see §1 for how VideoForge diverges.

**Product decisions baked in:** name = **VideoForge** · New-Project flow leads with an **aspect-ratio chooser and no pre-selected default** (9:16 / 16:9 / 1:1 / 4:5 / custom, surfaced equally) · **Free-tier only — NO "Upgrade to Pro" CTA anywhere**, but exports carry a watermark with a transparent informational note · **dark-theme-first**, Chrome/Edge desktop only (includes the browser-gate screen).

## Contents
1. [Design Principles & Positioning](#1-design-principles--positioning)
2. [Design Tokens](#2-design-tokens)
3. [Information Architecture & Global Layout](#3-information-architecture--global-layout)
4. [Screens — Auth, Dashboard & New Project](#4-screens--auth-dashboard--new-project)
5. [Editor — Canvas / Preview & Transport](#5-editor--canvas--preview--transport)
6. [Editor — Multi-Track Timeline](#6-editor--multi-track-timeline)
7. [Editor — Left Media Panel & Right Inspector](#7-editor--left-media-panel--right-inspector)
8. [Export Modal, Progress, Onboarding & System States](#8-export-modal-progress-onboarding--system-states)
9. [Component Library Inventory](#9-component-library-inventory)
10. [Interaction & Motion Specification](#10-interaction--motion-specification)
11. [Accessibility Design Requirements](#11-accessibility-design-requirements)
12. [Deliverables & Handoff](#12-deliverables--handoff)

---


---

## 1. Design Principles & Positioning

> This part of the design brief sets the north-star, the design principles every later part must serve, and the brand personality/voice. Token values (px, rem, ms, hex, ms-curves) given anywhere in this brief are a **recommended starting system** — a coherent default the designer should feel free to refine, not a frozen spec. Scope is strictly the VideoForge **MVP / Phase-0** (see `docs/MVP_Scope.md`); nothing deferred there is to be designed.

---

### 1.1 North-star

**VideoForge is a browser video editor you can trust to export exactly what you cut.**

Every design decision is in service of one promise the market told us Canva broke: *what you see on the timeline is what lands in the file.* Trimmed-out bad takes never reappear; trimming a clip never scrambles the audio; resolution never silently downgrades. The product's whole defensible wedge is the architectural invariant that **the export is generated from the same project graph the preview renders** (`MVP_Scope.md` §1). The UI's job is to make that invariant *felt* — visible, legible, and reassuring at every step from import to download.

The design north-star, stated as a sentence the team can hold each decision against:

> **"Make a creator confident, in under ten minutes, that the MP4 they download is the timeline they built — and make getting there feel fast."**

Two measurable obligations sit under that star (both from `MVP_Scope.md` §1):
- **Trust** — a human cannot find a timeline edit the export disagrees with. The UI must *show* what will export (the watermark, the burned-in captions, the proxy→source re-link, the pre-flight estimate), never hide it.
- **Time-to-first-successful-export (TTFE)** — median < 10 minutes for a 60-second project, > 70% of first sessions reaching a completed export. The UI must drive a clean import → rough-cut → export funnel with no dead ends.

---

### 1.2 Design principles

Seven principles, ordered by how often they will arbitrate a design decision. When two principles conflict, the lower number wins.

#### 1. The timeline is the hero
VideoForge is a *pro-NLE-feeling* editor, not a slide deck with a play button. The timeline is the primary edit surface and gets the screen budget, the visual polish, and the interaction care to match. It reads as a real multi-track non-linear editor — sticky ruler with `HH:MM:SS:FF` timecode, a draggable red playhead, distinct color-coded track lanes (video / audio / overlay / caption), waveforms on audio clips, thumbnail-sprite filmstrips on video clips — but stays *approachable* (see principle 3). This is the deliberate divergence from Canva's scene-strip model, which reviewers called "too shallow" and "less precise" (`Market_Research.md` themes 1, 9). Design implication: the timeline zone owns a generous default height (≈260px, resizable 180–600px per spec §2.1), the bottom band of the editor, and the highest-fidelity component work.

#### 2. Trust through transparency — show what will export
Because the wedge *is* trust, the UI never hides a consequence of export. Concretely:
- The **mandatory Free-tier watermark** is disclosed plainly in the export modal as information, not an upsell: *"A small VideoForge watermark is added to your export."* (`MVP_Scope.md` §3.8). No "Upgrade to remove" CTA exists anywhere in the MVP.
- The **pre-flight estimate** (file size + render time) is shown before the user commits to a render (§3.8) — the antidote to Canva's silent long-render lockups.
- The **proxy→source re-link** surfaces a clear, non-blocking warning if an original is missing and the proxy would be used — *never* a silent downgrade (§3.8, the explicit counter to Canva's silent 4K→1080p bug).
- **Burned-in captions** are previewed on-canvas exactly as they will render.
- Edit operations that have non-obvious reach (linked-audio split, ripple delete) are visually telegraphed *before* commit (snap line, ripple preview).

#### 3. Approachable density
Borrow Canva's clarity and low-fear onboarding — clean surfaces, generous spacing, plain-language labels, an inviting empty state — while carrying real NLE density (multi-track timeline, keyframes, properties inspector) without the cluttered, intimidating feel of a legacy desktop editor. The rule: **progressive disclosure.** Defaults are simple and visible; depth (keyframe diamonds, color-grade sliders, the volume envelope) reveals itself contextually in the right-panel inspector when an element is selected, and the inspector auto-hides when nothing is selected so the canvas can breathe (spec §2.1). A first-time user should never see a control they don't yet need.

#### 4. Fast feels like a feature
Responsiveness is positioning, not just engineering (`Market_Research.md` theme 2 — the #1 complaint by volume; "3 DAYS vs 3 HOURS"). The design must *advertise and protect* speed:
- Interactions feel instant — UI transitions are short (150–250ms eased; honor `prefers-reduced-motion`, spec §19.9), and nothing important blocks behind a spinner without a skeleton or progress affordance.
- Long/async work (upload, proxy transcode, export) is always **legibly progressing** via the status bar, toasts, and a notification bell — never an opaque wait (`MVP_Scope.md` §3.11).
- The **auto-degraded preview** (drop to quarter-res "Low" under frame-budget pressure) must be a *visible, honest* state ("Preview quality reduced to keep playback smooth"), never a silent stutter (§3.3, §16.2). Degrading legibly is itself a trust signal.

#### 5. Accessible and keyboard-first by construction
The editor targets **WCAG 2.2 AA** for all application chrome (spec §19.1). This is a design constraint from the start, not a retrofit:
- **Contrast is enforced at the token layer** and validated in CI (spec §19.8) — body text ≥ 4.5:1, large text and non-text UI (icons, borders, focus ring, selection box, clip outlines, playhead) ≥ 3:1. No component may opt out. Color is **never the sole signal** — track/clip color-coding always pairs with a label + type icon; mute/solo/lock state always pairs with an icon or text.
- A **2px `:focus-visible` ring with 2px offset** (token `--focus-ring`, ≥ 3:1 on both the element and its background) renders on every focusable element, including canvas-mirror nodes and timeline clips (§19.4).
- **Every drag has a keyboard path** (WCAG 2.5.7) and **targets are ≥ 24×24 CSS px** (2.5.8) — timeline toggles, trim handles, transport buttons. Controls that would shrink below 24px on a collapsed track move into the overflow menu rather than rendering an undersized hit target (§19.3).
- Keyboard bindings are the canonical Section 13 set; the MVP subset is **Space** (play/pause), **S** (split), **Delete / Ctrl+Delete** (delete / ripple), **Ctrl+D** (duplicate), **Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z** (undo/redo), **Ctrl+S** (save), and **← / →** (frame-step) (`MVP_Scope.md` §3.11, spec §13). Design must show these in tooltips and a consistent top-bar help entry point (WCAG 3.2.6).

#### 6. Both orientations, no opinionated default
The MVP launches **vertical and horizontal as equals.** The New-Project flow puts an **aspect-ratio chooser front-and-center** — 9:16, 16:9, 1:1, 4:5, Custom — with **no pre-selected default** and no visual weighting toward any one ratio. (This is the launch decision; it *overrides* the spec's "16:9 default"/"9:16-first" language and the open question in `MVP_Scope.md` §9 — both are resolved here as "let the creator choose, surface both equally.") Design implication: the chooser is a deliberate first decision a creator makes, not a buried setting; the canvas then renders at the chosen fixed ratio with neutral letterbox/pillarbox surround (`#1A1A2E`, editor chrome only, never exported — spec §2.1).

#### 7. Single-user, single source of truth
MVP is single-user (no collaboration, presence, or comments — `MVP_Scope.md` §2). The UI reflects calm, reliable persistence: debounced **auto-save (3s)** + **Ctrl+S** with a clear save-status indicator in the status bar, and **undo/redo** on every edit op. No avatars, no presence cursors, no comment tool, no roles — designing those is out of scope. The trust story here is *durability and reversibility*, not multiplayer.

---

### 1.3 Brand personality & voice

**Personality (4 adjectives):** **Trustworthy · Crafted · Approachable · Quick.**

- **Trustworthy** — the watermark is disclosed, the export is estimated, nothing is hidden. Calm, honest, no dark patterns, no upsell pressure.
- **Crafted** — a pro-NLE feel: precise timecode, real waveforms, tactile snapping. It respects the creator's competence.
- **Approachable** — Canva-grade clarity; a newcomer is never intimidated. Plain words over jargon.
- **Quick** — it *feels* fast, and it says so.

**Voice:** plain, confident, second-person, and specific. Prefer concrete nouns and numbers over marketing adjectives. Never use fear, urgency, or upsell framing (there is no Pro tier to sell in the MVP).

| Situation | Say this | Not this |
|---|---|---|
| Export watermark notice | "A small VideoForge watermark is added to your export." | "Upgrade to Pro to remove the watermark." |
| Pre-export proxy warning | "We couldn't find the original for *clip.mp4* — it'll export from a lower-res preview copy. Re-link to export at full quality." | "Export may be degraded." |
| Empty editor | "Drop a video to start. Import → arrange → export — usually under 10 minutes." | "Get started with your first masterpiece!" |
| Degraded preview | "Preview quality reduced to keep playback smooth. Your export is unaffected." | (silent stutter) |
| Unsupported browser gate | "VideoForge needs Chrome or Edge on desktop. Open this project there to keep editing." | "Your browser is not supported." |
| Save status | "All changes saved" / "Saving…" | "Synced ✓" |

---

### 1.4 Canva-inspired, deliberately distinct

VideoForge borrows what creators *loved* about Canva — approachability, clarity, a frictionless start — and pointedly diverges everywhere Canva broke trust or felt shallow. It must **not** read as a Canva clone: distinct color language, a distinct logo direction, and a more pro-NLE timeline feel (detailed in later parts of this brief; summarized here as positioning).

**Distinctness guardrails (for the designer):**
- **Color language:** do *not* reach for Canva's signature purple/teal gradient identity. VideoForge should own a different, more "editing-suite" palette — a dark-first workspace (see §1.5) with a single confident, *non-purple* accent used sparingly for primary actions, the playhead, and selection. The accent should evoke craft/precision (e.g. a warm "forge" ember or a decisive electric hue) rather than Canva's playful brand purple. (Exact tokens are defined in the Color part of this brief; the only rule here is *not Canva's*.)
- **Logo direction:** lean into the "Forge" half of the name — a mark suggesting craft, shaping, precision (an anvil/spark/cut motif, or a stylized timeline/playhead glyph) — *not* Canva's rounded-square monogram lineage.
- **Timeline feel:** Canva's scene strip vs. VideoForge's true multi-track NLE lane stack is the single biggest visual and conceptual divergence.

| Pattern | What Canva does | What VideoForge does differently |
|---|---|---|
| Onboarding / empty state | Template-gallery-first; nudges you into a pre-made design. | Action-first funnel: an aspect-ratio chooser + "drop a video to start," aimed squarely at TTFE < 10 min. No template marketplace in MVP. |
| Editing model | Scene/page strip; whole-slide animation presets; one audio track with a 20-clip cap. | A real multi-track timeline (Free: 3 video / 2 audio / 2 overlay / 1 caption), per-clip trim/split/ripple, **Audio Link**, and per-property keyframes. The "graduates beyond Canva" feel. |
| Edit → export fidelity | The edit you see can differ from the file (ghost footage, audio desync). | "What you cut is what you get" — export generated from the same JSON graph; the UI *shows* what will export. The core wedge. |
| Brand identity | Playful purple/teal gradient; rounded-square monogram. | Distinct non-purple, craft-forward palette + a "forge" logo direction. Clarity inherited; identity not. |
| Tone & monetization | Frequent Pro upsell; "the perfect element is Pro-only." | No upsell anywhere in MVP. Watermark disclosed as plain information. Calm, no-pressure voice. |
| Surface theme | Light-first canvas/UI. | **Dark-first** workspace (see §1.5) — standard for editing tools, kinder to media judgment and long sessions. |
| Performance posture | Slows/locks up on long projects; silent degradation. | Speed as a feature: proxy-first preview, *visible* progress, *honest* auto-degrade. |
| Resolution / output | Silently downgrades 4K→1080p. | Transparent: MVP caps at 1080p by design and *says so*, with a pre-flight estimate and proxy→source re-link warning. |

Where we mirror a Canva pattern, we mirror only its *clarity* (clean panels, plain labels, low-fear onboarding) — and we say so above so the designer keeps the lineage of clarity without importing the lineage of identity.

---

### 1.5 Dark-first rationale (and where light appears)

**The editor workspace is dark by default.** This is the convention for professional video and motion tools for good reasons that apply directly to VideoForge:

1. **Accurate media judgment.** A dark, neutral surround (`#1A1A2E` per spec §2.1) keeps the eye calibrated to the colors *inside* the canvas — critical for the one color-grade effect and for trusting the preview. A bright UI biases perception of brightness/contrast/saturation.
2. **Reduced fatigue in long sessions.** Editing is sustained, focused work; a dark workspace lowers glare over a multi-hour cut.
3. **Canvas is the focal point.** A dark shell recedes so the (often bright) media content and the timeline read as the figures against the ground — reinforcing principle 1 (timeline is the hero) and a clean canvas focus.

The dark theme is the *default*, but the token system ships **three validated themes** — dark (default), light, and high-contrast — each with CI-validated contrast (spec §19.8). The OS `prefers-contrast: more` query auto-switches to high-contrast; high-contrast additionally raises non-text UI to ≥ 4.5:1.

**Where a light surface legitimately appears in the MVP:**
- **Marketing / pre-app surfaces** and the **auth screens** (signup, login, password reset, Google OAuth) — these set a welcoming, approachable first impression and are not media-judgment contexts. They may be light or a softer surface.
- The **project dashboard** (list / open / create / duplicate) may use a lighter surface than the editor — it is browsing, not editing.
- The **light theme** is user-selectable from inside the editor for those who prefer it, and the **high-contrast theme** for accessibility — both fully supported, both contrast-validated.
- The **browser-gate screen** (Safari/Firefox → "use Chrome/Edge," spec §15.1) is a standalone informational surface and may follow the marketing/auth light treatment.

The rule of thumb for the designer: **dark where the work happens (editor + canvas); lighter, welcoming surfaces where the creator is arriving, choosing, or being informed.**


---

## 2. Design Tokens

This section defines VideoForge's **starting token system** — the atomic design decisions (color, type, spacing, motion, layering) that every component and the "Claude design" pass should build on. Treat every value as a **recommended baseline the designer may refine**, not a frozen contract; the *structure* (token names, layers, the contrast rules) is what must hold. Token names use a `--vf-*` CSS-custom-property convention so they map 1:1 to a Tailwind/Style-Dictionary theme.

**Brand posture (read first).** VideoForge is a dark, "pro NLE" editor that reads as *trustworthy and precise* — the visual proof of the wedge "what you cut is what you get." We borrow Canva's **approachability and clarity** (generous spacing, soft radii on chrome, one clear primary action per surface) but diverge hard on **color and density**:

| Dimension | Canva | VideoForge divergence |
|---|---|---|
| Base UI | Light, airy, white surfaces | **Dark editor** (color-managed neutral surfaces so media color is judged truthfully, like Resolve/Premiere) |
| Brand hue | Purple → cyan gradient | **Single molten-amber/ember accent** (`#FF7A1A` family) on cool slate neutrals — warm "forge" signature, explicitly *not* purple-cyan |
| Density | Roomy, marketing-grade | **Timeline is denser/pro**; chrome stays roomy. Two density registers in one app |
| Selection/state color | Brand purple | **Functional sky-blue selection** (industry-standard NLE bounding box), accent reserved for *brand + primary CTA*, never for routine selection |

> The MVP is **Chrome/Edge desktop only** and ships the **dark theme** as the implemented default. The token *structure* anticipates light + high-contrast themes (required by §19.8), but only dark is built for Phase 0; light/high-contrast are token re-mappings, not new components.

> **Accessibility is enforced at this layer, not per-component (§19.8).** Every `(foreground, background)` pairing named below is chosen to meet **WCAG 2.2 AA**: body text ≥ **4.5:1**, large text (≥24px / ≥18.66px bold) ≥ **3:1**, and non-text UI — borders, icons, focus ring, selection box, playhead, clip outlines — ≥ **3:1** against adjacent color. These ratios are unit-tested in CI; a failing pairing fails the build. Color is **never the sole signal**: track type, mute/solo/lock, and clip source-coding always pair hue with an icon + text label (§19.8, SC 1.4.1).

---

### 2.1 Color — Neutral surfaces & elevation (dark theme)

A cool, slightly blue-leaning neutral ramp. Surfaces step up in lightness as they come *toward* the viewer (elevation = lighter, the standard dark-UI convention). `--vf-surface-canvas-surround` is the non-exported editor letterbox area and is pinned to the spec's `#1A1A2E` (§2.1); the project canvas's own background is a separate, user-configurable value (default `#111111`, §2.2) and is **not** a chrome token.

| Token | Hex | Role | Notes / contrast |
|---|---|---|---|
| `--vf-bg-app` | `#0B0E14` | App backdrop / behind all panels | Deepest layer (z-floor) |
| `--vf-surface-canvas-surround` | `#1A1A2E` | Editor surround around the preview canvas | Pinned by §2.1; chrome only, never exported |
| `--vf-surface-1` | `#12161F` | Panels (left media, right inspector), timeline body | Base panel surface |
| `--vf-surface-2` | `#1A1F2B` | Cards, track headers, list rows, input fields | +1 elevation |
| `--vf-surface-3` | `#232A38` | Menus, popovers, hover state on surface-2, selected rows | +2 elevation |
| `--vf-surface-4` | `#2C3445` | Modals / dialogs, tooltips, top of stack | +3 elevation (pairs with strongest shadow) |
| `--vf-surface-sunken` | `#080A0F` | Wells: timeline ruler trough, waveform/track grooves | Recedes below surface-1 |
| `--vf-border-subtle` | `#262D3B` | Hairline dividers, panel splits | Decorative only (sub-3:1 OK — non-load-bearing) |
| `--vf-border-default` | `#3A4357` | Default control borders, input outlines | ≥ 3:1 vs surface-1/2 (SC 1.4.11) |
| `--vf-border-strong` | `#525E78` | Emphasised borders, focused inputs | ≥ 3:1 |
| `--vf-overlay-scrim` | `rgba(7,9,15,0.64)` | Modal backdrop scrim | Darkens editor behind dialogs (`inert`, §19.4) |

### 2.2 Color — Text & icon (on dark surfaces)

| Token | Hex | Role | Contrast on `--vf-surface-1` (`#12161F`) |
|---|---|---|---|
| `--vf-text-primary` | `#F4F6FB` | Primary body & headings | ~15.8:1 — passes AA/AAA |
| `--vf-text-secondary` | `#B9C2D4` | Labels, secondary copy, inactive tab | ~8.9:1 — passes AA |
| `--vf-text-tertiary` | `#8A93A8` | Hints, timecode minor ticks, placeholders | ~5.1:1 — passes AA (4.5:1) |
| `--vf-text-disabled` | `#5A6273` | Disabled labels | ~2.9:1 — **decorative/disabled only**, never load-bearing info |
| `--vf-text-inverse` | `#0B0E14` | Text on accent / on light fills (e.g. CTA, amber chips) | ≥ 4.5:1 on `--vf-accent` |
| `--vf-icon-default` | `#C4CCDB` | Default icon color | ≥ 3:1 (SC 1.4.11) |
| `--vf-icon-muted` | `#8A93A8` | Secondary/inactive icons | ≥ 3:1 |

### 2.3 Color — Brand & accent (the molten-ember signature)

The distinctive hue. A warm amber→ember that nods to "forge" (molten metal / sparks) and is unmistakably *not* Canva's purple-cyan. Reserved for **brand, the single primary CTA per surface, and brand watermark** — never for routine selection (that is functional blue, §2.5) so the accent stays meaningful.

| Token | Hex | Role | Notes |
|---|---|---|---|
| `--vf-accent` | `#FF7A1A` | Primary brand / primary CTA fill (e.g. **Export**) | Use sparingly; one per surface |
| `--vf-accent-hover` | `#FF8C3D` | CTA hover | Lighter |
| `--vf-accent-active` | `#E66610` | CTA pressed | Deeper ember |
| `--vf-accent-subtle` | `#3A2410` | Tinted accent background (active brand chip, focused field tint) | Dark amber wash |
| `--vf-accent-text` | `#FFB066` | Accent used *as text/icon* on dark surfaces | Lighter tint so text-on-dark clears 4.5:1 (raw `#FF7A1A` text on `#12161F` is only ~4.0:1 — **do not** use the fill hex for small text) |
| `--vf-accent-secondary` | `#FFC24D` | Secondary brand accent / spark highlight (logo gradient end, sparkles) | Warm gold; pairs into a brand gradient with `--vf-accent` |
| `--vf-brand-gradient` | `linear-gradient(135deg, #FF7A1A 0%, #FFC24D 100%)` | Logo mark, splash, onboarding hero | The "molten" gradient; NOT used behind body text |

**Logo direction (brief for the designer — not a finished mark).** A geometric **anvil/wedge "play" glyph**: a forward-cut chevron/triangle (play + "the cut") seated on a flat anvil base, rendered in `--vf-brand-gradient`. The wordmark "VideoForge" in the display font, `--vf-accent` only on the "Forge" syllable or the glyph (keep the lockup mostly monochrome on chrome so it reads on dark). It must **not** resemble Canva's rounded multi-color "C" / aperture; VideoForge's mark is angular, single-warm-hue, and motion-forward. Provide on-dark (default) and on-light variants.

> **Accent ≠ selection.** A reviewer should never confuse "this clip is selected" (sky-blue, §2.5) with "this is the primary action / brand" (ember). This separation is intentional and pro-NLE.

### 2.4 Color — Semantic (status)

Each ships a `-fg` (text/icon on dark), a `-bg` (filled badge — pair with `--vf-text-inverse`), and a `-subtle` (tinted container). All `-fg` values clear 4.5:1 on `--vf-surface-1`/`-2`; status is always paired with an icon + text (§19.8 SC 1.4.1), so the danger/warning hues are not the sole signal.

| Semantic | `-fg` (on dark) | `-bg` (fill) | `-subtle` (container) | Used for |
|---|---|---|---|---|
| Success | `#3FD68C` | `#16A368` | `#10261C` | Export complete, asset ready, save confirmed |
| Warning | `#FFC24D` | `#E0930A` | `#2C2208` | Proxy-downgrade warning, near track limit, unreviewed captions |
| Danger | `#FF6B6B` | `#E03B3B` | `#2E1414` | Upload/export failure, destructive confirm, validation error |
| Info | `#5BB0FF` | `#2D7FF0` | `#0E2138` | Tips, neutral notices, autosave info |

> **Watch the amber clash.** `--vf-accent` (ember) and Warning (gold) live in the same hue family. Keep them apart by **role + saturation**: accent is a saturated orange CTA fill; Warning is a desaturated gold paired with a triangle-alert icon and never used as a button fill. Never put a Warning banner directly adjacent to the Export CTA.

### 2.5 Color — Editor / timeline functional colors

NLE-specific, load-bearing colors. These carry meaning, so each is ≥ 3:1 against its backdrop (§19.8) and **redundantly coded** with icon + label.

| Token | Hex | Role | Spec ref / contrast |
|---|---|---|---|
| `--vf-selection` | `#3B9EFF` | Selection bounding box (canvas 8-handle) + selected clip outline | §2.2 "blue 8-handle box"; ≥ 3:1 vs canvas media *and* track body; handles get a contrasting halo |
| `--vf-selection-halo` | `rgba(11,14,20,0.9)` | 1px dark halo behind selection handles | Keeps box visible over light *and* dark frames (§19.8) |
| `--vf-playhead` | `#FF3B5C` | Playhead vertical line + transport scrubber | §3.1 "red line"; ≥ 3:1 vs track grid (distinct from Danger red so it never reads as "error") |
| `--vf-snap-line` | `#FF8A1F` | Snap indicator (clip edges / playhead / markers) | §3.5 "orange vertical line" |
| `--vf-marker` | `#FFD23F` | Markers (schema-present in MVP, populated Phase 1) | §3.6 default yellow |
| `--vf-workarea` | `#3B9EFF` @ 18% fill, `#3B9EFF` edges | Work-area / loop range bar on ruler | §3.1 blue range bar |
| `--vf-track-grid` | `#161C27` | Per-second grid lines in track body | Subtle, on `--vf-surface-1` |
| `--vf-ruler-tick` | `#6B7488` | Ruler ticks / timecode labels | ≥ 3:1; minor ticks use `--vf-text-tertiary` |

**Track-type colors.** Each track type owns a hue used for the track-header accent, the clip block tint, and the waveform/label. Clips are **always** labelled with a type icon + name so hue is never the only cue (§19.8). The video default of **teal** matches §3.2 ("Default: teal; same source = same color"); per-clip override is allowed via right-click. The amber accent is deliberately **absent** from track colors so brand and content never collide.

| Type | Header/accent | Clip fill (default) | Clip fill (selected) | Notes |
|---|---|---|---|---|
| Video | `#2BC4B0` (teal) | `#16332F` | `#1C443E` + `--vf-selection` 2px outline | §3.2 teal default; source-coded variants cycle through a teal→cyan→indigo→violet ramp, *avoiding* the ember accent hue |
| Audio | `#7C9CFF` (periwinkle) | `#1B2138` | `#23305A` | Waveform path drawn in `#A8BCFF`; muted track desaturates to `#3A4357` + mute icon |
| Caption | `#C58CFF` (orchid) | `#241A33` | `#33244A` | One caption track in MVP (§15.2); pill blocks |
| Overlay | `#FF9EC4` (rose) | `#33212A` | `#4A2F3C` | Text/overlay clips; renders above video |
| Voice-over | `#FF6B6B` (reserved) | — | — | §3.2 red accent; **schema/UI deferred to Phase 1**, listed so the color slot is reserved and won't be reassigned |

> Source-color coding (§3.2): the *same source file* gets the *same* clip color across tracks. Implement as a deterministic hash → palette index over a fixed 8-swatch ramp seeded in the Video/Overlay families above. The ramp must exclude the ember accent and the four semantic hues to prevent false "status" reads.

---

### 2.6 Typography

**Family direction.** A clean, neutral, **variable** geometric-humanist sans for UI (high legibility at the small sizes a dense NLE needs); a **tabular-figure monospace** for all timecode/numeric fields (frame-accurate columns must not jitter). This echoes Canva's friendly sans clarity but is more neutral/technical — no rounded "marketing" personality in the editor chrome.

| Token | Stack | Use |
|---|---|---|
| `--vf-font-sans` | `"Inter", "Inter var", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif` | All UI text, labels, body. Recommended: **Inter** (or **IBM Plex Sans** if a touch more character is wanted) |
| `--vf-font-mono` | `"IBM Plex Mono", "Roboto Mono", ui-monospace, "SFMono-Regular", monospace` | Timecode (HH:MM:SS:FF), frame counts, numeric property fields, zoom % — **must use tabular figures** (`font-feature-settings: "tnum" 1`) |
| `--vf-font-display` | `"Inter", "Inter var", sans-serif` (tight tracking, weight 700/800) | Logo wordmark, onboarding/empty-state headlines |

**Type scale** — modest ratio (~1.2) tuned for UI density, not editorial. Base = `1rem` = **16px**. Sizes in `rem`; line-heights unitless.

| Token | Size (rem / px) | Weight | Line-height | Letter-spacing | Use |
|---|---|---|---|---|---|
| `--vf-text-2xs` | `0.6875` / 11px | 500 | 1.3 | `+0.02em` | Micro-labels, ruler minor ticks, clip badges |
| `--vf-text-xs` | `0.75` / 12px | 500 | 1.4 | `+0.01em` | Track names, captions in editor list, helper text |
| `--vf-text-sm` | `0.8125` / 13px | 400/500 | 1.5 | `0` | **Default UI body** (panels, menus, inspector rows) |
| `--vf-text-base` | `0.875` / 14px | 400 | 1.55 | `0` | Dialog body copy, longer descriptions |
| `--vf-text-md` | `1` / 16px | 500/600 | 1.5 | `0` | Section/panel titles, modal field labels |
| `--vf-text-lg` | `1.25` / 20px | 600 | 1.4 | `-0.005em` | Modal titles, dashboard card titles |
| `--vf-text-xl` | `1.5` / 24px | 700 | 1.3 | `-0.01em` | Empty-state / onboarding subheads (large-text 3:1 tier begins here) |
| `--vf-text-2xl` | `2` / 32px | 700 | 1.2 | `-0.015em` | Hero headline (empty-state funnel, browser gate) |
| `--vf-text-3xl` | `2.5` / 40px | 800 | 1.15 | `-0.02em` | Marketing/splash display only |

**Weights:** `--vf-weight-regular: 400`, `--vf-weight-medium: 500`, `--vf-weight-semibold: 600`, `--vf-weight-bold: 700`, `--vf-weight-extrabold: 800`. Default editor weight is **500** for crispness on dark backgrounds at 13px. Avoid 400 below 13px on dark surfaces (thin strokes lose contrast).

---

### 2.7 Spacing

A strict **4px base** scale. Use the token, not raw px. Most dense timeline/inspector layouts live in the `1`–`4` range; chrome padding (Canva-style breathing room) uses `4`–`8`.

| Token | px | rem | Typical use |
|---|---|---|---|
| `--vf-space-0` | 0 | 0 | Reset |
| `--vf-space-0\.5` | 2 | 0.125 | Hairline gaps, icon-to-label nudges (sub-grid, use rarely) |
| `--vf-space-1` | 4 | 0.25 | Tight inner padding, between dense controls |
| `--vf-space-2` | 8 | 0.5 | Default inner padding (buttons, rows), icon gaps |
| `--vf-space-3` | 12 | 0.75 | Control group gaps, list-row vertical rhythm |
| `--vf-space-4` | 16 | 1 | Panel padding, card padding, modal field spacing |
| `--vf-space-5` | 20 | 1.25 | Section spacing inside panels |
| `--vf-space-6` | 24 | 1.5 | Modal padding, between major panel sections |
| `--vf-space-8` | 32 | 2 | Empty-state / onboarding block spacing |
| `--vf-space-10` | 40 | 2.5 | Large hero/dashboard gutters |
| `--vf-space-12` | 48 | 3 | Page-level gutters, browser-gate centering |

**Layout constants (from §2.1 — pinned, not part of the free scale):** top bar `56px`, transport bar `48px`, status bar `28px`, track-header column `180px`, left panel default `280px` (range 180–420, rail 48), right panel default `300px` (range 240–480), timeline default `260px` (range 180–600). **Minimum interactive target = 24×24 CSS px** (§19.2 SC 2.5.8) or 24px spacing; controls that would shrink below this in a collapsed track move into the overflow menu.

---

### 2.8 Radii

Soft on chrome (the Canva-borrowed approachability), tighter on dense data surfaces (the pro-NLE divergence — timeline clips read sharper/more technical).

| Token | px | Use |
|---|---|---|
| `--vf-radius-none` | 0 | Full-bleed dividers, ruler |
| `--vf-radius-xs` | 2 | Clip blocks, waveform containers, dense data cells (pro/sharp) |
| `--vf-radius-sm` | 4 | Inputs, small buttons, chips, track-header controls |
| `--vf-radius-md` | 8 | Buttons, cards, menu items, panels' inner cards |
| `--vf-radius-lg` | 12 | Modals, popovers, media-library tiles |
| `--vf-radius-xl` | 16 | Onboarding/empty-state cards, dashboard project cards |
| `--vf-radius-pill` | 999 | Caption pill blocks, toggle/segmented controls, status badges |
| `--vf-radius-full` | 50% | Avatars (none in MVP — no collab), circular icon buttons |

### 2.9 Border / stroke widths

| Token | px | Use |
|---|---|---|
| `--vf-stroke-hairline` | 1 | Dividers, default control borders, clip outlines |
| `--vf-stroke-thin` | 1.5 | Waveform path, snap line at low zoom |
| `--vf-stroke-default` | 2 | Selected-clip outline, focus ring, selection box, active tab underline |
| `--vf-stroke-thick` | 3 | Playhead line, drag-target track highlight |

> **Focus ring (§19.4, SC 2.4.7).** `--vf-focus-ring` is a **2px solid** outline at **2px offset**, color `--vf-focus-ring-color: #6FB6FF` (a bright sky-blue chosen to clear ≥ 3:1 on *both* the dark surround `#1A1A2E` and on clip fills, per §19.8). Rendered via `:focus-visible` (keyboard/AT only), never globally removed without replacement. It is a first-class token, not a per-component style.

---

### 2.10 Elevation / shadows

Dark UI leans on **surface lightness** for elevation more than shadow; shadows are subtle and add a faint warm-neutral cast so floating surfaces feel lifted, not cut out. Pair each shadow with the matching `--vf-surface-*` step.

| Token | Value | Pairs with | Use |
|---|---|---|---|
| `--vf-shadow-0` | `none` | surface-1 | Flush panels |
| `--vf-shadow-1` | `0 1px 2px rgba(0,0,0,0.32)` | surface-2 | Cards, track headers, raised rows |
| `--vf-shadow-2` | `0 4px 12px rgba(0,0,0,0.40)` | surface-3 | Popovers, dropdown menus, context menus |
| `--vf-shadow-3` | `0 12px 32px rgba(0,0,0,0.50)` | surface-4 | Modals / dialogs (export modal, custom-size) |
| `--vf-shadow-4` | `0 20px 48px rgba(0,0,0,0.58)` | surface-4 | Onboarding hero / fullscreen overlays |
| `--vf-shadow-focus-accent` | `0 0 0 3px rgba(255,122,26,0.35)` | accent CTA | Soft ember glow on the primary CTA on hover (decorative; the AA focus ring above is separate and always present for keyboard focus) |
| `--vf-shadow-inset-well` | `inset 0 1px 2px rgba(0,0,0,0.45)` | surface-sunken | Timeline trough, input wells |

---

### 2.11 Motion

Quick, confident, never bouncy — a pro tool should feel instant. UI transitions sit in the **120–240ms** band. All durations collapse to `0ms`/`1ms` under `prefers-reduced-motion: reduce` via the `--vf-motion-duration` master token (§19.9), and JS-driven loops (e.g. transition hover-previews in the left panel) are gated by a `prefersReducedMotion` flag. **The user's project playback in the canvas is never governed by these tokens** — reduced-motion affects chrome only, never the media under edit (§19.9).

| Token | Value | Use |
|---|---|---|
| `--vf-motion-instant` | `80ms` | Hover/press feedback, toggle flips, focus ring |
| `--vf-motion-fast` | `120ms` | Tab switch, small popover, button state |
| `--vf-motion-base` | `180ms` | Panel open/close, menu, tooltip, default |
| `--vf-motion-slow` | `240ms` | Modal in/out, drawer, large surface |
| `--vf-motion-deliberate` | `320ms` | Onboarding step transitions only |
| `--vf-ease-standard` | `cubic-bezier(0.2, 0, 0, 1)` | Default enter/exit (most UI) |
| `--vf-ease-decelerate` | `cubic-bezier(0, 0, 0.2, 1)` | Elements entering (menus, toasts in) |
| `--vf-ease-accelerate` | `cubic-bezier(0.4, 0, 1, 1)` | Elements leaving (dismiss) |
| `--vf-ease-emphasized` | `cubic-bezier(0.2, 0, 0, 1.0)` | CTA / brand moments (still non-bouncy) |
| `--vf-motion-duration` | `var(--vf-motion-base)` → `0ms` under `reduce` | **Master gate** all chrome animation references this so reduced-motion is one switch (§19.9) |

> Distinguish from **content-domain** values: keyframe interpolation in the editor uses **Linear / Ease** (§6.5) and is part of the *user's project*, not the UI token system — do not reuse these chrome easings as default keyframe curves.

---

### 2.12 Z-index layers

A small, named scale so stacking is never ad-hoc. Top bar is pinned at **100** per the brief; everything that must sit above it (menus opened from it, modals, toasts) climbs from there.

| Token | z-index | Layer |
|---|---|---|
| `--vf-z-base` | 0 | Panels, timeline, canvas (document flow) |
| `--vf-z-sticky` | 50 | Sticky ruler, sticky track headers, panel splitters |
| `--vf-z-topbar` | 100 | Top bar (pinned by brief), transport bar, status bar |
| `--vf-z-dropdown` | 200 | Dropdowns, select menus, track overflow menus |
| `--vf-z-popover` | 300 | Popovers, color pickers, inspector flyouts |
| `--vf-z-context-menu` | 400 | Right-click context menus (must beat dropdowns/popovers) |
| `--vf-z-tooltip` | 500 | Tooltips (above context menus so a tooltip on a menu item shows) |
| `--vf-z-modal-scrim` | 900 | Modal backdrop / `inert` scrim |
| `--vf-z-modal` | 1000 | Modals & dialogs (export modal, custom-size, confirm) |
| `--vf-z-toast` | 1100 | Toasts / notification bell flyout (above modals so export-done notice is seen) |
| `--vf-z-max` | 2147483000 | Drag ghost / browser-gate full-screen takeover / a11y skip-links on focus |

> ASCII map of how a modal + toast stack over the editor:
> ```
> [ z 1100 ] toast: "Export complete ✓"
> [ z 1000 ] modal: Export settings
> [ z 900  ] ░░░ scrim (editor inert) ░░░
> [ z 100  ] top bar  | transport | status
> [ z 50   ] sticky ruler / track headers
> [ z 0    ] panels · canvas · timeline body
> ```

---

### 2.13 Iconography

| Aspect | Decision |
|---|---|
| Style | **Line / stroked**, geometric, consistent 1.5px stroke at 24px, rounded line caps/joins (subtle warmth, not Canva's heavier filled set). Matches the precise/technical NLE register. |
| Recommended set | **Lucide** (or Phosphor "regular") as the base library — open-license, complete NLE coverage (scissors/split, link/chain, play/pause/skip, volume, captions). Custom-draw only the few NLE-specific glyphs the set lacks (ripple-delete, slip, snap, audio-link "chain", keyframe diamond). |
| Default grid | 24×24px artboard, 1.5px stroke, 2px inner padding → ~20px optical glyph. **Never render below the 24×24 hit target** (§19.2 SC 2.5.8); shrink the visual glyph, keep the target. |
| Sizes | `--vf-icon-sm: 16px` (dense inline, track-header toggles), `--vf-icon-md: 20px` (default UI), `--vf-icon-lg: 24px` (transport, primary actions). |
| Color | `--vf-icon-default` / `--vf-icon-muted` (§2.2); active/selected icons take `--vf-accent-text` or the relevant track-type hue. All icon-only buttons carry an `aria-label` (§19.2 SC 1.1.1). |
| State coding | Icons **reinforce** color state (mute = slashed-speaker + desaturated track; solo = headphone/"S" + highlight; lock = padlock; audio-link = chain). Color is never the only signal (§19.8). |
| Filled exceptions | A *very* small filled set is allowed where line glyphs read poorly at speed: the **play/pause** transport triangle/bars and the **record** dot (record itself is Phase 1, slot reserved). Everything else stays stroked. |

---

### 2.14 Token usage guardrails (summary for the designer + engineer)

- **Accent is precious.** `--vf-accent` (ember) = brand + the one primary CTA per surface (Export) + the watermark mark. It is **not** a selection, hover, or link color. Selection is `--vf-selection` (sky-blue), links/info are `--vf-info`.
- **Dark-on-accent text** must use `--vf-text-inverse`; **accent-as-text on dark** must use the lighter `--vf-accent-text` (the fill hex fails 4.5:1 as small text).
- **Every meaningful color is doubled** with an icon + label (track type, status, mute/solo/lock, source-coding) so the UI is fully usable color-blind and at 3:1 (§19.8, SC 1.4.1).
- **One reduced-motion switch:** all chrome animation references `--vf-motion-duration`; never hard-code transition durations (§19.9).
- **Targets ≥ 24px, focus ring always:** no interactive element ships below the 24×24 target or without the `:focus-visible` ring (§19.2/§19.4).
- **Theme-ready, dark-built:** ship dark only for MVP, but author components against the token *names* so the (CI-validated) light + high-contrast token sets drop in later without component changes (§19.8).


---

## 3. Information Architecture & Global Layout

> **Scope guard.** This part covers VideoForge MVP / Phase-0 only (per `docs/MVP_Scope.md`). It designs the top-level IA and the editor's global layout shell — the *frame* inside which every other part lives. It does **not** design out-of-scope surfaces: no collaboration/presence, no comment tool, no markers/mini-map, no voice-over track, no billing/upgrade screens, no mobile/touch layout, no Safari/Firefox editor (only the gate). Where the spec (`VideoForge_Spec_v1.1.md §2.1`) lists Pro/Business affordances, this section narrows them to the Free-tier-only MVP.
>
> **Token note.** All px / rem / ms / hex / ratio values below are a **recommended starting system** the designer may refine in Part 4 (Design Tokens). They are concrete so the layout sums correctly and the engineer can build immediately; they are not frozen.

---

### 3.1 Brand framing for layout (how VideoForge diverges from Canva)

VideoForge is a **modern, trustworthy, creator-friendly browser video editor**. The layout must *look and feel like a pro NLE you can trust*, not a design tool with a video mode bolted on. The market wedge — **"what you cut is what you get"** — is a *trust* promise; the shell expresses trust through **stability, visible state, and responsiveness**, never through chrome that hides what the engine is doing.

| Pattern we mirror from Canva | How VideoForge **diverges** |
| --- | --- |
| A persistent **left media rail** that you drag assets from. | VideoForge's rail is a flat media library (no template/elements marketplace, no stock). Tabs are editor-functional (Videos / Audio / Images / Text / Captions), not content-store categories. Visual language is **darker, denser, NLE-grade**, not the airy white Canva canvas. |
| **Center stage** with the design/preview centered. | The center is a **fixed-ratio video preview** over a neutral dark surround (`#1A1A2E`), with a dedicated **Transport Bar** beneath it — a timeline-editor convention Canva's scene model lacks. |
| **Top bar** with project name + a primary action top-right. | Same skeleton, but the top-right action is **Export** (not "Share"/"Present"), and there is **no "Upgrade"/Pro CTA anywhere** (Free-tier-only MVP). The status of *trust-critical* background work (auto-save, render) is always visible in a Status Bar — Canva has no equivalent persistent state strip. |
| A right-side **context inspector** that appears on selection. | Same auto-reveal behavior, but framed as a precise **properties inspector** (numeric, NLE-style) rather than style-preset chips. |
| Color & logo | **Distinct color language** (deep indigo/near-black NLE surfaces, a single confident accent — finalized in Part 4; *not* Canva's purple-on-white), and a **distinct logo direction**: a "forge / anvil-spark" mark suggesting precision fabrication of video, wordmark **VideoForge**. This is explicitly **not a Canva visual clone.** |

The defining layout difference: VideoForge gives the **timeline first-class, resizable vertical real estate** (a full multi-track band, not a thin filmstrip), signaling "real editor."

---

### 3.2 Top-level information architecture (auth → dashboard → editor → export)

The MVP is a small, linear app. Five route groups, one happy path (the TTFE funnel: import → rough-cut → export).

```
                          ┌─────────────────────────────┐
   (any route, runs       │  BROWSER GATE (interstitial) │
    first on load) ──────▶│  Safari / Firefox / mobile   │
                          │  → "Use Chrome or Edge"      │
                          └─────────────────────────────┘
                                     │ Chrome / Edge desktop only
                                     ▼
   ┌──────────┐  not authed   ┌──────────────┐   sign in / sign up    ┌──────────────┐
   │  /  root │ ────────────▶ │   /auth      │ ─────────────────────▶ │  /projects   │
   │ redirect │               │  login       │                        │  DASHBOARD   │
   └──────────┘  authed       │  signup      │ ◀──── sign out ─────── │ list/create  │
        │                     │  reset pwd   │                        │  /duplicate  │
        └────────────────────▶│  Google OAuth│                        └──────┬───────┘
                              └──────────────┘                               │ open / create
                                                                             ▼
                                                              ┌──────────────────────────┐
                                                              │  /projects/:id  EDITOR    │
                                                              │  (the global layout grid  │
                                                              │   defined in 3.4–3.10)    │
                                                              └─────────────┬─────────────┘
                                                                            │ Export (top bar)
                                                                            ▼
                                                              ┌──────────────────────────┐
                                                              │  EXPORT MODAL (overlay    │
                                                              │  on editor) → progress →  │
                                                              │  7-day download link      │
                                                              └──────────────────────────┘
```

| Route group | Path(s) | Purpose (MVP) | Layout family |
| --- | --- | --- | --- |
| **Browser gate** | interstitial, any route | Detect WebCodecs-capable Chrome/Edge desktop. Non-supported browsers (Safari, Firefox) **and** small/touch viewports get a clear "Use Chrome or Edge on desktop" screen — never a broken editor. Detail in Part [Empty/Error states]. | Full-screen centered card |
| **Auth** | `/auth/login`, `/auth/signup`, `/auth/reset` | Email+password, Google OAuth sign-in, password reset. No plan picker (single implicit Free workspace). Email verification is deferred. | Full-screen centered card (single column, max ~440px) |
| **Dashboard** | `/projects` | List / open / create / duplicate projects. **Create** launches the New-Project aspect-ratio chooser (3.3). Background work (recent exports) reachable via the notification bell. **No upgrade/billing surfaces.** | App-frame: slim top bar + content grid |
| **Editor** | `/projects/:id` | The core layout grid (3.4). Single-user editing. | The 6-band editor grid |
| **Export** | modal over `/projects/:id` | Format & quality essentials + captions tab + pre-flight estimate + watermark notice; then progress and download. **Not a route** — an overlay/modal on the editor so the user never loses edit context. | Centered modal (`role="dialog"`), focus-trapped |

**IA principles.**
- **One linear spine.** A first-time user goes gate → signup → dashboard → (create, choose ratio) → editor → export with no detours. This *is* the TTFE funnel; the IA must not add steps.
- **Editor is the gravity well.** Everything heavy (export, caption editing, properties) happens *inside* the editor shell as panels/modals, never as a separate page — so context (the timeline you cut) is never lost. This directly serves "what you cut is what you get": the export modal floats over the very timeline it will render.
- **No dead-ends to nowhere.** Deferred concepts (collaboration, billing, AI captions) have **no entry points** in the MVP UI — not greyed-out, simply absent.

---

### 3.3 New-Project flow — aspect-ratio chooser (launch default = "both, no strong default")

Triggered by **Create** on the dashboard. This is the single most brand-defining decision in the IA, so it gets a dedicated step rather than a silent default.

> **PRODUCT DECISION (overrides spec defaults):** The MVP launches with **both aspect ratios surfaced equally and NO pre-selected opinionated default.** This intentionally overrides `§2.2` ("16:9 Default") and the `MVP_Scope.md` "9:16 default" line — the launch posture is neutral. Vertical and horizontal presets sit side-by-side with equal visual weight; the user must pick before the editor opens. (The data model still needs *a* value once chosen — that is the user's selection, not a UI pre-highlight.)

```
┌──────────────────────────── New project ───────────────────────────┐
│  Name  [ Untitled project ____________________ ]                    │
│                                                                     │
│  Choose an aspect ratio          (nothing pre-selected)             │
│                                                                     │
│   ┌──────┐   ┌────────────┐   ┌──────┐   ┌──────┐   ┌──────────┐    │
│   │      │   │            │   │      │   │      │   │  W [    ] │    │
│   │ 9:16 │   │    16:9     │   │ 1:1  │   │ 4:5  │   │  H [    ] │    │
│   │      │   │            │   │      │   │      │   │  Custom   │    │
│   └──────┘   └────────────┘   └──────┘   └──────┘   └──────────┘    │
│   Reels/      YouTube/         IG feed    IG         360–4096px      │
│   TikTok      LinkedIn                    portrait   each side       │
│                                                                     │
│   (Create stays DISABLED until a ratio is chosen)                   │
│                                          [ Cancel ]  [ Create ▸ ]    │
└─────────────────────────────────────────────────────────────────────┘
```

- **Equal weight:** the vertical (9:16, 4:5) and horizontal (16:9) presets share one row, identical card treatment, ordered but **none highlighted**. Each card renders its true proportion as a thumbnail (a 9:16 card is tall, a 16:9 card is wide) so the choice is visual.
- **Custom** is a peer card: width × height px inputs, validated `min 360×360`, `max 4096×4096` (per §2.2); non-standard ratios get a soft inline warning, not a block.
- **Create** is disabled until a ratio is selected — enforcing "no default."
- Diverges from Canva: Canva opens you straight into a doc; VideoForge makes orientation an explicit, equal-footing decision because the canvas frame is load-bearing for the export presets the creator will choose later.

---

### 3.4 Editor global layout grid (§2.1) — the six stacked bands

The editor is a **fixed vertical band layout**: five full-width bands stacked top→bottom, with a **resizable horizontal split** between the Canvas Area and the Timeline Zone. The **root layout never scrolls** — each zone owns its own scroll (3.9).

**Vertical band budget (full-width rows, top → bottom):**

| Band | Height | Resizable? | Role |
| --- | --- | --- | --- |
| **Top Bar** | **56px** fixed | no | Logo/wordmark, project name (inline edit), undo/redo, save state, notification bell, Export CTA. `z-index: 100`. |
| **Canvas Area** | *fills remainder* | yes (via the split below) | Centered fixed-ratio preview over `#1A1A2E` surround. |
| **Transport Bar** | **48px** fixed | no | Play/pause, skip start/end, frame-step, timecode, zoom-to-fit. Centered below canvas. |
| **Timeline Zone** | **260px** default, **180–600px** | **yes** (drag handle on its top edge) | Multi-track timeline: 180px track-header column + scrollable track body. |
| **Status Bar** | **28px** fixed | no | Playhead time, total duration, zoom %, render progress, auto-save status. |

**Canvas Area height is the elastic remainder** (per §2.1, every band subtracted):

```
canvasAreaHeight = viewportHeight
                 − topBar(56)
                 − transportBar(48)
                 − timelineHeight(260 default, 180–600 resizable)
                 − statusBar(28)
```

**Horizontal layout** within the Canvas Area row: a **Left Panel** (media) and a **Right Panel** (context inspector) flank the canvas. The Transport Bar, Timeline Zone, and Status Bar span the **full window width beneath** the side panels (the timeline is intentionally full-width — a pro-NLE signal and a divergence from Canva's narrower scene strip).

#### Full-editor ASCII wireframe

```
┌──────────────────────────────────────────────────────────────────────────────────────┐
│ [▣ VideoForge]   Untitled project ✎          ↶ ↷    ⛁ Saved · ✓        🔔     [ Export ]│  Top Bar 56px (z100)
├─────────────┬──────────────────────────────────────────────────────────┬───────────────┤
│ LEFT PANEL  │                  CANVAS AREA  (fills remainder)            │ RIGHT PANEL   │
│  280px      │                                                            │  300px        │
│ (180–420)   │        surround #1A1A2E (editor chrome, never exported)    │ (240–480)     │
│ ┌─────────┐ │                                                            │ hidden when   │
│ │▶ Videos │ │              ┌────────────────────────┐                    │ nothing       │
│ │  Audio  │ │              │                        │  ◀ fixed-ratio     │ selected      │
│ │  Images │ │              │      video preview      │     preview        │ ┌───────────┐ │
│ │  Text   │ │              │   (e.g. 9:16 or 16:9)   │                    │ │ Inspector │ │
│ │  Caption│ │              │                        │                    │ │ (clip /   │ │
│ ├─────────┤ │              └────────────────────────┘                    │ │  text /   │ │
│ │ [media  │ │                                                            │ │  audio)   │ │
│ │  grid,  │ │                                                            │ │  OR       │ │
│ │  drag → │ │                                                            │ │ Caption   │ │
│ │  to     │ │                                                            │ │ Editor    │ │
│ │  time-  │ │                                                            │ │ mode      │ │
│ │  line]  │‖│                                                          ‖│ │           │ │
│ └─────────┘ │                                                            │ └───────────┘ │
├═════════════╧════════════════════════════════════════════════════════════╧═══════════════┤  ◀ split handle (resize Timeline)
│        ⏮   ◀ ▮ ▶   ⏭      00:00:03:12 / 00:00:42:00            ⤢ fit            Transport 48px │
├────────────────────────────────────────────────────────────────────────────────────────┤
│ TRACK HEADERS │ TRACK BODY  (ruler sticky top · playhead red line · clips · scrolls)      │
│   180px fixed │ ╎0:00      0:05      0:10      0:15      0:20      0:25 ··· (h-scroll)→    │  Timeline Zone
│ ┌───────────┐ │ ▎┃                                                                        │  260px default
│ │V1 🎬 M S 🔒│ │ ▎┃ [■■■ intro.mp4 ■■■][■■ b-roll ■■]                                       │  (180–600,
│ │A1 🔊 M S 🔒│ │ ▎┃ [≈≈ music.mp3 ≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈]                          (v-scroll)↕ │   resizable)
│ │OV 🅣 M S 🔒│ │ ▎┃        [Aa title]                                                      │
│ │CC 💬       │ │ ▎┃ [caption pills · · · ]                                  [zoom ──●── ⤢] │
│ └───────────┘ │ ▎┃                                                                        │
├───────────────┴──────────────────────────────────────────────────────────────────────────┤
│ 00:00:03:12   ·   42 sec total   ·   Zoom 120%   ·   ⛁ All changes saved   ·   ░ idle      │  Status Bar 28px
└────────────────────────────────────────────────────────────────────────────────────────────┘
   ‖ = vertical resize handle (panel width)        ═ = horizontal split handle (canvas/timeline)
```

> The wireframe shows the **Free-tier track set**: V1 (video), A1 (audio), OV (overlay), CC (caption). Free ceilings are 3 video / 2 audio / 2 overlay / 1 caption (3.8). It also shows the Right Panel **present** because a clip is selected; with nothing selected it collapses and the canvas widens (3.6).

---

### 3.5 Left Panel — media library (collapsible)

| Property | Value |
| --- | --- |
| Default width | **280px** |
| Resize range | **180–420px** (drag the right edge) |
| Collapsed state | **48px icon-only rail** (toggle: `Ctrl+Shift+H`, §13.3) |
| MVP tabs | **Videos · Audio · Images · Text · Captions** |
| ARIA | `role="complementary"` `aria-label="Media library"`; tab strip is `role="tablist"`, panes `role="tabpanel"` (§19.5) |

**Tab scope (MVP-trimmed from §2.1).** §2.1 lists "Videos, Audio, Images, Text overlays, Stickers, Captions, Transitions." For the MVP this part **drops Stickers** (image/sticker overlays are deferred per `MVP_Scope §3.6`) and **drops a dedicated Transitions tab** (the only MVP transition — crossfade — is created between two adjacent clips on the timeline, not dragged from a panel; if a future part wants a Transitions affordance it belongs in the right-panel inspector, not the media rail). Result: a clean 5-tab rail.

- Content is a **flat media grid** (thumbnails for video/image, waveform chips for audio). Drag an item onto the timeline; it snaps to the playhead on drop. No search/tags/filters (deferred).
- The **Text** tab seeds drawtext-subset text blocks onto an overlay track; the **Captions** tab is the entry point for importing `.srt`/`.vtt` and hand-authoring caption blocks.
- Collapsing to the icon rail reclaims width for the canvas; the panel remembers its expanded width.

---

### 3.6 Right Panel — context inspector + explicit modes (hidden when nothing selected)

| Property | Value |
| --- | --- |
| Default width | **300px** |
| Resize range | **240–480px** (drag the left edge) |
| Default visibility | **Hidden** — auto-collapses when nothing is selected *and* no explicit mode is open; the canvas expands to fill the freed width. |
| Toggle | `Ctrl+Shift+P` (§13.3) forces it open regardless of selection |
| ARIA | `role="complementary"`; `aria-label` is "Inspector" / "Caption editor" depending on mode (§19.5) |

The Right Panel hosts two kinds of content (per §2.1), reconciled to MVP:

1. **Context inspector (selection-driven).** Reveals automatically when a clip / overlay / text / audio clip is selected, showing its numeric properties — trim, speed, opacity, position %, the single color-grade (brightness/contrast/saturation), per-clip fades + volume envelope, transform keyframes. (Exact controls are designed in later parts; this part only reserves the zone.)
2. **Explicit modes (invoked, not selection-driven).** **Caption Editor** (the start|end|text table). The mode **takes precedence over auto-hide** — it stays open with nothing selected, and selecting a clip while it is open does **not** force the inspector; the user switches via the panel's mode/tab control.

> **MVP trim of §2.1:** §2.1 lists "Export Queue" as a second explicit right-panel mode. The MVP has **no Queue tab** (`MVP_Scope §3.11` defers it); export status is surfaced via the **export modal** and the **notification bell** instead. So the only explicit right-panel mode in the MVP is the **Caption Editor**.

**Auto-hide rule (canonical):**
```
showRightPanel = (somethingSelected AND inspectorRole)
              OR (explicitMode == CaptionEditor)
              OR (userToggledOpen via Ctrl+Shift+P)
```
When `showRightPanel` is false, the canvas claims the panel's width — a direct, satisfying expression of "the editor gets out of your way."

---

### 3.7 Top Bar (56px) and the VideoForge logo/wordmark

Fixed 56px, `z-index: 100`, full width, never scrolls.

```
┌── 56px ──────────────────────────────────────────────────────────────────────────────┐
│ [◣ VideoForge]   Untitled project ✎        ↶  ↷       ⛁ Saved ✓        🔔        [Export]│
│  └ logo+wordmark  └ inline-edit name       undo/redo   save state    bell    primary CTA │
│     (LEFT, home)                                                                (RIGHT)  │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

| Slot | Content (MVP) | Notes |
| --- | --- | --- |
| Far left | **VideoForge logo mark + wordmark** | The logo lives **top-left** in the Top Bar (the conventional "home/brand" anchor) and on the dashboard, auth, gate, and export screens. Clicking it returns to the dashboard (`/projects`). The mark is the "forge-spark" direction (3.1); the wordmark is set in the brand display face (Part 4). It is the app's single, consistent brand anchor — `role="banner"` per §19.5. |
| Center-left | **Project name**, inline-editable `textbox` | Click to rename; commits on blur/Enter. |
| Center | **Undo / Redo** (`↶ ↷`) | `Ctrl+Z` / `Ctrl+Y`·`Ctrl+Shift+Z` (§13.2). |
| Center-right | **Save state** chip | "Saving… / Saved ✓ / Offline" — the trust signal; mirrors Status Bar autosave. |
| Right | **Notification bell** | Upload/processing/export toasts collected here. |
| Far right | **Export** primary CTA | The only top-bar primary action. Opens the export modal (3.10). |

**Explicitly absent from the MVP top bar** (so the engineer does not build them): collaboration/presence **avatars**, any **Upgrade / Pro / billing** control, account-tier badges. A minimal account/sign-out affordance may live behind a small avatar/menu at far right, but it carries **no plan or upsell content.** `3.2.6 Consistent Help` (a shortcuts/help entry point) sits in this bar in a consistent location across screens (§19.2).

---

### 3.8 Timeline Zone (resizable 180–600px) and track-header column

| Property | Value |
| --- | --- |
| Default height | **260px** |
| Resize range | **180–600px** — drag the **horizontal split handle** on the Timeline Zone's top edge (3.9) |
| Track-header column | **180px fixed** (left), per §3.1 |
| Track body | scrollable remainder (right) |
| ARIA | container `role="grid"` `aria-label="Timeline"`; rows `role="row"`; clips `role="gridcell"`; playhead `role="slider"` (§19.5) |

```
┌─ Track headers 180px ─┬─ Track body (sticky ruler · h+v scroll) ─────────────────────────┐
│  V1  🎬  M  S  🔒  ⋮  │ ╎0:00     0:05     0:10     0:15     0:20 ···   (horizontal →)     │
│  A1  🔊  M  S  🔒  ⋮  │ ▎┃ red playhead                                                    │
│  OV  🅣  M  S  🔒  ⋮  │ ▎┃ [clips render here, virtual-scrolled ±200px buffer]            │
│  CC  💬          ⋮  │ ▎┃                                                  (vertical ↕)    │
└───────────────────────┴────────────────── zoom slider 10–2000% · fit ⤢ (bottom-right) ────┘
```

- **Track-header column (180px):** per track — type icon, editable name, **Mute / Solo / Lock** toggles (`role="switch"`), a height drag-handle, and an overflow `⋮` menu. Targets render at **≥ 24×24 CSS px** (§19.2 2.5.8); when a track is shrunk too small, controls fold into the overflow menu rather than rendering undersized.
- **MVP track set = Free-tier ceilings:** **3 video · 2 audio · 2 overlay · 1 caption** (`MVP_Scope §3.2`, `§5`). The editor enforces these and the export honors them. (Spec §3.2's 20/16/10 figures are Pro/Business and are **out of MVP scope.**)
- **MVP-absent track features** (do not build): blend-mode dropdown (Normal-only in MVP), the dedicated **Voice-Over** record track, **Markers/beat** triangles + Markers panel, and the **mini-map** — all deferred. Caption track header shows no AI "Auto-Caption" button (Whisper deferred).
- **Resizing the zone** trades height with the Canvas Area live (the only intra-editor vertical resize); min 180px keeps at least the ruler + a couple of tracks visible, max 600px lets a creator work a dense stack.

---

### 3.9 Resize handles, scroll ownership, and z-order

**Resize handles (three kinds):**

| Handle | Location | Drag axis | Range | Affordance |
| --- | --- | --- | --- | --- |
| Left-panel width | right edge of Left Panel | horizontal | 180–420px (or collapsed 48px) | 4px hit-area, `col-resize` cursor, 2px accent on hover; `role="separator"` `aria-orientation="vertical"` |
| Right-panel width | left edge of Right Panel | horizontal | 240–480px | same treatment, mirrored |
| **Canvas ↔ Timeline split** | top edge of Timeline Zone (full width) | vertical | timeline 180–600px (canvas takes the rest) | 6px hit-area, `row-resize` cursor; `role="separator"` `aria-orientation="horizontal"` `aria-valuenow` (px) |

All handles are **keyboard-operable** (focus the separator, arrow keys nudge; §19.4) and snap-free. Panel widths and timeline height **persist per user** (local) so the workspace is stable across sessions — a trust/responsiveness signal.

**Scroll ownership (the root never scrolls — §2.1):**

| Zone | Scrolls? | Axis & rule |
| --- | --- | --- |
| Root layout | **No** | Fixed band grid; `overflow: hidden`. No global scrollbar ever. |
| Top / Transport / Status bars | No | Fixed height, clip overflow. |
| Left Panel media grid | Yes | **Vertical** only; its own scroll container. |
| Right Panel inspector / caption list | Yes | **Vertical** only; caption table scrolls within the panel. |
| Canvas Area | No | Canvas is *zoomed*, not scrolled (Ctrl+scroll zooms 10–400%); the canvas never clips and is always fully visible. |
| Timeline track body | Yes | **Horizontal** (time) + **vertical** (tracks), synced: horizontal scroll moves ruler + all track bodies together; the 180px header column is **frozen** (does not horizontally scroll). Virtual-scrolled (±200px buffer). |

**Z-order (stacking):** Top Bar `z-index:100` > modals/dialogs (export, confirmations) on a backdrop `z ~1000` (focus-trapped, §19.4) > toasts/notification popover > resize handles on hover > panels and timeline at base. The export modal sits **above** the editor it overlays so edit context is preserved beneath it.

---

### 3.10 Export surface (modal over the editor)

Export is an **overlay on the editor**, not a route (3.2) — opened by the Top Bar **Export** CTA, dismissable back to the exact timeline.

```
┌──────────────── Export ────────────────┐
│  [ Format & Quality ] [ Captions ]      │  ← two tabs only (MVP)
│                                         │
│  Preset:  ( ) TikTok/Reels 9:16         │
│           ( ) Instagram 9:16            │
│           ( ) YouTube 1080p 16:9        │
│  Format:  MP4 · H.264 (only)            │
│  Quality: Auto (CRF 18) · ≤ 1080p       │
│                                         │
│  ⓘ A small VideoForge watermark is      │  ← informational, NOT an upsell
│     added to exports.                   │
│                                         │
│  Estimated size ~24 MB · ~30s to render │  ← pre-flight estimate (trust)
│                                         │
│              [ Cancel ]   [ Export ▸ ]  │
└─────────────────────────────────────────┘
```

- **`role="dialog"` `aria-modal="true"`**, focus-trapped, `Esc` returns focus to the Export CTA (§19.4).
- **Watermark notice is informational, framed as transparency** — "A small VideoForge watermark is added." It is **not** an "Upgrade to remove" CTA (there is no Pro tier in the MVP). This is the only place monetization is even mentioned, and it reads as honesty, reinforcing trust.
- After confirm: the modal hands off to a **progress** state (over WebSocket), then a **7-day download** link; ongoing status also lands in the Top Bar notification bell and the Status Bar render indicator, so the user can keep editing.
- Detailed control design (presets, captions tab, estimate) belongs to the Export part; this part only fixes its **placement, modality, and the watermark-as-information rule.**

---

### 3.11 Desktop breakpoints, min window size, and the browser gate (no mobile)

VideoForge MVP is **Chrome/Edge desktop only** (WebCodecs). There is **no mobile or touch layout** (deferred to Phase 4). Breakpoints therefore tune a desktop editor across monitor sizes; below the floor the user is shown the gate, not a degraded editor.

| Tier | Viewport width | Layout behavior |
| --- | --- | --- |
| **Floor (gate boundary)** | **< 1280 × 720** | Show the **browser/viewport gate** ("VideoForge needs a larger desktop window in Chrome or Edge"). The editor is **not** rendered below this — its bands cannot honor their minimums and still leave a usable canvas. |
| **Compact desktop** | **1280–1439px** | Editor renders. Left Panel defaults to its **collapsed 48px rail** to protect canvas/timeline width; Right Panel auto-hide is more aggressive (only on active selection/mode). |
| **Standard desktop** | **1440–1919px** | Default widths apply (Left 280 / Right 300 / Timeline 260). The reference layout. |
| **Large / wide** | **≥ 1920px** | Extra width flows to the **Canvas Area** (panels stay at their defaults unless the user widened them); ultra-wide does not stretch panels to awkward widths. |

- **Hard minimum window size: 1280 × 720** for the editor. This is the smallest viewport where the 6 bands sum correctly: `56 + 48 + 260(timeline) + 28 = 392` reserved vertically, leaving `≥ 328px` of Canvas Area at 720px tall — enough for a real preview; below that, the gate.
- **Touch / coarse-pointer detection** (e.g. `pointer: coarse`, narrow viewport, or mobile UA): routed to the gate regardless of browser, because the MVP timeline is mouse-precision only.
- **Reduced motion / contrast:** the shell honors `prefers-reduced-motion` (panel/modal transitions collapse to ≤ 50ms, no slide/scale; §19.9) and `prefers-contrast: more` (high-contrast token set; §19.8) at every breakpoint.

---

### 3.12 Layout contract summary (for the engineer)

```
ROOT (100vw × 100vh, overflow:hidden, no scroll)
├─ Top Bar ........... 56px fixed,  z-index 100,  role=banner
├─ MIDDLE ROW (flex, height = remainder)
│   ├─ Left Panel .... 280px (180–420 | 48 collapsed), v-scroll, role=complementary
│   ├─ Canvas Area ... flex:1, zoom-not-scroll, role=main      ← width grows when panels hide
│   └─ Right Panel ... 300px (240–480), hidden-when-empty, v-scroll, role=complementary
├─ Transport Bar ..... 48px fixed,  role=toolbar               ← full width under panels
├─ ══ split handle ══  6px, role=separator (h), keyboard-resizable
├─ Timeline Zone ..... 260px (180–600 resizable),  role=grid   ← full width
│   ├─ Track headers . 180px fixed (frozen, no h-scroll)
│   └─ Track body .... remainder, h-scroll(time)+v-scroll(tracks), virtual ±200px
└─ Status Bar ........ 28px fixed,  role=status (+aria-live host)

Overlays:  Export modal / confirmations  → z ~1000, focus-trapped, role=dialog
           Toasts / notification popover  → above editor, below modals
Gate:      shown < 1280×720 or non-Chrome/Edge or coarse-pointer (replaces editor)
Brand:     VideoForge logo+wordmark top-left of Top Bar (→ /projects), and on
           gate / auth / dashboard / export surfaces — the single brand anchor.
NEVER in MVP: Upgrade CTA · collaboration avatars · comment tool · markers/mini-map
              · voice-over track · blend-mode UI · Export Queue tab · mobile layout.
```

All numeric values are a **recommended starting system** (Part 4 may refine); the **band order, scroll ownership, resize axes, min window size, and the "no default ratio / no upgrade CTA / watermark-as-information" product rules are firm.**


---

## 4. Screens — Auth, Dashboard & New Project

> Scope note: this part covers the three "before-the-editor" surfaces of the VideoForge MVP — **Sign in / Sign up**, the **Project Dashboard**, and the **New Project modal** (the aspect-ratio chooser). All of these are MVP-✅ per `MVP_Scope.md` §3.9 (project dashboard: list/open/create/duplicate) and §3.10 (email+password + Google sign-in, password reset). Everything here is editor-application **chrome**, so it must meet **WCAG 2.2 AA** in full (Spec §19.1) — these screens are not canvas widgets and have no excuse.
>
> **No billing anywhere.** Per the product decision (Free-tier-only at launch, Stripe stubbed), there is **no plan selector, no "Upgrade to Pro" CTA, no pricing table, no seat/collaborator UI** on any screen in this part. The only place tier ever surfaces to the user in the whole MVP is the export modal's informational watermark note (designed in a later part) — not here.
>
> These values are a **recommended starting token system**; the designer may refine exact hex/px/ms within the stated WCAG and layout constraints. Token names (`--surface-*`, `--text-*`, `--focus-ring`, etc.) are the same ones the editor chrome uses (Spec §19.8) — Auth/Dashboard/New-Project must consume the shared design-token layer, never one-off colors.

---

### 4.0 Brand & visual language for these screens

VideoForge's positioning wedge is **trust** — *"what you cut is what you get"* (Market Research themes 1, 5). The pre-editor screens are the first proof point: they must read **fast, calm, and credible**, not busy or salesy. The reference point is **Canva's approachability and clarity** (generous whitespace, big legible type, one obvious primary action per screen) — but VideoForge **diverges deliberately** so it is never mistaken for a Canva clone:

| Dimension | Canva pattern | VideoForge divergence (do this) |
|---|---|---|
| Color | Canva's signature gradient purple→teal, bright/playful | A **darker, "pro NLE" base** — deep indigo-charcoal surfaces (the editor surround is `#1A1A2E`, Spec §2.1). Auth/Dashboard use a slightly lighter dark surface with **one** confident accent. Distinct accent (see token table) — a warm **forge-amber/orange** signal color, evoking "forge" + the orange snap-line already in the timeline (Spec §3.5). Not purple. |
| Logo direction | Rounded, friendly wordmark | A **forge/anvil + play-triangle** monogram, geometric and slightly industrial; squared-off, confident. Pairs the "forge" metaphor (craft, precision) with video (play glyph). Mono-weight, works at 24px in the top bar and as a 32px mark on auth. Direction only — the design tool produces the final mark. |
| Surface | Light-first, white cards | **Dark-first** (matches the editor, so there is no jarring theme flip when you enter a project). Light theme and high-contrast theme also ship (Spec §19.8) but dark is default. |
| Tone of copy | Cheerful, exclamatory | Plain, precise, confidence-building. "Create video" not "Let's make something amazing!". Trust microcopy where it earns its place (see §4.3 New Project). |
| Density | Roomy, consumer | Roomy on auth/empty-state, then **efficient** on a populated dashboard (creators come back to many projects) — closer to a tool than a marketing page. |

**Recommended starting token set** (dark default theme; all `(text, surface)` pairings below are pre-checked to meet the §19.8 ratios — the designer must keep any substitution ≥ 4.5:1 for body text, ≥ 3:1 for large text / non-text UI):

| Token | Value | Use |
|---|---|---|
| `--surface-0` | `#14141F` | App background (auth page, dashboard canvas) |
| `--surface-1` | `#1E1E2E` | Cards, modal body, input wells |
| `--surface-2` | `#2A2A3D` | Hover/raised, card hover, menu |
| `--border-subtle` | `#3A3A50` | Card & input borders (≥ 3:1 vs `--surface-1`) |
| `--text-strong` | `#F4F4F8` | Headings, primary text (≈ 14:1 on `--surface-0`) |
| `--text-muted` | `#A6A6BC` | Secondary text, metadata (≥ 4.5:1 on `--surface-0/1`) |
| `--accent` | `#FF7A3D` | Primary CTA fill, selected state, focus accents (forge-amber) |
| `--accent-text` | `#1A1208` | Text/icon on `--accent` fill (≥ 4.5:1 on amber) |
| `--accent-quiet` | `#FF7A3D` @ 14% | Selected-tile wash, subtle highlights |
| `--focus-ring` | `#7DB4FF` | 2px ring + 2px offset, ≥ 3:1 on every surface (Spec §19.4/§19.8) |
| `--danger` | `#FF5C5C` | Destructive (delete), error text/borders |
| `--success` | `#3FC79A` | Saved/ready confirmations |

**Type & spacing starting scale** (rem on a 16px root): display 2rem/600, h1 1.5rem/600, h2 1.25rem/600, body 1rem/400, small 0.875rem/400, caption 0.75rem/500. Spacing step = 4px (`0.25rem`) base; common gaps 8 / 12 / 16 / 24 / 32. Corner radius: inputs/buttons `8px`, cards `12px`, modal `16px`. Motion: 150–250ms ease for enter/exit, **disabled to ≤ 50ms** under `prefers-reduced-motion` (Spec §19.9). Min interactive target **24×24 CSS px** (Spec §19.2 SC 2.5.8); primary buttons render at 40px height.

**Global chrome shared by Dashboard + New Project (not the editor):** a slim **app header** — 56px tall to match the editor top bar (Spec §2.1) for visual continuity — with the VideoForge logo+wordmark at left and an **account menu** (avatar/initials) at right. The account menu contains only: *Account settings*, *Help / keyboard shortcuts* (a "Consistent Help" entry point in a stable location, Spec §19.2 SC 3.2.6), and *Log out*. **No billing, no plan badge.**

---

### 4.1 Screen: Sign in / Sign up

**Goal:** lowest-friction entry for creators (Market Research: Google sign-in is "lowest-friction for creators", `MVP_Scope.md` §3.10). One column, one obvious action, password reset reachable. JWT + httpOnly refresh cookie is the backing mechanism (Spec §17.1) but is invisible to the user.

**MVP auth surface (✅ only):**
- Email + password **Sign up** and **Log in** (toggle between the two on one screen, not two routes that feel different).
- **Continue with Google** (OAuth2). GitHub OAuth is ⛔ deferred (`MVP_Scope.md` §3.10) — do **not** show a GitHub button.
- **Forgot password** link → reset-request flow (✅). Email **verification** is ⛔ (Phase 1) — sign-up lands the user straight in the dashboard; do not gate on a "verify your email" wall.
- **No** SSO/SAML, **no** MFA setup, **no** plan choice, **no** "single workspace" UI — the Free workspace is created implicitly on first sign-up (Spec §17.3).

**Layout — centered single card on `--surface-0`, max card width 400px:**

```
┌──────────────────────────────────────────────────────────┐
│                                                            │
│                        [▶◭] VideoForge                     │  ← logo+wordmark, 32px mark
│                                                            │
│              ┌────────────────────────────────┐           │
│              │  Log in        ·  Sign up       │           │  ← segmented toggle (tablist)
│              │  ──────────                     │           │
│              │                                 │           │
│              │  [  Continue with Google    ]   │           │  ← provider first (fastest path)
│              │                                 │           │
│              │  ──────────  or  ──────────     │           │
│              │                                 │           │
│              │  Email                          │           │
│              │  [ you@example.com           ]  │           │
│              │                                 │           │
│              │  Password           Forgot?     │           │  ← "Forgot?" only in Log in mode
│              │  [ ••••••••••••           👁 ]  │           │
│              │                                 │           │
│              │  [        Log in            ]   │           │  ← primary, --accent, full width
│              │                                 │           │
│              └────────────────────────────────┘           │
│                                                            │
│       By continuing you agree to the Terms & Privacy.      │  ← --text-muted, small
└──────────────────────────────────────────────────────────┘
```

**Behavior & states:**

| Element | Spec |
|---|---|
| Mode toggle | `role="tablist"` with two tabs (Log in / Sign up), arrow-key navigable (Spec §19.4 Tabs pattern). Switching modes swaps the button label and shows/hides the "Forgot?" link and (in Sign up) a **Confirm password** field. Animate the underline 150ms; instant under reduced-motion. |
| Google button | Full-width, `--surface-1` with `--border-subtle`, Google "G" mark + "Continue with Google". On click → OAuth redirect; show inline spinner + disabled state until redirect. |
| Password field | Type `password` with a **show/hide** toggle (eye icon, `aria-pressed`, ≥ 24×24). Sign up shows a lightweight strength hint (min 8 chars) as helper text via `aria-describedby`. |
| Primary submit | `--accent` fill, `--accent-text` label, 40px tall. Disabled until required fields are non-empty (but never silently — `aria-disabled` + a visible disabled style, not removed from tab order). |
| Loading | On submit, button label → spinner + "Logging in…"; inputs disabled; **idempotent** (block double-submit). |
| Error | Inline, **above the button**, `role="alert"` (`aria-live="assertive"`, Spec §19.7), `--danger`. One message, no stack traces: e.g. "Email or password is incorrect." For Google failure: "Couldn't sign in with Google. Try again or use email." Fields with errors get `aria-invalid="true"` + `aria-describedby` pointing at the message (Spec §19.2 SC 3.3.x). |
| Empty / validation | Required-field and email-format validation on blur and on submit; messages announced, never color-only (icon + text, Spec §19.8). |
| Success | Redirect to **Dashboard**. New sign-up → Dashboard **empty state** (§4.2). |

**Forgot-password sub-flow (✅ reset only):**

```
Request:  Email  [ you@example.com ]   [ Send reset link ]
          → confirmation panel: "If an account exists for that email,
             we've sent a reset link." (same copy whether or not the
             account exists — no account-enumeration leak)

Reset (from emailed link): New password [ •••••••• ]  Confirm [ •••••••• ]
          → [ Update password ] → success toast → return to Log in
```

**Accessibility for §4.1:** single `<main>` landmark; first tab stop is the mode toggle; logical focus order top→bottom; visible 2px `--focus-ring` on every control (Spec §19.4); the whole form usable keyboard-only; errors are `role="alert"`. No keyboard traps. Respects `prefers-reduced-motion` for the toggle animation.

---

### 4.2 Screen: Project Dashboard

**Goal:** the creator's home — see your projects, get back into one fast, and start a new one. Backed by `GET /api/v1/projects` (Spec §11/§14.1). This is the funnel surface for **TTFE** (`MVP_Scope.md` §1) so the path to "new project → editor" must be one click and unmissable.

**Layout — app header (§4.0) + content area on `--surface-0`:**

```
┌────────────────────────────────────────────────────────────────────────────┐
│ [▶◭] VideoForge                                                   [ ◑ AS ▾ ] │  ← 56px header, account menu
├────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  Your projects                              [ 🔎 (deferred) ]  [ + New ▸ ]   │  ← H1 + primary CTA
│                                                                              │
│  ┌───────────────┐  ┌───────────────┐  ┌───────────────┐  ┌───────────────┐ │
│  │ [+]           │  │ ┌───────────┐ │  │ ┌───────────┐ │  │ ┌───────────┐ │ │
│  │  New          │  │ │ thumbnail │ │  │ │ thumbnail │ │  │ │ thumbnail │ │ │
│  │  project      │  │ │   16:9    │ │  │ │   9:16    │ │  │ │    1:1    │ │ │
│  │               │  │ └───────────┘ │  │ └───────────┘ │  │ └───────────┘ │ │
│  │  (create      │  │ Summer promo  │  │ Q3 reel    ⋯  │  │ Logo sting ⋯  │ │
│  │   tile)       │  │ 16:9 · 2h ago │  │ 9:16 · 1d ago │  │ 1:1 · 3d ago  │ │
│  └───────────────┘  └───────────────┘  └───────────────┘  └───────────────┘ │
│                                                                              │
│  ┌───────────────┐  ┌───────────────┐  ...                                  │
│  │      ...       │  │      ...       │                                       │
└────────────────────────────────────────────────────────────────────────────┘
```

- **Responsive grid**, min card width ~240px, `auto-fill`, 16–24px gutters. Desktop-only target (Chrome/Edge), so 2–5 columns by viewport; no mobile/touch layout (⛔ per scope). The grid reflows but is not a touch UX.
- **First tile is a persistent "New project" create-tile** (dashed `--border-subtle`, `+` glyph), so creating is always one click even when the grid is full — and it is the **only** create entry besides the header `+ New` button. (This mirrors Canva's "create" tile; VideoForge diverges by keeping it visually quiet/utilitarian rather than a hero gradient, because the *aspect-ratio chooser* — §4.3 — is where the real start-of-project decision lives.)
- Both `+ New` and the create-tile open the **New Project modal (§4.3)**.

**Project card anatomy:**

| Part | Spec |
|---|---|
| Thumbnail | Project poster frame, letterboxed to the card on `--surface-2` so a 9:16 thumb and a 16:9 thumb both sit cleanly in the same card footprint (no cropping that hides content). If no frame yet (just created, never edited) show a neutral placeholder with the aspect outline. Lazy-loaded. |
| Aspect badge | Small pill, bottom-left of thumb or in the meta row: `16:9` / `9:16` / `1:1` / `4:5` / `W×H`. **Redundant with an aspect glyph** (a proportional rectangle outline), so it is not color/text-only (Spec §19.8 SC 1.4.1). |
| Title | `--text-strong`, single line, ellipsis on overflow; inline-rename on double-click or via the ⋯ menu. |
| Updated-at | `--text-muted`, relative ("2h ago", "yesterday"), exact timestamp in `title`/tooltip. From `updatedAt` (Spec §11.1). |
| ⋯ overflow menu | Per-card actions: **Open**, **Rename**, **Duplicate**, **Delete**. Keyboard: focus card → `Enter`/`Space` opens; `Menu`/`Shift+F10` opens the overflow menu (Spec §19.3). |
| Whole-card click | Opens the project in the editor. Hover raises to `--surface-2` with a subtle 150ms lift (reduced-motion: no transform, just border highlight). |

**Card actions (all ✅ per `MVP_Scope.md` §3.9):**

| Action | Behavior |
|---|---|
| **Open** | Navigate to the editor for that project id. Card shows a brief loading state on click. |
| **Create** | Via New-project tile / `+ New` → §4.3 modal. |
| **Duplicate** | `POST` a copy (server-side full-document copy). New card appears at the front of the grid with title "{name} (copy)"; announce "Project duplicated" (`aria-live` polite). Directly counters Canva's removed page-duplication pain (Market Research theme 6) — surface it prominently in the menu. |
| **Rename** | Inline editable title (`textbox` on activation), commit on `Enter`/blur, cancel on `Esc`. Sanitized (Spec §17.4). |
| **Delete** | Opens a **confirm dialog** (destructive, focus-trapped, `Esc` cancels and returns focus — Spec §19.4): "Delete '{name}'? This can't be undone." Confirm button is `--danger`. On success the card animates out (instant under reduced-motion); announce "Project deleted." No undo in MVP, so the confirm step is mandatory. |

**Sorting/search:** sort by **updated-at, newest first** (no sort control needed in MVP). The 🔎 search field is **deferred (⛔ Phase 1, `MVP_Scope.md` §4.3 library search)** — show it only if trivially free; default is to **omit it** for MVP to avoid implying filter features that don't exist. Pagination: simple "Load more" or infinite scroll if the count is large; not a concern at MVP volumes.

**Dashboard states:**

```
EMPTY (new user, zero projects) — the TTFE on-ramp
┌────────────────────────────────────────────────────────────────────────────┐
│ [▶◭] VideoForge                                                   [ ◑ AS ▾ ] │
├────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│                         [ illustration: anvil + ▶ ]                          │
│                                                                              │
│                       Create your first video                                │
│         Import footage, cut it on a real multi-track timeline, and           │
│         export an MP4 that matches your edit exactly — what you cut          │
│                          is what you get.                                    │  ← trust wedge copy
│                                                                              │
│                       [   + New project   ]                                  │  ← single big --accent CTA
│                                                                              │
└────────────────────────────────────────────────────────────────────────────┘
```

| State | Design |
|---|---|
| **Empty** | One centered hero block: short headline, one trust-anchored sentence (the wedge — Market Research theme 1), and a single `--accent` "+ New project" CTA → §4.3. No tips carousel, no template gallery (⛔ templates out of scope). This is the start of the import→export onboarding funnel (`MVP_Scope.md` §3.11). |
| **Loading** | While `GET /api/v1/projects` is in flight, show **skeleton cards** (4–8 shimmer placeholders matching card dimensions). Shimmer is a motion effect → static dim placeholder under `prefers-reduced-motion`. The "New project" create-tile renders immediately (does not depend on the fetch) so the user can start even before the list resolves. |
| **Error** | If the fetch fails: a centered inline panel (`role="alert"`), `--danger` accent, "Couldn't load your projects." + **Retry** button. Do **not** wipe the create-tile — the user can still start a new project. Network/transient only; no scary detail. |
| **Per-card busy** | Duplicate/delete in progress → that card shows an overlay spinner + disabled menu; announced politely. |

**Accessibility for §4.2:** landmarks — `banner` (header), `main` (project grid), `complementary` not needed here. The grid is a `role="list"` of `role="listitem"` cards (simple list, **not** the editor's timeline grid). Cards are reachable by `Tab`; the create-tile is the first item. Overflow menus follow the menu-button pattern (`aria-haspopup`, `aria-expanded`, arrow-key item navigation, `Esc` closes and restores focus). All targets ≥ 24×24. Visible focus ring on cards, menu items, and the CTA. Relative timestamps expose the absolute time to AT via `title`/`aria-label`.

---

### 4.3 Screen: New Project modal — the aspect-ratio chooser (the hero)

**This is the single most important pre-editor decision in the MVP**, and per the product launch default it is the hero of the flow: **"both aspect ratios, no strong default."** The modal presents 9:16, 16:9, 1:1, 4:5, and Custom as **equally-weighted, proportional preview tiles with NO pre-selected default.** Vertical and horizontal are surfaced with equal prominence. Selecting a ratio (plus an optional title) **creates the project** and drops the user into the editor.

> **Important divergence from the spec & legacy scope text.** `VideoForge_Spec_v1.1.md` §2.2 lists **16:9 as the canvas default** and parts of `MVP_Scope.md` say "default new project = vertical 9:16." The **authoritative launch decision overrides both**: the New-Project flow has **no pre-selected default** and treats vertical and horizontal presets equally. The 9:16 / 16:9 / 1:1 / 4:5 ratios, their logical resolutions, and the custom min/max bounds are taken straight from Spec §2.2 (see table below); only the *defaulting* changes. The chosen ratio sets `canvasConfig` (`width`, `height`, `aspectRatio`) on the new project (Spec §11.1 / §11.5; `MVP_Scope.md` §5 CanvasConfig).

**Why a modal, not a route:** keeps the user in dashboard context, is fast, and matches the focus-trapped dialog pattern the editor already uses for Export/Custom-canvas (Spec §19.4). It opens from both the dashboard create-tile and the `+ New` header button.

**Layout — centered modal, ~560–640px wide, `--surface-1` body, 16px radius, dimmed `inert` backdrop (Spec §19.4):**

```
┌──────────────────────────────────────────────────────────────────┐
│  New project                                                  [✕]  │  ← title (dialog heading) + close
├──────────────────────────────────────────────────────────────────┤
│  Choose an aspect ratio                                            │  ← group label (the hero question)
│                                                                    │
│   ┌────────┐   ┌──────────────┐   ┌──────────┐   ┌────────┐        │
│   │        │   │              │   │          │   │        │        │
│   │  9:16  │   │     16:9     │   │   1:1    │   │  4:5   │   ┌────┐ │
│   │        │   │              │   │  ┌────┐  │   │        │   │ ▦  │ │
│   │ Vert.  │   │  Horizontal  │   │  └────┘  │   │ Port.  │   │Cust│ │
│   │        │   └──────────────┘   │  Square  │   │        │   └────┘ │
│   └────────┘                      └──────────┘   └────────┘        │
│   TikTok·Reels   YouTube·desktop    IG feed       IG portrait      │  ← platform hints, --text-muted
│                                                                    │
│   (no tile pre-selected — nothing is highlighted on open)          │
│                                                                    │
│  Project name (optional)                                           │
│  [ Untitled project                                            ]   │
│                                                                    │
│                                   [ Cancel ]   [ Create project ]  │  ← Create disabled until a tile chosen
└──────────────────────────────────────────────────────────────────┘
```

**The tiles are PROPORTIONAL previews** — each tile's inner rectangle is drawn at the *true aspect ratio* so the shape is the information. The 9:16 tile is a tall rectangle, the 16:9 tile a wide one, etc. They share a common bounding area (so a tall 9:16 and a wide 16:9 occupy comparable visual weight — **neither is bigger or first-among-equals**). Equal prominence is the explicit requirement: do not order them so horizontal "leads," and do not make any tile larger.

| Ratio | Logical resolution (sets `canvasConfig`) | Tile label | Platform hint |
|---|---|---|---|
| **9:16** | 1080×1920 | Vertical | TikTok · Reels · Shorts |
| **16:9** | 1920×1080 | Horizontal | YouTube · desktop |
| **1:1** | 1080×1080 | Square | Instagram feed |
| **4:5** | 1080×1350 | Portrait | Instagram portrait |
| **Custom** | W × H input | Custom | (your size) |

*(Resolutions per Spec §2.2. Free-tier export caps at 1080p — `MVP_Scope.md` §3.8 — which all five logical sizes already satisfy, so there is no plan-related disablement to show here. No tier messaging in this modal.)*

**Selection model & states:**

```
TILE — three visual states (radiogroup; arrow keys move selection)

  Unselected (default, on open ALL tiles are here):
   ┌──────────┐
   │  16:9    │   --surface-1, --border-subtle, --text-strong label
   └──────────┘

  Hover / focus:
   ┌══════════┐
   ║  16:9    ║   --surface-2, 2px --focus-ring on keyboard focus
   └══════════┘

  Selected (after click / Enter):
   ┌──────────┐
   │  16:9 ✓  │   2px --accent border, --accent-quiet wash, check glyph
   └──────────┘   (check + border = not color-only, §19.8 SC 1.4.1)
```

| Element | Spec |
|---|---|
| Tile group | `role="radiogroup"` `aria-label="Aspect ratio"`. Each tile is `role="radio"` with `aria-checked`. **On open, none is checked** (`aria-checked="false"` on all) — this is the explicit "no default" requirement. Roving tabindex; `←/→/↑/↓` move the roving focus across tiles; `Space`/`Enter` selects (Spec §19.4 radiogroup behavior). |
| First focus on open | Focus the **dialog heading or the first tile** (Spec §19.4) — but selecting nothing. The user must make a deliberate choice (the whole point of "no opinionated default"). |
| Selecting a tile | Sets the pending choice and enables **Create project**. Selecting a non-Custom tile collapses any open Custom inputs. Double-clicking a tile (or `Enter` on a focused tile when one is already chosen) may **create immediately** as a power-user shortcut, but the explicit Create button remains the primary path. |
| **Custom** tile | Selecting Custom reveals **Width × Height** numeric inputs inline (expand below the tile row, animated 150ms / instant under reduced-motion). Bounds per Spec §2.2: **min 360×360, max 4096×4096**. Validate on input/blur: out-of-range or empty → `aria-invalid`, inline message via `aria-describedby`, and **Create disabled**. Show the computed ratio as a live hint ("≈ 2.39:1 — cinematic") and a gentle, non-blocking note if non-standard for social ("Unusual ratio for social — that's fine"). The Custom preview rectangle updates live to the entered W:H. |
| Project name | Optional text input, defaults to placeholder "Untitled project"; if left empty, the created project is titled "Untitled project". Sanitized (Spec §17.4). Not required — name must never block the fast path to the editor. |
| Create button | `--accent`, `aria-disabled="true"` until a ratio is chosen (visible disabled style, kept in tab order). On click: `POST /api/v1/projects` with the chosen `canvasConfig`; button → spinner + "Creating…"; idempotent (block double-submit). |
| Cancel / close | `Cancel`, `[✕]`, backdrop click, and `Esc` all dismiss and **return focus to the trigger** (create-tile or `+ New`) per Spec §19.4. No data is created on cancel. |

**Modal states:**

| State | Design |
|---|---|
| **Default (open)** | All five tiles rendered, **none selected**, Create disabled, name field empty with placeholder. The hero question "Choose an aspect ratio" is the first thing read. |
| **Selected** | One tile in selected state; Create enabled. (Custom: also requires valid W×H.) |
| **Loading (creating)** | After Create: tiles + inputs disabled, Create shows spinner; the modal stays mounted (focus retained on the button) until the server returns the new project id, then navigate to the editor. Announce "Creating project…" politely. |
| **Error** | If `POST` fails: inline `role="alert"` panel inside the modal (above the buttons), `--danger`, "Couldn't create the project. Try again." Re-enable tiles + Create; preserve the user's selection and name (never lose their choice). Validation errors (Custom out-of-range) are field-level and block Create rather than firing a server call. |

**Accessibility for §4.3:** full focus-trap dialog — `role="dialog"`, `aria-modal="true"`, `aria-labelledby` (the "New project" heading), backdrop `inert`/`aria-hidden`, `Esc` escapable, focus returned to trigger (Spec §19.4, satisfying SC 2.1.2). The tile set is a proper `radiogroup` so a screen-reader user hears "Aspect ratio, radio group, 9:16 vertical, not checked, 1 of 5". Live region announces selection and the live custom ratio. All tiles and controls ≥ 24×24 with visible `--focus-ring`. No reliance on color: selected = border + check + `aria-checked`; aspect = proportional shape + text label. Reduced-motion disables tile/expand transitions.

---

### 4.4 Browser gate (Chrome/Edge only)

Per `MVP_Scope.md` §3.11 / Spec §15.1, VideoForge is **Chrome/Edge desktop only** for MVP (WebCodecs single decode path). Safari/Firefox/mobile users must get a **clear gate, not a broken editor**. This gate is part of the pre-editor surface, so it is specified here.

**When it shows:** on app load, detect the browser/engine. If not a supported desktop Chromium (Chrome 110+ / Edge 110+ per Spec §15.1), render the gate **instead of** the editor. Auth and Dashboard themselves are simple enough to allow on any browser, but **entering a project / the editor** is gated. (Recommended: allow sign-in + dashboard everywhere so the user isn't fully locked out of their account, but block the editor with the gate. The designer may simplify to "gate the whole app" if that is cheaper — either way the message is the same.)

```
┌────────────────────────────────────────────────────────────────┐
│                      [▶◭] VideoForge                             │
│                                                                  │
│              [ icon: browser window + checkmark ]                │
│                                                                  │
│        VideoForge works best in Chrome or Edge                   │
│                                                                  │
│   VideoForge's real-time preview uses browser video tech         │
│   (WebCodecs) that Safari and Firefox don't fully support yet.   │
│   Open VideoForge in Chrome or Microsoft Edge on desktop for     │
│   the full editor.                                               │
│                                                                  │
│        [ Copy link ]     [ Get Chrome ↗ ]   [ Get Edge ↗ ]       │
│                                                                  │
│   On mobile? The MVP is desktop-only — use a laptop or desktop.  │
└────────────────────────────────────────────────────────────────┘
```

| Aspect | Spec |
|---|---|
| Tone | Helpful and honest, not an error. Explain *why* (WebCodecs / real-time preview) in one plain sentence — reinforces the "responsiveness/trust" positioning rather than apologizing. |
| Actions | "Copy link" (so the user can paste it into Chrome/Edge), plus outbound links to download Chrome / Edge (`target="_blank"`, `rel`, external-link affordance). **No** "continue anyway" into a broken editor. |
| Mobile note | One line stating MVP is desktop-only (no mobile/touch UI is in scope — `MVP_Scope.md` §3.11). Do not attempt a degraded mobile editor. |
| A11y | Single `main` landmark, `role="alert"`-style heading announced, fully keyboard operable, links have descriptive names, meets the same AA token rules. Static (no motion) by default. |

---

### 4.5 Hand-off checklist for designer + engineer

- [ ] Dark-first theme using the shared editor token layer (§4.0); light + high-contrast themes inherit the same component structure (Spec §19.8). All `(text, surface)` pairings validated ≥ 4.5:1 body / ≥ 3:1 large+non-text in CI.
- [ ] Logo direction: forge/anvil + play-triangle monogram + wordmark; works at 24px (header) and 32px (auth). **Not** a Canva-style gradient mark.
- [ ] **Zero billing/upgrade UI** on any screen in this part. No plan badge, no Pro CTA, no pricing. (Watermark messaging lives only in the export modal, a different part.)
- [ ] Auth: one screen, Log in/Sign up toggle, Google + email, password reset (no email-verification wall, no GitHub).
- [ ] Dashboard: responsive card grid (thumbnail + aspect badge+glyph + title + relative updated-at + ⋯), persistent New-project create-tile first, empty / loading-skeleton / error / per-card-busy states; Open/Create/Duplicate/Delete; delete is confirm-gated.
- [ ] New Project modal is the hero aspect-ratio chooser: 9:16 / 16:9 / 1:1 / 4:5 / Custom as **proportional, equally-weighted** tiles with **NO pre-selected default**; `radiogroup` semantics; Custom W×H (360–4096) with live ratio; sets `canvasConfig` and creates via `POST /api/v1/projects`; default / selected / loading / error states.
- [ ] Browser gate for non-Chrome/Edge and mobile — clear, helpful, no broken editor.
- [ ] Every screen WCAG 2.2 AA: focus-trapped dialogs with `Esc` + focus return, visible 2px `--focus-ring`, ≥ 24×24 targets, `role="alert"` errors, color never the sole signal, `prefers-reduced-motion` respected.


---

## 5. Editor — Canvas / Preview & Transport

> **Scope guard.** This part designs ONLY the MVP/Phase-0 center zone per `MVP_Scope.md` §3.3 / §3.11 and `VideoForge_Spec_v1.1.md` §2.2, §5.3, §16.2. It is the "what you cut is what you get" surface — the single screen where a creator visually confirms that the timeline edit *is* the export. Everything deferred (blend modes, J/K/L shuttle, work-area loop bar, OffscreenCanvas worker compositing, AI auto-caption, collaboration cursors, mobile/touch) is explicitly out and is called out where it could be confused with an in-scope control.
>
> Token values below are a **recommended starting system** the designer may refine; they are concrete so the engineer can build without guessing. Hex/px/ms/ratios are starting points, not law — except where they trace to a normative spec number (e.g. transport bar height 48px, canvas zoom 10–400%, safe-zone 80%/90%), which are fixed.

---

### 5.1 Role, brand intent & where it diverges from Canva

The canvas zone is the product's **trust theater**. Market research themes 1, 2 and 5 (`Market_Research.md`) are all litigated here: the user watches the preview, then exports, and the two must agree. So this zone's job is *legibility and honesty*, not decoration.

| Brand dimension | VideoForge intent | Canva pattern we mirror | How we diverge (state it out loud) |
|---|---|---|---|
| Stage feel | A calm, **pro-NLE neutral dark stage** that puts 100% visual weight on the frame, not chrome. | Centered preview with letterbox surround (a universal editor convention, not Canva-specific). | Canva's video surround is a light, "design-doc" canvas. Ours is **near-black `#1A1A2E` editor surround** (spec §2.1) so footage color is judged truthfully — the surround must never tint perception of the exported frame. |
| Transport | A **single horizontal NLE transport** with discrete frame-step controls and a click-to-jump timecode. | Canva's play bar (play + scrubber). | Canva hides frame-level precision; we surface **frame-step back/fwd and a typed timecode jump** front-and-center (research theme 9 — "Canva makes you leave the tool"). This is a deliberate "graduates beyond Canva" signal. |
| Color language | Selection/active = VideoForge **Forge Amber** accent on cool slate; *not* Canva's purple/teal. | — | We do **not** use Canva's purple. Primary interactive accent is a warm amber (`--accent-forge #FF8A3D`) reserved for "this is your active edit", with a cool slate neutral ramp. The selection bounding box stays **trust-blue** (`--selection #3D9BFF`) deliberately — blue reads as "system/selection" cross-tool and must contrast against amber UI chrome (spec §19.8 requires the box ≥ 3:1 against media; a distinct hue from chrome avoids confusion). |
| Honesty cues | **Performance mode** and the **watermark/proxy facts** are shown plainly, never as upsell. | Canva silently degrades (4K→1080p, dropped frames). | We **never silently degrade**. A degrade shows the "⚡ Performance mode" pill (spec §16.2). There is **no "Upgrade to Pro" CTA** anywhere on this surface (MVP = Free-tier only). |

---

### 5.2 Anatomy & spatial budget

The center zone occupies two of the five stacked bands from spec §2.1: the **Canvas Area** (flex height) and the **Transport Bar** (fixed 48px), in that vertical order, sitting between the top bar and the timeline.

```
canvasAreaHeight = viewportHeight − topBar(56) − transportBar(48) − timeline(260 default, resizable) − statusBar(28)
```

```
┌───────────────────────────────────────────────────────────────────────────┐
│ CANVAS AREA  (flex height; surround = #1A1A2E neutral dark stage)           │
│                                                                             │
│        ░░░░░░░░░░░ pillarbox ░░░░░░░░░░░  ┌─ overlay HUD (top-right) ──┐     │
│        ░         ┌───────────────┐      ░ │ [⛶ Safe]  [100% ▾] [⤢ Fit] │     │
│        ░         │               │      ░ └────────────────────────────┘     │
│        ░         │   PREVIEW     │      ░                                    │
│        ░         │   VIEWPORT    │      ░   (fixed project aspect ratio,     │
│        ░         │  (canvasBg    │      ░    centered, equal letterbox /     │
│        ░         │   #111111)    │      ░    pillarbox padding)              │
│        ░         │               │      ░                                    │
│        ░         └───────────────┘      ░   ┌─ ⚡ Performance mode (pill) ─┐  │
│        ░░░░░░░░░░░ pillarbox ░░░░░░░░░░░     └ shown only when degraded ──┘  │
│                                                                             │
├───────────────────────────────────────────────────────────────────────────┤
│ TRANSPORT BAR (48px)                                                        │
│ 00:00:04:11│ ⏮  ◀│  ▶/⏸  │▶  ⏭ │ 00:00:30:00   🔊──●── │ Auto▾ │ ⟲ │ ⛶    │
│  current   skip frm play frm  skip   total       master    qual  loop full  │
│  (click)   strt  ◀  /pause ▶  end   (click)      volume                     │
└───────────────────────────────────────────────────────────────────────────┘
```

**Canvas Area zoning (recommended):**
- **Preview viewport**: centered, fixed to the project's aspect ratio (§5.3 below). Equal letterbox (top/bottom) or pillarbox (left/right) padding fills the rest with the `#1A1A2E` surround.
- **Overlay HUD** (top-right, 12px inset): the three *view* controls — Safe-zone toggle, Zoom readout/menu, Fit. Floats over the surround, never over media. Height 32px, controls ≥ 24×24 CSS px (spec §19.3 / 2.5.8). These are view affordances, distinct from the transport (playback) controls below.
- **Performance pill** (bottom-right of canvas area, 12px inset): appears only in degraded state (§5.7).

> **Mirror-and-diverge note:** Floating view controls over a stage is a common editor idiom (incl. Canva). We diverge by keeping the HUD **minimal (3 controls)** and pushing all *playback* affordances into a single dedicated transport band — a clearer pro-NLE separation of "how I look at the frame" vs "how I play the frame" than Canva's blended bar.

---

### 5.3 Preview viewport: fixed ratio, letterbox/pillarbox, background

| Property | Value / behavior | Source |
|---|---|---|
| Aspect ratio | Locked to the project's `canvasConfig.aspectRatio`. MVP supports **9:16, 16:9, 1:1, 4:5, custom** (chosen at New-Project; no opinionated default — see Part on New-Project flow). The viewport reshapes when the user switches via `Alt+1/2/3/4`. | §2.2, MVP launch default |
| Letterbox / pillarbox | The viewport is scaled to *fit* the available canvas area at the current zoom, centered, with **equal padding** on the two surround sides. Surround = `#1A1A2E`. Never crops the frame ("canvas never clips — always fully visible at any zoom", §2.2). | §2.2 |
| Canvas background | Inside the viewport, unfilled areas show `canvasConfig.backgroundColor` (**default `#111111`**). This is *project content* (it exports as a solid color if no clip covers it) — visually distinguishable from the `#1A1A2E` surround. Render a 1px inner hairline (`--surface-line`, ~`#2A2A40`) at the viewport edge so the two near-blacks don't read as one surface. | §2.2 |
| Zoom range | **10%–400%** (NOT the timeline's 10%–2000%). Ctrl+scroll over the canvas, or the HUD zoom menu. Discrete menu steps: 25 / 50 / 75 / 100 / 150 / 200 / 400%, plus current custom value. | §2.2 |
| Fit to window | `Ctrl+Shift+0` (distinct from timeline's `Ctrl+0`). HUD ⤢ Fit button. Recenters and scales the viewport to fill available canvas area with letterbox. | §2.2, §13.3 note |
| Rulers / guides | **Out of MVP center scope** — `Ctrl+R` rulers and drag-out guides are present in the spec but are timeline/precision polish; do not design ruler chrome here for MVP. Safe-zone overlay IS in scope (below). | §2.2 (kept minimal) |

#### Safe-zone overlay (in scope)
Toggled by the HUD **⛶ Safe** button and the `` ` `` (backtick) shortcut (§13.3). Shows two nested dashed rectangles inside the viewport:
- **Title-safe 80%** — inner dashed rect, `--safe-title` (~`#FFD15C`, amber-tinted, 1px dashed, 50% opacity).
- **Action-safe 90%** — outer dashed rect, `--safe-action` (~`#FFFFFF`, 1px dashed, 35% opacity).
- Labels "Title safe" / "Action safe" as 10px caps at each rect's top-left, fading after 1.5s, reappearing on hover. **Editor-only — never exported** (§2.2). Especially load-bearing for the 9:16 creator default where platform UI (captions, handles) crowds edges.

---

### 5.4 Selection bounding box (8 handles + rotate)

When a clip or overlay is selected (via canvas click or timeline selection — binding is **bi-directional**, spec §2.2/§3.2), draw the selection box. This is the in-MVP manipulation affordance for **overlays/text** primarily (drag/resize/rotate); video clips select-to-inspect.

```
        ╭─ rotate handle (20px above top-center) ─╮
        │                ◌                        │
        │                ╎                        │
   ◻────────────────◻────────────────◻
   │ (nw)          (n)              (ne)│
   │                                    │
   ◻ (w)        SELECTED ELEMENT     (e) ◻
   │                                    │
   │ (sw)          (s)              (se)│
   ◻────────────────◻────────────────◻
```

| Element | Spec | Source |
|---|---|---|
| Box stroke | 1.5px solid `--selection #3D9BFF` (trust-blue). Must be ≥ 3:1 against both canvas bg and typical media — so each handle gets a **2px white halo / 1px dark inner ring** (a contrasting halo per §19.8) to survive over light *and* dark frames. | §2.2, §19.8 |
| 8 handles | Corners + edge midpoints. **9×9px** filled squares (white fill, blue stroke), hit target padded to **≥ 24×24px** (§2.5.8 / §19.3). Corner = proportional resize; **Shift = unconstrained**. Edge = single-axis (width-only / height-only); aspect not preserved. Min element size **20×20px logical**, pixel-snapped. | §2.2 |
| Rotate handle | A small circle **20px above the top-center handle**, connected by a 1px tether line. Drag to rotate; **Shift snaps to 15°**; **double-click resets to 0°**. | §2.2 |
| Keyboard equivalents (a11y, 2.5.7) | Element focused → arrows move 1px (`Shift`=10px); `Ctrl+arrows` resize; `[` / `]` rotate ±1° (`Shift`=±15°). Every drag has a non-drag path. | §19.3 |
| Multi-select | `Ctrl+Click` adds; group transform applies; box wraps the union bounds. | §2.2 |
| Position model | Stored as **% of canvas** (`canvasX%/Y%/width%/height%`) for resolution independence — the box renders from those values, so it is identical at any zoom and at export scale. | §2.2, §18.3 |

> Snapping (to canvas edges/center/other elements, `Alt` to disable, orange snap line) is in spec §2.2; surface it but keep it lightweight for MVP — a 1px `--accent-forge` snap guide that appears during drag, no measurement labels.

---

### 5.5 Transport bar (48px) — control inventory & layout

Fixed 48px band, full canvas-column width, centered group with timecodes flanking and the monitor/quality/loop/fullscreen cluster right-aligned. `role="toolbar"`, `aria-label="Playback controls"` (§19.5). All buttons ≥ 24×24 CSS px (§19.3 / 2.5.8); 8px gaps; transport-core group gets a subtle grouped container so the primary play action reads as primary.

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│                                                                                    │
│ [00:00:04:11]   ⏮   ◀│   ( ▶ )   │▶   ⏭    [00:00:30:00]    🔊 ──●──   [Auto ▾] ⟲ ⛶ │
│  current TC      A    B     C     D    E     total TC        master vol  qual lp fs │
│  (click-jump)                                (click=workarea)                      │
└──────────────────────────────────────────────────────────────────────────────────┘
```

| # | Control | Glyph | Behavior | Shortcut | Source |
|---|---|---|---|---|---|
| TC-L | **Current timecode** | `HH:MM:SS:FF` | Read-out of playhead. **Click to type an exact timecode and jump.** `Tab` moves focus to total. Live region announces on discrete seek (§19.7). | — | §5.3, §19.7 |
| A | Skip to start | ⏮ | Jump playhead to project start. | `Home` | §5.3, §13.1 |
| B | Step back 1 frame | `◀│` | Paused: −1 frame (exact `VideoDecoder` timestamp). | `←` | §5.3, §13.1 |
| C | **Play / Pause** | `▶` / `⏸` | Primary action — largest target (40×40 hit), `--accent-forge` filled when playing. `aria-pressed` reflects state. Toggles play/pause gated to the audio master clock. | `Space` | §5.3, §13.1 |
| D | Step fwd 1 frame | `│▶` | Paused: +1 frame. | `→` | §5.3, §13.1 |
| E | Skip to end | ⏭ | Jump playhead to project end. | `End` | §5.3, §13.1 |
| TC-R | **Total / duration** | `HH:MM:SS:FF` | Total project duration. (Spec also lets click set the work-area out-point; **work-area export/loop range is deferred in MVP**, so for MVP this is a read-only total. Keep the glyph identical for forward-compat.) | — | §5.3 |
| F | **Master monitor volume** | 🔊 + slider | Knob/slider 0–200%, default 100%. **Preview-only Master `GainNode` — does NOT affect export.** A tiny "monitor" hint on hover prevents the Canva-style confusion of thinking this is mix volume. Click 🔊 = mute monitor (visual only). | — | §5.3, §7.1 |
| G | **Playback quality** | `Auto ▾` | Dropdown: **Auto / High / Low**. High = 720p base proxy; Low = quarter-res rendition; **Auto = auto-degrades under frame-budget pressure** (drives the §5.7 indicator). | — | §5.3 |
| H | **Loop** | ⟲ | Toggle. MVP loops **full duration** (work-area loop is deferred). Active = `--accent-forge`, `aria-pressed`. | — | §5.1 |
| I | **Fullscreen preview** | ⛶ | Canvas expands to full browser window; shortcuts stay active; `Esc` exits. | `Ctrl+Shift+F` | §5.1, §13.1 |

**Explicitly NOT in the MVP transport** (so the designer doesn't add them): J/K/L shuttle buttons, discrete 0.25×/0.5×/2×/4× rate selector UI, work-area in/out drag bar, preload buffer bar (the green/grey decoded-cache bar in §5.3 is a nice-to-have polish; treat as **optional**, render as a thin 2px strip under the timecode only if cheap — not required for MVP).

**Timecode behavior detail:**
- Format `HH:MM:SS:FF` (frames, from `canvasConfig.frameRate`). Tabular/monospace numerals so digits don't jitter while playing.
- Click current TC → it becomes an inline editable field (caret, select-all). `Enter` commits + jumps; `Esc` cancels; invalid input shakes + `aria-invalid` and is rejected (no jump). Single-key shortcuts are **swallowed** while editing (§13 general rule).

---

### 5.6 States

#### State 1 — Nothing selected (default / canvas expanded)
- No bounding box. Right inspector auto-hides (§2.1), so the canvas area is at its widest.
- Surround `#1A1A2E`; viewport shows the composited frame at the playhead (or `canvasConfig.backgroundColor` if nothing is at the playhead).
- HUD (Safe / Zoom / Fit) visible. Transport fully interactive.
- A11y: canvas mirror has no `aria-activedescendant`; selection live region last said "Selection cleared."

```
┌── canvas area ───────────────────────────────┐
│        ┌──────────────┐   [⛶][100%▾][⤢]      │
│        │              │                      │
│        │   composited │   (no handles)       │
│        │   frame      │                      │
│        └──────────────┘                      │
└──────────────────────────────────────────────┘
```

#### State 2 — Clip / overlay selected
- 8-handle blue box + rotate handle around the element (§5.4).
- Right inspector shows the element's properties (designed elsewhere); canvas narrows accordingly.
- Selecting in the timeline highlights the box here, and vice-versa (bi-directional, §2.2).
- A11y: mirror node `aria-selected="true"`, becomes `aria-activedescendant`; live region: "Selected: Text overlay 'Summer Sale'".

```
        ╭ ◌ ╮  (rotate)
   ◻─────◻─────◻
   ◻   ELEMENT   ◻      ← blue box, haloed handles
   ◻─────◻─────◻
```

#### State 3 — Text editing inline
- Double-click a text overlay (or `T` to add) → **inline edit mode**: blinking caret in the live-rendered text on the canvas; the 8-handle box is replaced by a thin dashed edit-frame (`--accent-forge`, 1px dashed) to signal "typing, not transforming."
- The bounding-box handles are suppressed during edit (can't resize while typing). `Ctrl+B/I/U`, `Ctrl+E/L/R` active; all single-key transport shortcuts (`Space`, `S`, etc.) **swallowed** as literal text (§13 general rule).
- `Esc` (or click outside) commits and returns to State 2.
- A11y: the editable region exposes a `textbox`; live region politely announces "Editing text".

```
   ┌╴╴╴╴╴╴╴╴╴╴╴┐   ← dashed amber edit-frame (no handles)
   ╎ Summer Sal│ ╎  ← caret
   └╴╴╴╴╴╴╴╴╴╴╴┘
```

#### State 4 — Processing / not-yet-playable
The center zone has three distinct "can't show the frame yet" sub-states. Keep them visually different so users trust *why* the frame is blank:

| Sub-state | Trigger | Canvas treatment | Transport |
|---|---|---|---|
| **Asset still transcoding** | Clip on timeline whose proxy isn't `READY` (`asset:ready` not yet received). | Viewport shows the clip region with a **skeleton shimmer + spinner** and label "Preparing preview…". Under `prefers-reduced-motion`, use a static stepped bar + textual % (§19.9). | Play disabled (greyed, `aria-disabled`), tooltip "Waiting for media to finish processing." |
| **Seeking / decoding** | Just after a seek or scrub; nearest keyframe decoding. | Last good frame held + a slim top-edge progress hairline (`--accent-forge`, indeterminate). No full-screen spinner — avoids flashing on fast seeks. | Transport stays live. |
| **Reconnect** | Proxy signed URL 403 and silent re-fetch failed (§16.2). | Viewport overlays a muted card: "⚠ Reconnect — preview source unavailable" + Retry button. Matches the timeline's "⚠ Reconnect" icon for the same asset. | Play disabled until resolved; **note copy reassures: "Export will still work."** (honesty, not alarm). |

> No "export in progress" state lives on the canvas — export is a modal + status-bar/bell affair (§10.2), not a canvas takeover. The user can keep editing during export.

---

### 5.7 Degraded "Performance mode" indicator (the anti-Canva honesty cue)

This is a **headline trust feature** (research themes 2 & 5: Canva silently drops frames / downgrades). VideoForge **degrades visibly, never silently**.

- **Trigger:** decode latency exceeds the frame budget / `Auto` quality detects frame-budget overrun → engine switches to the **quarter-resolution Low rendition** (§4.2) and surfaces the indicator (§16.2, §5.3, §5.2 complex-project row).
- **Primary placement:** the **status bar** (§2.1) shows `⚡ Performance mode` — the canonical home.
- **Canvas echo (recommended):** a small **pill** bottom-right of the canvas area (12px inset) so the user sees it where they're looking: amber `⚡` glyph + "Performance mode" on a `--surface-elevated` chip, ~28px tall, 90% opacity, `--accent-forge` left border.
- **Tooltip / popover on hover or focus:** plain-language honesty — *"Preview switched to lower resolution to stay responsive. Your export is unaffected and renders at full quality."* This directly answers the Canva ghost-/downgrade trust break. **No upsell, no "Pro" link.**
- **Exit:** when budget recovers (and quality is `Auto`), the pill auto-dismisses with a ≤250ms fade (instant under reduced-motion). If the user manually set quality to `Low`, show a quieter persistent "Low quality" state instead of the amber alert (it's their choice, not a system degrade).
- **A11y:** announced **politely once** when it engages ("Performance mode on — preview at lower resolution; export unaffected"), not repeatedly; lives in the status `role="status"` region (§19.7). Color is never the only signal — the ⚡ glyph + text carry it (§19.8 1.4.1).

```
                                   ┌─────────────────────────┐
   ...canvas frame...              │⚡ Performance mode       │  ← amber pill,
                                   └─────────────────────────┘     bottom-right
status bar:  00:00:04:11 / 00:00:30:00    Zoom 100%    ⚡ Performance mode   ● Saved
```

---

### 5.8 Watermark honesty (informational, on this surface)

The mandatory Free-tier watermark is **applied at export**, not painted on the live preview (the preview must show the true composition). However, to honor "what you cut is what you get," the **export modal** (designed in the Export part) carries the informational line *"A small VideoForge watermark is added"* (bottom-right, ~10% width, 70% opacity per §10.2). 

On this canvas surface, the **only** acknowledgment is an optional, dismissible one-time hint the first time a user opens the editor: a small ghosted bottom-right marker in the safe-zone preview labeled "Watermark added on export →" pointing toward the Export CTA. Keep it subtle, informational, **never an upsell**, and never a persistent overlay that obscures the frame. (Recommended, not required — if it risks reading as a Canva-style nag, omit it; the export-modal note is the authoritative disclosure.)

---

### 5.9 Design tokens (recommended starting system)

| Token | Value | Use |
|---|---|---|
| `--surround-stage` | `#1A1A2E` | Editor surround (letterbox/pillarbox). Non-exported. (§2.1) |
| `--canvas-bg-default` | `#111111` | Default `canvasConfig.backgroundColor` (project content). (§2.2) |
| `--surface-line` | `#2A2A40` | 1px viewport-edge hairline separating the two near-blacks. |
| `--surface-elevated` | `#23233A` | Transport bar, HUD chips, performance pill background. |
| `--accent-forge` | `#FF8A3D` | Active play state, loop-on, snap guide, perf-mode accent, edit-frame. (Brand divergence from Canva purple.) |
| `--selection` | `#3D9BFF` | 8-handle bounding box (trust-blue, ≥3:1 over media via halo). (§19.8) |
| `--handle-fill` / `--handle-halo` | `#FFFFFF` / `rgba(0,0,0,.55)` | Handle fill + contrasting halo for legibility over any frame. |
| `--safe-title` / `--safe-action` | `#FFD15C` @50% / `#FFFFFF` @35% | Title-safe 80% / action-safe 90% dashed overlays. (§2.2) |
| `--text-primary` / `--text-secondary` | `#F2F2F7` / `#A6A6C2` | Timecode (primary), labels/hints (secondary); both ≥4.5:1 on elevated surfaces. (§19.8) |
| `--focus-ring` | `#7FB6FF` | 2px solid + 2px offset focus-visible ring, ≥3:1 on dark surround and on clips. (§19.4/§19.8) |
| `--motion-duration` | `200ms` (→ `0ms` under `prefers-reduced-motion`) | HUD/pill transitions, fades. (§19.9) |
| Transport bar height | `48px` (fixed) | Spec §2.1 — normative. |
| HUD control / transport button hit target | `≥ 24×24 CSS px` | Spec §19.3 / WCAG 2.5.8 — normative. |
| Canvas zoom range | `10%–400%` | Spec §2.2 — normative. |

---

### 5.10 Accessibility checklist for this surface (from §19)

- **Canvas** = `role="application"` + `aria-label="Preview canvas"`, region wrapped in `role="main"`; selection state carried by the **offscreen DOM mirror** (`aria-selected` + `aria-activedescendant`), since the bounding box is a canvas drawing, not a DOM node (§19.5/§19.6).
- **Transport** = `role="toolbar"` `aria-label="Playback controls"`; play/pause exposes `aria-pressed`; disabled controls use `aria-disabled` with a tooltip reason; every drag-style control (volume, future scrub) has a keyboard path (§19.3).
- **Timecode jump field**: validation via `aria-invalid` / `aria-describedby`; single-key shortcuts swallowed while editing (§13, §19.3).
- **Focus visible** (`:focus-visible`, 2px ring + offset) on every control incl. mirror nodes and the perf pill; **focus not obscured** by the sticky transport/status bands (scroll-into-view with offset, §19.4).
- **Live regions**: playhead time on discrete seek (≤1/sec during play), selection (debounced 150ms), performance-mode engage (polite, once), reconnect/error (assertive). One polite + one assertive region at app root via `announce()` (§19.7).
- **Reduced motion**: HUD/pill/skeleton animations collapse to instant/stepped; **the user's project playback in the canvas is unchanged** — it's essential content (§19.9).
- **Contrast**: selection box, handles, perf pill, focus ring, timecode all meet ≥3:1 (non-text) / ≥4.5:1 (text); color never the sole signal — glyph+text accompany every state (§19.8).

---

### 5.11 Handoff notes for Claude design + engineering

1. **Two near-blacks are intentional** (`#1A1A2E` surround vs `#111111` canvas bg). Render the 1px hairline so they read as distinct surfaces — this is a frequent QA miss.
2. **The transport is one band, not two clusters of equal weight.** Play/pause is the visual anchor (largest, amber-when-playing). Timecodes flank; monitor/quality/loop/fullscreen are a right-aligned secondary cluster.
3. **Master volume ≠ export volume.** Label/tooltip it as "monitor" to pre-empt the Canva-style confusion. It is preview-only by spec.
4. **Performance mode must be impossible to miss but never alarming** — amber, glyph + plain copy, "export unaffected." It is a feature we are *proud* of, the literal opposite of Canva's silent degrade.
5. **No "Upgrade"/"Pro" anything** on this surface. Watermark disclosure lives in the export modal; the canvas hint (if used) is informational only.
6. **Do not build** ruler chrome, work-area loop bar, J/K/L shuttle, preload buffer (optional), or any blend-mode/effect HUD here — out of MVP for this zone.


---

## 6. Editor — Multi-Track Timeline

> **Scope note.** This section designs the MVP timeline only — the surface defined by VideoForge_Spec_v1.1.md §3.1–§3.5 and constrained to MVP_Scope.md §3.2 (✅ rows). Deferred timeline features (slip/slide, freeze-frame, markers/chapters/beat detection, mini-map, snap-to-grid, blend modes, voice-over track) are **out of scope here** and must not be drawn. Token values (hex, px, rem, ms) are a **recommended starting system** the designer may refine, but the *behaviours, anatomy, and states* are normative.

### 6.0 Why the timeline is the hero surface

VideoForge's entire wedge is **"what you cut is what you get"** — the export FFmpeg `filter_complex` is generated from the same JSON graph the timeline edits (MVP_Scope.md §1). So the timeline is not a secondary strip below a canvas the way it is in Canva's design-first model; it is *the* edit surface, and its visual language must read as **a precise, trustworthy NLE** — closer to a stripped-down Premiere/CapCut track stack than to Canva's "scenes" filmstrip.

**Canva-pattern divergence (state this in the design).** Canva uses a single page/scene filmstrip with layers hidden inside each scene; trims scramble audio and "bad takes" reappear. VideoForge instead shows **true persistent multi-track lanes on one shared time axis**, with an explicit **Audio-Link chain** and a **snapping line** that make the edit model legible. Where we borrow Canva's approachability — rounded clip blocks, soft shadows, friendly empty states — we diverge by adding NLE affordances Canva lacks: visible trim handles, a draggable red playhead, a work-area bar, frame-accurate snapping, and a per-clip keyframe lane. The look should feel **calm and dark** (so footage thumbnails pop) rather than Canva's bright-white chrome.

---

### 6.1 Timeline zone anatomy

The timeline occupies the bottom band of the editor (§2.1: default 260px tall, resizable 180–600px via the top drag handle). It has four structural regions: a **sticky time ruler**, a **fixed 180px track-header column**, the **scrollable track body**, and a **bottom utility row** (zoom + horizontal scrollbar).

```
┌─ TIMELINE ZONE (default 260px tall, drag top edge to resize 180–600px) ──────────────────┐
│ ░░░░ resize handle (full width, 6px hit area, ns-resize cursor) ░░░░                       │
├──────────────────────┬────────────────────────────────────────────────────────────────────┤
│  TRACK HEADER (180px) │  RULER  00:00      00:02      00:04      00:06      00:08   ◄scrub►  │  ← sticky top (32px)
│       (column header  │  ▼ playhead  [▭▭▭▭▭▭▭▭ work-area bar (blue) ▭▭▭▭▭▭▭▭]                │
│        is the ruler   ├────────────────────────────────────────────────────────────────────┤
│        gutter)        │   ┊        ┊         ┊  (1s gridlines, color by track type)         │
├──────────────────────┤   ┊        ┊         ┊                                                │
│ ▣ V2  Logo      ◑◉🔒 ⠿│   [≈ overlay label clip ≈]                                          │
│ ▤ 64px          [#]   │           ┊  │ (red playhead, full height)                           │
├──────────────────────┤           ┊  │                                                        │
│ ▣ V1  intro.mp4 ◑◉🔒 ⠿│ [▦▦▦▦ thumbnail strip ▦▦│▦▦▦▦▦] (split) [▦▦▦▦▦▦▦]                    │
│ ▤ 64px          [#]   │        🔗 (chain to A1)                                              │
├──────────────────────┤           ┊  │                                                        │
│ 🔊 A1 intro(aud)◑◉🔒 ⠿│ [∿∿∿∿ waveform ∿∿│∿∿∿∿] (linked split) [∿∿∿∿∿∿]                    │
│ ▤ 48px  pan─●─  E [#] │        🔗 (chain to V1)                                              │
├──────────────────────┤           ┊  │                                                        │
│ 💬 CC  English   🔒 ⠿ │   (━ caption pill ━)  (━ pill ━)                                     │
│ ▤ 36px          [#]   │           ┊  │                                                        │
├──────────────────────┴────────────────────────────────────────────────────────────────────┤
│ [Fit]  [– ⊙────────────── +] 100%   │◄═══════ horizontal scrollbar ═══════►│                 │  ← utility row (28px)
└─────────────────────────────────────────────────────────────────────────────────────────────┘
```

| Region | Size | Behaviour |
|---|---|---|
| Resize handle | Full width, 6px hit area, ≥24px keyboard target via `role="separator"` | `ns-resize`; drags the canvas/timeline split. |
| Time ruler | Sticky top, **32px** tall, full track-body width | Timecode `HH:MM:SS:FF` (toggle to seconds). Tick density adapts to zoom. **Click to jump playhead, drag to scrub** (§3.1). Hosts the work-area bar. |
| Track-header column | **Fixed 180px**, left, does **not** horizontal-scroll | One header per track; vertically scrolls in sync with the body. The ruler's 180px left gutter is the header column header. |
| Track body | Fills remaining width, scrolls H + V | Clip blocks; subtle 1s gridlines tinted by track type. **Virtual-scrolled: only clips within ±200px of the viewport are mounted** (§3.1 / §15.3). |
| Utility row | **28px**, bottom | Left: Fit button + zoom slider + % readout. Right: horizontal scrollbar. |

**Scroll-sync invariant:** horizontal scroll moves the ruler and *all* track bodies together; the header column never moves horizontally. Vertical scroll moves headers + bodies together; the ruler stays pinned.

---

### 6.2 Track-header column (180px)

Each header is a single roving-tabindex stop (§19.4) with controls inside. Layout is two rows so a 36px caption track still fits the essentials and a 64px video track shows more.

```
┌─ 180px ─────────────────────────────┐
│ [▣] V1   intro.mp4            ⠿ [#]  │  row 1: type icon · label (W: name editable) · overflow · color swatch
│ [◑ M] [◉ S] [🔒 L]   pan ─●──  [E]   │  row 2: mute · solo · lock · (audio: pan + envelope toggle)
└──── ↕ height drag handle (bottom edge)┘
```

| Element | Spec | Notes / divergence |
|---|---|---|
| Type icon | 16px glyph, leading. Video `▣` film-frame, Audio `🔊` speaker-wave, Caption `💬` speech, Overlay `▤` layers. | Carries `aria-label` so colour is never the only signal (§19.8). |
| Track name | Editable `textbox` on activation (double-click or `Enter`). Truncates with ellipsis. | Default names: `V1`, `A1`, `English`, `Overlay 1`. |
| Mute (M) / Solo (S) | `role="switch"`, `aria-checked`. **Button labels, not keyboard shortcuts** (§13 reserved-keys). **Audio tracks only.** | Mute → track greys to ~45% in body. Solo → all other audio tracks dim. **Both respected on export** (§3.2 / §10.3) — preview == export. Each ≥24×24 CSS px (§19.3 / 2.5.8). |
| Lock (L) | `role="switch"`. All track types. | Locked track → clips non-interactive, header shows `aria-disabled`, body gets a faint diagonal-hatch overlay. |
| Color swatch `[#]` | 12×12 rounded square, trailing. | Opens swatch popover (right-click clip → Change Colour also writes per-clip). Source-file colour-coding is **redundant** to label+icon (§19.8). |
| Overflow `⠿` | Vertical-dots menu (kebab). | Holds context actions and any control that would shrink < 24px when the track is collapsed (§19.3). |
| Height drag handle | Bottom edge of header, `ns-resize`, `role="separator"` + `aria-valuenow` px. | Video 64px (40–200), Audio 48px (32–160 — taller shows stereo waveform), Caption 36px (fixed), Overlay 48px. |
| Pan slider | Audio only, row 2. `-100…+100`, centre-detent at 0. | Maps to `StereoPannerNode` in preview, `pan` filter on export. |
| Envelope toggle `[E]` | Audio only. Toggles volume-envelope edit mode over the waveform. | **Button label, not a key** (§13). In MVP this exposes the per-clip volume-envelope keyframe lane (MVP §3.4). |

> **MVP track ceilings (Free tier, hard-coded — MVP §3.2 / §15.2):** **3 video · 2 audio · 2 overlay · 1 caption.** Track types are grouped in this stacking order top-to-bottom in the header column: **Overlay (top) → Video → Audio → Caption (bottom)**, but z-order within video follows array index (track 1 = bottom layer, §3.2). When a ceiling is hit, the "+ Add track" affordance for that type is **disabled with a tooltip** ("Free tier: max 3 video tracks") — **never** an upsell CTA (MVP monetization rule: no "Upgrade to Pro"). An assertive `aria-live` announcement fires on attempt (§19.7).

---

### 6.3 Time ruler, playhead & work-area bar

```
 RULER (32px)   00:00:00:00     00:00:02:00     00:00:04:00     00:00:06:00
                 │ │ │ │ ┊ │ │ │ │ │ ┊ │ │ │ │ │ ┊ │ │ │ │ │ ┊        ← ticks (major @ labelled, minor adapt to zoom)
                ▼ playhead glyph (triangle, drag target)
   [▭▭▭▭▭▭▭▭▭▭▭▭▭ WORK-AREA BAR (translucent blue) ▭▭▭▭▭▭▭▭▭▭▭▭▭]   ← I / O set in/out
─────────────────┃───────────────────────────────────────────────────
                 ┃  ← red playhead line, 2px, full track-body height
```

| Element | Spec | Behaviour |
|---|---|---|
| Timecode | `HH:MM:SS:FF` at project frame rate; toggle to seconds via ruler context menu. | Tick density adapts to zoom; major ticks labelled, minor ticks unlabelled. |
| Playhead | **2px solid red** line, full body height; **8px wide triangle handle** sitting in the ruler. `role="slider"`, `aria-valuetext` = timecode (§19.5). | **Draggable**; **click ruler = jump**; **drag ruler = scrub**. Auto-scrolls the body when it nears the viewport edge during playback (jump-scroll under reduced-motion, §19.9). Keyboard: `←/→` 1 frame, `Shift+←/→` 10 frames, `Home/End` start/end. |
| Work-area bar | Draggable **translucent blue** range on the ruler, with in/out thumbs (two `role="slider"` thumbs, §19.5). Default = full project duration. | `I` / `O` set in/out at playhead; `Shift+I/O` jump to in/out (§13.1). In MVP it drives **loop-preview** only (work-area/range *export* is deferred — MVP §3.8); label the bar "Loop / preview range" to avoid implying range export. |

**Contrast (§19.8):** the red playhead and clip outlines must hold ≥3:1 against the track-body grid; the playhead gets a subtle 1px dark halo so it survives both bright and dark thumbnails.

---

### 6.4 Clip-block anatomy

All clip blocks share a base shell, then specialise their body fill by track type. Base shell:

```
┌─[trim]────────────────── clip block ──────────────────[trim]─┐
│⟨◧⟩  name label (truncates)              [1.5×] [🔗] [◆ kf]  ⟨◨⟩│
│  ▦▦▦▦▦▦▦▦▦▦▦▦  type-specific body  ▦▦▦▦▦▦▦▦▦▦▦▦              │
│  ◆────────◆──────────────◆  ← keyframe lane (when expanded)   │
└──────────────────────────────────────────────────────────────┘
   ↑ left trim handle (8px)                  right trim handle ↑
```

| Part | Spec | Notes |
|---|---|---|
| Corner radius | 6px | Borrowed from Canva's friendly feel; diverges via the explicit handles below. |
| Border | 1px; colour = source-file colour-coding (video default teal). | ≥3:1 vs grid (§19.8). Selected state thickens to 2px + accent. |
| Trim handles | **8px**-wide grab zones inset at each end, `ew-resize`. Appear on hover/selection; always present (≥24px effective with spacing, §19.3). | Drag-in = trim, drag-out = extend (clamped to source). **Trimmed-out region renders as a darkened "ghost" extension** so the user *sees* what was cut — directly answers Canva's ghost-footage complaint. |
| Name label | 11px, top-left, single line, ellipsis. | Hidden if clip width < ~48px. |
| Speed badge `[1.5×]` | Pill, top-right, shown only when `speed ≠ 1.0×`. | `0.1×–16×` (§3.3 / MVP §3.2). `< 1×` slow-mo tint (cool), `> 1×` fast tint (warm). Click → speed field in inspector. |
| Audio-Link chain `[🔗]` | 14px chain glyph, shown only when the clip is part of an Audio-Link pair. | Appears on **both** the video clip and its linked audio clip (§3.2). Right-click → **Unlink Audio** removes it. See §6.6. |
| Keyframe affordance `[◆ kf]` | Diamond toggle, top-right. Expands the **per-clip keyframe lane** (a thin sub-row inside the clip). | See §6.7. |

**Type-specific bodies:**

| Track type | Body rendering | Spec |
|---|---|---|
| **Video** | **Thumbnail strip** — first frame of each second from the WebP sprite sheet, laid via CSS `background-position` (never per-frame `<img>`, §4.2 / §15.3). | Taller tracks show more thumbnail rows. Default clip colour teal; per-source colour-coded. |
| **Audio** | **Waveform** — SVG path from the peaks JSON. | At header height > 80px, switch to stereo dual-channel. Volume-envelope keyframe line overlays the waveform when `[E]` is on. |
| **Caption** | **Pill** — narrow rounded block on the 36px track; label = first 30 chars of the caption text (truncated preview). | Width = block duration. Click selects → right panel switches to Caption Editor mode (§9.2). |
| **Overlay** | **Label block** — solid block with the overlay's name (e.g. text content or "Logo"). No thumbnail. | Bi-directional canvas↔timeline selection (§2.2 / §3.2). |

---

### 6.5 Interaction affordances (the full set)

Every interaction below has both a pointer gesture **and** a keyboard path (§19.3, WCAG 2.5.7). Cursors and snap feedback are part of the affordance.

| Interaction | Pointer | Keyboard | Visual feedback |
|---|---|---|---|
| **Select** | Click clip. Multi-select: `Ctrl+Click` or rubber-band drag on empty body. | Roving focus to clip → selection follows focus unless `Ctrl` held (§19.4). `Ctrl+A` all on track, `Ctrl+Shift+A` all tracks. | 2px accent border + selected fill (see matrix §6.8). Inspector updates. |
| **Move — same track** | Drag body L/R. `Alt` disables snap. | Focused clip `←/→` nudge 1 frame, `Shift+←/→` 1s. | Clip lifts (elevated shadow); **orange snap line** when an edge aligns (§6.6). |
| **Move — cross-track** | Drag up/down to a compatible track. `Shift` = swap, default = insert (pushes clips right). | `Ctrl+↑ / Ctrl+↓` move to adjacent compatible track. | Target track highlights on hover; incompatible tracks (e.g. video→caption) reject with a no-drop cursor. |
| **Trim start / end** | Drag a trim handle. Min duration **1 frame**. Cannot exceed source. **Gaps are NOT auto-closed** (§3.3 — anti-ghost-footage). | `[` trim in to playhead, `]` trim out to playhead. | Trimmed-out region shows as darkened ghost extension; live timecode tooltip. |
| **Ripple trim** | Hold `Ctrl` while trimming → right-side clips on the track slide to fill/create the gap. | `Ctrl + drag` (edge). | Affected downstream clips animate their shift (instant under reduced-motion). |
| **Split at playhead** | Right-click → Split, or `S` (see S-key arbitration §13.2). `Shift+S` = split across all tracks. | `S`. | Clip divides into two independent clips at the playhead. **Linked audio splits simultaneously** (§3.2 — non-negotiable). |
| **Delete / ripple delete** | `Delete`/`Backspace` (gap left). `Ctrl+Delete` = ripple delete (right clips slide left). | Same keys. | Removed clip fades out; ripple animates the slide. |
| **Duplicate** | `Ctrl+D` — copy placed immediately **after** the original on the same track. `Ctrl+C/V/X` copy/paste/cut (paste at playhead). | Same keys. | New clip appears selected. **Direct counter to Canva's removed page-duplication.** |
| **Snapping** | ON by default to clip edges + playhead. `Alt` disables during drag. | n/a (nudge is already frame-accurate). | **Orange vertical snap line** across full timeline height (§6.6). |
| **Zoom** | Zoom slider (utility row) + `Ctrl+scroll` on body (centred on cursor). Fit button = fit all clips. | `Ctrl+= / Ctrl+-` (centred on playhead), `Ctrl+0` fit all. | % readout updates; range 10%–2000% (§3.4). |
| **Audio-Link** | Auto-created on video clips with embedded audio. Right-click → Unlink. | Context menu via `Menu`/`Shift+F10`. | Chain icon on both clips; see §6.6. |

> **MVP exclusions to NOT draw here:** slip (`Hold S + drag`), slide (`Hold W + drag`), freeze-frame insert, markers (`M`), beat-detect, snap-to-grid (`Ctrl+;`), mini-map. These exist in §3.3–§3.6 but are **deferred** (MVP §3.2) — omit their affordances from the MVP timeline.

---

### 6.6 Audio-Link chain & the snapping line — two trust signals

These two cues are the visual proof of the "what you cut is what you get" promise; design them to be unmistakable.

**Audio-Link chain.** When a video clip carries embedded audio, a linked audio clip is auto-created on an audio track directly below it (§3.2). Both clips show a **14px chain glyph** at the same inset corner, and a **faint connecting tether** (1px dashed accent) is drawn between them when either is selected, so the relationship is visible at a glance.

```
V1 [▦▦▦▦▦▦🔗▦▦▦▦▦]
            ┊ (dashed tether shown on selection)
A1 [∿∿∿∿∿∿🔗∿∿∿∿∿]
```

- Linked clips **move together** and **split together** — a split on the video clip splits the audio clip at the same frame (the desync fix).
- **Unlink Audio** (right-click) removes the chain on both; the tether disappears and the clips become independently editable.
- Dedicated edge cases (split / ripple / cross-track) are tested (MVP §3.2) — the design must keep the chain glyph correct after each.

**Snapping line.** A single **orange vertical line** (≥3:1 contrast, §19.8) spans the full timeline height when a dragged clip edge aligns to another clip edge or the playhead. It is the only snap indicator (MVP scope: snap-to-grid and snap-to-markers are deferred). `Alt` suppresses snapping and hides the line.

---

### 6.7 Per-clip keyframe lane

The keyframe engine is shared MVP infrastructure (transforms, Ken Burns, audio volume-envelope all ride it — MVP §3.7 / §3.4). Surface it on the timeline as a **collapsible sub-lane inside the clip block**, not a separate panel, so motion is discoverable per-clip (answering Canva's "single biggest limitation").

```
┌─ clip ───────────────────────────────── [◆ kf] ─┐  ← diamond toggle (filled when lane open / kfs exist)
│  ▦▦▦▦ thumbnail / waveform body ▦▦▦▦              │
│  ┄┄┄┄┄┄┄┄ keyframe lane (≈14px, when expanded) ┄┄ │
│  ◆──────────◆────────────────◆                   │  ← keyframes at timeMs; line = interpolation
└──────────────────────────────────────────────────┘
```

| Element | Spec |
|---|---|
| Lane toggle | Diamond `◆` in the clip's top-right cluster. Filled when the lane is open or any keyframe exists. ≥24px target. |
| Property selector | When open, a tiny dropdown picks the animated property: **opacity, position X, position Y, scale, rotation** (MVP §3.7), plus **volume** on audio clips. One property's keyframes show at a time. |
| Keyframe markers | **Diamond** nodes at each `timeMs`. The connecting line indicates interpolation: **Linear** (straight) or **Ease** (curved) — Bezier/curve editor is deferred (MVP §3.7). |
| Keyboard | Envelope/keyframe mode: `Tab` between keyframes, `↑/↓` adjust ±1% (`Shift` ±10%), `Enter` add at playhead, `Delete` remove (§19.3). |
| Audio envelope | The `[E]` header toggle (§6.2) opens the same lane bound to the **volume** property over the waveform. |

Keyframe values are stored on the clip (`keyframes{}` per MVP §5 data subset) and exported as FFmpeg keyframe expressions — same graph, same result.

---

### 6.8 Clip-state matrix

Five required states. Token values are a starting system; the *distinctions* between states are normative and must each be conveyed by **more than colour** (§19.8).

| State | Border | Fill / body | Cursor | Extra affordances / cues | a11y |
|---|---|---|---|---|---|
| **Default** | 1px source-colour outline | Full-opacity thumbnail / waveform / pill | `pointer` over body | Trim handles hidden until hover; name + (conditional) speed/chain/kf badges. | `aria-selected="false"` |
| **Selected** | **2px accent** (e.g. `#3B82F6`-class) + 2px focus ring on keyboard focus | Slightly brightened; subtle inner glow | `move` over body, `ew-resize` over handles | Trim handles **visible**; keyframe + speed badges emphasised; inspector bound. Multi-select shows a count badge. | `aria-selected="true"`; `:focus-visible` ring (§19.4) |
| **Locked / Audio-linked** | Locked: 1px **dashed** outline. Linked: solid + **chain glyph** | Locked: diagonal-hatch overlay, ~45% controls dim. Linked: normal + chain + dashed tether on select | Locked: `not-allowed`. Linked: `move` (moves the pair) | Locked clips reject drag/trim/split. Linked clips move/split as a pair; **Unlink** in context menu. (A clip can be both — locked wins for interaction.) | Locked → `aria-disabled="true"`; linked → chain in `aria-label` ("…linked to A1") |
| **Trimming** | 2px accent | **Darkened ghost extension** shows the trimmed-out source region; live timecode tooltip near the handle | `ew-resize` | Orange snap line if an edge aligns; min-duration (1 frame) hard stop with a brief shake (instant under reduced-motion). Ripple variant shifts downstream clips. | `aria-valuetext` updates with new in/out timecode |
| **Dragging** | 2px accent | **Elevated shadow**, body at ~85% opacity (lifted) | `grabbing` | Original position shows a faint placeholder; target track highlights; orange snap line on alignment; cross-track shows insert/swap intent. | live announce "Moving clip…" on drop: "Clip moved to track 3" (§19.7) |

> **Disabled "add track" / ceiling state** (not a clip state, but adjacent): the per-type "+ Add track" control is disabled with a neutral tooltip stating the Free-tier limit. No colour-only signal; no upsell.

---

### 6.9 Accessibility & motion summary (timeline-specific)

Carries the §19 contract onto this surface (designer + engineer checklist):

- **Grid semantics (§19.5):** timeline = `role="grid"`; ruler row = `columnheader` cells; each track = `role="row"`; clips/captions = `role="gridcell"`; playhead = `role="slider"` with `aria-valuetext` timecode; work-area = two grouped `slider` thumbs; header mute/solo/lock = `role="switch"`.
- **Roving focus (§19.4):** header column = 1 tab stop (`↑/↓` between headers); each track body = 1 tab stop (`←/→` between clips, `↑/↓` to nearest clip on adjacent row). Skip-link "Skip to timeline" is an early tab stop.
- **Drag alternatives (§19.3, 2.5.7):** every drag (move, cross-track, trim, scrub, envelope, zoom) has the keyboard path listed in §6.5/§6.7 — no mouse-only operation.
- **Target size (2.5.8):** mute/solo/lock, trim handles, transport-adjacent zoom controls ≥ 24×24 CSS px; controls that would shrink on a collapsed track move into the overflow menu.
- **Contrast (§19.8):** playhead red, clip outlines, snap-orange, selection accent all ≥ 3:1 vs the track-body grid; source colour-coding is redundant to label + icon.
- **Live regions (§19.7):** edits announce politely ("Clip split", "Trimmed to 0:03.500", "Clip moved to track 3"); ceiling/limit hits announce assertively ("Free tier: max 3 video tracks").
- **Reduced motion (§19.9):** playhead auto-scroll becomes jump-scroll; ripple/drag/trim micro-animations collapse to instant; **the user's actual project playback in the canvas is never reduced** — only timeline meta-motion is.

---

### 6.10 Recommended starting tokens (designer may refine)

| Token | Suggested value | Use |
|---|---|---|
| `--timeline-bg` | `#16161F` (dark, slightly bluer than the `#1A1A2E` surround) | Track-body background; lets thumbnails pop. |
| `--timeline-grid` | `#2A2A38` 1px @ 1s | Gridlines; tinted per track type (video teal-ish, audio amber-ish, caption violet-ish, overlay slate-ish — all low-chroma). |
| `--clip-radius` | `6px` | Clip corner radius. |
| `--clip-default-border` | source-colour, 1px (video default teal `#2DD4BF`-class) | Default clip outline. |
| `--clip-selected` | accent `#3B82F6`-class, 2px | Selected border (distinct from Canva's purple to keep a distinct colour language). |
| `--snap-line` | orange `#F59E0B`-class, 2px | Snap indicator. |
| `--playhead` | red `#EF4444`-class, 2px + 1px dark halo | Playhead line + ruler triangle. |
| `--workarea` | accent @ 18% alpha fill, 2px solid in/out thumbs | Work-area (loop) bar. |
| `--focus-ring` | 2px solid + 2px offset, ≥3:1 both sides (§19.8) | Keyboard focus on clips/headers/handles. |
| `--track-h-video / audio / caption / overlay` | `64 / 48 / 36 / 48` px (caption fixed; others within §3.2 ranges) | Default track heights. |
| `--trim-handle-w` | `8px` (≥24px effective target) | Trim grab zones. |
| `--motion-duration` | `180ms` ease (→ `0ms` under `prefers-reduced-motion`) | Ripple/drag/scroll micro-animations. |

> **Brand note for the designer:** keep the timeline's accent **blue** and snap **orange** distinct from Canva's purple/teal brand pairing, and lean on the dark calm body + crisp NLE handles to read as "pro tool you can trust," not "design template." The chain icon, ghost-extension trim, and orange snap line are the three signature cues that *show* the fidelity promise — give them the most visual care.


---

## 7. Editor — Left Media Panel & Right Inspector

> **Scope guard.** This part designs only what is ✅ in `MVP_Scope.md` (Phase 0). Deferred items — stock library, search/tags/filters, hover-strip, usage badges, full color grade, preset filters, Bezier curve editor, masks/chroma key, EQ/compressor/de-noise/reverb/ducking, image/Lottie overlays, gradient/blur-shadow/inside-stroke text, AI auto-caption, translate/karaoke/find-replace — are **explicitly out** and are noted inline as "Phase 1/2 — not built" wherever the spec's richer surface might tempt scope creep. The two panels here are the **left media rail** (flat library + Text + Captions entry points) and the **right context inspector** (swaps by selection).
>
> **Token note.** All hex/px/ms/rem values below are a *recommended starting system* the designer may refine, not frozen law. Global brand tokens (color ramp, type scale, focus ring, motion durations) are owned by the shared design-token part (Part 1/2 of this design file); this part references those token *names* (`--surface-2`, `--text-1`, `--focus-ring`, `--motion-duration`, `--accent`) and only proposes concrete values where this panel needs something the global system has not yet pinned. Where a value is load-bearing for accessibility (contrast, target size) it is stated as a hard floor, not a suggestion.

---

### 7.0 Brand & layout framing (how these panels read)

VideoForge is a **modern, trustworthy, creator-friendly** browser editor. The wedge — *"what you cut is what you get"* — is a **trust** promise, and these two panels are where that trust is made legible: the inspector shows the *exact* non-destructive parameters that the export `filter_complex` will read (§18 / Market theme 1), never a lossy approximation. Two brand rules govern this part:

- **Canva-adjacent, not a Canva clone.** We mirror Canva's *approachability* (a clean left media rail, friendly empty states, plain-language labels, one-click drag-to-timeline) but diverge toward a **pro-NLE inspector**: numeric scrubber-inputs on every property, a real per-property keyframe lane with diamonds and a stopwatch, and a calm dark-surface palette instead of Canva's bright purple-on-white. Where we knowingly mirror a Canva pattern, it is flagged **`[Canva-pattern]`** with the divergence stated.
- **Distinct colour language.** Canva's signature is violet (`#7D2AE8`-ish) on white. VideoForge diverges to a **cool dark editor canvas with a single warm-forge accent**. Recommended starting accent: **`--accent: #FF6B3D`** (a confident ember/forge orange — the "forge" in VideoForge) used *sparingly* for the primary selection/active state and the keyframe diamond. Secondary/structural accent **`--accent-2: #3DA9FC`** (cool blue) is reserved for the canvas selection box and links so the warm "you are editing this property" signal never competes with the cool "this object is selected" signal. Surfaces are near-neutral with a faint cool cast (`#16161F`–`#22222E`), distinct from both Canva-white and pure-black NLEs.

#### Where these panels sit (recap of §2.1, MVP-trimmed)

```
┌───────────────────────────────────────────────────────────────────────────┐
│ Top Bar (56px)                                              [ Export ▸ ]    │
├──────────────┬──────────────────────────────────────────┬─────────────────┤
│ LEFT MEDIA   │            Canvas / Preview               │ RIGHT INSPECTOR │
│ PANEL        │     (aspect per project: 9:16/16:9/…)     │ (context-       │
│ 280px        │                                           │  sensitive)     │
│ (180–420,    │                                           │ 300px           │
│  rail 48px)  │                                           │ (240–480)       │
│              ├──────────────────────────────────────────┤                 │
│  ▣ Media     │            Transport Bar (48px)           │                 │
│  T  Text     ├──────────────────────────────────────────┤                 │
│  CC Captions │            Timeline (260px, resizable)    │                 │
├──────────────┴──────────────────────────────────────────┴─────────────────┤
│ Status Bar (28px)   00:00:04;12 · 0:30 total · 100% · ⟳ saved              │
└───────────────────────────────────────────────────────────────────────────┘
```

- **Left panel** default **280px**, resizable **180–420px**, collapsible to a **48px icon rail** (`Ctrl+Shift+H`). MVP tab set is trimmed from §2.1's seven tabs to **three**: **Media · Text · Captions**. (Cut for MVP: separate Videos/Audio/Images tabs → folded into one flat **Media** library per scope §3.1; **Stickers** → Phase 2; **Transitions** → the single crossfade is added from a right-click on a cut, no left-panel tab needed for MVP, so we omit the Transitions tab to avoid a one-item rail.)
- **Right panel** default **300px**, resizable **240–480px**. It hosts (1) the **context inspector** that swaps by selection and (2) one **explicit mode**: the **Caption Editor** (`View > Caption Editor`). Auto-hide when nothing is selected and no explicit mode is active (canvas expands); `Ctrl+Shift+P` force-shows. (Export Queue tab from §2.1 is **not** built in MVP — export is a single modal, Part 11.)

---

## 7.A — Left Media Panel

The left panel is the **import → arrange** on-ramp and the home of the two creative entry points that are not "library assets": **Text** and **Captions**. Tabs use the WAI-ARIA Tabs pattern (§19.4): one tab stop, `←/→` move focus, `Enter/Space` activate; tablist is `role="tablist"`, each panel `role="tabpanel"`, the whole panel is `role="complementary" aria-label="Media library"` (§19.5).

```
┌──────────────────────────────┐
│ ▣ Media   T Text   CC Captions│  ← tablist (3 tabs). Active tab: 2px ember
├──────────────────────────────┤     underline + --text-1; others --text-2
│  [ ⬆ Upload media ]  ▣ ▤      │  ← primary upload btn + grid/list toggle
│  ───────────────────────────  │
│  ┌──────┐ ┌──────┐ ┌──────┐   │
│  │thumb │ │thumb │ │ ▣▣▣  │   │  ← 3-col grid (at 280px). Asset cards.
│  │ 0:12 │ │ 0:04 │ │uplng…│   │     duration badge bottom-right;
│  └──────┘ └──────┘ └──────┘   │     uploading card shows ring progress
│  ┌──────┐ ┌──────┐ ┌──────┐   │
│  │ ♪    │ │thumb │ │thumb │   │  ← audio asset = waveform mini + ♪ icon
│  │ 1:30 │ │ 0:08 │ │ 0:22 │   │
│  └──────┘ └──────┘ └──────┘   │
│                                │
│  (drag any card → timeline)    │
└──────────────────────────────┘
```

### 7.A.1 Tabs / sections (MVP set)

| Tab | Icon | Purpose | MVP behaviour |
|---|---|---|---|
| **Media** | filmstrip `▣` | The flat asset library (video / audio / image, undifferentiated list). | Default tab. Grid of asset cards; upload button; drag-to-timeline. |
| **Text** | `T` | Entry point to add a drawtext-subset text block. | Not a library — a short list of **one** "Add text" action plus (optionally) a couple of plain preset styles (e.g. "Title", "Body", "Caption-style"). Clicking adds a text overlay at the playhead on the active overlay track and selects it, opening the **Text style inspector** (7.B.5). |
| **Captions** | `CC` | Entry point to caption authoring + import. | Two actions: **"Import .srt / .vtt"** (file picker → drops onto the single caption track) and **"Open caption editor"** (opens the Caption Editor mode, 7.C). If no caption track exists yet, the first action creates it. |

> `[Canva-pattern]` Canva surfaces a deep, tab-rich left rail (Elements/Photos/Text/Brand/Apps…). **VideoForge diverges:** a deliberately *flat, three-section* rail for MVP — the wedge is fidelity, not asset breadth. The rail reads as "your stuff + the two things you author" rather than a content marketplace.

### 7.A.2 Media library — asset card & grid

A **flat** library (scope §3.1: no folders, no tags, no search, no filters, no usage badge, no hover-strip in MVP). Grid is the default; a **list** view is a low-cost toggle (filename, type, duration, size) persisted to `localStorage`.

**Asset card (grid):**

```
┌────────────────┐
│   thumbnail     │  ← 16:9 letterboxed thumb from sprite sheet frame 0
│  (sprite frame) │     (audio: waveform-on-dark mini; image: the image)
│             0:12│  ← duration badge (video/audio only), bottom-right pill
├────────────────┤
│ interview_a.mp4 │  ← filename, 1 line, ellipsis-truncated, --text-1
│ MP4 · 42 MB  ⋯ │  ← type · size, --text-2 · kebab menu (⋯) on hover/focus
└────────────────┘
```

- **Recommended sizing:** card width = `(panelWidth − gutters) / cols`; **3 cols at the 280px default** (≈ 80px thumb), reflowing to 2 cols below ~220px and 4 cols above ~360px. Thumbnail aspect locked **16:9**, letterboxed on the card's `--surface-3` so portrait/landscape sources read consistently. Card radius **8px**, 1px `--border` hairline, gap **8px**.
- **Thumbnail source:** the 160×90 WebP **sprite sheet** (scope §3.1 / §15.3) — frame 0 as the static thumb, drawn via CSS `background-position` (never a per-frame `<img>`). Hover-animated strip is **Phase 1 — not built**; the card stays static in MVP.
- **Type affordance:** video = thumbnail; **audio** = waveform mini-render on a dark field + small `♪` glyph (no thumbnail exists); **image** = the image itself. Type is **never colour-only** — the glyph + the type text in the meta line carry it (§19.8 use-of-colour).
- **Accessibility:** each card is a focusable node, accessible name `"<filename>, <type>, <duration>, <state>"` (e.g. `"interview_a.mp4, video, 12 seconds, ready"`). Card hit target ≥ **44×44** (well above the §19.5 24px floor). The kebab (⋯) menu opens with `Menu`/`Shift+F10` and is ≥ 24×24.

### 7.A.3 Asset states: `uploading → processing → ready` (and failed)

This is a **trust surface**: a creator must always know whether an asset is safe to use. We map the server `PROCESSING → READY` to the client lifecycle (scope §3.1, `asset:ready` WS) and show it *on the card*, not only in a toast.

| State | Card appearance | Draggable? | Notes |
|---|---|---|---|
| **Uploading** | Dimmed thumb (or placeholder), a **circular determinate progress ring** over the centre + `"Uploading 62%"` text under it; resumable-chunk progress drives it. | No (card shows `not-allowed` on drag) | Resumable chunked upload (scope §3.1). If the tab/network drops, the ring shows a **paused** state with a "Resume" affordance, not a silent failure. |
| **Processing** | Solid thumb appears (first sprite frame may already exist) with an **indeterminate shimmer bar** + `"Processing…"`; proxy/thumbnail/waveform jobs running. | Provisionally — **drag is blocked with an inline tooltip** `"Still processing — ready in a moment"`; the clip cannot land until proxy exists. | This is the proxy-transcode window (≤ 2× realtime SLA). |
| **Ready** | Full thumb, duration badge, no overlay. | **Yes** — drag to timeline. | Fired by `asset:ready`. A brief (~600ms) ember check-pulse on the card confirms readiness; respects `prefers-reduced-motion` (becomes a static check, §19.9). |
| **Failed** | Thumb replaced by a muted error field, `⚠` + `"Upload failed"`; meta line shows a short reason. | No | Card kebab offers **Retry** and **Remove**. Announced `assertive` (§19.7). Ties to Part 16 error handling. |

> Progress also surfaces in the **status bar** and the top-bar **notification/toast** channel (scope §3.11), but the **card is the source of truth** for per-asset state. Under `prefers-reduced-motion`, the shimmer becomes a static "Processing…" label with a stepped/announced percentage (§19.9).

### 7.A.4 Drag-to-timeline

```
   LEFT PANEL                         TIMELINE
  ┌──────┐                       │  V1 ▓▓▓░░░░░│░░░░░░
  │thumb │  ──drag ghost──▸      │  V2 ░░░░░░░░░│░░░░░░
  │ 0:12 │     (50% opacity      │           ▲ playhead — orange snap line
  └──────┘      card preview)    │           └ drops snapped to playhead
```

- **Drag** a *ready* card onto any **compatible** track (video/image → video or overlay track; audio → audio track) or onto the **canvas** (lands on Video Track 1 at the playhead, per §4.3). **Snap-to-playhead on drop** (scope §3.1) with the orange snap line (§3.5); `Alt` disables snap mid-drag.
- **Drag ghost** = a 50%-opacity miniature of the card following the cursor; the target track highlights (`--surface-3` → `--surface-2` lift) and an **insertion caret** shows the drop time. Incompatible tracks show a `no-drop` cursor and do **not** highlight.
- **Keyboard alternative (§19.3, WCAG 2.5.7 — required, not optional):** with a card focused, `Enter` (or kebab → **"Add to timeline at playhead"**) inserts the asset onto the default compatible track at the playhead. This is the non-drag path; it must exist for keyboard/AT parity. Announce: `"interview_a.mp4 added to Video track 1 at 0:04.000"` (§19.7).

### 7.A.5 Rename / Delete (with in-use warning)

Per scope §3.1 ("rename/delete with in-use warning"). Reached via the card **kebab (⋯)** or right-click; both expose the same items, and the menu opens via keyboard (§19.3). MVP menu items: **Rename · Delete · Download original**. (Cut for MVP: Preview-in-full modal, Add-to-Project, Tag — Phase 1.)

- **Rename** — inline edit on the card filename (or a tiny dialog at narrow widths). `Enter` commits, `Esc` cancels. Renames the **library display name**, not the immutable S3 original (scope: originals preserved immutable). Validates non-empty; trims; keeps extension visible but non-editable.
- **Delete with in-use warning** — if the asset is referenced by one or more clips in **this** project, deleting must **not** silently orphan the timeline. Show a confirmation dialog (`role="dialog"`, focus-trapped, `Esc` returns focus — §19.4):

```
┌─────────────────────────────────────────────┐
│  Delete "interview_a.mp4"?                    │
│                                               │
│  ⚠ This asset is used by 3 clips in this      │
│    project. Deleting it will remove those     │
│    clips from your timeline.                  │
│                                               │
│        [ Cancel ]   [ Delete asset & clips ]  │
└─────────────────────────────────────────────┘
```

  - The warning states the **exact count** and the consequence in plain language (trust > cleverness). The destructive button is the only ember/danger-styled control; **Cancel** is the default focus.
  - If the asset is **not** in use, the dialog still confirms (`"Delete \"clip.mp4\" from your library?"`) but without the clip-removal clause.
  - MVP scope is **this project only** (single-user, one implicit workspace — scope §3.10). The §4.3 "count across all projects" badge/usage-list is **Phase 1 — not built**; do not promise cross-project usage in the dialog copy.
  - Deletion of in-use assets is undoable (Ctrl+Z restores asset reference + clips, per the 200-op stack, scope §3.9). The dialog may note `"You can undo this."` to lower the stakes (anti-Canva-data-loss posture, Market theme 6).

---

## 7.B — Right Inspector (context-sensitive)

The right panel's **inspector** content is determined by the **current selection**. It is the most "pro-NLE" surface in the product and the place the fidelity promise is shown as concrete numbers. One inspector is visible at a time; multi-select shows shared properties only (or a count + "multiple selected" with the common subset editable).

### 7.B.0 Selection → inspector routing

| Selection | Inspector shown | Sections (tabs within the inspector) |
|---|---|---|
| **Video / image clip** | Clip inspector | **Properties** · **Color** · **Animate** (keyframes) |
| **Audio clip** | Audio inspector | **Audio** · **Animate** (volume envelope only) |
| **Text overlay** | Text inspector | **Text** · **Properties** (transform) · **Animate** |
| **Caption block** *(or `View > Caption Editor`)* | **Caption Editor mode** (7.C) | (full-panel list, not the property inspector) |
| **Transition (crossfade) block** | Transition mini-inspector | Duration field + interpolation (Linear/Ease). *(One transition type in MVP — no type picker.)* |
| **Nothing** | Auto-hidden (canvas expands), unless `Ctrl+Shift+P` forces a placeholder | Empty state: `"Select a clip to edit its properties."` |

- The inspector header always shows **what is selected** (icon + name + track) so context is never ambiguous: e.g. `▣ interview_a.mp4 · V1`.
- Within an inspector, **tabs** are a compact segmented control (≤ 3 segments). `[Canva-pattern]` Canva uses a top tab strip on its right panel; **VideoForge diverges** by making each tab a *parameter group with numeric inputs + per-property keyframe affordances*, not preset galleries.

#### Shared control vocabulary (used by every inspector below)

These are the reusable primitives; the designer should style them once as tokens and reuse.

| Control | Spec | A11y / behaviour |
|---|---|---|
| **Scrubber-input** (the workhorse) | A numeric field with a draggable label. Drag the label left/right to scrub the value (fine = `Shift`); type a value directly; `↑/↓` step by 1, `Shift+↑/↓` by 10. Shows unit suffix (`%`, `°`, `px`, `dB`). | Focusable input; `aria-valuenow/min/max/valuetext`; keyboard step = the non-drag alternative (§19.3, 2.5.7). Hit target ≥ 24px tall. |
| **Slider** (bounded params) | Track + thumb; numeric scrubber-input pinned to its right; a **reset-to-default** dot/tick at the neutral value (e.g. center for color grade). Double-click thumb resets. | `role="slider"`; arrow-key steps; reset is keyboardable. |
| **Keyframe toggle** (◇ stopwatch) | A small **diamond/stopwatch** glyph at the **right end of an animatable property row**. Off = hollow diamond (`--text-2`); on = filled ember diamond (`--accent`) and the row gains a mini keyframe lane (7.B.6). | `role="switch" aria-checked`, `aria-label="Animate <property>"`. Colour is never the sole signal — filled vs hollow shape + label state. |
| **Color swatch** | Swatch opens a hex/RGB/HSL picker popover; shows the current hex inline. | Focusable; hex is editable as text. |
| **Segmented tabs** | The inspector section switcher. | ARIA Tabs pattern. |

Every property row reads: **`label … control … [◇]`** (label left, control center/right, keyframe diamond far-right when animatable).

---

### 7.B.1 Clip — Properties (transform + speed)

Shown for a selected **video/image clip** (the "Properties" tab). MVP fields map 1:1 to the §18 clip model: percentage geometry + `scale`/`rotation`/`opacity` + `speed`. **No** blend mode (Normal only), **no** mask, **no** crop in MVP.

```
┌──────────────────────────────────────────────┐
│ ▣ interview_a.mp4 · V1            [ ⌫ delete ] │  ← inspector header
│ ┌──────────┬────────┬──────────┐               │
│ │Properties│ Color  │ Animate  │               │  ← segmented tabs
│ └──────────┴────────┴──────────┘               │
│                                                │
│  TRANSFORM                                     │
│  Position X   [  50.0 ] %                  ◇   │  ← canvasX% (0–100)
│  Position Y   [  50.0 ] %                  ◇   │  ← canvasY%
│  Scale        [ 100.0 ] %    ———)————       ◇   │  ← maps to width%/height%
│  Rotation     [   0.0 ] °    —)———          ◇   │
│  Opacity      [ 100   ] %    ————————)      ◇   │
│                                                │
│  TIMING                                        │
│  Speed        [ 1.00 ] ×     —)————————        │  ← 0.1×–16×, no ◇ (not keyframed)
│                  ⓘ Audio pitch preserved on    │
│                    export                      │
└──────────────────────────────────────────────┘
```

- **Position X / Y** — percentage of canvas (0–100), resolution-independent (§18 invariant; this is *why* exports don't drift). Keyframeable (◇).
- **Scale** — a single percentage (recommended **10–400%** UI range); under the hood drives `width%`/`height%` proportionally. Keyframeable (◇). (Non-proportional resize is a canvas-handle action, not an inspector field, in MVP.)
- **Rotation** — degrees, −180…+180 (or 0–360). Keyframeable (◇).
- **Opacity** — 0–100%. Keyframeable (◇). (The composite is bottom-up per-track, scope §3.3.)
- **Speed** — `0.1×–16×` (scope §3.2/§3.7). **Not keyframeable** in MVP (no speed ramping — Phase 2). The **`ⓘ` pitch-preserved note** is a deliberate trust microcopy: it tells the creator the export uses pitch-preserving `atempo` (scope §3.8), pre-empting the "my audio sounds chipmunked" worry.
- **Position/Scale/Rotation/Opacity** are exactly the four §18 keyframable transform properties; the **Animate** tab (7.B.6) is where their keyframe lanes live, but the **◇ on each row** is the *same control* and toggling it here jumps focus into Animate.

> `[Canva-pattern]` Canva exposes position/size via on-canvas handles and a thin "Position" popover. **VideoForge diverges** by giving every transform a **numeric scrubber-input with a keyframe diamond inline** — the precise, animatable control set Canva lacks (Market theme 4, "single biggest limitation").

---

### 7.B.2 Clip — Color (one color grade)

The **Color** tab of a video clip. MVP ships **exactly one** color-grade effect with **three** sliders — this is the deliberate WebGL-preview ↔ FFmpeg-`eq`-export parity probe (scope §3.7 / risk #1). Do **not** design hue/sharpness/blur/shadows/highlights/temp/tint/vignette/LUT — all **Phase 2 — not built**.

```
┌──────────────────────────────────────────────┐
│ COLOR GRADE                          [ Reset ] │
│                                                │
│  Brightness   −100 ——•———— +100   [  0 ]   ◇   │  ← center = neutral
│  Contrast     −100 ————•——— +100   [  0 ]   ◇   │
│  Saturation   −100 ————•——— +100   [  0 ]   ◇   │
│                                                │
│  ⓘ Applied live in preview; exported via       │
│    FFmpeg eq — preview and export match.       │
└──────────────────────────────────────────────┘
```

- Three sliders, each **−100…+100, default 0**, with a **center detent / neutral tick** and double-click-to-reset (and a panel-level **Reset** that zeroes all three). Mapping to FFmpeg `eq` is implementation detail (brightness `value/100`; contrast/saturation `1+(value/100)` per §6.1) — the **designer only needs the −100…+100 / default-0 UX**, but the neutral-center affordance is important so "default" visibly means "unchanged."
- **Keyframeable (◇)** — color values are animatable per §6.5; in MVP this is allowed but secondary (the headline keyframe story is transforms).
- The **`ⓘ` parity microcopy** reinforces the wedge: it states plainly that what you see is what you'll get. This is brand-load-bearing, not decoration.

> Color values that are not 0 should also surface a subtle **"graded"** dot on the clip in the timeline (Part 3 owns that), so the effect is discoverable from the timeline — but that's a cross-reference, not this part's control.

---

### 7.B.3 Audio inspector (volume / pan / fades / envelope)

Shown for a selected **audio clip**. MVP audio is intentionally lean (scope §3.4): **per-track volume + pan + mute/solo**, **per-clip gain + linear fades**, **per-clip volume-envelope keyframes**. **No** EQ, compressor, de-noise, reverb, pitch, ducking, meters/LUFS — all **Phase 1/2 — not built**.

```
┌──────────────────────────────────────────────┐
│ ♪ music_bed.mp3 · A1             [ ⌫ delete ]  │
│ ┌────────┬──────────┐                          │
│ │ Audio  │ Animate  │                           │
│ └────────┴──────────┘                          │
│                                                │
│  CLIP                                          │
│  Gain         [ 0.0 ] dB     ————)———          │  ← per-clip Gain Node
│  Fade in      [ 0.40 ] s     [handle on clip]  │  ← afade on export
│  Fade out     [ 0.60 ] s     [handle on clip]  │
│  Volume envelope ……………………………… [ ◇ Animate ]    │  ← opens Animate tab
│                                                │
│  TRACK  (applies to all clips on A1)           │
│  Volume       [ 100 ] %      ————————)         │  ← 0–200%
│  Pan          L —————•————— R  [  0 ]          │  ← −100…+100
│  [ M Mute ]  [ S Solo ]                        │  ← respected on export
│                                                │
│  ⓘ Master monitor volume is preview-only and   │
│    does not change your export.                │
└──────────────────────────────────────────────┘
```

- **Clip Gain** — recommended dB-labelled (or % to match track). Drives the per-clip Gain Node; exported as `volume` (scope §3.4).
- **Fade in / Fade out** — numeric seconds in the inspector **and** draggable triangular handles on the clip's top corners in the timeline (Part 3 owns the on-clip handles; the inspector mirrors the values). Linear ramp → `afade` on export. *This is a concrete Canva gap (Market theme 3: "no way to fade volume up/down").*
- **Volume envelope** — the **keyframed per-clip gain automation**. The inspector row is a shortcut into the **Animate** tab (7.B.6), where the envelope shows as a keyframe lane scoped to the clip. This is the **audio side of the shared keyframe engine** (scope §3.4 / §6.5) — same diamonds, same Linear/Ease.
- **Track** group (Volume / Pan / Mute / Solo) is shown here for convenience but is a **track** property — editing it affects all clips on A1, and the **track headers in the timeline carry the canonical M/S toggles** (Part 3). Mute/solo are **respected on export** (muted dropped from `amix`; any solo drops non-soloed — scope §3.2) — surface this so users trust the mix they hear is the mix they get.
- Mute/Solo are **`role="switch"`** with icon+label (never colour-only). The **`ⓘ` master-monitor note** prevents the "I turned my volume down and the export is quiet" confusion (master gain is preview-only, scope §3.3).

---

### 7.B.4 Text style inspector (drawtext-subset only)

Shown for a selected **text overlay**. **Critical scope discipline:** MVP text is the **`drawtext`-reproducible subset** so it renders identically server-side without rasterization (scope §3.6, parity). The inspector must **not** expose features that force the RGBA-PNG/`overlay` fallback. Concretely:

**In MVP (drawtext-safe):**

| Control | Range / options | Maps to (FFmpeg `drawtext`) |
|---|---|---|
| Font family | A **curated short list** of bundled, license-clear fonts (e.g. 6–10), not the full 1,400-font Google list. | `fontfile` |
| Font size | 8–400 logical px | `fontsize` (scaled on export) |
| Text color | **Solid** hex/RGB/HSL only | `fontcolor` |
| Outline / stroke | Color + width 0–20px, **outside only** | `borderw` / `bordercolor` |
| Shadow | Color + X/Y offset, **no blur** | `shadowcolor` / `shadowx` / `shadowy` |
| Opacity | 0–100% (keyframeable ◇) | alpha |
| Alignment | L / C / R | layout |

**Explicitly NOT in the MVP text inspector (would break parity → Phase 2 — not built):** gradient fills, **inside/centre** stroke positions, **blurred** shadows, background pill/box fills, letter-spacing/line-height fine controls, text-transform, font weight as a free axis, entry/exit text animations, image/sticker overlays. Each of these forces server rasterization (§8.1 v1.1 notes) and is a parity risk we are not taking in Phase 0.

```
┌──────────────────────────────────────────────┐
│ T  "Summer Sale" · OV1           [ ⌫ delete ]  │
│ ┌──────┬────────────┬──────────┐               │
│ │ Text │ Properties │ Animate  │                │
│ └──────┴────────────┴──────────┘               │
│  ┌──────────────────────────────────────────┐ │
│  │ Summer Sale                                │ │ ← editable text content
│  └──────────────────────────────────────────┘ │
│  Font    [ Inter Display      ▾ ]              │ ← curated list (not 1,400)
│  Size    [ 96 ] px        L  [C]  R            │
│  Color   [■ #FFFFFF ]                          │
│  Outline [■ #111111 ]  width [ 4 ] px  ⓘ outside│ ← "outside" is fixed, no picker
│  Shadow  [■ #000000 ]  X [ 2 ] Y [ 2 ] px      │ ← no blur field by design
│  Opacity [ 100 ] %                         ◇   │
│                                                │
│  ⓘ Styles shown here render identically in your │
│    export (no server rasterization).            │
└──────────────────────────────────────────────┘
```

- The **Properties** tab on a text overlay reuses 7.B.1's transform set (position %, scale, rotation, opacity) — text is positioned by percentage and selectable bi-directionally canvas↔timeline (scope §3.6 / §2.2).
- The **`ⓘ` "renders identically"** note is again brand-load-bearing: it tells the creator *why* the text controls feel intentionally restrained. Frame the constraint as a fidelity feature, not a limitation.
- **Inline canvas editing:** double-click the text on canvas to edit content (§2.2); the inspector and canvas stay in sync. While the inline editor is focused, single-key shortcuts are suppressed (§13 general rule).

> `[Canva-pattern]` Canva's text panel is font-gallery-forward with rich effects (curve, neon, splice, gradient). **VideoForge diverges hard:** a small, parity-safe control set with a stated guarantee that the export matches. We trade Canva's effect breadth for the trust that the text won't shift or re-render differently on download.

---

### 7.B.5 Keyframe controls (diamond / stopwatch + mini lane)

The **keyframe engine is shared infrastructure** (transforms, color values, audio envelope all ride it — scope §3.7/§3.4). Its UI is a single, consistent pattern wherever an animatable property appears, plus an **Animate** tab that aggregates a clip's keyframed properties into stacked **mini keyframe lanes** scoped to the clip's own timeline.

**Per-property affordance (appears inline on any animatable row):**

```
  Position Y   [ 12.0 ] %     ◇          ← ◇ hollow = not animated (static value)

  ── after clicking ◇ (now lit) ──

  Position Y   [ 12.0 ] %     ◆  [+]      ← ◆ filled ember = animated; [+] adds kf
  └ mini lane ─────────────────────────┐  ← lane spans the CLIP's duration only
     ◆────────────◆──────────◆          │  ← keyframe diamonds at clip-relative t
     0:00        0:01.5      0:03  (clip)│
  └────────────────────────────────────┘
```

- **Stopwatch / diamond toggle (◇→◆):** clicking enables keyframe mode for that property; the row gains a **mini lane** bounded by the **clip's** start/end (not the project timeline — §6.5). Off = hollow `--text-2` diamond; on = filled `--accent` diamond. `role="switch"`.
- **Adding a keyframe:** move the playhead within the clip → change the value → a keyframe **auto-creates** at the current clip-relative time; or click **`[+]`** on the lane. (§6.5)
- **Editing / selecting:** click a diamond on the lane to select it (highlights `--accent-2` blue); the property field then shows that keyframe's value; editing updates it. Keyboard: `Tab`/`Shift+Tab` move between keyframes, `←/→` nudge selected keyframe time by 1 frame, value edited via the row's scrubber-input (§19.3 envelope-keyframe mapping).
- **Deleting:** select a diamond → `Delete`. **Single-keyframe state is legal** (value held constant for the whole clip, stopwatch stays lit — §6.5 v1.1 rule). Reverting to a static value happens only when the **last** keyframe is deleted *or* the user clicks the stopwatch off — at which point the property takes its current evaluated value as its new static value (§6.5). The inspector copy should make this non-scary (e.g. a tooltip on the lit stopwatch: `"Click to stop animating and keep the current value."`).
- **Interpolation — MVP = Linear / Ease only.** Right-click a keyframe (or a small inline menu on the selected keyframe) → **Linear** | **Ease**. That is the entire MVP set per scope §3.7. **Bezier curve editor, Ease-In/Ease-Out/Constant as separate modes are Phase 2 — not built.** (The §6.5 six-mode list is the full-spec superset; clamp the design to two.) Represent the chosen mode with a tiny glyph on the segment between keyframes (straight line = Linear, slight curve = Ease) — not colour alone.

```
  Interpolation (selected keyframe):   ( Linear | Ease )    ← 2-option segmented
```

**Animate tab (aggregated lanes for the selected clip):**

```
┌──────────────────────────────────────────────┐
│ ANIMATE · interview_a.mp4   (clip 0:00–0:03)   │
│  ┌ playhead ▼ (clip-relative)                  │
│  Opacity    ◆──────────◆────────────◆          │
│  Scale      ◆────────────────◆                 │
│  Position X (◇ not animated — click to add)    │
│  Position Y ◆──────◆                            │
│  Rotation   (◇ not animated)                    │
│                                                │
│  Selected keyframe:  Scale = 118%  @ 0:01.5     │
│  Interpolation  ( Linear | Ⓔ Ease )             │
└──────────────────────────────────────────────┘
```

- Lanes are **clip-relative** and share one playhead marker. Only **animatable** properties for that selection type appear (transforms + opacity + color for video; **only the volume envelope** for audio).
- **Ken Burns** (scope §3.7) is *not a separate panel* — it is "set Scale + Position keyframes at clip start and end." Provide a small **"Pan & Zoom" preset** affordance in the Animate tab that drops two keyframes (start/end) on Scale + Position so the common motion is one click, then editable as ordinary keyframes. (Procedural shake from §6.3 is **Phase 2 — not built**.)

> `[Canva-pattern]` Canva animates whole pages with preset in/out — no per-property keyframes. **VideoForge diverges decisively:** per-property diamonds + a clip-scoped lane are the headline answer to Market theme 4. This is where VideoForge feels like a *real NLE*, and the design should let it look precise (thin lanes, crisp diamonds, monospace timecodes) rather than playful.

---

## 7.C — Caption Editor mode (table)

Reached via **Captions tab → "Open caption editor"**, by selecting any caption block, or `View > Caption Editor` (§9.2). This is an **explicit right-panel mode** (not selection-driven), so it stays open with nothing selected and takes precedence over auto-hide (§2.1). When wider, it may use the full right-panel width comfortably.

MVP caption scope (scope §3.5): **import .srt/.vtt**, **hand-author/edit blocks** (#, start, end, text — inline), **one readable default style**, burned-in + sidecar export. **Find&Replace, Translate, Merge/Split, Karaoke, per-block style, AI auto-caption are all Phase 2 — not built** and must not appear in the MVP caption editor (the §9.2 table lists them as the full-spec superset; clamp the design to the four columns + add/delete).

```
┌──────────────────────────────────────────────────────────┐
│ Caption Editor                              [ Import .srt ]│  ← header + import
│ ┌────┬────────────┬────────────┬───────────────────────┐ │
│ │ #  │ Start      │ End        │ Text              chars│ │  ← column headers
│ ├────┼────────────┼────────────┼───────────────────────┤ │
│ │ 1  │ 00:00.000  │ 00:02.000  │ Welcome back to the   │ │  ◀ row highlighted
│ │    │            │            │ channel.          28/42│ │     (playhead inside)
│ │ ── [+ insert] ──────────────────────────────────────── │ │
│ │ 2  │ 00:02.000  │ 00:04.500  │ Today we're building  │ │
│ │    │            │            │ a video editor.   31/42│ │
│ │ 3  │ 00:04.500  │ 00:07.000  │ Let's get started!  19/42│ │
│ └────┴────────────┴────────────┴───────────────────────┘ │
│  3 blocks · 0:07.000 total                                 │
└──────────────────────────────────────────────────────────┘
```

| Behaviour | Spec |
|---|---|
| **Row highlight** | The row whose `[start,end]` contains the playhead highlights (`--surface-3` lift + ember left-edge bar). Bi-directional: clicking a row seeks the playhead to its start. |
| **Inline text edit** | Click the Text cell → inline edit. **Newline = second caption line.** `Enter` commits, `Tab` moves to the next block's text cell (§9.2). |
| **2-line / 42-char limit** | Enforced with the **`NN/42` char indicator** per line; turns red (+ `aria-invalid`) when over (§9.2, §19.5). Hard limit: max 2 lines. |
| **Time edit** | Click Start/End cell → type timecode (`MM:SS.mmm` or frame-aware). `Tab`/`Enter` to commit. **Warns but allows** overlap with neighbours (§9.2) — show an inline `⚠ overlaps #3` hint, don't block. |
| **Add block** | The **`[+ insert]`** affordance between rows inserts an empty block (2s default duration) at that position (§9.2). |
| **Delete block** | Select row → `Delete`, or row kebab → Delete. **Gap remains — no other blocks shift** (§9.2). |
| **Import** | `Import .srt / .vtt` (header button or Captions-tab action) parses onto the single caption track. If a 4-track cap weren't the constraint (it's 1 caption track in Free MVP), importing replaces/appends per Part 9. |
| **Style** | A single **track-level default style** (font / size / color / outline / bottom-third position) editable once for the track — *not* per-block (per-block override is Phase 2). Sized for the project aspect (the 9:16 default reads well). Surface this as a compact "Caption style" sub-panel or a one-row control set, not a full style editor. |

- **Accessibility:** the list is `role="grid"` with `role="row"`/`role="gridcell"` for #, Start, End, Text; `↑/↓` move rows, `Tab` advances cells per the inline-edit rule; the text cell is `aria-multiline="true"`; the char indicator is referenced via `aria-describedby` and goes `aria-invalid="true"` on overflow (§19.5). The active caption under the playhead is announced via the caption `aria-live` region (§19.7, §19.10). All single-letter shortcuts are suppressed while a cell is being edited (§13 general rule).
- **Captions-as-accessibility framing (§19.10):** the editor should gently encourage captions before export (a small "Captions improve accessibility and reach" note), consistent with the export modal's accessible-output nudges (Part 10/11). This is informational, never a paywall or upsell (Free-tier-only MVP; no Upgrade-to-Pro anywhere).

> `[Canva-pattern]` Canva captions are view-only/burned-in and not downloadable as SRT/VTT (Market theme 8). **VideoForge diverges** by making the caption table a *first-class editable artifact* with a clean #/start/end/text grid and **sidecar `.srt`/`.vtt` export** (Part 10) — a concrete, marketable Canva gap closed in MVP.

---

### 7.D — Cross-cutting design notes (apply to both panels)

- **Resizing & collapse.** Left panel `180–420px` (rail `48px`, `Ctrl+Shift+H`); right panel `240–480px` (`Ctrl+Shift+P`). Both splitters are `role="separator"` with `aria-orientation="vertical"`, keyboard-resizable (arrow keys), and ≥ 24px hit width including a hover-widened grab zone.
- **Recommended panel tokens (starting system, designer may refine):** surfaces `--surface-1:#16161F` (deepest), `--surface-2:#1E1E2A` (panel body), `--surface-3:#2A2A38` (cards/rows-hover); text `--text-1:#F2F2F7` (≥ 4.5:1 on `--surface-2`), `--text-2:#A6A6B5` (secondary, verify ≥ 4.5:1 for body / ≥ 3:1 large per §19.8); hairline `--border:#33333F`; warm action `--accent:#FF6B3D`; cool selection `--accent-2:#3DA9FC`; danger reuses `--accent` family with an unambiguous icon. Spacing on an 8px grid (`4/8/12/16/24`); row height **32px** (≥ 24px target floor); panel padding **16px**; control radius **8px**; type: row labels **13px/1.4**, section headers **11px uppercase tracked**, numeric inputs **13px tabular-nums**. All `(fg,bg)` pairings must pass the §19.8 contrast unit tests in CI.
- **Motion.** Tab/section switches and panel show/hide use the global `--motion-duration` (150–250ms ease), collapsing to ≤ 50ms / instant under `prefers-reduced-motion` (§19.9). The card "ready" pulse and any shimmer degrade to static states. Keyframe-lane interactions are not animated decoratively.
- **Focus & SR.** Inspector and caption editor live in the right `role="complementary"` whose `aria-label` switches "Inspector" ↔ "Caption editor" by mode (§19.5). Selecting an object updates the inspector and announces `"Selected: <label>"` (debounced, §19.7). Every drag affordance in both panels (card drag, fade handles mirrored from the timeline, keyframe diamonds, envelope) has the keyboard equivalent defined in §19.3 — this is a **hard requirement** (WCAG 2.5.7), not optional polish.
- **No upsell, ever (MVP).** Neither panel contains an "Upgrade to Pro," locked-feature padlocks, or watermark-removal CTA. The only watermark-related copy lives in the **export modal** (Part 11) as the informational note *"A small VideoForge watermark is added."* Free-tier limits (curated font list, single color grade, single caption track, two interpolation modes) are presented as the product, not as gated teasers.
- **Trust microcopy is a feature.** The `ⓘ` notes ("preview and export match", "pitch preserved", "renders identically", "master volume is preview-only", "you can undo this") are intentional and should be designed as quiet, legible helper text — they are how the *"what you cut is what you get"* promise is felt in the inspector, and they are the brand's answer to Canva's broken-trust moment (Market themes 1, 5, 6).


---

## 8. Export Modal, Progress, Onboarding & System States

> **Scope guard.** This part designs only the MVP surfaces marked ✅ in `MVP_Scope.md`: the collapsed Export modal (MP4/H.264 ≤1080p + Captions), in-modal + backgrounded export progress, upload/processing progress, the import→export onboarding funnel (the TTFE driver), the Chrome/Edge browser gate, and the standard §16 error/edge states. **Out of scope and intentionally absent:** any "Upgrade to Pro" CTA, billing/plan screens, H.265/VP9/ProRes/GIF/audio-only formats, 4K, custom bitrate/codec/sample-rate controls, the Advanced/Metadata tabs of spec §10.1, batch/queue UI, re-export history, AI auto-caption, mobile/touch UI, collaboration/presence. The full spec §10.1 modal has three tabs and seven formats; the MVP modal is deliberately collapsed to two tabs and one format. Where a row would expose a deferred control, it is removed here, not greyed out.
>
> **Token values below are a recommended starting system** the designer may refine; they are concrete so engineering has a default, not a mandate. Colors/spacing/type tokens are owned by Part 1 (Brand & Foundations) — this part references them by name (e.g. `--accent`, `--surface-1`) and only hard-codes where a value is load-bearing for the behaviour described.

---

### 8.0 What this part must prove

These surfaces are where the brand wedge — **"what you cut is what you get"** (Market themes 1 & 5) — either lands or dies in front of the user. The export modal is the moment of trust: it must be transparent about resolution, file size, render time, and the watermark, and it must *never* feel like an upsell funnel. The onboarding funnel is where **TTFE < 10 minutes** (the product north-star) is won or lost. Design priorities, in order:

1. **Transparency over persuasion.** Pre-flight estimates and the watermark note are informational. No dark patterns, no "unlock 4K" teasers. This is the deliberate anti-Canva posture (Market theme 12: "paywalls everywhere", surprise downgrades).
2. **Frictionless first export.** The empty-state funnel collapses the path from zero to a downloaded MP4 into the fewest possible decisions, front-loading the aspect-ratio choice (the one decision we *do* force) and deferring everything else.
3. **Progress you can trust and walk away from.** Export runs server-side and can take time; the user must be able to background it and be reliably notified (in-modal bar → notification bell → completion toast).
4. **Honest failure.** Every §16 error state has a calm, specific, recoverable message — never a generic "something went wrong," never a blame-the-user tone.

---

### 8.1 Canva divergence map (for this part)

| Pattern we mirror from Canva | How VideoForge diverges (and why) |
| --- | --- |
| A single prominent **Export / Download** button top-right; click opens a focused modal. | Same affordance, but our modal leads with **pre-flight truth** (resolution actually rendered, est. size, est. time) instead of jumping straight to "Download." Directly answers the "silent 4K→1080p downgrade" complaint (Market theme 5). |
| Format dropdown in the export sheet. | We **collapse format to a single MP4/H.264 choice** for MVP (no dropdown clutter), and surface **social presets as the primary control** (9:16 / 16:9) since the wedge is creator-first. Canva buries codec; we don't pretend to offer codecs we don't have. |
| Friendly, approachable empty state with a big "create" affordance. | We keep the approachability (Canva's strength) but the empty state is a **funnel with an explicit aspect-ratio chooser and no opinionated default** — vertical and horizontal presented as equals. Canva pushes templates; we push *your media in, your video out*. |
| Watermark on free exports, framed as a reason to upgrade. | We **state the watermark as a neutral fact** ("A small VideoForge watermark is added") with **no upgrade CTA**. The watermark is an abuse deterrent + brand mark, not a paywall lever. This is a deliberate brand-trust divergence. |
| Progress shown inside the export sheet only. | We add a **persistent notification bell + completion toast with a direct download**, so users can background a render and trust they'll be told — countering Canva's "render lockups, lost renders" reputation (Market theme 2). |

The "pro NLE timeline feel" lives in other parts; here, the divergence is **radical honesty + a tighter, opinion-free first-run funnel**.

---

### 8.2 Export Modal (MVP-collapsed)

**Trigger:** the **Export** button in the top bar (56px band, far right; see Part on Editor Shell). Opens a centered modal dialog. Per spec §10.1 this is a **top-bar modal**, not a right-panel mode.

**Modal frame**
- Centered overlay, `role="dialog"`, `aria-modal="true"`, `aria-labelledby` on the title, focus trapped, `Esc` closes and returns focus to the Export button (spec §19.4).
- Width **560px** (single column; the MVP control set is small enough not to need the spec's wider 3-tab layout). Max-height `min(640px, 90vh)` with internal scroll if the viewport is short. Corner radius `--radius-lg` (recommend 16px). Backdrop scrim `rgba(10, 10, 20, 0.6)`, rest of document `inert`/`aria-hidden`.
- Two tabs only: **Format & Quality** | **Captions**. (Spec's Advanced & Metadata tabs are out of MVP scope and omitted.)

#### 8.2.1 Tab A — Format & Quality

```
┌──────────────────────────────────────────────────────────┐
│  Export video                                        [✕]  │
│  ────────────────────────────────────────────────────────│
│  ▸ Format & Quality      Captions                          │  ← tabs
│  ────────────────────────────────────────────────────────│
│                                                            │
│  Preset                                                    │
│  ┌─────────────┐ ┌─────────────┐ ┌──────────────────────┐ │
│  │  ▮ 9:16      │ │  ▬ 16:9      │ │  ⚙ Custom            │ │
│  │ TikTok/Reels │ │  YouTube     │ │  match project       │ │
│  │  1080×1920   │ │  1920×1080   │ │                      │ │
│  └─────────────┘ └─────────────┘ └──────────────────────┘ │
│   (preset matching the project aspect is pre-highlighted)  │
│                                                            │
│  Format     MP4 · H.264              (fixed — best compat) │
│  Resolution [ 1080p ▾ ]   720p · 1080p   (max on your plan)│
│  Frame rate [ 30 fps ▾ ]  24 · 25 · 30 · matches project   │
│                                                            │
│  ┌──────────────────────────────────────────────────────┐ │
│  │  ⓘ  A small VideoForge watermark is added to exports  │ │
│  │     on the free plan (bottom-right).                  │ │
│  └──────────────────────────────────────────────────────┘ │
│                                                            │
│  Estimated size  ~ 24 MB        Estimated time  ~ 35 sec   │
│  ────────────────────────────────────────────────────────│
│                              [ Cancel ]   [  Export  ]     │
└──────────────────────────────────────────────────────────┘
```

**Controls (MVP set):**

| Control | MVP behaviour | Notes / divergence from spec §10.1 |
| --- | --- | --- |
| **Preset (primary)** | Three radio cards: **9:16 (TikTok/Reels)**, **16:9 (YouTube)**, **Custom (match project)**. Selecting a preset sets resolution + frame-rate defaults. The card matching the current project aspect is pre-selected. | Spec lists 8 social presets; MVP keeps the two ✅ social presets (9:16, 16:9) + a Custom that matches the project canvas. IG/Twitter/LinkedIn/Podcast/GIF presets are deferred. Cards (not a dropdown) because preset is the headline decision. |
| **Format** | **Static label "MP4 · H.264"** — not a dropdown. | The spec's format dropdown is collapsed to a single value. No H.265/VP9/ProRes/GIF/audio-only (deferred). Showing it as a label (not a disabled dropdown) avoids implying hidden options. |
| **Resolution** | Dropdown: **720p / 1080p**. Default 1080p. **No option above 1080p exists** in MVP (Free cap is 1080p). | Per spec §10.1/§15.2 the frontend clamps to the plan cap before submission; in MVP there is simply no 4K/2K entry. If the project canvas exceeds 1080p, "Custom/Source" resolves to 1080p and the output is downscaled — surfaced via the pre-flight note (8.2.3), **not** an upgrade prompt. |
| **Frame rate** | Dropdown: **24 / 25 / 30 fps / Matches project**. Default = matches project. | Subset of spec's list (50/59.94/60 deferred with higher-fps export). |
| **Watermark note** | Persistent **informational** callout, not toggleable, no CTA. Copy: *"A small VideoForge watermark is added to exports on the free plan (bottom-right)."* Uses the neutral `ⓘ` info treatment, **not** the warning/upsell treatment. | Spec §10.2: mandatory Free watermark (bottom-right, ~10% width, 70% opacity). **Per product decision: no "Remove watermark / Upgrade" affordance anywhere.** This is the single most important divergence in this part. |
| **Pre-flight estimate** | Live **Estimated size** + **Estimated render time**, recomputed on any control change (see 8.2.3). | Spec §10.2 ✅ requirement; the trust centerpiece. |
| **Actions** | `[Cancel]` (ghost) and `[Export]` (primary `--accent`). `Export` triggers the in-modal progress state (8.3). | — |

> **No custom-watermark row, no chapters, no thumbnail, no deinterlace/denoise/proxy-toggle, no metadata fields.** All are spec §10.1 Advanced/Metadata controls that are out of MVP scope. The "Proxy → source re-link" is **on by default and invisible** to the user; its only user-facing surface is the proxy-downgrade pre-flight warning in 8.2.3.

#### 8.2.2 Tab B — Captions

```
┌──────────────────────────────────────────────────────────┐
│  Export video                                        [✕]  │
│  ────────────────────────────────────────────────────────│
│    Format & Quality      ▸ Captions                        │
│  ────────────────────────────────────────────────────────│
│  How should captions be exported?                          │
│                                                            │
│   ( ) None              No captions in the output.         │
│   (•) Burned-in         Permanently drawn onto the video.  │
│   ( ) Sidecar file      A separate .srt or .vtt download.  │
│         └ format:  [ .srt ▾ ]   .srt · .vtt                │
│                                                            │
│   ⓘ Captions come from your caption track. If it's empty,  │
│     "Burned-in" and "Sidecar" are unavailable.             │
│  ────────────────────────────────────────────────────────│
│                              [ Cancel ]   [  Export  ]     │
└──────────────────────────────────────────────────────────┘
```

| Option | Behaviour | Spec ref |
| --- | --- | --- |
| **None** | Always available. Default **only if the caption track is empty**. | §10.1 Advanced "None" |
| **Burned-in** | Renders captions into the video via FFmpeg `subtitles` with the one default caption style (§3.2). Default selection **when the caption track has content**. | §10.3 burned-in path; §22.3 parity test |
| **Sidecar file** | Produces a downloadable `.srt` **or** `.vtt` alongside the MP4. Sub-radio for format. | §10.1 "Separate .SRT/.VTT" |

- When the caption track is empty: **Burned-in** and **Sidecar** are disabled with the inline `ⓘ` explanation; **None** is auto-selected. Disabled radios still expose `aria-disabled` + the reason via `aria-describedby` (§19.2 3.3.x).
- Tab label shows a subtle dot indicator when a non-None option is active, so the choice is visible without switching tabs.
- This selection feeds the same export submission; switching tabs does not reset Format & Quality choices.

#### 8.2.3 Pre-flight estimate & proxy-downgrade warning

The estimate block is the trust core. It must update **debounced ~250ms** after any control change.

- **Estimated size** = `f(resolution, fps, duration, CRF-18 nominal bitrate)`. Display as `~ NN MB` (or `~ N.N GB` ≥ 1 GB). Prefix with `~` always — it is an estimate, never promised exact.
- **Estimated time** = `f(duration, resolution, track count)` against the §10.2 throughput target (1080p/30 renders ≥ 4× realtime). Display as `~ NN sec` / `~ N min`. If it cannot be estimated, show `~ a minute or two` rather than a spinner.
- **Proxy-downgrade warning (spec §10.2 pre-export warning).** If any clip will render from a proxy because its original is unavailable, show an **amber inline notice** above the actions — *not* a blocking error:

```
  ⚠ One clip (b-roll.mp4) will export from a lower-resolution
    preview copy — its original isn't available. Quality may
    be reduced for that clip.
```

This is the explicit anti-Canva "no silent downgrade" guarantee (Market theme 5; §10.2). It does **not** prevent export; it informs.

- **Over-cap downscale note.** If the project canvas is > 1080p and resolution resolves to 1080p, show a calm note: *"Your canvas is larger than 1080p; the export is scaled down to 1080p."* No upgrade CTA (per product decision and §16.3 — but the MVP message omits the spec's "Upgrade to Pro" sentence).

---

### 8.3 Export progress, backgrounding & completion

Export is a server-side BullMQ → FFmpeg → S3 job (§10.2). The UI spans three places so the user can walk away and still be reliably notified.

#### 8.3.1 In-modal progress (foreground)

On `Export`, the modal body swaps to a progress state (same frame, no jump):

```
┌──────────────────────────────────────────────────────────┐
│  Exporting your video                                [✕]  │
│  ────────────────────────────────────────────────────────│
│                                                            │
│     ████████████████████░░░░░░░░░░░░░░░   58%              │
│                                                            │
│     Rendering…  about 15 sec remaining                     │
│     1080p · MP4 · 9:16 · burned-in captions                │
│                                                            │
│  ⓘ You can close this and keep working — we'll notify you  │
│     in the 🔔 bell when it's ready.                        │
│  ────────────────────────────────────────────────────────│
│                          [ Run in background ]  [ Cancel ] │
└──────────────────────────────────────────────────────────┘
```

- **Bar**: determinate, driven by WebSocket `% complete` (§10.2 / §14.5). Milestone announcements only via `aria-live="polite"` ("Export 25%… 50%… complete") — not every percent (§19.7).
- **State line** under the bar mirrors backend job status: `Queued…` → `Rendering…` → `Finishing up…` → `Done`. ETA shown when available.
- **Reduced-motion** (§19.9): the bar fills via stepped width updates (no shimmer); long ops show textual percentage.
- **`Run in background`** dismisses the modal but keeps the job alive; the bell takes over (8.3.2). **`Cancel`** sends the cancel signal (§10.4 cancel → worker cleanup → status `CANCELLED`) and returns to the settings state.
- If the user closes the modal (`Esc`/`✕`) during render, treat it as **Run in background** (do not silently cancel a paying-no-money-but-still-precious render).

#### 8.3.2 Notification bell (backgrounded)

A bell icon lives in the top bar (§2.1 status surface / §10.2 "progress shown in notification bell on return").

| Bell state | Visual | Behaviour |
| --- | --- | --- |
| Idle | Plain bell, no badge | — |
| Export in progress | Bell with a small **animated ring/dot** (static under reduced-motion) | Clicking opens a popover listing the active export with its live mini progress bar + ETA. |
| Export complete | Bell with a **count badge** (`--accent`) | Popover row shows `✓ Done` + a **Download** button + the file label. |
| Export failed | Bell with a **count badge** in `--danger` | Popover row shows the failure reason (8.6) + **Retry**. |

Popover row anatomy: `[icon] project name · 1080p MP4 · 9:16 — <status / progress / Download>`. Rows persist for the session (and reflect the 7-day download window; see 8.3.3). The bell is the single source of truth when no modal is open.

#### 8.3.3 Completion toast + download

On success, regardless of whether the modal is open:

```
┌───────────────────────────────────────────────┐
│ ✓  Your video is ready                          │
│    summer-promo · 1080p MP4 · 24 MB             │
│                              [ Download ]  [✕]  │
└───────────────────────────────────────────────┘
```

- Toast: bottom-center or bottom-right (consistent with the global toast slot from the Foundations part), `role="status"`, auto-dismiss after ~10s **but the download stays reachable from the bell**.
- If the export modal is still open in its progress state, it instead flips to a success state with the same `[Download]` primary button plus a `[Done]` close.
- **Download** mints a fresh 1-hour signed S3 URL per click (§10.2/§15.3); on a 403 it silently re-fetches `GET /exports/:id` for a new URL (§16.2 pattern). The export remains downloadable for **7 days** — surface this quietly in the bell popover row: *"Available for 7 days."*
- Email is sent only if the render took > 5 min (§10.2) — no UI needed beyond the toast/bell.

---

### 8.4 Upload & processing progress

Two distinct phases the user must be able to tell apart: **uploading** (bytes to S3) and **processing** (server proxy/thumbnail/waveform transcode). Surfaced on each media-library tile and aggregated in a small uploads tray.

```
Media library tile, by phase:

UPLOADING                  PROCESSING                 READY
┌──────────────┐           ┌──────────────┐           ┌──────────────┐
│   ░░▓▓▓░░     │           │  ◌ preparing │           │  [thumbnail] │
│  ▒▒▒▒▒▒▒▒     │           │   preview…   │           │              │
│  intro.mp4    │           │  intro.mp4   │           │  intro.mp4   │
│  ███░░░ 42%   │           │  ▓▓▓▓▓▓░ spin │           │  0:04 · 1080p│
│  [ Cancel ]   │           │              │           │              │
└──────────────┘           └──────────────┘           └──────────────┘
```

| Phase | UI | Source / spec |
| --- | --- | --- |
| **Uploading** | Determinate bar with `%` on the tile + a `Cancel` affordance. Resumable on network drop (§4.2). | §4.2 chunked multipart |
| **Upload interrupted** | Tile shows *"Paused — reconnecting…"* with a quiet retry spinner; auto-resumes from last chunk (max 5 retries). | §16.1 "Upload paused — reconnecting." |
| **Processing** | Indeterminate state: *"Preparing preview…"* with a small spinner/stepped indicator. The clip is **not yet draggable to the timeline.** | §4.2 PROCESSING; `asset:ready` WS event |
| **Ready** | Thumbnail sprite renders; tile becomes draggable; duration + resolution badge. | §4.2 → client `ready` |
| **Duplicate (MD5)** | Quiet toast: *"This file is already in your library. Using existing asset."* No second tile, no upload. | §16.1 dedupe; §4.2 |

- An **uploads tray** (collapsible, bottom-left or anchored to the left panel header) aggregates all in-flight uploads/processing with an overall progress summary, so a multi-file drop doesn't flood the grid. Mirrors the bell pattern but for ingest.
- Announcements: `aria-live="polite"` — "Uploading intro.mp4 42%", "intro.mp4 ready", throttled to milestones (§19.7).
- **A clip can be placed on the timeline only after `ready`.** During processing, dragging is disabled with a tooltip *"Still preparing this clip's preview."* (This is the import half of the TTFE loop; keep it visibly progressing.)

---

### 8.5 Onboarding empty-state funnel (TTFE driver)

This is the single most conversion-critical surface in the MVP: it must drive a first-time user from nothing to a downloaded MP4 in **< 10 minutes** (north-star TTFE), with **>70% first-session export completion**. The one decision we deliberately force up front is **aspect ratio** (the launch "both ratios, no strong default" decision); everything else defers.

#### 8.5.1 New-project / dashboard empty state

```
┌──────────────────────────────────────────────────────────────┐
│                         VideoForge                              │
│                                                                 │
│              Start a new video — pick a shape                   │
│        (no default — vertical and horizontal are equals)        │
│                                                                 │
│   ┌────────┐  ┌────────┐  ┌────────┐  ┌────────┐  ┌─────────┐  │
│   │   ▮    │  │  ▬▬▬   │  │   ◼    │  │   ▯    │  │   ⚙     │  │
│   │  9:16  │  │  16:9  │  │  1:1   │  │  4:5   │  │ Custom  │  │
│   │ Reels  │  │YouTube │  │ Square │  │ IG     │  │ W × H   │  │
│   │TikTok  │  │ Desktop│  │ Feed   │  │portrait│  │         │  │
│   └────────┘  └────────┘  └────────┘  └────────┘  └─────────┘  │
│                                                                 │
│   what you cut is what you get — your timeline = your export.   │
└──────────────────────────────────────────────────────────────┘
```

- **Five aspect cards, none pre-selected** (per launch decision: no opinionated default). Vertical (9:16, 4:5) and horizontal (16:9) and square (1:1) are **equally weighted** — same card size, same visual prominence, ordered but not ranked. `Custom` opens the W×H input (§2.2 min 360×360, max 4096×4096, with the non-standard-ratio warning).
- Selecting a card creates the project with that `CanvasConfig` and lands directly in the editor's **in-editor empty state** (8.5.2). One click = one decision.
- The brand line ("what you cut is what you get") appears here as positioning, reinforcing the wedge at first contact (Market theme 1). It is copy, not a feature.
- **No template gallery, no stock browser** (deferred). The funnel is intentionally *your media → your video*, which is the anti-Canva story.

#### 8.5.2 In-editor empty state (the import nudge)

Once a project exists but has no media, the canvas + timeline show a guided import zone:

```
┌───────────────── editor shell ─────────────────┐
│ top bar: project name · undo/redo · 🔔 · Export │
├───────────┬─────────────────────────┬───────────┤
│  left     │      ┌───────────────┐  │  right    │
│  panel    │      │   ⬆           │  │  panel    │
│  (media,  │      │  Drop media    │  │ (hidden   │
│  empty:   │      │  here, or      │  │  until    │
│  "Add     │      │  [ Import ]    │  │  select)  │
│  your     │      │               │  │           │
│  first    │      │ MP4 · MOV ·    │  │           │
│  clip")   │      │ MP3 · WAV ·    │  │           │
│           │      │ JPG · PNG      │  │           │
│           │      └───────────────┘  │           │
├───────────┴─────────────────────────┴───────────┤
│ timeline (empty): "Your clips will appear here.  │
│  Drag media down to begin." + ghost track rows    │
└──────────────────────────────────────────────────┘
```

- **Single primary action: Import.** Big drop target on the canvas + an `Import` button. Accepted formats listed inline (§4.1 MVP set only: MP4/H.264, MOV/H.264, MP3/WAV/AAC, JPG/PNG).
- The empty timeline shows **ghost track rows** with the hint "Drag media down to begin" so the import→arrange→export path is legible before any clip exists.
- **Progressive disclosure of the next step.** A lightweight, dismissible **3-step progress chip** anchors the funnel toward export:

```
   ●━━━━○━━━━○      Step 1 of 3 · Import your media
   import  edit  export
```

After media lands: step advances to *"Edit — drag a clip to the timeline, then trim it (S to split)."* Once at least one clip is on the timeline, the **Export** button gets a subtle first-time pulse/tooltip: *"Ready when you are — export your video."* The chip is dismissible and never blocks; it's a wayfinding aid, not a wizard.
- **Coachmarks** are minimal (≤ 3): Import, the timeline drop zone, and the Export button. No multi-screen tour. Respect reduced-motion (static, no slide-in; §19.9).
- **TTFE instrumentation hooks** (for §20 funnel events, design-relevant because they shape the surface): `onboarding_project_created` (with aspect), `first_media_ready`, `first_clip_on_timeline`, `export_started`, `export_completed`. The funnel UI should make each of these reachable in the fewest clicks.

---

### 8.6 Browser gate (Chrome/Edge only)

MVP previews via WebCodecs, which is Chrome/Edge-only in scope (§15.1, §3.3 fallback deferred). Safari/Firefox/other get a **gate screen instead of a broken editor** (§15.1, MVP §3.11). The gate is detection-based (feature-detect `VideoDecoder` / WebCodecs, not just UA sniffing, to avoid false negatives).

```
┌──────────────────────────────────────────────────────────┐
│                        VideoForge                           │
│                                                             │
│        VideoForge works best in Chrome or Edge              │
│                                                             │
│   VideoForge uses your browser's hardware video engine      │
│   (WebCodecs) for a fast, responsive preview. Your current  │
│   browser doesn't support it yet, so the editor would be    │
│   unreliable here.                                          │
│                                                             │
│        ┌─────────────┐        ┌─────────────┐               │
│        │  Get Chrome │        │  Get Edge   │               │
│        └─────────────┘        └─────────────┘               │
│                                                             │
│   Detected: Safari 17 on macOS                              │
│   ▸ Continue anyway (not recommended) — preview may not work │
└──────────────────────────────────────────────────────────┘
```

- **Tone: helpful, not punitive.** Explain *why* (the WebCodecs performance promise — Market theme 2), not just "unsupported."
- Two outbound buttons to install Chrome/Edge. Show the detected browser/OS so the user understands the diagnosis.
- A de-emphasized **"Continue anyway"** link (text, not button) for advanced users — but it carries a clear "preview may not work" caveat. (Per MVP scope this is optional; default is to gate. If launch chooses hard-gate, drop this link.)
- Fully keyboard-operable and AA-contrast (§19) even though it's a dead-end screen — it must still be perceivable/operable.
- This screen is the user's **first impression** when they're on the wrong browser, so it carries the wordmark and a calm, on-brand layout — not a raw error page.

---

### 8.7 Error & edge states (from §16)

All errors follow one **error-pattern system** so they're recognizable and trustworthy. Tone rules: specific cause, plain language, a concrete next step, **never** blame the user, **never** a generic "something went wrong," **never** an upgrade CTA in MVP (Free-tier only).

**Severity treatments**
- **Toast** (transient, recoverable, non-blocking): bottom slot, `role="status"` for info / `role="alert"` for assertive errors (§19.7). Auto-dismiss info after ~6–10s; errors persist until dismissed or auto-resolved.
- **Inline notice** (within a flow, e.g. in the export modal): amber for warnings (proceed-able), red for blocking. `aria-live="assertive"` for blocking.
- **Tile/clip state** (ingest or relink problems): the affected media tile or timeline clip is visually flagged (grey-out + `⚠` icon) and described via its DOM-mirror node (§19.6).

#### 8.7.1 Upload errors (§16.1)

| Case | Treatment | Message (MVP copy) |
| --- | --- | --- |
| File too large (per-file limit) | Toast (info-error), client-side reject before S3 | "{filename} is too large. {type} files can be up to {limit}." (e.g. *"logo.png is too large. Image files can be up to 100 MB."*) **No upgrade CTA** — per-file limits are identical across plans (§16.1). |
| Unsupported format | Toast | "Unsupported format: .{ext}. Supported: MP4, MOV, MP3, WAV, JPG, PNG." (MVP format list only — not the spec's MKV/etc.) |
| Upload interrupted | Tile state + quiet toast | "Upload paused — reconnecting." Auto-resume (max 5 retries). |
| Duplicate (MD5) | Toast (info) | "This file is already in your library. Using existing asset." |
| Proxy generation failed | Tile flagged `⚠` + toast | "Couldn't generate a preview for {filename}. The original is still usable for export." Clip remains exportable from original (§16.1) — reinforce, don't alarm. |

> **Storage-quota note:** Free tier has a 2 GB storage limit (§15.2). If hit, message per §16.1/§16.3 but **omit the spec's "upgrade your plan" clause** for MVP — show *"Your workspace storage is full ({used}/{quota}). Delete files to free up space."* (No billing path exists in MVP.)

#### 8.7.2 Playback errors (§16.2)

| Case | Treatment | Message |
| --- | --- | --- |
| Proxy URL expired | Silent auto re-fetch; if it fails → clip flagged | Clip greyed with "⚠ Reconnect" icon (§16.2). No modal. |
| Codec/decode unavailable | Console only; surface only if truly unplayable | "Playback unavailable for this clip. Export will still work." (Reassures: the export path is independent.) |
| Frame-decode overrun | Status-bar chip, automatic | "⚡ Performance mode" — auto-switch to quarter-res Low rendition (§4.2/§16.2). **Never silently drop frames** (the responsiveness promise, Market theme 2). |

#### 8.7.3 Export errors (§16.3)

| Case | Treatment | Message + recovery |
| --- | --- | --- |
| Source file missing (no proxy fallback) | Modal flips to failure state + affected clip highlighted in project | "Source file {name} is unavailable. Re-upload it and try again." `[Highlight clip]` + `[Close]`. |
| FFmpeg / encode error | Failure state in modal + bell badge (danger) | "Export failed. We've been notified — you can retry." `[Retry]` (re-submits same settings) + `[Cancel]`. Calm, owns the fault ("we've been notified"), not the user's. |
| Worker timeout | Auto re-queued once; only surface on 2nd failure | First timeout: silent re-queue (state line stays "Rendering…"). Second: same as FFmpeg error. |
| Over-cap resolution (canvas > 1080p) | **Pre-flight note, not an error** (8.2.3) | "Your canvas is larger than 1080p; the export is scaled down to 1080p." Export still proceeds. **No "Upgrade to Pro"** (diverges from spec §16.3 copy per product decision). |
| Proxy-downgrade (original missing for a clip) | Amber inline notice in modal (8.2.3), non-blocking | "{n} clip(s) will export from a lower-resolution preview copy — originals unavailable." |

> Caption-track-limit and HDR/H.265-license errors from §16.3 are **out of MVP scope** (single caption track; no HDR/H.265) and are intentionally not designed here.

#### 8.7.4 States matrix (summary)

| Surface | State | Trigger | UI treatment | Recoverable? | Spec |
| --- | --- | --- | --- | --- | --- |
| Browser gate | Unsupported browser | No WebCodecs | Full-screen gate, install CTAs, "continue anyway" link | Yes (switch browser) | §15.1 |
| Onboarding | New project | First visit / new project | Aspect-chooser empty state (no default) | n/a | §2.1, launch decision |
| Onboarding | No media yet | Project created, library empty | Import drop zone + 3-step chip | n/a | §2.1 |
| Upload | Uploading | File drop | Tile bar + uploads tray + cancel | Cancel | §4.2 |
| Upload | Interrupted | Network drop | "Paused — reconnecting", auto-resume | Auto | §16.1 |
| Upload | Too large / unsupported | Pre-S3 validation | Toast, reject | Retry w/ valid file | §16.1 |
| Upload | Duplicate | MD5 match | Info toast, reuse asset | n/a | §16.1 |
| Processing | Preparing preview | Upload done | Indeterminate tile spinner, not draggable | Wait | §4.2 |
| Processing | Proxy failed | FFmpeg proxy fail | Tile `⚠`, original still exportable | Use original | §16.1 |
| Asset | Ready | `asset:ready` WS | Thumbnail, draggable | n/a | §4.2 |
| Playback | Performance mode | Frame overrun | Status-bar `⚡` chip, Low rendition | Auto | §16.2 |
| Playback | Clip unplayable | Decode fail | Greyed clip / "export still works" | Re-link/auto | §16.2 |
| Export | Pre-flight | Modal open | Size/time estimate + watermark note | n/a | §10.2 |
| Export | Proxy-downgrade warn | Original missing | Amber inline notice, proceed-able | Re-upload original | §10.2 |
| Export | In progress (fg) | Export clicked | In-modal determinate bar | Cancel / background | §10.2 |
| Export | In progress (bg) | "Run in background" | Bell ring + popover bar | Cancel via bell | §10.2 |
| Export | Complete | Job COMPLETE | Toast + bell badge + Download (7-day) | n/a | §10.2 |
| Export | Failed | FFmpeg/source error | Failure state + Retry, bell danger badge | Retry / re-upload | §16.3 |
| Export | Cancelled | User cancel | Return to settings; status CANCELLED | Re-export | §10.4 |

---

### 8.8 Accessibility & motion notes (cross-cutting, §19)

- **Modal**: focus trap, `Esc` to close + restore focus to trigger, `role="dialog"`/`aria-modal`, backdrop `inert` (§19.4). First focus on the active tab or the modal heading.
- **Tabs**: WAI-ARIA Tabs pattern (`tablist`/`tab`/`tabpanel`), arrow-key navigation, `Enter`/`Space` to activate (§19.4).
- **Preset & caption radio cards**: native radio semantics (`role="radiogroup"`), arrow-key selection, ≥ 24×24 CSS px targets (§19.2 2.5.8). Aspect is conveyed by label + icon, never color alone (§19.8 1.4.1).
- **Progress**: `role="progressbar"` with `aria-valuenow`; milestone `aria-live="polite"` announcements (not per-percent) (§19.7). Errors via the single assertive region (§19.7).
- **Toasts/bell**: `role="status"` for success/info, `role="alert"` for failures; the download link is keyboard-reachable from the bell popover.
- **Contrast**: watermark info callout, amber warning, and red error states each meet ≥ 4.5:1 text / ≥ 3:1 non-text (§19.8) and pair color with an icon + text (info `ⓘ`, warning `⚠`, error) so color is never the sole signal.
- **Reduced motion** (§19.9): export/upload bars fill via stepped updates (no shimmer); onboarding coachmarks and the first-time Export pulse are static; toasts cross-fade ≤ 50ms instead of sliding. The user's media playback is never altered.
- **Skip links & landmarks** apply to the editor shell (owned by the Shell part); these surfaces sit inside `role="main"` (canvas/onboarding), the top-bar `banner` (bell, Export), and the toast/live regions at the app root.


---

## 9. Component Library Inventory

> The MVP component set, enumerated so a designer can produce the visual design and an engineer can implement it without guessing. This is the **shared kit** behind every screen already specced (editor shell, dashboard, auth, export modal, browser gate). Scope is strictly **MVP / Phase-0** (`MVP_Scope.md`): no Pro-upsell components, no collaboration/presence (no avatar-stack, no presence cursor, no comment pin), no billing UI, no AI-caption button, no deep-effects rack, no mobile/touch variants. Where a row says "out of scope," it is named only to mark the boundary.
>
> **Token values are a recommended starting system, not a frozen spec** — the designer may refine. They assume the dark-default theme (see Part 1.5) and the design-token layer that enforces contrast in CI (spec §19.8). Three themes ship (dark / light / high-contrast); every state colour below has a validated counterpart in each.
>
> Cross-references: the **timeline clip block** and **track header** are specified in full in **Part 6 (Timeline)** of this brief and only summarized here for kit-completeness; accessibility behaviours (focus ring, roving tabindex, drag→keyboard equivalents, `aria-*`) tie to **Part 11 (Accessibility)** of this brief and to spec §13 / §19. Foundational scales (spacing, radius, type, motion, color) live in the Foundations parts; this part references their token names rather than redefining them.

---

### 9.1 Kit-wide conventions (apply to every interactive component)

These hold for **all** rows below unless a row overrides them. They exist so each table can stay terse.

| Concern | Convention (recommended starting values) |
| --- | --- |
| **Focus ring** | Single token `--focus-ring`: **2px solid** outline, **2px offset**, colour ≥ 3:1 on both the element and its background (works on the `#1A1A2E` surround and on media clips). Rendered via `:focus-visible` only — shown for keyboard/AT focus, suppressed for plain pointer clicks. `outline` is **never** globally removed without this replacement. (spec §19.4, §19.8 / Part 11) |
| **Target size** | Interactive hit target ≥ **24×24 CSS px**, or maintain 24px spacing (WCAG 2.5.8). Visually smaller controls (e.g. 20px icon glyph) keep a ≥24px padded hit area. Controls that would shrink below 24px on a collapsed track move into an overflow menu rather than render undersized. (spec §19.3) |
| **Keyboard activation** | `Enter` / `Space` activate buttons, switches, menu items. `Esc` cancels/closes overlays and returns focus to the trigger. `Tab` order follows DOM order; no positive `tabindex`. Composite widgets use roving tabindex (one tab stop, arrow keys inside). (spec §19.4) |
| **Name/Role/Value** | Every custom widget exposes accessible name + role + value/state (WCAG 4.1.2). Icon-only controls require `aria-label`. State conveyed by colour is **always** paired with an icon, text, or `aria-*` — colour is never the sole signal (spec §19.8, 1.4.1). |
| **Motion** | State transitions use `--motion-duration` (150–250ms eased). Under `prefers-reduced-motion: reduce` it collapses to ≤50ms / instant, no slide or scale (spec §19.9). |
| **Disabled** | `disabled` controls: ~40% opacity of resting fill, `cursor: not-allowed`, `aria-disabled="true"`, removed from the tab order only if a non-focusable alternative exists; otherwise focusable-but-inert with an explanatory `aria-describedby`. Disabled controls do **not** show hover/active feedback. |
| **Loading** | Async controls show an inline spinner (or skeleton) **in place**, keep their footprint stable (no layout shift), set `aria-busy="true"`, and announce completion via the polite live region (spec §19.7). Long ops also show textual % (reduced-motion safe). |
| **Sizing scale** | Three control heights: **sm 28px**, **md 36px** (default), **lg 44px**. Radius token `--radius-sm 6px` (controls), `--radius-md 10px` (cards/menus), `--radius-lg 16px` (modals). Border 1px `--border` resting. |

State legend used in tables: **D** default · **H** hover · **A** active/pressed · **F** focus · **X** disabled · **L** loading.

---

### 9.2 Buttons

**Anatomy:** `[ optional leading icon | label | optional trailing icon ]` inside a padded pill/rounded-rect; min target 24px, default height 36px (md). Label uses `--text-on-accent` / `--text-default` per variant. Icon is 16–20px, optically centered.

| Variant | Use | Resting visual | Sizes | States (D / H / A / F / X / L) |
| --- | --- | --- | --- | --- |
| **Primary** | The single most-likely action in a context (Export, Create project, Sign in). One per region. | Solid `--accent` fill, `--text-on-accent` label. Distinct **non-purple** ember/electric accent (Part 1.4). | sm/md/lg | D accent fill · H +6% lightness · A −6% + 1px inset press · F focus ring · X 40% opacity · L spinner replaces leading icon, label dims, width frozen, `aria-busy` |
| **Secondary** | Common but non-primary action (Cancel, Back, secondary tab action). | Transparent fill, 1px `--border`, `--text-default` label. | sm/md/lg | D outline · H `--surface-raised` fill · A −4% surface · F ring · X 40% · L spinner |
| **Ghost** | Low-emphasis / in-toolbar / inline actions (panel header actions, "Add keyframe"). | No border, no fill, `--text-muted` label. | sm/md | D text only · H `--surface-raised` fill appears · A −4% · F ring · X 40% · L spinner |
| **Icon** | Square icon-only (transport buttons, panel header tools, top-bar undo/redo). **Requires `aria-label`.** | 20px glyph in 36×36 (or 44×44 lg transport) square. | 28 / 36 / 44 | D glyph `--icon` · H `--surface-raised` bg + `--icon-strong` · A pressed bg · F ring · X 40% · L spinner in place. Toggle-style icon buttons (e.g. snap-on) expose `aria-pressed`. |
| **Danger** | Destructive confirm (Delete project, Delete clip in a confirm dialog). | Solid `--danger` fill or `--danger` outline (use outline for inline, solid in confirm dialogs). | sm/md/lg | D danger · H +6% · A −6% · F ring (danger-tinted, still ≥3:1) · X 40% · L spinner. Always paired with a label, never icon-only for irreversible actions. |

**Keyboard / a11y:** `Enter`/`Space` activate; toggle buttons use `aria-pressed`; loading sets `aria-busy` and disables re-trigger. The top-bar Export is a primary button opening the export modal (focus moves into modal, §9.13). *(Out of scope: split-buttons, FAB, "Upgrade to Pro" button — none exist in MVP.)*

---

### 9.3 Inputs & number steppers

**Anatomy (text/number field):** `[ optional label above | field { optional leading affix · value · optional trailing affix/unit } | optional helper/error below ]`. Field height md 36px, radius-sm, 1px `--border`.

| Component | Variants | Sizes | States |
| --- | --- | --- | --- |
| **Text input** | Default; with leading icon (search); inline (project-name edit in top bar). | sm/md | D 1px border · H border `--border-strong` · A/typing caret + `--accent` border · F ring **and** accent border · X 40% + locked · error `--danger` border + helper text + `aria-invalid` |
| **Number stepper** | Bare numeric; with unit suffix (px, %, °, ms); with −/＋ buttons flanking. Used for canvas Custom W×H, timecode, opacity %, scale %, rotation°, volume %, duration ms. | sm/md | Same as text input, plus: stepper ± are **icon buttons** (24px each) with `aria-label` "increase/decrease <field>". Up/Down arrows step ±1, `Shift` ±10, `PageUp/Dn` ±large. Holding a ± button auto-repeats. Out-of-range → clamp + `aria-invalid` + helper ("min 360"). |
| **Timecode field** | Masked `HH:MM:SS:FF` (or `MM:SS:FF`). | sm/md | Segment-aware: arrows step the focused segment; typing overwrites; commit on `Enter`/blur, cancel on `Esc`. Swallows single-key transport shortcuts while focused (spec §19.3). |
| **Textarea** | Caption block text (2-line, 42 char/line); multiline. | md | Char-count indicator via `aria-describedby`; over-limit → `aria-invalid` + overflow-red flag paired with icon/text (spec §19.5). |

**Keyboard / a11y:** label is programmatically associated (`<label for>` / `aria-labelledby`); errors announced via `aria-describedby` + assertive region for blocking validation (spec §19.7, 3.3.x). Steppers are operable by arrows without mouse (2.5.7).

---

### 9.4 Sliders

Two distinct slider components — a plain value slider and the keyframeable property slider with a diamond. Both share the track/thumb anatomy; the keyframeable one adds keyframe affordances.

**Anatomy:** `[ optional label | track ( filled portion + thumb ) | optional value readout / number-stepper twin ]`. Track 4px, thumb 16px circle, fill `--accent`, rail `--surface-sunken`.

| Component | Use | Anatomy extras | States |
| --- | --- | --- | --- |
| **Single value slider** | Timeline **zoom** (10–2000%), color-grade brightness/contrast/saturation, per-clip gain, master monitor gain, opacity. Pairs with a number-stepper twin showing the exact value. | Tick at default/neutral (e.g. 0 for grade, 100% for gain). Bipolar grade sliders fill **from center**. | D rail+thumb · H thumb grows to 20px, tooltip shows value · A thumb pressed + value tooltip pinned · F ring on thumb · X 40% rail, no thumb interaction · (no loading state) |
| **Keyframeable property slider (diamond)** | Animatable per-clip properties: **opacity, position X/Y, scale, rotation** (and audio volume envelope reuses the same engine). Linear/Ease only in MVP. | A **diamond ◇ keyframe toggle** sits to the left of the property label (the "stopwatch" affordance). Three diamond states: **hollow ◇** = not animated; **filled ◆ amber** = animated, playhead **on** a keyframe; **filled-outline ◈** = animated, playhead **between** keyframes. When animated, the slider track shows small diamond markers at keyframe times; the value readout is the interpolated value at the playhead. | Diamond: D hollow · H tint + tooltip ("Animate <prop>") · A toggles keyframing on/off · F ring. Slider thumb states as above. Adding/editing a value at the playhead with keyframing on **creates/updates a keyframe**; a small contextual "add keyframe at playhead" ghost button appears on hover of an animated row. |

**Keyboard / a11y:** slider is `role="slider"` with `aria-valuemin/max/now` + `aria-valuetext` (e.g. "85%", "12°"). Arrows step ±1 (small), `Shift` ±10, `Home/End` to min/max. The diamond is a `role="switch"` (`aria-checked` = animated) with `aria-label="Animate <property>"`. Keyframe navigation: with the property row focused, `Tab`/arrows move between keyframes; `Enter` adds at playhead; `Delete` removes (mirrors the envelope keyboard model, spec §19.3). Every diamond/keyframe drag has this keyboard path (2.5.7). The value-readout number-stepper twin (§9.3) is the non-drag entry point.

---

### 9.5 Dropdowns / selects

**Anatomy:** trigger `[ label/value · chevron ]` (looks like a secondary button) → floating listbox panel `[ option { check · label · optional meta } ]`, radius-md, `--surface-raised`, shadow, max-height with internal scroll.

| Variant | Use | States |
| --- | --- | --- |
| **Select (single)** | Export format (MP4 — single option, shown but locked), resolution preset, frame-rate, font family, aspect-ratio preset chips' fallback, track-type on add. | Trigger: D/H/A/F/X as Secondary button. Open: panel animates in (≤200ms, reduced-motion = instant). Selected option shows check + `aria-selected`. |
| **Combobox (filterable)** | Font-family picker (typeahead). | Type to filter; `aria-autocomplete="list"`; no-match state shows "No fonts match". |

**Keyboard / a11y:** WAI-ARIA Listbox/Combobox. Trigger `aria-haspopup="listbox"`, `aria-expanded`. Open with `Enter`/`Space`/`↓`; `↑/↓` move active option, `Home/End` first/last, typeahead jumps, `Enter` selects + closes + returns focus to trigger, `Esc` closes without change. Active option tracked via `aria-activedescendant`. Focus trapped in panel while open. *(Note: where a "select" has exactly one MVP option — e.g. format=MP4 — render it as a labeled, disabled-looking but explained control, not a fake choice; transparency over false optionality, per Part 1.2.)*

---

### 9.6 Tabs

**Anatomy:** horizontal `role="tablist"` of tab buttons with an active underline/indicator; each controls a `role="tabpanel"`. Two instances in MVP: the **left-panel** tabs (Videos / Audio / Images / Text / Captions / Transitions — note: no Stickers in MVP scope) and the **right-panel mode** tabs (Inspector / Caption Editor / Export Queue).

| State | Visual |
| --- | --- |
| D (inactive) | `--text-muted` label, no indicator. |
| H | `--text-default`, faint `--surface-raised` bg. |
| A (active/selected) | `--text-strong` label + 2px `--accent` underline indicator; `aria-selected="true"`. |
| F | focus ring on the tab. |
| X (disabled) | 40% opacity, not selectable, skipped by arrows. |

**Keyboard / a11y:** WAI-ARIA Tabs pattern — the tablist is **one** tab stop; `←/→` (or `↑/↓`) move focus between tabs, `Enter`/`Space` activates (manual activation, so arrowing doesn't thrash panels). `Tab` from the active tab moves into its panel. Indicator animation honors reduced-motion. (spec §19.4)

---

### 9.7 Segmented controls

**Anatomy:** a connected row of 2–4 mutually-exclusive options sharing one rounded container with a sliding/selected segment fill. Distinct from tabs: this is a **value picker**, not a panel switcher.

**MVP uses:** caption text-align (L / C / R), interpolation type (Linear / Ease), timeline ruler units (Timecode / Seconds), zoom-quick presets if used.

| State | Visual |
| --- | --- |
| D | Container `--surface-sunken`; selected segment `--surface-raised` fill + `--text-strong`; others `--text-muted`. |
| H | Hovered unselected segment lightens. |
| A | Pressed segment shows inset. |
| F | Ring on the focused segment (or on the group with `aria-activedescendant`). |
| X | Whole control or individual segment at 40%. |

**Keyboard / a11y:** implemented as a radio group (`role="radiogroup"`, each segment `role="radio"` `aria-checked`) **or** a single-select toolbar; `←/→` move selection, `Space`/`Enter` confirm, one tab stop. Selected-segment fill is paired with text label (color never sole signal). Reduced-motion: fill snaps without slide.

---

### 9.8 Toggles / switches

**Anatomy:** track (pill) + knob; ~36×20px track, 16px knob; label to the left, optional state text/icon to the right.

| State | Visual |
| --- | --- |
| D off | Track `--surface-sunken`, knob left, `--text-muted` label. |
| D on | Track `--accent`, knob right; **paired icon/text** ("On") so color isn't sole signal. |
| H | Knob/track lighten slightly. |
| A | Knob squashes during travel (skipped under reduced-motion). |
| F | Ring around the whole control. |
| X | 40% opacity, knob locked. |

**MVP uses:** safe-zone overlay toggle, rulers toggle, snap-to-grid toggle, reduced-motion in-app override (System/On/Off → use segmented control if 3-state), sidecar-captions "export .vtt on" in export modal.

**Keyboard / a11y:** `role="switch"`, `aria-checked`; `Space`/`Enter` toggles; one tab stop. Knob travel honors reduced-motion.

> **Track-header mute/solo/lock** are *also* `role="switch"` (spec §19.5) but are visually **icon toggles**, not pill switches — see §9.20 (track header) so the timeline reads as a pro NLE, not a settings page.

---

### 9.9 Checkboxes

**Anatomy:** 18px box + label; check/indeterminate glyph.

| State | Visual |
| --- | --- |
| D unchecked | 1px `--border` box, transparent. |
| D checked | `--accent` fill + white check glyph. |
| Indeterminate | `--accent` fill + dash (used for "select all clips" partial state). |
| H | Border `--border-strong` / fill +6%. |
| A | Pressed inset. |
| F | Ring. |
| X | 40%, locked. |

**MVP uses:** export modal options (e.g. "Burn in captions", "Include sidecar .srt/.vtt"), multi-select context affordances, "remember me" on login.

**Keyboard / a11y:** native `<input type=checkbox>` semantics or `role="checkbox"` + `aria-checked` (`mixed` for indeterminate); `Space` toggles; label clickable. Check glyph paired with the always-present label.

---

### 9.10 Context menus

**Anatomy:** floating `role="menu"` panel anchored to the right-click point or a Menu-key invocation; items `[ optional icon · label · optional shortcut hint · optional submenu chevron ]`; separators group sections; radius-md, `--surface-raised`, shadow.

**MVP item sets:** clip/overlay context menu (Cut, Copy, Paste, Delete, Duplicate, Bring Forward/Back, Lock, **Link/Unlink audio**, Change Colour); track-header overflow menu; media-library item menu (Rename, Delete with in-use warning).

| State | Visual |
| --- | --- |
| Item D | `--text-default`; shortcut hint `--text-muted`, right-aligned. |
| Item H / focused | `--surface-active` bg + `--text-strong`. |
| Item A | brief pressed flash, then action fires + menu closes. |
| Item X | 40%, with reason (e.g. "Paste" disabled when clipboard empty). |
| Destructive item | `--danger` label (Delete). |

**Keyboard / a11y:** opens via right-click **and** keyboard (`Menu` key / `Shift+F10`) on the focused clip — every context item has a keyboard path (spec §19.3). `↑/↓` move, `→` opens submenu, `←`/`Esc` closes (returns focus to the originating element), `Enter` activates, typeahead matches first letters. `role="menu"` / `menuitem` / `menuitemcheckbox` (Lock). Focus trapped while open. Common items also have direct shortcuts shown inline.

---

### 9.11 Tooltips

**Anatomy:** small `--surface-inverse` bubble, ~12–13px text, optional shortcut chip (e.g. `S`), 6px radius, arrow pointer; appears after ~400ms hover or on focus.

| State | Behaviour |
| --- | --- |
| Hover | Fades in after delay; follows the anchored element; dismiss on mouse-out / scroll. |
| Focus | Appears on keyboard focus too (so it isn't mouse-only). |
| Reduced-motion | Instant, no fade/scale. |

**MVP uses:** every icon button (transport, undo/redo, panel tools) carries a tooltip with its label **and** keyboard shortcut (spec §19.3 surfacing the §13 set; supports Consistent Help 3.2.6). Truncated labels show full text on hover.

**Keyboard / a11y:** content mirrored to the control's `aria-label`/`aria-describedby` so AT users get it without the visual bubble; tooltip is not the *only* source of an accessible name. Not focus-trapping; `Esc` dismisses a focus-triggered tooltip. Never contains interactive content (use a popover/menu for that).

---

### 9.12 Modals / dialogs

**Anatomy:** scrim backdrop (`--scrim`, ~60% black, `inert` on the rest of the doc) + centered surface card, radius-lg, max-width per type, `[ header { title · close ✕ } | body | footer { secondary · primary actions } ]`.

| Type | Use | Notes |
| --- | --- | --- |
| **Form modal** | **Export settings** (Format & Quality + Captions tab, pre-flight estimate, watermark notice — see §9.13 detail), Custom canvas size, New-Project aspect chooser host. | Tabs inside (Tabs §9.6). Primary = "Export"/"Create". |
| **Confirm dialog** | Destructive confirm (Delete project, Delete in-use media, Unlink audio warning). | Compact; primary is Danger button (§9.2); body states consequence in plain language (Part 1.3 voice). |
| **Informational** | Browser gate (Chrome/Edge required) when rendered as an overlay, proxy→source re-link warning. | May be a full-screen surface for the browser gate (Part 1.5). Informational, never an upsell. |

| State | Behaviour |
| --- | --- |
| Open | Animates in (≤250ms scale+fade; reduced-motion = instant). Focus moves to first control or heading; trigger recorded. |
| Focus trap | `Tab`/`Shift+Tab` cycle within dialog only; backdrop `aria-hidden`/`inert`. |
| Close | `Esc`, ✕ button, backdrop click (for non-destructive only — destructive requires explicit choice), or completing the action → **returns focus to the recorded trigger** (spec §19.4). |
| Loading | Primary button enters loading state (§9.2 L); dialog stays open with `aria-busy` until resolution. |

**Keyboard / a11y:** `role="dialog"` `aria-modal="true"` `aria-labelledby` (title) `aria-describedby` (body). Escapable trap = no keyboard trap (2.1.2). Sticky-band-aware so the dialog/its focused field is never obscured (2.4.11).

---

### 9.13 Export modal — composed reference (not a new primitive)

Called out because Part 1.2 (trust through transparency) makes its content load-bearing. It is a **Form modal** (§9.12) composed of existing primitives, with two tabs (§9.6): **Format & Quality** and **Captions**.

- **Format & Quality:** resolution preset Select (≤1080p, social presets), format shown as MP4 (single locked option, §9.5 note), pre-flight **estimated file size + render time** (read-only badges, §9.16), and the **watermark notice** rendered as an informational inline banner (§9.18) reading *"A small VideoForge watermark is added to your export."* — **no** "remove watermark" CTA anywhere.
- **Captions:** checkboxes (§9.9) "Burn in captions" and "Export sidecar .srt/.vtt" (default on), per Part 1.2.
- **Proxy→source warning:** if an original is missing, a non-blocking warning banner (§9.18) with a "Re-link" affordance, never a silent downgrade.
- **Footer:** Secondary "Cancel" + Primary "Export" (enters loading; progress then surfaces via toast + status bar + notification bell, §9.14/§9.21).

---

### 9.14 Toasts / notifications

**Anatomy:** stacked bottom-or-top-right cards, radius-md, `[ status icon · message · optional action link · dismiss ✕ ]`; auto-dismiss timer for non-critical.

| Variant | Use | Visual / behaviour |
| --- | --- | --- |
| **Info** | "Saving…" rare cases, generic notices. | `--info` accent bar/icon; auto-dismiss ~5s. |
| **Success** | "Export complete — download ready", "Captions imported". | `--success`; may carry a "Download" action link. |
| **Warning** | Proxy-downgrade notice, "Track limit reached". | `--warning`; persists until dismissed or actioned. |
| **Error** | Upload failed, export failed (with retry action). | `--danger`; persists; `role="alert"` (assertive). |
| **Progress** | Upload/transcode/export in flight. | Inline progress bar (§9.16) inside the toast; updates at milestones. |

| State | Behaviour |
| --- | --- |
| Enter | Slides/fades in (reduced-motion = instant). |
| Hover | Pauses auto-dismiss timer; reveals ✕. |
| Action | Action link is a Ghost/secondary button; keyboard-focusable. |
| Dismiss | ✕, or auto-timeout for info/success. |

**Keyboard / a11y:** non-critical toasts post to the **polite** live region; errors/blocking post to **assertive** `role="alert"` (spec §19.7). Toasts are reachable in tab order while present so their action/dismiss are keyboard-operable; they don't steal focus. Status icon paired with text (color not sole signal).

---

### 9.15 Notification bell

**Anatomy:** top-bar **icon button** (§9.2 icon variant) with an optional **count badge** (§9.18) overlay; opens a **popover** panel listing recent async events (uploads, transcodes, exports) with status + timestamp + action (Download / Retry / View).

| State | Visual |
| --- | --- |
| D (no activity) | Bell glyph `--icon`, no badge. |
| D (unread) | Badge with count (`--accent` or `--danger` for failures), `aria-label` includes count. |
| Active job | Subtle indeterminate ring/pulse around the bell while a job is in flight (reduced-motion = static dot). |
| Open | Popover panel (`role="dialog"` or `menu`), list of notification rows; each row = icon + label + status chip (§9.18) + optional action. |
| H / F / A | As icon button. |

**Keyboard / a11y:** `aria-haspopup`, `aria-expanded`; `aria-label="Notifications, N unread"`. Opens with `Enter`/`Space`; arrow-navigable list; `Esc` closes + returns focus. New items also announced via polite live region so a busy bell isn't the only channel. The bell is the persistent home for progress that began in a toast (Part 1.2 / spec §2.1, §10.2).

---

### 9.16 Progress bars

**Anatomy:** track + fill; **determinate** (known %) or **indeterminate** (unknown). Heights: thin 4px (inline/toast), standard 8px (status bar / panels).

| Variant | Use | States |
| --- | --- | --- |
| **Determinate** | Upload %, transcode %, export render %, pre-flight nothing. | Fill animates to value; `role="progressbar"` `aria-valuenow/min/max`. Milestone % announced politely (not every percent, spec §19.7). |
| **Indeterminate** | Queued / starting state before % is known. | Looping shimmer; reduced-motion → stepped/static "Working…" + textual state. `aria-busy`. |
| **Circular (small)** | Inline spinner inside loading buttons / bell ring. | Same semantics, compact. |

**Keyboard / a11y:** not focusable (status, not control). Always accompanied by a textual percentage/label for reduced-motion and AT. Status-bar render progress is inside the `role="status"` region (spec §19.5).

---

### 9.17 Badges & chips

Two families: **badges** (small, status/count, non-interactive) and **chips** (taggy, sometimes selectable). Color always paired with text/icon.

| Component | Anatomy | Variants / states |
| --- | --- | --- |
| **Count badge** | Tiny pill/dot with number, overlaid (notification bell). | Numeric (1–99, "99+"); dot-only for "has unread". `--accent` default, `--danger` for failures. Non-interactive. |
| **Status chip** | Pill `[ dot/icon · label ]`. | **Asset:** Uploading / Processing / Ready / Error (maps `PROCESSING→READY`, spec §4.2) — each a distinct color **and** icon **and** label. **Export/job:** Queued / Rendering / Complete / Failed. **Save status** (status bar): "All changes saved" / "Saving…" (Part 1.3 voice). Non-interactive. |
| **Aspect badge** | Small chip showing the project ratio: `9:16` / `16:9` / `1:1` / `4:5` / `Custom`, optionally with a proportional glyph. | Used on dashboard project cards and in the top bar. Per Part 1.6 the New-Project chooser surfaces all ratios equally with **no pre-selected default** — the badge reflects the chosen ratio afterward; it does not imply a default. Non-interactive (informational). |
| **Track-type chip** | `[ type icon · "Video"/"Audio"/"Overlay"/"Caption" ]` used in track headers and the add-track menu. | Color-coded per track type **and** labeled + iconned (redundant coding, spec §19.8 / 1.4.1). |
| **Selectable chip** | Aspect-ratio choices in the New-Project flow may render as selectable chips/cards. | D / H / **Selected** (accent border + check) / F (ring) / X. As a radio group (§9.7 semantics) with **no default selection** at open. |

**Keyboard / a11y:** non-interactive badges/chips have no focus/keyboard behaviour but expose their text to AT (and update via live region when they reflect changing status). Selectable chips behave as radios/buttons (focus ring, `Enter`/`Space`, arrow nav).

---

### 9.18 Banners / inline alerts (informational surfaces)

**Anatomy:** full-width-in-container strip, `[ status icon · message · optional action ]`, tinted surface per status, radius-sm.

**MVP uses:** export-modal **watermark notice** (info, never upsell), **proxy→source re-link** warning, **track-limit reached** notice, browser-gate body. Distinguished from toasts: banners are **in-flow and persistent** within their surface, not auto-dismissing overlays.

| State | Visual |
| --- | --- |
| Info | `--info` tint + icon. |
| Warning | `--warning` tint + icon (proxy/limit). |
| Error | `--danger` tint + icon. |

**Keyboard / a11y:** if it announces a change, mirror to the appropriate live region; action link is keyboard-focusable. Icon + text (color not sole). The watermark banner is plain information per Part 1.2 — explicitly **no** "Upgrade" action.

---

### 9.19 Avatars

**Anatomy:** circular image or initials monogram on a generated background; sizes 24 / 32 / 40px.

| Use in MVP | Notes |
| --- | --- |
| **Account avatar** (top bar / account menu) | The single signed-in user. Image (from Google OAuth) or initials fallback. States: D / H (ring) / F (focus ring) / open (account menu). |

**Keyboard / a11y:** when it triggers the account menu it's an icon-button (§9.2) with `aria-label="Account"`, `aria-haspopup`. *(Out of scope: collaborator avatar **stacks**, presence rings, the spec §2.1 "collaboration avatars" — MVP is single-user, Part 1.7. Design only the lone account avatar.)*

---

### 9.20 Panel & section headers; resize handles

| Component | Anatomy | States |
| --- | --- | --- |
| **Panel header** | Top strip of left/right panels: `[ title / active-mode label · optional actions (ghost/icon buttons) ]`. Right-panel header reflects the active mode (Inspector / Caption Editor / Export Queue) and its `aria-label` switches accordingly (spec §19.5). | D static; action buttons follow §9.2. |
| **Section header (collapsible)** | Inside the inspector: `[ disclosure chevron · section title · optional reset/ghost action ]`; groups property rows (Transform, Color grade, Audio, etc.). | D collapsed/expanded; H bg lighten; F ring; chevron rotates (reduced-motion = no rotate, swap glyph). `aria-expanded`, `role="button"`, controls a region. |
| **Resize handle (splitter)** | Draggable divider between zones: canvas↔timeline (vertical drag, spec §2.1), left/right panel width, track height. | D thin `--border`; H/F widens + `--accent` tint + resize cursor; A live-resizes; double-click resets to default. Min/max enforced (timeline 180–600px, left 180–420px, right 240–480px). |

**Keyboard / a11y:** splitters are `role="separator"` with `aria-orientation`, `aria-valuenow/min/max` (px), and arrow-key resize (drag has a keyboard path, spec §19.3, §19.5 track-height handle). Collapsible section headers toggle with `Enter`/`Space`. Focus-not-obscured offset accounts for these splitters (2.4.11).

---

### 9.21 Timeline clip block & track header (reference — full spec in Part 6)

Summarized here so the kit is complete; **Part 6 (Timeline)** owns the full anatomy, the pro-NLE feel, and the divergence from Canva's scene strip (Part 1.1, 1.4).

| Component | Anatomy (summary) | States |
| --- | --- | --- |
| **Clip block** | Rounded rect on a track lane: thumbnail-sprite filmstrip (video) or waveform (audio), name label, trim handles at both edges, **chain icon** when audio-linked, keyframe markers if animated, source-colour-coded left accent. Min 1-frame width; virtualized (±200px). | **D** resting outline ≥3:1 on grid (spec §19.8) · **H** edge handles + cursor reveal · **A/selected** `--selection` accent border + handles (matches canvas 8-handle selection language) · **F** focus ring (clips are focusable, roving) · dragging shows snap line (orange) + ghost · trimming shows live duration tooltip · **X** (locked track) dimmed + lock icon, not draggable. |
| **Track header** | Fixed 180px left column row: type icon + track-type chip (§9.17), editable name, **mute / solo / lock** icon switches, colour swatch, height-drag handle, overflow menu (§9.10). | mute/solo/lock are `role="switch"` icon toggles (§9.8 note): off/on each with distinct icon **and** state, ≥24px targets (collapse → overflow if smaller, spec §19.3). Name = inline textbox on activate. |

**Keyboard / a11y:** track-header column is one tab stop with `↑/↓` roving between headers; `Tab` descends into clips; clip row navigation via `←/→` (time order) and `↑/↓` (nearest clip on adjacent row). All clip drags (move, trim, cross-track) have discrete keyboard equivalents — `←/→` nudge, `Ctrl+↑/↓` change track, `[`/`]` trim, `S` split (spec §19.3). Clip = `role="gridcell"`/`button`, `aria-label` from the DOM-mirror string, `aria-selected`. The red playhead is a `role="slider"` over the ruler. (Full grid roles in spec §19.5.)

---

### 9.22 Color / eyedropper picker

**Anatomy:** trigger swatch button → popover `[ hue/saturation field · hue slider · alpha slider (if used) · hex/RGB inputs · eyedropper button · optional recent-swatches row ]`, radius-md.

**MVP uses:** project `canvasConfig.backgroundColor`, caption text/outline/shadow colour, text-block fill/stroke/shadow colour (the drawtext-reproducible subset, `MVP_Scope.md` §3.6), per-clip track colour override.

| Component | States |
| --- | --- |
| **Swatch trigger** | D shows current colour + checkerboard behind alpha; H ring; F focus ring; A opens popover; X 40%. `aria-label="<field> colour, currently <hex>"`. |
| **SV field / sliders** | Draggable thumbs; arrow-key nudge for keyboard (2.5.7). Hue slider and SV field each keyboard-operable. |
| **Hex / RGB input** | Number/text inputs (§9.3); invalid hex → `aria-invalid` + revert on blur. |
| **Eyedropper** | Icon button invoking the **EyeDropper API** (Chrome/Edge — in scope, MVP is Chrome/Edge only, `MVP_Scope.md` §2). D/H/A/F as icon button; while sampling, cursor becomes the OS picker; `Esc` cancels. If API unavailable, the button is hidden (not a broken control), leaving hex/SV entry as the keyboard path. |

**Keyboard / a11y:** popover is a focus-trapped `role="dialog"`; the eyedropper has a non-pointer fallback (hex/SV entry) so colour selection is never mouse-only (2.5.7). Selected colour announced via the field's value; contrast of chosen caption colours is the *user's* content (not app chrome) so it isn't token-validated, but the picker may surface a contrast hint for caption legibility.

---

### 9.23 Out-of-scope components (named to mark the boundary)

Explicitly **not** designed for MVP (deferred per `MVP_Scope.md`): collaborator avatar stacks / presence cursors / comment pins (no collaboration); any "Upgrade to Pro" button, plan-tier cards, billing/payment fields (Free-tier only, Stripe stubbed); the AI auto-caption generate button & accuracy-tier picker; deep-effects panels (LUT browser, curve/Bezier editor, full color-grade rack, EQ/compressor/ducking controls); blend-mode selector; markers/chapters UI, history panel, J/K/L shuttle UI beyond transport; mobile/touch variants of any component; date/range pickers, data tables beyond the caption grid. They are listed so their absence is understood as a deliberate scope decision, not an omission.


---

## 10. Interaction & Motion Specification

> **Scope.** This section specifies the *feel* of VideoForge — pointer interactions, micro-interactions, motion durations/easings, loading, and optimistic-UI behaviour — for the **MVP/Phase-0** surface only (`MVP_Scope.md` §3, §3.11). It honours the motion tokens (`02-design-tokens.md` §2.11), the timeline anatomy (`06-editor-timeline.md`), the canvas/selection model (`05-editor-canvas-transport.md`), and the spec's normative numbers (`VideoForge_Spec_v1.1.md` §2.2, §3.3–§3.5, §13, §19). Token values (px, ms, easings) are a **recommended starting system the designer may refine**; the *behaviours, thresholds, and states* are normative. Deferred gestures (slip, slide, freeze-frame, markers, beat-detect, snap-to-grid, J/K/L shuttle, blend modes, collaboration cursors, mobile/touch) are **out of scope** and must not be drawn.

### 10.0 Motion philosophy — "instant, honest, never bouncy"

The wedge is **trust**: *what you cut is what you get*. Motion must reinforce that the tool is **precise and predictable**, not playful. Three rules govern every interaction:

1. **Direct manipulation is 1:1 and frame-locked.** While the pointer is down on a clip, handle, or playhead, the element tracks the cursor with **zero animation, zero lag, zero easing** — it follows `pointermove` synchronously inside `requestAnimationFrame`. Animation is reserved for *state transitions* (select, drop, snap, error), never for the drag itself. A dragged clip that "eases toward" the cursor would feel like the lag Canva is hated for (Market theme 2).
2. **Confirm, don't decorate.** Every committed edit gets a short, calm confirmation (a settle, a fade, a snap-line flash). Nothing overshoots or springs — `cubic-bezier` curves stay inside `[0,1]` on the Y axis (no bounce). This is the pro-NLE divergence from Canva's springy template animations.
3. **The media is sacred.** Reduced-motion and all chrome easings govern **editor chrome only**. The user's actual project playback in the canvas is **never** slowed, paused, or altered by these tokens or by `prefers-reduced-motion` (§19.9, §10.9). The motion system touches the *frame around* the video, never the video.

**Canva-pattern divergence to state in the design:** Canva animates the *content* (slide/scene transitions, springy element entrances) as a creative feature woven into the chrome. VideoForge keeps a hard wall: chrome motion is utilitarian and sub-250ms; content motion is the *user's* keyframes (Linear/Ease, §6.5), authored deliberately and never auto-applied by the UI.

---

### 10.1 Interaction-timing table (the canonical reference)

All chrome motion references one of these durations + easings. **Never hard-code a duration** — bind to the `--vf-motion-*` / `--vf-ease-*` tokens (§2.11) so the single `--vf-motion-duration` reduced-motion switch works (§19.9). Drag-tracking rows are marked **0ms / synchronous** because they are *not* animations — they are pointer-following.

| Interaction | Duration | Easing token | Notes |
|---|---|---|---|
| Hover feedback (clip handle reveal, button tint, header control) | `80ms` `--vf-motion-instant` | `--vf-ease-standard` | Opacity/tint only; no movement |
| Press / active feedback (button, toggle, transport) | `80ms` `--vf-motion-instant` | `--vf-ease-standard` | Scale to 0.97 max; releases on pointerup |
| Selection bounding-box appear (canvas) | `120ms` `--vf-motion-fast` | `--vf-ease-decelerate` | Box + handles fade+scale 0.96→1.0 from element center |
| Selection bounding-box move/resize/rotate **(active drag)** | **0ms / synchronous** | — | 1:1 cursor tracking inside rAF; no easing |
| Selected-clip outline thicken (1px→2px + accent) | `120ms` `--vf-motion-fast` | `--vf-ease-standard` | Border-color + width crossfade |
| Clip drag — lift (on dragstart) | `120ms` `--vf-motion-fast` | `--vf-ease-standard` | Shadow `--vf-shadow-0→1`, body → 85% opacity |
| Clip drag — follow cursor | **0ms / synchronous** | — | Ghost tracks pointer in rAF |
| Clip drop — settle | `120ms` `--vf-motion-fast` | `--vf-ease-decelerate` | Ghost snaps to final x; shadow returns to 0 |
| Drop-target track highlight (in/out) | `120ms` `--vf-motion-fast` | `--vf-ease-standard` | Track-body tint fade |
| Trim handle drag | **0ms / synchronous** | — | Edge + darkened ghost region track cursor live |
| Trim min-frame hard-stop "nudge" | `140ms` (two-phase, ±2px) | `--vf-ease-standard` | Sub-pixel shake; **suppressed** under reduced-motion |
| Snap line appear / disappear | `90ms` in / `140ms` out | in `--vf-ease-decelerate`, out `--vf-ease-accelerate` | Orange line; see §10.5 |
| Split — divide flash | `160ms` `--vf-motion-base` | `--vf-ease-standard` | Brief seam highlight at cut |
| Ripple shift (downstream clips slide) | `180ms` `--vf-motion-base` | `--vf-ease-standard` | Position tween; instant under reduced-motion |
| Delete — clip fade-out | `160ms` `--vf-motion-base` | `--vf-ease-accelerate` | Fade + 4% scale-down, then layout settles |
| Duplicate — new clip appear | `160ms` `--vf-motion-base` | `--vf-ease-decelerate` | Fades in selected, after original |
| Keyframe add (diamond pop) | `120ms` `--vf-motion-fast` | `--vf-ease-decelerate` | Scale 0.6→1.0 |
| Keyframe drag | **0ms / synchronous** | — | Diamond + interpolation line track cursor |
| Hover-thumbnail scrub | **0ms / synchronous** | — | Frame swap follows pointer x; see §10.7 |
| Panel / timeline resize drag | **0ms / synchronous** | — | Splitter + content reflow live; see §10.8 |
| Timeline / canvas zoom (Ctrl+scroll) | **0ms / synchronous** while wheeling; `120ms` ease on discrete keyboard zoom step | `--vf-ease-standard` | Cursor-anchored; see §10.6 |
| Panel open/close, menu, tooltip, popover | `180ms` `--vf-motion-base` | in `--vf-ease-decelerate`, out `--vf-ease-accelerate` | |
| Tab switch (left panel) | `120ms` `--vf-motion-fast` | `--vf-ease-standard` | Crossfade panel body; underline slides |
| Modal in / out (export, custom-size, confirm) | `240ms` `--vf-motion-slow` | in `--vf-ease-decelerate`, out `--vf-ease-accelerate` | Scrim fades `0→0.64` (§2.1) |
| Toast in / out (notification bell, export-done) | in `220ms` / out `180ms` | in `--vf-ease-decelerate`, out `--vf-ease-accelerate` | Slide+fade from top-right |
| Onboarding step transition | `320ms` `--vf-motion-deliberate` | `--vf-ease-emphasized` | Only on the empty-state funnel |
| Loading skeleton shimmer sweep | `1200ms` loop | linear | JS/CSS loop; **gated** by reduced-motion (§10.9) |
| Spinner rotation | `800ms` loop | linear | Replaced by stepped/static indicator under reduced-motion |

> **Reading the table:** anything a user is *holding the pointer down to manipulate* is `0ms / synchronous`. Anything that happens *after they let go* (or that the system does) gets a sub-250ms eased transition. This split is the heart of the "instant + honest" feel.

---

### 10.2 Drag a clip (move, same-track and cross-track)

The defining gesture of the timeline. Spec: §3.3 move / cross-track; snap threshold **8px at current zoom** (§3.3); `Alt` disables snap (§3.5); `Shift` = swap on cross-track (§13.2).

**Pointer lifecycle**

| Phase | Trigger | Cursor | Visual |
|---|---|---|---|
| Idle | hover clip body | `pointer` | Handles hidden; on hover, trim handles fade in (`80ms`) |
| Arm | `pointerdown` on body | `grab` | No movement yet (avoids jitter on click-to-select) |
| Drag start | pointer moves **> 3px** from pointerdown | `grabbing` | Clip **lifts** (`120ms`): elevated shadow `--vf-shadow-1`, body → 85% opacity; a **faint placeholder** (1px dashed `--vf-border-default` outline, 30% fill) marks the original slot |
| Dragging | `pointermove` | `grabbing` | **Ghost follows cursor 1:1** (synchronous, no easing). Snap line flashes when an edge aligns (§10.5). Live timecode tooltip near the clip's new start edge |
| Cross-track | ghost crosses a track boundary | `grabbing` (or `not-allowed` on incompatible track) | **Drop-target track highlights** (track-body tint to `--vf-surface-2`, `120ms`). Incompatible type (e.g. video→caption) shows `not-allowed` + the track does **not** highlight. `Shift` held → ghost shows a **swap glyph**; default = insert (downstream clips preview their right-shift at 50% opacity) |
| Drop | `pointerup` | `grab`→`pointer` | Ghost **settles** to final x (`120ms` decelerate); placeholder removed; shadow returns to `--vf-shadow-0`; downstream clips commit their ripple slide (`180ms`, §10.4); clip stays selected. Live region announces "Clip moved to track 3" (§19.7) |

- **3px arm threshold** distinguishes a click (select) from a drag. Below 3px on pointerup = a select, not a move.
- **`Alt` during drag** suppresses snapping and hides the snap line for frame-accurate free placement (§3.5); releasing `Alt` re-enables it live.
- **Keyboard equivalent** (no mouse-only operation, §19.3 / WCAG 2.5.7): focused clip → `←/→` nudge 1 frame, `Shift+←/→` 1s; `Ctrl+↑/↓` move to adjacent compatible track. These are discrete, not animated drags.

```
 dragging a clip from V1 → V2 (insert mode):
 V2  [existing]          ░░░░ drop-target highlight ░░░░
                    ┌───────────┐
                    │  ghost ↑  │  ← follows cursor 1:1, 85% opacity, lifted shadow
 V1  [· placeholder ·]  └───────────┘   [next clip »» previews right-shift @50%]
                         ╎ orange snap line when an edge aligns (8px)
```

---

### 10.3 Trim handles (start / end)

Spec: trim min **1 frame** (§3.3); gaps **NOT auto-closed** (§3.3 — anti-ghost-footage); trimmed-out region shown as a **darkened ghost extension** (§6.4 — the signature trust cue); `Ctrl` = ripple trim (§3.3).

| Aspect | Spec |
|---|---|
| Hit area | **8px**-wide grab zone inset at each clip end (§6.4), padded to **≥24px effective** target with spacing (§19.3 / 2.5.8). Reveals on hover (`80ms` fade) and is always present on a selected clip |
| Hover | Cursor → `ew-resize`; the handle brightens; a 1px guide previews the trim edge |
| Active drag | **Synchronous**: the clip edge follows the cursor with no easing. The **trimmed-out source region renders as a darkened "ghost" extension** beyond the visible clip (≈40% opacity, desaturated thumbnail/waveform) so the user *sees exactly what was cut and that it still exists* — the visible answer to Canva's ghost-footage complaint |
| Live readout | A `--vf-font-mono` timecode tooltip pinned to the dragging handle shows the new in/out point (`HH:MM:SS:FF`) and Δ duration, updating every frame |
| Min-frame stop | When the drag would take the clip below **1 frame**, the edge **hard-stops** and the handle plays a brief two-phase ±2px **nudge/shake** (`140ms`) signalling the limit. **Suppressed** under reduced-motion (the edge simply stops; the live readout shows the floor value) |
| Source-end stop | Cannot extend beyond source media start/end (§3.3); same hard-stop nudge at the source boundary |
| Ripple trim | Hold `Ctrl` while trimming → downstream clips on the track slide to fill/create the gap. The slide commits on pointerup with the `180ms` ripple tween (§10.4); during the drag the downstream clips preview-track the edge synchronously |
| Snap | Trim edges snap to clip edges + playhead at the 8px threshold (§10.5); `Alt` disables |
| Keyboard | Focused clip → `[` trim in to playhead, `]` trim out to playhead (§19.3) |

```
 trimming the IN point rightward (gap left, not auto-closed):
  was: [▦▦▦▦▦▦▦▦▦▦▦▦]
  now:        ┊▒▒▒▒│▦▦▦▦▦▦▦│        ← ▒ = darkened ghost of trimmed-out frames
              ↑ live tc: 00:00:01:08  Δ -1.27s
```

---

### 10.4 Split, ripple, delete, duplicate

| Gesture | Trigger | Motion |
|---|---|---|
| **Split at playhead** | `S` (per S-key arbitration §13.2) or right-click → Split. `Shift+S` = all tracks | A **seam highlight** flashes at the playhead cut (`160ms`, `--vf-ease-standard`): a 2px bright line briefly draws down the cut, then the block visibly becomes two independent blocks with a 1px gutter. **Linked audio splits at the same frame simultaneously** (§3.2) — both seams flash together so the user sees the link held. No layout shift (split is in-place) |
| **Ripple delete / ripple trim** | `Ctrl+Delete` / `Ctrl`+trim | Downstream clips **slide** to their new positions over `180ms` (`--vf-ease-standard`) so the cause→effect is legible (you see the gap close). Instant under reduced-motion |
| **Delete (gap left)** | `Delete`/`Backspace` | Clip **fades + scales down 4%** over `160ms` (`--vf-ease-accelerate`), leaving the gap (default, no ripple) |
| **Duplicate** | `Ctrl+D` (after original) / `Ctrl+V` (at playhead) | New clip **fades in selected** over `160ms` (`--vf-ease-decelerate`) in its placed position. Direct counter to Canva's removed page-duplication (Market theme 6) |

All four announce their result politely (§19.7): "Clip split", "Clip deleted", "Clip duplicated", "Ripple deleted — 3 clips moved".

---

### 10.5 Snapping (the orange line)

Spec: snap to clip edges + playhead, **ON by default**; **orange vertical line** across full timeline height (§3.5 / §6.6); threshold **8px at current zoom** (§3.3); `Alt` disables (§3.5). Token: `--vf-snap-line` `#FF8A1F` (§2.5).

| Aspect | Spec |
|---|---|
| Trigger | During a clip move or trim, when the dragged edge comes within **8px (screen-space, at current zoom)** of a snap target (another clip edge, or the playhead) |
| Snap behaviour | The dragged edge **jumps the remaining gap** to the target instantly (no easing on the snap itself — it must feel magnetic and exact, not floaty) and holds there while the cursor stays within an **11px release hysteresis** (3px wider than capture, so the edge doesn't chatter at the boundary) |
| Line appear | The full-height orange line **fades + 2px-grows in** over `90ms` (`--vf-ease-decelerate`) at the snap position, 2px wide, ≥3:1 contrast (§19.8) |
| Line persist | Stays drawn while the edge is held snapped; if multiple edges align at once, the strongest target (playhead > clip edge) is indicated; only **one** line shows |
| Line disappear | Fades out over `140ms` (`--vf-ease-accelerate`) when the edge leaves the hysteresis zone or the drag ends |
| Disable | Holding `Alt` mid-drag suppresses snapping and immediately hides the line; releasing re-arms it |
| Reduced motion | Line appears/disappears **instantly** (no fade) but still draws — it is essential edit feedback, not decoration (§10.9) |

```
        playhead
           │
 [clip A]──┤  ← edge of dragged clip captured within 8px → snaps to playhead
           ┃  ← orange snap line, full height, 2px, fades in 90ms
 [══ A1 ══]┃
```

> **Brand note:** orange snap-line + sky-blue selection + red playhead is the deliberate three-color NLE language that diverges from Canva's purple/teal. Keep these three hues maximally distinct (§2.5) — they are functional, never decorative.

---

### 10.6 Zoom (Ctrl+scroll, cursor-anchored)

Spec: timeline zoom **10%–2000%**, Ctrl+scroll **centred on cursor** (§3.4); canvas zoom **10%–400%**, Ctrl+scroll over canvas (§2.2). These are *different ranges on two surfaces* — do not unify.

| Aspect | Spec |
|---|---|
| Anchor | The point under the cursor stays **pixel-fixed** as the scale changes (compute `newScroll = cursorX − (cursorX − oldScroll) × zoomRatio`). This is the single most important feel detail: the user zooms *into what they're pointing at*, never the viewport left edge |
| Continuous (wheel) | While `Ctrl+wheel` events fire, zoom updates **synchronously per wheel delta** — no easing, no momentum, so it feels locked to the input device. Throttle re-layout to rAF |
| Discrete (keyboard) | `Ctrl+=` / `Ctrl+-` zoom one step **centred on the playhead** (§3.4); each step **eases** over `120ms` (`--vf-ease-standard`) since there is no continuous input to track. `Ctrl+0` = fit all clips (timeline) / `Ctrl+Shift+0` = fit canvas to window |
| Readout | The zoom % in the utility row / canvas HUD updates live in `--vf-font-mono` (no jitter, tabular figures) |
| Limits | At 10% or the max, the wheel zoom hard-stops; the readout flashes the limit value briefly (no shake) |
| Reduced motion | Discrete keyboard zoom jumps instantly (no `120ms` ease) |

---

### 10.7 Hover-thumbnail scrub

A pro-NLE affordance Canva lacks: hovering a video clip body previews frames at the hover position without moving the playhead. Built on the existing WebP **sprite sheet** (1 thumbnail/sec, §4.2) via CSS `background-position` — **never** per-frame `<img>` (§15.3).

| Aspect | Spec |
|---|---|
| Trigger | Pointer hovers a **video** clip body (not a handle), with no button down, after a **120ms dwell** (avoids flicker while passing over) |
| Behaviour | The thumbnail under the cursor swaps to the sprite frame nearest the hovered timeline position; a thin 1px vertical **hover cursor guide** (`--vf-text-tertiary`, distinct from the red playhead) tracks the pointer x. **Synchronous** frame swap — follows the cursor with no easing |
| Readout | A small `--vf-font-mono` timecode chip floats above the hover guide showing the source time at that point |
| Exit | On pointerleave, the clip returns to its default first-frame-per-second strip; guide fades out (`90ms`) |
| Constraint | Frame granularity = sprite resolution (1/sec); the chip rounds to the nearest available sprite frame. This is a *preview-scrub*, not a seek — the playhead and the canvas preview do **not** move |
| Reduced motion | The guide + frame swap still work (essential affordance) but the guide fade is instant |

> Scope note: this is hover-*scrub* on the clip strip. The transport scrub (dragging the ruler / playhead, §6.3) is the separate seek gesture that *does* move the playhead and update the canvas.

---

### 10.8 Panel & timeline resize

Spec: left panel 180–420px, right panel 240–480px, timeline 180–600px, all resizable via splitters (§2.1). Splitter = `role="separator"` with `aria-valuenow` (§19.5).

| Aspect | Spec |
|---|---|
| Hit area | Splitter hit zone **6px** wide (vertical splits) / tall (timeline top edge), padded to ≥24px keyboard target; cursor `col-resize` (panels) / `ns-resize` (timeline) |
| Hover | Splitter line brightens to `--vf-border-strong` (`80ms`) so it's discoverable |
| Active drag | **Synchronous**: the splitter and both adjacent zones reflow live with the cursor — no easing, no deferred "commit on release" (deferring would feel laggy). Content inside (canvas letterbox recompute, timeline virtual-scroll re-measure) updates in rAF |
| Constraints | Drag **hard-clamps** at the min/max; at a clamp the splitter stops dead (no shake — resizing is continuous, a shake would feel broken) |
| Snap-to-default | Optional: a faint detent (subtle resistance + a 1px tick) at each panel's *default* width (280/300/260px) helps users return to the baseline; `Alt` ignores the detent |
| Release | Splitter color returns to `--vf-border-subtle` (`80ms`); new size persisted to local layout state |
| Collapse | Left panel collapses to the 48px icon rail when dragged below ~140px (snaps to rail with a `120ms` settle); re-expands by dragging out or clicking the rail |
| Keyboard | Splitter focusable → `←/→` (or `↑/↓` for timeline) resize in 8px steps, `Home/End` to min/max (§19.5) |

---

### 10.9 Selection bounding box (canvas overlays)

Spec: blue 8-handle bounding box (§2.2); handles 9×9px, hit target ≥24px (§05 / 2.5.8); corner = proportional (Shift = unconstrained), edge = single-axis; rotate handle 20px above top-center, Shift = 15° snap (§2.2). Token: `--vf-selection` `#3B9EFF` + `--vf-selection-halo` (§2.5).

| Phase | Motion |
|---|---|
| Appear (on select) | Box + 8 handles **fade in + scale 0.96→1.0** from the element center over `120ms` (`--vf-ease-decelerate`). Bi-directional with timeline selection (§2.2): selecting the clip on the timeline draws the same box, also `120ms` |
| Move | **Synchronous** 1:1 drag; position stored as `canvasX%/Y%` (§2.2). No easing |
| Resize | **Synchronous**; corner = proportional, `Shift` = unconstrained; edge handle = single-axis. Min 20×20px logical, pixel-snapped — at the floor the handle hard-stops (no shake; resizing is continuous) |
| Rotate | **Synchronous**; `Shift` snaps to 15° increments with a faint detent tick at each snap angle; double-click resets to 0° (the reset *does* animate, `120ms`, so the user sees it return) |
| Canvas snap | Elements snap to canvas edges / center axes / other element edges / guides (§2.2); a 1px guide line appears at the aligned axis (same `90ms` in / `140ms` out as the timeline snap line, but in `--vf-selection` blue on canvas, distinct from the timeline's orange) |
| Deselect | Box fades out over `90ms` (`--vf-ease-accelerate`) |
| Reduced motion | Box appears/disappears instantly; the user's project motion in the frame is untouched (§19.9) |

---

### 10.10 Keyframe add & drag

The keyframe engine is shared MVP infrastructure (transforms, Ken Burns, audio volume-envelope — §6.7). Surface micro-interactions in the per-clip keyframe lane (§6.7) and the right-panel property rows.

| Gesture | Motion |
|---|---|
| **Add keyframe** | Click the lane at a time / `Enter` at playhead / toggle a property's stopwatch. A **diamond pops in** (scale 0.6→1.0, `120ms`, `--vf-ease-decelerate`) at the `timeMs`; the interpolation line redraws to connect it |
| **Drag keyframe (time)** | **Synchronous** horizontal drag along the lane; snaps to the playhead + adjacent keyframes at the 8px threshold (orange line). Live `--vf-font-mono` time chip |
| **Drag keyframe (value)** | In envelope mode (audio volume) or a property row, **synchronous** vertical drag; live value chip (e.g. "+3 dB", "scale 1.24×"). `↑/↓` keyboard adjust ±1% (`Shift` ±10%, §19.3) |
| **Interpolation toggle** | Switching a segment Linear↔Ease redraws the connecting line shape over `120ms`. **Bezier/curve editor is deferred** (§3.7) — do not draw it |
| **Delete keyframe** | `Delete` when a keyframe is focused (§13 reserved-keys) → diamond fades + collapses (`120ms`); line re-bridges the neighbours |

> **Content-domain caution (§2.11):** the keyframe *interpolation* curves (Linear/Ease) belong to the **user's project** and are rendered truthfully in preview and export — they are **not** chrome easing and are **never** reduced by `prefers-reduced-motion`. Only the *editing micro-interactions* above (the diamond pop, the panel transitions) are chrome motion.

---

### 10.11 Loading skeletons & progress

Honest, never-fake feedback (Market theme 1/6: trust). Skeletons match the final layout's shape so there is no reflow jump.

| Surface | Loading treatment |
|---|---|
| **Dashboard project list** | Skeleton cards (matching the project-card shape) with a **shimmer sweep** (`1200ms` linear loop, left→right gradient `--vf-surface-2`→`--vf-surface-3`→`--vf-surface-2`) |
| **Media library tile (uploading/transcoding)** | Tile shows a determinate **upload progress ring**, then on `PROCESSING` an indeterminate shimmer + "Preparing preview…" label until `asset:ready` (§4.2). Resumable-upload state survives a network blip (§4.2) — the ring shows "Paused — retrying" rather than failing |
| **Clip on timeline, proxy not READY** | The clip region renders a **skeleton shimmer + spinner** with "Preparing preview…"; play is disabled with a tooltip (§05). On `asset:ready` the thumbnail strip / waveform fades in (`160ms`) |
| **Canvas, decoding** | Brief skeleton on the viewport region while WebCodecs warms the first frames; never a blank black flash |
| **Export progress** | Determinate bar in the export modal + status bar; milestone announcements ("25%… 50%… complete", §19.7). ETA from `export:progress` (§14.5). On complete, a toast slides in (top-right) with the download |

**Skeleton rules:** (1) shape-matched to final content (no layout shift on load); (2) the shimmer is the **only** indeterminate loop in the chrome; (3) determinate progress (uploads, exports) **always** shows a real percentage, never a fake spinner — concrete progress is a trust signal against Canva's opaque "3 days" renders (Market theme 2).

---

### 10.12 Optimistic UI

VideoForge is single-user with **server-owned monotonic `revision`** + debounced 3s autosave + Ctrl+S (§11.2, MVP §3.9). Edits apply **optimistically** — the local Immer state (and undo stack, §11.3) updates **instantly** on the gesture; the network save happens in the background.

| Action | Optimistic behaviour | Reconciliation / failure |
|---|---|---|
| **Any timeline/canvas edit** (move, trim, split, keyframe, etc.) | Applied to local state **immediately** (0ms) and pushed to the undo stack; the UI never waits on the server | Debounced autosave (3s) `PATCH`es the full document (§18.3). The **autosave status** in the status bar reflects truth: `● Saved` / `Saving…` (subtle pulse) / `Unsaved changes` |
| **Rename project / track** | Inline edit commits to local state on `Enter`/blur, shows instantly | Autosave persists; on failure, revert + assertive toast |
| **Duplicate / delete** | Clip appears/disappears instantly (§10.4) | Persisted on next autosave |
| **Stale base (`revision` conflict)** | — | If a `PATCH` is rejected for a stale base (single-user, e.g. a second tab), show a **non-destructive assertive notice** "This project changed elsewhere — reload to continue." There is **no merge UI** (Phase 1, MVP §5 fast-path-only). Local undo history is preserved |
| **Save failure (network)** | Edits remain in local state; status bar shows `Unsaved — retrying` (warning color) | Retries with backoff; explicit `Ctrl+S` retries immediately. Never silently lose the edit (anti-Canva-data-loss, Market theme 6) |

**Optimistic rule:** the gesture's visual confirmation (§10.1) fires on the **local** commit, *not* on the server ack — so the editor always feels instant. The status bar is the single honest indicator of persistence; it never lies about saved-state.

---

### 10.13 `prefers-reduced-motion` — explicit behaviour (ref §19.9)

One master switch: `--vf-motion-duration` collapses to `0ms`/`1ms` under `@media (prefers-reduced-motion: reduce)`, and a JS `prefersReducedMotion` flag gates loop animations (§2.11, §19.9). Also exposed as an in-app override (System / On / Off) for users whose app preference differs from the OS (§19.9). Behaviour by category:

| Category | Default | `reduce` behaviour |
|---|---|---|
| Chrome transitions (panel/modal/menu/tab/toast in-out) | Eased 120–240ms | Instant or ≤50ms cross-fade; **no slide/scale** |
| Clip drop settle, ripple slide, delete fade, duplicate fade | Eased 160–180ms | **Instant** layout change (the clip is simply *there*, gap closed) |
| Snap line appear/disappear | Eased 90/140ms | Draws/clears **instantly** — still shown (essential edit feedback, not decoration) |
| Trim min-frame nudge, zoom-limit, rotate-snap detents | Small shake/tick | **Suppressed** — the edge/limit simply stops; the live readout carries the info |
| Selection box appear/move | 120ms appear | Instant appear; drag is already synchronous |
| Timeline auto-scroll following playhead (§3.1) | Smooth scroll | **Jump-scroll** to keep the playhead visible |
| Loading shimmer / spinners | Animated loop | **Static/stepped** indicator + textual % (also announced, §19.7) |
| Hover-thumbnail scrub guide | Synchronous + 90ms fade | Synchronous; fade is instant — the scrub still works |
| Keyframe diamond pop, interpolation-line redraw | 120ms | Instant state change |
| **The user's project playback in the canvas** | **Full motion** | **UNCHANGED** — playback of the edited video is the essential content/purpose (§19.9). Reduced-motion governs *meta-UI* only; it must **never** slow, pause, or stutter the media under edit, nor alter exported motion |

> **The hard line (state in the design):** reduced-motion is a chrome-only contract. A creator who relies on it for the editor UI still sees their *own animations* (keyframes, Ken Burns, crossfades) play at full fidelity in the preview — because that motion *is the product*, and altering it would break "what you cut is what you get."

---

### 10.14 Cursor reference (quick map)

| Context | Cursor |
|---|---|
| Clip body (idle / armed) | `pointer` / `grab` |
| Clip body (dragging) | `grabbing` |
| Trim handle | `ew-resize` |
| Timeline/panel resize splitter | `col-resize` (panels) / `ns-resize` (timeline, canvas split) |
| Ruler (scrub) / playhead handle | `ew-resize` over playhead; `pointer` over ruler (click-jump) |
| Canvas selection corner / edge handle | `nwse-resize` / `nesw-resize` / `ew-resize` / `ns-resize` per handle |
| Canvas rotate handle | `grab` (custom rotate glyph) |
| Incompatible cross-track drop | `not-allowed` |
| Locked clip / disabled control | `not-allowed` |
| Hover-scrub over clip strip | `pointer` (guide tracks; no cursor change) |
| Text/caption inline edit | `text` |

> All hit targets remain ≥24×24 CSS px (§2.5.8); cursors are a redundant cue layered on top of the visual + ARIA state (§19.5), never the sole signal.


---

## 11. Accessibility Design Requirements

This section translates **§19 (Accessibility)** of the spec into concrete, checkable requirements the **mockups** must satisfy — not implementation detail, but what a designer must *draw* and an engineer must *honor* so VideoForge ships at **WCAG 2.2 Level AA** for the editor chrome. Accessibility is part of the trust wedge: a tool whose promise is *"what you cut is what you get"* must also be one where what a keyboard or screen-reader (SR) user perceives matches what the canvas renders. The contrast, focus, and target-size rules here are enforced at the **token layer** (Section 2) and CI-tested (§19.11, §22) — a failing pairing fails the build — so the designer's job is to *stay inside* the validated tokens, not re-derive ratios per screen.

> **MVP scope reminder.** This brief covers only the Phase-0 surfaces (✅ in `MVP_Scope.md`): the three-zone editor (canvas + transport + timeline + panels), the media library, the export modal, captions editor, project dashboard / new-project flow, and the **Chrome/Edge browser gate**. It deliberately omits a11y for deferred features — collaboration/comments/presence, AI auto-caption, markers/work-area/J-K-L shuttle, slip/slide, billing, light/high-contrast themes (token-only, not built), and mobile/touch. Where §19 references those, the requirement is noted as "token slot reserved, not built for MVP."

> **Canva divergence.** Canva's editor is a light-surface, mouse-first design tool with shallow keyboard support and a canvas that is largely opaque to AT. VideoForge mirrors Canva's *clarity and one-clear-primary-action* discipline but diverges into a **pro-NLE, fully keyboard-operable, dark, color-managed** editor where the canvas and timeline each ship an **accessible DOM mirror**. Every drag has a key path; the timeline is a real ARIA grid. This is a deliberate accessibility *up-level*, not parity with Canva.

---

### 11.1 Conformance target & what must be designed

| Surface | Conformance role | Design obligation |
|---|---|---|
| Editor chrome (panels, dialogs, menus, transport, caption editor, dashboard, new-project, export modal, browser gate) | **Full WCAG 2.2 AA** | Designed to AA directly — contrast, focus, target size, keyboard, status messages. |
| Preview `<canvas>` (Section 5) | Bespoke widget; conformance via **DOM mirror** | Design the *visible* selection box + handles (§11.7); the mirror is non-visual but its labels (clip name, position, time range, selected state) must be specified so the SR read-out matches the canvas. |
| Timeline track body (Section 6) | Bespoke widget; conformance via **ARIA grid + DOM mirror** | Design clip/track focus + selection visuals; specify the per-clip accessible name. |
| Exported MP4 | Out of WCAG-of-the-app scope | Not a UI surface — but the product *enables* accessible output via captions (§11.9). The export modal must surface that path. |

**Three principles the mockups must visibly satisfy (§19.1):**
1. **Every mouse action has a key path.** If a state can be reached by dragging, the design must also show how a focused element reaches it via keys (Section 13 bindings). No drag-only affordance.
2. **The canvas is never the only representation of state.** Selection, playhead time, and active caption text all live in a DOM mirror + `aria-live` region (§11.8) as well as on the canvas.
3. **A11y is a token decision, not a per-component override.** Contrast (`--vf-text-*`, `--vf-focus-ring-color`, etc.) and the 24px target are inherited from Section 2; the designer composes with them.

---

### 11.2 Contrast on the dark palette (SC 1.4.3, 1.4.11, 1.4.1)

The dark theme is the only theme built for MVP. Every `(foreground, background)` pairing must meet these **minimums**, validated in CI against the Section 2 tokens:

| Element class | Minimum ratio | SC | Notes for the designer |
|---|---|---|---|
| Body text, labels, timecode, helper text (< 24px, < 18.66px bold) | **4.5:1** | 1.4.3 | Use `--vf-text-primary` / `-secondary` / `-tertiary`; all clear 4.5:1 on `--vf-surface-1/2`. |
| Large text (≥ 24px or ≥ 18.66px bold) — headlines, empty-state, gate hero | **3:1** | 1.4.3 | `--vf-text-xl` (24px) is the first tier where 3:1 applies. |
| Non-text UI: control borders, icons, toggle states, dividers carrying meaning | **3:1** | 1.4.11 | `--vf-border-default` ↑, `--vf-icon-default/-muted`. `--vf-border-subtle` is decorative-only (sub-3:1 allowed *only* where it carries no information). |
| Focus ring vs both the focused element AND its background | **3:1** | 1.4.11, 2.4.7 | `--vf-focus-ring-color #6FB6FF` is pre-validated on the `#1A1A2E` surround and on clip fills. |
| Canvas selection box + handles vs canvas media AND track body | **3:1** | 1.4.11 | `--vf-selection #3B9EFF` + `--vf-selection-halo` dark halo so it survives light *and* dark frames. |
| Timeline clip outline + red playhead vs track grid | **3:1** | 1.4.11 | `--vf-playhead #FF3B5C`, clip outlines. |
| State-by-color (mute/solo/lock, warning, unreviewed-caption) | n/a — must be **redundantly coded** | 1.4.1 | Color is never the only signal — always icon + text/`aria` (§11.6). |

**Risky low-contrast combinations to avoid (call these out in review):**

| Do NOT use | Why it fails | Use instead |
|---|---|---|
| `--vf-accent #FF7A1A` (ember fill hex) as **small text** on dark | ~4.0:1 — fails 4.5:1 body-text | `--vf-accent-text #FFB066` for accent-as-text; reserve the fill hex for CTA *fills* only. |
| `--vf-text-disabled #5A6273` for any **load-bearing** label, value, or hint | ~2.9:1 — fails AA | Only for genuinely disabled controls; never to convey active info. Don't gray out a control to mean "off" without an icon/state. |
| `--vf-text-tertiary` on `--vf-surface-3/4` (menus, modals — lighter surfaces) | Tertiary is tuned for surface-1; on lighter surfaces it can dip under 4.5:1 | Re-check the pairing; bump to `--vf-text-secondary` on elevated surfaces. |
| Warning gold (`#FFC24D`) text adjacent to / overlapping the ember Export CTA | Same hue family → "is this a warning or the brand?" ambiguity, and gold-on-amber can fall under 3:1 | Keep Warning desaturated + triangle icon; never a warning banner flush against the Export CTA (Section 2.4). |
| Waveform path or snap line as the **only** cue of a state at low zoom | Thin 1–1.5px strokes can fall under 3:1 when antialiased small | Pair with a label/icon; ensure stroke meets 3:1 at the thinnest rendered width. |
| Clip source-color hue alone to distinguish two clips | 1.4.1 violation + many hues sit near 3:1, not above | Every clip carries type icon + name; hue is redundant (Section 2.5). |
| Placeholder text (`--vf-text-tertiary`) as the only label for an input | Placeholder ≈ 5:1 but disappears on input; not a label | Always pair a persistent visible `<label>` with the field. |

> **High-contrast / light themes:** §19.8 requires a validated high-contrast set (non-text UI ≥ 4.5:1) and OS `prefers-contrast: more` switching. For MVP the token *names* anticipate this but **only dark is built** — do not design separate light/HC mockups; note the token slots exist.

---

### 11.3 Visible focus ring (SC 2.4.7, 2.4.11)

A single, token-driven ring on **every** focusable element — chrome controls, timeline clips, track headers, and canvas-mirror nodes alike.

| Property | Value | Source |
|---|---|---|
| Style | **2px solid** outline | `--vf-stroke-default` / `--vf-focus-ring` |
| Offset | **2px** (gap between element and ring) | §19.4 |
| Color | `--vf-focus-ring-color #6FB6FF` (bright sky-blue, ≥ 3:1 on both `#1A1A2E` surround and clip fills) | Section 2.9 |
| Trigger | `:focus-visible` — shows for keyboard/AT focus, suppressed on plain pointer click | §19.4 |
| Never | Removed via global `outline: none` without a replacement of equal visibility | §19.4 |

**Design must show:**
- The ring on at least one example **per surface** in the mockups: a chrome button, a media-library tile, a **timeline clip** (ring must read over the teal/periwinkle clip fills — it does, by token choice), a **track-header toggle**, and a **canvas mirror node** (the selected clip on canvas shows both the blue selection box *and*, when focus arrives by keyboard, the ring).
- **Focus not obscured (2.4.11, new in 2.2):** because the top bar (56px), transport bar (48px), and status bar (28px) are sticky, programmatic focus must **scroll the focused row/clip into view with a sticky-aware offset** so it is never hidden behind a band or the panel splitter. Mockups of the timeline at scroll extremes should annotate this offset.
- The decorative `--vf-shadow-focus-accent` ember glow on the Export CTA is **separate** from and never a substitute for the AA focus ring — both can co-exist on the CTA.

---

### 11.4 Keyboard operability — timeline, canvas, panels (SC 2.1.1, 2.1.2, 2.5.7)

**Rule (§19.3):** Section 13 is the single source of key bindings; the design does not invent keys, it guarantees a key path for everything reachable by mouse. The mockups must make focus order and the active focus target *visible*, and the shortcut affordances *discoverable*.

**Drag → keyboard equivalents the design must support (MVP-scoped subset of §19.3, tied to Section 13):**

| Mouse interaction (MVP) | Keyboard path (Section 13 binding) | What the mockup shows |
|---|---|---|
| Scrub playhead (drag ruler) | `← / →` step 1 frame · `Shift+←/→` step 10 frames · `Home/End` project start/end | Focused ruler/playhead with ring; live timecode update announced (§11.8). |
| Move clip horizontally (drag) | clip focused → `← / →` nudge 1 frame · `Shift+←/→` 10 frames | Clip with focus ring + a subtle "nudging" state; selection follows focus. |
| Move clip across tracks (drag vertically) | clip focused → `Ctrl+↑ / Ctrl+↓` to adjacent compatible track | Cross-track focus move respecting track-type compatibility. |
| Trim clip edge (drag handle) | clip focused → `[` trim in to playhead · `]` trim out to playhead | Trim handles are ≥ 24px targets (§11.5); show focused-handle state. |
| Split at playhead (blade) | `S` (split selected / under-playhead clip) · `Shift+S` split all tracks | Result announced "Clip split" (§11.8). |
| Resize / rotate overlay on canvas (handle drag) | element focused → arrows move 1px (`Shift` = 10px) · `Ctrl+arrows` resize · `[` / `]` rotate ±1° (`Shift` ±15°) | The 8-handle box + mirror `aria-description` of the handle model. |
| Volume-envelope keyframe drag | envelope mode → `↑/↓` adjust gain ±1% (`Shift` ±10%) · `Enter` add keyframe at playhead · `Delete` remove | Keyframe focus state on the per-clip envelope. |
| Zoom (Ctrl+scroll) | `Ctrl+= / Ctrl+-` zoom in/out · `Ctrl+0` fit clips in timeline | Centered-on-playhead zoom. |

**Cross-referenced MVP bindings to surface in the design (§19.3):** `Alt+1/2/3/4` aspect-ratio modes; `Ctrl+Shift+0` fit canvas to window; `Ctrl+Shift+P` toggle right panel; `Ctrl+Shift+H` toggle left panel; `Space` play/pause from anywhere except text-entry; `Ctrl+S` save; `Ctrl+Z` / `Ctrl+Y` (or `Ctrl+Shift+Z`) undo/redo; `Ctrl+D` duplicate; `Delete`/`Backspace` delete, `Ctrl+Delete` ripple delete. *(MVP excludes markers `M`, work-area `I/O`, J/K/L shuttle, slip `Hold S+drag` / slide `Hold W+drag`, and the comment tool `C` — do not draw affordances for those.)*

**Operability guarantees the mockups must show:**
- **No mouse-only operation.** Every MVP context-menu item (Cut/Copy/Paste/Delete/Bring Forward/Back/Lock/Link audio) is reachable via `Shift+F10` / `Menu` key, and the common ones have direct bindings. Show the context menu as keyboard-openable.
- **Skip links (§19.3):** a visually-hidden-until-focused link set — **"Skip to timeline" · "Skip to canvas" · "Skip to inspector"** — is the **first tab stop** (rendered at `--vf-z-max` when focused). Provide the focused-state visual (a small pill in the top-left, on `--vf-surface-3` with the focus ring).
- **Text-entry contexts swallow single-key shortcuts:** in inline caption edit, project-name edit, and numeric timecode fields, typing `s`, `i`, or space inserts characters — it never triggers Split / play. The design should make "you are now typing" unambiguous (active field state + caret).
- **No keyboard trap (2.1.2):** modal focus traps are *intentional and escapable* — see §11.5.

---

### 11.5 Target sizes & how focus order is shown (SC 2.5.8, 2.4.3)

| Requirement | Spec | Design rule |
|---|---|---|
| Minimum interactive target | **≥ 24×24 CSS px**, or maintain **24px spacing** | §19.2 / Section 2.7. Applies to timeline mute/solo/lock toggles, trim handles, transport buttons, zoom controls, caption-grid cell controls. |
| Collapsed-track overflow | When a track is collapsed below the height where a control would shrink under 24px, the control **moves into the track overflow menu** rather than rendering an undersized hit target. | §19.3 — draw both the expanded (inline toggles) and collapsed (overflow "⋯" menu) track-header states. |
| Icon glyph vs hit target | The visual glyph may be ~16–20px, but the **hit target stays 24×24**. | Section 2.13 — never shrink the target to match a small glyph. |

**Focus order (2.4.3)** is a fixed logical sequence the mockups should annotate at least once on the full editor:

```
skip links → top bar (logo · project name · undo/redo · Export CTA)
  → left panel (tab list → active panel contents)
  → canvas mirror (selected element)
  → transport bar
  → timeline (track headers ↔ track body clips)
  → right panel (inspector / caption editor / export queue)
  → status bar
```

DOM order matches this order; **no positive `tabindex`** is used to reorder. Roving tabindex keeps the two big composite widgets to few tab stops:

| Composite widget (MVP) | Tab stops | Inner keys |
|---|---|---|
| Track headers | **1** tab stop into the column | `↑/↓` move between headers; `Tab` descends into that track's clips; `Enter` activates rename/mute/solo/lock. |
| Timeline track body (clips) | 1 stop per row (entered from its header) | `←/→` between clips in time order; `↑/↓` to nearest clip on adjacent row; `Home/End` first/last; selection follows focus unless `Ctrl` held. |
| Left-panel tab list (Videos/Audio/Images/Text/Captions/Transitions) | **1** tab stop | `←/→` (WAI-ARIA Tabs) move focus; `Enter`/`Space` activate. |
| Caption editor grid (Section 9 / captions) | **1** stop into the grid | `↑/↓` rows; `Tab` advances cells ("Tab = next block"). |

**Modal focus trap (intentional, escapable — 2.1.2)** for the MVP dialogs (**Export settings §10.1**, **Custom canvas-size**, **destructive confirms**, **new-project**): on open, focus moves to the first control (or the heading if it must be read first) and the trigger is recorded; `Tab`/`Shift+Tab` cycle **inside the dialog only**; the editor behind is `inert` + `aria-hidden` under the `--vf-overlay-scrim`; **`Esc` closes and returns focus to the trigger**. Each dialog is `role="dialog"` `aria-modal="true"` with `aria-labelledby` (title) and `aria-describedby` (body). The mockups should show the first-focus target and the scrim. *(No Auto-Caption or Translate-Track modals in MVP.)*

---

### 11.6 Color is never the only signal (SC 1.4.1)

Every state currently carried by color in the editor must **also** carry an icon and/or text/`aria` state. The designer must draw the icon, not assume the hue is enough.

| State | Color cue | Required redundant cue (must be in the mockup) |
|---|---|---|
| Track **mute** | track desaturates to `--vf-border-default` | **Slashed-speaker icon** on the header + `role="switch"` `aria-checked` ("Mute, on/off"). |
| Track **solo** | header highlight | **Headphone / "S" icon** + `aria-checked`; a global "soloing active" status so non-soloed tracks aren't read as merely quiet. |
| Track / clip **lock** | `aria-disabled` dim | **Padlock icon** + the row exposes `aria-disabled`. |
| **Audio-link** (linked A/V) | — | **Chain icon** on the clip (the anti-desync mechanism — must be visible, not just behavioral). |
| Clip **selected** | blue outline `--vf-selection` | 2px outline **and** `aria-selected` + mirror label "…— selected". |
| Clip **source-coding** (same source = same hue) | teal→cyan→indigo ramp | **Type icon + clip name** always present; hue is purely redundant. Ramp excludes ember + the four semantic hues so no false "status" read. |
| **Warning** (proxy-downgrade, near track limit, unreviewed captions) | desaturated gold `#FFC24D` | **Triangle-alert icon + text**; never a colored-fill-only banner. |
| **Danger / Success / Info** (export fail / complete / autosave) | semantic `-fg` hues | Icon + text label; status announced via `aria-live` (§11.8). |
| Caption-editor **overflow** (> 42 chars/line) | red count | `aria-invalid="true"` + a described character-count, not red alone. |

---

### 11.7 Canvas selection & the DOM-mirror visual

The preview `<canvas>` is `role="application"`; its selection state lives on the **DOM mirror** (§19.6), which the designer specifies the *content* of even though it is visually hidden (`sr-only`: clipped 1×1px, **not** `display:none`, **not** `aria-hidden`).

| What the mirror carries | Example accessible name (design must define the pattern) |
|---|---|
| Each clip/overlay on canvas at the playhead, in z-order | `"Clip: intro.mp4 — Video track 2 — 0:00.000 to 0:04.200 — selected"` |
| An overlay | `"Text overlay: 'Summer Sale' — top-centre — 0:01.000 to 0:03.000"` |
| Transform handle model (in `aria-description`) | `"8-handle bounding box; arrow keys move, Ctrl+arrows resize, brackets rotate"` |

**Visible (canvas-side) requirement:** the **blue 8-handle bounding box** (`--vf-selection #3B9EFF`) with the dark `--vf-selection-halo` behind each handle so it reads over both light and dark media frames. Canvas selection ⇄ mirror is **two-way bound**: selecting on canvas updates the mirror; arrowing the mirror moves the canvas box. The mirror is rebuilt from the single source of truth (project state) on the same events that re-render the canvas, batched in `rAF` — so it **cannot drift** from what's drawn. This is the visual proof of "what you cut is what you get," extended to AT.

---

### 11.8 `aria-live` announcements — what gets announced (SC 4.1.3)

Exactly **one polite** and **one assertive** region at the app root, plus the status bar (`role="status"`); components write through a shared `announce()` service so there are never competing duplicate announcements. The design must reserve the status-bar real estate and specify *what* is spoken and *how throttled* — flooding AT is itself an a11y failure.

| What is announced | Politeness | When / throttle |
|---|---|---|
| **Playhead time** (`HH:MM:SS:FF`) | polite, atomic | **Only on discrete seeks** (frame step, click-ruler, jump). During continuous playback: **≤ 1/sec**; the slider's `aria-valuetext` carries the precise value for on-demand reading. Never announce every frame. |
| **Selection** | polite | "Selected: `<clip/overlay label>`" / "2 clips selected" / "Selection cleared" — debounced 150ms. |
| **Active caption text** | polite, atomic | The caption block under the playhead, as it becomes active (mirrors on-canvas caption; doubles as the SR caption read-out). Suppressible via an SR-caption-announce toggle. |
| **Timeline edit results** | polite | "Clip split", "Clip moved to track 3", "Trimmed to 0:03.500", per action. |
| **Export progress** | polite (status bar) | **Milestones only** — "Export 25%… 50%… complete" — not every percent. |
| **Errors / blocking states** | **assertive** (`role="alert"`) | Validation errors, "Caption track limit reached (max 1)" *(MVP caption cap = 1, per `MVP_Scope.md` §15.2 — not 4)*, export failures, connectivity loss — immediate. |

> **Design implication:** the **status bar** (28px, §2.1) is the visible home of playhead time, autosave status, zoom %, and milestone export progress — it must be legible (`--vf-text-secondary` ≥ 4.5:1) and is also the `aria-live` host, so the *visible* text and the *announced* text are the same string.

---

### 11.9 Captions as an accessibility feature

The Section 9 caption system is both a creative feature and the product's path to accessible **output** — and the design should make it the path of least resistance (§19.10):

- **Export modal** transparently offers **burned-in** captions *or* a **sidecar `.srt`/`.vtt`** download, and nudges toward captioning before export / flags unreviewed blocks. (This sits alongside the mandatory Free-tier watermark note — both are informational, neither is an upsell.)
- The **caption editor grid** is fully keyboard-operable (§11.5) and AT-labeled; the 42-char/2-line limit surfaces as `aria-invalid` + a described character count (§11.6).
- The **active caption** under the playhead is announced (§11.8) and present in the canvas mirror — an SR user editing hears the caption in sync with the playhead.

*(AI auto-caption, translate-track, and karaoke word-highlight are deferred — not in MVP. Manual/imported SRT/VTT only.)*

---

### 11.10 Reduced motion (SC 2.2.2) + the browser gate

**`prefers-reduced-motion: reduce`** governs **chrome only** — never the user's project playback (reducing the media under edit would break the product). One master token `--vf-motion-duration` collapses to `0ms`/`1ms`; a `prefersReducedMotion` flag gates JS loops. The setting is also an in-app override (System / On / Off).

| Motion category (MVP) | Default | Under `reduce` |
|---|---|---|
| UI transitions (panel/modal/tab/toast) | eased 120–240ms (Section 2.11) | instant or ≤ 50ms cross-fade; no slide/scale. |
| Timeline auto-scroll during playback | smooth scroll | **jump-scroll** to keep playhead visible. |
| Transition *thumbnail* hover-previews in the left panel | auto-looping motion | **paused by default**; show a still + "play preview" affordance (satisfies 2.2.2 for non-essential motion). |
| Onboarding / loading shimmer & spinners | animated | static/stepped + textual percentage (also announced, §11.8). |
| **The user's project playback in the canvas** | full motion | **unchanged** — essential content; reduced-motion never touches it. |

**Browser gate (Chrome/Edge only, ✅ MVP).** Safari/Firefox/other get a **full-screen gate** (at `--vf-z-max`), not a broken editor. It must itself be accessible: a `role="main"` page with an **`<h1>`**, body copy explaining WebCodecs/Chrome-Edge requirement, focus landing on the heading, AA-contrast large text (`--vf-text-xl`+ at 3:1), any "copy link / how to switch" control ≥ 24px with the focus ring, and **no motion** beyond a static brand mark. This is the first impression for a non-supported browser — it must read as trustworthy and helpful, not punitive.

---

### 11.11 Designer acceptance checklist (per-screen)

Use on every mockup before handoff (mirrors the §19.11 / §22 CI gates: token-contrast unit tests, `axe-core` per screen, keyboard-only E2E, SR smoke on NVDA+Chrome / VoiceOver — though VO+Safari is post-MVP given the Chrome/Edge gate):

- [ ] All text/icon pairings use Section 2 tokens and clear **4.5:1 / 3:1 / 3:1** (text / large / non-text) — none of the §11.2 "avoid" combos present.
- [ ] Every focusable element shows the **2px `#6FB6FF` ring at 2px offset** in its focus state; nothing relies on `outline:none`.
- [ ] **Focus order** annotated once; matches §11.5; no positive `tabindex`.
- [ ] Every interactive target is **≥ 24×24** (or 24px spacing); collapsed-track controls move to overflow.
- [ ] Every **color-coded state** (mute/solo/lock/link/selected/warning/source-color) also has an **icon + text/`aria`** — color is never alone.
- [ ] **Skip links** drawn as the first focused element; modals show first-focus target + scrim + `Esc`-returns-focus.
- [ ] Status bar shows playhead time / autosave / export milestone and is the visible twin of the `aria-live` string.
- [ ] Reduced-motion variant noted for any animated affordance; **canvas project playback excluded**.
- [ ] Every drag affordance has an annotated **keyboard path** (Section 13 binding), and no deferred-feature key (markers/work-area/J-K-L/slip/slide/comment) is drawn.


---

## 12. Deliverables & Handoff

> This is the closing part of the VideoForge MVP design brief. It tells **"Claude design"** exactly what to produce, and tells the **frontend engineer** exactly what to expect in the handoff package. Everything here is bounded by `docs/MVP_Scope.md` (Phase 0) — **design only what is ✅ there.** Parts 1–8 of this brief already specify the surfaces in detail (principles §1, tokens §2, layout §3, auth/dashboard/new-project §4, canvas/transport §5, timeline §6, export/onboarding/states §8); this part is the **manifest, naming contract, and acceptance gate** that binds those parts into one deliverable.
>
> All numeric values below (px, rem, ms, hex, ratios) are a **recommended starting system the designer may refine** — the *structure* (screen list, state matrix, naming, token-file shape, acceptance checklist) is what must hold.

---

### 12.1 What "Claude design" must output (the deliverable, in one sentence)

A **single, internally-consistent dark-theme design system + screen set** for the VideoForge MVP, delivered as (a) a token file, (b) a component/screen library covering every screen and state in §12.3, (c) redlined/annotated frames for the load-bearing surfaces, and (d) an exported asset bundle — all of which **pass the §12.9 acceptance checklist**. No deferred features (§12.10). No upgrade CTA anywhere. The export watermark note present and worded as information, not an upsell.

**Tooling-agnostic.** Deliver in whatever surface the design tool produces natively (frames/artboards + a component library + a styles/variables panel). The contract is the *content and naming* below, not a specific file format — but the handoff must round-trip to the formats in §12.8.

---

### 12.2 Brand guardrails the output must hold (recap, do not re-derive)

These are decided; the design must conform, not reopen them:

- **Dark, "pro-NLE" editor**, approachable like Canva but **not a Canva clone.** Single **molten-ember accent** (`--vf-accent` `#FF7A1A` family) on cool slate neutrals — explicitly *not* Canva's purple→cyan. Selection is **functional sky-blue** (`--vf-selection`), never the accent (§2, §1.2).
- **Logo direction:** angular anvil/wedge "play" glyph in the molten gradient — angular, single-warm-hue, motion-forward; must not resemble Canva's rounded multi-color aperture (§2.3). Deliver a *direction + lockup*, not a finished identity.
- **Launch default = both aspect ratios, no opinionated default.** The New-Project modal is the aspect-ratio hero with **no pre-selected tile** (§4.3, `MVP_Scope.md` launch decision).
- **Free-tier only, Stripe stubbed.** **Zero** "Upgrade to Pro" / pricing / plan / seat UI on any screen. The *only* place tier surfaces is the export modal's informational watermark note (§1.2, §5.8, §8.2).
- **Chrome/Edge desktop only.** Include the browser-gate screen; design **no** mobile/touch layout.

Where the design mirrors a Canva pattern (e.g. roomy empty states, one clear primary action per surface, the tabbed export dialog), the frame's annotation must **name the pattern and state the divergence** (e.g. "Canva-style single-primary-CTA empty state — diverges: dark surface, trust sentence not template gallery").

---

### 12.3 Screen list to deliver

Every screen below is MVP-✅. Each must ship in **all** its listed states (the per-screen state detail is in §12.4). Screen IDs are the **canonical names** used in file names, layer names, and annotations (§12.6).

| # | Screen ID | Surface | Brief part | Scope ref |
|---|---|---|---|---|
| 1 | `auth` | Sign in / Sign up (one screen, toggle; email+password + Google) | §4.1 | §3.10 |
| 2 | `dashboard` | Project dashboard (card grid, create-tile first) | §4.2 | §3.9 |
| 3 | `new-project` | New-Project modal — aspect-ratio chooser (the hero) | §4.3 | §3.9, launch decision |
| 4 | `browser-gate` | Chrome/Edge-only gate (full-screen) | §4.4 / §8.6 | §3.11, §15.1 |
| 5 | `editor` | Full editor shell (all five bands), in the selection states below | §3, §5, §6 | §3.11 |
| 6 | `export-modal` | Export modal — Format & Quality + Captions tabs, pre-flight | §8.2 | §3.8 |
| 7 | `export-progress` | Export progress (in-modal foreground + backgrounded bell) + completion | §8.3 | §3.8 |

**The `editor` screen must be delivered in 4 selection/interaction states** (these are the "3–4 selection states" — they map 1:1 to part §5.6 and the timeline part §6.8):

| Editor state ID | What it shows | Brief ref |
|---|---|---|
| `editor/empty` | Project just created, **library empty** — in-editor import nudge (the onboarding funnel state) | §8.5.2 |
| `editor/nothing-selected` | Populated timeline, nothing selected → **inspector auto-hidden, canvas expanded** | §5.6 State 1 |
| `editor/clip-selected` | A timeline clip selected → blue 8-handle box on canvas + **right-panel inspector** (clip properties: trim/speed/opacity, color-grade sliders, keyframe lane, audio envelope as applicable) | §5.6 State 2, §6.8 |
| `editor/caption-or-text` | **One** of: caption track selected → right panel in **Caption Editor** mode (start \| end \| text grid); *or* a text overlay in inline-edit. Deliver caption-editor as the primary; text-inline as a documented variant frame | §5.6 State 3, §2.1 caption mode |

> If budget allows a 5th editor frame, add `editor/playback-degraded` (the honesty "Performance mode ⚡" status-bar cue, §5.7) — it is a small variant on `nothing-selected`, not a new layout.

**Empty / error / system states that must also be delivered** (these are screens/overlays, not just notes — see the §8.7.4 matrix for the full list):

| State ID | Surface | Brief ref |
|---|---|---|
| `dashboard/empty` | First-run dashboard (trust hero + single New-project CTA, no templates) | §4.2, §8.5.1 |
| `dashboard/loading` | Card-grid skeleton | §4.2 |
| `dashboard/error` | "Couldn't load your projects" + Retry (create-tile preserved) | §4.2 |
| `upload/uploading` + `upload/interrupted` + `upload/rejected` + `upload/duplicate` | Media-library upload states (tray, auto-resume, reject toast, dedupe info) | §8.4, §8.7.1 |
| `processing/preparing` + `processing/proxy-failed` | Asset-tile processing + proxy-fail fallback ("original still exportable") | §8.4, §8.7.1 |
| `export/proxy-downgrade-warn` | Amber inline notice in export modal (never a silent downgrade) | §8.2.3 |
| `export/failed` + `export/cancelled` | Export failure (Retry) + cancelled (return to settings) | §8.7.3 |

---

### 12.4 States matrix per screen

Every screen is delivered as a **matrix of states**, not a single happy-path frame. The minimum required state set, per screen type:

| Screen | Required states (deliver a frame/variant for each) |
|---|---|
| `auth` | default · field-focused · validation-error (`role="alert"`) · submitting (spinner, disabled) · Google-redirecting · success→dashboard |
| `dashboard` | default (populated) · `empty` · `loading` (skeleton) · `error` · card-hover · per-card busy (open/duplicate/delete) · delete-confirm dialog |
| `new-project` | default-open (**no tile selected, Create disabled**) · tile-selected (Create enabled) · custom-expanded (W×H inputs + live ratio) · custom-invalid (out-of-range, Create disabled) · creating (spinner) · error |
| `browser-gate` | default (unsupported browser, install CTAs + "continue anyway" link). Single state; no error variant |
| `editor` | the 4 editor states in §12.3 + the `editor/empty` onboarding state + (optional) `playback-degraded` |
| `export-modal` | Tab A default (Format & Quality, with pre-flight estimate + **watermark note**) · Tab B (Captions: burned-in / sidecar / none) · proxy-downgrade-warn · validation (e.g. nothing to export) |
| `export-progress` | in-modal foreground (determinate bar, Cancel + Run-in-background) · backgrounded (bell + popover bar) · complete (toast + Download, 7-day) · failed (Retry) · cancelled |

**Interaction states (component level), required on every interactive element** in the library: `default`, `hover`, `focus-visible` (the 2px `--vf-focus-ring`, §2/§19.4), `active/pressed`, `disabled` (`aria-disabled` styling — never removed from tab order), and where applicable `selected/checked`, `loading`, `error`. Document these once on the component, then reference from screens.

> **State coverage rule:** if a state appears in the §8.7.4 system-states matrix or in any part's `States` table, it must exist as a deliverable frame or a documented component variant. The §8.7.4 matrix is the authoritative checklist of system states the design must cover.

---

### 12.5 Component library to deliver

A reusable component set (so screens compose, not copy). At minimum, organized by group:

- **Primitives:** Button (primary `--vf-accent` / secondary / ghost / danger), Icon button, Text input + numeric/timecode input, Select/Dropdown, Radio card (aspect tile, export preset, caption mode), Checkbox/Switch (`role="switch"` mute/solo/lock), Tabs (WAI-ARIA), Slider (zoom, color-grade, volume, opacity), Tooltip, Tag/Badge (aspect badge, status badge), Skeleton.
- **Feedback:** Toast (`status` / `alert`), Notification bell + popover, Inline alert/callout (info / warning / danger — each with icon, never color-only), Progress bar (`role="progressbar"`), Modal/Dialog shell (focus-trapped, scrim).
- **Editor-specific (the pro-NLE work):** Top bar, Left media-panel tab + asset tile (uploading/processing/ready/proxy-failed variants), Right inspector panel (clip-properties / caption-editor / —export queue is out, do not build), Transport bar + controls, Timeline ruler + playhead + work-area bar, Track header (per type: video/audio/overlay/caption), Clip block (video filmstrip / audio waveform / overlay / caption pill) in the §6.8 clip-state matrix, Audio-Link chain glyph, Snap line, Keyframe lane + diamond, Selection 8-handle box.

Every component carries its interaction-state set (§12.4) and its a11y annotations (role, name source, keyboard behavior) inline.

---

### 12.6 Naming conventions

Consistent naming is the contract that lets the engineer map a frame to a component to a token without guessing.

- **Screens / frames:** `vf/<screen-id>/<state-id>` — e.g. `vf/editor/clip-selected`, `vf/new-project/custom-invalid`, `vf/export-modal/proxy-downgrade-warn`. Use the exact IDs from §12.3.
- **Components:** PascalCase, grouped by `Group/Name` — e.g. `Editor/TrackHeader`, `Editor/ClipBlock`, `Feedback/Toast`, `Primitive/RadioCard`. Variants as named properties: `state=hover`, `type=audio`, `selected=true`.
- **Tokens:** the **`--vf-*` CSS custom-property convention** from part §2 (e.g. `--vf-surface-1`, `--vf-text-primary`, `--vf-accent`, `--vf-selection`, `--vf-focus-ring`, `--vf-space-3`, `--vf-radius-md`, `--vf-motion-duration`). This is the single source of truth — **prior parts that wrote bare names (`--surface-1`, `--accent`) must be normalized to `--vf-*` in the delivered system.** Token names map 1:1 to a Tailwind / Style-Dictionary theme.
- **Layers (inside a frame):** name structural layers after their ARIA region/role where one exists — `region:top-bar (banner)`, `region:timeline (grid)`, `node:clip (gridcell)` — so the a11y structure of §19.5 is legible to the engineer in the layer tree.
- **States referenced in copy/annotations** use the IDs above verbatim, so a redline reading "in `editor/clip-selected`, inspector enters from `--vf-space-4`" is unambiguous.

---

### 12.7 Redlines, spacing & annotations expected

Not every frame needs full redlines — but the **load-bearing surfaces do.** Deliver redlined/annotated versions of:

1. **`editor` (all four states)** — the spatial budget is exact and tested. Annotate the five-band layout against the spec formula: top bar **56px**, transport bar **48px**, timeline default **260px** (resizable 180–600px), status bar **28px**, canvas area = the remainder; left panel **280px** (180–420), right panel **300px** (240–480) (§2.1, §3, §5.2). Show track-header column **180px**, default track heights (video 64, audio 48, caption 36), and the ±200px virtual-scroll buffer as a note.
2. **`new-project`** — the aspect tiles must be **proportional** (the 9:16 tile is visibly taller than 16:9) and **equally weighted** (no tile larger/highlighted as a default). Redline tile sizes, gaps, the custom W×H expand, and the live-ratio hint.
3. **`export-modal`** — redline the tab layout, the pre-flight estimate block, and the **watermark note** placement/treatment (info callout, not adjacent to the Export CTA — avoid the amber-clash, §2.4).
4. **`timeline` clip block + track header** — the densest pro-NLE component; redline clip paddings, the trim-handle hit area (≥24×24 or 24px spacing, §19.2 SC 2.5.8), waveform/filmstrip insets, the Audio-Link chain glyph, and the snap line.

**Each redline annotation must carry, where relevant:**
- Spacing/size in `--vf-space-*` tokens (or px with the token noted), and the **8px base grid** the spacing scale rides on (§2 / §3).
- The **token** for every color (fill, text, border, focus ring), not a raw hex — raw hex only as a parenthetical.
- **Type token** (family / size / weight / line-height) for text runs.
- **Motion**: duration + easing in `--vf-motion-*`, and the reduced-motion behavior (§19.9) — e.g. "panel enter 200ms ease-out; under `reduce`: instant".
- **A11y inline note:** role, accessible-name source, focusable? keyboard interaction, and target-size compliance.
- **State transitions:** which user action moves between the frames in this screen's matrix.

Provide one **8px spacing/grid overlay** reference frame and one **focus-order** annotation pass on the `editor` (skip links → top bar → left panel → canvas mirror → transport → timeline → right panel → status bar, §19.4).

---

### 12.8 Dark-theme-first; tokens; asset & export formats

- **Dark theme is the only implemented theme for MVP** and the surface "Claude design" produces. The token *structure* must anticipate light + high-contrast (per §19.8 / §2), so deliver tokens as **semantic roles** (e.g. `--vf-surface-1`, `--vf-text-primary`) that can be re-mapped to a future light/high-contrast palette — **but build/visualize only dark.** Light and high-contrast are a later token re-map, **not** new screens; do not spend frames on them.
- **Token file to emit:** a single machine-readable token export — `vf-tokens.json` (W3C Design-Tokens-format or Style-Dictionary shape) — containing every `--vf-*` token in these groups: color (surfaces/elevation, text/icon, brand/accent, semantic status, editor/timeline functional colors), typography (families, scale, weights, line-heights), spacing (8px-based scale), radii, elevation/shadow, motion (durations + easings, incl. the `--vf-motion-duration → 0ms` reduced-motion collapse), and z-index layers. Each `(foreground,background)` pairing must declare its intended WCAG ratio so the **CI contrast tests** (§19.8) can assert it. Emit alongside a human-readable `tokens.md` table mirroring part §2.
- **Asset bundle for handoff:**
  - **Icons:** SVG, on the 24px grid, optimized, named by function (`icon/play`, `icon/split`, `icon/audio-link`, `icon/mute`, `icon/solo`, `icon/lock`, `icon/keyframe`, `icon/upload`, `icon/download`, `icon/warning`).
  - **Logo:** SVG, both **on-dark (default)** and **on-light** variants, plus the molten-gradient mark and a monochrome chrome lockup (§2.3). Include a favicon-safe simplified glyph.
  - **Empty-state / onboarding illustration(s):** SVG where vector, otherwise 2× PNG; must be light-weight and not animate under `reduce`.
  - **Spec exports:** each redlined frame as **PNG (2×)** for quick reference **and** a vector **SVG/PDF** for measurement; the live editable design file/library link is the source of truth.
- **One-screen reference sheet:** a single board showing the token swatches, the type scale, the component thumbnails, and the screen thumbnails — the engineer's at-a-glance index.

---

### 12.9 Acceptance checklist (the design must pass all)

A reviewer signs off only when **every** box is checked. This is the gate.

**Scope coverage — every MVP feature has a home:**
- [ ] Every screen in §12.3 exists, in every state in §12.4.
- [ ] Import → multi-track timeline (trim/split/move/ripple/duplicate) → preview → export funnel is walkable across the frames with **no dead end** (drives TTFE, §1.1).
- [ ] Timeline shows multi-track with the Free ceilings representable (3 video / 2 audio / 2 overlay / 1 caption, §3.2 / §15.2), color-coded lanes, sticky `HH:MM:SS:FF` ruler, draggable red playhead, audio waveforms, video filmstrips.
- [ ] **Audio-Link** chain glyph, **snap line**, keyframe lane/diamond, and the color-grade sliders are all present (the thin creative layer, §3.6 / §3.7).
- [ ] Captions: import + hand-authored start\|end\|text grid + one readable default style; export modal offers **burned-in and sidecar .SRT/.VTT** (§3.5 / §8.2.2).
- [ ] Speed change, per-clip fades + volume envelope, transform keyframes, Ken Burns, crossfade are reachable in the inspector (no deep effects panel beyond these).
- [ ] Project persistence is felt: autosave status (status bar), undo/redo (top bar), Ctrl+S (§3.9).

**No out-of-scope UI (§12.10) — verified absent:**
- [ ] No collaboration/presence/cursors/comments/avatars; no roles.
- [ ] No AI auto-caption button (the "Auto-Caption" track-header control from spec §3.2 is **omitted** in MVP).
- [ ] No mobile/touch layout; no responsive timeline.
- [ ] No deep effects panels, blend-mode UI, masks, EQ/compressor/ducking, voice-over record, markers/mini-map, versioning/history panel, export queue/batch tab.

**Accessibility (§19) satisfied:**
- [ ] WCAG 2.2 **AA** on all chrome; the canvas + timeline ship the DOM-mirror + `aria-live` structure (§19.5/§19.6/§19.7) noted in annotations.
- [ ] Visible **2px `--vf-focus-ring`** on every focusable element; logical focus order + skip links shown on `editor` (§19.4).
- [ ] Interactive targets **≥ 24×24** CSS px or 24px-spaced (§19.2 SC 2.5.8); collapsed-track controls move to overflow rather than shrink.
- [ ] Every drag interaction has a documented **keyboard alternative** (§19.3 SC 2.5.7).
- [ ] **Color is never the sole signal** — selection, mute/solo/lock, status, clip source-coding, aspect all pair hue with icon + text (§19.8 SC 1.4.1).
- [ ] Token contrast pairings declared and AA-passing (§19.8); reduced-motion behavior specified per animated element (§19.9).
- [ ] Modals are focus-trapped, `Esc`-escapable, focus returned to trigger (§19.4 SC 2.1.2).

**Product-decision conformance:**
- [ ] **Both aspect ratios representable:** the editor canvas is shown in at least 9:16 **and** 16:9 (and the new-project chooser surfaces 9:16/16:9/1:1/4:5/custom **equally, with no pre-selected default**).
- [ ] **No "Upgrade to Pro" / pricing / plan / seat CTA** anywhere — searched and confirmed absent on all frames.
- [ ] **Watermark note present** in the export modal, worded as **information** ("A small VideoForge watermark is added to your export."), placed as an info callout — **not** an upsell, **not** adjacent to the Export CTA (§5.8 / §8.2 / §2.4).
- [ ] **Browser-gate** screen present (Chrome/Edge only), honest/helpful tone, "continue anyway" link (§4.4 / §8.6).
- [ ] **Not a Canva clone:** dark surfaces, single molten-ember accent (not purple→cyan), sky-blue selection, angular logo direction; mirrored Canva patterns are annotated with their divergence (§12.2).

**Handoff hygiene:**
- [ ] `vf-tokens.json` emitted with all `--vf-*` tokens + declared contrast ratios; `tokens.md` mirror.
- [ ] Naming follows §12.6 across frames/components/layers/tokens.
- [ ] Redlines delivered for the four §12.7 surfaces with spacing-in-tokens, color-in-tokens, type, motion, and inline a11y notes.
- [ ] Icon + logo + illustration asset bundle exported in the §12.8 formats.

---

### 12.10 Out-of-scope reminder (do NOT design)

Per `MVP_Scope.md` §§2–4: real-time collaboration (presence/cursors/comments/roles), any AI (auto-captions, transcript edit, scene detection, upscaler), billing/Stripe/plan tiers/upgrade screens, deep effects (full color grade/LUT, preset filters, 12+ transitions, masks, chroma key, Bezier curve editor), full audio rack (EQ/compressor/de-noise/reverb/ducking/meters), voice-over recording, image/Lottie/SVG overlays + server rasterization, markers/chapters/mini-map, versioning/restore-to-branch/history panel, export queue/batch UI, multi-format export (H.265/VP9/ProRes/GIF/4K/HDR), Safari/Firefox editor, and any **mobile/touch** layout. If a frame would need one of these, it is out — leave the home for it implicit in the structure, but draw nothing.

---

### 12.11 Kickoff prompt (paste into "Claude design")

> Design the **VideoForge** MVP — a dark, trustworthy, pro-NLE-feeling **browser video editor** (Chrome/Edge desktop only) whose whole promise is *"what you cut is what you get."* It's as approachable as Canva but **not** a clone: cool slate-dark surfaces, a single **molten-ember accent** (`#FF7A1A` family) reserved for brand + the one primary CTA, **sky-blue** functional selection, and an angular anvil/wedge "play" logo direction — never purple→cyan or a rounded aperture. Build the **dark theme only**, but structure tokens (`--vf-*`) as semantic roles that could re-map to light/high-contrast later, and emit them as `vf-tokens.json` with declared WCAG ratios. Deliver these screens, each in all their states: **auth** (one screen, login/sign-up toggle, email + Google), **dashboard** (card grid + create-tile, plus empty/loading/error), the **new-project modal** as the hero aspect-ratio chooser (9:16 / 16:9 / 1:1 / 4:5 / custom as proportional, equally-weighted tiles with **no pre-selected default**), the **browser-gate**, the **full editor** in four states (`empty`, `nothing-selected`, `clip-selected`, `caption/text-edit`) with its exact five-band layout (top bar 56 / transport 48 / timeline 260 / status 28 / canvas remainder; left 280, right 300, track-header 180) and a real multi-track timeline (color-coded video/audio/overlay/caption lanes at the Free ceilings 3/2/2/1, sticky `HH:MM:SS:FF` ruler, red playhead, waveforms, filmstrips, Audio-Link chain, snap line, keyframe lane), and the **export modal + progress** (Format & Quality + Captions tabs, pre-flight size/time estimate, burned-in **and** sidecar .SRT/.VTT, and a plainly-worded informational note that *"A small VideoForge watermark is added to your export"* — placed as info, never as an upsell). Cover the upload/processing/proxy-fail/proxy-downgrade/export-fail/cancelled system states too. Meet **WCAG 2.2 AA** throughout: visible 2px focus rings, ≥24×24 targets, keyboard alternatives for every drag, color never the sole signal, focus-trapped escapable modals, reduced-motion variants. Redline the editor, new-project, export modal, and timeline clip/track-header with spacing-in-tokens, color-in-tokens, type, motion, and inline a11y notes. **Do not design any** collaboration, AI auto-caption button, billing/upgrade/pricing UI, deep effects/audio-rack panels, markers/versioning/queue panels, or mobile/touch layout — Free-tier only, no Pro CTA anywhere. When you mirror a Canva pattern, annotate it and state the divergence.

