# VideoForge on Windows — Setup & Run Guide

> **Purpose.** You're moving this project from the Mac to a **Windows + RTX 4060** box.
> This file is the single source of truth for getting it running there and for what
> changes vs. the Mac. Run **`/start-windows`** at the top of a session on the new box —
> that command reads this file, checks your environment, and tells you exactly what's
> missing.

---

## 0. TL;DR — what's different on Windows

| Thing | Mac (today) | Windows (new box) |
|---|---|---|
| Image engine | **Draw Things** (local, Mac-only) | **Automatic1111 / ComfyUI / Forge** with `--api`, GPU on the 4060 |
| GPU | Apple Silicon (MPS) | **NVIDIA CUDA** (RTX 4060, 8 GB) — faster, can run full SDXL |
| Services (pg/redis/minio/worker) | Docker Desktop | **Docker Desktop (WSL2 backend)** — same |
| `make` targets | native | need **Git Bash** (or just run the `pnpm` scripts directly) |
| ffmpeg/ffprobe paths | `/usr/local/bin/...` | Windows path or bare `ffmpeg`/`ffprobe` on PATH |

The app code is cross-platform (Node + Vite + Docker). The only Windows-specific work is:
**(a)** the image-gen engine swap, **(b)** ffmpeg/ffprobe path, **(c)** `make` → use Git Bash or pnpm.

---

## 1. What this project is (1-minute orientation)

**VideoForge** — a browser video editor (Chrome/Edge, WebCodecs) + a **Script Studio** that
turns a raw script into a finished, narrated, illustrated video. Run as a one-person "persona
company" (see [`../CLAUDE.md`](../CLAUDE.md) and [`../company/COMPANY_OS.md`](../company/COMPANY_OS.md)).

**Monorepo (pnpm workspaces):**

| Path | Role |
|---|---|
| `packages/project-schema` | `Project` types + JSON Schema + `validate()` (the invariant) |
| `packages/ffmpeg-graph` | `buildFilterComplex(project)` — pure export graph |
| `packages/script-studio` | pure scene planning / assembly (Contract A/B) |
| `apps/web` | Vite + React editor |
| `apps/api` | Fastify REST + WS + Script Studio orchestration |
| `apps/render-worker` | BullMQ + FFmpeg render (runs in Docker) |

**The Script Studio pipeline** (what produces video from a script):
`POST /script/plan` (Groq or heuristic → scenes) → `POST /script/generate` (per scene: TTS
voiceover → register asset → optional music bed → pure timeline assembly → **optional image per
scene** → persist). Images come from `apps/api/src/script/imagegen.ts` (base image) +
`sketch.ts` (deterministic style filter) or `imageSearch.ts` (real web photos).
Full trace: see the code comments in `apps/api/src/script/`.

---

## 2. Prerequisites on the Windows box

Install these first (PowerShell as admin; `winget` is easiest):

```powershell
winget install OpenJS.NodeJS.LTS          # Node >=20 (corepack ships with it)
winget install Docker.DockerDesktop        # services (needs WSL2 — Docker prompts to enable)
winget install Git.Git                     # Git Bash, so `make` and POSIX scripts work
winget install Gyan.FFmpeg                 # ffmpeg + ffprobe on PATH (for API duration probe)
corepack enable                            # activates the pinned pnpm@9.12.0
```

Then for **GPU image generation**, pick ONE A1111-compatible server (details in §5):
- **Automatic1111** (`stable-diffusion-webui`) — most compatible with this code's API calls.
- **ComfyUI** — lighter, but needs the A1111-API extension/node.
- **SD.Next / Forge** — also fine.

Verify NVIDIA driver + CUDA is live:
```powershell
nvidia-smi          # should list the RTX 4060
```

---

## 3. First run — bring the stack up

From the repo root (`VideoForge/`). Use **Git Bash** if you want `make`, or run the pnpm
scripts directly in PowerShell.

```bash
# 1. Create your .env from the example (then edit it — see §4)
cp .env.example .env          # PowerShell: copy .env.example .env

# 2. Install deps + build the shared packages
corepack pnpm@9.12.0 install
corepack pnpm@9.12.0 -r --filter "./packages/*" build

# 3. Start postgres / redis / minio / render-worker (Docker Desktop must be running)
corepack pnpm@9.12.0 services:up

# 4. Migrate DB + seed CC0 fixtures into MinIO + Postgres
corepack pnpm@9.12.0 db:migrate
corepack pnpm@9.12.0 seed

# 5. Run web + api + worker together
corepack pnpm@9.12.0 dev:all
```

`make install && make services && make seed && make dev` does the same in Git Bash.

Open the web app at **http://localhost:5173** (API at `http://localhost:4000`). Use **Chrome or
Edge** — WebCodecs is the only decode path.

---

## 4. `.env` changes for Windows

Copy `.env.example` → `.env`, then change these keys. Everything else can stay at defaults.

