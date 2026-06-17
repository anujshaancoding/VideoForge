# Make a sketch/cartoon narrated video — run it yourself (no Claude needed)

This folder is your **self-serve kit**. Full recipe + theory: [`../Sketch_Video_Runbook.md`](../Sketch_Video_Runbook.md).
These are the actual working scripts from the build sessions.

There are **two ways** to make a video. Pick one.

---

## Path A — the VideoForge app (point-and-click, easiest)

1. Start the backing services and DB:
   ```
   pnpm services:up
   pnpm db:migrate            # if DB is fresh
   ```
   > If `localhost:5432` is taken on your machine (e.g. an SSH tunnel), this repo's
   > `docker-compose.override.yml` publishes Postgres on **5544** instead — then run the
   > API with `DATABASE_URL=postgresql://videoforge:videoforge_dev@localhost:5544/videoforge`.
2. Start the API + the render worker:
   ```
   pnpm dev:api                       # API (host) — runs the Script Studio pipeline
   docker compose up -d render-worker # exporter (ffmpeg in a container)
   ```
3. Open **Draw Things**, load **SDXL Turbo** (or FLUX.1-schnell), turn on **Settings →
   Advanced → API Server** (port 7860). *(Or skip it — the pipeline falls back to the
   keyless Pollinations cloud for images.)*
4. Start the web app, open **Script Studio**, paste your script, pick a voice + sketch
   style → **Plan** → **Generate**. It builds the timeline and you **Export** the MP4.

Settings live in `.env` (`IMAGEGEN_*`, `DRAWTHINGS_URL`, `SKETCH_REVEAL`, `TTS_ENGINE`).

---

## Path B — standalone scripts (no VideoForge app, most portable)

This is the path used to make the latest videos. Needs: **Node**, **Python venv**, **ffmpeg**
(via Docker is fine), and an image source (Draw Things **or** the keyless cloud).

One-time Python setup:
```
python3 -m venv venv
./venv/bin/pip install sharp-cli  # (images use Node 'sharp'); plus:
./venv/bin/pip install faster-whisper mlx-audio   # word alignment + Chatterbox TTS
```

Then, per video:
1. **Scenes** — write `scenes` (narration + a short visual per scene). Use the LLM prompt
   in the runbook, or do it by hand. (`videoforge_pipeline.mjs` shows a hand-authored plan.)
2. **Images** — `cartoon_images.mjs` (cartoon, via the cloud) or Draw Things per the runbook
   (pen/graphite/color → run each through the sharp sketch filter in the runbook).
3. **Voice** — Kokoro / Piper / `say`, or **Chatterbox** (natural / your own voice):
   ```
   ./venv/bin/python -m mlx_audio.tts.generate \
     --model mlx-community/Chatterbox-TTS-fp16 --text "scene text" --output_path sceneN.wav
   # add  --ref_audio your_voice.wav  to use YOUR cloned voice
   ```
4. **Karaoke subtitles** — `build_karaoke.py` aligns each WAV (faster-whisper) and writes a
   per-word-highlight `.ass`.
5. **Assemble** — the `ffmpeg` command in the runbook (loop images + fade, concat, mix music,
   burn the `.ass`). 9:16 = `scale=1080:1920`; 16:9 = `scale=1920:1080`.

---

## Files here
| File | What it does |
|---|---|
| `videoforge_pipeline.mjs` | Drives the VideoForge API: signup → plan → generate → export → download. Reference for Path A automation. |
| `cartoon_images.mjs` | Generates cartoon images (keyless cloud) and covers them to the output size. |
| `build_karaoke.py` | Forced alignment (faster-whisper) → ASS per-word karaoke subtitle. |

> ⚠️ Models/licensing for **commercial** publishing: use SDXL **FLUX.1-schnell** (not Turbo),
> **Chatterbox** (MIT) for voice, **FreePD** (CC0) for music. Avoid XTTS/F5-original/Fish (non-commercial).
