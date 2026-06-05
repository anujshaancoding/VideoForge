# Script Studio — $0 Build Research

Owner: **Scout** (Market & Competitive Research). Prepared for Atlas → CEO.
Date: 2026-06-05.

> **Mandate:** Research the build of "Script Studio" — paste a script → auto-build a *real, editable*
> VideoForge timeline = (1) TTS voice-over + (2) matched scenes (free stock or generated text cards) +
> (3) auto-captions — that the user then edits/exports in our existing editor.
> **HARD CONSTRAINT: ZERO SPEND.** No paid APIs, no per-use billing, no cards, no paid licenses.
> Allowed: OSS / self-hostable models (render-worker CPU or in-browser), browser-native APIs, genuinely-free
> no-payment data sources. Compute on our own infra is fine (Ledger prices that). Research only — no code, no spend proposals.

This is a $0 options matrix across three sub-problems. Facts are cited (source + date-checked 2026-06-05);
inferences are flagged. Note: this whole feature is **out of MVP scope** (AI captions, TTS, scene match,
stock library are all `⛔` Phase 1/2 in `docs/MVP_Scope.md` §3.1/§3.5) — pulling it forward is a 🧭 Scope gate for the CEO.

---

## 1. Text-to-Voice (TTS)

The decision criteria that matter for us: (a) license must be commercially usable at **$0**; (b) produces a clean
**WAV/MP3 file** we can drop on the timeline; (c) **word/segment timestamps** for captions; (d) where it runs
(render-worker CPU vs client WebGPU/onnx); (e) quality/voices.

