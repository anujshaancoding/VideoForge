# Script Studio — UX/Design Brief

**Author:** Iris (Head of Design, UX+UI) · For: **Pixel** to implement
**Date:** 2026-06-05
**Status:** Ready for implementation. Design only — no product code.
**Reads:** `docs/Design_Instructions_MVP.md`, `docs/Script_Studio_Research.md`,
`docs/Script_Studio_Architecture.md`, `docs/Onboarding_Funnel_Brief.md`,
`apps/web/src/routes/NewProjectModal.tsx`, `apps/web/src/routes/Dashboard.tsx`,
`apps/web/src/components/editor/TopBar.tsx`, `apps/web/src/components/editor/ExportModal.tsx`

---

## 0. Mandate summary

Paste a script → auto-build a *real, editable* VideoForge timeline (TTS voice-over + matched
scenes + auto-captions) → user edits and exports in the **existing** editor.
`$0` build. No paid APIs. No walled "AI silo" — the generated project lands in the normal editor.

This brief designs the **UX seam**: entry point, script input, progress experience, and the
editor landing. The assembler (`packages/script-studio`) and render-worker plumbing are Forge/Pixel/Core
territory — design only describes what the user sees and how they interact with it.

---

## 1. Design principles for this feature

These layer on top of the seven global principles in `Design_Instructions_MVP.md §1`.

**1-A. The output is a normal project — always say so.**
The generated timeline is not a locked AI artifact. It is a `Project` like any other. Every UX
decision must reinforce that the user is about to *edit*, not just consume. No "regenerate" CTA
dominates the landing; edit does.

**1-B. Honest progress, cancelable.**
TTS synthesis + asset processing can take 15–60+ seconds on a $0 CPU path. The user must see
real signal, not an indeterminate spinner. Every async phase is named and cancelable. The
experience of waiting must be calm and informative, not anxious.

**1-C. Same component vocabulary — no new visual language.**
Script Studio reuses the Modal component, the aspect-ratio chooser radiogroup from
`NewProjectModal`, the progress system from `ExportModal`, and the dashboard card grid.
Pixel should recognize every component. No new color, no new surface elevation, no purple.

**1-D. Amber stays on Export.**
The amber `--vf-accent` appears nowhere in the Script Studio input or progress flow.
The only amber the user sees is the Export button in TopBar after the project lands — the same
amber they already know means "commit to file." Selection/active states in Script Studio use
`--vf-selection` (sky-blue).

---

## 2. Entry point — the Dashboard / New Project flow

### 2.1 Where it lives

Script Studio is a **second creation mode** alongside "New project" on the Dashboard.
It does **not** replace or compete with the existing New-Project path; it sits beside it.

Two surfaces get an entry point:

**A. Dashboard — empty state (the most prominent first encounter)**
The existing empty-state block has a primary "+ New project" secondary button
(`variant="secondary"`, non-amber). Add a second, lower-priority text link immediately
below the button:

```
[+ New project]          ← existing secondary button, unchanged

Or paste a script → auto-build  ← new text link (not a button variant)
```

The link navigates to `/script-studio/new` and opens the ScriptStudio modal.
Style: `text-sm text-vf-text-secondary underline-offset-2 hover:text-vf-text-primary` —
visually quieter than the button so the primary new-project CTA is not diluted.

**B. Dashboard — populated state (persistent create-tile area)**
The existing dashed "New project" create-tile (top-left of the project grid) gains a small
secondary affordance: a `Script` chip inside the tile bottom:

```
┌──────────────────────────────────┐
│                                  │
│           +  New project         │  ← existing button text
│                                  │
│   [▶ Script Studio]              │  ← new chip, bottom-left, 24px min-height
└──────────────────────────────────┘
```

The chip is a `button` inside the existing create-tile `<li>`. Style: pill chip,
`text-xs text-vf-text-tertiary bg-vf-surface-3 hover:bg-vf-surface-4 rounded-pill px-2 py-0.5`.
Clicking it navigates to `/script-studio/new` without navigating away from the dashboard first.
The existing large-tile click still creates a blank project.
**Note for Pixel:** the chip must be a sibling `<button>` at the tile level, not nested inside the
existing large clickable tile button — same nested-interactive pattern used in `ProjectCard`
(the `z-10` actions button pattern).

