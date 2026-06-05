# Script Studio — Feasibility & Architecture Spec

**Author:** Forge (Principal Engineer / Architect) · reports to Atlas
**Date:** 2026-06-05
**Status:** Design proposal. No product code written. One CEO decision flagged (§9).
**Reads:** root `CLAUDE.md`, `docs/MVP_Scope.md`, `docs/Templates_Architecture.md`, `packages/project-schema`, `packages/ffmpeg-graph`, `packages/templates`, `apps/render-worker`, `apps/api`.

---

## 0. The CEO mandate, restated

Paste a script → auto-build a **real, editable** VideoForge timeline = OSS **text-to-voice** voice-over + matched **scenes** (free stock and/or text-card clips) + **auto-captions** → the user then edits and exports in the **existing** editor. Hard constraint: **$0, no purchases** — OSS / self-hosted / browser-native only; our own compute is allowed.

My charge: confirm this slots in such that **what the user previews is exactly what exports, by construction** — no new or divergent render path.

---

## 1. Verdict

**YES — feasible at $0 and invariant-safe**, with **zero changes to `packages/project-schema` and `packages/ffmpeg-graph`** (the invariant surface). Script Studio is an **assembler that emits an ordinary §18 `Project` (+ a sidecar manifest)** — structurally the **same precedent as Templates**, which already proved a generated document flows through the existing preview engine and the existing `buildExportCommand` untouched.

The one caveat is **operational, not architectural**: server-side OSS TTS (Piper) adds a new BullMQ job type + a binary to the render-worker image. It touches infra, not the schema↔graph contract. That, plus the compute footprint, is the only thing needing a CEO nod (§9), and it was already flagged in the mandate.

Everything Script Studio produces is something the editor and exporter **already render today**:

| Artifact | Becomes | Existing path it rides |
|---|---|---|
| Voice-over (TTS) | an **audio asset** + a `Clip` on a `voiceover` track | normal asset pipeline (presign/confirm/proxy/waveform) → audio chain in `buildExportCommand` §6 |
| Stock video scene | an imported **video asset** + a `Clip` on a video track | normal asset pipeline → video chain §2/§3 |
| Stock image scene | an imported **image asset** + an `ImageOverlay` (or video clip of a still) | image import; overlay preview |
| Text-card scene | a **`TextOverlay`** (`kind:"text"`) over the canvas background | **existing `drawtext` + `layoutTextOverlay`** stage §4b — the parity-proven text path |
| Auto-captions | `CaptionBlock[]` on a `CaptionTrack` | existing burn-in `subtitles` filter §4 / sidecar SRT |

No artifact requires a new render concept. **The exporter does not learn that "Script Studio" exists.**

---

## 2. Architecture

### 2.1 Where each artifact lives in the `Project`

All of this is **already expressible on the current schema** (`packages/project-schema/src/types.ts`). Concretely, for a script of N scenes, the assembler emits:

- **One `VoiceOverTrack`** (`type:"voiceover"`, audio-bearing, max 1 on Free per `checkPlanLimits`). One `Clip` per scene (or one per sentence), `sourceAssetId` → the rendered TTS audio asset, `startOnTimeline`/`endOnTimeline` = the scene's time window, `trimIn:0`/`trimOut:` = full WAV span. This is exactly `audioSlotClip` in `packages/templates/src/authoring.ts`.
- **One `VideoTrack`** holding the matched scenes, in scene order, back-to-back on the timeline:
  - *stock video* → a `Clip` with `sourceAssetId` → imported stock asset (same shape as `mediaSlotClip`);
  - *text card* → there is **no clip** on the video track; the card is a `TextOverlay` (below) drawn over the canvas `backgroundColor`. The video track simply has a gap there, which the exporter already fills with the canvas background (`buildFilterComplex` §3, the `color=...[base]` source + `enable=between` gaps — finding A-13). A text card can optionally have a solid/stock backdrop clip beneath it; that is just another video `Clip`.
- **One `OverlayTrack`** (`type:"overlay"`, max 2 on Free) holding the text-card `TextOverlay`s and any title/lower-third text. Built by the existing `textOverlay()` authoring helper; rendered by the existing shared `layoutTextOverlay` on both sides.
- **One `CaptionTrack`** (max 4; MVP burns the first) with one `CaptionBlock` per spoken segment, `startMs`/`endMs` from the TTS timing data, `text` = the spoken text. If the TTS engine emits word timings, populate `CaptionBlock.words[]` (already in the schema, for karaoke) — **no new field**.
- **`transitions[]`** optional crossfades between adjacent video clips, via the existing `crossfade()` builder → `xfade` (§3/§6.4). Default: none, to keep the first cut clean.
- Canvas, ownership, revision: identical to how Templates seed them (`CANVAS_9_16`, server-forced identity on `POST /projects`).