| Engine | License (commercial $0?) | File output | Timestamps | Runs where | Quality / notes |
|---|---|---|---|---|---|
| **Kokoro-82M** | **Apache-2.0**, commercial OK no attribution | WAV/PCM (clean file) | Native token `start_ts`/`end_ts` in Python; **NOT exposed in public ONNX/kokoro-js** — use HeadTTS for browser timestamps | Render-worker CPU (onnx), **client WebGPU/WASM via kokoro-js / transformers.js** | Strong quality for 82M; 54 voices / 9 langs. Beats Piper on naturalness. |
| **Piper** (orig. rhasspy) | Engine MIT, **but repo archived Oct 2025**; active fork **OHF-Voice/piper1-gpl is GPL-3.0** | WAV (clean file) | **Native `--alignment-data` TSV** (Python script only, not C++ exe); **piper-plus** fork adds JSON/TSV/SRT incl. JS/WASM | Render-worker CPU (very fast, on-device) | Robotic-ish but reliable, 35+ langs. **Voice models have per-voice licenses — must check each.** |
| **piper-plus** (ayutaz fork) | **MIT** (only MIT-compatible Piper fork, no espeak-ng dep) | WAV | **JSON/TSV/SRT timestamps**, JS/WASM runtime | Render-worker CPU + browser WASM | Best Piper licensing story; G2P covers 8 langs. |
| **Chatterbox** (Resemble) | **MIT** (model + server) | WAV | Not built-in (would need forced-align fallback) | **Needs ~8 GB VRAM GPU** (no free CPU path that's realtime) | Best quality (beats ElevenLabs in blind tests) but **GPU-bound → infra cost; not a CPU/$0-compute fit for our render-worker**. |
| **Coqui XTTS-v2** | **Coqui Public Model License = NON-COMMERCIAL only.** Coqui shut down Jan 2024 → **no commercial license obtainable.** | WAV | — | — | **BLOCKED for us — license is non-commercial. Do not use.** |
| **Web Speech API** (`speechSynthesis`) | Free, browser-native | **CANNOT capture to a file** — no API to intercept output; goes straight to speakers. Workarounds (loopback getUserMedia / SpeechSynthesisRecorder) are fragile/OS-dependent and capture system audio, not a clean stream | None usable | Client | **CONFIRMED BLOCKER for our use case** — we need a file on the timeline. Voices are also OS-dependent (inconsistent across machines). Reject as primary. |

**Recommendation — TTS:**
- **Primary: Kokoro-82M (Apache-2.0).** Best $0 quality, clean WAV output, runs both on our render-worker (onnx,
  CPU) and **in-browser via kokoro-js/WebGPU** (zero server compute if we want client-side). Apache license is the
  cleanest commercial story. For timestamps: run server-side Python (native token timings) **or** use **HeadTTS**
  (free JS, Kokoro voices, gives phoneme/word timestamps + WAV, browser WebGPU/WASM or local Node) to get alignment
  in the browser path. If neither path is wired, forced-alignment fallback below covers captions anyway.
- **Fallback: piper-plus (MIT).** Faster on bare CPU, fully on-device, **native JSON/SRT timestamps**, cleanest
  Piper license (MIT, avoids the GPL-3.0 of the main piper1-gpl fork). Lower naturalness, but bulletproof $0/offline.

**TTS caveats to flag:** (1) Avoid the GPL-3.0 `piper1-gpl` fork for our codebase; prefer Kokoro (Apache) or
piper-plus (MIT). (2) **Piper voice models carry their own per-voice licenses** — must vet each chosen voice, not
just the engine. (3) Web Speech API is a hard reject for file output. (4) Chatterbox is the quality leader but is
GPU-bound — only revisit if we already run a GPU render tier.

---

## 2. Scenes — Free Visuals

Two families: (A) free stock APIs (need a free key, but $0/no-card), and (B) **generated text-card scenes**
(zero external dependency, truly $0, already expressible in our `drawtext`/overlay primitives).

| Option | $0 / no-card? | Commercial use | Attribution | Notes |
|---|---|---|---|---|
| **Pexels API** (photo + **video**) | **Yes — free, no payment, no card.** Free key; 200 req/hr, 20k/mo default; unlimited free if you show attribution | **Yes**, photos + videos free for commercial use | License: none required. **API ToS: attribution required** ("Photo/Video by X on Pexels" + link) as a condition of API use | Has a real **video** search (orientation + size filters) — directly usable for scene clips. |
| **Pixabay API** (photo + video) | **Yes — free, no payment, no card.** Free key; 100 req/60s | **Yes**, royalty-free incl. commercial | License: none required. **API request: show source when displaying search results** | Content License (post-Apr-2023); pre-2019 content is CC0. Allows AI-generated uploads. |
| **Generated text-card scenes** | **Yes — fully $0, zero external dependency** | N/A (we render it) | None | Pure VideoForge primitives: solid-bg + `drawtext` subset we already ship (§3.6). **Cannot break the $0 constraint and has no network/licensing risk.** |

**Recommendation — Scenes:**
- **Primary: Generated text-card scenes.** Zero external dependency, zero licensing/attribution surface, zero
  network failure mode, and it already maps onto our existing `drawtext`/overlay + color primitives. This is the only
  option that is *structurally incapable* of incurring spend or a license problem. It's also the most defensible
  "always works offline" default for the auto-build.
- **Fallback / enhancement: Pexels API (video + photo).** Genuinely free, no card, has a real video search, and is
  commercial-OK. **Obligation: API ToS requires attribution** ("Photo/Video by <photographer> on Pexels" + link) —
  so we must store the photographer/source and surface attribution in-app and ideally in export metadata. Pixabay is
  a secondary mirror with the same $0 profile (it *requests* source display rather than strictly requiring it).

**Scenes caveats:** Stock APIs need an **attribution-storage path** in the project schema (`source` object is
already noted as Phase-2-deferred in `docs/MVP_Scope.md` §5). Rate limits (Pexels 200/hr) mean we should cache and
not hammer the API per keystroke. The free key never requires a card — confirmed for both Pexels and Pixabay.

---

## 3. Script → Segmentation & Caption Alignment ($0)

Two sub-tasks: (a) split the pasted script into **scenes**, (b) produce **caption timings**.

**Key insight that makes this cheap:** we already have the **script text** (the user pasted it) AND the **TTS
timestamps** (Kokoro/Piper emit them). So for captions we generally **do NOT need ASR** — we have ground-truth text
and the synthesizer's own timing. ASR (Whisper) is only a *fallback* for the case where TTS timestamps are
unavailable (e.g. a browser path that doesn't expose alignment, or user-supplied audio).

- **Scene segmentation (no LLM):** Heuristic, $0. Split on sentence/paragraph boundaries (a sentence tokenizer),
  optionally group N sentences per scene, or split on blank lines / explicit user scene markers. No paid LLM, no
  model download required. This is exactly how the "auto storyboard" of competitors *looks* to the user but can be
  done with pure heuristics for v1.
- **Caption timings (no ASR, primary path):** Take the **TTS word/segment timestamps** (Kokoro native / piper-plus
  JSON-SRT / HeadTTS) and chunk them into caption blocks (e.g. ~7 words or ~3s per block). This yields word-accurate
  captions for free because the timings come straight from the engine that produced the audio. Maps directly onto our
  existing `CaptionBlock{startMs,endMs,text}` (and optional `words[]`) schema (§5).
- **Forced-alignment fallback (no paid LLM, $0):** If TTS timestamps are missing/unreliable, run **whisperX**
  (Apache-2.0) — but use its **forced-alignment** stage (wav2vec2) against the *known* script text rather than full
  transcription, which is more accurate and cheaper than transcribing from scratch. Pure ASR fallback: **whisper.cpp**
  (CPU, GGML) for transcription, but note whisper.cpp does **not** do word-level forced alignment as cleanly as
  whisperX. All Apache/MIT, all runnable on our render-worker, $0.

**Recommendation — Segmentation/captions:** Heuristic sentence/paragraph segmentation for scenes +
**TTS-timestamp-driven caption blocks** as the primary $0 path. **whisperX forced alignment** (Apache-2.0,
render-worker) as the fallback when TTS timings are absent. No paid LLM anywhere.

---

## 4. How the incumbents frame this (UX/positioning only)

- **Pictory** — "paste script → auto storyboard." AI matches stock footage + adds captions + AI voiceover
  (their TTS is ElevenLabs-powered, i.e. *paid* under the hood; we can't copy that vendor but can copy the UX).
  Auto-detects scene breaks and opens an editable storyboard. This is the closest analog to Script Studio.
- **InVideo** — template-first; AI breaks the script into scenes and searches its stock DB to match visuals per
  scene. Positioning: "start from a template, type your script, get a draft."
- **Descript** — notably **does NOT** have a true script-to-video flow; it's transcript-first editing of recorded
  media (generate voiceover from text, but you bring the visuals). Useful contrast: our wedge is the *auto-build*,
  which Descript explicitly lacks.
- **Common thread / so-what:** all of them sell the "paste text → editable draft in minutes" promise, and all lean
  on **paid** TTS + **licensed** stock under the hood. Our differentiator can be a **$0, offline-capable** version of
  the same UX (Kokoro TTS + generated text-cards + heuristic segmentation) that still lands in our real editable
  timeline — i.e. the "what you edit is what you get" wedge extended to auto-build.

---

## 5. Hard blockers / risks

1. **Coqui XTTS-v2 is license-blocked** (non-commercial CPML; vendor defunct, no commercial license obtainable).
   Exclude entirely.
2. **Web Speech API cannot produce a timeline file.** Confirmed: no API to capture `speechSynthesis` output;
   workarounds are fragile system-audio loopbacks. Reject for our file-on-timeline requirement.
3. **piper1-gpl is GPL-3.0** — copyleft risk for our (likely proprietary) codebase. Prefer Kokoro (Apache-2.0) or
   piper-plus (MIT). Also: **individual Piper voice models have their own licenses** — must vet per voice.
4. **Kokoro timestamps aren't exposed in the public ONNX/kokoro-js path** — getting word timings in-browser requires
   HeadTTS or the Python server path; otherwise rely on the whisperX forced-align fallback.
5. **Stock APIs require attribution plumbing** (Pexels ToS requires it; Pixabay requests it) and have rate limits —
   needs a `source`/attribution field + caching. Generated text-cards avoid this entirely.
6. **Scope:** entire feature is `⛔` Phase 1/2 in MVP scope — building it is a 🧭 CEO Scope gate, not autonomous work.
7. **Compute, not spend:** server-side Kokoro/whisperX add render-worker CPU load. That's *compute cost* (Ledger's
   lane), not a third-party purchase — but worth flagging for the worker-pool sizing decision.

---

## 6. Open questions for Vera / Forge

- **Forge:** Run TTS on the **render-worker (server, onnx/Python)** or **in-browser (WebGPU/WASM, kokoro-js/HeadTTS)**?
  Server gives reliable timestamps + heavier voices; client is zero-server-compute but timestamp-limited.
- **Forge:** For captions, is the **TTS-timestamp path** enough, or do we want the **whisperX forced-align** stage
  wired from day one as a safety net? (Affects whether we add an ASR model to the worker image.)
- **Vera:** v1 scenes = **text-cards only** (pure $0, no attribution/licensing surface), or include the **Pexels
  video** integration (richer, but needs attribution storage + a `source` schema field + rate-limit caching)?
- **Vera/Forge:** Does our `CaptionBlock.words[]` (currently unpopulated, §5) get populated by Script Studio, and does
  the project `source`/attribution object (Phase-2-deferred) need to come forward if we ship Pexels?
- **Vera:** Which engine for the default voice — Kokoro (better quality, Apache) vs piper-plus (faster on CPU, MIT,
  native SRT)? Recommend Kokoro primary; confirm.

---

### Sources (checked 2026-06-05)
- Piper / piper1-gpl / piper-plus: github.com/rhasspy/piper, github.com/OHF-Voice/piper1-gpl,
  github.com/ayutaz/piper-plus, PR #407 (alignment TSV).
- Kokoro: huggingface.co/hexgrad/Kokoro-82M (Apache-2.0), npmjs.com/package/kokoro-js, Xenova HF posts,
  github.com/met4citizen/HeadTTS (timestamps), ryanwelch.co.uk/blog/kokoro-word-timestamps.
- Coqui XTTS-v2: huggingface.co/coqui/XTTS-v2/blob/main/LICENSE.txt, coqui-ai/TTS Discussion #4304/#4145.
- Web Speech API: developer.mozilla.org Web Speech API, github.com/guest271314/SpeechSynthesisRecorder,
  WebAudio/web-audio-api issue #1764.
- Chatterbox: github.com/devnen/Chatterbox-TTS-Server, resemble.ai/learn/models.
- Pexels: pexels.com/api, pexels.com/license, help.pexels.com (free/commercial/attribution).
- Pixabay: pixabay.com/service/about/api, pixabay.com/api/docs, pixabay.com/service/license-summary.
- whisperX / whisper.cpp: github.com/m-bain/whisperX (Apache-2.0), arxiv 2303.00747.
- Competitors: pictory.ai/script-to-video, pictory.ai/tools/invideo-vs-descript.
