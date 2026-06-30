# Command Editing — Interaction & Visual Design Brief

**Feature:** Structured text-command timeline editing ("Command Editing")
**Owner:** Iris (Head of Design, Zentrix Studio)
**Phase:** A — Design (runs parallel with Vera's scope work)
**Date:** 2026-06-27
**Implements into:** `apps/web/src/components/editor/ai-edit/AIEditCommandBar.tsx`
**Preview panel:** `apps/web/src/components/editor/ai-edit/AIEditPreviewPanel.tsx`
**Editor layout anchor:** `apps/web/src/routes/Editor.tsx` line 827 (Band 3, above Timeline)

---

## 0. Design premise

The current `AIEditCommandBar` accepts a free-text textarea and sends it to a parser.
Command Editing replaces that textarea with a **structured tokenizer**: the user builds a
command slot-by-slot by selecting from scoped typeahead dropdowns. Each accepted slot
freezes into a removable **token pill** in the bar. The bar always reads like prose ("add
transition at 0:30") but every word is machine-parsed — no ambiguity, no "could not
understand command" dead ends.

This is the same faceted-search pattern used in GitHub search qualifiers, Linear ⌘K, and
Slack search, adapted to an NLE action vocabulary.

**What does NOT change:**
- The `AIEditPreviewPanel` already exists and works. Command Editing feeds it exactly as the
  textarea did — the only change is how `pending` gets populated (slot-by-slot structured
  input vs. one free-text parse).
- The `⌘K` focus shortcut stays identical. The `Sparkles` icon, the bar's position in Band
  3, the `border-b border-vf-border-subtle bg-vf-surface-1 px-3 py-2` container — all
  preserved.
- The amber `--vf-accent` Submit/Apply button (currently `bg-vf-accent`) is removed from
  the bar itself. The one `--vf-accent` CTA remains the **Export** button in the TopBar.
  The Command Editing commit action uses `--vf-selection` (sky-blue) as its primary color.

---

## 1. Slot grammar

Every command is built from exactly four ordered slots. Slots 3 and 4 are context-dependent.

```
[ACTION] [OBJECT] [VALUE] [POSITION?]
```

| Slot | # | Required | Examples |
|------|---|----------|---------|
| ACTION | 1 | always | add, delete, split, trim, increase, decrease, set, mute |
| OBJECT | 2 | always | transition, caption, brightness, contrast, saturation, zoom, volume, emoji, circle, line, text |
| VALUE | 3 | always | at 0:30 / 0:10 to 0:25 / by 10% / fade / crossfade / 80% |
| POSITION | 4 | spatial objects only | top-left / center / bottom-right / custom x,y |

**Spatial objects** (objects that have a canvas location): emoji, circle, line, text overlay,
image. Non-spatial objects (transition, caption, brightness, contrast, saturation, zoom,
volume, audio fade) do not present Slot 4.

**Clip target resolution:** The command never asks the user to name a clip. The target is
resolved from: (1) the current timeline selection, or (2) the playhead position if nothing
is selected. The resolved target is injected as a read-only "context pill" prepended to the
ACTION slot — visually distinct (outlined, not filled) so the user sees exactly what they
will hit before committing.

---

## 2. Interaction flow — keystroke walkthrough

### 2.1 Empty state / bar at rest

```
┌────────────────────────────────────────────────────────────────────────────────┐
│ ✦  [Type a command or press Space to browse…]                       ⌘K  [Run] │
└────────────────────────────────────────────────────────────────────────────────┘
```

- The `✦` Sparkles icon sits left, `color: var(--vf-selection)` — this is the single
  sky-blue decoration in the bar. (Amber is not used here.)
- Placeholder text: `"Type a command or press Space to browse…"`
  `color: var(--vf-text-tertiary)` — 5.1:1 contrast against `--vf-surface-1`.
- The `[Run]` button: `background: var(--vf-surface-3)`, `color: var(--vf-text-disabled)`,
  `cursor: not-allowed` — it is disabled until all required slots are filled. It is NOT
  amber (`--vf-accent`) — that is reserved for Export only.
- The `⌘K` badge (12px monospaced text in a `--vf-surface-3` pill) appears right of the
  placeholder, confirming the shortcut.

No history dropdown or example chips are shown in the resting state. History is accessible
via the Up arrow key once the bar is focused (see §5 Keyboard map).

---

### 2.2 Example A — "add transition at 0:30"

#### Step 1: User presses ⌘K (or clicks the bar)

Bar gains focus. Dropdown opens immediately showing Slot 1 (ACTION) suggestions.

```
┌────────────────────────────────────────────────────────────────────────────────┐
│ ✦  [                                                    ]            ⌘K  [Run] │
└──────────────────────────────────────────────────────────────────────────────┤
   ┌──────────────────────────────────────────────────┐
   │ ACTION                                           │
   │ ──────────────────────────────────────────────── │
   │ ▶  add              Insert a new element         │
   │    delete           Remove clip or range         │
   │    split            Split clip at time           │
   │    trim             Shorten clip                 │
   │    increase         Raise a property value       │
   │    decrease         Lower a property value       │
   │    set              Assign an exact value        │
   │    mute             Silence a clip/range         │
   └──────────────────────────────────────────────────┘
```

The dropdown appears below the bar, `z-index` above the timeline (see §6 Layout).
First item is highlighted (sky-blue left accent bar, `--vf-selection`, `--vf-surface-3`
background). Arrow keys move highlight; Enter or Tab accepts.

#### Step 2: User types "a"

Dropdown filters to actions starting with "a": **add**. Ghost completion text appears in
the input: `a`**`dd`** — the typed characters in `--vf-text-primary`, the ghost suffix
in `--vf-text-tertiary`.

#### Step 3: User presses Tab (or Enter, or Space after "add")

**"add"** is accepted. A filled token pill appears:

```
│ ✦  [add ×]  [                                       ]            ⌘K  [Run] │
```

The cursor moves into Slot 2 (OBJECT). Dropdown refreshes to show valid objects for "add":

```
   ┌──────────────────────────────────────────────────┐
   │ OBJECT  (what to add)                            │
   │ ──────────────────────────────────────────────── │
   │ ▶  transition       Cut-point blend              │
   │    caption          Text overlay caption         │
   │    zoom             Ken Burns zoom effect        │
   │    emoji            Unicode emoji element        │
   │    circle           Shape element                │
   │    line             Line element                 │
   │    text             Text overlay element         │
   └──────────────────────────────────────────────────┘
```

#### Step 4: User types "tr"

Dropdown filters to: **transition**, (trim is an ACTION not an OBJECT — filtered out).
Ghost completion: `tr`**`ansition`**

#### Step 5: User presses Tab

**"transition"** accepted. Pill row now reads:

```
│ ✦  [add ×]  [transition ×]  [                      ]            ⌘K  [Run] │
```

Cursor moves into Slot 3 (VALUE). Because the OBJECT is "transition", the VALUE dropdown
shows time-based and enum options:

```
   ┌──────────────────────────────────────────────────┐
   │ VALUE  (when / what kind)                        │
   │ ──────────────────────────────────────────────── │
   │    at [time]        At a specific timecode       │
   │    crossfade        Dissolve blend (default)     │
   │    fade             Simple opacity fade          │
   │    wipe             Left-to-right wipe           │
   │    dip to black     Fade through black           │
   │    zoom transition  Scale-based transition       │
   └──────────────────────────────────────────────────┘
```

Hint text appears below the input in the dropdown header:
`"Type a time (0:30) or pick a transition kind"`

#### Step 6: User types "at 0"

Ghost completion shows `at 0`:

The free-typed time value "at 0:30" is accepted without needing to be in the suggestion
list. As the user types a valid timecode pattern (`[digits]:[digits]`), a live suggestion
appears at the top of the dropdown:

```
   ┌──────────────────────────────────────────────────┐
   │ VALUE                                            │
   │ ──────────────────────────────────────────────── │
   │ ▶  at 0:30          Accept this timecode         │
   │    crossfade        Dissolve blend               │
   │    fade             Opacity fade                 │
   └──────────────────────────────────────────────────┘
```

The live-parsed option (`at 0:30`) is always pinned first, styled with a
`--vf-selection`-colored clock icon to signal "this is your typed value, parsed".

#### Step 7: User presses Enter

**"at 0:30"** accepted. Slot 3 complete. OBJECT is "transition" (non-spatial), so Slot 4
(POSITION) is skipped. The [Run] button activates:

```
│ ✦  [add ×]  [transition ×]  [at 0:30 ×]                    [Run ▶] │
```

The `[Run]` button is now `background: var(--vf-selection)`, `color: white`,
`font-weight: 600`. The command reads like prose: "add transition at 0:30".

The timeline simultaneously highlights the frame around 0:30 with a translucent
`--vf-selection` band (dry-run preview) — this happens before the user clicks Run.

#### Step 8: User presses Enter (or clicks Run)

The command is committed. `AIEditPreviewPanel` slides open below the bar (as it does
today), showing the action summary and Apply / Cancel. The slot pills are cleared from the
bar. Focus returns to the bar's input area.

---

### 2.3 Example B — "add emoji at 0:12 top-right" (spatial, with Slot 4)

After accepting `[add]` `[emoji]` `[at 0:12]`, because "emoji" is a spatial object, the
bar does NOT activate Run. Instead Slot 4 opens:

```
│ ✦  [add ×]  [emoji ×]  [at 0:12 ×]  [               ]     [Run] │
                                                             (disabled)
```

Dropdown shows the 9-grid anchor picker (detailed in §4). User clicks or arrows to
"top-right". Slot 4 pill appears: `[top-right ×]`. Run activates.

---

### 2.4 Backspace behavior

At any point when the text input for the current slot is empty, pressing Backspace removes
the most recently accepted pill and returns focus to that slot's input — the dropdown
reopens scoped to that slot's valid options.

Example: with `[add] [transition] [at 0:30]` and cursor in the empty Run-ready state,
pressing Backspace removes `[at 0:30]` and reopens Slot 3's VALUE dropdown.

A second Backspace removes `[transition]` and reopens Slot 2's OBJECT dropdown.
A third Backspace removes `[add]` and returns the bar to empty state.

---

### 2.5 Escape behavior

- While the dropdown is open: Escape closes the dropdown without accepting. Focus remains
  on the bar input.
- While the bar has pills but no open dropdown: Escape clears all pills and resets to empty
  state.
- If `AIEditPreviewPanel` is open: Escape dismisses the panel (calls `onCancel`) — this
  matches the existing behavior.

---

### 2.6 Error / no-match state

If the user types free text in a slot that has no valid enum match AND the text cannot be
parsed as a timecode or percentage:

```
   ┌──────────────────────────────────────────────────┐
   │ No matches for "bloop"                           │
   │ ──────────────────────────────────────────────── │
   │ Try: "fade", "crossfade", "at 0:30", "by 10%"   │
   └──────────────────────────────────────────────────┘
```

The dropdown body shows one row: "No matches" in `--vf-text-tertiary`, followed by a hint
row showing valid input shapes for the current slot. The hint uses `--vf-text-tertiary`,
`font-size: var(--vf-text-xs)`. The slot's input border changes to
`border-color: var(--vf-danger-fg)` at 0.5 opacity (so it reads as invalid but not as a
hard error). Run stays disabled.

---

## 3. Typeahead behavior spec

### 3.1 Dropdown opening rules

| Trigger | Behavior |
|---------|----------|
| Bar focused with empty pills | Slot 1 (ACTION) dropdown opens immediately |
| Slot n pill accepted | Slot n+1 dropdown opens immediately |
| User backspaces empty slot | Current slot's dropdown reopens |
| User clicks inside pill row after a slot gap | Dropdown for the next empty slot opens |
| Mouse hover over a suggestion | Moves keyboard highlight to that row |

### 3.2 Suggestion ordering within a slot

1. Most recently used picks for this slot (from session memory, max 3 recency pins at top)
2. Frequency-weighted canonical list for the slot, in the order shown in §2.2 examples
3. Live-parsed free-value option (timecodes, percentages, raw numbers) pinned at top when
   the typed text matches a value pattern, above recency pins

### 3.3 Free-typed value acceptance

**Timecodes** match the pattern `M:SS` or `H:MM:SS` (same regex as the existing
`parseTimeToSeconds` in `apps/web/src/ai-edit/time.ts`). As the user types, the dropdown
shows a live "accept as timecode" option that updates in real time. Pressing Enter or Tab
accepts it.

**Percentages** match `[digits]%` or `by [digits]%`. Shown as "accept as [N]%" in the
dropdown.

**Enums** (transition kinds, aspect ratios) must be chosen from the suggestion list. Free
typing filters the list; no raw-string acceptance for enums.

### 3.4 Ghost text

Ghost text appears in the current slot's text node, after the user's typed characters,
showing the shortest completion that matches the typed prefix. It is rendered in
`color: var(--vf-text-tertiary)` at 80% opacity. Pressing the right-arrow key or Tab
accepts the ghost completion. The ghost text is a `<span aria-hidden="true">` — it is
never read by screen readers (the live region announces the highlighted suggestion instead,
see §5).

### 3.5 "Reads like prose" feel

The pill row is rendered as an inline flow — pills are spaced with `gap: var(--vf-space-2)`
(8px) in a flex row. The current slot's text input immediately follows the last pill with no
visual break. To a casual observer the bar reads as a text field with colored inline words;
to the parser it is a strict slot array. No visual separator (slash, colon, arrow) is shown
between slots — prose rhythm is the separator.

---

## 4. Visual spec

### 4.1 Bar container

No change to the outer container. Existing classes preserved:
`border-b border-vf-border-subtle bg-vf-surface-1 px-3 py-2`

Height: 44px at rest (same as current), expands to `auto` if multiple lines of pills are
needed (max 2 lines before horizontal scrolling kicks in on the pill row).

### 4.2 Pill anatomy

Each accepted slot token is a pill:

```
┌─────────────────────┐
│  [icon]  label   ×  │
└─────────────────────┘
```

| Property | Token / value |
|----------|--------------|
| Height | 24px (`h-6` — matches `.vf-chip` in design.css) |
| Padding | `0 var(--vf-space-2)` (0 8px) |
| Border radius | `var(--vf-radius-pill)` (999px) |
| Font size | `var(--vf-text-xs)` (12px) |
| Font weight | `var(--vf-weight-medium)` (500) |
| Gap (icon to label to ×) | `var(--vf-space-1)` (4px) |

**Slot-differentiated pill fills** — using existing surface tokens, no new colors:

| Slot | Background | Border | Text | Icon color |
|------|-----------|--------|------|-----------|
| ACTION (Slot 1) | `--vf-surface-3` | `--vf-border-default` | `--vf-text-primary` | `--vf-icon-muted` |
| OBJECT (Slot 2) | `--vf-surface-3` | `--vf-selection` at 40% | `--vf-text-primary` | `--vf-selection` |
| VALUE (Slot 3) | `--vf-surface-3` | `--vf-border-default` | `--vf-text-primary` | `--vf-icon-muted` |
| POSITION (Slot 4) | `--vf-surface-3` | `--vf-border-default` | `--vf-text-primary` | `--vf-icon-muted` |
| CONTEXT (clip target) | `transparent` | `--vf-border-strong` | `--vf-text-secondary` | `--vf-icon-muted` |

The OBJECT pill gets a faint sky-blue border (`--vf-selection` at 40%) to visually anchor
it as the semantic heart of the command. This is the only use of sky-blue on a pill; it is
not amber, not purple.

The `×` dismiss button on each pill: 12px, `color: --vf-icon-muted`, becomes
`color: --vf-text-primary` on hover, click removes that pill and all pills to its right
(because later slots depend on earlier ones).

**Context pill (clip target):** prepended before the ACTION pill. Uses a dashed border
(`border-style: dashed`) to signal it is auto-resolved, not user-typed. Label reads
e.g. `"clip 3"` or `"selected clip"` or `"at playhead"`.

### 4.3 Dropdown panel

```
┌──────────────────────────────────────────────────────┐  surface-4, shadow-vf-3
│ SLOT LABEL (category header)                         │  text-2xs, text-tertiary,
│ ────────────────────────────────────────────────── │  uppercase, letter-spacing
│ ▶  Primary suggestion      Secondary descriptor      │  text-primary, text-tertiary
│    Suggestion 2            Descriptor                │
│    …                                                 │
│ ────────────────────────────────────────────────── │  (if free-typed value)
│ ▶  at 0:30                 Accept this timecode      │  text-primary, clock icon
└──────────────────────────────────────────────────────┘
```

| Property | Token / value |
|----------|--------------|
| Background | `--vf-surface-4` |
| Border | `1px solid var(--vf-border-default)` |
| Border radius | `var(--vf-radius-md)` (8px) |
| Shadow | `var(--vf-shadow-3)` |
| Max height | 280px (scrollable) |
| Min width | 280px |
| Row height | 36px |
| Row padding | `0 var(--vf-space-3)` |
| Category header | `--vf-text-2xs`, `--vf-text-tertiary`, uppercase, `letter-spacing: 0.06em` |
| Row separator (between sections) | `1px solid var(--vf-border-subtle)` |
| Z-index | 200 (above timeline Band 3, below modals at 900+) |

**Highlighted row state** (keyboard or mouse):
- Background: `--vf-surface-3`
- Left accent bar: `2px solid var(--vf-selection)` on the left edge
- Primary text: `--vf-text-primary`
- Descriptor text: `--vf-text-secondary`

**Hover state** (mouse, not yet keyboard-highlighted):
- Background: `--vf-surface-2`
- No left accent bar

### 4.4 Bar wireframes — 4 states

**State 1: Empty / resting**
```
┌────────────────────────────────────────────────────────────────┐
│ ✦  Type a command or press Space to browse…      ⌘K    [Run]  │
│    ^sky-blue                                          disabled  │
└────────────────────────────────────────────────────────────────┘
```

**State 2: Mid-build, Slot 2 focused with dropdown open**
```
┌────────────────────────────────────────────────────────────────┐
│ ✦  ╔clip 3╗  [add ×]  tr|ansition_              ⌘K    [Run]  │
│        dashed ctx pill  typed  ghost                  disabled  │
└────────────────────────────────────────────────────────────────┘
   ┌────────────────────────────────────────────────┐
   │ OBJECT                                         │
   │ ─────────────────────────────────────────────  │
   │ ▶  transition    Cut-point blend               │
   │    trim          — not valid here —            │
   └────────────────────────────────────────────────┘
```
(Note: "trim" would be filtered out since OBJECT only shows valid additions for "add")

**State 3: Command complete, Run active, dry-run preview on timeline**
```
┌────────────────────────────────────────────────────────────────┐
│ ✦  ╔clip 3╗  [add ×]  [transition ×]  [at 0:30 ×]   [Run ▶] │
│                                                    sky-blue btn │
└────────────────────────────────────────────────────────────────┘
  Timeline band below: translucent sky-blue highlight at ~0:30
```

**State 4: Preview panel open (post-Run)**
```
┌────────────────────────────────────────────────────────────────┐
│ ✦  [                                              ]  [Run]     │
│    (pills cleared, bar resets)                      disabled    │
├────────────────────────────────────────────────────────────────┤
│  ╔ AIEditPreviewPanel (existing component) ══════════════════╗  │
│  ║  add transition · clip 3 · at 0:30                    [×] ║  │
│  ║  Action: Add crossfade transition at 0:30               ║  │
│  ║  [Cancel]                             [Apply edits ▶]   ║  │
│  ╚═══════════════════════════════════════════════════════════╝  │
└────────────────────────────────────────────────────────────────┘
```

The "Apply edits" button in `AIEditPreviewPanel` continues to use `bg-vf-accent`
(amber) as it does today — this is the commit action and legitimately the primary CTA
at that moment. This does NOT conflict with the Export CTA because the preview panel
is not visible at the same time as the TopBar Export button (they are in different
visual zones and contexts).

### 4.5 Run button states

| State | Background | Text color | Icon |
|-------|-----------|-----------|------|
| Disabled (incomplete slots) | `--vf-surface-3` | `--vf-text-disabled` | none |
| Active (all slots complete) | `--vf-selection` | `white` | `▶` (ChevronRight, 14px) |
| Loading (awaiting parse result) | `--vf-surface-3` | `--vf-selection` | rotating `Clock` icon (existing) |

The Run button is sky-blue (selection token) when active, not amber. This separates
"execute a command edit" from "Export video" which is the single amber CTA.

---

## 5. Position-slot UX (Slot 4, spatial objects only)

### 5.1 9-grid anchor picker

When Slot 4 opens for a spatial object, the dropdown body becomes a combined 9-grid
visual picker PLUS the standard list beneath it.

```
   ┌────────────────────────────────────────────────┐
   │ POSITION  (where on the canvas)                │
   │ ────────────────────────────────────────────── │
   │                                                │
   │   ┌──────┬──────┬──────┐                      │
   │   │  TL  │  TC  │  TR  │   Named anchor grid   │
   │   ├──────┼──────┼──────┤   44×44px cells       │
   │   │  ML  │  C   │  MR  │   hover: surface-3    │
   │   ├──────┼──────┼──────┤   selected: selection │
   │   │  BL  │  BC  │  BR  │   border + surface-3  │
   │   └──────┴──────┴──────┘                      │
   │                                                │
   │ ──────────────────────────────────────────── │
   │    top-left         (keyboard: 7)              │
   │    top-center       (keyboard: 8)              │
   │    top-right        (keyboard: 9)              │
   │    middle-left      (keyboard: 4)              │
   │    center           (keyboard: 5)              │
   │    middle-right     (keyboard: 6)              │
   │    bottom-left      (keyboard: 1)              │
   │    bottom-center    (keyboard: 2)              │
   │    bottom-right     (keyboard: 3)              │
   │ ──────────────────────────────────────────── │
   │    Custom position…                            │
   └────────────────────────────────────────────────┘
```

Grid cells: 44×44px each (WCAG 2.5.8 target size), background `--vf-surface-3`, border
`1px solid --vf-border-subtle`. Hover: `--vf-surface-3` brightened by `filter:
brightness(1.15)`. Selected: `background: color-mix(in srgb, var(--vf-selection) 20%,
var(--vf-surface-3))`, `border: 1px solid var(--vf-selection)`.

Abbreviations TL/TC/TR etc. at `--vf-text-xs`, centered in each cell. A small dot in the
center of the selected cell reinforces the pick with a shape cue beyond color.

**Keyboard:** numpad-style numbering (1=BL, 2=BC, 3=BR, 4=ML, 5=C, 6=MR, 7=TL, 8=TC,
9=TR) displayed as small `--vf-text-2xs` `--vf-text-tertiary` labels in each cell corner.
Pressing the corresponding digit key selects that anchor directly.

When a grid cell is selected, it becomes the highlighted dropdown row AND the Slot 4 pill
is immediately pre-populated (user can press Enter or Tab to confirm, or click elsewhere
in the grid to change).

### 5.2 "Custom position…" advanced reveal

Clicking or pressing Enter on "Custom position…" row expands an inline sub-form BELOW the
grid (the dropdown grows in height, max 380px before scrolling):

```
   │ ──────────────────────────────────────────── │
   │  X  [___50___]%    Y  [___50___]%            │
   │  (0 = left edge / top edge)                  │
   └────────────────────────────────────────────────┘
```

Two `--vf-input` number inputs (36px height, matching `.vf-input` in design.css), labeled
"X" and "Y" in `--vf-label` style. Values are percent (0–100), matching the project schema
canvas geometry convention. Default pre-filled to 50 / 50 (center). Tab moves between X
and Y; Enter confirms and creates a `[x:50% y:50% ×]` pill.

The custom pill label format: `[x:N% y:N% ×]` — monospaced numbers using
`font-family: var(--vf-font-mono)` for the numeric portion.

---

## 6. Accessibility spec

### 6.1 ARIA pattern

The command bar implements the **ARIA Combobox Pattern** (WAI-ARIA 1.2, role="combobox"
with a managed listbox). One combobox per slot; when a slot is accepted the active
combobox moves to the next slot's input.

```html
<div role="group" aria-label="Edit command builder">
  <!-- Context pill (read-only, before slots) -->
  <span role="status" aria-label="Target: clip 3" class="…context-pill…">clip 3</span>

  <!-- Slot 1: ACTION -->
  <input
    role="combobox"
    aria-expanded="true|false"
    aria-haspopup="listbox"
    aria-controls="vf-cmd-slot-1-list"
    aria-autocomplete="list"
    aria-label="Action (step 1 of 4)"
    aria-describedby="vf-cmd-slot-hint"
  />
  <ul id="vf-cmd-slot-1-list" role="listbox" aria-label="Action suggestions">
    <li role="option" aria-selected="true|false">…</li>
  </ul>

  <!-- Accepted pill -->
  <span class="…pill…" aria-label="Action: add. Press Backspace to remove.">
    add
    <button aria-label="Remove 'add'" tabindex="-1">×</button>
  </span>

  <!-- Slot 2: OBJECT, etc. -->

  <!-- Run button -->
  <button aria-label="Run command: add transition at 0:30" aria-disabled="true|false">
    Run
  </button>
</div>

<!-- Live region for announcements -->
<div role="status" aria-live="polite" aria-atomic="true" class="vf-sr" id="vf-cmd-live">
  <!-- JS writes: "3 suggestions. 'transition' highlighted." -->
  <!-- On accept: "transition accepted. Next: value." -->
  <!-- On error: "No match. Try fade, crossfade, or a timecode." -->
</div>
```

The outer group is `role="group"` with a label, not a form — this avoids double-announced
"form" semantics while keeping the landmark grouping. The pills are `<span>` elements with
an embedded `<button>` for the ×; the button has `tabindex="-1"` so it is reachable only
via direct click (not part of the slot-to-slot Tab flow).

### 6.2 Keyboard map

| Key | Context | Action |
|-----|---------|--------|
| `⌘K` / `Ctrl+K` | Anywhere in editor | Focus bar, open Slot 1 dropdown |
| `↓` | Input focused, dropdown closed | Open dropdown |
| `↓` / `↑` | Dropdown open | Move highlight up/down |
| `Enter` | Highlight in dropdown | Accept highlighted suggestion |
| `Tab` | Dropdown open | Accept highlighted suggestion, advance to next slot |
| `Tab` | All slots complete | Move focus to Run button |
| `→` (right arrow) | Ghost text visible | Accept ghost completion |
| `Backspace` | Current slot input empty | Remove last pill, re-open that slot's dropdown |
| `Esc` | Dropdown open | Close dropdown; keep pills |
| `Esc` | Dropdown closed, pills present | Clear all pills |
| `Esc` | Preview panel open | Dismiss preview panel (existing behavior) |
| `1`–`9` | Slot 4 (POSITION) dropdown open | Select 9-grid anchor by numpad position |
| `Space` | Bar empty, no dropdown | Open Slot 1 dropdown (browse mode) |
| `↑` | Input at top of dropdown | Cycle to history (last 8 commands, same as existing) |
| `Enter` | Run button focused | Submit command (same as clicking Run) |

### 6.3 Focus management

- When a slot's pill is accepted, focus moves automatically to the next slot's input —
  no Tab press required. This keeps the flow unbroken for keyboard-only users.
- When all slots are accepted and Run activates, focus does NOT automatically jump to Run.
  The user must press Tab to reach Run. This avoids accidental submission.
- When the preview panel opens, focus moves to the panel's first interactive element
  (Cancel button), matching the existing `AIEditPreviewPanel` rendering logic.
- When the preview panel closes (Apply or Cancel), focus returns to the command bar input.

### 6.4 Color-only cue audit

All state signals in this component are redundantly coded:
- "Slot active" = input border color change + caret position + aria-label "step N of 4"
- "Suggestion highlighted" = background color + left accent bar (shape) + aria-selected
- "Pill accepted" = pill visible (shape) + text content + SR announcement
- "Run enabled" = button color change + icon appears + aria-disabled removed
- "Error / no match" = border color + dropdown text "No matches" + live region announcement
- "Position selected in grid" = cell background + center dot + text label

No state is communicated by color alone.

---

## 7. Where it lives in the editor layout

### 7.1 Current layout (unchanged)

```
┌──────────────────────── TopBar 56px ─────────────────────────┐
│         ← Export CTA with --vf-accent (amber) stays here →  │
├────────────────────────────────────────────────────────────── ┤
│ MediaPanel │       CanvasStage + Transport         │ Inspector │ ← fills
├─────────────────────── Band 3 ──────────────────────────────  ┤
│  [AIEditCommandBar]  ← Command Editing lives here (row-auto) │
│  [Timeline (1fr)]                                             │
├──────────────────── StatusBar 28px ──────────────────────────┤
└────────────────────────────────────────────────────────────── ┘
```

The `AIEditCommandBar` occupies the `grid-rows-[auto_1fr]` first row inside Band 3. The
Timeline takes the remaining `1fr`. This does not change.

### 7.2 Dropdown positioning

The dropdown opens **downward** from the command bar, overlapping the timeline. It must
not push the timeline down — it is a floating overlay, `position: absolute` with the
dropdown's top edge anchored to the bottom of the bar container. `z-index: 200` clears the
timeline but stays below modals (`z-index: 900`).

If the bar is at the very bottom of the viewport (unlikely given the StatusBar is always
present), the dropdown flips upward. This is a standard popper/floating-ui behavior.

### 7.3 Dry-run timeline highlight

When all required slots are filled (Run is active but not yet pressed), the timeline draws
a translucent overlay band at the target time range:

- Color: `var(--vf-selection)` at 15% opacity
- Shape: a vertical band spanning all tracks, from the target time ±100ms
- Border: `1px solid var(--vf-selection)` at 40% opacity on the left and right edges
- Label: small chip above the ruler showing the resolved time: `0:30` in
  `--vf-text-xs`, `--vf-surface-3` background

This is a read-only display cue. Pixel implements it in the Timeline component as a
conditional overlay layer driven by a `commandDryRunRange: { start: number; end: number } | null`
value surfaced from the editor store. The bar sets this when the command is complete and
clears it on Reset, Esc, or Apply.

### 7.4 Transition from Command Editing bar into AIEditPreviewPanel

1. User presses Run (Enter on Run button or click)
2. Bar: pills clear, input resets, bar enters "loading" state (Run button shows rotating
   Clock icon in `--vf-selection` color)
3. The existing `parseEditCommand` function is called with the structured slot values
   serialized to a command string (see Pixel implementation note below)
4. On result: `AIEditPreviewPanel` renders above the bar (its existing behavior: it appears
   at the top of the Bar's relative container), the dry-run timeline highlight clears
5. If the plan has `requiresConfirmation: false` AND `validation.valid: true`, the
   `applyPending` call MAY be made immediately without showing the panel — this is a
   Pixel/Vera product decision, not a design decision

**Serialization for the existing parser:** The structured slots serialize to a command
string that the existing local parser already handles cleanly:
- `[add] [transition] [at 0:30]` → `"add transition at 0:30"`
- `[add] [caption] [0:02 to 0:05]` → `"add caption from 0:02 to 0:05"`
- `[increase] [brightness] [by 10%]` → `"increase brightness by 10%"`
- `[add] [zoom] [0:10 to 0:25]` → `"add zoom from 0:10 to 0:25"`

This serialization means the Command Editing bar is a **drop-in replacement** for the
textarea — the parser interface does not change. The structured tokenizer is entirely a
front-end interaction layer.

---

## 8. Conflicts and implementation notes for Pixel

The following items were identified by reading the existing component against this spec:

### 8.1 Amber on the Apply button in AIEditPreviewPanel

`AIEditPreviewPanel.tsx` line 54–60 uses `bg-vf-accent` for the "Apply edits" button.
This is CORRECT and should not change. The amber is the commit CTA at that moment and is
not simultaneously visible with the Export button. No conflict.

### 8.2 The existing Send button is amber — this IS a conflict

`AIEditCommandBar.tsx` line 173: the submit button is `bg-vf-accent`. In the new design the
equivalent (Run) button is `--vf-selection` (sky-blue) when active, and `--vf-surface-3`
disabled when inactive. The amber submit button must be replaced. Rationale: the bar is
now a mid-flow structure-builder, not a direct "send to AI" action — the amber should only
appear on the final destructive-capable Apply in the preview panel.

### 8.3 Warning callout uses amber raw hex

`AIEditPreviewPanel.tsx` line 36: `border-amber-400/30 bg-amber-950/20 text-amber-100`.
These are Tailwind color classes, not `--vf-*` tokens. This should be migrated to
`border-vf-warning-fg/30 bg-vf-warning-subtle text-vf-warning-fg` (or
`vf-callout vf-callout-warn` classes from design.css). Not a Command Editing blocker but
should be filed as a design-debt fix.

### 8.4 History select element

The existing `<select>` history control (line 153) should be replaced by the Up-arrow
history behavior described in §6.2. The `<select>` element is not keyboard-accessible in
a way consistent with the combobox pattern. The session history (max 8, already in state)
should be surfaced as the bottom section of the Slot 1 dropdown (under a "Recent" divider)
when the bar is empty.

### 8.5 Textarea → slot input

The existing `<textarea ref={inputRef}>` must become a `<div>` pill container with an
embedded `<input>` for the current active slot. The `vf:focus-ai-edit` event listener and
the `⌘K` listener are correct and should be preserved — they should call `.focus()` on
the active slot's `<input>`, not the removed textarea.

### 8.6 commandDryRunRange in editorStore

A new field `commandDryRunRange: { startMs: number; endMs: number } | null` needs to be
added to `editorStore`. This is a Pixel task. The Command Editing bar writes to it; the
Timeline reads from it as a display-only overlay. No schema or export changes — it is
purely ephemeral UI state.

### 8.7 EXAMPLES chips

The `EXAMPLES` constant (lines 11–18 in AIEditCommandBar.tsx) that renders example chips
below the bar should be removed from the bar and moved into the Slot 1 dropdown as a
"Quick start" section at the bottom, formatted as suggestion rows. This keeps the bar
visually clean at rest.

---

## 9. Design token reference (no new tokens required)

This feature uses only existing `--vf-*` tokens. Summary of the key ones:

| Token | Use in this feature |
|-------|---------------------|
| `--vf-surface-1` | Bar container background (unchanged) |
| `--vf-surface-3` | Pill fill, dropdown row hover, disabled Run button |
| `--vf-surface-4` | Dropdown panel background |
| `--vf-border-subtle` | Bar bottom border (unchanged), pill border default |
| `--vf-border-default` | Dropdown panel border, slot input border default |
| `--vf-border-strong` | Slot input border on focus, context pill border |
| `--vf-text-primary` | Pill label text, highlighted suggestion primary text |
| `--vf-text-secondary` | Dropdown descriptor text, context pill text |
| `--vf-text-tertiary` | Ghost completion text, placeholder, category headers |
| `--vf-text-disabled` | Disabled Run button label |
| `--vf-icon-muted` | Pill icon, × dismiss default state |
| `--vf-selection` | OBJECT pill border, Run button (active), left accent bar in dropdown, dry-run timeline band, Sparkles icon |
| `--vf-danger-fg` | Error state input border (at 50% opacity) |
| `--vf-shadow-3` | Dropdown panel shadow |
| `--vf-radius-pill` | Pill border radius (999px) |
| `--vf-radius-md` | Dropdown panel border radius (8px) |
| `--vf-text-xs` | Pill label, dropdown row text, position grid labels |
| `--vf-text-2xs` | Dropdown category headers, numpad key hints |
| `--vf-font-mono` | Timecode values in pills, custom x/y inputs |
| `--vf-space-1` | Pill internal gap |
| `--vf-space-2` | Gap between pills in the row |
| `--vf-space-3` | Dropdown row padding |
| `--vf-motion-fast` | Dropdown open/close, pill appear transitions |
| `--vf-ease-standard` | Easing for all transitions in this component |

**Amber (`--vf-accent`) is used nowhere in the Command Editing bar itself.** It appears
only in the downstream `AIEditPreviewPanel` Apply button, which is correct.
