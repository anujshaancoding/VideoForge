# Script Studio v2 — Free-Stack Technical Findings (Feasibility Spike)

**Author:** Forge/Reel (Principal Engineer) · reports to Atlas
**Date:** 2026-06-15
**Status:** Research spike. No product code. Extends `Script_Studio_Architecture.md` (the pure assembler spine) — does **not** replace it.
**Hard constraints:** $0 / no-purchase · CPU-bounded (2-CPU render-worker cap, no GPU) · WYCIWYG (every VO/music/picture artifact must be a REAL media asset reproducible by `packages/ffmpeg-graph` from the project JSON the preview reads).

This doc adds the **AI content layer** (LLM scene-planning, TTS, alignment, auto-placement, music) on top of the v1 assembler. The v1 invariant verdict still holds: Script Studio stays an upstream assembler that emits a plain §18 `Project` + sidecar manifest. Everything below feeds that assembler; nothing below adds a second render path.

---

## 0. TL;DR stack (one line per step)

1. **Planner:** Groq `openai/gpt-oss-20b` (strict JSON-schema mode) primary; `llama-3.3-70b-versatile` via `json_object` mode as same-vendor backup; **local heuristic `segment.ts` as the zero-key always-on fallback**.
2. **TTS:** **Piper** (CEO-approved, self-hosted, CPU, real WAV) = land-today; **Kokoro-82M (`kokoro-js`, `device:"cpu"`)** = quality fast-follow.
3. **Alignment:** **aeneas** (deterministic forced alignment of KNOWN text → word/segment timings) primary; whisper.cpp only as a no-extra-binary stopgap.
4. **Placement:** pure deterministic round-robin fill + clamp-to-VO-window fit, in the existing pure assembler.
5. **Music:** **static low-gain bed via the existing volume envelope** (exports identically). `sidechaincompress` ducking = Phase-1-deferred, flagged as the top audio-parity risk. Source = **FreePD (CC0, no attribution)**.

---

## 1. LLM content-planner

### Recommendation
**Primary: Groq `openai/gpt-oss-20b` with strict structured outputs.** As of 2026-06, Groq's *guaranteed* (constrained-decoding) JSON-schema mode (`response_format: { type: "json_schema", json_schema: {…, strict: true} }`) is supported **only** on `openai/gpt-oss-20b` and `openai/gpt-oss-120b`. `meta-llama/llama-4-scout-17b-16e-instruct` and the gpt-oss models additionally support best-effort (`strict:false`) schema. `llama-3.3-70b-versatile` and all other models support only `json_object` mode (valid JSON, no schema guarantee). Because reliable structured scene plans are the whole point here, **prefer the model that constrains to the schema** rather than the bigger model that only promises valid JSON.

- **Primary:** `openai/gpt-oss-20b`, `strict:true` json_schema. Smallest reliable constrained-decoding model → lowest tokens/latency on the free tier.
- **Same-vendor backup:** `llama-3.3-70b-versatile` with `response_format:{type:"json_object"}` + the schema injected in the system prompt + Zod re-validation/repair. Use when gpt-oss is rate-limited or returns a schema violation we can't repair.
- **Zero-key fallback (always available, no network):** the **existing pure `segment.ts`** heuristic. It already yields ordered segments; for v2 we derive the remaining plan fields heuristically (caption = first ~6 words, bigCaptionWords = whitespace tokens, brollSuggestion.keywords = naive keyword extraction, suggestedDurationMs = `wordCount * 380ms` clamped). This guarantees Script Studio **never hard-fails on LLM outage** and keeps a $0 floor.

> Transformers.js / Ollama as a local LLM fallback: **not recommended for MVP.** A browser/Node 70B-class model blows the 2-CPU cap and a small local model (e.g. Qwen-0.5B) won't beat the deterministic heuristic on reliability. Keep the heuristic as the local fallback; revisit a small local planner only if Groq's free tier becomes insufficient.

