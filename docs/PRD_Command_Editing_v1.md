# PRD — Command Editing (Structured Typeahead Edit Bar) v1

**Owner:** Vera (Head of Product)
**Status:** Scope-gate proposal — requires CEO decision before build begins
**Date:** 2026-06-27
**Phase:** Phase A — Scoping (this document). Phase B = Iris design brief. Phase C = Forge/Pixel build.
**Inputs:** Scout research brief (grammar-first, grammar-config object, selection/playhead target resolution), existing `apps/web/src/ai-edit/` engine (parser, types, validation, store apply), CEO build-loop approval.
**Decision required in:** `company/DECISIONS.md`

---

## 0. Scope-gate declaration

> Command Editing exceeds Phase-0 MVP scope. `docs/MVP_Scope.md §2` is explicit: "The MVP is NOT AI-assisted." The existing free-text AI Edit Bar (already uncommitted in the tree on `wip/sketch-video-pipeline`) was itself logged as a 🧭 scope pull in `company/DECISIONS.md` (2026-06-25). Replacing its input mechanism with a structured typeahead is an additive change on top of that already-approved pull, but it is still a scope expansion — specifically a change to the editor UI shell that does not appear in `docs/MVP_Scope.md §3.11`. It does not introduce new backend cost, LLM calls, or project-schema changes. It is a client-side-only UI upgrade that reuses the existing engine.
>
> **Scope gate classification: 🧭 UI shell expansion on an already-approved Phase-1 feature.** CEO sign-off is required before build starts. Atlas will route this to `company/DECISIONS.md`. The recommendation (§2 below) is to approve the build given the prior AI Edit Bar approval already crossed the scope line.

---

## 1. Problem and goal

**Who:** A creator using VideoForge who wants to issue precise edit commands without mousing through the Inspector. They know what they want ("increase contrast by 15% on this clip", "add a crossfade at 0:30") but free-text input forces them to guess the exact phrasing the parser understands, and an ambiguous parse silently produces the wrong edit or no edit at all.

**Problem:** The existing AI Edit Bar accepts free-form English. The parser's 13 regex rules cover a specific vocabulary, but users do not know that vocabulary. They type natural language, get an unexpected result or a "could not understand" rejection, and lose trust in the feature. The failure mode is silent ambiguity: the same phrase ("remove the first 5 seconds") can match two different action types depending on word order. Because the input is unconstrained, the system cannot give inline guidance before the user submits.

**Goal:** Replace the free-text input with a structured, autocomplete-driven command bar that guides the user through a fixed grammar — action, then property/object, then value — via a dropdown that shows only the valid next tokens at each step. The user selects from a menu rather than typing a sentence. The result is a deterministic parse: the grammar config is the parser, so they cannot drift. Ambiguity is eliminated before the command is submitted. This also makes the feature keyboard-operable end-to-end, which the free-text box did not guarantee.

This is not an AI feature in the inference sense. There are no LLM calls, no model, no network round-trip. It is a structured form that compiles user selections into the existing `EditAction` types the store already handles.

---

## 2. Scope decision

**Recommendation: approve and build.**

The prior CEO decision (2026-06-25, `company/DECISIONS.md`) already approved the AI Edit Bar as a bounded scope pull. This PRD replaces the input mechanism of that approved feature with a better one — it does not expand the surface area of what edits are possible, it does not add backend endpoints, and it does not change `packages/project-schema` or `packages/ffmpeg-graph`. The risk profile is lower than the free-text bar it replaces (deterministic parse, no regex ambiguity, no LLM surface) and the trust story is significantly better.

The only honest concern is sequencing: the approved Now items in `company/ROADMAP.md` (CI golden-frame gate, auth, Docker CI pipeline) are not yet complete. The CEO must decide whether to start this build in parallel or after the Now items are green. Vera's sequencing recommendation is in §6 (Open Questions).

---

## 3. Action / property / value matrix for v1

### Grammar structure

A command is assembled in four ordered slots:

