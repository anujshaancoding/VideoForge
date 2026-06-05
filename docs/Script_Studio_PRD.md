# PRD — Script Studio (v1)

**Owner:** Vera (Head of Product)
**Status:** Scope-gate proposal — 🧭 requires CEO decision before build begins
**Date:** 2026-06-05
**Inputs:** `docs/Script_Studio_Research.md` (Scout), `docs/Script_Studio_Architecture.md` (Forge), `company/ROADMAP.md`, `docs/MVP_Scope.md`
**Decision required in:** `company/DECISIONS.md`

---

## 0. Scope-gate declaration

> Script Studio is **not** in Phase-0 MVP scope. Every component it touches — TTS voice-over, AI/auto-captions, stock media library — is explicitly `⛔` Phase 1/2 in `docs/MVP_Scope.md §3.1, §3.5, §4`. Building this before the MVP launch-hardening work is complete constitutes a 🧭 Scope gate. See §9 for the full framing, impact analysis, and sequencing recommendation.
>
> This document is prepared in advance so that if the CEO decides to pull this forward, the team can move immediately without a research or design lag. Nothing in this PRD authorizes any code, infra change, or spend.

---

## 1. Problem & user

### The problem

Creating a short-form video from a written script today requires two separate workflows: a creator writes (or has) the script, then manually rebuilds that script as a video — recording voice-over, finding and importing visuals one at a time, typing and timing captions by hand. That assembly step is the single biggest abandonment point between "I have an idea" and "I have a draft." Competitors (Pictory, InVideo) offer an automated bridge, but every one of them runs on paid TTS APIs, licensed stock libraries, and subscription paywalls — they are not structurally $0 and are inaccessible to early-stage and bootstrapped creators.

VideoForge's structural differentiator is the WYCIWYG invariant: the timeline is the export. Script Studio extends that differentiator upstream. The draft the auto-builder assembles is not a locked render or a proprietary storyboard — it is a **fully-editable VideoForge timeline** that the user can manipulate frame by frame, then export with the same guarantee: what you edit is what you get.

### The user

**Primary:** Individual content creator, educator, or indie marketer who already has a script or outline (written, lifted from a blog post, or dictated) and wants a first draft video in the existing VideoForge editor without manual assembly. They are in the "I want to ship" state, not the "I want to design" state. They accept a workmanlike draft and expect to do a light editorial pass before exporting.

**Not the primary user for v1:** Agencies running bulk script-to-video workflows, teams with brand-kit voice requirements, or creators who need multilingual output. Those are v2+ use cases.

---

## 2. Scope (v1) — the smallest coherent end-to-end slice

v1 delivers **text → editable VideoForge timeline** for a single script, a single voice, and a single scene style, using only $0 OSS/self-hosted components on our own compute. It is the tightest slice that lets a creator paste a script and land in the editor with a genuine starting point.

### Decision A: v1 scenes = text-cards only (recommended) vs. Pexels stock video

**Recommendation: text-cards only in v1. Pexels stock video in v2.**

Rationale:

- Text-card scenes map directly onto `TextOverlay` + `drawtext` — a path that is already parity-proven and guarded by golden tests. Zero new dependencies, zero licensing surface, zero network failure mode.
- Pexels stock video is genuinely free and commercially usable, but it introduces three new sub-systems that are not trivial: (a) API key management + caching layer (rate limit: 200 req/hr), (b) a `source`/attribution field in the project document — currently `⛔` Phase-2-deferred in `MVP_Scope.md §5`, (c) UI for in-editor attribution display and export metadata injection. Each of these is individually small but collectively adds enough scope and licensing complexity to delay the first working slice by a meaningful margin and to introduce a new brand/legal gate (attribution compliance).
- The text-card default is also the more honest v1: it is always available, works offline, never hits a rate limit, and cannot produce a license violation. It lets us prove the end-to-end pipeline first.
- Pexels (video + photo) and Pixabay are well-scoped and achievable as a v2 enhancement. The schema already has a slot for the `source` attribution object; activating it is a clean incremental step once the core pipeline is proven.

