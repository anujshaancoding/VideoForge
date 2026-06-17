# Sketch Video Runbook — script → narrated whiteboard-sketch video ($0)

**Goal:** turn any script into a vertical (1080×1920) narrated video where each scene is a
pencil/pen sketch that fades in, with the narration shown as synced subtitles and a soft
music bed. Everything here is **free** and runs **locally**. No paid APIs.

This runbook is deliberately tool-agnostic. You can do every step:
- **with an LLM** (ChatGPT, Claude, a free local model) — only used to break the script into scenes, and
- **with no LLM at all** — a simple manual rule does the same job.

The only "real" tools are: an **image generator** (Draw Things, free), a **text-to-speech**
voice (free options below), an **image→sketch filter** (10 lines of code, or one ffmpeg flag),
and **ffmpeg** to glue it together. VideoForge automates all of this, but you don't need it.

---

## 0. The pipeline at a glance

```
script
  → [STEP 1] break into scenes  (LLM optional)         → scenes.json  (per scene: narration + image idea)
  → [STEP 2] narrate each scene (TTS)                  → sceneN.wav   (+ measured duration)
  → [STEP 3] draw + sketch each scene (image gen+filter)→ sceneN.png   (pen sketch, 1080×1920)
  → [STEP 4] assemble (ffmpeg): images timed to audio,
             fade-in, music bed, synced subtitles      → final.mp4
```

