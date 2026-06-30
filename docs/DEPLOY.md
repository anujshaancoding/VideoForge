# VideoForge — Deployment Runbook

> Anchor document. Last updated: 2026-06-30.
> Production deploys and paid infra are CEO gates — prepare here, decide via `company/DECISIONS.md`.

---

## 1. Frontend (static SPA) — Vercel

### Why Vercel

Vercel was chosen over Cloudflare Pages for three concrete reasons:

1. **pnpm monorepo support is first-class.** Vercel auto-detects pnpm workspaces and respects
   `vercel.json`'s `buildCommand`/`outputDirectory` without manual root-directory overrides.
   Cloudflare Pages requires a manual "root directory" dance and historically mis-handles
   workspace symlinks.

2. **SPA rewrite is one JSON line** (`"rewrites": [{ "source": "/(.*)", "destination": "/index.html" }]`).
   The app uses `react-router-dom` (client-side routing), so ALL unknown paths must be rewritten to
   `/index.html` — without this, deep links 404 on hard refresh.

3. **Free Hobby tier covers the MVP:** unlimited static bandwidth, automatic HTTPS, preview
   deployments per branch, no credit card required for the first project.

The config lives at `/vercel.json` (repo root). The Vercel project root MUST be the repo root
(not `apps/web`) — Vercel reads `vercel.json` from the project root, and its paths
(`outputDirectory: apps/web/dist`, the `pnpm --filter` build) are repo-root-relative so pnpm can
resolve workspace packages.

### Build facts

| Parameter | Value |
|---|---|
| Build command | `pnpm --filter @videoforge/project-schema build && pnpm --filter @videoforge/templates build && pnpm --filter @videoforge/web build` |
| Output directory | `apps/web/dist` |
| Install command | `pnpm install --frozen-lockfile` |
| Node version | 20 (matches `engines.node` in root `package.json`) |
| Bundle size (gzip) | ~302 KB JS + ~16 KB CSS (as of 2026-06-30) |

The build sequence matters: workspace packages (`project-schema`, `templates`) must be compiled
before the web app runs `tsc -b`. The `buildCommand` in `vercel.json` encodes this order
explicitly, making the build independent of any Vercel "build detection" heuristics.

### Environment variables — set in Vercel dashboard (Settings > Environment Variables)

All three are `VITE_`-prefixed. Vite bakes them into the static bundle at build time; they are
NOT runtime-injectable without a rebuild.

| Variable | Required | Notes |
|---|---|---|
| `VITE_API_BASE_URL` | Yes | Full URL including path, e.g. `https://api.videoforge.app/api/v1`. No trailing slash. Without this the editor's save/render features cannot reach the backend. |
| `VITE_WS_URL` | Yes | WebSocket URL, e.g. `wss://api.videoforge.app/ws`. Must use `wss://` in production (TLS). |
| `VITE_SENTRY_DSN` | No | Leave blank to disable Sentry in that environment. Only set on production; previews can use a separate Sentry project or stay blank. |

These must NOT contain any secrets — they are embedded in the public JS bundle.

### SPA fallback note

The `rewrites` block in `vercel.json` is the SPA fallback. Vercel applies rewrites last (after
static file matching), so `dist/assets/*` and `dist/index.html` are served as files;
everything else falls through to `/index.html` and React Router takes over. Do not remove this
rule or direct-link navigation will 404.

### Step-by-step: first deploy

1. Push the repository to GitHub (if not already there).
2. Go to https://vercel.com/new, import the GitHub repo.
3. Set framework preset to "Other" (not Next.js, not Vite auto-detect — we supply our own build
   command).
4. Confirm root directory is the repo root (`.`), NOT `apps/web`.
5. Add the three environment variables above (at minimum `VITE_API_BASE_URL` and `VITE_WS_URL`).
6. Deploy. Vercel reads the repo-root `vercel.json` automatically.
7. On success: confirm `/` loads the editor, `/editor/some-id` deep-links without 404, and
   `/assets/index-*.js` returns HTTP 200 with a long `Cache-Control` header.

### Rollback

Vercel keeps every deployment permanently accessible via its deployment URL. Rolling back is
an instant re-alias (no rebuild) via the Vercel dashboard: Deployments tab > select a prior
deployment > "Promote to Production". The bad deployment's URL still works for debugging.

---

## 2. Backend — apps/api, apps/render-worker, Postgres, Redis, S3

The backend is NOT required for the static frontend to load. The landing page, the editor UI,
and locally-opened project files all render without a backend. Save, export, and TTS/sketch
pipeline require a live backend.

### What the backend is

| Service | Role | Notes |
|---|---|---|
| `apps/api` | Fastify REST + WebSocket stub | Stateless; reads `DATABASE_URL`, `REDIS_URL`, `S3_*` |
| `apps/render-worker` | BullMQ consumer + FFmpeg render | The cost driver: needs FFmpeg 6.1.1 + CPU |
| Postgres 16 | Project JSONB, users, exports metadata | ~50 MB idle |
| Redis 7 | BullMQ job queues + rate limiting | ~10 MB idle |
| S3 / MinIO | Originals, proxies, exports (3 buckets) | MinIO in dev; real S3 in prod |