```ini
# ── ffmpeg/ffprobe: the API probes TTS WAV duration with ffprobe ──
# Use bare names if ffmpeg is on PATH (winget Gyan.FFmpeg does this), OR full Windows paths.
FFMPEG_PATH=ffmpeg
FFPROBE_PATH=ffprobe
# (If not on PATH: FFPROBE_PATH=C:\ffmpeg\bin\ffprobe.exe — note: the render-worker runs in
#  Docker, so it always has ffmpeg regardless; these vars only matter to apps/api.)

# ── Image generation: point at your local GPU A1111 server (NOT Draw Things) ──
IMAGEGEN_ENGINE=drawthings              # the code's name for "local A1111 endpoint" — keep it
DRAWTHINGS_URL=http://127.0.0.1:7860    # A1111/ComfyUI API URL (the /sdapi/v1/txt2img server)

# ── GPU can run FULL SDXL (better images than Mac's Turbo defaults). See §5 for the tradeoff. ──
# For full SDXL quality (slower, sharper). Leave commented to keep the fast SDXL-Turbo defaults.
# IMAGEGEN_STEPS=28
# IMAGEGEN_CFG=6.5
# IMAGEGEN_SAMPLER=DPM++ 2M Karras
# IMAGEGEN_WIDTH=768
# IMAGEGEN_HEIGHT=1344

# ── Optional: Groq key (better scene plans than the key-free heuristic) ──
GROQ_API_KEY=                           # paste your free Groq key here (blank → heuristic)

# ── Optional: real-photo scene style (Google Programmable Search, 100 q/day free) ──
# IMAGE_SEARCH_ENGINE=google
# GOOGLE_CSE_KEY=
# GOOGLE_CSE_CX=
```

> Real creds (Groq, Google) live in `.env` and **`company/ACCESS.md`** (gitignored) — never
> commit them. See the access memory in `company/`.

---

## 5. GPU image generation — the RTX 4060 setup

This is the main reason to move boxes. The code talks to any **Automatic1111-compatible**
server over `POST /sdapi/v1/txt2img` — it's engine-agnostic, so no code change is needed, just
the endpoint.

### Set up Automatic1111 (recommended — closest API match)
1. Clone `AUTOMATIC1111/stable-diffusion-webui`.
2. Edit `webui-user.bat` → set `COMMANDLINE_ARGS=--api --xformers`.
3. Run `webui-user.bat`. It serves the API at `http://127.0.0.1:7860` (matches `DRAWTHINGS_URL`).
4. Download a model checkpoint into `models/Stable-diffusion/`:
   - **Fast (matches current Mac defaults):** `sd_xl_turbo_1.0.safetensors` — keep `.env`
     image defaults (5 steps, CFG 1, Euler a). Cheapest, ~1–2 s/image on the 4060.
   - **Higher quality (the 4060 upgrade):** a full SDXL checkpoint
     (`sd_xl_base_1.0.safetensors` or a fine-tune). Uncomment the full-SDXL block in §4.
     ~5–10 s/image, noticeably sharper — best for the **`photo`** scene style.

### Quality reality check
- For the **sketch** styles (`pen`/`graphite`/`color`), a better base model gives diminishing
  returns — `sketch.ts` runs a uniform filter that flattens base detail on purpose (so 30–40
  images read as one hand). Full SDXL helps most for **`photo`** mode (kept un-filtered).
- 8 GB VRAM comfortably runs SDXL at 768×1344. Add `--medvram` to the A1111 args if you OOM.

### Verify the endpoint is reachable
```bash
curl http://127.0.0.1:7860/sdapi/v1/sd-models     # should return JSON, not refuse the connection
```
If this fails, image gen silently degrades: Draw Things(=your A1111) → Pollinations (keyless
cloud) → a flat placeholder PNG. The pipeline never crashes; you just won't get GPU images.

---

## 6. Daily workflow on Windows

```bash
corepack pnpm@9.12.0 services:up     # start docker services (once per boot)
# start your A1111 server (webui-user.bat) if you'll generate images
corepack pnpm@9.12.0 dev:all         # web + api + worker
# ... work ...
corepack pnpm@9.12.0 services:down   # stop services (keeps data)
```

Common commands (from `package.json`):
`pnpm test` · `pnpm typecheck` · `pnpm lint` · `pnpm test:golden` (export parity gate) ·
`pnpm test:e2e` (Playwright).

---

## 7. Windows gotchas (read if something breaks)

- **`make` not found** → use **Git Bash**, or run the underlying `pnpm` scripts directly
  (every `make` target is a thin wrapper; see the `Makefile`).
- **Docker not running** → `services:up` hangs/fails. Start Docker Desktop first; ensure the
  **WSL2 backend** is enabled (Docker Settings → General).
- **ffprobe errors in API logs** → `FFPROBE_PATH` is wrong. The API degrades to reading the WAV
  header so it won't crash, but scene timings are less exact. Fix the path (§4).
- **Port already in use** (4000 / 5173 / 5432 / 6379 / 9000) → stop the conflicting app or
  change ports in `.env` + `docker-compose.yml`.
- **Line endings** — keep Git's `autocrlf` default (`input`) so `.sh`/`.mjs` scripts stay LF.
  If a script fails with `\r` errors, run `git config core.autocrlf input` and re-checkout.
- **Image gen returns flat colored rectangles** → that's the **placeholder** engine: your A1111
  server isn't reachable at `DRAWTHINGS_URL`. Start it / fix the URL (§5).
- **Slow first image** → cold model load (up to 3 min); `IMAGEGEN_TIMEOUT_MS=180000` covers it.

---

## 8. Where to go next

- Boot a session: **`/start-windows`** (env check + brief), then **`/start-company`** (org brief).
- Product scope guardrail: [`MVP_Scope.md`](MVP_Scope.md) — build only `✅` items.
- Image-gen tuning rationale: [`Market_Research.md`](Market_Research.md) (SDXL-Turbo settings).
- The full company operating model: [`../company/COMPANY_OS.md`](../company/COMPANY_OS.md).