```
[ACTION] [PROPERTY / OBJECT] [VALUE] [POSITION?]
```

- ACTION is always slot 1. The dropdown narrows to valid properties immediately after.
- POSITION only appears for spatial overlay objects (text, emoji, circle, line). It is always optional — default is center.
- Each slot becomes a rendered "pill" in the input row once selected.

### v1 action matrix

Legend: Engine-supported = `applyAIEditPlan` in `editorStore.ts` already handles this. Needs-apply-code = the `EditAction` type exists but the store's `applyAIEditPlan` does not yet mutate the project for it, or the action type does not exist yet.

| # | Action | Property / Object | Value type | Engine status | v1 include? |
|---|---|---|---|---|---|
| 1 | increase / decrease | brightness | by N% (integer, 1–100) | Engine-supported | YES |
| 2 | increase / decrease | contrast | by N% (integer, 1–100) | Engine-supported | YES |
| 3 | increase / decrease | saturation | by N% (integer, 1–100) | Engine-supported | YES |
| 4 | increase / decrease | volume | to N% (integer, 0–200) | Engine-supported | YES |
| 5 | add | transition (crossfade) | duration N ms (100–5000 ms); target = selected clip or playhead | Engine-supported | YES |
| 6 | split | (clip implied) | at time HH:MM:SS.mmm or resolved "here" (playhead) | Engine-supported | YES |
| 7 | trim | (clip implied) | start time to end time | Engine-supported | YES |
| 8 | delete | range | start time to end time; ripple toggle | Engine-supported | YES |
| 9 | move | clip (implied) | to time | Engine-supported | YES |
| 10 | add | caption | text string; start time; end time | Engine-supported | YES |
| 11 | add | zoom (Ken Burns) | from scale to scale; time range | Engine-supported | YES |
| 12 | change | aspect ratio | 9:16 / 16:9 / 1:1 / 4:5 | Engine-supported | YES |
| 13 | add / set | fade in / fade out | duration N ms | Engine-supported | YES |
| 14 | add | text overlay | text string; position (9-grid anchor) | Needs-apply-code (new action type) | YES — v1 NEW |
| 15 | add | emoji | emoji character; position (9-grid anchor) | Needs-apply-code (new action type) | NO — v2 |
| 16 | add | circle | size; position (9-grid anchor) | Needs-apply-code (new action type) | NO — v2 |
| 17 | add | line | orientation; position | Needs-apply-code (new action type) | NO — v2 |
| 18 | remove | silence | threshold (dB); min duration (s) | Needs-apply-code (parser understands; store has no waveform) | NO — explicitly out of scope |
| 19 | mute | (clip or track implied) | (boolean) | Engine-supported | YES |

**v1 cut rationale:**

- Items 1–13 ship because `applyAIEditPlan` already handles them and the grammar config requires no new store code beyond the UI.
- Item 14 (add text overlay) ships in v1 because text overlays are a core `drawtext`-backed MVP feature. A new `AddTextOverlayAction` type and a corresponding apply branch are needed — the scope of that is small and contained to `apps/web/src/ai-edit/` and `editorStore.ts`.
- Items 15–17 (emoji, circle, line) are cut from v1 because shapes and Lottie/SVG objects are explicitly `⛔` Phase 2 in `docs/MVP_Scope.md §3.6`. No apply code exists, no schema support exists, and adding them would be net-new Phase-2 feature work, not a UI change.
- Item 18 (remove silence) is permanently out of scope for this PRD. Waveform-based silence detection requires a separate analysis pass on the audio asset. The parser and validation already produce a warning for it. The grammar config will omit it.

### Position slot (text overlay only, v1)

When the action is "add text overlay", a fourth slot appears:

```
[add] [text] ["Hello world"] [position: top-left | top-center | top-right | center-left | center | center-right | bottom-left | bottom-center | bottom-right]
```

