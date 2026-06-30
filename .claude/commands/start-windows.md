---
description: Boot a session on the Windows/RTX-4060 box — read the Windows guide, verify the environment (Node, pnpm, Docker, ffmpeg, GPU image server), and brief the CEO on what's ready vs missing with exact fix commands
---

Act as **Atlas** (Chief of Staff). This is the **Windows cold-boot**: the project has been moved
to the Windows + RTX 4060 box. Your job is to confirm the new environment can run VideoForge and
tell the CEO precisely what (if anything) still needs doing. Read + verify only — do **not**
edit `.env`, install packages, or start long-running servers unless the CEO asks.

1. Read the Windows guide as the source of truth:
   - [`docs/WINDOWS_SETUP.md`](../../docs/WINDOWS_SETUP.md) (the full setup + gotchas)
   - skim root [`CLAUDE.md`](../../CLAUDE.md) for product facts.

2. **Probe the environment** (read-only checks; report each as ✅ ready / ❌ missing / ⚠️ check).
   Run the equivalents that work in the current shell:
   - `node --version` (need ≥ 20) and `corepack pnpm@9.12.0 --version` (pnpm 9.12.0)
   - `docker version` and `docker compose ps` — is Docker Desktop up? are pg/redis/minio/worker running?
   - `nvidia-smi` — is the RTX 4060 + CUDA driver visible?
   - `ffprobe -version` (and `ffmpeg -version`) — on PATH?
   - whether `.env` exists; if so, read the **image-gen + ffmpeg** keys only and check:
     `IMAGEGEN_ENGINE`, `DRAWTHINGS_URL`, `FFMPEG_PATH`, `FFPROBE_PATH`, `GROQ_API_KEY` presence.
   - probe the GPU image server: `curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:7860/sdapi/v1/sd-models`
     (use the `DRAWTHINGS_URL` from `.env` if different). A connection refusal = the A1111/ComfyUI
     server isn't running → images would fall back to placeholder.

3. **Brief the CEO** — terse, high-signal, a readiness checklist:
   - **Environment** — the probe results as a short ✅/❌/⚠️ list (Node, pnpm, Docker+services, GPU,
     ffmpeg, `.env`, image server).
   - **🔴 Blockers to first run** — anything ❌, each with the exact one-line fix command from
     `docs/WINDOWS_SETUP.md` (§2 install, §3 first-run, §4 `.env`, §5 GPU server).
   - **Images** — is the local GPU engine reachable? If not, say so and what to start (the A1111
     `webui-user.bat` with `--api`), and that it degrades to Pollinations → placeholder meanwhile.
   - **Recommended next move** — the ordered commands to get to a working `pnpm dev:all`, only the
     steps not already satisfied.

4. End by asking the CEO whether to proceed (e.g. run install/services/seed) or hand off to
   `/start-company` for the org brief. Keep the whole brief readable in under a minute.