**C. New-Project Modal — a third row**
Below "Or start from a template" add a final separator row:

```
── Or build from a script ──────────────────────────────────────
[▶ Script Studio — paste a script, get a full timeline draft]
```

A ghost/outline button, full-width, sitting under the template radiogroup. On click: close the
New-Project modal, open the ScriptStudio modal (same `/script-studio/new` route).
Style: `variant="ghost"` with a left `▶` icon glyph. Text: `"Script Studio — paste a script,
get a full timeline draft"`. Not amber — not a primary CTA.

### 2.2 Routing

Route: `/script-studio/new` renders `<ScriptStudioModal>` overlaid on the Dashboard
(same pattern as `/new` renders `<NewProjectModal>` over the Dashboard).
The modal is a `<Modal>` at `max-w-[720px]` — wider than `NewProjectModal` to accommodate
the script textarea comfortably.

---

## 3. ScriptStudio Modal — the script input screen

### 3.1 Modal anatomy

```
┌─ New project from script ──────────────────────────────── [×] ─┐
│                                                                  │
│  ┌── Script ─────────────────────────────────────────────────┐  │
│  │  [textarea — paste or type your script here...]           │  │
│  │  (min 120px, max 400px, grows with content)               │  │
│  │                                   Character count: 0/8000 │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                  │
│  Aspect ratio   [9:16] [16:9] [1:1] [4:5] [Custom]             │
│  (hint line: same reactive hint as NewProjectModal)              │
│                                                                  │
│  Voice          [selector — see §3.3]                           │
│                                                                  │
│  Scene style    [Text cards ●] [Stock video] [Mixed]            │
│                                                                  │
│  Captions       [On ●] [Off]                                    │
│                                                                  │
│  Project name   [____________________________________________]   │
│                                                                  │
│                              [Cancel]  [Build timeline →]       │
└──────────────────────────────────────────────────────────────────┘
```

**Modal title:** "New project from script"
**`<Modal widthClassName="max-w-[720px]">`** — reuse the existing Modal component.
**Footer:** Cancel (ghost) + "Build timeline →" (secondary button, non-amber) disabled until
script has ≥ 10 characters AND an aspect ratio is chosen.

### 3.2 Script textarea

- `<textarea>` in a `<Field>` wrapper (reuse the existing `Field` component pattern).
- Label: "Script" (visually, `text-md font-semibold text-vf-text-primary` above).
- Placeholder: `"Paste or type your script here. Each paragraph will become a scene."`
- Min-height `120px`, max-height `400px`, `resize: vertical`. Grows with content up to max.
- Character count: right-aligned below the textarea, `text-xs text-vf-text-tertiary`.
  Max 8000 characters. At 7500+: count turns `text-vf-warning-fg`. At 8000: blocked, count
  turns `text-vf-danger-fg`, textarea border turns `--vf-border-strong` danger.
- Background: `--vf-surface-sunken` (wells convention from `Design_Instructions_MVP.md §2.1`).
- Keyboard: Tab moves focus out (not inserts a tab). Standard browser text-area behavior.

**Empty state hint (first-session only):**
When `isFirstSession()` is true and the textarea is empty, show a soft inset hint block inside
the textarea area (not placeholder — a visible but dismissible sub-panel):

> "Write one paragraph per scene. VideoForge will add a voice-over, match visuals, and drop
> captions — then open the draft timeline in the editor, ready to refine."

Style: `text-xs text-vf-text-tertiary` centered, `--vf-surface-2` background,
`rounded-sm mx-3 my-2 px-3 py-2`. Disappears the moment the user starts typing.

### 3.3 Aspect ratio chooser

Verbatim reuse of the `RatioTile` radiogroup from `NewProjectModal`:
same five tiles, same roving-tabindex keyboard behavior, same `DEFAULT_RATIO: null`.
Reactive hint line below tiles (same pattern as `NewProjectModal`).
No change needed to the `RatioTile` component itself.