- Position defaults to `bottom-center` if omitted (standard subtitle / lower-third position).
- Named 9-grid anchors map to the project schema's percentage geometry (e.g., `bottom-center` = `canvasX: 10, canvasY: 80, width: 80`).
- Raw x/y percent entry is explicitly out of scope for v1.

### Target resolution rule (non-negotiable, from Scout research)

Commands never accept natural-language clip references ("the first clip", "the intro section"). Target resolution is:

1. **Selected clip** — if a clip is selected in the editor store at the time the command is submitted, that clip is the target.
2. **Clip at playhead** — if no selection, the clip whose timeline range contains the current playhead position is the target.
3. **Prompt if ambiguous** — if neither resolves (empty timeline, playhead in a gap), the command bar renders an inline error before submission: "No clip selected or at playhead."

The resolved target is displayed as a rendered pill ("Clip: [clip name]") adjacent to the command slots, updated in real time as selection changes. The user can see what will be affected before pressing Enter.

---

## 4. Explicitly out of scope

The following are out of scope for this PRD and this build. Any request to add them should be treated as a new scope gate.

- **LLM fallback / AI normalizer.** No network call, no model, no inference. The grammar config is the parser. If a command cannot be assembled via the dropdown, it cannot be submitted. There is no "try AI" escape hatch in v1. The LLM adapter seam in `parser.ts` remains disabled.
- **Free-text / natural-language input.** The textarea in the current `AIEditCommandBar.tsx` is replaced by the slot-based UI. There is no "type anything" mode.
- **"First section" / ordinal language resolution.** "Delete the first clip", "trim the intro" — no. Target resolution is selection or playhead only.
- **remove_silence / waveform commands.** No silence detection. Grammar config omits this action entirely.
- **Emoji, circle, line, shape overlay actions.** Phase 2 overlay types not in MVP schema.
- **Multi-command sequences in one submission.** v1 executes exactly one action per submission. "Trim 0:10–0:30 and add a fade" is two separate commands. Chaining is out of scope.
- **Command history persistence across sessions.** In-session history (last 8 commands) is already in the existing bar and carries over. Cross-session persistence is not added.
- **Undo-multiple / undo specific past command.** Standard Ctrl+Z undo covers undoing the last applied command (which is one atomic patch on the 200-op undo stack). There is no command-specific undo panel.
- **Raw x/y percent position input for spatial objects.** Named 9-grid anchors only in v1.
- **Transition types beyond crossfade.** The MVP supports crossfade only. The grammar config's transition property will offer only crossfade.
- **Any change to `packages/project-schema` or `packages/ffmpeg-graph`.** This feature is entirely in `apps/web`.

---

## 5. Acceptance criteria

All criteria are testable by Sentinel and are required for the feature to be considered done. "Submitting" a command means pressing Enter or clicking the primary action button.

### AC-1: Grammar config is the single source of truth

There exists exactly one grammar config object (`apps/web/src/ai-edit/grammar.ts` or equivalent) that defines: actions → valid properties → value type descriptor → slot count. The dropdown options at each slot are generated directly from this config. The parser that builds the `EditAction` from selected slots reads the same config. No action, property, or value type can appear in the dropdown that is not defined in the config, and the parser cannot produce an action type that is not in the config.

**Test:** Add a new property to the grammar config; it appears in the dropdown. Remove it; it disappears. The parser test suite uses the same config object, not a parallel constant.

### AC-2: Preview-before-apply panel

Every command submission (Enter / button click) produces a preview panel showing: the resolved action label, the resolved target pill (clip name or "Timeline"), and a list of what will change. The user must explicitly confirm (Apply button or Enter a second time) or cancel. The edit is not applied on the first Enter.

**Test:** Submit any valid command; assert the preview panel renders with non-empty action label and target; assert the project state has not changed; click Cancel; assert project state still unchanged; click Apply; assert the project state changed exactly once.

### AC-3: One atomic undo per command

Applying a command via the preview panel pushes exactly one patch onto the Immer undo stack. Ctrl+Z immediately after apply reverts the entire command in one undo step, regardless of how many project fields the command touched.