**v2 scenes:** Pexels video search integration with server-side caching, attribution storage in the project sidecar manifest, and in-editor attribution display. Pixabay as secondary mirror.

### Decision B: default voice = Piper (piper-plus, MIT) (recommended) vs. Kokoro (Apache-2.0)

**Recommendation: piper-plus (MIT) as the v1 default. Kokoro (Apache-2.0) as the named v2 upgrade.**

Rationale:

- piper-plus is MIT-licensed, CPU-only, faster-than-realtime on commodity hardware, and — critically — emits **native JSON/SRT timestamps** from the same synthesis run. This makes caption generation structurally simple: no secondary alignment pass, no ASR fallback required for the happy path. One job, one output, captions fall out for free.
- Kokoro-82M is higher quality (Scout's "recommended" for pure quality) and Apache-2.0 licensed, but its word timestamps are not exposed in the standard ONNX/kokoro-js path. Getting them in the server path requires the Python native API; in the browser path requires HeadTTS or a forced-alignment fallback. That complexity is real and adds to the v1 build surface.
- Forge's architecture recommendation (§4 of Architecture doc) also lands on the render-worker server-side Piper default for exactly these reasons: determinism, no model download on the client, clean asset-pipeline fit, modest CPU cost on our own infra.
- The voice engine is swappable behind the `script` BullMQ job interface — the architecture treats it as a configuration detail, not a hard wiring. Kokoro can be added as an opt-in high-quality voice in v2 without touching the assembler or the pipeline.

**v2 voice:** Kokoro-82M (Apache-2.0) as an opt-in high-quality alternative, with the HeadTTS/Python path wired for word-level timestamps when selected.

---

## 3. End-to-end flow (product terms)

### 3.1 Entry point

A "Create from script" button or card on the Project Dashboard, alongside "New project" and (when Templates ships) "Start from template." Selecting it opens the **Script Studio modal** — a single, focused input surface, not a full editor screen.

### 3.2 Script input

The modal presents a multi-line text area: "Paste your script or outline." Supporting guidance: approximate word count → estimated video duration (displayed live, ~130 wpm default). A voice selector (v1: one default Piper voice; v2: voice library). A scene style toggle (v1: one option — "Text cards"; v2: + "Pexels stock").

The user pastes their script and clicks **Generate draft**.

### 3.3 Generation (server-side job)

The client sends `POST /api/v1/script-studio` with the script text and user preferences. The API enqueues a `script` BullMQ job. The modal transitions to a progress view ("Building your draft…") fed by the existing WebSocket hub (`script:progress` events).

The `script` job on the render-worker does the following in sequence:

1. **Segment:** Pure heuristic — split the script into `ScriptSegment[]` on sentence/paragraph boundaries. No LLM, no network call.
2. **Synthesize voice-over:** Run piper-plus on the render-worker. Produces one WAV per segment (or a single concatenated WAV with per-segment timing). Emits native JSON/SRT timestamps.
3. **Inject VO into the asset pipeline:** PUT each WAV to the originals S3 bucket under a freshly-minted `assetId`, write the `assets` row (`status: PROCESSING`), enqueue the existing `media` worker job. The media worker processes it as standard audio: AAC proxy + waveform peaks + duration probe. On `asset:ready`, the VO asset is indistinguishable from a user-uploaded MP3.
4. **Assemble:** Once durations are probed (from the media worker output, not estimated), call `buildScriptProject(segments, resolvedAssetIds, durations)` — the pure, headless assembler in `packages/script-studio`. It emits a validated §18 `Project` document + a `ScriptManifest` sidecar.
5. **Persist:** POST the generated `Project` document to the existing project creation path (`POST /projects` with `forceServerOwnedFields` + `checkPlanLimits`). The sidecar manifest is stored separately, not inline in the document.

Progress events: `script:progress` with stages (`segmenting`, `synthesizing`, `processing_assets`, `assembling`, `ready`) are broadcast over the existing WebSocket hub.

### 3.4 Landing in the editor

When the job completes, the client receives a `script:ready` event with the `projectId`. The modal closes and the user is navigated to the **existing editor** on that project — no new editor surface. The generated project appears exactly like any other project the user might have built by hand: tracks, clips, captions, undo/redo, autosave, Export button.

The generated timeline structure:
- **One VoiceOverTrack** with one audio clip per script segment, timed precisely from probed durations.
- **One VideoTrack** with text-card overlay positions corresponding to each segment (v1). In v2: optionally a stock video clip per segment.
- **One OverlayTrack** with one `TextOverlay` per segment carrying the segment's opening text, within the export-rendered style subset (solid color + outline only — see AC-6).
- **One CaptionTrack** with `CaptionBlock[]` populated from the piper-plus SRT/JSON output, chunked to ~7 words or ~3 s per block.

### 3.5 Edit

The user edits the generated project in the existing editor. All existing edit operations apply: trim, split, move, retiming, replace text, adjust captions, mute/solo, add media from their library, apply color grades, keyframe animations. The fact that the project was generated is invisible to the editor — it is a plain §18 `Project`.

The `ScriptManifest` sidecar is available to the UI to surface optional re-generation affordances (v2: "Re-roll this scene"), but in v1 this is not exposed. The user can also treat the VO audio as a normal asset and delete/replace individual clips.

### 3.6 Export

The user exports via the existing Export modal, unchanged. The generated project exports via the existing `buildExportCommand` path. No new export code. The watermark, rate limit, Free-tier caps, and all existing export logic apply as-is.

---

## 4. Acceptance criteria

All criteria must be green before this feature ships.

**AC-1 — End-to-end generation completes without error.**
A user pastes a 150–400 word script (approximately 1–3 min of spoken content) and clicks Generate draft. The job completes within 3× the estimated TTS synthesis time. The user lands in the editor on a project with voice-over, text-card scenes, and captions populated. No error state is reached on the happy path.

**AC-2 — WYCIWYG invariant holds on the generated project.**
The generated project must export with zero preview↔export divergence. Specifically: a golden-frame test that takes a Script-Studio-generated project, runs `buildExportCommand`, and asserts SSIM ≥ 0.985 / PSNR ≥ 38 dB against committed reference frames (trim/stack/caption fixture class). Audio RMS error ≤ −60 dBFS vs. golden. The CI gate for this test must be green and must block merge on failure.

**AC-3 — Generated project passes schema validation.**
`validateProject(generated_document)` returns no errors. The generated document contains only §18 fields. No `ScriptManifest` content is embedded in the `Project` document. This is tested in `packages/script-studio/__tests__/assemble.valid.test.ts` in CI.

**AC-4 — Voice-over asset is pipeline-identical to a user upload.**
After the TTS job completes, the VO asset has `status: READY`, an S3 original key, an AAC proxy, a waveform peaks JSON, and a probed `durationMs`. A test in the `script` job integration suite asserts that at export time, `resolveAssets()` fetches the original (not the proxy) for the VO asset — identical behavior to any uploaded audio.

**AC-5 — Captions are populated and timed from TTS output.**
The generated project's `CaptionTrack` contains `CaptionBlock[]` with `startMs`/`endMs` values derived from the piper-plus SRT/JSON timestamps (not estimated). Captions burn correctly on export (`subtitles` filter path). A golden caption-burn test frame is included in the fixture matrix.

**AC-6 — Text-card overlays are within the export-rendered style subset.**
Every `TextOverlay` the assembler emits uses only style fields rendered by the existing `drawtext` stage: solid `color`, `font`, `fontSize`, `borderw`/`bordercolor` (outline), `shadowcolor`/`shadowx`/`shadowy` (hard shadow, no blur). No generated card depends on gradient, `backgroundColor` panel, `letterSpacing`, `rotation`, or animation for legibility. A CI unit test exhaustively enumerates all `TextOverlay` shapes the assembler can produce and asserts none uses a non-rendered field. This test is the WYCIWYG frontier guard for text cards.

**AC-7 — Timeline timing is derived from probed durations, not estimates.**
The assembler is called only after all VO assets have `status: READY` and probed `durationMs` values are available. No segment timing in the generated `Project` uses a heuristic duration estimate. A unit test supplies fixture durations and asserts `endOnTimeline` values match exactly.

**AC-8 — Free-tier plan limits are enforced on the generated project.**
`checkPlanLimits(generated_project)` passes. Generated projects respect the Free-tier caps: 3 video tracks, 2 audio tracks, 2 overlay tracks, 1 caption track, ≤10-min total duration, ≤1080p. If the script would produce a timeline exceeding 10 min, the job fails with a clear user-facing error ("Script is too long for the Free tier — maximum is approximately 1,300 words"). The Free watermark is injected on export as normal.

**AC-9 — Progress feedback is surfaced in the UI.**
The user sees a progress indicator (stage name + approximate % complete) in the Script Studio modal during generation. If the job fails (TTS error, asset pipeline error, assembler error), the modal shows a clear error message and a "Try again" action. No silent failure.

**AC-10 — Undo/redo and autosave work on the generated project.**
After landing in the editor, the user can undo and redo edits, and autosave runs as normal. The generated project is no different from any other project in persistence behavior.

---

## 5. Out of scope for v1

These items are explicitly excluded from v1. Any of them being built as part of this feature without a separate scope decision is a violation of this PRD's boundary.

| Item | Deferred to |
|---|---|
| Pexels / Pixabay stock video or image scenes | v2 |
| Kokoro TTS voice or any voice other than the single piper-plus default | v2 |
| Voice selector UI (multiple voices, language choice) | v2 |
| Per-scene "re-roll" (regenerate one segment's visual or VO) | v2 |
| Attribution storage, display, or export metadata for stock content | v2 (required before Pexels) |
| `source` object in the project schema | v2 (currently Phase-2-deferred in MVP_Scope.md §5) |
| Client-side / in-browser TTS (WebGPU, kokoro-js, Web Speech API) | Rejected for v1 (see §2 Decision B) |
| LLM-based scene segmentation or semantic scene matching | Post-MVP (introduces external API dependency) |
| whisperX forced-alignment ASR stage in the happy path | Post-MVP (not needed when TTS timestamps are available) |
| Script editing or revision inside the generation modal | Post-MVP (user edits in the editor, not in the modal) |
| Multilingual TTS | Post-MVP |
| Chatterbox or any GPU-dependent TTS engine | Post-MVP (GPU render tier not in scope) |
| Social direct publish from Script Studio | Post-MVP |
| Bulk / batch script processing | Post-MVP |
| Custom brand voice, voice cloning, ElevenLabs or paid TTS | Never (violates $0 constraint) |
| Coqui XTTS-v2 | Never (non-commercial license, vendor defunct) |

---

## 6. Success metric

**Primary (launch gate):** Script-to-editor median completion time — the median time from "Generate draft" click to landing in the editor on a populated project — is **≤ 90 seconds** for a 200-word script on the production render-worker. Measured via the existing Sentry event system (`script_studio:draft_ready` with duration).

**Secondary (adoption signal, 30 days post-launch):** ≥ 40% of Script Studio sessions result in a completed export (the existing `ttfe:export_complete` event fires, associated with a project that originated from Script Studio). This establishes whether the auto-draft meaningfully reduces export abandonment vs. the blank-project baseline.

**Quality gate (infra/fidelity):** The Script Studio golden-frame CI test (AC-2) and the text-card style-subset guard (AC-6) remain green on every PR. A regression on either blocks merge.

---

## 7. Dependencies and risks

| Risk | Mitigation |
|---|---|
| piper-plus timestamp output is unreliable on long segments or unusual punctuation | Build the whisperX forced-alignment fallback as a second-pass safety net in the `script` job; trigger it when SRT output is malformed. Not in the happy path, but wired from day one so caption gaps never reach the user. |
| TTS synthesis time on the render-worker exceeds acceptable UX wait | Piper is faster-than-realtime on CPU — benchmark on the actual worker hardware in P1 (Forge's build phase). If p95 latency is unacceptable, switch to per-sentence parallelism (BullMQ concurrent `script` sub-jobs) within the same job type. |
| Generated `TextOverlay` style leaks a non-rendered field | AC-6 CI guard catches this in the assembler before it reaches any user. Must be wired from P0 (the assembler's first CI run). |
| render-worker image size growth (Piper binary + voice model) | One Piper voice model is ~60–100 MB. Acceptable. Flag to Anchor for image build + layer caching. |
| `VoiceOverTrack` type not yet fully wired in the existing editor UI | Forge confirmed VoiceOverTrack is schema-present but Phase-1 deferred (voice-over recording). Script Studio's generated VO clips will appear on the timeline as standard audio clips. The user can play, trim, and mute them. Full "voice-over track" UI controls are v2 polish. |
| Script Studio job competing with render-worker export jobs | The `script` job is a new BullMQ queue or a lower-priority queue. Render jobs retain scheduling priority. Size the worker pool to absorb both. Ledger to advise on compute cost at expected load. |

---

## 8. Build phases (Forge's plan, PM-summarized)

These phases are non-binding until the CEO scope gate is approved. Included here so sequencing is clear at decision time.

| Phase | Deliverable | Parity/invariant focus |
|---|---|---|
| **P0 — Assembler core (pure, no infra)** | `packages/script-studio`: `segment.ts`, `assemble.ts`, `ScriptManifest` sidecar, reused authoring helpers from `packages/templates`. CI: `validateProject` green, plan-limits, text-card style-subset guard. | Build headless first — no TTS, no network. Feed fixture durations. |
| **P1 — TTS as an asset** | Add piper-plus to the render-worker image; new `script` BullMQ job: synthesize WAV, PUT to originals, enqueue existing `media` job, probe durations. VO exports like a user upload. | Golden-adjacent test: VO asset resolves original at export. |
| **P2 — Scenes + captions wiring** | Text-card generation; caption-block population from piper timestamps; end-to-end: script → persisted project via existing `POST /projects`. | Full golden-frame fixture added to CI matrix. |
| **P3 — API + minimal UI** | `POST /api/v1/script-studio` route; Script Studio modal (script input, progress view, error state); editor landing on job completion. | No new editor surface — lands in existing editor. |
| **P4 — Hardening** | `filter_complex` stability test on generated projects; e2e Playwright test (paste → edit → export); proxy-fallback + watermark behavior confirmed. | Sentinel owns e2e. Golden test blocks merge. |

---

## 9. Scope-gate framing

### 9.1 This is beyond MVP scope

Every component of Script Studio is explicitly out of Phase-0 scope:

- **TTS voice-over** — `⛔ Phase 1` ("Voice-over recording (MediaRecorder)", `ROADMAP.md §Later`), and the adjacent AI/TTS inference tier is `⛔ Phase 2` (`MVP_Scope.md §4`: "AI auto-captions (Whisper), scene detection, transcript editing").
- **Auto-captions** — `⛔ Phase 2` ("AI auto-caption generation — a whole GPU/CPU inference tier").
- **Stock media library** — `⛔ Phase 1/2` ("Stock media library (Pexels/Unsplash)").

Building this before the MVP launch-hardening cycle is complete would pull at least three Phase-1/2 items forward simultaneously. This is a 🧭 Scope gate by the company's own definition (`COMPANY_OS.md §5`): new features beyond `docs/MVP_Scope.md` are the exclusive province of a CEO decision.

### 9.2 Impact on the in-flight launch-hardening cycle

The current "Now" cycle (`ROADMAP.md`) has 10 items — all `✅` MVP scope — blocking the Phase-0 done gate:

1. CI golden-frame gate green (Reel + Sentinel)
2. CI playback perf gate (Sentinel + Pixel)
3. Auth routes: email/password + JWT refresh (Core)
4. Google OAuth2 (Core)
5. Docker-compose CI pipeline (Anchor)
6. Empty-state onboarding funnel (Pixel + Iris)
7. Export rate limiting (Core)
8. Proxy→source re-link pre-export warning (Pixel + Reel)
9. Chrome/Edge browser gate (Pixel)
10. Sentry + TTFE events (Anchor)

None of Script Studio's build phases overlap directly with the above items in terms of codebase surface (the assembler, TTS job, and modal are additive). However:

- Script Studio P1 (TTS worker integration) touches `apps/render-worker`, which is also the surface for items 1 and 8. Running parallel development there increases merge conflict risk and review overhead for Reel/Forge.
- Script Studio P3 (API route + UI modal) touches `apps/api` and `apps/web`, which are the surfaces for items 3, 4, 7, and 6. Same risk.
- Sentinel's capacity is fully committed to items 1 and 2 (the gate-green prerequisite for everything) plus the "Next" cycle e2e work. Adding Script Studio P4 hardening before those are done would thin the QA coverage at the highest-risk moment.

**Bottom line:** building Script Studio in parallel with launch-hardening is technically possible (Forge confirms no schema/graph conflicts) but increases delivery risk on the items that gate the MVP "done" declaration. It is not a free lunch on the timeline.

### 9.3 Recommendation to Atlas / CEO

**My PM view: approve Script Studio as a post-MVP cycle, starting immediately after Phase-0's done gate is green (items 1–10 above + golden-frame CI green).**

Rationale:
- Phase-0's done gate is gating on engineering quality proof (fidelity CI green), not on feature breadth. Script Studio adds breadth, not quality proof. Shipping the wedge feature first — the WYCIWYG guarantee — and then extending it upstream with Script Studio is the correct sequencing narrative: "VideoForge exports exactly what you see; now it can also build the first draft from your script."
- The two-cycle gap between "MVP done" and "Script Studio ships" is likely 2–4 build cycles (estimates: P0 assembler core ≈ 1–2 days pure-code; P1–P2 TTS/pipeline ≈ 3–5 days with infra; P3 UI ≈ 2–3 days; P4 hardening ≈ 2–3 days; Sentinel e2e ≈ 1–2 days). That is a credible 2–3 week post-MVP sprint for a focused build cycle.
- If the CEO judges that Script Studio is a launch differentiator important enough to include in the MVP release itself (i.e., ship both together), then the build should start in parallel now — but the risk above should be logged and accepted, and the MVP "done" gate should not be stretched to absorb Script Studio delays.

**Sequencing options for Atlas to present:**

| Option | Timing | Risk |
|---|---|---|
| **A (recommended):** Post-MVP sprint — start after Phase-0 done gate is green | Script Studio ships ~2–3 weeks after MVP launch | Cleanest; launch-hardening unaffected |
| **B:** Parallel build — start P0 assembler (pure, no infra) now; hold P1–P4 until auth + CI green | Script Studio ships at or shortly after MVP launch | Low incremental risk; P0 is pure/headless (no infra conflict); P1+ waits on the render-worker gate clearing |
| **C:** Full parallel build immediately | Maximum compression, possible simultaneous launch | Meaningful delivery risk on launch-hardening; not recommended |

---

## 10. Financial implications

**Software cost: $0.** piper-plus (MIT), piper-plus voice models (check per-voice license before shipping), `packages/script-studio` assembler, BullMQ `script` job — all OSS, all self-hosted.

**Compute cost: non-zero, Ledger to quantify.** Adding the Piper binary + a voice model to the render-worker image is operationally trivial (one model ≈ 60–100 MB). The CPU cost of running piper-plus synthesis is modest — faster-than-realtime on commodity CPU — but it shares the render-worker pool with FFmpeg export jobs. At scale, a dedicated `script-worker` pool may be needed. Ledger should model this at expected call volume before the feature launches publicly.

**No third-party API keys required in v1** (text-cards only; no Pexels API key needed). If v2 adds Pexels, that is a $0 free API key — no card — but it introduces the attribution obligation and rate-limit caching work noted in §2.

---

*Vera — Head of Product, Zentrix Studio*
*Status: awaiting CEO scope decision before any build begins*