### Groq free-tier limits (2026-06, verify live before pinning)
- `openai/gpt-oss-20b` / `llama-3.3-70b-versatile`: free tier ≈ **30 RPM, ~1,000 RPD, ~6–12K TPM, ~100K TPD**. One script = one request → well within RPM; the **TPD/RPD caps are the real ceiling** (≈ hundreds of scripts/day). Mitigation: cache plans by `hash(script+voice+params)`; the heuristic fallback absorbs overflow.
- One planner call per script (batch all scenes in a single response) — do **not** call per-scene (would multiply RPM/TPM).
- No credit card required; every model on the free tier.

### Strict scene-plan JSON schema
One planner call returns `{ scenes: Scene[] }`. The orchestrator validates with Zod; on failure → repair-prompt once → else heuristic fallback. This is **orchestration-tier** data; it is mapped into §18 by the pure assembler and never persisted into the `Project` document (it rides the existing `ScriptManifest` sidecar).

```jsonc
// JSON Schema (Draft 2020-12 subset accepted by Groq strict mode:
// every property required, additionalProperties:false, optionals via union-with-null)
{
  "type": "object",
  "additionalProperties": false,
  "required": ["scenes"],
  "properties": {
    "scenes": {
      "type": "array",
      "minItems": 1,
      "maxItems": 40,                       // bounded → CPU/TTS cost is capped by construction
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "voiceoverText", "smallCaption", "bigCaptionWords",
          "brollSuggestion", "suggestedDurationMs"
        ],
        "properties": {
          "voiceoverText":    { "type": "string", "minLength": 1, "maxLength": 600 },
          "smallCaption":     { "type": "string", "maxLength": 80 },
          "bigCaptionWords":  { "type": "array", "items": { "type": "string" },
                                "minItems": 1, "maxItems": 60 },
          "brollSuggestion": {
            "type": "object",
            "additionalProperties": false,
            "required": ["mediaType", "keywords", "description"],
            "properties": {
              "mediaType":   { "type": "string", "enum": ["photo", "video"] },
              "keywords":    { "type": "array", "items": { "type": "string" },
                               "minItems": 1, "maxItems": 8 },
              "description": { "type": "string", "maxLength": 200 }
            }
          },
          "suggestedDurationMs": { "type": "integer", "minimum": 800, "maximum": 20000 }
        }
      }
    }
  }
}
```

> `suggestedDurationMs` is **advisory only**. The assembler ALWAYS overrides it with the **probed** TTS duration (v1 §2.3 two-phase rule) so VO never drifts from visuals. `bigCaptionWords` seeds `CaptionBlock.words[]` (karaoke), filled with real timings from step 3.

---

## 2. TTS — free, CPU-only, real audio asset

### Recommendation: Piper today, Kokoro-82M as the quality upgrade.

| Engine | $0 / self-host | CPU-only | Real file | Native word timings | Today-readiness | Notes |
|---|---|---|---|---|---|---|
| **Piper** | ✅ MIT, self-host | ✅ faster-than-RT | ✅ WAV | ⚠️ partial (see below) | **Land today** — CEO-approved 2026-06-05 | Repo archived read-only Oct 2025; `piper-tts` PyPI maintained (1.4.2, Apr 2026) with **alignment as an optional extra** |
| **Kokoro-82M** | ✅ Apache-2.0 | ✅ `kokoro-js` `device:"cpu"` | ✅ WAV via `.save()` | ❌ none | Fast-follow | Best small-model quality (ranks ahead of WaveNet/Polly Neural in blind tests); 82M, dtype `q8/q4` to bound CPU; 28+ EN voices |
| edge-tts | ✅ no key | ✅ (no local compute) | ✅ MP3 | ✅ **native WordBoundary** | Tempting but **rejected** | NOT self-hosted — calls Microsoft's endpoint; availability + ToS + offline-repro risk. Keep only as an optional timing-source experiment |
| Coqui-TTS | ✅ | ⚠️ heavier | ✅ | partial | No | Larger/slower; project momentum faded; overkill vs Piper/Kokoro |
| espeak-ng | ✅ | ✅ tiny | ✅ | ✅ (phoneme events) | Robotic | Useful only as a phonemizer/dev fallback, not shippable VO |
| Web Speech API | ✅ | n/a | ❌ **browser-only, no file** | boundary events only | **Disqualified** | Violates WYCIWYG — produces no exportable asset. Never the VO source |