### 3.4 Voice selector

A labeled field row: `"Voice"` label + a `<select>` or custom listbox
(use a `<select>` for MVP — minimal new component surface).

**Voices shipped at launch (Kokoro-82M Apache-2.0 / piper-plus MIT voice list):**
These are placeholder slot names — Forge/Core own the exact voice list based on licensed models.
The selector renders whatever voices the server advertises from
`GET /api/v1/script-studio/voices`.

```
Voice  [ af_heart — Warm, Female (English) ▾ ]   [▶ Preview]
```

- `<select>` shows `{voice.name} — {voice.description}` per option.
- The `[▶ Preview]` icon button (`aria-label="Preview voice"`) plays a
  short 3-second sample audio clip (`<audio>` + `.play()`). On load: `disabled`. When voices
  are loaded: enabled. While previewing: `[■ Stop]`.
- If the API returns an empty list (worker not ready), the select shows
  `"Generating voice list…"` (disabled), and the preview button is hidden.
- Token: `--vf-selection` used for the focused select border — not amber.

### 3.5 Scene style

A segmented-control / tab-strip (`role="radiogroup"`, three options, roving tabindex):

```
Scene style   [Text cards ●]  [Stock video]  [Mixed]
```

| Option | What it does | Dependency |
|---|---|---|
| Text cards | Generated text overlays only — $0, zero network, offline-safe | None |
| Stock video | Pexels/Pixabay clips per scene — richer, needs network + attribution | Pexels API key |
| Mixed | Text cards as fallback, stock where available | Pexels API key |

**Default: "Text cards"** — the most reliable $0 path per Scout/Forge recommendation.

When "Stock video" or "Mixed" is selected, show a one-line info note below the control:

> "Stock clips require attribution (Photographer name + Pexels/Pixabay link) saved with
> your project."

Style: `text-xs text-vf-info-fg` with a (i) info icon. Not a warning — this is factual.

### 3.6 Captions

A two-option pill toggle:

```
Captions   [On ●]   [Off]
```

Default: `On`. When `On`, auto-captions will be added to the caption track from TTS timestamps.
Reuses `--vf-selection` for selected-state fill — not amber.

Sub-note when `On`:

> "Captions are auto-timed from the voice-over. You can edit them in the editor."

`text-xs text-vf-text-tertiary`. No warning icon — this is positive affordance.

### 3.7 Project name field

Optional, same as `NewProjectModal`. `placeholder="Script Studio draft"` as the default.
Placed last, just before the footer — lowest friction, most likely to be skipped.

### 3.8 Footer button states

| Condition | "Build timeline →" state |
|---|---|
| No script text (< 10 chars) | `disabled`, `aria-disabled="true"` |
| No aspect ratio chosen | `disabled`, `aria-describedby="vf-script-hint"` → "Choose an aspect ratio first" |
| Valid script + ratio | Enabled, `variant="secondary"` |
| Submitting | Replaced by the progress screen (§4) — modal transitions in place |

"Build timeline →" is **not amber**. Amber is Export only. It uses `variant="secondary"`:
`bg-vf-surface-3 hover:bg-vf-surface-2 text-vf-text-primary border border-vf-border-default`.

---

## 4. Generating experience — the progress screen

When "Build timeline →" is clicked, the modal **transitions in-place** from the input form
to a progress view. The modal does not close — the user stays in a single, focused context.

### 4.1 The progress view layout

```
┌─ Building your timeline… ──────────────────────────── [×] ─┐
│                                                             │
│   ┌───────────────────────────────────────────────────┐   │
│   │  ████████████████████░░░░░░░░░░░░░░░░░░░░░░░░░   │   │
│   │  43%                                              │   │
│   └───────────────────────────────────────────────────┘   │
│                                                             │
│   ✓  Script analysed — 6 scenes                           │
│   ◌  Synthesising voice-over (scene 3 of 6)…              │
│   ○  Fetching visuals                                      │
│   ○  Assembling timeline                                   │
│                                                             │
│   This usually takes 20–40 seconds.                        │
│                                                             │
│                                    [Cancel]                 │
└─────────────────────────────────────────────────────────────┘
```

