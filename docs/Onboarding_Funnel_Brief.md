# Onboarding Funnel — Design Brief (ROADMAP Now #6)

Author: **Iris** (Head of Design) · For: **Pixel** to implement · 2026-06-04

**Diagnosis:** the funnel's screens already exist (Dashboard, NewProjectModal, MediaPanel,
ExportModal, TopBar). What's missing is the *connective tissue* — first-session guidance + the
brand "aha". All changes below are **additive**, no redesign, no new tokens, no new routes.

## First-session mechanic
On first load with no projects: `localStorage.setItem('vf_first_session','1')`. Clear it on first
successful export. First-session-only hints read `localStorage.getItem('vf_first_session')` inline
(no provider). No tooltips — contextual copy that disappears once the action is taken.

## The funnel, step by step
1. **Dashboard empty state** — tighten copy to lead with the action + the 10-min north-star + the
   wedge: *"Drop a video to start. Import → arrange → export — usually under 10 minutes. What you
   cut is what you get."* "New project" CTA stays **non-amber** (amber is Export-only).
2. **New Project modal** — keep equal-weight chooser (no default). Add a reactive hint line under
   the tiles (e.g. select 9:16 → "Vertical · best for TikTok, Reels, Shorts"). Add a swappable
   `const DEFAULT_RATIO: RatioId | null = null;` (line ~24) so the CEO's pending 9:16-vs-equal
   decision is a one-line flip. Add `aria-describedby` "Choose an aspect ratio first" on the
   disabled Create button.
3. **Editor first open** — MediaPanel empty state becomes a prominent dashed **drop-zone** ("Drop a
   video here / or click Import media above / MP4·MOV·MKV·MP3·WAV"), reusing the existing
   `dragOver` outline. Timeline body shows a centered hint when clip count == 0. **Export button is
   `disabled` (with `aria-disabled="true"`, not bare `disabled`) until `durationMs > 0`** — wire
   `selectProjectDurationMs` into TopBar.
4. **First clip lands** — no new UI; the canvas renders + the Export button **transitions grey →
   amber**. That state change *is* the first "aha".
5. **Export modal — the parity reveal.** `done` phase copy: *"This MP4 was built from the same edit
   graph your preview used. Every trim, cut, and clip is exactly as you arranged it."* Success icon
   green (`--vf-success-fg`); Download MP4 stays amber. First-session-only info banner in `config`
   phase discloses the watermark once.
6. **Post-export** — clear `vf_first_session`; fire `ttfe:export_complete` (Anchor owns the event,
   Pixel hooks the Download click).

## Files to change (effort ≈ 1 eng-day total)
| File | Change |
|---|---|
| `Dashboard.tsx` | empty-state copy; set `vf_first_session` when 0 projects |
| `NewProjectModal.tsx` | `DEFAULT_RATIO` const; reactive hint; `aria-describedby` |
| `MediaPanel.tsx` | empty-state → dashed drop-zone block |
| `TopBar.tsx` | import `selectProjectDurationMs`; `disabled={durationMs===0}` on Export |
| `Timeline.tsx` | centered empty-state hint when no clips |
| `ExportModal.tsx` | done-phase parity copy; first-session watermark banner; clear flag + fire event on download |
| `Button.tsx` | confirm disabled amber renders `opacity-40` + `aria-disabled` |

## Two designed "aha" moments
- **A — timeline comes alive:** drop first clip → canvas frame + clip block + Export goes amber. No toast, no explainer.
- **B — parity reveal:** the `done`-phase sentence states what just happened, at the exact moment the user holds the file and can verify it against the preview.

## Hook points for other personas
- **Anchor:** `Sentry.captureEvent({message:'ttfe:export_complete', extra:{durationMs, projectId, aspectRatio}})`.
- **Sentinel:** verify Export uses `aria-disabled` (keeps focus order) — axe check.
- **Core/Vera:** localStorage first-session is the MVP stub; replace with a real user "has-exported" flag once auth lands.