Each scene = one narration line + one sketch. The sketch is shown for exactly as long as its
narration takes (that's what keeps picture and voice in sync — measure the WAV, use that length).

---

## 1. STEP 1 — Break the script into scenes

You want a list of scenes; each scene has **(a) the narration text** (what the voice says) and
**(b) a short visual description** (what to draw).

### Option A — with an LLM (any: ChatGPT, Claude, a free model)
Paste your script after this prompt:

> You are a video planner. Split the script below into 6–12 scenes (intro + each main point +
> a closing). For EACH scene output JSON with:
> - `"voiceover"`: one or two natural spoken sentences (what the narrator says),
> - `"image"`: a short, concrete visual to draw — ONE clear subject, simple background,
>   e.g. "a small child imitating a parent on a phone".
> Return ONLY a JSON array like:
> `[{"voiceover":"...","image":"..."}, ...]`
> Keep each voiceover under ~40 words. Script:
> «PASTE SCRIPT HERE»

Save the result as `scenes.json`.

### Option B — no LLM
1. Read the script. Put each **main point** (and an intro + a closing line) on its own line.
2. For each line, write a one-line **visual** describing a single clear subject to draw.
That's your `scenes.json` (same shape). A "5 tips" script → ~7 scenes (intro + 5 + outro).

> Tip for the image descriptions: always say **"single clear subject, simple background"**.
> Busy scenes ("a crowded market") produce messy sketches.

---

## 2. STEP 2 — Narrate each scene (free TTS)

Produce one `sceneN.wav` per scene from its `voiceover` text. Any of these are free:

| Tool | How | Notes |
|---|---|---|
| **Kokoro** (kokoro-js / kokoro-onnx) | Node/Python, CPU | Natural voices, fully offline after first model download. VideoForge uses this. |
| **Piper** | `echo "text" \| piper -m en_US-amy.onnx -f sceneN.wav` | Tiny, fast, offline. |
| **macOS `say`** | `say -v Samantha -o sceneN.aiff "text"` then convert to wav | Zero install on a Mac. |

After making each WAV, **measure its duration** (you need this for timing):
```
ffprobe -v error -show_entries format=duration -of csv=p=0 sceneN.wav
```
Record `durationSec` for each scene.

---

## 3. STEP 3 — Draw each scene, then sketch-filter it

### 3a. Generate a base image per scene — Draw Things (free, local)
Install **Draw Things** (Mac App Store) → download model **SDXL Turbo** (or FLUX.1‑schnell for
higher quality, slower) → enable **Settings → Advanced → API Server** (HTTP, port 7860).

**Proven SDXL‑Turbo settings (this matters — wrong settings make it blurry or "fried"):**

| Setting | Value | Why |
|---|---|---|
| Steps | **5** (1–6) | Turbo is distilled; >6 over-cooks. |
| Text Guidance (CFG) | **1** | Turbo uses no guidance; CFG>2 = fried/HDR look. |
| Sampler | **Euler a** | Turbo's trained sampler (NOT DPM++ 2M/AYS). |
| Size | **640×1152** (9:16) | Near Turbo's native; bigger duplicates the subject. Upscale later. |
| CLIP skip / Refiner | 1 / none | SDXL Turbo has no refiner. |

Prompt per scene (from `scenes.json`):
```
<image description>. detailed illustration, single clear subject, soft natural lighting
```
Generate one base image per scene → `sceneN_base.png`. (You can use Draw Things' UI, or its
HTTP API: `POST http://127.0.0.1:7860/sdapi/v1/txt2img` with
`{prompt, seed, steps:5, cfg_scale:1, sampler_name:"Euler a", width:640, height:1152}`.)

> **Free cloud fallback (no install):** `https://image.pollinations.ai/prompt/<URL-encoded prompt>?width=640&height=1152&seed=42&nologo=true&model=flux` — keyless, but rate-limited (~1 image / 15s).

### 3b. Convert each base image to a pen sketch (the look + consistency)
Run EVERY base image through the SAME filter — that uniform pass is what makes all the scenes
look like one hand drew them, and it upscales to the final 1080×1920.

**Pure-Node (sharp) — the production filter:**
```js
// npm i sharp ; node sketch.js sceneN_base.png sceneN.png
import sharp from "sharp";
const [,, src, dst] = process.argv;
const W = 1080, H = 1920;                                  // export size
const base = await sharp(src).resize(W, H, { fit: "cover", kernel: "lanczos3" })
  .removeAlpha().toColourspace("srgb").png().toBuffer();
const gray = await sharp(base).greyscale().toBuffer();
const blurInv = await sharp(gray).negate().blur(5).toBuffer();
const dodge = await sharp(gray).composite([{ input: blurInv, blend: "colour-dodge" }]).toBuffer();
await sharp(dodge).blur(0.5).threshold(238).png().toFile(dst);   // pen / ink line art
```
Variants: **graphite** (skip the `threshold`, add `.linear(1.05,-6)`); **colour pencil**
(multiply the original by the dodge sketch). VideoForge ships all three; `pen` is the default.

**No-code alternatives:** OpenCV `cv2.pencilSketch()` (Python, ~5 lines), or ImageMagick
`convert in.png -colorspace Gray -sketch 0x10+120 out.png`, or ffmpeg `edgedetect` + `negate`.

Result: `sceneN.png` — a 1080×1920 pen sketch per scene.

---

## 4. STEP 4 — Assemble the video (ffmpeg)

Inputs you now have: `scene0.png … sceneN.png`, `scene0.wav … sceneN.wav` (with each
`durationSec`), and a music file `music.wav` (free CC0 from **freepd.com** or **incompetech**).

One ffmpeg command does it all — loop each sketch for its narration length, fade it in,
concatenate the scenes, and mix the music bed under the voice:

```bash
# Per scene i: -loop 1 -t <durSec_i> -i sceneI.png   and   -i sceneI.wav
# Then: -stream_loop -1 -i music.wav   (last input)
ffmpeg -y \
  -loop 1 -t 7.4 -i scene0.png -i scene0.wav \
  -loop 1 -t 14.0 -i scene1.png -i scene1.wav \
  -loop 1 -t 13.8 -i scene2.png -i scene2.wav \
  -stream_loop -1 -i music.wav \
  -filter_complex "\
   [0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1,fps=30,\
        fade=t=in:st=0:d=0.4,format=yuv420p[v0];\
   [2:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1,fps=30,\
        fade=t=in:st=0:d=0.4,format=yuv420p[v1];\
   [4:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1,fps=30,\
        fade=t=in:st=0:d=0.4,format=yuv420p[v2];\
   [v0][1:a][v1][3:a][v2][5:a]concat=n=3:v=1:a=1[vid][voa];\
   [6:a]volume=0.15[mus];[voa][mus]amix=inputs=2:duration=first[aud]" \
  -map "[vid]" -map "[aud]" \
  -c:v libx264 -preset veryfast -crf 20 -pix_fmt yuv420p \
  -c:a aac -b:a 160k -movflags +faststart final.mp4
```
- `fade=t=in:st=0:d=0.4` = the **0.4s fade-in** per scene.
- `volume=0.15` = music sits quietly under the voice.
- Add more scenes by repeating the input pair and the `[N:v]…[vN]` line, and bumping `concat=n=`.

### Per-word karaoke subtitles (the spoken word highlights — precise sync)
For word-accurate highlighting (each word colours as it's said), you need exact word
timings, then an ASS karaoke subtitle:

1. **Get word timings (forced alignment, $0 local).** Run each scene's WAV through
   `faster-whisper` (pip install, CPU) with `word_timestamps=True` — for clean TTS audio
   the word times are accurate. (Alternatives: `whisper.cpp --dtw`, or `aeneas` forced
   alignment since the text is known.)
2. **Write an ASS file** with one Dialogue line per ~6-word phrase, each word wrapped in a
   `{\kf<centiseconds>}` karaoke tag (duration = next-word-start − this-word-start). Style:
   `PrimaryColour` = highlight (e.g. yellow `&H0000FFFF`), `SecondaryColour` = white,
   `Alignment=2` (bottom-centre), `Outline=4`. libass fills each word as it's spoken.
3. **Burn it** by replacing `subtitles=subs.srt` below with `subtitles=karaoke.ass`.

(See `build_karaoke.py` for a complete reference implementation. This needs ffmpeg built
with **libass**; the standard distro ffmpeg has it.)

### Phrase-by-phrase subtitles (simpler — no alignment needed)
Write the narration to an **SRT** file with each line timed to its scene window (start =
cumulative time, end = start + durationSec; split long lines into ~5-word phrases for the
"appears as spoken" feel), then burn it in by appending to the video chain:
```
,subtitles=subs.srt:force_style='Alignment=2,FontSize=18,Outline=2,MarginV=60'
```
(Alignment=2 = bottom-centre.) That's the same result as VideoForge's per-phrase bottom captions.

---

## 5. The VideoForge path (automation of all of the above)

VideoForge does Steps 1–4 for you and keeps everything editable:

1. `pnpm services:up` (Postgres/Redis/MinIO) → `pnpm db:migrate` → run the API + render-worker.
2. Open **Script Studio**, paste the script, pick a voice + sketch style → **Plan** → **Generate**.
3. It plans scenes (Groq LLM, or a key-free heuristic), synthesizes VO (Kokoro), generates +
   sketch-filters images (Draw Things → sharp), assembles a timeline, and exports the MP4 —
   with the fade-in, synced subtitles, and ducked music applied automatically.

Key env (see `.env.example`): `IMAGEGEN_*` (Turbo settings above), `DRAWTHINGS_URL`,
`SKETCH_REVEAL` (`wipe`|`0`|unset=fade), `TTS_ENGINE`.

---

## 6. Quick parameter reference

| Knob | Value | Where |
|---|---|---|
| Output | 1080×1920, 30 fps, H.264/CRF 20, AAC 160k | ffmpeg `-map`/`-c:*` |
| Scene length | = its narration WAV duration | `ffprobe` |
| Scene fade-in | 0.4 s | `fade=t=in:d=0.4` |
| Subtitle phrase | ~5 words, bottom-centre | SRT + `subtitles=` |
| Music level | 0.15 (15%) under voice | `volume=0.15` |
| Image gen | SDXL Turbo · 5 steps · CFG 1 · Euler a · 640×1152 | Draw Things |
| Sketch | pen (dodge + threshold), upscaled to 1080×1920 | sharp/OpenCV |

## 7. Cost & licensing notes
- **$0**: Draw Things (local), Kokoro/Piper (local), sharp/ffmpeg (open source), FreePD music (CC0).
- **For commercial publishing:** SDXL Turbo is *non-commercial*; switch the Draw Things model to
  **FLUX.1‑schnell** (Apache-2.0). FreePD tracks are CC0 (no attribution needed). Verify any
  Civitai LoRA license before shipping.
- A 4–5 min video needs ~700–900 words of script (≈130 words/min).