**Test (existing baseline):** The `aiEditStore.test.ts` `"applies trim as an undoable operation"` test already validates this for trim. v1 must pass that test and extend it to cover add_transition, adjust_effect (brightness), and add_caption — three cases that each touch different parts of the project document — verifying one undo step reverts each.

### AC-4: WYCIWYG invariant safety

The command bar may only produce `EditAction` types that are handled by `applyAIEditPlan` in `editorStore.ts`. The apply function may only call existing `commit()` mutations that already produce valid `project-schema` documents. No command may write a project field that is not in the JSON Schema. If `validateEditPlan` returns `valid: false`, the Apply button is disabled and a human-readable error is shown inline. The Apply button is never reachable from an invalid state.

**Test:** Construct an `EditPlan` with an effect value outside the ±100 range; assert the Apply button is disabled; assert the error message is visible; assert `applyAIEditPlan` is never called.

### AC-5: Zero network calls

From the moment the user opens the command bar to the moment the edit is applied, zero HTTP requests, WebSocket messages, or fetch calls are made. The grammar config, dropdown rendering, parsing, validation, and store mutation are all synchronous and client-local.

**Test:** Intercept `fetch` and `XMLHttpRequest` in the Sentinel Playwright session covering the command bar; issue and apply three commands; assert no network calls were recorded.

### AC-6: Keyboard-only operability

The entire command flow — open bar, select action (arrow keys or typing first letters to filter), tab to next slot, select property, tab to value, enter value, submit, confirm apply — is completable without a mouse. The bar opens via Ctrl+K (existing shortcut, already wired). Tab advances to the next slot. Escape cancels the current slot or the preview panel. Arrow keys navigate dropdown options. Enter confirms.

**Test:** Playwright test that performs a full "increase brightness by 10%" command using only keyboard events (no mouse clicks) and asserts the edit was applied.

### AC-7: Destructive commands require explicit confirmation

Commands whose action type is `cut`, `delete_range`, or a trim that reduces clip duration below 1 second must display the preview panel with a warning label ("This action cannot be easily reversed") regardless of whether the user pressed Apply directly. The warning must be visible before the Apply button becomes clickable.

**Test:** Submit a delete_range command; assert the preview panel contains a warning string; assert the Apply button is initially labelled "Confirm delete" (or equivalent); assert that clicking Apply once applies the edit.

### AC-8: Target pill updates in real time

The resolved target pill updates whenever the editor selection changes, even while the command bar is open. If the user changes their clip selection mid-command (clicks a different clip on the timeline), the pill reflects the new selection before they submit.

**Test:** Open the command bar, select "trim"; select clip A; assert target pill = clip A name; click clip B on the timeline; assert target pill = clip B name (without resubmitting).

### AC-9: Apply-code coverage for add text overlay

Submitting "add text" with a text string and a named position anchor creates a new `TextOverlay` clip on the first available overlay track in the project, with `canvasX/Y/width` derived from the 9-grid anchor map, and the submitted text in `content`. If no overlay track has capacity, an inline error is shown (not a silent no-op).

**Test:** Load `sampleProject`; submit "add text 'Hello' at bottom-center"; assert the first overlay track has one new clip whose `content` is "Hello" and whose `canvasY` is within the bottom-third percent range.

### AC-10: No regression on existing 19 ai-edit tests

The feature ships only when the full existing test suite (`apps/web/src/ai-edit/`, `apps/web/src/store/__tests__/aiEditStore.test.ts`, `apps/web/src/components/editor/__tests__/`) is green. No existing test may be deleted or changed in a way that weakens its coverage to accommodate the new UI.

---

## 6. Open questions for the CEO (max 5)

**Q1 — Sequencing.** The Now items in `company/ROADMAP.md` (golden-frame CI gate, auth, Docker CI) are not yet complete. Should this build start in parallel with those items, or only after the Now list is fully green? Vera's recommendation: parallel is acceptable because this feature is entirely within `apps/web` and cannot affect the golden-frame gate or the backend. However, if engineering bandwidth is the constraint, the Now items take priority.