**Net: the generated document uses only `Clip`, `VoiceOverTrack`, `VideoTrack`, `OverlayTrack`/`TextOverlay`, `CaptionTrack`/`CaptionBlock`, `Transition` — every one already rendered by preview and `buildExportCommand`.**

### 2.2 Minimal schema delta

**None on the invariant surface.** `ProjectSchema` is `.strict()` (schema.ts), so the generated document must contain **only** §18 fields and **nothing else** — confirmed against the Templates precedent (the reason template slot metadata lives in a sidecar, not inline). Script Studio follows the identical rule: **all "this came from a script" metadata lives OUTSIDE the document**, in a sidecar manifest (§2.4). The `Project` we persist is byte-clean §18.

The *only* schema-adjacent question is whether any new field is wanted for **re-generation provenance** (e.g. "this scene maps to script paragraph 3" so a user can re-roll one scene). Recommendation: **keep it in the sidecar manifest, not the document** — exactly as Templates kept `slot` out of the `Clip`. This keeps `project-schema ↔ ffmpeg-graph` at **zero delta** and `validateProject` green for both the generated doc and any project the user derives from it.

> If a future increment truly needs in-document provenance, that is a `schemaVersion` bump and a separate Forge proposal — **out of scope here, and not needed for the MVP feature.**

### 2.3 TTS as an asset — entering the normal pipeline

The rendered voice-over WAV/MP3 must behave like **any uploaded audio**, so it gets a proxy + waveform and resolves to an S3 original at export. Two viable entry points; both keep the asset pipeline unchanged:

**Recommended — server generates, then injects into the existing asset flow:**
1. Script Studio job (server) runs Piper → produces `voiceover.wav` per segment (or one concatenated WAV).
2. The job **PUTs the WAV to the originals bucket under a freshly-minted `assetId`** and writes the `assets` row (`status: PROCESSING`), then **enqueues the existing `media` job** (`mediaQueue.add('process', …)` — `apps/api/src/routes/assets.ts`).
3. The **existing `mediaWorker`** (`apps/render-worker/src/mediaWorker.ts`) treats it as `audio/*`: AAC proxy + real waveform peaks + duration probe, publishes `asset:ready`. The API persists keys → `status: READY`.
4. From that moment the TTS audio is **indistinguishable from an uploaded MP3**: `collectAssetIds` finds it, `resolveAssets` fetches the original, the audio chain (§6: `atempo`/`afade`/`adelay`/`volume`/`pan` → `amix` → `alimiter`) renders it. **Export parity holds with no new audio code.**

This reuses presign/confirm/proxy/waveform verbatim — the job is essentially "upload on the user's behalf." No new media path; the waveform the timeline draws for the VO is the same `extractWaveformPeaks` output every audio asset gets.

> The `durationMs` the media worker probes is what the assembler needs to lay out scene timing precisely. Two-phase: (a) synthesize audio + probe durations, (b) compute the timeline from real durations, (c) emit the document. This avoids guessing segment lengths.

### 2.4 The assembler — package layout

**New package: `packages/script-studio`** — pure / headless, mirroring `packages/templates`:

```
packages/script-studio/
  src/
    index.ts          // public API: buildScriptProject(input): { document: Project, manifest: ScriptManifest }
    types.ts          // ScriptManifest sidecar (scene→element id map, source paragraph refs, re-roll metadata)
    segment.ts        // pure: script string → ordered ScriptSegment[] (sentence/paragraph split, timing model)
    assemble.ts       // pure: ScriptSegment[] + resolved asset ids + TTS durations → valid §18 Project
    authoring.ts      // (or REUSE @videoforge/templates authoring helpers — see below)
    __tests__/        // assemble.valid.test.ts (validateProject green), manifest integrity, plan-limits
```

Design rules, all lifted from the Templates precedent:
- **Pure, no I/O, no clock, no rng** (deterministic ids via the same FNV-1a→xorshift `id(key)` trick already in `templates/src/authoring.ts`). Same input ⇒ same document.
- **Emits a valid `Project`** asserted by `validateProject()` in CI (copy `templates.valid.test.ts`).
- **Never imports `ffmpeg-graph`.** It depends only on `@videoforge/project-schema` (types + `layoutTextOverlay` for any geometry it needs to reason about) — same dependency edge Templates uses.
- **Sidecar `ScriptManifest`** (not persisted into the document) carries scene↔element-id mapping and re-roll/provenance, exactly as `TemplateManifest` carries slots.

