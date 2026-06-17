# Script Studio v2 — Build Plan & Pinned Contracts (2026-06-15)

**Owner:** Atlas. **Target:** full chain demo-grade by EOD. **Invariant:** zero change to
`packages/project-schema` and `packages/ffmpeg-graph`. All AI output is orchestration-tier and is
mapped into a validated §18 `Project` by the **pure** `packages/script-studio` assembler. Research:
`Script_Studio_v2_Research_Product.md` (UX) + `Script_Studio_v2_Research_Tech.md` (stack). Read both.

This doc PINS the cross-layer contracts so the four build lanes can proceed in parallel without drift.
**If a contract here conflicts with a layer's existing convention, keep the JSON shape; adapt the rest.**

---

## 0. The end-to-end flow (what "done demo-grade" means)

1. User pastes a script → **Plan**: Groq (or heuristic fallback) returns `{ scenes[] }`, each naming
   the b-roll it needs + small caption + big-caption words. User reviews/edits the plan.
2. **Generate**: TTS synthesizes a real WAV per scene (CPU, $0) → each becomes a media asset; the pure
   assembler builds a valid §18 `Project` = VO track + text cards + **dual caption** layers + optional
   **FreePD music bed with dynamic-but-parity-safe duck keyframes**. Project opens in the existing editor.
3. **Arrange**: user uploads their own images/videos → pure placement auto-slots them into each scene's
   probed VO window (round-robin + trim/loop fit), retimed to the words. Project PATCHed; editor refreshes.
4. **Export**: unchanged path. Preview == export by construction.

---

## 1. PINNED CONTRACT A — Scene plan (LLM / heuristic output)

Exact schema in `Research_Tech.md §1`. TypeScript shape (lives in `packages/script-studio`):

```ts
export interface BrollSuggestion { mediaType: "photo" | "video"; keywords: string[]; description: string; }
export interface PlannedScene {
  voiceoverText: string;        // 1..600 chars — what TTS speaks
  smallCaption: string;         // 0..80 chars — lower-third caption text
  bigCaptionWords: string[];    // 1..60 tokens — full-screen word-by-word caption
  brollSuggestion: BrollSuggestion;
  suggestedDurationMs: number;  // 800..20000 — ADVISORY ONLY; assembler overrides with probed TTS duration
}
export interface ScenePlan { scenes: PlannedScene[]; }   // 1..40 scenes (bounded → CPU capped)
```

Validate with Zod. Groq strict `json_schema` (model `openai/gpt-oss-20b`) is the primary producer; the
existing pure `segment.ts` heuristic is the always-on, key-free fallback that derives the same shape.

## 2. PINNED CONTRACT B — Assembler v2 (pure, deterministic, in `packages/script-studio`)

Extend the package; do NOT modify `assembleScript` (v1) — add a v2 entry that reuses its builders.

```ts
export interface SceneVo {              // probed TTS result, per scene (Generate step)
  sceneIndex: number;
  voiceAssetId: string;                 // the registered WAV asset id
  durationMs: number;                   // PROBED (ffprobe), positive integer — the source of truth for timing
  words?: { text: string; startMs: number; endMs: number }[]; // optional (aeneas fast-follow); else even-distributed
}
export interface PlacedAsset {          // user upload (Arrange step); may be empty
  assetId: string; mediaType: "photo" | "video"; durationMs?: number; uploadOrder: number;
}
export interface AssemblePlannedInput {
  plan: ScenePlan;
  vo: SceneVo[];                        // length === plan.scenes.length
  assets?: PlacedAsset[];               // empty on first build; filled on Arrange
  music?: { assetId: string; durationMs: number } | null;  // FreePD bed (optional)
  voiceId: string; seed: string; title: string;
  sceneStyle?: ScriptSceneStyle;
}
export function assemblePlannedProject(input: AssemblePlannedInput): AssembledScript; // §18 Project + extended manifest
```

**Tracks/overlays it emits (all integer-ms, percent geometry, export-rendered style subset only):**
- **Voiceover** (`type:"voiceover"`): one VO clip per scene, back-to-back from t=0; window = probed `durationMs`.
- **Video / b-roll** (`type:"video"`): round-robin assign `assets[i % N]` to scene `i`; fit to the scene
  window `W` — video `D>=W` trim to `W`; `D<W` loop (repeat clips, NO `atempo`/`setpts`); photo spans `W`;
  no asset → leave gap (exporter fills canvas bg). Empty when `assets` empty (text-card-only first build).