**Modal title:** "Building your timeline…"
The `[×]` close button remains visible and functional — it cancels generation (§4.3).

### 4.2 Progress bar

The existing `ExportModal` progress bar component is reused verbatim.
`bg-vf-surface-sunken` trough, `bg-vf-selection` fill (sky-blue — not amber, not brand).
Percentage label: `text-xs font-mono text-vf-text-secondary` right-aligned.

**Progress mapping to server phases** (driven by BullMQ job events on
`GET /api/v1/script-studio/jobs/:id` or WebSocket push — Forge/Core own the contract):

| Phase | Progress range | Step label |
|---|---|---|
| Parsing / segmentation | 0–5% | "Analysing script…" |
| TTS synthesis per segment | 5–65% | "Synthesising voice-over (scene N of M)…" |
| Stock fetch (if applicable) | 65–75% | "Fetching visuals…" |
| Asset processing / proxy | 75–88% | "Processing assets…" |
| Assembling project | 88–95% | "Assembling timeline…" |
| Saving project | 95–100% | "Saving…" |

If the API only emits coarse phases (not per-segment), map to the same visual steps using
estimated sub-ranges. The bar should never appear to go backwards.

### 4.3 Phase checklist

Below the bar: a vertical checklist of the four top-level phases.

Each step has one of three states:
- **Done:** `✓` icon in `--vf-success-fg`, label in `text-vf-text-secondary`, strikethrough removed (label stays fully readable — strikethrough on progress copy is condescending to screen readers and visually noisy on dark).
- **In progress:** `◌` spinner glyph (CSS animation: `spin 1s linear infinite` gated by `--vf-motion-duration`) in `--vf-accent-text`, label in `text-vf-text-primary`.
- **Pending:** `○` hollow circle in `text-vf-text-disabled`, label in `text-vf-text-disabled`.

Accessibility: `role="list"`, each item `role="listitem"`. The in-progress step also has
`aria-live="polite"` on its label so screen readers announce phase transitions.