**Reuse, don't duplicate:** the `videoTrack`/`overlayTrack`/`audioTrack`/`textOverlay`/`captionBlock`/`captionTrack`/`crossfade`/`mediaSlotClip`/`audioSlotClip` builders in `packages/templates/src/authoring.ts` are exactly what the assembler needs. Recommend **promoting those authoring helpers to a shared internal module** (either export them from `@videoforge/templates`, or factor a tiny `packages/project-authoring` both consume). This keeps one set of "emit valid §18 shapes" builders and avoids a second drift surface. Lowest-friction first step: re-export the existing helpers from `@videoforge/templates` and have `script-studio` import them; factor a shared package only if a third consumer appears.

**Orchestration (NOT in the pure package):** the TTS run, stock-clip fetch, asset injection, and duration probing are side-effecting and live in the worker/app tier — a new `script` BullMQ job in `apps/render-worker` (sibling to `media`/`render`) and a thin `POST /api/v1/script-studio` route in `apps/api` that enqueues it. The pure `buildScriptProject` is called at the end, after durations are known, and the resulting document is persisted via the **existing `POST /projects` document path** (`forceServerOwnedFields` + `checkPlanLimits` already handle identity + Free-tier caps). **No new project-create path.**

### 2.5 Scenes & text cards — confirmations

- **Text cards reuse the existing text-overlay export path — confirmed.** A text card is a `TextOverlay` (`kind:"text"`); on export it burns in via the `drawtext` stage (`buildFilterComplex` §4b) using the **shared `layoutTextOverlay` + `weightToInterFile`** helpers — the same functions the preview canvas calls. No new card primitive, no new filter. Background behind the card is the canvas `backgroundColor` (gap-fill, A-13) or an optional backdrop `Clip`.
- **Stock clips are just imported video/image assets — confirmed, no special handling.** They go through presign/confirm/proxy exactly like a user upload, then become ordinary `Clip`s. The exporter cannot tell a stock clip from a hand-imported one. (Sourcing them at $0 — e.g. Pexels/Pixabay free API or a self-hosted library — is a content/licensing concern for Scout/Anchor, **not** a render-path concern; whatever lands in S3 is just an asset.)

### 2.6 Captions — confirmation

Auto-captions ride the **existing caption track** with **no new path — confirmed.** Because the words are *known input* (we are speaking the script, not transcribing unknown audio), the assembler populates `CaptionBlock`s directly from the segment text + the TTS timing data — no ASR needed for the happy path. If the chosen TTS engine emits phoneme/word timings, fill `CaptionBlock.words[]` (already schema-supported) for karaoke; otherwise even-timing synthesis already exists. On export: `settings.captions:"burn"` → `captionsToSrt(firstTrack)` → `subtitles` filter (§4), or sidecar SRT — both already shipped.

---

## 3. Invariant analysis — why preview == export still holds

The invariant is upheld **by construction, for the same reason Templates upholds it**: Script Studio produces a plain §18 `Project`, and from there **both** the preview engine and `buildExportCommand` consume the **identical** document. Script Studio is upstream of the divergence point; it adds **no second render path**.

Per surface:

- **Voice-over:** enters as a normal audio asset; rendered by the existing audio chain. The preview plays the asset's decoded audio; the export runs `atempo/afade/adelay/volume/pan→amix→alimiter` on the same asset. Same bytes, same graph.
- **Stock scenes:** normal video/image clips; existing video chain + overlay compositing. Already invariant-safe.
- **Text cards:** the **single most parity-sensitive surface** (see below), but it rides the **already-hardened** `layoutTextOverlay` mechanism — preview and export call the *same pure function* (the documented parity mechanism in `textOverlayLayout.ts`). Script Studio only *generates* the `TextOverlay`; it does not render it, so it cannot introduce drift the text path hasn't already accounted for.
- **Captions:** existing burn/sidecar path.
- **Schema:** zero delta, `.strict()` validates the generated doc, so nothing un-renderable can be smuggled in.

### 3.1 The single highest-risk surface

**Text-card text overlays — specifically, ensuring every `TextOverlay` Script Studio emits is one the existing `drawtext` stage renders *fully*, not partially.**

`buildFilterComplex` §4b **honestly omits** deferred text sub-features (gradient, shadow, `letterSpacing`, `backgroundColor`, `rotation`, overlay `animation`) — it renders only what the preview canvas renders today. If Script Studio authored a text card that *leans on* an omitted feature (e.g. a card whose legibility depends on a `backgroundColor` panel, or a gradient fill), the **preview would show it and the export would drop it** → the invariant breaks visibly. This is not a render-path bug; it is an **authoring constraint on the assembler.**

**Mitigation (must be in the assembler from day one):** Script Studio emits text cards **only** within the rendered subset — solid `color`, outline (which the export *does* render), no gradient/shadow/letterSpacing/backgroundColor/rotation/animation dependency for legibility. Add a CI test that for every text card the assembler can emit, the produced `TextOverlay` uses only export-rendered style fields. This is the same discipline the Templates text slots already follow. **Guard it; treat it as the WYCIWYG frontier for this feature.**

