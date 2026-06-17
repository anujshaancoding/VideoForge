# Script Studio v2 — Product/UX Research (market patterns + recommended flow)

Owner: **Scout** (Market & Competitive Research). Prepared for Atlas → CEO / Vera.
Date: 2026-06-15. Builds on `docs/Script_Studio_Research.md` (v1, the $0 build matrix) — **does not repeat it**.

> **Mandate (CEO ask):** paste a script → auto **scene plan that NAMES the video/photo each scene
> needs** (not the asset) + auto TTS + **dual captions** (small bottom caption + big full-screen
> word-by-word caption) → user uploads images/videos → tool **auto-places + retimes them to the
> spoken words** → auto background music with **auto-ducked** volume.
> This doc is UX/product research only. Everything here is still a 🧭 **Scope gate** (entire feature
> is `⛔` Phase 1/2 in `MVP_Scope.md`). Facts cited + date-checked 2026-06-15; inferences flagged.

---

## 0. The one structural insight (read this first)

The CEO ask differs from every incumbent in ONE decisive way, and it happens to be our wedge:

- **Incumbents auto-FETCH the footage** (Pictory/InVideo/Veed/Submagic/Opus pull stock or AI clips
  for you). The user reviews a *finished* draft and swaps clips they dislike.
- **The CEO ask is "the tool NAMES what each scene needs; the USER brings the footage."** That is a
  **shot-list / B-roll-brief** model, not an auto-fetch model. The user is the footage source.

This is *better* for us, not a compromise:
1. It is **structurally $0** — no stock API, no attribution plumbing, no licensing surface (the exact
   risk v1 research flagged for Pexels). The named-shot plan is just text.
2. It keeps us on the **edit==export wedge**: we generate a *real editable timeline* with empty
   "shot slots", and the magic is the **auto-place + auto-retime-to-voice** step — which is timeline
   work, our home turf — not a stock-search engine, which is a commodity arms race we'd lose.
3. The "what video/photo this scene needs" string doubles as a **caption-friendly scene label** and a
   future hook for optional AI/stock fill (v3), without committing us to it now.

So: **clone the *flow* (paste → review plan → generate → fill → auto-arrange → export). Do NOT clone
the *stock-auto-fetch* (that's their moat and their cost; the user's own footage is ours).**

---

## 1. Competitor matrix — script→video + captions + b-roll + music (2025-2026)

Step order = what the **user actually sees**. Auto = no user action; Manual = user must act.

| Tool | Input model | Scene/b-roll | TTS voice | Captions | Music | Footage source | User step order |
|---|---|---|---|---|---|---|---|
| **Pictory** | Paste **script** (closest analog to us) | **Auto** "storyboard": detects scene breaks, picks stock per scene by keyword; "Auto visuals" toggle + "auto-highlight keywords" | Auto (paid TTS under hood) | Auto from script | Auto track | **Their stock** (auto) | paste script → pick layout → **auto storyboard w/ visuals** → refine narration/visuals/captions → export |
| **InVideo AI 2.0** | **Prompt** (AI writes script too) | Auto: sifts 16M+ stock, picks per scene; cross-dissolve transitions auto | Auto, 60+ langs neural | Auto | Auto, tone-matched | Their stock + AI gen | type prompt → AI makes full draft → **edit by chat ("Magic Box")** ("replace scene 3 with coffee beans") → export |
| **Veed** | Describe + **paste script** | Auto stock-curated b-roll | Auto TTS / avatars | Auto subtitles | Auto add | Their stock | describe/script → AI builds footage+VO+subs → customize (add music/stock/overlays) → export |
| **Submagic** | **Upload a video** (not script-first) | **Auto b-roll** from Storyblocks at key moments + auto zoom; removes silence/filler | (uses your audio) | **Auto animated, word-level** — Hormozi/MrBeast style templates | — | Their stock b-roll (auto) | upload clip → pick caption template → **1-click auto-edit** → tweak → export |
| **Opus Clip 3.0** | **Upload long video** | Auto b-roll: scans content, inserts context clips from Pexels/Shutterstock at suggested points (easy to swap/remove) | (uses your audio) | Auto, 97%+ ASR, 20+ langs, templates | — | Their stock (auto, swappable) | upload → AI curates clips → auto captions+b-roll+relayout → edit → export |
| **CapCut** | **Manual timeline** + tools | Manual (you place); beat-sync via keyframes | **TTS: 200+ voices**, rate/pitch/volume control | Auto-captions via STT on a track (separate action) | Manual add; manual/beat-sync | Your footage + stock | manual editor — TTS, captions, music are *discrete tools*, not one flow |
| **Canva Magic** | Magic Media (prompt) / Magic Switch (repurpose) | Template-driven; captions from prompt text | Limited | From prompt/template | Template | Templates + stock | design-tool flow, not a script→draft pipeline |