When "Script analysed — N scenes" completes, the count of scenes is filled in as
confirmed data, not a prediction. If scene detection is synchronous (it's heuristic, very fast),
this step can complete before the bar visually progresses past 5%.

### 4.4 Time estimate

Below the checklist: `"This usually takes 20–40 seconds."` — a static estimate, not
derived from the job. Matches `ExportModal`'s `estimateTimeLabel` spirit (honest, upfront).
`text-sm text-vf-text-tertiary`.

If the job has been running more than 60 seconds with no completion, replace with:
`"Still working — this can take up to a minute on first run (the voice model is warming up)."` —
calms without alarming. `text-sm text-vf-warning-fg` with a `⚠` icon.

### 4.5 Cancel behavior

`[Cancel]` button (`variant="ghost"`) sends a `DELETE /api/v1/script-studio/jobs/:id` request
(or the abort signal — Forge owns the API contract). On cancel:
- The modal closes immediately (optimistic).
- Any partially created assets are cleaned up server-side.
- A toast appears: `"Script Studio build cancelled."` — `text-sm`, no semantic colour, 3s auto-dismiss.
- The user lands back on the Dashboard. No project is created.

The `[×]` modal close button has the same effect as Cancel (not a no-op).
`aria-label="Cancel and close"` on the `[×]` button during the progress phase.

### 4.6 Error state

On job failure:

```
┌─ Build failed ─────────────────────────────────── [×] ─┐
│                                                         │
│   ⚠  Voice synthesis failed                            │
│   "Couldn't synthesise the voice-over. The voice       │
│    model may still be loading — try again in a         │
│    moment."                                            │
│                                                         │
│             [Back to script]   [Try again]              │
└─────────────────────────────────────────────────────────┘
```

**Modal title:** "Build failed"
Icon: `⚠` in `--vf-danger-fg`.
Error message: plain, specific, second-person. No apology — just what happened and what to do.

Two actions:
- `[Back to script]` — ghost button — returns to the input form with all values preserved (script text, settings). The user should not have to re-type their script.
- `[Try again]` — secondary button — re-submits the same job without going back to the input form.

Common failure messages:

| Failure | Copy |
|---|---|
| TTS engine not ready | "The voice model is still loading on our server. Try again in 30 seconds." |
| Script too long | "Your script has too many segments — try splitting it into two projects." |
| Stock API rate-limited | "Couldn't fetch stock clips right now. Switch to Text cards and try again." |
| Unexpected error | "Something went wrong building the timeline. Your script is saved — try again or contact support." |

---

## 5. Landing in the editor

When the job succeeds (100% progress), the modal animates out and the app navigates to
`/editor/:projectId` — the **normal editor** with the generated project pre-loaded.

### 5.1 The "draft" signal — no new mode

The generated project is a standard `Project`. The editor is in no special "Script Studio mode."
The signal that "this is a draft to edit" comes through three lightweight, additive cues —
none of which require a new mode or new editor chrome:

**Cue A — Toast on arrival (5 seconds, manual dismiss)**

> "Timeline draft ready — 6 scenes, 1m 43s. Edit freely, then export when you're done."

`text-sm`. No semantic colour (not success-green — this is information, not a status). Uses the
existing toast system. `z-toast` layering. Dismiss button (`aria-label="Dismiss"`).

**Cue B — Inspector banner (first-session only)**

If `isFirstSession()` is true, show a one-time dismissible info banner at the top of the
**right inspector panel** (above the clip properties, if a clip is selected; otherwise
above the panel's empty state):

```
┌───────────────────────────────────────────────────────────────┐
│ (i)  This is your Script Studio draft. Trim clips, swap       │
│      visuals, edit captions — then Export when ready.  [×]   │
└───────────────────────────────────────────────────────────────┘
```

Style: `bg-vf-info-subtle border border-vf-info-bg rounded-md px-3 py-2 mx-3 mt-3`.
`text-xs text-vf-text-secondary`. `[×]` dismisses and sets `localStorage.setItem('vf_ss_banner_dismissed', '1')`.
Only shown once (guard: `!localStorage.getItem('vf_ss_banner_dismissed')`).

**Cue C — Timeline track header labels**
The voice-over track header shows `"Voice-over (Script Studio)"` as its name.
The video track header shows `"Scenes (Script Studio)"`.
These are the `track.name` fields in the `Project` — set by the assembler, displayed by the
existing track-header component. No new UI. The user can rename tracks in the inspector like any
other track (if/when that feature lands).

### 5.2 The timeline on landing

The generated timeline is fully editable from the first frame. Nothing is locked or read-only.
Clips can be trimmed, deleted, reordered, split. Captions are editable. The voice-over audio
clip shows a real waveform (generated via the existing `extractWaveformPeaks` path — same as
any audio asset).

The Export button in TopBar is **amber** immediately (because `durationMs > 0` from the
generated clips) — reinforcing Cue A and the existing "grey → amber" aha moment from the
onboarding brief.

**No regeneration CTA anywhere in the editor for MVP.** The user edits like any other project.
A future "Re-roll this scene" per-clip action would live in the right-click context menu on a
clip — out of scope, not designed here.

### 5.3 Attribution display (stock-video path only)

If the project was built with stock scenes, each stock clip's attribution data is stored in
the `ScriptManifest` sidecar (Forge §2.4). Surface attribution in the right inspector panel
when a stock clip is selected:

```
Source
  "Ocean at Sunrise" by Mike Johnson on Pexels   [↗]
```

`text-xs text-vf-text-tertiary`. The `[↗]` link opens the Pexels/Pixabay page in a new tab
(`target="_blank" rel="noopener noreferrer"`). This is a requirement of the Pexels API ToS
(Scout §2).

If attribution data is missing for a stock clip (e.g. the sidecar was dropped), show:
`"Source: stock video (attribution unavailable)"` — never silently hide the obligation.

---

## 6. Component inventory — what Pixel reuses vs creates

### 6.1 Reused verbatim (zero changes)

| Component | Reuse point |
|---|---|
| `<Modal>` | ScriptStudio modal shell, progress shell, error shell |
| `RatioTile` + radiogroup | Aspect ratio chooser (§3.3) |
| `<Field>` | Script textarea wrapper, project name field |
| `<Button variant="ghost">` | Cancel, Back to script |
| `<Button variant="secondary">` | "Build timeline →", "Try again" |
| `ExportModal` progress bar markup | Progress bar (§4.2) — extract to a shared `<ProgressBar>` or inline |
| Toast system | Arrival toast (§5.1) |
| Right-inspector panel | Attribution + first-session banner (§5.1 cue B) |
| TopBar `Export` button | Unchanged — amber, same logic, same gate |

### 6.2 New components (minimal, scoped)

| Component | Description | Size |
|---|---|---|
| `<ScriptTextarea>` | Textarea + char count + first-session hint overlay | ~60 lines |
| `<VoiceSelector>` | `<select>` + preview audio button, loads from API | ~80 lines |
| `<SceneStylePicker>` | Three-option pill radiogroup + info note | ~50 lines |
| `<CaptionToggle>` | Two-option pill toggle (On/Off) | ~30 lines |
| `<GenerationChecklist>` | Phase checklist (§4.3) | ~60 lines |
| `<ScriptStudioModal>` | Container: input form ↔ progress view state machine | ~150 lines |

All new components use only existing `--vf-*` tokens. No new token values.
`<ScriptStudioModal>` is a route component at `/script-studio/new`.

---

## 7. States — complete matrix

### 7.1 ScriptStudio Modal (input form)

| State | Visual |
|---|---|
| **Empty** | Textarea shows placeholder + first-session hint block. "Build timeline →" disabled (no script, no ratio). |
| **Script typed, no ratio** | Textarea filled. "Build timeline →" disabled, `aria-describedby` → "Choose an aspect ratio first". |
| **Script typed + ratio selected** | All required fields complete. "Build timeline →" enabled, `variant="secondary"`. |
| **Character limit approaching (7500+)** | Char count `text-vf-warning-fg`. |
| **Character limit reached (8000)** | Char count `text-vf-danger-fg`. Textarea border `--vf-border-strong`. "Build timeline →" disabled. |
| **Submitting** | Modal title animates to "Building your timeline…". Input form fades out (`opacity-0 pointer-events-none`), progress view fades in. Transition: `--vf-motion-slow` (240ms). |

### 7.2 Progress view

| State | Visual |
|---|---|
| **In-progress** | Bar fills, phase checklist updates, step labels rotate per phase. |
| **Stalled > 60s** | Time estimate copy switches to warm-up notice (`text-vf-warning-fg`). |
| **Success (100%)** | Bar fills fully (100%, `--vf-selection` fill). Brief (300ms) pause, then `navigate('/editor/:id')`. Modal exits. Arrival toast fires. |
| **Cancelled** | Modal closes. Toast: "Script Studio build cancelled." Dashboard shows. |
| **Error** | Progress view swaps to error layout (§4.6). |

### 7.3 Editor landing

| State | Visual |
|---|---|
| **Arrival** | Arrival toast (5s). All tracks populated and editable. Export amber and enabled. |
| **First-session** | Inspector banner visible. |
| **Banner dismissed** | Banner gone, never returns. Toast still fires on future re-opens (it is a per-session notice, not a one-time gate). |
| **Stock clip selected** | Attribution block in inspector. |

---

## 8. Keyboard paths

All Script Studio surfaces must have complete keyboard paths (WCAG 2.5.7).

| Action | Keyboard path |
|---|---|
| Open Script Studio from Dashboard empty state | Tab to "Or paste a script → auto-build" link, Enter |
| Open from Dashboard populated (create-tile chip) | Tab to chip, Enter |
| Open from NewProjectModal | Tab to "Script Studio" ghost button, Enter |
| Script textarea | Tab to focus, type freely |
| Move between ratio tiles | Arrow keys (roving tabindex, same as `NewProjectModal`) |
| Select ratio | Space / Enter |
| Move between scene-style options | Arrow keys (roving tabindex) |
| Toggle captions | Space / Enter on the On/Off toggle options |
| Voice selector | Native `<select>` keyboard: Up/Down arrows |
| Preview voice | Tab to [▶ Preview] button, Enter |
| Build timeline | Tab to "Build timeline →", Enter |
| Cancel build | Tab to [Cancel], Enter — or Escape (closes modal, same as cancel) |
| Dismiss arrival toast | Tab to dismiss button, Enter — or Escape |
| Dismiss inspector banner | Tab to [×], Enter |

**Escape key behavior:**
- In input form: closes modal (same as clicking Cancel). No build is started.
- In progress view: cancels the build and closes the modal (same as clicking Cancel).
- Focus returns to the triggering element (the "Script Studio" chip/link/button that opened the modal).

---

## 9. Accessibility requirements

All requirements inherit from `Design_Instructions_MVP.md §11` (WCAG 2.2 AA, axe-clean).
Script Studio-specific additions:

- **Progress bar** has `role="progressbar"`, `aria-valuenow`, `aria-valuemin="0"`, `aria-valuemax="100"`,
  `aria-label="Build progress"`. (Same pattern as ExportModal's progress element.)
- **Phase checklist** has `role="list"`. The active phase item has `aria-live="polite"` on the label span.
- **Character count** has `aria-live="polite"` on the count span so screen readers announce it as the user types (debounced at 500ms to avoid noise).
- **Voice select** has an associated `<label>` (via `htmlFor` / `id` pair or wrapped in `<Field>`).
- **Scene style radiogroup** has `aria-label="Scene style"`. Options use `role="radio"` + `aria-checked`.
- **Caption toggle** has `aria-label="Captions"`. Options use `role="radio"` + `aria-checked`.
- **Modal focus trap** applies to the ScriptStudio modal (same as existing `<Modal>` component).
- **Color is never the sole signal**: progress phase states use icon + text, not just color.
- All interactive targets ≥ 24×24 CSS px.

---

## 10. Copy — exact strings

### 10.1 Dashboard entry points

| Element | Copy |
|---|---|
| Empty-state link | "Or paste a script → auto-build" |
| Create-tile chip | "▶ Script Studio" |
| NewProjectModal ghost button | "Script Studio — paste a script, get a full timeline draft" |

### 10.2 Script input form

| Element | Copy |
|---|---|
| Modal title | "New project from script" |
| Textarea label | "Script" |
| Textarea placeholder | "Paste or type your script here. Each paragraph will become a scene." |
| First-session hint | "Write one paragraph per scene. VideoForge will add a voice-over, match visuals, and drop captions — then open the draft timeline in the editor, ready to refine." |
| Stock info note | "Stock clips require attribution (Photographer name + Pexels/Pixabay link) saved with your project." |
| Caption sub-note | "Captions are auto-timed from the voice-over. You can edit them in the editor." |
| Disabled Build hint | "Choose an aspect ratio first" (sr-only, aria-describedby) |
| CTA | "Build timeline →" |

### 10.3 Progress view

| Element | Copy |
|---|---|
| Modal title | "Building your timeline…" |
| Phase 1 | "Analysing script…" / "Script analysed — N scenes" (done) |
| Phase 2 | "Synthesising voice-over (scene N of M)…" |
| Phase 3 (stock) | "Fetching visuals…" / "Fetching visuals — N clips found" (done) |
| Phase 3 (text cards) | "Preparing text cards…" |
| Phase 4 | "Assembling timeline…" |
| Phase 5 | "Saving…" |
| Time estimate | "This usually takes 20–40 seconds." |
| Stalled > 60s | "Still working — this can take up to a minute on first run (the voice model is warming up)." |
| Cancel button | "Cancel" |
| Modal [×] aria-label | "Cancel and close" |

### 10.4 Error state

| Element | Copy |
|---|---|
| Modal title | "Build failed" |
| TTS not ready | "The voice model is still loading on our server. Try again in 30 seconds." |
| Script too long | "Your script has too many segments — try splitting it into two projects." |
| Stock rate-limited | "Couldn't fetch stock clips right now. Switch to Text cards and try again." |
| Generic failure | "Something went wrong building the timeline. Your script is saved — try again or contact support." |
| Back button | "Back to script" |
| Retry button | "Try again" |

### 10.5 Editor landing

| Element | Copy |
|---|---|
| Arrival toast | "Timeline draft ready — N scenes, Xm Xs. Edit freely, then export when you're done." |
| Inspector banner | "This is your Script Studio draft. Trim clips, swap visuals, edit captions — then Export when ready." |
| VO track name | "Voice-over (Script Studio)" |
| Scenes track name | "Scenes (Script Studio)" |
| Attribution label | "Source" |
| Attribution missing | "Source: stock video (attribution unavailable)" |

---

## 11. Motion

All transitions use existing tokens from `Design_Instructions_MVP.md §2.11`.
Reduced-motion: all animations collapse under `--vf-motion-duration: 0ms` (the existing master gate).

| Transition | Token | Notes |
|---|---|---|
| Input form → progress view | `--vf-motion-slow` (240ms) | Cross-fade, `--vf-ease-standard` |
| Progress bar fill | CSS `transition: width` `--vf-motion-base` (180ms) | Per-update, not per-frame |
| Phase item done → next active | `--vf-motion-fast` (120ms) | Icon swap + color change |
| Modal enter / exit | `--vf-motion-slow` (240ms) | Same as `ExportModal` |
| Error state appearance | `--vf-motion-base` (180ms) | Replaces progress view in-place |
| Arrival toast | `--vf-motion-base` in, `--vf-motion-fast` out | Existing toast system |

---

## 12. What this is NOT (scope boundary for Pixel)

- **No regenerate / re-roll UI.** Post-landing edits happen in the normal editor. Re-roll is a
  future per-clip context menu item, not in this brief.
- **No script history or draft-save.** The textarea is transient. If the user navigates away,
  the script is lost (consistent with how the existing New-Project modal works).
- **No credit / usage meter UI.** This is a $0 feature; no quota display is needed.
- **No onboarding overlay / product tour.** The three cues in §5.1 are sufficient.
- **No changes to the ExportModal, Timeline, Canvas, or MediaPanel.** The generated project
  lands in those surfaces unchanged; those components do not know Script Studio exists.
- **No new design tokens.** Every value is an existing `--vf-*` token.

---

## 13. Open questions for Vera / Atlas

1. **Voice list API contract** — who is the source of truth for the voice selector options?
   The brief assumes `GET /api/v1/script-studio/voices` returns `{id, name, description, previewUrl}[]`.
   Core needs to confirm this endpoint and its response shape before Pixel builds the selector.

2. **Stock path: v1 text-cards-only or Pexels on day one?**
   The brief designs the full three-option scene style picker (text cards / stock / mixed)
   because it costs nothing to design. But if Vera's answer is "text cards only in v1," Pixel
   can ship the scene style section as a static "Text cards" label with a "(Stock video coming soon)"
   note — no picker UI needed, one less component.

3. **Attribution storage hook** — the `ScriptManifest` sidecar carries attribution data (Forge §2.4).
   The inspector attribution block (§5.3) reads from it. How does the client-side editor access
   the sidecar? Via a separate `GET /api/v1/projects/:id/script-manifest` endpoint, or bundled with
   the project load response? Forge/Core to confirm; Pixel needs the shape before building the
   inspector block.

4. **Job polling vs WebSocket** — the progress view needs a real-time signal.
   ExportModal uses WebSocket push + HTTP polling as fallback. Should ScriptStudio reuse the same
   `wsClient` pattern, or is there a different event topic for script jobs? Core to confirm the
   event schema so Pixel can wire the checklist correctly.

5. **Error recovery: does the server preserve the partial job result for retry?**
   The "Try again" button in the error state re-submits the job. Does the server retain the
   already-synthesised audio segments to skip completed phases, or does it start from scratch?
   This affects whether "Try again" copy should say "Resume" or "Try again." Forge to advise.

6. **Stalled-model warm-up UX** — if the Piper/Kokoro model cold-starts on the worker (first
   request after idle), actual latency could be 2–3 minutes on a slow CPU. Should the stalled-
   estimate copy become "up to 2–3 minutes on first use" or is there a pre-warm mechanism?
   Forge/Anchor to confirm so copy is accurate, not falsely reassuring.
