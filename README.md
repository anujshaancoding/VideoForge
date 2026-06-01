# VideoForge

**VideoForge** is a browser-based, multi-track video editor whose defensible wedge is one
invariant: **what you cut is what you get.** The export FFmpeg `filter_complex` is generated
from the *exact same* non-destructive project JSON graph that the client preview composites,
so the downloaded MP4 matches the timeline frame-for-frame.

This repository is the **Free-tier MVP / Phase 0**. It is scoped strictly to
[`docs/MVP_Scope.md`](docs/MVP_Scope.md) — build only the `✅` items there.

## Product context (corrected spec / MVP decisions)

- **Free-tier only.** No upgrade CTA anywhere. Exports carry a watermark with an
  informational note only. Plan limits are hard-coded constants, not an entitlements service.
  Stripe is stubbed (`BILLING_MODE=stub`).
- **Chrome / Edge desktop only.** WebCodecs is the single decode path; Safari/Firefox hit a
  browser-gate screen.
- **Dark-theme-first**, pro-NLE feel. The amber "forge ember" accent (`--vf-accent #FF7A1A`)
  is reserved for the single primary CTA (Export) and brand — never for routine selection
  (selection is functional sky-blue). Do not use Canva-style purple.
- **New-Project flow leads with an aspect-ratio chooser** (9:16 / 16:9 / 1:1 / 4:5 / custom)
  with **no pre-selected default** and equal weight.
- All times are integer **milliseconds**; canvas geometry is **percent (0–100)**; track array
  index is **z-order** (video index 0 = bottom). See `docs/VideoForge_Spec_v1.1.md` §18.

## Monorepo layout

pnpm workspaces. Top-level `apps/` and `packages/`.

| Path | Name | Role |
|---|---|---|
| `packages/project-schema` | `@videoforge/project-schema` | `Project` types + JSON Schema + `validate()` (the invariant types). |
| `packages/ffmpeg-graph` | `@videoforge/ffmpeg-graph` | `buildFilterComplex(project)` — pure, headless. Depends on project-schema. |
| `packages/config` | `@videoforge/config` | Shared tsconfig base + Tailwind preset (maps the `--vf-*` design tokens). |
| `apps/web` | `@videoforge/web` | Vite + React 18 + TS editor (Chrome/Edge only). Depends on project-schema. |
| `apps/api` | `@videoforge/api` | Fastify REST + WS stub. Depends on project-schema. |
| `apps/render-worker` | `@videoforge/render-worker` | BullMQ + FFmpeg render stub. Depends on project-schema + ffmpeg-graph. |

Workspace deps use `workspace:*`.

## Quickstart

Prerequisites: Node 20+ (see `engines`), pnpm (`corepack enable`), Docker Desktop running.

```bash
cp .env.example .env        # create your local env file
pnpm install                # install the workspace + build shared packages
docker compose up -d        # postgres:16, redis:7, minio (+ bucket creation)
pnpm dev                    # run the web editor (Vite, http://localhost:5173)
```

Open **http://localhost:5173 in Chrome or Edge** (other browsers see the browser gate).
The MinIO console is at http://localhost:9001 (`minioadmin` / `minioadmin`).

### Root scripts

| Script | Does |
|---|---|
| `pnpm dev` | Runs `@videoforge/web` (Vite dev server). |
| `pnpm build` | `pnpm -r build` across all packages. |
| `pnpm typecheck` | `pnpm -r typecheck` (strict TS, every file must pass). |
| `pnpm test` | `pnpm -r test` (Vitest). |
| `pnpm lint` | `pnpm -r lint`. |
| `pnpm services:up` / `:down` / `:reset` | Start / stop / wipe the docker-compose backing services. |

## What is stubbed in the MVP

Honest, clearly-commented placeholders that still compile and run (marked `// MVP-STUB:`):

- **Preview compositor** draws clip/overlay rectangles + labels via Canvas 2D from the store
  instead of real WebCodecs decode + Web Audio mixing.
- **apps/api** is a Fastify stub of the REST/WS surface; no real Postgres/S3 wiring yet.
- **apps/render-worker** is a BullMQ + FFmpeg stub; it builds the command via
  `@videoforge/ffmpeg-graph` but does not execute real S3/FFmpeg renders.
- **Billing** is stubbed (Free-tier only).

## Documentation

- [`docs/MVP_Scope.md`](docs/MVP_Scope.md) — authoritative scope (build only ✅ items).
- [`docs/Design_Instructions_MVP.md`](docs/Design_Instructions_MVP.md) — design tokens (§2),
  layout (§3), canvas (§5), timeline (§6), panels (§7).
- [`docs/Pipeline.md`](docs/Pipeline.md) — build & delivery pipeline; §2 is the dev env.
- [`docs/VideoForge_Spec_v1.1.md`](docs/VideoForge_Spec_v1.1.md) — §18 data model is the
  source of the types and domain invariants.