**Fastest path to a real exportable asset TODAY = Piper**, exactly as v1 §4 already approved: a new `script` BullMQ job runs the pinned Piper binary → `voiceover.wav` → PUT to originals bucket under a fresh `assetId` → enqueue the existing `media` job → the VO becomes indistinguishable from an uploaded MP3 and exports through the unchanged audio chain. Zero new render code.

**Quality-upgrade path = Kokoro-82M** behind the same `script` job interface (engine is swappable; not an architectural commitment). Either run `kokoro-js` in a Node sidecar with `device:"cpu"`, dtype `q8` (caps memory/CPU), or the Python `kokoro` package. Output WAV enters the identical asset flow.

**Word timings:** Piper's native alignment is the rerun-based optional extra (synthesizes twice, can need correction) — usable but not rock-solid. Kokoro emits **no** word timings. **Therefore do not rely on TTS-native timings; use a dedicated aligner (step 3).** This also makes the VO engine and the timing source independently swappable.

---

## 3. Word-level timing / forced alignment

### Recommendation: aeneas (deterministic forced alignment of KNOWN text).

We **know the spoken text** (we synthesized it). That makes this a *forced-alignment* problem, not transcription — and the right tool aligns known text to audio rather than guessing words.

| Tool | CPU-only | Determinism | Known-text alignment | Verdict |
|---|---|---|---|---|
| **aeneas** | ✅ (espeak + ffmpeg + DTW) | ✅ deterministic, pinnable | ✅ built for exactly this | **Primary** — text+audio → word/fragment timestamps (JSON/SRT), no GPU, modest CPU |
| whisper.cpp | ✅ | ⚠️ word ts drift 300–800ms; model-dependent | re-transcribes (ignores known text) | Stopgap only if we refuse a 3rd binary |
| whisperX | ✅ (wav2vec2 align) | ⚠️ better than whisper but still ASR-driven; reported off vs MFA | partial | Heavier deps; not worth it over aeneas for known text |
| gentle | ✅ | ⚠️ unmaintained, Kaldi build pain | ✅ | No — install friction |
| Montreal Forced Aligner | ✅ | ✅ most accurate | ✅ needs dictionary/model | Overkill; heavy conda install; revisit only if aeneas accuracy insufficient |

**aeneas** adds a small CPU step in the same `script` job (it already shells `ffmpeg`, which the worker has). Output → `CaptionBlock.words[]` (per-word start/end ms) for the karaoke big-caption + asset-cut sync. Deterministic and pinnable, fitting the reproducible build loop.

> If we want **zero new binaries today**: skip the aligner, distribute scene VO duration evenly across `bigCaptionWords` (proportional to word length) — the v1 "even-timing synthesis" already shipped. Karaoke will be approximate but export-correct. Add aeneas in the same phase that hardens captions.

---

## 4. Auto-placement + timing-fit (pure, deterministic)

Lives entirely in the **pure assembler** (`packages/script-studio`) — no I/O, no clock, no rng — so it stays golden-testable and invariant-safe. Inputs: N uploaded assets (ordered), M scenes (each with a **probed** VO window `[startMs,endMs)`). Output: §18 `Clip`s/overlays whose on-timeline spans exactly tile each scene window.

**Mapping (deterministic):**
1. Order scenes by index; order assets by upload order (stable).
2. **Round-robin assign** assets to scenes: scene *i* → asset `i % N`. If `N === 0` → text-card-only scene (v1 path). If a scene's `brollSuggestion.mediaType` filters the pool, prefer a same-type asset, else fall back to the round-robin pick. No randomness.