The render-worker is the cost driver: each export runs FFmpeg against uploaded media. Single
renders are CPU-bound (~4–30s per 60s clip on 2 vCPUs). `RENDER_CONCURRENCY=1` in MVP.

### Hosting options

#### Option A: Single VPS running docker-compose (cheapest)

Run the full `docker-compose.yml` stack on a single VPS. Replace MinIO with the same MinIO
container or point at S3/Backblaze B2/R2.

Providers: Hetzner CX22 (2 vCPU / 4 GB / 40 GB SSD, EU), DigitalOcean Basic Droplet,
Linode Shared 4GB.

Rough cost: **$5–$12/mo** for the VPS, **$0** (Cloudflare R2 free tier, 10 GB) or **~$0.02/GB**
(S3) for object storage, **$0** Redis (bundled on VPS).

Tradeoffs: simple to operate; no managed failover; FFmpeg renders on the same machine as the
API so a busy export queue can starve API responses. Suitable for MVP and early user testing.

Rollback: git pull + docker compose up. Data lives in named Docker volumes on the VPS;
snapshot with the provider's volume backup.

#### Option B: Managed Postgres + Redis + object store + single app server

Split the stateful services to managed providers and run only the application layer on a VPS or
PaaS container.

- Postgres: Neon (serverless free tier up to 0.5 GB; $19/mo for basic dedicated) or Supabase
  free tier.
- Redis: Upstash (pay-per-request, ~$0 at low volume; $10/mo fixed if busy).
- S3/object store: Cloudflare R2 ($0 egress; $0.015/GB storage) or AWS S3 us-east-1 (~$0.023/GB).
- API + render-worker: a single Fly.io machine or Railway container (1–2 shared vCPU, 1 GB RAM),
  or a small VPS as in Option A running only the app containers.

Rough cost: **$0–$30/mo** at MVP scale depending on Postgres tier chosen. Neon free tier covers
early users; step up to $19/mo when the project count grows.

Tradeoffs: individual services scale and fail independently; ops overhead is lower; costs are
itemised per service. Slightly more configuration glue.

#### Option C: Full managed PaaS (Railway / Render / Fly.io)

Deploy each service as a managed container: one service for `apps/api`, one for
`apps/render-worker`, managed Postgres and Redis add-ons.

Rough cost: **$15–$50/mo** depending on plan. Railway's $5 Hobby plan includes $5 of usage;
Render's Basic plan starts at $7/service/mo. Render-worker needs at least 1 vCPU dedicated to
avoid FFmpeg timeouts.

Tradeoffs: easiest operational story (logs, deploy, rollback all in one dashboard); highest
per-resource cost at small scale; vendor lock-in on secrets/env management.

### Minimum to ship a usable demo

Goal: a working end-to-end demo (signup, upload clip, export MP4) at the lowest cost and
complexity.

Recommendation: **Option A on a single Hetzner CX22 ($6/mo)** + Cloudflare R2 for object
storage ($0 egress at demo scale).

Steps:
1. Provision a Hetzner CX22 (2 vCPU / 4 GB RAM / 40 GB SSD).
2. Install Docker + Docker Compose v2, clone the repo.
3. Copy `.env.example` to `.env`; fill in `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, and the
   R2/S3 credentials (or keep MinIO by commenting in the minio service).
4. Run `docker compose up -d --wait` — brings up Postgres, Redis, MinIO, and the render-worker.
5. Run `pnpm --filter @videoforge/api db:migrate` to apply the schema.
6. Point Vercel's `VITE_API_BASE_URL` at the VPS IP/domain.
7. Add a reverse proxy (Caddy or nginx) in front of the API for TLS (required by `wss://`).

Total recurring cost at zero users: ~$6/mo VPS + ~$0 R2 + ~$0 Vercel.

The render-worker deploy-ordering constraint noted in DECISIONS (2026-06-27): the worker uses
a baked image and hard-fails on unknown schema fields. When the schema changes, rebuild and
push the worker image BEFORE or simultaneously with the API. Never leave the old worker running
against a newer API that writes new schema fields.

---

## 3. CI integration note

The existing `.github/workflows/ci.yml` already builds the web app in Stage 6 (E2E) with
`pnpm --filter @videoforge/web build` passing the three `VITE_*` env vars. The Vercel deploy
step is not yet wired into CI. When a production Vercel project exists, add a Stage 7 deploy
step after the E2E stage using the Vercel CLI (`vercel --prod --token $VERCEL_TOKEN`) triggered
only on `main` branch pushes.

---

## 4. Secret management

The web bundle is public. NEVER put backend secrets (`DATABASE_URL`, `JWT_*`, `S3_SECRET_*`,
`GROQ_API_KEY`) in any `VITE_*` variable. The contract in `.env.example` documents which vars
are server-side only. Vercel environment variables for `VITE_*` values are baked at build time
and visible in the bundle — treat them as public configuration, not secrets.
