---
name: videoforge-dev-startup
description: How the local dev stack runs; the API (:4000) is separate from web (:5173) and gates the whole app
metadata:
  type: project
---

VideoForge local dev: web (Vite) on **:5173**, API (Fastify) on **:4000**, render-worker + Postgres(:5432) + MinIO(:9000/9001) + Redis(:6379) in docker (all were already `Up` this session). `pnpm dev` (scripts/dev.mjs) starts web+api+worker together.

**Gotcha:** the app gates EVERYTHING behind auth, and auth + projects + assets + export all hit the API at `http://localhost:4000/api/v1` (`VITE_API_BASE_URL`). If only the web server is running (a common state — it was this session), the app is stuck at `/login` and nothing works. Start the API alone with `corepack pnpm@9.12.0 --filter @videoforge/api dev`. Health check is `GET http://localhost:4000/health` (NOT `/api/v1/health` — that 404s).

A browser cookie session (`vf_refresh`) auto-restores login on boot, so once signed in you land on the dashboard without re-auth. Export is a real server render via the worker — POST `/exports` → poll → POST `/exports/:id/download` mints a presigned MP4 URL (verified working end-to-end, ~4s for a short clip).

Related: [[web-test-suite-rot]].