(Secondary, lower risk: scene timing must be derived from **probed** TTS/stock durations, not estimates, or the VO will drift from the visuals — handled by the two-phase assemble in §2.3.)

---

## 4. Server-side vs client-side TTS

**Recommendation: server-side, Piper on the render-worker tier.** Reasons:

1. **Invariant / asset-pipeline fit.** The VO must become a *real S3 audio asset* with a proxy + waveform so it exports identically to an upload. Server-side generation lands the WAV in the originals bucket and reuses the existing `media` worker verbatim (§2.3). Client-side (WebGPU/onnx) would synthesize in the browser, then still have to **upload through the normal presign/confirm flow anyway** — so client-side buys nothing for the invariant and adds a large model download + a Chrome/WebGPU dependency on top of the already Chrome-only WebCodecs constraint.
2. **No-purchase rule.** Piper is MIT-licensed, fully self-hosted, CPU-only, fast (faster-than-realtime on commodity CPU), with permissively-licensed voices. **$0, our own compute** — exactly the mandate. (Kokoro is a fine quality alternative but heavier; Piper is the pragmatic MVP default. Engine choice is swappable behind the `script` job — not an architectural commitment.)
3. **Determinism & reproducibility.** Server-side runs the same pinned binary the render image already pattern-matches (FFmpeg is pinned the same way). Browser inference varies by GPU/driver — worse for a reproducible build loop.
4. **Compute is allowed.** The mandate explicitly permits our own infra. Piper's CPU cost is modest and co-locates naturally with the existing media/render workers.

**Client-side is the wrong default** here: it adds a heavy first-run model fetch, narrows device support, doesn't escape the upload step, and gives no invariant benefit. Keep it only as a *possible later* latency optimization, not the MVP path.

Cost of the recommendation: the render-worker image gains the Piper binary + a voice model, and a new `script` BullMQ job. **This is the infra delta that needs the CEO nod (§9).**

---

## 5. Rough build phases

- **P0 — Assembler core (pure, no infra).** `packages/script-studio`: `segment.ts` (script → segments + timing model), `assemble.ts` (segments + asset ids + durations → valid `Project`), sidecar `ScriptManifest`. Reuse/promote the Templates authoring helpers. CI: `validateProject` green, plan-limits pass, manifest integrity, **text-card-style-subset guard** (§3.1). *No TTS, no network — feed it fixture durations.* This is the spine, built and tested first (same philosophy as `ffmpeg-graph` being built headless-first).
- **P1 — TTS as an asset.** Add Piper to the render-worker image; new `script` BullMQ job that synthesizes WAV(s), PUTs to originals, writes the `assets` row, enqueues the existing `media` job, and probes durations. Verify the VO asset exports byte-for-byte like an upload via a golden-adjacent test.
- **P2 — Scenes & captions wiring.** Stock-asset acquisition adapter (Scout/Anchor own sourcing/licensing) feeding imported assets; text-card generation; caption-block population from segment text/TTS timing. End-to-end: script → persisted project via existing `POST /projects` document path.
- **P3 — API + minimal UI.** `POST /api/v1/script-studio` (enqueue `script` job) + a "paste a script" entry that lands the user in the **existing editor** on the generated project. Export uses the **existing** export flow untouched.
- **P4 — Hardening.** Golden test that a Script-Studio-generated project's `filter_complex` is stable; e2e (paste → edit → export) ; proxy-fallback + watermark behave exactly as for any project.

---

## 6. What needs a CEO decision

Only one item beyond the already-flagged scope/compute:

- **Approve the render-worker infra delta for server-side OSS TTS** — add the Piper binary + a voice model to the worker image and a new `script` BullMQ job (modest CPU on our own infra; $0 software). Everything else is additive and within the existing patterns. *(Stock-content sourcing and its licensing is a separate Scout/Anchor lane and may carry its own brand/legal gate — out of scope for this engineering spec, but flag it: even "free" stock has attribution/usage terms.)*

No schema migration, no invariant-surface change, no new render path — **nothing in `project-schema` or `ffmpeg-graph` requires a decision.**

---

## 7. One-line summary for Atlas

Script Studio is a Templates-shaped, pure assembler (`packages/script-studio`) that emits a plain §18 `Project` + sidecar manifest; voice-over enters as a normal server-generated audio asset (Piper, $0), scenes are ordinary clips, text cards reuse the shared `layoutTextOverlay`/`drawtext` path, captions ride the existing caption track. **Zero delta to `project-schema ↔ ffmpeg-graph`; preview == export by construction.** Highest-risk surface: text-card styling must stay inside the export-rendered subset — guard it in CI. Only CEO ask: the Piper/worker infra delta.