**So-what:**
- **Two archetypes:** (A) **script/prompt-first → full auto-draft** (Pictory, InVideo, Veed) and
  (B) **video-first → auto-clip/caption/b-roll** (Submagic, Opus). The CEO ask is archetype A's *entry*
  but with **user-supplied footage** instead of auto-stock — a combination **nobody ships cleanly**.
  That gap is the opportunity.
- **Every archetype-A tool's review surface is a "storyboard" / scene list** the user scans and
  tweaks *before* committing. That review step is the single most-copied, most-loved UX beat. **Copy it.**
- **InVideo's "edit by chat" is a trap for us** — it's an LLM-rewrite loop, off-wedge and not $0. Our
  review step should be **direct manipulation of a real timeline**, which is our differentiator anyway.

---

## 2. The big full-screen word-by-word caption (Hormozi/Submagic style)

How it's specified and what creators expect to control (date-checked 2026-06-15):

**Data model (this is the important part):**
- It is **per-word timestamped text**: each word carries its own `start`/`end`. "Active Words" mode
  highlights one word at a time as spoken. **Sub-50ms per-word accuracy** is the bar for it to feel right.
- This maps *exactly* onto our existing `CaptionBlock.words[]` slot (currently unpopulated, schema §5).
  **We already have the data structure; we just need to populate `words[]` from TTS word timings** —
  which piper-plus/Kokoro emit (per v1 research §3). **No ASR needed on the happy path.**

**What creators expect to control (the knobs to ship):**
- **Words-on-screen at once: 4-6 max** (>6 makes the highlight sweep too fast to follow). Default ~4.
- **Active-word highlight = a distinct color or a size pop.** White→yellow is the canonical pair;
  highlight color must be *obviously* different from the base color.
- **Font: bold, heavy-weight sans-serif, high contrast.** Big, centered, full-screen-ish.
- **Max chars per line** (~28/38/50 presets) + line-break behavior.
- A **handful of named style presets** (Hormozi, MrBeast, "clean") — creators pick a preset, they do
  *not* hand-tune typography. This is the dominant interaction: **template, not type design.**

**Dual-caption (the CEO's two-layer ask):**
- **Layer 1 — small bottom caption:** a conventional read-along block (~1-2 lines, segment text). This
  is the accessibility/SRT layer.
- **Layer 2 — big word-by-word:** the centered karaoke layer driven by `words[]`.
- These are **two caption tracks fed from the same TTS word-timing source** — one block-chunked, one
  word-chunked. No extra inference; one timing source, two renderers.

> ⚠️ **WYCIWYG frontier flag for Forge/Reel:** the big animated word-highlight must render **identically
> in preview and export**. Per-word active-highlight is an animation; it has to be expressible in our
> caption-burn path (libass/ASS karaoke `\k` tags or our drawtext-per-word) so the FFmpeg `filter_complex`
> reproduces it frame-exact. **If the word-highlight animation can't be made export-parity, ship the
> bottom caption first and gate the big karaoke layer behind a parity proof.** This is the highest-risk
> new surface in the whole feature.

---

## 3. "User brings footage, it gets matched to scenes + timed to voice"

No mainstream tool does *exactly* this (they auto-fetch). The closest real-world patterns:

- **Submagic/Opus auto-b-roll** = insert clip at a "key moment" detected in the audio, then trim to a
  beat. The *placement-and-trim-to-audio* mechanic is what we want — but they pick the clip; **we let
  the user supply it and we own the placement/trim.**
- **The honest market analog for "user footage → scenes" is the manual storyboard** (Pictory lets you
  drop your own visual into a scene slot). The user expectation there: **a scene is a slot with a
  known time window; dropping footage in snaps it to that window.**

**Recommended mechanic for us (the core innovation, on-wedge):**
1. Generation produces a **timeline of empty "shot slots"**, one per scene, each with: a **time window**
   (derived from the *probed* VO duration of that segment — never estimated, per AC-7) and a **named
   brief** ("a video of: city street at night", "a photo of: a coffee cup"). The brief is the CEO's
   "name the video/photo each scene needs."
2. User is shown an **"upload assets to fill these slots" tray** — the scene briefs are the labels, so
   the user knows *what to shoot/find* for each. (This brief-list IS the deliverable the CEO described.)
3. On upload, **auto-place**: assign each asset to its slot (in order, or by simple filename/keyword
   match to the brief; manual drag always available as the override).
4. **Auto-retime-to-voice:** trim/scale each clip to fill its slot's VO window exactly (still image →
   hold for the window + optional slow Ken-Burns; video longer than window → trim to window; shorter →
   slow/loop or hold last frame, with a visible "clip is shorter than narration" warning). **The voice
   is the master clock; visuals conform to it.** This is pure timeline math — our home turf, zero deps.