- **Overlay — small caption:** lower-third `TextOverlay` per scene from `smallCaption` (drawtext subset).
- **Overlay — big caption:** the full-screen word-by-word caption. For demo-grade, emit a SEQUENCE of
  large centered `TextOverlay`s, one per word-CHUNK (~3 words), each spanning its chunk's time window
  (from `words[]` if present, else even-distributed across the scene). Export-rendered subset only
  (no per-word color highlight yet — that's a gated fast-follow; chunk-advance reads as karaoke and
  exports identically). Big + small are two independent layers driven by one timing source.
- **Caption track** (`CaptionBlock`): also emit the small caption as a real `CaptionBlock` (with `words[]`
  when available) so sidecar SRT/VTT works.
- **Music** (`type:"audio"`): the FreePD asset, looped/trimmed to project length; **duck via
  `volumeEnvelope` keyframes** = low gain (~0.15) across each VO window, higher (~0.5) in inter-scene
  gaps, short ramps. Deterministic from VO windows. Uses ONLY the existing volume-envelope field the
  exporter already renders → dynamic-sounding AND WYCIWYG-safe. (No `sidechaincompress`.)

Extend `ScriptManifest` with: per-scene `brollSuggestion`, `bigCaptionOverlayIds`, `smallCaptionOverlayId`,
`videoClipIds`, `musicClipId`, and store scene windows so **Arrange** can re-place assets later without re-planning.
Add golden + `validateProject()` + `EXPORTABLE_TEXT_STYLE_KEYS` subset tests. Same input ⇒ byte-identical output.

## 3. PINNED CONTRACT C — API routes (`apps/api`, under `/api/v1/script`)

- `POST /plan` → body `{ script: string, voiceId?: string }` → `200 { plan: ScenePlan, source: "groq"|"heuristic" }`.
  Calls Groq (env `GROQ_API_KEY`, model `openai/gpt-oss-20b`, strict json_schema); on missing key / error /
  Zod-fail → heuristic fallback (never 5xx for content reasons). One Groq call per script. Cache by `hash(script+voiceId)`.
- `POST /generate` → body `{ title, plan: ScenePlan, voiceId, withMusic: boolean }` →
  synth VO per scene (TTS), probe durations, register each WAV as an asset, optionally pick a FreePD music
  asset, call `assemblePlannedProject`, persist via the existing projects-create path → `201 { projectId }`.
  Long scripts may run as a BullMQ `script` job with WS progress (`script:progress`/`script:complete{projectId}`);
  ≤ ~8 scenes may run inline. Either way the response/event yields `projectId`.
- `POST /arrange` → body `{ projectId, assetIds: string[] }` → load the project + its manifest scene windows,
  run pure placement to fill the b-roll track, PATCH the project → `200 { project }`.

TTS engine: pick whichever produces a real WAV on THIS machine today with least setup (kokoro-js in Node, or
piper binary) — keep it behind a `synthVoice(text, voiceId) → { wavPath }` seam so the engine is swappable.
Seed a small **FreePD CC0** music set under the repo (bundled, no runtime fetch); log provenance in the manifest.

## 4. PINNED CONTRACT D — Web UI (`apps/web`)

New **Script Studio** entry (Dashboard CTA + route). Steps: (1) paste-script textarea + voice picker →
`POST /plan`; (2) **plan review**: editable list of scenes showing voiceover, the b-roll it needs
(mediaType + keywords + description), small + big caption — user can edit text, toggle music → `POST /generate`;
(3) on `projectId`, open the existing editor; (4) an **Auto-arrange** affordance: upload assets (reuse the
existing presign→PUT→confirm→poll→WS flow) then `POST /arrange` to slot them, refresh the editor.
Brand: dark-first, amber `#FF7A1A` reserved for the Export CTA only; selection sky-blue; no purple.
Consume EXACTLY the Contract-C shapes. Degrade gracefully when `source:"heuristic"` (label "draft plan").

---

## 5. Lanes & file ownership (no overlap)

| Lane | Owner agent | Touches ONLY | Depends on |
|---|---|---|---|
| L1 Pure assembler v2 | script-studio eng | `packages/script-studio/**` | Contracts A,B |
| L2 AI backend (Groq + TTS + music + routes) | api/media eng | `apps/api/**`, `apps/render-worker/**`, bundled `fixtures/music/**` | A,B,C; needs L1's exported API |
| L3 Script Studio UI | web eng | `apps/web/**` | C,D |

Integration + run-the-flow verification: **Atlas** (after lanes land). Each lane: keep `pnpm typecheck`
green, add tests, report **what changed / how verified / what's left / decisions**. Stay in lane; hand off via Atlas.