**Timing-fit per scene window `W = endMs − startMs`:**
- **Video asset, dur `D`:**
  - `D >= W` → **trim**: `trimIn = 0`, `trimOut = W` (clip plays head-of-source for the window). Deterministic, no speed change → no parity risk.
  - `D < W` → **fill the gap** by emitting back-to-back repeated `Clip`s of the same asset (loop) until `W` is covered; final repeat trimmed to the remainder. (Avoid `setpts`/`atempo` time-stretch — it's a speed/parity hazard; looping uses only existing clip semantics.) Optionally a single freeze on the last frame via an `ImageOverlay` of a still, but loop is simpler and already rendered.
- **Photo/still asset:** one clip/overlay spanning the **entire** window `[startMs, endMs)` — stills have no intrinsic duration, so they trivially fit any window. (Ken-Burns/zoom is deferred; static still exports identically.)
- **Gaps with no asset:** leave the video track empty → exporter fills with canvas `backgroundColor` (v1 finding A-13). Text card still renders.
- **Back-to-back invariant:** scene windows are contiguous from the probed VO timeline (v1), so the placed visuals tile the full duration with no overlaps/holes.

All times integer ms; geometry percent 0–100; track-index z-order — per repo law. Same inputs ⇒ byte-identical document (golden-testable).

---

## 5. Auto background music + ducking

### Recommendation: PARITY-SAFE static low-gain bed now; defer dynamic ducking.

**Phase 1 (land):** add the FreePD track as a **normal audio asset** on a music track and set a **static low gain via the EXISTING volume envelope** (the same `volume` field/automation the exporter already renders identically). A constant bed at ~ −18 to −22 LUFS-ish (e.g. `volume ≈ 0.12–0.18`) under the VO is universally safe: the preview's WebAudio gain and the export's `volume` filter produce the same result. **No new filter, no parity risk** — this is the same mechanism every audio asset already uses, so it's WYCIWYG by construction. Music loops/trims to project length via the same step-4 fit logic.

**Phase 1-deferred (highest audio-parity RISK — do NOT land first):** FFmpeg `sidechaincompress` dynamic ducking (music auto-dips under VO). It needs a **second input stream** and the music's level becomes a **function of the VO signal** — the preview (WebAudio) does **not** replicate `sidechaincompress`'s threshold/ratio/attack/release envelope, so **preview ≠ export** unless we also build a matching JS ducking model AND add `sidechaincompress` to `ffmpeg-graph` with golden tests. That is a deliberate, Reel-owned, golden-gated change to the invariant surface — exactly the kind of thing v1 kept out of MVP. **Flag as the single highest audio-parity risk; revisit only with golden coverage on both sides.**

**Source:** **FreePD** — confirmed **CC0 1.0 Universal**, public-domain, **no attribution required** (Ward-approved). Curate a small bundled set so it's offline/deterministic and not a runtime network dependency. (CC0 still → log the source in the manifest `attributions[]` as provenance even though none is legally required.)

---

## 6. Phasing — TODAY vs fast-follow

### Land TODAY (no new binaries beyond Piper; mostly pure code)
- **Planner:** Groq `openai/gpt-oss-20b` strict-schema call → Zod-validated `{scenes[]}`; **heuristic `segment.ts` fallback wired as the default** so the feature works with zero API key.
- **Assembler v2 (pure):** consume scene plan → map to §18 (`bigCaptionWords` → caption words; `smallCaption` → lower-third overlay; round-robin placement + timing-fit from probed durations). Golden + `validateProject` + text-style-subset guard (v1 §3.1).
- **TTS:** Piper `script` job → real WAV asset via the existing `media` pipeline (v1 §2.3 / §4). Exports byte-identical to an upload.
- **Captions timing:** even-distribution across `bigCaptionWords` (already shipped) — approximate karaoke, export-correct.
- **Music:** static low-gain FreePD bed via existing volume envelope.

### Fast-follow
- **aeneas** forced alignment → precise per-word `CaptionBlock.words[]` + asset-cut sync.
- **Kokoro-82M** (`kokoro-js` `device:"cpu"`, dtype `q8`) as the quality VO upgrade behind the same job interface.
- **Same-vendor LLM backup** (`llama-3.3-70b-versatile` `json_object` + repair) for rate-limit resilience.
- **Ken-Burns / still motion**, transitions/crossfades between scenes (existing `xfade` builder).
- **(Gated, not promised) `sidechaincompress` ducking** — only with dual-side golden parity.

---

## 7. Risk register

### CPU-overuse risks (must stay inside the 2-CPU cap)
| Risk | Mitigation |
|---|---|
| Unbounded scene count → unbounded TTS/align CPU | Schema `scenes.maxItems: 40`; assembler rejects over-cap. Cost is bounded by construction. |
| Per-scene LLM calls multiply RPM/TPM | **One** planner call per script (batch all scenes in one response). |
| Kokoro fp32 / large model memory & CPU | Use `dtype:"q8"` (or `q4`), `device:"cpu"`; run in a bounded sidecar, one job at a time under the existing worker concurrency cap. |
| TTS/align jobs flooding the queue | Reuse the existing render-worker concurrency cap; `script` job is one more bounded job type, no new uncapped pool. No busy-loops, no time-stretch loops. |
| whisper/aeneas large models | aeneas uses tiny espeak + DTW (cheap); if whisper used, pin `tiny`/`base` only. |

### Export-parity (WYCIWYG) risks
| Risk | Mitigation |
|---|---|
| **Dynamic ducking `sidechaincompress`** (TOP risk) | **Deferred.** Phase-1 uses static volume envelope (already exports identically). Any ducking is a Reel-owned, golden-gated `ffmpeg-graph` change with a matching preview model. |
| VO drifts from visuals if durations estimated | **Probe** real TTS durations (v1 two-phase); `suggestedDurationMs` is advisory only and overridden. |
| Karaoke words mis-timed | aeneas forced alignment (known text); until then even-distribution is approximate but export-correct (timings come from the same words on both sides). |
| Text card leans on a dropped style key | Keep v1 `EXPORTABLE_TEXT_STYLE_KEYS` guard; `smallCaption`/`bigCaptionWords` overlays use only export-rendered fields (no gradient/shadow/letterSpacing/backgroundColor). |
| `atempo`/`setpts` time-stretch to fit windows | **Forbidden** in fit logic — use trim + loop only (existing clip semantics), so no speed-change parity surface. |
| LLM emits un-renderable plan | Plan is orchestration-tier only; the pure assembler maps it into validated §18 — `.strict()` schema can't smuggle anything un-renderable into the document. |
| edge-tts network/ToS/offline-repro | Rejected as VO source; if ever used, only as an offline-cached timing experiment, never in the export path. |

---

## 8. Exact packages / binaries

- **Planner:** Groq HTTP API (`https://api.groq.com/openai/v1/chat/completions`) via `groq-sdk` (npm) or plain `fetch`; primary model `openai/gpt-oss-20b` (`strict:true` json_schema), backup `llama-3.3-70b-versatile` (`json_object`). Validate with `zod`. Fallback = existing `@videoforge/script-studio` `segment.ts`.
- **TTS today:** `piper` binary + a permissively-licensed voice (`.onnx`+`.json`) pinned into the render-worker image (v1 §4). (`piper-tts` PyPI 1.4.x if a Python entry is preferred.)
- **TTS upgrade:** `kokoro-js` (npm, `device:"cpu"`, `dtype:"q8"`) **or** Python `kokoro`.
- **Alignment:** `aeneas` (pip; needs `espeak`/`espeak-ng` + `ffmpeg`, both available to the worker). Stopgap: existing even-distribution; or `whisper.cpp` (`tiny`/`base`).
- **Music:** bundled FreePD CC0 `.mp3`/`.wav` set (no runtime fetch).
- **Render:** **unchanged** `packages/ffmpeg-graph` + FFmpeg already in the worker. No new filters in Phase 1.

---

## 9. CEO / gate notes
- Piper worker infra delta already flagged & approved (v1 §6, 2026-06-05). Kokoro/aeneas are additive same-tier binaries, no schema/invariant change.
- Groq free tier needs an API key in `company/ACCESS.md` (no purchase). Heuristic fallback guarantees $0 floor + no hard dependency.
- `sidechaincompress` ducking = a future invariant-surface change → Forge proposal + Reel golden tests when/if pursued. Not in this scope.
- Stock B-roll **sourcing/licensing** (Pexels/Pixabay free APIs) remains a Scout/Anchor lane with its own attribution terms — the planner only *suggests* keywords; whatever lands in S3 is just an asset (v1 §2.5).