**Q2 — Feature flag or full replacement.** Should the free-text `AIEditCommandBar` be replaced outright (one UI, the new structured bar), or should both coexist behind a flag during the build, with the free-text bar as a fallback? A flag adds complexity but reduces regression risk. Vera's recommendation: full replacement, since the free-text bar is not shipped to users (it is on a WIP branch) and the new bar is strictly better.

**Q3 — Position slot depth.** v1 limits position to 9 named anchors for text overlays. Creators who want precise positioning (e.g., "10% from the left, 35% from the top") cannot express that via this bar — they must use the Inspector. Is that acceptable for v1, or should a raw x/y percent input be added to the position slot? Adding it increases the value input surface but does not change the grammar structure.

**Q4 — History and command recall.** The current free-text bar maintains an in-session history of 8 recent commands. In the structured bar, "replay" means re-populating the slots with a prior command's values. Is that a required v1 behavior, or can command history be a v2 addition? It does not affect the core grammar or apply path.

**Q5 — Labelling.** "AI Edit Bar" implies AI. The structured typeahead is deliberately not AI — it is a grammar-driven command form. Should the feature be re-labelled ("Command Bar", "Edit Commands", "Quick Edit") to set accurate expectations, or does "AI Edit" serve the marketing story even if the mechanism is deterministic? This is a brand/messaging call, not an engineering call.

---

## 7. Risks

### Risk 1 — WYCIWYG invariant (highest)

The only way the Command Editing feature can threaten the invariant is if `applyAIEditPlan` is extended with new apply branches (specifically for "add text overlay", AC-9) that write project fields outside the JSON Schema. Mitigation: any new apply branch must (a) call `validateSchema(project)` after mutation in the `commit()` block, and (b) be covered by a golden-frame test that exercises the new overlay in export. Forge must review any new apply branch before merge.

### Risk 2 — Grammar config / parser drift

The grammar config drives both the dropdown and the parser. If they are maintained as separate objects (e.g., one file for the dropdown labels, one for the action builders), they will drift. Mitigation (from Scout research, non-negotiable): there is exactly one config object. The dropdown reads it. The parser imports it. AC-1 enforces this structurally.

### Risk 3 — Slot-based UX complexity

A four-slot command form that navigates by Tab/arrow keys is a more complex interaction pattern than a textarea. Users who do not know what an "action" is may be confused. Mitigation: the slot labels ("What do you want to do? / What to change? / By how much?") must be plain-language, not technical. Iris handles UX labels in parallel — this PRD does not specify label copy. The PRD does require that the first slot's dropdown is open by default when the bar receives focus, so the user sees options immediately without knowing to Tab.

### Risk 4 — Scope creep from the position slot

Once "position" exists as a slot concept, natural pressure builds to add it to every spatial action ("add zoom at bottom-left", "add transition starting at the right edge"). v1 position is restricted to text overlay only. Any extension of the position slot to other action types is a new scope gate.

### Risk 5 — Sequencing against open Now items

The CI golden-frame gate, auth, and Docker CI pipeline are not yet green. If Command Editing ships before those gates are green, it adds uncommitted code to a branch that has not passed the merge gate. Mitigation: the feature must be built on a branch and can only merge to `main` after the golden-frame gate passes (Sentinel enforces this).

---

## 8. Definition of done

The feature is done when:

1. All 10 acceptance criteria in §5 pass.
2. The existing 19 ai-edit tests are green.
3. `pnpm typecheck`, `pnpm lint`, and `pnpm test` are green.
4. Forge has reviewed the new apply branch for add text overlay (if built) and confirmed it does not write any non-schema field.
5. The free-text `AIEditCommandBar` textarea is removed or replaced; no dead textarea input remains in the Editor.
6. Iris has confirmed the slot UI matches the dark-first brand spec (amber CTA, sky-blue selection, no purple) — visual sign-off is a handshake, not a blocker for AC pass.