**What creators expect here (so the auto-arrange doesn't feel like a black box):**
- They expect to **see the mapping** (which clip → which scene/word-range) and **override by drag**.
- They expect **"my footage is too short/long" to be surfaced**, not silently stretched ugly.
- They do **not** expect frame-perfect editing from the auto-pass — they expect a *good draft* they
  then nudge. Match the Pictory expectation: "workmanlike draft, light editorial pass."

---

## 4. Auto background music + ducking — realistic expectations

Creator expectations (date-checked 2026-06-15):

- **"One click, broadcast-quality."** The headline expectation is *zero manual keyframing* — music auto-
  lowers the instant the voice starts and recovers when it stops. Filmora/Premiere/Resolve all ship this
  as a one-click "Auto Ducking." Our bar = **on by default, no setup.**
- **Sensible defaults beat knobs.** Typical recommended starting points creators cite: music ducked by
  **~-6 to -8 dB** under VO (some go deeper); detect threshold ~-20 dB; **release/fade ~100 ms** so it
  recovers smoothly, not abruptly. Voice should sit clearly on top; **over-ducking sounds unnatural** —
  aim for "music still audible, voice always clear." Music bed itself sits well below the VO (VO is the
  loudness target; bed is background).
- **Minimal controls expected:** an overall **music volume slider** + a **ducking intensity** (light/
  medium/strong) is enough. Most users never open it.

**Recommended for us:** ship **one default-on auto-duck**: music bed at a fixed low level, side-chained
to (or scheduled against) the VO track, ducking ~-8 dB with ~100-150 ms fades. Because we have the *exact*
VO word timings, we can **schedule ducking deterministically from the VO envelope** (volume keyframes in
the project JSON) rather than needing a live sidechain compressor — which keeps it **export-parity by
construction** (the duck is in the project doc the preview and export both read). Expose only: music
volume + light/medium/strong duck. Music source for $0 = a **small curated royalty-free bed library we
host** (a few loops), or **user-supplied music** — *not* a stock-music API (avoid licensing surface).

> ⚠️ Parity flag: implement ducking as **scheduled volume keyframes on the music clip** (computed from VO
> segment boundaries), NOT a runtime audio-graph sidechain that only exists at export. Keyframes live in
> the §18 project doc → preview and export read the same numbers → invariant holds.

---

## 5. Recommended end-to-end UX flow for VideoForge Script Studio

Fits the CEO's loop: **paste-script → review-plan → generate → upload-assets → auto-arrange → export.**

**Step 1 — Paste script.** Modal text area. Live word-count → est. duration (~130 wpm). Pick: one TTS
voice (v1), a **caption preset** (bottom-only / bottom + big-karaoke), a music choice (none / bed / upload).

**Step 2 — Review the Scene Plan (THE differentiator beat — copy from Pictory's storyboard).**
Show a **scene list**: each row = segment text + the **auto-generated shot brief** ("a video of: …" /
"a photo of: …") + est. duration. User can edit a brief, merge/split scenes, reorder. This is the
"plan that names the video/photo each scene needs" the CEO asked for. **No assets exist yet.** Cheap,
fast, $0, no inference beyond heuristic segmentation + a simple keyword→brief rule (noun-phrase from the
sentence; LLM optional later, not required for v1).

**Step 3 — Generate.** Server job (per PRD §3.3): segment → piper-plus TTS (emits word timings) → VO
becomes a normal pipeline asset → build a real §18 timeline with **VO track + empty shot slots (timed to
probed VO) + bottom CaptionTrack + big-karaoke CaptionTrack (words[] populated) + optional music bed with
pre-computed duck keyframes.** Lands in the **existing editor** (no new surface). Slots render as labeled
placeholders showing their brief.

**Step 4 — Upload assets to fill slots.** An "fill your shots" tray keyed by the briefs. Drag/drop or
bulk-upload; auto-assign in scene order (override by drag). Each upload runs the normal media pipeline.

**Step 5 — Auto-arrange (the magic).** Each asset auto-placed + **auto-retimed to its slot's VO window**
(§3 mechanic): images hold + optional Ken-Burns; videos trimmed to window; too-short flagged. Voice is
master clock. Captions already timed to the voice. Music already ducked to the voice.

**Step 6 — Edit (existing editor, unchanged).** Trim/split/move/replace, swap captions preset, tweak music
volume/duck. It's a plain project — undo/redo/autosave all work.

**Step 7 — Export (existing path, unchanged).** Same `buildExportCommand`, watermark, caps. WYCIWYG holds.

---

## 6. What to deliberately NOT clone (keeping us on the wedge)

| Don't build | Why | Do instead |
|---|---|---|
| **Auto-fetch stock per scene** (Pictory/InVideo/Veed core) | Licensing + attribution + rate-limit + cost surface; a commodity arms race; off-wedge | **Name the shot; user brings footage.** $0, on-wedge, our timeline magic |
| **"Edit by chat / Magic Box"** (InVideo) | LLM-rewrite loop; not $0; not edit==export | **Direct manipulation of a real editable timeline** (already our product) |
| **Stock-music API** | Same licensing/cost surface as stock video | Small hosted royalty-free bed library + user-supplied music |
| **AI-generated video clips** | Cost + quality lottery + off-wedge | User footage; defer any AI-fill to a much later v3 behind the same slot model |
| **Video-first auto-clipping** (Submagic/Opus archetype) | Different product (clip a long video), not script→video | Stay script-first; it's the CEO ask and our story |
| **Hand-tuned caption typography UI** | Creators pick presets, not fonts | Ship 2-3 named caption presets (Hormozi-style + clean), preset-not-tuning |
| **Live sidechain-compressor ducking** | Only exists at export → parity break risk | **Scheduled duck keyframes in the project JSON** (parity by construction) |

**The frontier guards (for Forge/Reel, must be green before ship):** (a) big word-by-word highlight
renders **frame-identical** preview vs export, or it doesn't ship; (b) duck keyframes live in the doc, not
the export graph; (c) every generated shot-slot/caption/overlay stays in the export-rendered style subset
(extends PRD AC-6). If the karaoke layer can't pass (a), ship the **bottom caption first** and gate the big
layer — the dual-caption ask degrades gracefully to single-caption without blocking launch.

---

### Sources (checked 2026-06-15)
- Pictory: pictory.ai/academy/how-to-turn-script-into-video-pictory-ai; pictory.ai/pictory-features/script-to-video; kb.pictory.ai (scene settings, auto-visuals).
- InVideo AI 2.0: flowith.io/blog/invideo-ai-2-0-text-to-video-speed-of-thought; info.invideo.io; invideo.io/make/ai-video-generator.
- Veed: veed.io/tools/ai-video/script-to-video; veed.io/tools/ai-video/text-to-video.
- Submagic: submagic.co/blog/how-to-make-alex-hormozi-captions; submagic.co/blog/submagic-review; thebusinessdive.com/submagic-review.
- Opus Clip 3.0: opus.pro/ai-b-roll; opus.pro/tools/add-captions-to-video; feisworld.com/blog/opusclip-30-released; futurepedia.io (b-roll/captions course).
- CapCut: capcut.com/tools/auto-caption-generator; capcut.com/tools/text-to-speech; crepal.ai/blog/aivideo (auto-subtitles).
- Canva Magic: canva.com/newsroom/news/magic-studio; canva.com/features/video-to-text.
- Word-by-word captions: vidno.ai/blog/karaoke-style-word-highlight-captions; vocallab.ai/blog/word-highlighting-subtitles; vocallab.ai/blog/word-level-timestamped-subtitles-for-videos; karadeo.com/resources/how-to-make-alex-hormozi-captions.
- Ducking: helpx.adobe.com/premiere-pro/using/auto-ducking; filmora.wondershare.com/audio-ducking; homebrewaudio.com/8749; gearank.com/audio-ducking; descript.com/blog (audio levels).
