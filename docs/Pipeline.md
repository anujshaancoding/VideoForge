# 🛠️ VideoForge — Build & Delivery Pipeline (MVP / Phase 0)

> How VideoForge gets built, tested, and shipped for the MVP. Five interlocking pipelines: local-dev environment, the runtime media+project data pipeline (import→edit→export), CI/CD + quality gates, the design→code handoff (where your supplied visual design plugs in), and release/ops. Scoped to the MVP defined in [MVP_Scope.md](MVP_Scope.md); section refs (`§n`) point at [VideoForge_Spec_v1.1.md](VideoForge_Spec_v1.1.md).

**Product decisions baked in:** name = **VideoForge** · Free-tier only at launch (Stripe stubbed) · Chrome/Edge desktop only · dev/CI use a local-disk S3 double (MinIO) + a pinned FFmpeg build · the visual design is supplied separately and integrated per §5.

## Contents
1. [Pipeline Overview](#1-pipeline-overview)
2. [Local Development Environment](#2-local-development-environment)
3. [Runtime Data Pipeline (Import → Edit → Export)](#3-runtime-data-pipeline-import--edit--export)
4. [CI/CD & Quality Gates](#4-cicd--quality-gates)
5. [Design → Code Handoff](#5-design--code-handoff-where-the-provided-design-plugs-in)
6. [Release, Environments & Operations](#6-release-environments--operations)
7. [Milestone Delivery Plan (M0–M4)](#7-milestone-delivery-plan-m0m4-across-the-pipelines)

---


---

## 1. Pipeline Overview

This document defines the **Build & Delivery Pipeline** for **VideoForge** at MVP / Phase 0. It is scoped exactly to `docs/MVP_Scope.md` — Free-tier only (Stripe stubbed, plan limits as hard-coded constants per `MVP_Scope.md §3.10 / §6`), Chrome/Edge desktop only, dev/CI on a local-disk S3 double (MinIO) plus a pinned FFmpeg build (`MVP_Scope.md §6`). It does **not** restate the product spec: where a behavior is defined elsewhere, this doc references it — `VideoForge_Spec_v1.1.md` §4 (import), §10 (export), §18 (data model), §20 (observability), §22 (testing/CI), and the milestone/gate contract in `MVP_Scope.md §7`–§8.

The single non-negotiable that this whole pipeline exists to protect is the **fidelity invariant**: the export FFmpeg `filter_complex` is generated from the *same* non-destructive project JSON graph (§18) that the client WebCodecs/Canvas preview renders, so "what you cut is what you get" (`MVP_Scope.md §1`). Every pipeline below is, ultimately, machinery to keep that invariant green and to get a logged-in creator from import to a matching downloaded MP4.

### 1.1 The five pipelines

This document defines five interlocking pipelines. They are layered: each one feeds or gates the next, and the runtime pipeline (#2) is what the other four exist to ship safely.

| # | Pipeline | What it covers | Owns / produces | Doc section |
|---|---|---|---|---|
| 1 | **Local-dev environment** | One-command bring-up of the full stack on a laptop: Postgres, Redis, MinIO (the local-disk S3 double), the FFmpeg worker container (pinned build), Fastify API, Vite frontend; seeded from `fixtures/manifest.json`. | A reproducible `docker compose` + `.env` contract that matches prod shapes (asset IDs, signed-URL shape) per §22.6. | §2 |
| 2 | **Runtime media + project-data pipeline** | The product's hot path: import → proxy/thumbnail/waveform jobs → `asset:ready`; project JSON save/load/validate; preview compositing; export job → FFmpeg worker → S3 output → 7-day download. | The running system. This is the thing being built. | §3 |
| 3 | **CI/CD + quality gates** | Staged fast-to-slow CI (§22.7 stages 1–6 = merge gate), the golden-frame SSIM/PSNR + audio-RMS harness (§22.3–22.4), and the playback/export perf gates (§22.5 / `MVP_Scope.md §8`). Build, image publish, deploy. | Merge-blocking verdicts; published, tagged artifacts; deploys to environments. | §4 |
| 4 | **Design → code handoff** | How a **separately-provided visual design** (tokens + screens — supplied by the user) is converted into shippable frontend code, and the **visual review gate** that admits it. | Design tokens, component contracts, a visual-regression baseline. | §5 |
| 5 | **Release / ops** | Cutting a release, promoting an image through environments, the Free-tier ops surface (export rate-limit, watermark verification, 7-day download lifecycle), observability wiring (§20 minimal subset), rollback. | Tagged releases, runbooks, the TTFE/fidelity funnel dashboards (`MVP_Scope.md §1`). | §6 |

### 1.2 How they interlock

The five pipelines form a single supply chain from a developer's edit to a creator's downloaded MP4. Nothing reaches an environment that did not pass the merge gate; no frontend pixels reach `main` without clearing the visual review gate; the runtime pipeline is the artifact the other four protect, build, verify, and operate.

```mermaid
flowchart TB
    subgraph SRC["Source"]
        REPO["Monorepo: /web /api /worker /packages/schema /fixtures (Git LFS)"]
        DESIGN["User-provided visual design<br/>(tokens JSON + screen specs)"]
    end

    subgraph P4["④ Design → code handoff (§5)"]
        TOKENS["tokens.css / tailwind theme"]
        COMPONENTS["React components vs. design"]
        VISGATE{{"Visual review gate<br/>Playwright visual-regression<br/>+ human design sign-off"}}
        DESIGN --> TOKENS --> COMPONENTS --> VISGATE
    end

    subgraph P1["① Local-dev (§2)"]
        COMPOSE["docker compose up<br/>pg · redis · minio · ffmpeg-worker(pinned) · api · web"]
        SEED["seed from fixtures/manifest.json"]
        COMPOSE --> SEED
    end

    subgraph P3["③ CI/CD + quality gates (§4)"]
        G1["1 Static: tsc · lint · audit"]
        G2["2 Unit + Component"]
        G3["3 Integration: schema · WebGL→2D · export-cmd builder · OfflineAudioContext"]
        G4["4 e2e PR subset (Chromium)"]
        G5["5 Golden-frame SSIM/PSNR (FIDELITY)"]
        G6["6 Perf gates: playback + export"]
        G1 --> G2 --> G3 --> G4 --> G5 --> G6
    end

    subgraph ENV["Environments (§6)"]
        PREVIEW["PR preview env (ephemeral)"]
        STAGING["staging"]
        PROD["production (Free-tier only)"]
    end

    REPO --> COMPOSE
    VISGATE --> REPO
    REPO --> G1
    COMPOSE -. "same images & seed as CI" .- G3
    G6 -->|merge gate green| IMG["build & tag images:<br/>web · api · worker"]
    IMG --> PREVIEW --> STAGING -->|release tag| PROD

    PROD --> RUNTIME

    subgraph RUNTIME["② Runtime hot path (§3)"]
        direction LR
        IMPORT["Import → presign(md5) → S3/MinIO → BullMQ proxy/thumb/waveform → asset:ready"]
        EDIT["Project JSON (§18) ⇄ Ajv validate ⇄ save/undo · WebCodecs+Canvas preview"]
        EXPORT["Export → BullMQ render → FFmpeg worker (filter_complex from SAME JSON) → S3 → 7-day download"]
        IMPORT --> EDIT --> EXPORT
    end
```

**Reading the diagram:**

- **① feeds ③.** The local-dev compose stack uses the *same* worker image, the *same* pinned FFmpeg build, and the *same* `fixtures/manifest.json` seed that CI integration/golden stages use (§22.6 "Backend seed"). A golden frame that passes on a laptop passes in CI by construction — that is the point of the MinIO/pinned-FFmpeg decision.
- **③ gates everything into environments.** The merge gate is §22.7 stages 1–6 green. Only then do we build and tag the three images (`web`, `api`, `worker`) and promote them PR-preview → staging → prod. The fidelity gate (stage 5) and perf gates (stage 6) are the literal CI encoding of the `MVP_Scope.md §1` north-star metric.
- **④ joins the source.** The user-supplied design becomes tokens + components, and those PRs are admitted only after the **visual review gate** (Playwright visual-regression baseline + a human design sign-off label). Design changes therefore enter the same merge gate as any other code — there is no side door to `main`.
- **② is the payload.** Production runs the runtime hot path. Section 3 details it; the request-path-at-a-glance is below.

### 1.3 Runtime request path at a glance

Two flows matter at runtime, both rooted in the §18 project JSON. The first turns uploaded bytes into a usable, proxy-backed clip (§4.2). The second turns the edited timeline into a matching MP4 (§10.2–§10.3). They share one source of truth: the validated project document.

```mermaid
sequenceDiagram
    autonumber
    participant U as Browser (Chrome/Edge)
    participant API as Fastify /api/v1
    participant S3 as S3 / MinIO
    participant Q as BullMQ (Redis)
    participant W as FFmpeg worker (pinned)
    participant DB as Postgres

    Note over U,DB: Import (§4.2) — md5 dedupe folded into presign
    U->>API: POST /assets/presign {filename,size,contentType,md5Hash}
    API->>DB: workspace-scoped md5 lookup
    alt hash hit
        API-->>U: { existingAssetId }  (client skips upload)
    else new
        API-->>U: { assetId, uploadUrl, expiresAt }
        U->>S3: multipart PUT (10MB chunks, parallel, resumable)
        U->>API: POST /assets/:id/confirm
        API->>Q: enqueue proxy(720p+Low) · thumbnail-sprite · waveform
        Q->>W: jobs
        W->>S3: write proxy renditions + sprite + peaks (original kept immutable)
        W-->>API: done
        API-->>U: WS asset:ready (renditions map) → clip PROCESSING→READY
    end

    Note over U,DB: Edit (§18) — same JSON the export will read
    U->>U: WebCodecs decode → Canvas 2D composite, AudioContext master clock
    U->>API: PATCH /projects/:id (full doc + revision); Ajv-validated before persist
    API->>DB: store project JSONB, bump server revision

    Note over U,DB: Export (§10.2/§10.3) — filter_complex from the SAME JSON
    U->>API: POST /exports (frontend clamps ≤1080p; pre-flight estimate)
    API->>DB: export record QUEUED
    API->>Q: enqueue render
    Q->>W: render job (project JSON)
    W->>S3: fetch ORIGINAL (not proxy) when present+readable
    W->>W: build filter_complex: -ss/-to trims · bottom-up overlay · amix=normalize=0 + alimiter · mute/solo gate · Free watermark
    W->>S3: upload exports/<id>.mp4
    W-->>API: COMPLETE
    API-->>U: WS progress → done; download mints fresh 1h signed URL (7-day window)
```

The single most important fact in this whole document: in the export flow, step "build filter_complex" reads the **identical** project JSON that the preview composited in the Edit phase. The golden-frame gate (§4 of this doc, §22.3 of the spec) proves they agree before any of this reaches production.

### 1.4 Where the user-provided visual design enters

The visual design is supplied **separately** by the user as two artifacts: a **design-token set** (color, type scale, spacing, radii, elevation, motion) and **screen specs** (the three-zone editor shell, export modal, dashboard, empty-state onboarding, browser-gate — `MVP_Scope.md §3.11`). It plugs into exactly one pipeline (#4) at exactly two seams, and it is admitted through exactly one gate. The design **never** touches the runtime media/export path (#2) — by the fidelity invariant, the export is driven by the §18 JSON, not by any visual styling. Stated explicitly so the handoff is unambiguous:

```mermaid
flowchart LR
    DZ["User-provided design<br/>tokens + screens"]
    subgraph SEAM1["Seam A — tokens"]
        T["/web/src/styles/tokens.css<br/>(CSS vars) + Tailwind theme"]
    end
    subgraph SEAM2["Seam B — screens"]
        C["React components implement<br/>the 9:16 editor shell & modals<br/>(MVP_Scope §3.11)"]
    end
    GATE{{"Visual review gate<br/>(Playwright visual-regression baseline<br/>+ human design sign-off label)"}}
    MERGE["merge gate (§22.7 1–6)"]
    FE["Frontend (read-only consumer of §18 JSON)"]
    DZ --> T --> C --> GATE --> MERGE --> FE
    FE -. "DOES NOT influence" .-x EXPORT["Export filter_complex (§10.3)"]
```

- **Seam A (tokens → CSS variables / Tailwind theme).** Design tokens land as `web/src/styles/tokens.css` (CSS custom properties) and the Tailwind theme. No component hard-codes a hex value; everything references a token. This is the swap point — re-skinning is "replace tokens, re-baseline visual regression," not a rewrite.
- **Seam B (screens → React components).** Screen specs map 1:1 to the components implementing the `MVP_Scope.md §3.11` shell: three-zone editor (left media panel, center 9:16 canvas + transport, bottom timeline, right properties/caption panel), the export modal (§10.1), the dashboard, the empty-state onboarding funnel (drives TTFE), and the Chrome/Edge browser gate.
- **The gate (visual review).** A design-touching PR is merge-eligible only when (a) Playwright visual-regression snapshots match the approved baseline (or the baseline is updated with the reviewer's explicit approval label, mirroring the golden-frame baseline rule in §22.7), and (b) a human applies the `design-approved` label. Visual baselines are versioned like golden frames; updating one is a reviewed act because it moves the thing the gate measures.

The clean separation matters: because the design lives entirely in #4 and the runtime export path (#2) reads only the §18 JSON, the supplied design can be plugged in — or completely changed — without any risk to the fidelity invariant. Section 5 specifies the file paths, the token contract, and the gate mechanics in full.

### 1.5 How to read the rest of this document

The remaining sections follow the five pipelines, sequenced the way you will actually use them — stand up the environment, understand the runtime it serves, then the gates that protect it, the design handoff that fills in the surface, and finally how it ships and is operated.

| Section | Pipeline | You are here if you want to… | Anchored in |
|---|---|---|---|
| §2 Local-dev environment | ① | Bring the whole stack up on your laptop; know the env vars, ports, `docker compose` services, MinIO buckets, and the fixture seed. | `MVP_Scope.md §6`; §22.6 |
| §3 Runtime media + project-data pipeline | ② | Trace import, proxy jobs, project save/validate, preview, and export through the real services and queues. | §4.2, §18, §10.2–§10.3 |
| §4 CI/CD + quality gates | ③ | Understand the staged CI, the golden-frame + audio + perf gates, what blocks merge, and how images are built/tagged. | §22.3–§22.7; `MVP_Scope.md §7`–§8 |
| §5 Design → code handoff | ④ | Plug the user-supplied tokens + screens into the frontend and pass the visual review gate. | `MVP_Scope.md §3.11`; §2.1–§2.2 |
| §6 Release / ops | ⑤ | Cut and promote a release, wire the §20 minimal observability + TTFE/fidelity funnel, operate Free-tier limits/watermark/download lifecycle, and roll back. | §10.2, §17.4, §20; `MVP_Scope.md §9` |

**Conventions used throughout this doc:** commands assume a TypeScript monorepo with `pnpm` workspaces (`/web` React+Vite, `/api` Node+Fastify, `/worker` containerized FFmpeg, `/packages/schema` the §18 JSON Schema + types, `/fixtures` Git-LFS media). `§n` without a doc prefix refers to `VideoForge_Spec_v1.1.md`; `MVP_Scope.md §n` refers to the scope contract. Anything not in scope here is out of MVP by the explicit boundary in `MVP_Scope.md §4` — not by omission.


---

## 2. Local Development Environment

> **Scope:** MVP / Phase 0 only (see `MVP_Scope.md` §6 tech stack, §7 milestones M0–M4, §8 perf/fidelity gates). This section defines the repository, the local service topology, and the scripts a new engineer runs to get from `git clone` to a green fidelity gate. It does **not** cover cloud/CI infra (later sections) beyond noting where the local setup is deliberately CI-faithful.
>
> **Three product decisions are load-bearing here and appear throughout:**
> 1. **Free-tier only at launch** — Stripe is stubbed; plan limits are *hard-coded constants*, not an entitlements service (`MVP_Scope.md` §3.10). There is no `packages/billing`.
> 2. **Chrome/Edge desktop only** — WebCodecs is the single decode path; the dev server gates other browsers rather than shipping a fallback.
> 3. **Dev/CI uses a local-disk S3 double (MinIO) and a pinned FFmpeg build** — the same artifacts CI uses, so "works on my machine" and "passes the golden-frame gate" mean the same thing (`MVP_Scope.md` §6, spec §22.6 "Backend seed").

---

### 2.1 Why a monorepo, and why these packages

The MVP's entire defensible wedge is one invariant (`MVP_Scope.md` §1): **the export FFmpeg `filter_complex` is generated from the exact same project JSON graph the client preview renders.** That invariant is only true if the *same code* that produces the preview also produces the export. A polyrepo would let the schema and the graph-builder drift between three deployables; a single pnpm workspace makes drift a compile error.

We use a **pnpm workspace monorepo** (pnpm for content-addressed, hard-linked `node_modules` — fast installs and a single lockfile across all packages). Two packages — `project-schema` and `ffmpeg-graph` — are the literal encoding of the fidelity invariant and are imported by **all three** deployables.

```mermaid
flowchart TD
  subgraph apps["apps/ (deployables)"]
    web["apps/web<br/>React + Vite<br/>(WebCodecs preview)"]
    api["apps/api<br/>Node + Fastify<br/>(REST + WS)"]
    worker["apps/render-worker<br/>BullMQ consumer<br/>(containerized FFmpeg)"]
  end
  subgraph pkgs["packages/ (shared libraries)"]
    schema["packages/project-schema<br/>types + JSON Schema + validate()"]
    graph["packages/ffmpeg-graph<br/>buildFilterComplex(project)"]
    ui["packages/ui<br/>design-system components"]
    cfg["packages/config<br/>tsconfig / eslint / plan limits / env"]
  end

  web -->|imports| schema
  web -->|preview composite mirrors| graph
  web -->|imports| ui
  api -->|validates saves with| schema
  api -->|imports| cfg
  worker -->|validates job input with| schema
  worker -->|generates command with| graph
  worker -->|imports| cfg
  web -->|imports| cfg
  ui -->|imports| cfg

  classDef invariant fill:#fde68a,stroke:#b45309,stroke-width:2px;
  class schema,graph invariant;
```

The two highlighted packages are the invariant. Everything else exists to make them easy to build and test.

#### Package responsibilities

| Path | Type | Owns | Consumed by | Why it lives where it does |
|---|---|---|---|---|
| `apps/web` | Deployable (Vite) | The editor UI, WebCodecs→Canvas2D preview compositor, WebGL color-grade pass, Web Audio mix, Zustand+Immer store, undo/redo, browser gate. | — | The only thing that talks to the browser GPU/decoder. Chrome/Edge-only. |
| `apps/api` | Deployable (Fastify) | REST `/api/v1/*`, WebSocket (`asset:ready`, export progress), JWT/refresh + Google OAuth, presigned-URL minting, project save/validate, BullMQ producer, Postgres access. | — | The single server-owned source of `revision` and schema validation on every save (spec §18.3, §18.4). |
| `apps/render-worker` | Deployable (container) | BullMQ consumer for the `render` queue + the `proxy`/`thumbnail`/`waveform` import jobs; shells out to the **pinned FFmpeg**; pulls originals from S3, runs the `filter_complex`, uploads output. | — | The FFmpeg parity surface. Must be containerized so dev == CI == prod encoder (spec §22.3 pinned build). |
| `packages/project-schema` | Shared lib | The TypeScript `Project` types, the draft-2020-12 JSON Schema, and a single `validate(project)` function (Ajv). The `schemaVersion` constant. | **web + api + worker** | A malformed graph must never reach preview *or* export. Validation lives in one place so all three reject the same documents identically (spec §18.4; `MVP_Scope.md` §3.9). |
| `packages/ffmpeg-graph` | Shared lib | `buildFilterComplex(project, opts)` → the FFmpeg arg vector + filtergraph string. Pure, headless, no I/O, no `child_process`. | **worker (executes) + web (mirrors)** | This is *the bet*. Built first as a headless unit at M0 (`MVP_Scope.md` §7 M0, spec §10.3). The worker runs its output; the preview compositor and golden tests assert against it — so preview and export agree **by construction**. |
| `packages/ui` | Shared lib | The design-system component layer: primitives, tokens, layout shells, themed controls. **This is the seam the externally-supplied visual design plugs into — see §2.7.** | web | Keeps presentational components separable from editor logic so a design drop is a `packages/ui` change, not an `apps/web` rewrite. |
| `packages/config` | Shared lib | Shared `tsconfig` bases, ESLint/Prettier config, the **hard-coded Free-tier plan limits** (3 video / 2 audio / 2 overlay / 1 caption tracks, 10-min duration, 1080p cap, watermark), and typed env loaders. | all | Plan limits are constants the editor *and* export read (`MVP_Scope.md` §3.10) — not an entitlements DB. Putting them here guarantees the clamp the UI shows and the clamp the worker enforces are the same number. |

> **The invariant, restated for reviewers:** if you change how a clip's `trimIn`/`trimOut` maps to FFmpeg `-ss`/`-to`, you change `packages/ffmpeg-graph`, and the golden-frame gate (`pnpm test:golden`) re-asserts that preview still equals export across the whole fixture matrix. There is no second copy of that mapping to forget to update.

---

### 2.2 Repository layout

```text
videoforge/
├─ apps/
│  ├─ web/                      # React + Vite editor (Chrome/Edge only)
│  │  ├─ src/
│  │  ├─ index.html
│  │  ├─ vite.config.ts
│  │  └─ package.json
│  ├─ api/                      # Fastify REST + WebSocket
│  │  ├─ src/
│  │  │  ├─ routes/             # /api/v1/projects, /assets, /exports, /auth
│  │  │  ├─ ws/                 # asset:ready, export progress
│  │  │  ├─ queues/             # BullMQ producers
│  │  │  └─ db/                 # Postgres (project JSONB, assets, users, exports)
│  │  └─ package.json
│  └─ render-worker/            # BullMQ consumer + containerized FFmpeg
│     ├─ src/
│     │  ├─ jobs/render.ts      # uses packages/ffmpeg-graph
│     │  ├─ jobs/proxy.ts       # 720p base + quarter-res Low (spec §4.2)
│     │  ├─ jobs/thumbnail.ts   # 160×90 WebP sprite sheet
│     │  └─ jobs/waveform.ts
│     ├─ Dockerfile             # pins FFmpeg (see §2.6)
│     └─ package.json
├─ packages/
│  ├─ project-schema/           # types + JSON Schema + validate()  ← INVARIANT
│  ├─ ffmpeg-graph/             # buildFilterComplex()              ← INVARIANT
│  ├─ ui/                       # design system  ← visual-design plug-in seam (§2.7)
│  └─ config/                   # tsconfig/eslint bases, plan limits, env loaders
├─ fixtures/
│  ├─ media/                    # CC0 source clips, Git LFS (spec §22.6)
│  ├─ golden/                   # golden frames + audio buffers, keyed by MD5+encoder
│  └─ manifest.json             # MD5/duration/codec/license per fixture; seeds MinIO+DB
├─ infra/
│  ├─ docker-compose.yml        # postgres, redis, minio, render-worker (§2.4)
│  ├─ minio/seed.ts             # uploads fixtures/media → MinIO bucket
│  └─ db/seed.ts                # inserts asset/user rows from fixtures/manifest.json
├─ scripts/
│  ├─ dev.ts                    # orchestrates web + api + worker (§2.5)
│  └─ check-ffmpeg.ts           # asserts the pinned FFmpeg version
├─ .env.example                 # documented; copied to .env on first run (§2.3)
├─ .nvmrc                       # Node version pin
├─ pnpm-workspace.yaml
├─ package.json                 # root scripts (pnpm -r delegation)
├─ turbo.json                   # task graph / caching (optional, recommended)
└─ Makefile                     # thin human-friendly aliases over pnpm (§2.5)
```

`pnpm-workspace.yaml` declares the two globs:

```yaml
packages:
  - "apps/*"
  - "packages/*"
```

---

### 2.3 Environment variables (`.env.example`)

A single root `.env` is loaded by `apps/api`, `apps/render-worker`, and the seed scripts; `apps/web` reads only `VITE_`-prefixed vars (Vite exposes nothing else to the browser). Commit `.env.example`; **never** commit `.env`. Typed loaders live in `packages/config`.

```bash
# ───────────────────────── .env.example ─────────────────────────
# Copy to .env for first run:  cp .env.example .env   (or: make env)

# ── Node / runtime ──
NODE_ENV=development

# ── Postgres (project JSONB, assets, users, exports) ──
POSTGRES_HOST=localhost
POSTGRES_PORT=5432
POSTGRES_DB=videoforge
POSTGRES_USER=videoforge
POSTGRES_PASSWORD=videoforge_dev
DATABASE_URL=postgresql://videoforge:videoforge_dev@localhost:5432/videoforge

# ── Redis (BullMQ render + proxy/thumbnail/waveform queues) ──
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_URL=redis://localhost:6379

# ── S3 double: MinIO (local-disk S3, dev/CI only) ──
# In prod these point at real S3; in dev they point at the compose MinIO.
S3_ENDPOINT=http://localhost:9000
S3_REGION=us-east-1
S3_ACCESS_KEY_ID=minioadmin
S3_SECRET_ACCESS_KEY=minioadmin
S3_FORCE_PATH_STYLE=true            # required for MinIO
S3_BUCKET_ORIGINALS=vf-originals    # immutable source assets (spec §4.2)
S3_BUCKET_PROXIES=vf-proxies        # 720p + quarter-res renditions, sprites, waveforms
S3_BUCKET_EXPORTS=vf-exports        # rendered MP4s (7-day download window)

# ── API server ──
API_HOST=0.0.0.0
API_PORT=4000
API_PUBLIC_URL=http://localhost:4000
WS_PATH=/ws

# ── Auth (JWT access 15m + rotating refresh httpOnly cookie) ──
JWT_ACCESS_SECRET=dev_access_secret_change_me
JWT_REFRESH_SECRET=dev_refresh_secret_change_me
JWT_ACCESS_TTL=900                  # 15 minutes (seconds)
JWT_REFRESH_TTL=2592000             # 30 days (seconds)
GOOGLE_OAUTH_CLIENT_ID=             # dev OAuth client; blank disables the Google button
GOOGLE_OAUTH_CLIENT_SECRET=
GOOGLE_OAUTH_REDIRECT_URI=http://localhost:4000/api/v1/auth/google/callback

# ── Billing: STUBBED for MVP (Free-tier only). Do NOT wire Stripe. ──
BILLING_MODE=stub                   # 'stub' is the only supported value in Phase 0

# ── Render worker / FFmpeg (pinned build — see §2.6) ──
FFMPEG_PATH=/usr/local/bin/ffmpeg
FFPROBE_PATH=/usr/local/bin/ffprobe
FFMPEG_PINNED_VERSION=6.1.1         # asserted by scripts/check-ffmpeg.ts & CI
RENDER_CONCURRENCY=1                # one worker pool in MVP (no autoscale)
FFMPEG_THREADS=0                    # -threads 0 on ≥4 vCPU (MVP_Scope §6)
EXPORT_RATE_LIMIT_PER_MIN=5         # per-user export rate limit (spec §17.4)

# ── Observability (minimal in MVP: Sentry + funnel events; spec §20.1/§20.4) ──
SENTRY_DSN=                         # blank in local dev (no-op)
OTEL_EXPORTER_OTLP_ENDPOINT=        # blank in local dev

# ── Frontend (only VITE_-prefixed vars reach the browser bundle) ──
VITE_API_BASE_URL=http://localhost:4000/api/v1
VITE_WS_URL=ws://localhost:4000/ws
VITE_SENTRY_DSN=
VITE_PLAN=free                      # hard-coded Free tier; gates UI controls
```

| Var group | Read by | Notes |
|---|---|---|
| `POSTGRES_*` / `DATABASE_URL` | api, seed | Project stored as `JSONB`; assets/users/exports as rows with row-level `workspaceId` (`MVP_Scope.md` §6). |
| `REDIS_*` | api (producer), render-worker (consumer) | One `render` queue + `proxy`/`thumbnail`/`waveform` jobs (`MVP_Scope.md` §6). |
| `S3_*` | api, render-worker, seed | Point at MinIO in dev; `S3_FORCE_PATH_STYLE=true` is mandatory for MinIO. Three buckets mirror the prod prefixes (originals/proxies/exports). |
| `JWT_*`, `GOOGLE_OAUTH_*` | api | Google OAuth optional locally; a blank client id hides the button (email/password still works). |
| `BILLING_MODE=stub` | api | Hard fail if anything tries to reach Stripe — Free-tier only is a *scope* boundary, enforced. |
| `FFMPEG_*`, `RENDER_*`, `EXPORT_RATE_LIMIT_PER_MIN` | render-worker | Pinned version asserted on boot; concurrency 1 (single pool, no k8s). |
| `VITE_*` | web | Only these reach the browser. `VITE_PLAN=free` drives the hard-coded limit display + browser gate. |

---

### 2.4 `docker-compose.yml` (backing services + worker)

`infra/docker-compose.yml` runs the four backing services so an engineer never installs Postgres/Redis/MinIO/FFmpeg by hand. `apps/web` and `apps/api` normally run on the host (fast HMR / debugger attach); the **render-worker runs in a container** because it must match the pinned FFmpeg exactly — the same image CI uses for the golden-frame gate. (You can also run api in-container; the host default keeps the inner dev loop fast.)

```yaml
# infra/docker-compose.yml
name: videoforge-dev

services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: ${POSTGRES_DB:-videoforge}
      POSTGRES_USER: ${POSTGRES_USER:-videoforge}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-videoforge_dev}
    ports: ["5432:5432"]
    volumes: ["pgdata:/var/lib/postgresql/data"]
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${POSTGRES_USER:-videoforge}"]
      interval: 5s
      timeout: 3s
      retries: 10

  redis:
    image: redis:7-alpine
    command: ["redis-server", "--appendonly", "yes"]
    ports: ["6379:6379"]
    volumes: ["redisdata:/data"]
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 3s
      retries: 10

  # Local-disk S3 double. The ONLY storage backend in dev/CI (MVP_Scope §6).
  minio:
    image: minio/minio:latest
    command: ["server", "/data", "--console-address", ":9001"]
    environment:
      MINIO_ROOT_USER: ${S3_ACCESS_KEY_ID:-minioadmin}
      MINIO_ROOT_PASSWORD: ${S3_SECRET_ACCESS_KEY:-minioadmin}
    ports:
      - "9000:9000"   # S3 API
      - "9001:9001"   # web console
    volumes: ["miniodata:/data"]
    healthcheck:
      test: ["CMD", "mc", "ready", "local"]
      interval: 5s
      timeout: 3s
      retries: 10

  # Creates the three buckets once MinIO is healthy, then exits.
  minio-init:
    image: minio/mc:latest
    depends_on:
      minio: { condition: service_healthy }
    entrypoint: >
      /bin/sh -c "
      mc alias set local http://minio:9000 ${S3_ACCESS_KEY_ID:-minioadmin} ${S3_SECRET_ACCESS_KEY:-minioadmin};
      mc mb -p local/${S3_BUCKET_ORIGINALS:-vf-originals};
      mc mb -p local/${S3_BUCKET_PROXIES:-vf-proxies};
      mc mb -p local/${S3_BUCKET_EXPORTS:-vf-exports};
      exit 0;
      "

  # Containerized so dev FFmpeg == CI FFmpeg == golden-frame encoder (spec §22.3).
  render-worker:
    build:
      context: ..
      dockerfile: apps/render-worker/Dockerfile   # pins FFmpeg (§2.6)
    env_file: ["../.env"]
    environment:
      # Override host-localhost values with the compose service DNS names:
      REDIS_URL: redis://redis:6379
      DATABASE_URL: postgresql://${POSTGRES_USER:-videoforge}:${POSTGRES_PASSWORD:-videoforge_dev}@postgres:5432/${POSTGRES_DB:-videoforge}
      S3_ENDPOINT: http://minio:9000
    depends_on:
      postgres: { condition: service_healthy }
      redis: { condition: service_healthy }
      minio: { condition: service_healthy }
    # Mount the source for hot-reload during dev; the image still owns FFmpeg.
    volumes:
      - ../apps/render-worker/src:/app/apps/render-worker/src

volumes:
  pgdata:
  redisdata:
  miniodata:
```

| Service | Image | Host port | Role in MVP |
|---|---|---|---|
| `postgres` | `postgres:16-alpine` | 5432 | Project `JSONB`; assets/users/exports rows (`MVP_Scope.md` §6). |
| `redis` | `redis:7-alpine` | 6379 | BullMQ `render` queue + proxy/thumbnail/waveform jobs; export rate-limit sliding window. |
| `minio` | `minio/minio` | 9000 (API), 9001 (console) | S3 double — originals (immutable), proxies, exports. |
| `minio-init` | `minio/mc` | — | One-shot: creates the three buckets, then exits. |
| `render-worker` | built from `apps/render-worker/Dockerfile` | — | Pinned-FFmpeg BullMQ consumer; the parity surface. |

> **Why MinIO and not real S3 in dev:** the e2e/integration backend seeds its DB and a local S3 double from `fixtures/manifest.json` so asset IDs and signed-URL shapes match production without touching cloud storage (spec §22.6 "Backend seed"). Same reasoning for local dev — presign, upload, proxy, and re-link all exercise the real code path.

---

### 2.5 Scripts: install, seed, run

Root `package.json` exposes pnpm scripts; the `Makefile` is a thin, discoverable alias layer over them (engineers can use either). All scripts assume the workspace root as cwd.

#### Root `package.json` scripts

```jsonc
{
  "scripts": {
    "install:all": "pnpm install",
    "build:packages": "pnpm -r --filter \"./packages/*\" build",
    "services:up": "docker compose -f infra/docker-compose.yml up -d --wait",
    "services:down": "docker compose -f infra/docker-compose.yml down",
    "services:reset": "docker compose -f infra/docker-compose.yml down -v",

    "db:migrate": "pnpm --filter @videoforge/api db:migrate",
    "seed": "pnpm seed:storage && pnpm seed:db",
    "seed:storage": "tsx infra/minio/seed.ts",      // fixtures/media -> MinIO
    "seed:db": "tsx infra/db/seed.ts",              // fixtures/manifest.json -> Postgres rows

    "check:ffmpeg": "tsx scripts/check-ffmpeg.ts",  // asserts FFMPEG_PINNED_VERSION

    "dev": "tsx scripts/dev.ts",                    // web + api + worker (concurrently)
    "dev:web": "pnpm --filter @videoforge/web dev",
    "dev:api": "pnpm --filter @videoforge/api dev",
    "dev:worker": "docker compose -f infra/docker-compose.yml up render-worker",

    "lint": "pnpm -r lint",
    "typecheck": "pnpm -r typecheck",
    "test": "pnpm -r test",
    "test:golden": "pnpm --filter @videoforge/render-worker test:golden"  // fidelity gate
  }
}
```

#### `Makefile` aliases

```makefile
# Makefile — human-friendly aliases over pnpm
.PHONY: env install services seed dev down reset golden check-ffmpeg

env:            ## create .env from the example on first run
	@test -f .env || cp .env.example .env

install: env    ## install deps + build shared packages
	pnpm install
	pnpm build:packages

services:       ## start postgres, redis, minio, worker (waits for health)
	pnpm services:up

seed: services  ## load CC0 fixtures into MinIO + asset/user rows into Postgres
	pnpm db:migrate
	pnpm seed

dev:            ## run web + api + render-worker together
	pnpm dev

golden:         ## run the golden-frame fidelity gate locally (MVP_Scope §1 north-star)
	pnpm test:golden

check-ffmpeg:   ## verify the pinned FFmpeg build is the one CI uses
	pnpm check:ffmpeg

down:           ## stop services (keep volumes/data)
	pnpm services:down

reset:          ## stop + DELETE all local data (postgres/redis/minio volumes)
	pnpm services:reset
```

| Task | Command | What it does |
|---|---|---|
| Install | `make install` (or `pnpm install`) | Installs the workspace, builds `packages/*` so apps can import compiled types. |
| Start services | `make services` | `docker compose up -d --wait` — blocks until Postgres/Redis/MinIO healthchecks pass and the three buckets exist. |
| Migrate + seed | `make seed` | Runs DB migrations, uploads `fixtures/media/*` into MinIO, inserts asset/user rows from `fixtures/manifest.json` (CC0, Git LFS — spec §22.6). |
| Run everything | `make dev` | Launches `apps/web` (Vite, port 5173), `apps/api` (Fastify, port 4000), and the containerized `render-worker` concurrently with combined logs. |
| Fidelity gate | `make golden` | Exports the fixture matrix through `packages/ffmpeg-graph` + pinned FFmpeg and asserts SSIM ≥ 0.985 / PSNR ≥ 38 dB (`MVP_Scope.md` §1, §8; spec §22.3). The same gate CI runs (spec §22.7 stage 5). |
| Verify encoder | `make check-ffmpeg` | Compares the local `ffmpeg -version` against `FFMPEG_PINNED_VERSION`; fails loudly on mismatch (see §2.6). |

> **Fixtures need Git LFS.** `fixtures/media/` and `fixtures/golden/` are tracked with Git LFS (spec §22.6). Run `git lfs install` once before cloning, or `git lfs pull` after, or the binaries arrive as pointer files and seeding/golden tests fail with confusing decode errors.

---

### 2.6 Pinned FFmpeg

The golden-frame gate is only meaningful if the encoder is deterministic across machines. **The exact FFmpeg version + build flags are pinned and recorded in the fixture lockfile; an encoder upgrade is a deliberate, reviewed golden-update, never an incidental diff** (spec §22.3; `MVP_Scope.md` §6 "pinned build").

- **MVP pinned build: FFmpeg `6.1.1`** (`FFMPEG_PINNED_VERSION` in `.env`). The render-worker `Dockerfile` installs exactly this build with x264 enabled; the same image is used in dev, in `make golden`, and in CI's deterministic-render stage.
- The worker asserts the pin **on boot** and `make check-ffmpeg` asserts it on demand. A version mismatch aborts rather than silently producing frames that disagree with the committed goldens.
- Golden frames and audio buffers are keyed by **fixture MD5 + pinned-encoder version** (spec §22.6), so a golden is unambiguously tied to the input and the encoder build that produced it. Bumping FFmpeg therefore *requires* regenerating goldens via the reviewed `pnpm test:golden --update` path — which is gated behind a reviewer label in CI (spec §22.7).

```dockerfile
# apps/render-worker/Dockerfile (excerpt — the pin is the point)
FROM node:20-bookworm-slim AS base
ARG FFMPEG_VERSION=6.1.1
# Install the EXACT pinned static build (x264). Recorded in the fixture lockfile.
RUN curl -fsSL "https://.../ffmpeg-${FFMPEG_VERSION}-amd64-static.tar.xz" -o /tmp/ff.tar.xz \
 && tar -xJf /tmp/ff.tar.xz -C /usr/local/bin --strip-components=1 \
      "ffmpeg-${FFMPEG_VERSION}-amd64-static/ffmpeg" \
      "ffmpeg-${FFMPEG_VERSION}-amd64-static/ffprobe" \
 && /usr/local/bin/ffmpeg -version | grep -q "${FFMPEG_VERSION}"   # fail build on mismatch
```

> Engineers who need FFmpeg on the host (e.g. running `apps/render-worker` outside Docker) must install the same `6.1.1` build and point `FFMPEG_PATH`/`FFPROBE_PATH` at it. The containerized worker is the supported path precisely so this is rarely necessary.

---

### 2.7 Design → code handoff seam

A separately-provided visual design will be supplied later. The repo is structured so plugging it in is a contained change, not a rewrite:

| Concern | Where it lives | Handoff rule |
|---|---|---|
| Design tokens (color, type scale, spacing, radii, elevation) | `packages/ui/src/tokens/` | The design ships as a token set (e.g. exported JSON/CSS variables). It lands here; nothing in `apps/*` hardcodes a hex value or px gap — they reference tokens. |
| Reusable components (buttons, panels, sliders, modals, the export-modal shell) | `packages/ui/src/components/` | Presentational only — no editor state, no API calls. `apps/web` composes these; the design replaces their internals without touching editor logic. |
| Editor layout shells (three-zone grid: left media · center 9:16 canvas+transport · bottom timeline · right properties/caption) | `packages/ui` shells consumed by `apps/web` | The layout structure (`MVP_Scope.md` §3.11) is fixed by the spec; the design themes it. The 9:16 canvas frame is a slot the compositor renders into. |
| Behavior / state (WebCodecs preview, timeline ops, Web Audio mix, undo/redo) | `apps/web/src/` | Never moves into `packages/ui`. Keeps the design layer swappable without risking the fidelity-critical preview code. |

**Rule of thumb for the handoff:** the visual design changes `packages/ui` (tokens + component internals + themed shells). It does **not** change `apps/web` behavior, `packages/ffmpeg-graph`, or `packages/project-schema`. If a design request would require touching the latter, it is a product/scope change, not a restyle.

---

### 2.8 First-run checklist

From a clean clone to a green fidelity gate:

```bash
# 0. One-time host prerequisites
#    - Node (version in .nvmrc):           nvm install && nvm use
#    - pnpm:                               corepack enable && corepack prepare pnpm@latest --activate
#    - Docker Desktop running
#    - Git LFS:                            git lfs install
git clone <repo-url> videoforge
# (cd performed by your shell/editor; all commands below run from the repo root)

# 1. Fetch the binary fixtures (CC0 media + golden frames) via Git LFS
git lfs pull

# 2. Create your local env file
make env                      # cp .env.example .env  (edit secrets if needed)

# 3. Install deps + build the shared packages (project-schema, ffmpeg-graph, ui, config)
make install

# 4. Start backing services (postgres, redis, minio, render-worker); waits for health
make services

# 5. Migrate the DB and seed MinIO + Postgres from fixtures/manifest.json
make seed

# 6. Confirm the pinned FFmpeg build matches CI (golden frames depend on it)
make check-ffmpeg

# 7. Run the fidelity gate end-to-end — this is the MVP north-star (MVP_Scope §1/§8)
make golden                   # exports the fixture matrix; asserts SSIM/PSNR + audio RMS/pitch

# 8. Run the app: web + api + render-worker together
make dev
#    web  →  http://localhost:5173   (open in Chrome or Edge — other browsers are gated)
#    api  →  http://localhost:4000/api/v1
#    minio console → http://localhost:9001  (minioadmin / minioadmin)
```

**Expected end state**

| Check | Expected result | If it fails |
|---|---|---|
| `make services` | All four services healthy; three buckets created | `docker compose ps`; check ports 5432/6379/9000 aren't already bound. |
| `make seed` | Fixture assets visible in MinIO console + asset rows in Postgres | Did `git lfs pull` succeed? Pointer files (a few bytes) mean LFS didn't fetch. |
| `make check-ffmpeg` | "FFmpeg 6.1.1 OK" | Host FFmpeg differs from the pin — use the containerized worker or install the pinned build (§2.6). |
| `make golden` | Fixture matrix passes (trim/split/stacking/linked-audio/speed/color-grade/keyframe/caption) | A real fidelity regression *or* a stale golden after an intentional change — never `--update` without a reviewed reason (spec §22.7). |
| `make dev` → open `http://localhost:5173` in Chrome/Edge | Editor shell loads; importing a fixture transitions UPLOADING→READY (`asset:ready`) | In Safari/Firefox you'll see the browser gate (`MVP_Scope.md` §3.11) — expected; use Chrome/Edge. |

> **Smoke test the wedge on first run:** import `bunny_h264_3s.mp4` (the M1 acceptance fixture, `MVP_Scope.md` §7), drop it on the timeline, trim and split it, then export. The downloaded MP4 must have zero ghost footage and match the timeline — this is the same "what you cut is what you get" loop the golden gate enforces automatically.


---

## 3. Runtime Data Pipeline (Import → Edit → Export)

This section documents the three runtime data flows that make up a VideoForge MVP session — **Import**, **Edit/persist**, and **Export** — end to end, with sequence diagrams, the BullMQ queue/worker topology, and a job-state table. It is scoped to MVP (Phase 0) per `MVP_Scope.md` §3 and §6, and references the authoritative spec sections rather than restating them:

- Import: `VideoForge_Spec_v1.1.md` §4.2 (upload & proxy generation), §14.2 (asset API), §14.5 (`asset:ready`).
- Edit/persist: §11.2 (auto-save), §11.3 (undo/redo), §18.3 (data-model invariants), §18.4 (JSON Schema).
- Export: §10.2 (job lifecycle), §10.3 (FFmpeg command architecture), §14.3 (export API), §14.5 (`export:progress`/`export:complete`).
- Verification: §22.3 (golden-frame SSIM/PSNR), §22.4 (Web Audio RMS/pitch), §22.5 (perf gates), §22.7 (CI stages).

The single architectural invariant that ties all three flows together — **"what you cut is what you get"** — is that the export FFmpeg `filter_complex` is generated from the *exact same* canonical project JSON (`§18`) that the client preview renders. Every diagram below is annotated where that invariant is established, carried, or asserted.

> **MVP API note.** Where §14.2 documents a `check-duplicate → presign → complete` sequence, the MVP follows the *authoritative* §4.2 / `MVP_Scope.md` §3.1 flow instead: MD5 is **folded into `presign`** (`presign` accepts `md5Hash`, returns `existingAssetId` on a workspace hash match) and upload finalization is `POST /api/v1/assets/:id/confirm`. This doc uses the §4.2 endpoint names throughout.

> **Design → code handoff.** This pipeline is intentionally **headless**: every step below is a state machine, an API call, a queue job, or a WebSocket event, none of which depend on the visual design. The separately-provided design plugs in only at the three *surface points* called out in [§3.7 Design → code handoff](#37-design--code-handoff-surface-map) — the upload/processing UI, the autosave status indicator, and the export modal + progress UI. Everything between those surfaces (state shapes, event names, job topology) is fixed by this document so the design can be dropped onto stable contracts.

---

### 3.1 Service & data-flow topology (the spine)

```mermaid
flowchart LR
  subgraph Client["Browser (Chrome/Edge only)"]
    UI["React + Vite UI"]
    Z["Zustand store + Immer<br/>(canonical project JSON in memory)"]
    PV["Preview compositor<br/>WebCodecs → Canvas2D (+WebGL eq)"]
    WS1["WebSocket client"]
  end

  subgraph API["Node + Fastify API (/api/v1)"]
    REST["REST handlers"]
    AJV["Ajv validate (§18.4)"]
    WSH["WebSocket hub<br/>(asset:ready / export:progress)"]
  end

  subgraph Infra["Infra"]
    PG[("Postgres<br/>project JSONB, assets, exports")]
    RED[("Redis<br/>BullMQ + pub/sub")]
    S3[("S3 / MinIO<br/>originals · proxies · exports")]
  end

  subgraph Workers["BullMQ workers (containers)"]
    PW["media worker<br/>proxy-transcode · thumbnail-sprite · waveform"]
    RW["render worker<br/>pinned FFmpeg build"]
  end

  UI <--> Z
  Z --> PV
  UI -->|REST| REST
  REST --> AJV --> PG
  REST -->|enqueue| RED
  RED --> PW
  RED --> RW
  PW -->|read original / write proxy| S3
  RW -->|read ORIGINAL / write export| S3
  PW -->|publish| RED
  RW -->|publish progress| RED
  RED -->|sub| WSH
  WSH -->|asset:ready / export:*| WS1
  WS1 --> UI
  Client -->|chunked PUT presigned| S3
```

**Fidelity invariant, stated once:** the in-memory document in `Z` (Zustand+Immer) is serialized verbatim to Postgres `JSONB` via `PATCH`, and the **render worker reads that same document** to build `filter_complex`. The preview compositor `PV` and the render worker `RW` are two consumers of one source of truth. No transformation happens between them — that is the whole bet (`MVP_Scope.md` §1).

---

### 3.2 Import: client MD5 → presign → chunked upload → confirm → derivative jobs → `asset:ready`

A user drops a file (or `File > Import`). The client hashes it, presigns (which also deduplicates), uploads in 10 MB parallel chunks, confirms, and then the API fans out three BullMQ jobs whose completion is announced over WebSocket. The clip is a placeholder (`uploading`) until `asset:ready`.

```mermaid
sequenceDiagram
  autonumber
  participant U as User
  participant FE as Client (React/Zustand)
  participant API as Fastify /api/v1
  participant S3 as S3 / MinIO
  participant Q as BullMQ (media queue)
  participant W as media worker (FFmpeg)
  participant PG as Postgres
  participant WS as WebSocket hub

  U->>FE: drop file (mp4/mov/mp3/wav/jpg/png)
  FE->>FE: compute MD5 (Web Worker, streamed)
  FE->>API: POST /api/v1/assets/presign<br/>{filename,contentType,fileSize,md5Hash}
  API->>PG: lookup (workspaceId, md5Hash)
  alt workspace hash match (dedupe)
    API-->>FE: 200 {existingAssetId}  (no uploadUrl)
    Note over FE: skip upload entirely;<br/>reuse existing READY asset → clip usable now
  else new asset
    API->>PG: insert asset row (status=PENDING)
    API-->>FE: 200 {assetId, uploadUrl(s), partSize=10MB, expiresAt}
    par parallel 10 MB chunks (resumable on failure)
      FE->>S3: PUT part 1 (presigned)
      FE->>S3: PUT part 2 (presigned)
      FE->>S3: PUT part N (presigned)
    end
    FE->>API: POST /api/v1/assets/:id/confirm
    API->>PG: status PENDING → PROCESSING
    API->>Q: enqueue proxy-transcode {assetId}
    API->>Q: enqueue thumbnail-sprite {assetId}
    API->>Q: enqueue waveform {assetId}
    API-->>FE: 202 {status: PROCESSING}
    Note over FE: clip shows local "uploading" state

    Q->>W: proxy-transcode
    W->>S3: GET original
    W->>S3: PUT 720p base + quarter-res Low (H.264/AAC)
    Q->>W: thumbnail-sprite
    W->>S3: PUT 160×90 WebP sprite (1/sec)
    Q->>W: waveform
    W->>S3: PUT waveform peaks JSON
    W->>PG: status PROCESSING → READY,<br/>renditions map + derivative URLs
    W->>WS: publish asset:ready
    WS-->>FE: asset:ready {assetId, proxyUrl, thumbnailUrl, waveformUrl}
    Note over FE: map server READY → client "ready";<br/>clip becomes usable on the timeline
  end
```

**Key MVP guarantees on this path (`MVP_Scope.md` §3.1):**

- **MD5 dedupe is on the upload path, folded into presign** — a workspace hash match returns `existingAssetId` and the client skips S3 entirely. Cheap, no separate round-trip.
- **The original is preserved immutable in S3.** Proxies are derived; the original is never overwritten. This is load-bearing for the "no silent 4K downgrade" export guarantee (§3.4).
- **The preview decodes the 720p proxy, never the original.** WebCodecs decodes the base/Low renditions; the original is only fetched at export time.
- **`asset:ready` is the `PROCESSING → READY` → `uploading`/`ready` mapping.** Until it arrives, the clip is a placeholder; the user can still position it on the timeline.
- Resumable chunked upload (10 MB parallel parts) honors the generous Free ceilings (20 GB video / 2 GB audio / 100 MB image) — an explicit anti-Canva win.

**Local dev / CI variant.** S3 is the MinIO local-disk double; the `media worker` runs the **pinned FFmpeg build**. The integration backend seeds Postgres + MinIO from `fixtures/manifest.json` (`§22.6`), so `assetId`s and signed-URL shapes match production without touching cloud storage. Re-importing a committed fixture exercises the dedupe branch deterministically (manifest MD5 == upload MD5).

---

### 3.3 Edit / persist: Zustand mutation → Immer undo/redo → debounced autosave with server-owned `revision`

Every timeline edit is a pure mutation of the canonical project JSON in the Zustand store, produced with Immer so each mutation also yields an inverse patch for undo/redo. A 3-second debounce (or `Ctrl+S`) writes the **full document** to the server, which validates against the JSON Schema and bumps a monotonic `revision`.

```mermaid
sequenceDiagram
  autonumber
  participant U as User
  participant ST as Zustand store (+Immer)
  participant H as Undo/redo stack (200 ops)
  participant PV as Preview compositor
  participant DB as Autosave debouncer (3s)
  participant API as Fastify PATCH
  participant AJV as Ajv (§18.4 schema)
  participant PG as Postgres (JSONB)

  U->>ST: edit (trim / split / move / ripple /<br/>keyframe / volume / colorGrade)
  ST->>ST: produceWithPatches(draft)<br/>→ [forwardPatch, inversePatch]
  ST->>H: push [forward, inverse] (evict oldest > 200)
  ST-->>PV: subscribe → re-render from same JSON
  ST->>DB: mark dirty (status: orange "saving…")

  Note over U,ST: Undo = applyPatches(inversePatch);<br/>Redo = applyPatches(forwardPatch).<br/>Single-user, no rebase (MVP fast path).

  DB->>DB: wait 3s after last edit (debounce)
  DB->>API: PATCH /api/v1/projects/:id<br/>{ full project JSON, baseRevision }
  API->>AJV: validate document (draft 2020-12)
  alt schema valid AND baseRevision == current
    AJV-->>API: ok
    API->>PG: write JSONB, revision := revision + 1
    PG-->>API: {revision, updatedAt}
    API-->>DB: 200 {revision, updatedAt}
    DB-->>U: status dot → green "saved"
  else schema invalid
    AJV-->>API: error (path + keyword)
    API-->>DB: 400 (validation error)
    DB-->>U: status dot → red "save failed"
    Note over API: a malformed graph NEVER reaches PG,<br/>preview, or export (§18.4)
  else baseRevision stale (Phase 1 only)
    API-->>DB: 409 {conflictingFields}
    Note over DB: MVP is single-user → 409 not expected.<br/>Merge UI / rebase deferred to Phase 1 (§11.2).
  end
```

**MVP persistence rules (`MVP_Scope.md` §3.9, §5 "Concurrency note"):**

- **Full-document save model.** `PATCH /api/v1/projects/:id` sends the entire project JSON, not a diff. Simpler and the source of truth is unambiguous (`§18.3` "Relationship to the Project API").
- **Server-owned monotonic `revision`** is bumped on every successful write. MVP uses the **fast path only**: `revision` is sent as `baseRevision` for stale-base detection, but since MVP is single-user, the 409/merge branch is dead code in Phase 0 (it exists for Phase 1 collaboration). No Immer-patch WebSocket streaming.
- **Undo/redo is Immer patches**, a 200-op stack, single-user — no collaborative rebase (that is Phase 1, `§11.3`). Each op stores `[forwardPatch, inversePatch]`.
- **Schema validation gates every write** (`§18.4`, Ajv). The same schema runs in CI (stage 1/3, `§22.7`). The invariants enforced — integer-ms time, `trimIn`/`trimOut` from source origin, percentage geometry, UUIDv4 ids, array-index z/mix order, transitions-as-objects, persisted audio-mix fields (`§18.3`) — are exactly the fields the export reads, so a document that validates is a document the export can faithfully render.

> **Why this matters for fidelity.** The autosaved document and the in-memory document are byte-identical (full-document save). The export job (§3.4) loads the persisted JSONB. Therefore *the JSON the timeline rendered* and *the JSON the export renders* are provably the same object — the "what you cut is what you get" precondition is established here, at persist time.

---

### 3.4 Export: `POST /exports` → render queue → fetch ORIGINAL → `filter_complex` from the same JSON → encode → S3 → progress → 7-day download

The user opens the export modal, the client clamps resolution to the Free 1080p cap, and `POST /api/v1/exports` enqueues a render job. The worker fetches the **original** (not the proxy), builds `filter_complex` from the persisted project JSON, encodes, uploads to S3, and streams progress over WebSocket. Downloads are available for 7 days via freshly-minted 1-hour signed URLs.

```mermaid
sequenceDiagram
  autonumber
  participant U as User
  participant FE as Client (export modal)
  participant API as Fastify /api/v1/exports
  participant PG as Postgres
  participant Q as BullMQ (render queue)
  participant RW as render worker (pinned FFmpeg)
  participant S3 as S3 / MinIO
  participant R as Redis pub/sub
  participant WS as WebSocket hub

  U->>FE: open export modal, pick preset (TikTok/Reels/YT)
  FE->>FE: clamp resolution ≤ 1080p (Free cap);<br/>show pre-flight size + render-time estimate
  FE->>FE: detect clips whose ORIGINAL is missing<br/>→ pre-export proxy-downgrade WARNING
  FE->>API: POST /api/v1/exports {projectId, settings}
  API->>PG: insert export row (status=QUEUED)
  API->>Q: enqueue render {exportId, projectId}
  API-->>FE: 202 {exportId, status: QUEUED}
  FE->>WS: subscribe room(exportId)

  Q->>RW: render job
  RW->>PG: GET project JSON (the SAME document the timeline rendered)
  RW->>S3: GET ORIGINAL asset(s) — not proxy — when present & readable
  Note over RW,S3: ⭐ FIDELITY CHECKPOINT (§10.2):<br/>fetch ORIGINAL → true resolution.<br/>Proxy-only fallback ONLY when original absent.

  RW->>RW: build filter_complex FROM project JSON
  Note over RW: ⭐ "what you cut is what you get" (§10.3):<br/>per-clip -ss/-to trim (honors gaps, no ghost footage);<br/>bottom-up overlay composite (matches preview stack);<br/>per-track volume→pan → amix=inputs=N:normalize=0 → alimiter;<br/>mute/solo gating of amix inputs;<br/>eq color-grade · zoompan Ken Burns · xfade · drawtext · subtitles;<br/>final Free watermark overlay
  RW->>RW: FFmpeg encode (x264 CRF 18, H.264 MP4)
  loop during encode
    RW->>R: publish progress {exportId, progress, etaSeconds}
    R->>WS: export:progress
    WS-->>FE: export:progress {progress, etaSeconds}
  end
  RW->>S3: PUT exports/{exportId}.mp4
  RW->>PG: status COMPLETE, output_key set
  RW->>R: publish export:complete
  R->>WS: export:complete
  WS-->>FE: export:complete {exportId, outputUrl, fileSize}
  Note over FE: 7-day availability window.<br/>Each download → GET /api/v1/exports/:id<br/>mints a fresh 1-hour signed S3 URL.
  U->>FE: click Download → mint fresh signed URL → S3 GET
```

**MVP export guarantees (`MVP_Scope.md` §3.8, `§10.2`–`§10.3`):**

- **⭐ Fidelity checkpoint #1 — fetch ORIGINAL, not proxy.** Each referenced asset is fetched at its original high-res file when present and readable; proxy-only fallback happens *only* when the original is absent, and the user was warned pre-export. This is the "no silent 4K downgrade" guarantee. The export gate asserts the *original* (not the proxy) was fetched when present (`§3.6` test map; `MVP_Scope.md` §3.8).
- **⭐ Fidelity checkpoint #2 — `filter_complex` from the same JSON.** The command builder is a headless, unit-testable module (built first, M0) that reads the persisted project JSON. Per-clip `-ss`/`-to` honors `trimIn`/`trimOut` and leaves gaps un-closed (no ghost footage); bottom-up `overlay` matches preview stacking; `amix=inputs=N:normalize=0` + `alimiter` preserves the per-track mix; mute/solo gates `amix` inputs exactly as the preview does.
- **Free-tier rules:** resolution clamped to 1080p in the frontend (no over-cap job created); mandatory Free watermark injected as the final `overlay` in the graph; per-user export rate limit 5/min (Redis sliding window).
- **Delivery:** progress over the `export:progress` WebSocket; on completion `export:complete`; downloadable for **7 days**, each download minting a fresh **1-hour** signed S3 URL via `GET /api/v1/exports/:id` (`§10.2`).

---

### 3.5 BullMQ queue / worker topology + job-state table

MVP runs **two BullMQ queues** on one Redis instance (`MVP_Scope.md` §6): a media-derivative queue (proxy/thumbnail/waveform) and a render queue. No long-job split, no k8s autoscaling, no per-job container isolation — those are Phase 1+.

```mermaid
flowchart TB
  subgraph RedisBox["Redis"]
    MQ["queue: media<br/>jobs: proxy-transcode · thumbnail-sprite · waveform"]
    RQ["queue: render<br/>jobs: export"]
    PS["pub/sub channels:<br/>asset:ready · export:{id}"]
  end

  API["Fastify API"] -->|add| MQ
  API -->|add| RQ

  MQ --> MW["media worker pool<br/>(pinned FFmpeg, concurrency = N_media)"]
  RQ --> RWk["render worker pool<br/>(pinned FFmpeg, sized to 4× realtime,<br/>concurrency = N_render)"]

  MW -->|publish| PS
  RWk -->|publish progress| PS
  PS --> HUB["WebSocket hub → clients"]
```

| Queue | Job name | Trigger | Worker | Reads | Writes | Emits | Retry / cleanup |
|---|---|---|---|---|---|---|---|
| `media` | `proxy-transcode` | `POST /assets/:id/confirm` | media worker | S3 original | S3 720p base + quarter-res Low | (rollup) | 3 attempts, exp backoff; on final fail → asset `PROXY_FAILED` |
| `media` | `thumbnail-sprite` | `confirm` | media worker | S3 original | S3 160×90 WebP sprite | (rollup) | 3 attempts; sprite optional, non-blocking |
| `media` | `waveform` | `confirm` (audio-bearing) | media worker | S3 original | S3 waveform peaks JSON | (rollup) | 3 attempts; optional |
| (rollup) | — | all three done | media worker | PG asset | PG `status=READY`, renditions map | `asset:ready` | n/a |
| `render` | `export` | `POST /api/v1/exports` | render worker | **PG project JSON + S3 ORIGINAL(s)** | S3 `exports/{id}.mp4`, PG export row | `export:progress`, `export:complete` | 2 attempts; on `DELETE` → cancel signal, temp cleanup, `CANCELLED` |

**Queue env vars (dev/CI defaults):**

```bash
REDIS_URL=redis://localhost:6379
BULLMQ_PREFIX=videoforge
QUEUE_MEDIA=media
QUEUE_RENDER=render
MEDIA_WORKER_CONCURRENCY=2
RENDER_WORKER_CONCURRENCY=1          # MVP: one pool sized to the 4× realtime target
EXPORT_RATE_LIMIT_PER_MIN=5          # per-user, Redis sliding window
S3_ENDPOINT=http://localhost:9000    # MinIO local-disk double (dev/CI)
S3_BUCKET=videoforge-dev
FFMPEG_BIN=/opt/ffmpeg/bin/ffmpeg    # pinned build (version+flags in fixture lockfile)
FREE_TIER_MAX_RESOLUTION=1080
FREE_TIER_WATERMARK=true
```

**Asset status state machine** (server enum → client clip state; `§4.2`, `§14.2`, `§16`):

```mermaid
stateDiagram-v2
  [*] --> PENDING: presign (new)
  PENDING --> PROCESSING: confirm (jobs enqueued)
  PROCESSING --> READY: all derivative jobs done → asset:ready
  PROCESSING --> PROXY_FAILED: proxy-transcode exhausted retries
  READY --> [*]
  note right of PENDING : dedupe branch skips straight\nto an existing READY asset
  note right of READY : client maps READY → "ready";\nclip usable on timeline
```

**Export job state machine** (`§10.2`, `§14.3`):

```mermaid
stateDiagram-v2
  [*] --> QUEUED: POST /api/v1/exports
  QUEUED --> RENDERING: worker picks up job
  RENDERING --> COMPLETE: encode + S3 upload OK → export:complete
  RENDERING --> FAILED: FFmpeg / upload error (after retries)
  QUEUED --> CANCELLED: DELETE /api/v1/exports/:id
  RENDERING --> CANCELLED: DELETE → cancel signal + temp cleanup
  COMPLETE --> [*]
  note right of COMPLETE : downloadable 7 days;\neach download mints fresh\n1-hour signed S3 URL
```

| State | Set by | `progress` | Client behavior | Terminal? |
|---|---|---|---|---|
| `QUEUED` | API on `POST /exports` | 0 | subscribe to `room(exportId)`; spinner | no |
| `RENDERING` | render worker on pickup | 0–99 | progress bar from `export:progress`; user may leave page (notification bell) | no |
| `COMPLETE` | render worker on S3 upload | 100 | enable Download (mint fresh 1-hour URL); toast + email if > 5 min | yes |
| `FAILED` | render worker after retries | last | show error state (`§16`), allow retry | yes |
| `CANCELLED` | API on `DELETE` / worker | — | remove from queue UI; `409` if already `COMPLETE` | yes |

---

### 3.6 Where the golden-frame test asserts the invariant

The "what you cut is what you get" checkpoint (§3.4) is not just designed in — it is **asserted in CI on every PR** (`MVP_Scope.md` §1 north-star gate; `§22.3`/`§22.5`/`§22.7`).

```mermaid
flowchart LR
  FIX["fixture project JSON<br/>(trim · split · stacking · linked-audio move ·<br/>speed · color-grade · transform-keyframe ·<br/>crossfade · burned-in caption)"]
  CB["export-command builder<br/>(headless, same module as §3.4)"]
  FF["pinned FFmpeg build"]
  OUT["export MP4"]
  EX["extract frames at fixed ts<br/>ffmpeg -ss {t} -frames:v 1"]
  CMP{"SSIM / PSNR vs<br/>committed golden frame"}
  AUD{"OfflineAudioContext RMS +<br/>FFmpeg atempo pitch compare"}
  PASS["✅ merge gate green"]
  FAIL["❌ fail; attach golden,<br/>actual, heat-map diff"]

  FIX --> CB --> FF --> OUT --> EX --> CMP
  OUT --> AUD
  CMP -->|≥0.985/38dB lossy · ≥0.990/40dB effects| PASS
  CMP -->|breach| FAIL
  AUD -->|RMS err ≤ −60 dBFS · pitch preserved| PASS
  AUD -->|breach| FAIL
```

| Assertion | Where it lives | What it proves | Gate |
|---|---|---|---|
| `filter_complex` from project JSON matches preview | golden-frame SSIM/PSNR (`§22.3`) on the fixture export set | timeline edit == export output (no ghost footage, correct stacking/trim) | CI stage 5 (`§22.7`) |
| Audio mix matches preview | `OfflineAudioContext` RMS vs golden buffer (`§22.4`), ≤ −60 dBFS | `amix=normalize=0` + mute/solo gating == preview mix | CI stage 3 |
| Pitch preserved on speed change | FFmpeg `atempo` golden-spectrum compare (`§22.4`) | export speed path == preview intent | CI stage 3 |
| **ORIGINAL fetched, not proxy** | export-builder integration test (`MVP_Scope.md` §3.8) | "no silent 4K downgrade" — source-not-proxy when present | CI stage 3/5 |
| Export throughput ≥ 4× realtime | export perf gate (`§22.5`) on pinned worker | render farm budget holds | CI stage 6 |

Goldens are keyed by **fixture MD5 + pinned-encoder version** (`§22.6`), stored under `fixtures/golden/`, and updated only via a reviewed `pnpm test:golden --update` commit (an encoder bump is a deliberate golden update, never an incidental diff). The merge gate is **CI stages 1–6 green** (`§22.7`).

---

### 3.7 Design → code handoff (surface map)

The runtime pipeline is headless; the separately-provided visual design attaches only at these three surfaces. Each is a thin presentational layer over a state shape or event stream this document already fixes — so the design can be implemented against stable contracts without touching pipeline logic.

| Surface | Pipeline contract the design binds to | Stable inputs the design consumes | Out of design's scope |
|---|---|---|---|
| **Import / processing UI** (drop zone, upload progress, clip placeholder) | §3.2 flow + asset state machine (§3.5) | per-part upload `%`; client clip state `uploading`/`ready`; `asset:ready` payload `{assetId, proxyUrl, thumbnailUrl, waveformUrl}`; `PROXY_FAILED` error state | MD5/presign/chunk/confirm logic; job fan-out |
| **Autosave status indicator** (top-bar dot) | §3.3 autosave debouncer | dirty flag → `grey / orange "saving…" / green "saved" / red "save failed"`; (`409` styling reserved for Phase 1) | debounce timing, full-document PATCH, schema validation, `revision` |
| **Export modal + progress UI** (preset picker, pre-flight estimate, downgrade warning, progress bar, download button) | §3.4 flow + export state machine (§3.5) | preset → `settings`; clamped resolution (≤1080p); pre-flight size/time estimate; pre-export proxy-downgrade warning list; `export:progress` `{progress, etaSeconds}`; `export:complete` `{outputUrl, fileSize}`; per-download fresh signed URL | resolution clamp logic, watermark injection, `filter_complex` build, queue/worker topology |

**Handoff rule:** the design supplies *visual treatment and layout* for these three surfaces only. It must consume the event/state names verbatim (`asset:ready`, `export:progress`, `export:complete`, the asset/export state enums, the autosave status states). If a design comp implies new pipeline state (e.g., a "render queue position" indicator), that is a contract change reviewed against this section — not a silent addition in the view layer.


---

## 4. CI/CD & Quality Gates

> Scope: VideoForge **MVP / Phase 0** only. This section operationalizes the CI pipeline gates from `VideoForge_Spec_v1.1.md` §22.7 against the MVP cut in `MVP_Scope.md` (§6 tech stack, §7 milestones M0–M4, §8 perf/fidelity gates). Where the spec defines *behaviour*, this section defines *how it is built, gated, and shipped* — it does not restate thresholds that already live in §5.2, §10.2, §18.4, §22.3–22.7. The fidelity invariant (`MVP_Scope.md` §1) is the north star: a stage that proves "what you cut is what you get" blocks merge; everything else is staged fast-to-slow so cheap failures stop the run early.
>
> **Design → code handoff.** The visual design is supplied separately. CI never asserts pixels of the **preview** canvas (it is GPU/driver-dependent per spec §5.1/§22.2) and therefore never couples to the design's visual styling. Only the **export** is pixel-asserted (deterministic, server-side FFmpeg). The design plugs into the implementation through three CI-stable contracts that this pipeline enforces and that the design must honor: (1) stable `data-testid` selectors on interactive nodes (spec §22.2), driven by `e2e` (Stage 4); (2) component tests (Stage 2b) that mount design components against mocked data; (3) the design **never** introduces a divergence between preview and export — burned-in text/effects added by the design are constrained to the `drawtext`-reproducible / single-filter subset (`MVP_Scope.md` §3.6/§3.7) so Stage 5 (golden-frame) stays green. See §4.7 for the explicit handoff checklist.

### 4.1 Pipeline overview

The pipeline is a single GitHub Actions workflow, staged fast-to-slow. Stages 1–6 are the **merge gate** (`MVP_Scope.md` §8 final row, spec §22.7). Stages within a tier run in parallel; a tier only starts if the prior tier is green. Stages 7–9 are informational or release/deploy stages that do not block a PR merge.

```mermaid
flowchart TD
    push[push / PR] --> S1

    subgraph MergeGate["MERGE GATE — blocks merge (spec §22.7 stages 1-6)"]
      S1["1. Static\nlint + tsc + format + audit"]
      S2a["2a. Unit (Vitest)\ntimeline math, filter_complex builder,\nImmer reducers, CRF/plan clamps"]
      S2b["2b. Component (Vitest+RTL+jsdom)\nclip block, transport, export modal,\ncaption editor — design plugs in here"]
      S3a["3a. Schema validation\nAjv §18.4 over fixture project graphs"]
      S3b["3b. Integration\nstore+save, WebGL→2D composite,\nexport-cmd builder, OfflineAudioContext mix"]
      S4["4. e2e (Playwright, Chromium)\nimport→split→colorgrade→caption→export"]
      S5["5. Golden-frame fidelity\nSSIM≥0.985 / PSNR≥38dB + audio RMS/pitch\npinned FFmpeg, fixture-by-MD5"]
      S6["6. Perf-regression gates\npreview FPS/seek (§5.2) + export ≥4x RT (§10.2)"]
    end

    S1 --> S2a & S2b
    S2a --> S3a & S3b
    S2b --> S3a & S3b
    S3a --> S4
    S3b --> S4
    S4 --> S5
    S5 --> S6

    S6 --> merge{merge to main}

    subgraph Informational["INFORMATIONAL / RELEASE / DEPLOY — do not block PR merge"]
      S7["7. Nightly full e2e\n(Chromium only in MVP; matrix is Phase 1)"]
      S8["8. Conditional security scan\n(auth/upload/export diffs)"]
      S9["9. Build & publish artifacts\nweb static · api image · worker image"]
    end

    merge --> S9 --> staging[deploy → staging] --> smoke{staging smoke + golden re-check}
    smoke --> prod[deploy → prod]
    push -.nightly.-> S7
    push -.conditional.-> S8
```

**MVP narrowing of spec §22.7.** Two spec stages are deliberately reshaped for Phase 0:

- **Stage 4 e2e** runs **Chromium only** on PRs. The full Chromium/Firefox/WebKit matrix and the `ffmpeg.wasm` fallback assertions (spec §22.2) are deferred — MVP is Chrome/Edge-only (`MVP_Scope.md` §3.3/§3.11). The nightly job (Stage 7) is therefore Chromium-only too in Phase 0; it exists as the scaffold the Phase 1 matrix slots into.
- **Stage 5 deterministic-render classes** are restricted to the two MVP golden classes: lossy H.264 Auto-CRF (SSIM ≥ 0.985 / PSNR ≥ 38 dB) and effects/composite frames (SSIM ≥ 0.990 / PSNR ≥ 40 dB) per spec §22.3. The ProRes/PNG-lossless and VP9/HDR classes are **not built** in MVP (those formats are out of scope, `MVP_Scope.md` §3.8) and their golden classes are excluded from the matrix, not just skipped.

### 4.2 Stage table

| # | Stage | Trigger | Tool(s) | Gate (what must hold) | Blocks merge? |
|---|---|---|---|---|---|
| 1 | **Static** | every push | `tsc --noEmit`, ESLint, Prettier `--check`, `pnpm audit --prod` | Zero type errors, lint clean, formatted, no high/critical advisories | **Yes** |
| 2a | **Unit** | every push | Vitest (Node) | All unit specs green; changed-file line coverage ≥ 85% (ratchet, spec §22.7). Covers timeline math, Immer reducers/patches, timecode/frame conv., CRF + plan-cap clamps, and the `filter_complex` string builder | **Yes** |
| 2b | **Component** | every push | Vitest + Testing Library + jsdom | Clip block / transport bar / export modal / caption editor render against mocked data; WebCodecs & Web Audio mocked. **Design components mount and expose required `data-testid`s** | **Yes** |
| 3a | **Schema validation** | every push | Ajv (draft 2020-12) | Every fixture project graph under `fixtures/projects/` validates against `schemas/project.schema.json` (spec §18.4); each known-bad graph is rejected with the expected error path | **Yes** |
| 3b | **Integration** | every push | Vitest (Node + `headless-gl`) | Store + full-document save round-trip; WebGL color-grade pass → 2D composite parity; export-command builder emits a real FFmpeg command from a real graph; `OfflineAudioContext` mix RMS ≤ −60 dBFS vs golden (spec §22.4) | **Yes** |
| 4 | **e2e (PR subset)** | on PR | Playwright (Chromium, `page.clock` mocked) | Core journey green: import fixture → place + split → color-grade → add caption track → export 1080p → job COMPLETE + 7-day download authorized. Selectors are `data-testid` only | **Yes** |
| 5 | **Golden-frame fidelity** | on PR | FFmpeg (`pinned`) + `ssim`/`psnr` filters; `OfflineAudioContext` / FFmpeg spectrum | Per-frame SSIM ≥ 0.985 & PSNR ≥ 38 dB (H.264); ≥ 0.990 & ≥ 40 dB (effect/composite). Audio RMS ≤ −60 dBFS vs golden; pitch preserved on speed change. Fixtures keyed by **MD5 + pinned-encoder version** | **Yes** |
| 6 | **Perf-regression gates** | on PR | Playwright (playback) + pinned worker (export) | Preview FPS/seek within §5.2 tolerance band; export real-time factor ≥ 4× and within 10% of committed baseline; peak worker RSS under ceiling (spec §22.5, §10.2) | **Yes** |
| 7 | **Nightly e2e** | nightly | Playwright (Chromium) | Extended journeys + drift watch. (Browser matrix + `ffmpeg.wasm` fallback = Phase 1) | No (info) |
| 8 | **Security scan** | PR touching `auth/`, `upload/`, `export/` | `semgrep` / static scan | No new high/critical finding on changed surfaces (spec §17, §22.7 stage 8) | **Yes (conditional)** |
| 9 | **Build & publish** | merge to `main` / tag | `vite build`, Docker buildx, GHCR push | Web static bundle + `api` image + `worker` image build, tag = commit SHA, SBOM attached | No (post-merge) |

> **Blocking vs informational, stated plainly.** Merge is blocked unless Stages **1, 2a, 2b, 3a, 3b, 4, 5, 6** are green (and Stage 8 when its path filter fires). Stages **7 and 9** never block a PR — Stage 7 surfaces slow drift to the §20 observability pipeline, Stage 9 produces the deploy artifacts. Golden-frame and perf-baseline *updates* (Stage 5/6) require a reviewer's explicit approval label (`golden-update` / `perf-baseline-update`), because such a commit moves the very thing the gate measures (spec §22.7).

### 4.3 Determinism: pinned FFmpeg + fixture-by-MD5

The fidelity gate is only meaningful if the same input always produces the same output. MVP locks three things:

1. **Pinned FFmpeg build.** Exact version + build flags are recorded in `fixtures/ffmpeg.lock.json` and baked into the worker image (`MVP_Scope.md` §6 "pinned build"). CI, the worker image, and golden generation **must** use the byte-identical binary. An FFmpeg bump is a deliberate, reviewed `golden-update` PR — never an incidental diff (spec §22.3).

   ```json
   // fixtures/ffmpeg.lock.json
   {
     "version": "n6.1.1",
     "configure": "--enable-gpl --enable-libx264 --enable-libfreetype --enable-libass",
     "x264": "0.164.3108",
     "sha256": "…",   // of the static binary in the worker image
     "encoder": { "vcodec": "libx264", "crf": 18, "preset": "medium" }
   }
   ```

2. **Fixture-by-MD5.** Test media lives under `fixtures/media/` via Git LFS; `fixtures/manifest.json` maps each file to its MD5 (the same MD5 the upload path uses for dedupe, `MVP_Scope.md` §3.1 / spec §22.6). Golden frames and golden audio buffers under `fixtures/golden/` are keyed by **fixture MD5 + pinned-encoder version**, so a golden is unambiguously tied to the input and the codec build that produced it. A fixture whose bytes change gets a new MD5 → its golden is invalidated by key, not silently reused.

3. **Seeded procedural state + mocked clocks.** Any stochastic effect's seed is persisted in the project JSON (spec §22.3); Playwright drives `requestAnimationFrame` from a mocked clock (spec §22.2). In MVP the only seeded surface is keyframe interpolation timing — the deep procedural effects (grain, shake, particles) are out of scope (`MVP_Scope.md` §3.7) — but the mechanism is wired from M0 so Phase 2 effects inherit it.

CI verifies the binary match before any golden compare runs:

```bash
# pre-flight in Stage 5: fail fast if the runner's FFmpeg != the locked build
LOCK_SHA=$(jq -r .sha256 fixtures/ffmpeg.lock.json)
RUN_SHA=$(sha256sum "$(command -v ffmpeg)" | cut -d' ' -f1)
[ "$LOCK_SHA" = "$RUN_SHA" ] || { echo "::error::FFmpeg build drift — golden compare aborted"; exit 1; }
```

### 4.4 Runners, caching & the local-disk S3 double

| Concern | MVP choice |
|---|---|
| Standard runners | `ubuntu-latest` GitHub-hosted, for Stages 1–5 and 8 |
| Pinned perf runner | A **self-hosted** runner labeled `perf-pinned` (fixed vCPU/RAM, the locked FFmpeg) for Stage 6 export gate — absolute timing on shared runners is too noisy, so the gate is **relative to a committed baseline on this same worker class** (spec §22.5) |
| Object storage in CI | **MinIO** as the local-disk S3 double (`MVP_Scope.md` §6) — a service container; originals/proxies/exports buckets seeded from `fixtures/manifest.json`. No CI job ever touches real cloud storage (spec §22.6) |
| Redis | A `redis:7` service container for BullMQ (render/proxy/thumbnail/waveform queues) in Stage 3b/4 |
| Postgres | A `postgres:16` service container; project stored as `JSONB`, migrated then seeded from the manifest |
| LFS | `actions/checkout` with `lfs: true` so fixture media + goldens are present |
| Caches | pnpm store keyed by `pnpm-lock.yaml`; Vite/Vitest cache; Playwright browser cache keyed by Playwright version; Docker layer cache via buildx + GHCR |

```yaml
# service containers shared by integration / e2e / golden stages
services:
  redis:
    image: redis:7
    ports: ["6379:6379"]
  postgres:
    image: postgres:16
    env: { POSTGRES_PASSWORD: ci, POSTGRES_DB: videoforge_ci }
    ports: ["5432:5432"]
  minio:
    image: minio/minio
    env: { MINIO_ROOT_USER: ci, MINIO_ROOT_PASSWORD: ci-secret-key }
    options: >-
      --health-cmd "curl -f http://localhost:9000/minio/health/live"
    ports: ["9000:9000"]
```

Env vars consumed by the CI jobs (mirror the dev `.env`, never production secrets):

| Env var | CI value | Purpose |
|---|---|---|
| `S3_ENDPOINT` | `http://localhost:9000` | Point the SDK at MinIO |
| `S3_BUCKET_ORIGINALS` / `S3_BUCKET_PROXIES` / `S3_BUCKET_EXPORTS` | `vf-originals` / `vf-proxies` / `vf-exports` | Seeded from manifest |
| `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` | `ci` / `ci-secret-key` | MinIO creds |
| `S3_FORCE_PATH_STYLE` | `true` | Required for MinIO |
| `REDIS_URL` | `redis://localhost:6379` | BullMQ |
| `DATABASE_URL` | `postgres://postgres:ci@localhost:5432/videoforge_ci` | Postgres |
| `FFMPEG_PATH` | `/usr/local/bin/ffmpeg` | Must match `ffmpeg.lock.json` sha256 |
| `FIXTURE_MANIFEST` | `fixtures/manifest.json` | Seed + MD5 source of truth |
| `STRIPE_MODE` | `stub` | Free-tier only; billing stubbed (`MVP_Scope.md` §3.10) |
| `PLAYWRIGHT_BASE_URL` | `http://localhost:4173` | Vite preview server under test |

### 4.5 Build artifacts

Stage 9 (post-merge / on tag) produces three artifacts, each tagged with the commit SHA so a staging→prod promotion is byte-identical:

| Artifact | Built by | Contents | Published to |
|---|---|---|---|
| **Web static** | `pnpm --filter @videoforge/web build` (Vite) | Hashed `dist/` (React SPA, Chrome/Edge target). The separately-supplied design is compiled in here; CI asserts nothing about its look, only that it builds and its components pass Stage 2b | S3 static bucket + CDN, or GHCR if served via the api |
| **API image** | `docker buildx` `apps/api/Dockerfile` (Node + Fastify) | REST `/api/v1/*` + WebSocket (`asset:ready`, export progress) | `ghcr.io/<org>/videoforge-api:<sha>` |
| **Worker image** | `docker buildx` `apps/worker/Dockerfile` | BullMQ consumer + the **pinned FFmpeg** binary (sha256 must equal `ffmpeg.lock.json`) for proxy/thumbnail/waveform jobs + the render/export job | `ghcr.io/<org>/videoforge-worker:<sha>` |

The worker image build verifies the FFmpeg pin as a build step, so an image can never ship with a drifted encoder:

```dockerfile
# apps/worker/Dockerfile (excerpt)
RUN ffmpeg -version && \
    test "$(sha256sum /usr/local/bin/ffmpeg | cut -d' ' -f1)" = "$(jq -r .sha256 /app/fixtures/ffmpeg.lock.json)"
```

### 4.6 Deploy: staging → prod

MVP deploys are linear and SHA-pinned; no canary/blue-green complexity beyond a staging gate. Prod promotion reuses the exact images that passed staging.

```mermaid
flowchart LR
    A[merge to main] --> B[Stage 9: build + push images @sha]
    B --> C[migrate staging DB]
    C --> D[deploy api+worker @sha to staging]
    D --> E[deploy web @sha to staging CDN]
    E --> F{staging smoke + golden re-check}
    F -- fail --> X[hold + alert; no prod promote]
    F -- pass --> G[manual approve / tag release]
    G --> H[migrate prod DB]
    H --> I[promote SAME @sha images to prod]
    I --> J[prod smoke + Sentry/RUM watch §20]
```

| Step | Command / mechanism | Gate before proceeding |
|---|---|---|
| Build & push | Stage 9 | Stages 1–6 green on the merged commit |
| DB migrate (staging) | `pnpm --filter @videoforge/api db:migrate:deploy` | Migration is forward-only + reversible-down present |
| Deploy staging | `docker compose -f deploy/staging.yml up -d` (or equivalent), images pinned to `<sha>` | Health checks pass |
| **Staging smoke** | Playwright Chromium happy-path (import→export) against staging + a **single golden-frame re-check** of one reference fixture | Job COMPLETE, golden green, watermark present |
| Release approval | `gh` environment protection rule on the `production` environment | Reviewer approval on the deploy |
| Deploy prod | promote the **same** `<sha>` images (never rebuild) | Staging smoke + golden green |
| Post-deploy watch | Sentry release + RUM funnel (TTFE / fidelity events, spec §20) | No error-rate or FPS-regression alert in the watch window |

**Rollback:** prod runs the previous known-good `<sha>` images; rollback is re-pinning the deploy to the prior SHA + running the down-migration only if the schema changed. Because images are content-addressed by SHA and never rebuilt for prod, rollback is deterministic.

### 4.7 Design → code handoff checklist (what the supplied design must satisfy to keep CI green)

| Contract | Enforced by | Requirement on the design |
|---|---|---|
| Stable selectors | Stage 4 (e2e) | Interactive nodes expose `data-testid` (`clip-{clipId}`, transport buttons, export-modal controls, caption-editor rows); never select on CSS class or localized text (spec §22.2) |
| Component mountability | Stage 2b (component) | Design components render against mocked data/transport with WebCodecs + Web Audio mocked; no hard dependency on a live `AudioContext` in unit/component scope |
| Preview ≠ pixel-gated | spec §5.1/§22.2 | The design's preview styling is **never** golden-compared; it may evolve freely without touching Stage 5 |
| Export parity safety | Stage 5 (golden-frame) | Any burned-in text/effect the design introduces stays within the `drawtext`-reproducible subset and the single color-grade filter (`MVP_Scope.md` §3.6/§3.7) so export still matches the project JSON |
| Browser gate | Stage 4 | The Chrome/Edge-only gate message (`MVP_Scope.md` §3.11) is a tested, selectable element, not a styling afterthought |
| No perf regression from layout | Stage 6 | Heavy design layouts must not break the virtual-scrolled clip rendering or the rAF/audio-clock budget (§5.2) — the playback gate will catch a regression |

### 4.8 Sample GitHub Actions workflow skeleton

```yaml
# .github/workflows/ci.yml
name: ci
on:
  push:
    branches: [main]
  pull_request:

concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true

env:
  S3_ENDPOINT: http://localhost:9000
  S3_FORCE_PATH_STYLE: "true"
  S3_ACCESS_KEY_ID: ci
  S3_SECRET_ACCESS_KEY: ci-secret-key
  REDIS_URL: redis://localhost:6379
  DATABASE_URL: postgres://postgres:ci@localhost:5432/videoforge_ci
  STRIPE_MODE: stub
  FIXTURE_MANIFEST: fixtures/manifest.json

jobs:
  # ---------- Stage 1: Static (blocks merge) ----------
  static:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm -r typecheck            # tsc --noEmit across workspaces
      - run: pnpm -r lint
      - run: pnpm -r format:check
      - run: pnpm audit --prod --audit-level high

  # ---------- Stage 2: Unit + Component (blocks merge) ----------
  unit-component:
    needs: static
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm test:unit --coverage          # Vitest Node: timeline math, filter_complex builder, reducers, clamps
      - run: pnpm test:component                # Vitest + RTL + jsdom: clip/transport/export-modal/caption editor (+ design components)
      - run: pnpm coverage:ratchet              # fails if changed-file lines < 85% or below baseline

  # ---------- Stage 3a: JSON-Schema validation (blocks merge) ----------
  schema:
    needs: unit-component
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { lfs: true }
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      # Ajv (draft 2020-12) validate every fixture project graph against §18.4,
      # and assert each known-bad graph is rejected with the expected error path.
      - run: pnpm validate:schema -- --schema schemas/project.schema.json --good fixtures/projects --bad fixtures/projects-invalid

  # ---------- Stage 3b: Integration (blocks merge) ----------
  integration:
    needs: unit-component
    runs-on: ubuntu-latest
    services:
      redis: { image: redis:7, ports: ["6379:6379"] }
      postgres:
        image: postgres:16
        env: { POSTGRES_PASSWORD: ci, POSTGRES_DB: videoforge_ci }
        ports: ["5432:5432"]
      minio:
        image: minio/minio
        env: { MINIO_ROOT_USER: ci, MINIO_ROOT_PASSWORD: ci-secret-key }
        ports: ["9000:9000"]
    steps:
      - uses: actions/checkout@v4
        with: { lfs: true }
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm db:migrate:deploy && pnpm fixtures:seed   # seed Postgres + MinIO buckets from manifest
      # store+save round-trip, WebGL color-grade -> 2D composite parity (headless-gl),
      # export-command builder produces a real FFmpeg cmd, OfflineAudioContext mix RMS <= -60 dBFS vs golden
      - run: pnpm test:integration

  # ---------- Stage 4: e2e PR subset (blocks merge) ----------
  e2e:
    needs: [schema, integration]
    runs-on: ubuntu-latest
    services:
      redis: { image: redis:7, ports: ["6379:6379"] }
      postgres:
        image: postgres:16
        env: { POSTGRES_PASSWORD: ci, POSTGRES_DB: videoforge_ci }
        ports: ["5432:5432"]
      minio:
        image: minio/minio
        env: { MINIO_ROOT_USER: ci, MINIO_ROOT_PASSWORD: ci-secret-key }
        ports: ["9000:9000"]
    steps:
      - uses: actions/checkout@v4
        with: { lfs: true }
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm exec playwright install --with-deps chromium   # MVP: Chromium only (Chrome/Edge target)
      - run: pnpm db:migrate:deploy && pnpm fixtures:seed
      - run: pnpm build && pnpm preview &                        # serve web static under PLAYWRIGHT_BASE_URL
      # core journey: import fixture -> place+split -> color-grade -> caption -> export 1080p -> COMPLETE + 7-day download
      - run: pnpm test:e2e -- --project=chromium
      - uses: actions/upload-artifact@v4
        if: failure()
        with: { name: playwright-traces, path: test-results/ }

  # ---------- Stage 5: Golden-frame render fidelity (blocks merge) ----------
  golden:
    needs: e2e
    runs-on: ubuntu-latest
    container:
      image: ghcr.io/${{ github.repository }}-worker:${{ github.sha }}   # carries the PINNED ffmpeg
    services:
      minio:
        image: minio/minio
        env: { MINIO_ROOT_USER: ci, MINIO_ROOT_PASSWORD: ci-secret-key }
        ports: ["9000:9000"]
    steps:
      - uses: actions/checkout@v4
        with: { lfs: true }
      - run: |   # determinism pre-flight: runner FFmpeg must equal the locked build
          LOCK=$(jq -r .sha256 fixtures/ffmpeg.lock.json)
          RUN=$(sha256sum "$(command -v ffmpeg)" | cut -d' ' -f1)
          [ "$LOCK" = "$RUN" ] || { echo "::error::FFmpeg build drift"; exit 1; }
      - run: pnpm install --frozen-lockfile
      # Export each fixture project via the real export-job builder + pinned FFmpeg;
      # extract frames at fixed timestamps; SSIM>=0.985 & PSNR>=38dB (H.264),
      # >=0.990 & >=40dB (effects/composite); audio RMS<=-60dBFS + pitch preserved.
      - run: pnpm test:golden
      - uses: actions/upload-artifact@v4
        if: failure()
        with: { name: golden-diffs, path: artifacts/golden-diff/ }   # golden | actual | heatmap

  # ---------- Stage 6: Performance-regression gates (blocks merge) ----------
  perf:
    needs: golden
    runs-on: [self-hosted, perf-pinned]   # fixed vCPU/RAM + pinned FFmpeg; gate is RELATIVE to committed baseline
    steps:
      - uses: actions/checkout@v4
        with: { lfs: true }
      - run: pnpm install --frozen-lockfile
      # Playback gate (§5.2): preview FPS + seek p95 in Chromium on fixed-seed projects.
      - run: pnpm perf:playback   # 1080p single >=60fps/<50ms ; 4-track >=30fps/<100ms ; auto-degrade must trigger
      # Export gate (§10.2): 1080p/30fps reference fixture must encode at >=4x realtime,
      # within 10% of the recorded baseline, peak RSS under the worker ceiling.
      - run: pnpm perf:export
      - run: pnpm perf:emit-trend   # ship to §20 observability so sub-tolerance drift stays visible

  # ---------- Stage 9: Build & publish artifacts (post-merge; does NOT block PR) ----------
  build-artifacts:
    if: github.ref == 'refs/heads/main'
    needs: perf
    runs-on: ubuntu-latest
    permissions: { contents: read, packages: write }
    steps:
      - uses: actions/checkout@v4
        with: { lfs: true }
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm --filter @videoforge/web build       # web static -> dist/
      - uses: docker/setup-buildx-action@v3
      - uses: docker/login-action@v3
        with: { registry: ghcr.io, username: ${{ github.actor }}, password: ${{ secrets.GITHUB_TOKEN }} }
      - run: docker buildx build -f apps/api/Dockerfile    -t ghcr.io/${{ github.repository }}-api:${{ github.sha }}    --push .
      # worker Dockerfile asserts sha256(ffmpeg) == fixtures/ffmpeg.lock.json at build time
      - run: docker buildx build -f apps/worker/Dockerfile -t ghcr.io/${{ github.repository }}-worker:${{ github.sha }} --push .

  # ---------- Stage 8: Conditional security scan ----------
  security:
    if: github.event_name == 'pull_request'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - id: changed
        run: echo "hit=$(git diff --name-only origin/${{ github.base_ref }}... | grep -Eq '^(apps/api/src/(auth|upload|export)|packages/.*(auth|upload|export))' && echo yes || echo no)" >> "$GITHUB_OUTPUT"
      - if: steps.changed.outputs.hit == 'yes'
        run: pnpm exec semgrep --config .semgrep.yml --error
```

> The nightly full-e2e job (Stage 7) lives in a separate `nightly.yml` triggered on `schedule:`; in MVP it runs the same Chromium journeys plus longer fixtures and emits drift to §20. The Chromium/Firefox/WebKit matrix + `ffmpeg.wasm` fallback assertions are added in Phase 1 when those code paths exist.


---

## 5. Design → Code Handoff (where the provided design plugs in)

This is the seam where the **user-supplied visual design** enters the codebase. The rest of this pipeline document treats the design as a pluggable input: engineering builds the editor against a single source-of-truth **tokens contract** and a fixed **component inventory**, and the real design fills that contract in. The goal of this section is to make that handoff explicit and *non-blocking* — engineering proceeds against stubbed tokens and placeholder visuals, and the design lands as a token file + screen specs without requiring component rewrites.

Scope is MVP / Phase 0 only (see `MVP_Scope.md` §2, §3.11 UI Shell, §6 tech stack, §7 milestones M0–M4). The design covers exactly six screens: **auth, dashboard, new-project modal, editor shell, export modal, browser-gate**. Everything deferred in `MVP_Scope.md` §4 (collaboration avatars/presence, billing/upgrade surfaces, AI caption editor depth, stock-media browser, mobile/touch) is explicitly **out of design scope** and is stubbed or hidden in the UI shell.

> **Status note (2026-06-01):** The authoritative design source `docs/_design/Design_Instructions_MVP.md` referenced below (its §2 is the token spec) **has not yet been supplied** — `docs/_design/` is currently empty. This section therefore defines the contract the design must satisfy *and* the placeholder regime that keeps M1–M4 unblocked until it arrives. Engineering builds against the stub tokens in §5.2; when the real file lands, the only diff is the values inside one tokens file plus redline-driven spacing fixes.

### 5.1 Handoff workflow overview

The design flows through one funnel: a human-authored design source → a machine-readable token file → a generated tokens module → Tailwind theme + CSS custom properties → primitives → composites → screens, gated by Storybook states and a visual-regression check, and signed off by a design-review gate before merge.

```mermaid
flowchart LR
  A["Design source\nDesign_Instructions_MVP.md §2\n+ screen specs + redlines"] --> B["tokens.json\n(single source of truth)\npackages/ui/tokens/tokens.json"]
  B --> C["Style Dictionary build\npnpm tokens:build"]
  C --> D1["tailwind.tokens.ts\n(Tailwind theme extend)"]
  C --> D2[":root CSS custom props\ntokens.css"]
  C --> D3["tokens.ts\n(typed TS constants)"]
  D1 --> E["Primitives\npackages/ui/src/primitives"]
  D2 --> E
  D3 --> E
  E --> F["Composites\npackages/ui/src/composite"]
  F --> G["Screens\napps/web/src/screens"]
  E --> H["Storybook\n(every component state)"]
  F --> H
  H --> I["Visual-regression gate\nPlaywright snapshot / Chromatic"]
  I --> J["Design-review gate\n(before merge)"]
  G --> J
```

**Pipeline-stage placement.** The tokens build (`pnpm tokens:build`) runs as a prebuild step on both `apps/web` and Storybook, and as a verification job in CI **stage 1 (Static)** of `MVP_Scope.md` §8 / Spec §22.7 — a drifted/uncommitted generated artifact fails the build the same way a `tsc` error does. The visual-regression check joins **stage 4/5** alongside the e2e and golden-frame gates. Crucially, design artifacts are *never* on the export-fidelity path: the §22.3 golden-frame gate asserts exported pixels, which are produced server-side by FFmpeg from the project JSON and are completely independent of the editor's CSS/tokens. A token change can never move a golden frame, and a design regression can never mask an export-fidelity regression.

### 5.2 Design tokens → single source of truth → Tailwind + CSS variables

#### 5.2.1 What the design provides (the token contract)

The design supplies tokens in `Design_Instructions_MVP.md §2`, transcribed verbatim into one machine-readable file. That file is the **single source of truth** for all visual constants. No raw hex, px, or font string is allowed anywhere else in the codebase (an ESLint rule enforces this — see §5.7).

`packages/ui/tokens/tokens.json` (W3C Design Tokens Community Group format, consumed by Style Dictionary):

```jsonc
{
  "color": {
    "bg":      { "app": { "$value": "#1A1A2E" },   // editor surround (Spec §2.1, never exported)
                 "canvas": { "$value": "#111111" }, // default project canvas bg (Spec §2.2 / §11.1)
                 "panel": { "$value": "#16213E" },
                 "elevated": { "$value": "#0F1729" } },
    "fg":      { "default": { "$value": "#E8E8F0" }, "muted": { "$value": "#9090A8" } },
    "accent":  { "default": { "$value": "#4F7CFF" }, "hover": { "$value": "#6B91FF" } },
    "selection": { "$value": "#4F7CFF" },           // 8-handle bounding box (Spec §2.2)
    "snapline":  { "$value": "#FF8A3D" },           // orange snap line (Spec §3.5)
    "track":   { "video": { "$value": "#3B5BDB" }, "audio": { "$value": "#2F9E44" },
                 "overlay": { "$value": "#9C36B5" }, "caption": { "$value": "#E8590C" } },
    "status":  { "ready": { "$value": "#2F9E44" }, "processing": { "$value": "#F08C00" },
                 "error": { "$value": "#E03131" } }
  },
  "space":   { "0": { "$value": "0px" }, "1": { "$value": "4px" }, "2": { "$value": "8px" },
               "3": { "$value": "12px" }, "4": { "$value": "16px" }, "6": { "$value": "24px" } },
  "radius":  { "sm": { "$value": "4px" }, "md": { "$value": "8px" }, "lg": { "$value": "12px" } },
  "font":    { "family": { "ui": { "$value": "Inter, system-ui, sans-serif" },
                           "mono": { "$value": "'JetBrains Mono', monospace" } },
               "size":   { "xs": { "$value": "12px" }, "sm": { "$value": "13px" },
                           "md": { "$value": "14px" }, "lg": { "$value": "16px" } } },
  "layout":  { // fixed editor band sizes, Spec §2.1 — design may restyle but NOT resize these
               "topbar":     { "$value": "56px" },
               "transport":  { "$value": "48px" },
               "statusbar":  { "$value": "28px" },
               "leftpanel":  { "$value": "280px" },
               "rightpanel": { "$value": "300px" },
               "timeline":   { "$value": "260px" },
               "trackheader":{ "$value": "180px" } },
  "z":       { "canvas": { "$value": 1 }, "panel": { "$value": 10 },
               "topbar": { "$value": 100 }, "modal": { "$value": 1000 }, "toast": { "$value": 1100 } },
  "motion":  { "fast": { "$value": "120ms" }, "base": { "$value": "200ms" },
               "ease": { "$value": "cubic-bezier(0.4,0,0.2,1)" } }
}
```

The values above are the **placeholder stub** (see §5.6) — they are real, working, internally-consistent dark-theme values keyed off the few hard constants the spec already fixes (the `#1A1A2E` editor surround and `#111111` canvas default from Spec §2.1/§2.2, the fixed band sizes from Spec §2.1). They let M1–M4 build and ship a coherent (if un-branded) editor before the design arrives. When `Design_Instructions_MVP.md §2` lands, every `$value` is overwritten with the designed value; structure and key names do not change.

#### 5.2.2 The build step (tokens → Tailwind + CSS vars + TS)

One command, `pnpm tokens:build` (a Style Dictionary run), transforms `tokens.json` into three generated, git-committed, never-hand-edited artifacts:

| Generated file | Consumed by | Form |
| --- | --- | --- |
| `packages/ui/tokens/generated/tailwind.tokens.ts` | `tailwind.config.ts` via `theme.extend` | TS object: `colors`, `spacing`, `borderRadius`, `fontFamily`, `fontSize`, `zIndex` |
| `packages/ui/tokens/generated/tokens.css` | imported once in `apps/web` root + `.storybook/preview` | `:root { --color-accent: #4F7CFF; --layout-topbar: 56px; ... }` |
| `packages/ui/tokens/generated/tokens.ts` | runtime TS that needs a value (e.g. canvas compositor surround color) | `export const tokens = { color: { accent: '#4F7CFF' }, ... } as const` |

Two consumption modes, by design:

- **Static styling → Tailwind classes.** Components use `bg-panel`, `text-muted`, `gap-2`, `rounded-md`, `z-topbar`. Tailwind's theme is extended *only* from the generated token object — `tailwind.config.ts` contains no literal values:

  ```ts
  // apps/web/tailwind.config.ts
  import { tokens } from "@videoforge/ui/tokens/generated/tailwind.tokens";
  export default {
    content: ["./src/**/*.{ts,tsx}", "../../packages/ui/src/**/*.{ts,tsx}"],
    theme: { extend: { ...tokens } },
  };
  ```

- **Dynamic / runtime-themable values → CSS custom properties.** Anything that could be re-themed at runtime, or read by non-CSS code (the WebCodecs→Canvas compositor needs the editor-surround color, Spec §5.1), reads the CSS variable or the typed `tokens.ts`. The `var(--…)` indirection is what lets a future light theme or per-workspace branding (Phase 1+) swap a `:root` block with zero component changes.

> **Layout-band tokens are restyle-only, not resize.** `layout.*` tokens (topbar 56px, transport 48px, etc.) are emitted as both Tailwind spacing and CSS vars, but the canvas-area height formula in Spec §2.1 (`viewportHeight − 56 − 48 − timeline − 28`) and the export-fidelity invariant do **not** depend on them being any particular value — they depend on the bands *summing* to the viewport. The design may recolor and restyle the bands freely; if it proposes different band heights it must update these tokens AND the formula consumers in one PR, flagged in design review (§5.6).

### 5.3 Component build order: design inventory → `packages/ui`

Components are built **bottom-up** so the visual-regression and Storybook gates have something stable to assert against before screens are assembled. The design's component inventory (`Design_Instructions_MVP.md` component list) maps onto three layers under `packages/ui/src/`:

| Order | Layer | Location | Components (MVP) | Depends on |
| --- | --- | --- | --- | --- |
| 1 | **Primitives** | `packages/ui/src/primitives/` | `Button`, `IconButton`, `Input`, `NumberInput`, `Select`, `Slider`, `Toggle`, `Checkbox`, `Tooltip`, `Tabs`, `Dialog`/`Modal`, `Toast`, `Icon`, `Spinner`, `ProgressBar`, `Avatar` (initials only — no presence), `Menu`/`ContextMenu` | tokens only |
| 2 | **Composite** | `packages/ui/src/composite/` | `Panel`, `PanelHeader`, `Toolbar`, `TransportBar`, `ClipBlock`, `TrackHeader`, `TrackRow`, `Ruler`, `Playhead`, `MediaCard`, `PropertyRow`, `KeyframeRow`, `CaptionRow`, `EmptyState`, `FormField`, `FileDropzone`, `NotificationBell` | primitives + tokens |
| 3 | **Screens** | `apps/web/src/screens/` | composed from composites (see §5.5 mapping) | composites |

**Conventions, so the design plugs in cleanly:**

- Every component reads visuals exclusively through tokens (Tailwind classes or `var(--…)`). No literal colors/sizes in component source.
- Components are **presentational** in `packages/ui`; data and store wiring live in `apps/web`. The design can therefore be reviewed and visually-tested in isolation without a backend.
- Stable `data-testid` hooks are added at build time, matching the Spec §22.2 contract (`data-testid="clip-{clipId}"`, transport buttons, export-modal controls). Visual-regression and e2e selectors never key on CSS class or visible text.
- Performance-sensitive components keep their structure regardless of styling: `ClipBlock` is `React.memo` keyed `clipId`, thumbnail strips use CSS `background-position` against the sprite sheet (Spec §15.3 / `MVP_Scope.md` §3.1) — the design supplies the *look*, never a structure that breaks virtual scroll or per-frame `<img>`.

### 5.4 Storybook (component states) + visual-regression gate

#### 5.4.1 Storybook

Storybook (`pnpm storybook`, built by `pnpm build-storybook`) is the canonical surface where the design's specified component **states** are enumerated and reviewed. Every primitive and composite ships a `.stories.tsx` covering the full state matrix the design must define:

- interaction states: `default`, `hover`, `focus-visible`, `active`, `disabled`, `loading`;
- data states: `empty`, `populated`, `overflow/truncated`, `error`;
- domain states for editor composites: `ClipBlock` → `{selected, unselected, trimming, linked-audio, muted, processing}`; `TrackHeader` → `{video, audio, overlay, caption} × {muted, solo, normal}`; `MediaCard` → `{uploading, processing, ready, error}` mapping the asset lifecycle (Spec §4.2).

Storybook imports `tokens.css` in `.storybook/preview.ts`, so stories render against the exact same tokens as the app — it is the design's review canvas and the visual-regression gate's fixture source in one.

#### 5.4.2 Visual-regression gate

Visual regression is a **CI merge gate** (joins Spec §22.7 stage 4/5), implemented one of two ways — pick at M2 when the design first lands:

| Option | Mechanism | When to choose |
| --- | --- | --- |
| **Playwright snapshot** (default for MVP) | `@playwright/test` `toHaveScreenshot()` against Storybook stories + the six screens, Chromium-only, masked dynamic regions (timecodes, dates) | Self-hosted, free, no external dependency, consistent with the §22.2 Playwright stack we already run |
| **Chromatic** | Hosted Storybook snapshots with per-story review/approval UI | If the (separately-provided) design team wants a hosted approval workflow |

Rules mirror the golden-frame discipline (Spec §22.3): snapshots are committed, an intentional visual change is an explicit reviewed `--update-snapshots` commit (never an incidental diff), and a breach attaches before/after/diff images as CI artifacts. Because the preview canvas is GPU/driver-dependent (Spec §22.1/§5.1), visual-regression covers **chrome and component CSS only** — it never snapshots the WebCodecs preview canvas or the FFmpeg export (those are owned by the golden-frame gate). Dynamic content (current time, durations, signed URLs) is masked so the gate fails only on real visual drift.

### 5.5 Screen → route → component mapping (MVP)

The six designed screens map to routes in `apps/web` and to the composite components above. This table is the contract the design's screen specs and redlines must fill.

| Screen | Route | Top-level component | Composes | Spec / scope ref |
| --- | --- | --- | --- | --- |
| **Auth** (login / signup / reset) | `/login`, `/signup`, `/reset` | `AuthScreen` | `FormField`, `Input`, `Button`, Google-OAuth `Button`, `Toast` | `MVP_Scope.md` §3.10; Spec §17.1 |
| **Browser-gate** | route guard (any route on Safari/Firefox) | `BrowserGate` | `EmptyState`, `Icon`, `Button` (copy: "VideoForge needs Chrome or Edge") | `MVP_Scope.md` §3.11; Spec §15.1 |
| **Dashboard** | `/projects` | `DashboardScreen` | `MediaCard`/project-card grid, `EmptyState` (onboarding funnel), `Toolbar`, `Menu` (open/duplicate/delete), new-project CTA | `MVP_Scope.md` §3.9, §3.11; Spec §11.1 |
| **New-project modal** | `/projects` + `?new` (modal route) | `NewProjectModal` | `Dialog`, `Select` (aspect 9:16 default / 16:9 / 1:1), `Input` (title), `Button` | `MVP_Scope.md` §3.9, §3.11; Spec §2.2, §11.1 |
| **Editor shell** | `/projects/:projectId` | `EditorShell` (five-band layout) | top bar (`Toolbar`+logo+title-edit+undo/redo+export CTA), left `Panel` (Videos/Audio/Images/Text/Captions tabs), canvas area (`CanvasViewport`+overlay handles), `TransportBar`, timeline (`Ruler`+`Playhead`+`TrackRow`/`TrackHeader`/`ClipBlock`), right `Panel` (properties / caption editor), status bar, `NotificationBell` | `MVP_Scope.md` §3.11; Spec §2.1, §2.2 |
| **Export modal** | `/projects/:projectId` + `?export` (modal route) | `ExportModal` | `Dialog`, `Tabs` (Format & Quality \| Captions), `Select` (presets: TikTok/Reels, IG, YouTube 1080p), pre-flight estimate (`PropertyRow`), `ProgressBar`, `Button` | `MVP_Scope.md` §3.8, §3.11; Spec §10.1, §10.2 |

**Deferred surfaces the design must NOT include (stub/hide in the shell):** collaboration avatars & presence in the top bar, any plan/upgrade/billing CTA, the AI caption-generation panel, stock-media browser tabs, history/markers/queue panels, mobile/touch layouts. These are `MVP_Scope.md` §4 cuts; the shell renders without them, and the design spec should mark them out of scope so redlines don't arrive for screens we are not building.

### 5.6 What we need FROM the design, and how missing/changed design is handled

#### 5.6.1 Required artifacts (the inbound checklist)

For the handoff to be complete, the design must deliver:

| Artifact | Format / location | Consumed by |
| --- | --- | --- |
| **Token file** | `Design_Instructions_MVP.md §2`, transcribed into `packages/ui/tokens/tokens.json` (the schema in §5.2.1 is the contract — same keys, real values) | `pnpm tokens:build` → Tailwind + CSS vars + TS |
| **Screen specs** | One spec per screen in §5.5 (six total): layout, spacing, typography, copy, responsive behavior within the desktop range | `apps/web/src/screens/*`, screen-level VR snapshots |
| **Component states** | Full state matrix per §5.4.1 for every primitive/composite | `*.stories.tsx`, component-level VR snapshots |
| **Redlines** | Per-component spacing/size/color callouts (px against the token scale) | implementation + design-review verification |
| **Iconography** | SVG set (or named set, e.g. Lucide) mapped to the `Icon` primitive's name union | `Icon` primitive |
| **Empty/error states** | Visuals + copy for dashboard empty, browser-gate, upload/processing/export error (Spec §16) | `EmptyState`, `Toast`, error screens |

#### 5.6.2 Engineering is never blocked on the design

The placeholder regime guarantees M1–M4 proceed whether or not the design has landed:

1. **Stub tokens ship from day one.** `tokens.json` holds the working placeholder values in §5.2.1. The editor is fully functional and coherent on stub tokens — only un-branded. This is the current state (see the §5 status note): `docs/_design/` is empty, so the stub is live.
2. **Placeholder components are real, not mocks.** Primitives/composites are built to the spec's *behavioral* contract (sizes from Spec §2.1, states from §5.4.1) using stub tokens. When the design arrives, behavior is unchanged; only token values and redline-driven spacing tweaks differ.
3. **A token diff is the unit of design change.** Because nothing hard-codes a visual constant (enforced in §5.7), applying the real design is overwhelmingly a one-file `tokens.json` overwrite + `pnpm tokens:build`, plus targeted redline fixes. No component refactor.
4. **Changed design = re-run the pipeline.** A later redesign or token revision flows through the *same* funnel: edit `tokens.json` / screen specs → `pnpm tokens:build` → Storybook re-renders → VR gate flags every visual delta → design review approves the snapshot update. The VR gate makes "what changed visually" reviewable rather than guessed.
5. **Structural design proposals are escalated, not silently absorbed.** If the design changes a fixed band size (Spec §2.1), a `data-testid` contract (Spec §22.2), or proposes a deferred surface (`MVP_Scope.md` §4), it is rejected at design review as out-of-MVP-scope or routed through a layout-formula update PR — never quietly merged.

### 5.7 Guardrails (lint + CI)

- **No-magic-values lint.** An ESLint rule (`no-restricted-syntax` on hex/`rgb(`/`px` literals in `className`/style positions) fails any component that bypasses tokens. Allowed only inside `packages/ui/tokens/` generated files.
- **Tokens-in-sync check.** CI stage 1 re-runs `pnpm tokens:build` and fails if the committed generated files differ from the freshly built output (a drifted generated artifact = red build, like a stale lockfile).
- **Analytics-name check stays green.** UI work must not break the typed `analytics.track()` union (`packages/analytics/events.ts`, Spec §20.3.2) — screen instrumentation (`project_created`, `export_started`, `export_completed`, `feature_gate_hit`) is wired in `apps/web`, not in `packages/ui`, so presentational components carry no analytics coupling.
- **a11y baseline.** Storybook runs the `@storybook/addon-a11y` axe check; primitives ship with focus-visible states and ARIA roles so the design's visual focus treatment maps onto a real keyboard-operable component (supports the Spec §13 shortcut surface).

### 5.8 Design-review gate (before merge)

A **design review** is a required, non-CI-automatable approval that runs in parallel with the §22.7 automated stages and blocks merge for any PR touching `packages/ui/`, `apps/web/src/screens/`, or `tokens.json`.

| Gate input | Pass condition |
| --- | --- |
| Visual-regression result | Green, or snapshot update explicitly approved by a reviewer (Spec §22.7 baseline-update discipline) |
| Storybook state coverage | Every state in the §5.4.1 matrix exists as a story for changed components |
| Redline conformance | Spacing/size/color match the supplied redlines against the token scale (spot-checked in Storybook) |
| Token discipline | No-magic-values lint green; tokens-in-sync check green |
| Scope conformance | No deferred (`MVP_Scope.md` §4) surface introduced; no fixed-band resize without the paired layout-formula PR |
| Sign-off | A `design-approved` label applied by the design owner (or, until the design is supplied, by the eng owner against the stub-token contract) |

> **Until the real design lands**, the design-review gate runs against the §5.2.1 stub-token contract and the behavioral specs — it verifies token discipline, state coverage, and scope, not brand fidelity. When `Design_Instructions_MVP.md §2` is delivered, the same gate flips to verifying redline/brand conformance with no change to the workflow.

### 5.9 Integration checklist

Mark complete when the supplied design is fully plugged in:

- [ ] `Design_Instructions_MVP.md §2` tokens transcribed into `packages/ui/tokens/tokens.json` (placeholder values replaced, key structure unchanged).
- [ ] `pnpm tokens:build` runs clean; `tailwind.tokens.ts`, `tokens.css`, `tokens.ts` regenerated and committed.
- [ ] `tailwind.config.ts` extends only from generated tokens; zero literal visual values remain (no-magic-values lint green).
- [ ] All six screens (§5.5) implemented at their routes from the supplied screen specs.
- [ ] Primitives + composites (§5.3) implemented; each has a `.stories.tsx` covering the §5.4.1 state matrix.
- [ ] Iconography set wired into the `Icon` primitive name union.
- [ ] Empty/error states (dashboard, browser-gate, upload/processing/export errors per Spec §16) designed and implemented.
- [ ] `data-testid` contract (Spec §22.2) preserved on clips, tracks, transport, export modal.
- [ ] Visual-regression gate enabled in CI (Playwright snapshot or Chromatic), baselines committed, dynamic regions masked.
- [ ] Layout bands still sum to the viewport per Spec §2.1; any band-size change paired with a layout-formula PR.
- [ ] No deferred (`MVP_Scope.md` §4) surface introduced by the design.
- [ ] Activation-funnel events (`project_created → clip_added → export_started → export_completed`, Spec §20.3.2) still fire from `apps/web` after the UI swap.
- [ ] a11y axe check green on all stories; focus-visible states present.
- [ ] Design-review gate passed with `design-approved` label on the merge PR.
- [ ] Export-fidelity golden-frame gate (Spec §22.3 / `MVP_Scope.md` §8) unaffected and still green — confirms the design touched only chrome, never the export path.


---

## 6. Release, Environments & Operations

> This part of the **Build & Delivery Pipeline** covers how VideoForge ships and runs in **MVP / Phase 0** only (see `docs/MVP_Scope.md` — §6 tech stack, §7 milestones M0–M4, §8 perf/fidelity gates). It is deliberately lean: a single-user, Free-tier-only, Chrome/Edge-only editor with one render queue and one FFmpeg worker pool. Where the spec defines a richer production posture, this section references it rather than duplicating it and explicitly marks what is **deferred**: full RUM/tracing/SLO alerting (`VideoForge_Spec_v1.1.md` §20), the Stripe/entitlements surface (§21), and the multi-region/HPA render fleet (§20.5.2). The contract that gates every release is the same as everywhere else in this doc — the **export-fidelity gate** and the **perf gates** of `MVP_Scope.md` §8, enforced as CI stages 1–6 (§22.7).
>
> **Design → code handoff.** This is an operations section, so the supplied visual design plugs in at exactly three seams, each flagged inline with **[DESIGN HOOK]**: (a) the **per-PR preview deploy** is where designers review live UI against a real backend; (b) the **feature-flag seams** are where deferred-feature UI (billing, collaboration) is dark-shipped and toggled without a redeploy; (c) the **status/incident surfaces** (export progress, browser gate, degrade banner) read operational state the runbook here produces. None of these require the design to know the deploy mechanics — they consume a stable contract (a preview URL, a flag name, a state enum).

---

### 6.1 Scope at a glance

| Concern | MVP (Phase 0) decision | Deferred (phase) | Spec anchor |
|---|---|---|---|
| Branching | Trunk-based; short-lived branches; conventional commits; squash-merge | Release branches / trains | — |
| Release cadence | Continuous to `staging` on merge; manual promote to `production` | Scheduled release windows | — |
| Environments | `local`, `ci`, `staging`, `production` | Per-region prod, dedicated render pool | §20.5.2, §15.2 |
| Object storage | **MinIO** (local-disk S3 double) in `local`/`ci`; real **S3** in `staging`/`production` | Multi-region buckets, CDN tiers | `MVP_Scope.md` §6 |
| Render workers | **One** containerized, **pinned-FFmpeg** worker (pool size 1–2) | K8s HPA on `queue_depth`, `export_long` queue | §20.5.2 |
| Observability | **Sentry** + the minimal TTFE/fidelity funnel events | Prometheus/Grafana, OTel tracing, multi-burn SLOs | §20 (full) |
| Billing | Stripe **stubbed**; Free-tier constants only | Stripe Checkout/Portal/webhooks, entitlements | §21 |
| Feature flags | Static env-driven flags as **deferred-feature seams** | LaunchDarkly-style runtime targeting | §3.x deferred rows |
| Backups | Postgres PITR (managed) + S3 versioning; **7-day export expiry** | Cross-region replication, cold archive | §10.2, §15.3 |

---

### 6.2 Branching, PRs & release strategy

**Trunk-based with short-lived branches.** `main` is always releasable and always green at CI stages 1–6 (`VideoForge_Spec_v1.1.md` §22.7). Branches live hours-to-days, never weeks; there are no long-lived `develop`/`release` branches in MVP.

- **Branch naming:** `<type>/<scope>-<slug>` — e.g. `feat/export-watermark-overlay`, `fix/audio-link-split-desync`, `chore/ci-golden-cache`. `type` matches the conventional-commit type.
- **Conventional commits** are mandatory and machine-checked (`commitlint`): `feat`, `fix`, `perf`, `refactor`, `test`, `docs`, `build`, `ci`, `chore`. A breaking change uses `!` (`feat!:`) or a `BREAKING CHANGE:` footer — load-bearing because the **§18 project JSON `schemaVersion`** must bump deliberately, never accidentally.
- **PR rules:** one logical change per PR; squash-merge only (the squashed subject becomes the conventional-commit log entry). Every PR links its **Given/When/Then** acceptance scenarios (§22.8) and the CI tier that proves them. A PR that moves a golden frame or a perf baseline carries the `baseline-change` label and needs explicit reviewer approval (§22.7).
- **Versioning & changelog:** semantic versioning driven from the commit log. `feat` → minor, `fix`/`perf` → patch, `!`/`BREAKING CHANGE` → major. MVP stays in `0.x`; the changelog is generated, not hand-written.

```bash
# Conventional history → version + changelog (run in CI on merge to main)
npx commitlint --from "$BEFORE_SHA" --to "$GITHUB_SHA"   # gate: stage 1 (static)
npx changesets version                                   # or: npx semantic-release --dry-run
```

**Merge gate vs. release gate.**

| Gate | Requires | Effect |
|---|---|---|
| **Merge gate** (per PR → `main`) | CI stages **1–6** green (typecheck/lint, unit, integration incl. export-command builder, e2e Chromium subset, **golden-frame SSIM/PSNR**, **perf gates**) | PR may squash-merge |
| **Release gate** (promote → `production`) | Stage **7** (nightly full e2e matrix) green on affected journeys + zero open `@flaky`-quarantined tests + green `staging` smoke | Promotion allowed |

---

### 6.3 Per-PR preview deploys  **[DESIGN HOOK a]**

Every PR gets an ephemeral, full-stack preview environment so the **separately-supplied visual design can be reviewed against a real backend** before merge — the canonical design→code review surface.

- **What deploys:** the Vite frontend (static) + the Fastify API + a single FFmpeg worker + Redis + Postgres + **MinIO**, brought up as one `docker compose` project namespaced by PR number. No real S3, no real email — preview is a self-contained replica of `local`.
- **Seeding:** the database is migrated and seeded from `fixtures/manifest.json` (the same CC0 media keyed by MD5 used by the golden-frame harness, §22.6), so a designer can immediately import → rough-cut → export against known assets and see real watermark/caption/proxy-downgrade UI.
- **URL contract:** `https://pr-<number>.preview.videoforge.dev`. The CI bot comments the URL plus a one-line "what changed visually" note on the PR. **[DESIGN HOOK a]** Designers only need this URL; they never touch the deploy machinery.
- **Lifecycle:** created on PR open, redeployed on each push, **torn down on close/merge** (a nightly `cron` GC also reaps previews older than 7 days). Preview exports are written to the PR-namespaced MinIO bucket and expire with the environment.

```bash
# Preview bring-up (CI, on pull_request: opened|synchronize)
export COMPOSE_PROJECT_NAME="vf-pr-${PR_NUMBER}"
docker compose -f deploy/compose.preview.yml up -d --build
pnpm --filter @videoforge/db migrate deploy
pnpm --filter @videoforge/db seed --manifest fixtures/manifest.json   # CC0 media, MD5-keyed
# teardown (on pull_request: closed)
docker compose -f deploy/compose.preview.yml down -v
```

---

### 6.4 Environments & what differs

Four environments. The **only** things that differ are the four axes the MVP risk model cares about — object storage, worker count, data realism, and telemetry destination. Everything else (the project JSON schema, the FFmpeg build, the command builder, the Free-tier constants) is **identical by construction** so that "what you cut is what you get" holds the same way everywhere.

| Axis | `local` | `ci` | `staging` | `production` |
|---|---|---|---|---|
| Object storage | MinIO (docker, `./.data/minio`) | MinIO (ephemeral) | **AWS S3** (staging bucket) | **AWS S3** (prod bucket) |
| `S3_ENDPOINT` | `http://localhost:9000` | `http://minio:9000` | (AWS default) | (AWS default) |
| FFmpeg build | **pinned** (lockfile) | **pinned** (lockfile) | **pinned** (lockfile) | **pinned** (lockfile) |
| Render workers | 1 (same container) | 1 (per job, throwaway) | 1 | **pool 1–2** (no HPA) |
| Data | dev fixtures + scratch | seeded fixtures, reset per run | seeded fixtures + opt-in real | **real user data** |
| Postgres | docker volume | ephemeral | managed (PITR on) | managed (PITR on) |
| Auth | local JWT secret; Google OAuth **test** client | stub auth where possible | Google OAuth **test/staging** client | Google OAuth **prod** client |
| Stripe | **stubbed** | **stubbed** | **stubbed** | **stubbed** (Free-only at launch) |
| Sentry | disabled (or `dev` project) | disabled | `staging` project | `production` project |
| Funnel events | console sink | asserted in tests | real sink | real sink |
| Email | logged to console | disabled | sandbox (Mailpit) | real provider |
| Watermark | applied (Free) | applied (asserted) | applied | applied |

**MinIO ↔ S3 parity rule.** Both are driven through the same AWS SDK v3 client; the *only* code difference is `S3_ENDPOINT` + `forcePathStyle: true` for MinIO. The presign/upload/lifecycle paths (`MVP_Scope.md` §3.1, §3.8) must never branch on which one is behind the endpoint — this keeps the upload and 7-day-export flows tested against the same code in CI as in prod.

```bash
# .env.local (MinIO double) — see deploy/compose.local.yml
S3_ENDPOINT=http://localhost:9000
S3_FORCE_PATH_STYLE=true
S3_REGION=us-east-1
S3_BUCKET_ORIGINALS=vf-originals
S3_BUCKET_PROXIES=vf-proxies
S3_BUCKET_EXPORTS=vf-exports
AWS_ACCESS_KEY_ID=minioadmin
AWS_SECRET_ACCESS_KEY=minioadmin
# production differs ONLY in: unset S3_ENDPOINT/S3_FORCE_PATH_STYLE, real bucket names, IAM role creds
```

---

### 6.5 Secrets management

MVP keeps secrets out of source and out of the project JSON entirely (the export FFmpeg command references only validated UUIDs, never interpolated secrets — `VideoForge_Spec_v1.1.md` §17.4).

| Secret class | `local`/`ci` source | `staging`/`production` source | Rotation |
|---|---|---|---|
| `DATABASE_URL` | `.env.local` / CI env | platform secret store (e.g. SSM/Secrets Manager) | on incident |
| `REDIS_URL` | `.env.local` / CI env | platform secret store | on incident |
| S3 / MinIO creds | static dev keys | **IAM role** (no long-lived keys in prod) | role-managed |
| `JWT_SECRET`, refresh-cookie key | per-dev `.env.local` | secret store; distinct per env | 90 days |
| `GOOGLE_OAUTH_CLIENT_SECRET` | test client | per-env client in secret store | as needed |
| `SENTRY_DSN` + `SENTRY_AUTH_TOKEN` (source-map upload) | disabled | secret store | n/a / on leak |
| `STRIPE_*` | **stub key** (`sk_stub_…`, never a real key) | **stub key** at launch | n/a (Free-only) |

Rules: `.env*` is git-ignored; a committed `.env.example` documents every variable name (no values). CI injects secrets from the platform store, never echoes them, and source-map upload to Sentry uses a short-lived `SENTRY_AUTH_TOKEN` scoped to the release. A leaked-secret incident is a P1 (see runbook, §6.9).

---

### 6.6 Observability hooks (MVP-minimal)

MVP ships the **minimum** of `VideoForge_Spec_v1.1.md` §20: **Sentry** for client+server errors, and the two funnel event streams that measure the two north-star metrics — **TTFE** (adoption) and **fidelity** (trust). Full RUM, OpenTelemetry tracing, Prometheus/Grafana, and multi-burn-rate SLOs are **deferred** (§20.1, §20.2, §20.5–§20.8). We still emit a small set of backend counters/gauges so the render-pipeline dashboards below have data — scraped by a single lightweight Prometheus, no remote-write fan-out.

**Error tracking (Sentry, per §20.4 — minimal subset).**
- `@sentry/react` on the client with React error boundaries around editor shell, timeline, and preview canvas (a crash degrades gracefully per §16, never white-screens). `@sentry/node` on API + worker.
- Hidden source maps uploaded at deploy time, keyed by `release = <gitSha>`; never served to browsers.
- `beforeSend` scrubs tokens/PII; the Sentry user is `userIdHash` (salted SHA-256), never raw email. **No project JSON, no caption text, no media frames** ever leave the client (§20.9).
- WebGL context-loss, `VideoDecoder` errors, and `AudioContext` failures captured as breadcrumbs/events — they map to the §16 degradations. **Session Replay is OFF in MVP** (deferred; privacy + cost).

**Funnel events (the only product analytics in MVP).** A typed `analytics.track(event, props)` facade with a compile-time union (§20.3). MVP carries a *subset* of the §20.3.2 catalog — exactly the events needed to compute TTFE and to attribute fidelity/export failures.

| Event (MVP subset) | Fires when | Why it's in MVP |
|---|---|---|
| `project_created` | `POST /api/v1/projects` | TTFE funnel start |
| `clip_added` | clip dropped on timeline | activation step |
| `export_started` | `POST /api/v1/exports` accepted (`QUEUED`) | funnel + queue-wait clock start |
| `export_completed` | `export:complete` WS event | **TTFE end**; carries `wallClockMs`, `renderMs`, `queueWaitMs`, `outputBytes` |
| `export_failed` | export reaches `FAILED` | carries `failureStage`, `errorCode` → fidelity/abuse triage |
| `export_downloaded` | authenticated download served | confirms a *usable* first export |
| `feature_gate_hit` | blocked by a Free-tier limit (`gate` ∈ `export_resolution`\|`duration`\|`tracks`\|`rate_limit`) | watches the Free ceilings; one event, dimensioned, so a new limit needs no taxonomy change |

> **TTFE is derived, not a single event:** `median( export_completed.clientTs − project_created.clientTs )` for first-session projects, plus `% of first sessions reaching export_completed` (`MVP_Scope.md` §1, target < 10 min / > 70%). The **fidelity** north-star is *not* a runtime event — it is the **CI golden-frame pass rate** (§22.3, §22.7 stage 5); the runtime `export_failed{failureStage}` stream only flags regressions that escaped CI.

**Backend metrics that matter for a render pipeline (MVP subset of §20.5.2).** Even minimal, these four are non-negotiable because they are the operational health of the export queue:

| Metric | Type | Why it's MVP-critical |
|---|---|---|
| `videoforge_queue_depth{queue="render"}` | gauge | Backlog visibility; the abuse/starvation early warning |
| `videoforge_job_total{type="export",outcome}` | counter | Job **failure rate** = `failed+timeout / total` |
| `videoforge_job_duration_seconds{type="export"}` | histogram | **Export p95** + real-time-factor vs §8 baseline |
| `videoforge_proxy_generation_seconds` | histogram | Proxy SLA (base 720p ≤ 2× realtime, §8) |

**Dashboards & alerts (MVP).** One Grafana "Render Pipeline" board + a tiny alert set. Alerts route to **Slack** in MVP (PagerDuty paging deferred with the full §20.8 SLO model).

| Dashboard panel / alert | Definition | Threshold (MVP) | Action |
|---|---|---|---|
| Queue depth | `videoforge_queue_depth{queue="render"}` | warn > 25 sustained 5 min | Slack `#vf-ops`; check worker liveness |
| Job failure rate | `rate(job_total{outcome=~"failed\|timeout"}) / rate(job_total)` | warn > 5% over 10 min | Slack; triage `export_failed.failureStage` |
| Export p95 | p95 `job_duration_seconds{type="export"}` | warn if > 1.1× §8 baseline | Slack; suspect a bad release or worker contention |
| Proxy SLA | p95 `proxy_generation_seconds` vs 2× source | warn if breached 30 min | Slack; suspect FFmpeg/worker regression |
| API 5xx | 5xx ratio on `/api/v1/*` | warn > 1% over 5 min | Slack; consider rollback (§6.8) |
| Sentry release spike | issue velocity > 3× baseline on a new `release` | Slack auto-link to release | hold rollout / rollback |

> **[DESIGN HOOK c]** The user-facing operational states the design must render are produced by these hooks: export **progress** (WS `export:progress` %), the export **state enum** `QUEUED → RENDERING → COMPLETE/FAILED` (§10.2), the **proxy-downgrade pre-flight warning** (§10.2), the auto-**degrade** banner (`rum.perf_mode.activated` equivalent, §16.2), and the **Chrome/Edge gate** message. Design consumes these as a stable contract; it does not read metrics.

---

### 6.7 Feature flags — the deferred-feature seams  **[DESIGN HOOK b]**

MVP needs only **static, build/boot-time flags** (env-driven, no runtime targeting service — that is deferred). Their single purpose is to be the clean seam where deferred features (`MVP_Scope.md` §3, §4) are dark-shipped: code paths and **design surfaces** can land behind `false` without forking `main`, and flip on in a later phase with **no schema change and no redeploy of unrelated code**.

| Flag (env var) | Default (MVP) | Guards (deferred feature) | Spec / scope ref |
|---|---|---|---|
| `VF_FLAG_BILLING` | `false` | Stripe Checkout/Portal/upgrade UI; "Remove watermark" stays **locked** | §21 / §3.10 |
| `VF_FLAG_COLLAB` | `false` | CRDT sync, presence, comments, roles | §12 / §3.9 |
| `VF_FLAG_AI_CAPTIONS` | `false` | Whisper auto-caption tier + caption-editor depth | §9.1 / §3.5 |
| `VF_FLAG_VERSIONING` | `false` | auto-versions / named versions / restore | §11.4 / §3.9 |
| `VF_FLAG_WASM_FALLBACK` | `false` | ffmpeg.wasm decode for Safari/Firefox | §15.1 / §3.3 |
| `VF_FLAG_DUCKING` | `false` | sidechain ducking (highest audio parity risk) | §7.1 / §3.4 |

Rules:
- Flags are **typed** in `packages/config/flags.ts` and resolved once at boot (client) / process start (server); the resolved set is attached to the Sentry scope and every funnel event envelope (`appVersion` + flag fingerprint) so behavior is attributable.
- A flag's **OFF** path must be the *whole* product seam, including UI. **[DESIGN HOOK b]** When the design supplies, e.g., the billing upgrade surface, it lands behind `VF_FLAG_BILLING=false` as inert markup; flipping the env var in a later phase reveals it. The MVP-visible counterpart (the **locked** "Remove watermark" row with no upsell, per the design brief) is the `false` branch — not absent code.
- A flag stays for **one phase past** the feature's launch, then the dead branch is deleted (`chore: remove VF_FLAG_X`). Flags are seams, not permanent config.

---

### 6.8 Deploy & rollback flow

Promotion is forward-only through environments; rollback is "redeploy the previous green release," never a forward hotfix under fire (unless the fix is trivial and tested). Frontend (static) and backend/worker (container) ship together under one `release = <gitSha>` so Sentry/log attribution is unambiguous.

```mermaid
flowchart TD
    A[Merge to main<br/>squash, conventional commit] --> B{CI stages 1-6 green?<br/>incl. golden-frame + perf}
    B -- no --> X[Block: main stays releasable<br/>fix forward in a new PR]
    B -- yes --> C[Build release artifacts<br/>tag release = gitSha<br/>upload Sentry source maps]
    C --> D[Auto-deploy to staging]
    D --> E[DB migrate deploy<br/>expand-only, backward-compatible]
    E --> F[Staging smoke:<br/>import to export to download<br/>watermark + fidelity spot-check]
    F -- fail --> R1[Rollback staging<br/>redeploy previous gitSha]
    F -- pass --> G{Release gate?<br/>stage 7 nightly green<br/>+ zero flaky}
    G -- no --> X
    G -- yes --> H[Manual promote to production<br/>same artifact, same gitSha]
    H --> I[Prod DB migrate deploy<br/>expand-only]
    I --> J[Drain render queue?<br/>let in-flight exports finish]
    J --> K[Health: 5xx, queue_depth,<br/>export p95, Sentry velocity]
    K -- regression --> ROLL[ROLLBACK]
    K -- healthy --> DONE[Release done<br/>register deploy in Sentry]

    subgraph ROLLBACK [Rollback]
      direction TB
      ROLL --> S1[Redeploy previous green gitSha<br/>app + worker together]
      S1 --> S2{Migration involved?}
      S2 -- no --> S3[Done: prior release live]
      S2 -- yes --> S4[Expand/contract: prior app<br/>runs on new schema; no down-migration]
      S4 --> S3
    end
```

**Migration discipline (so rollback is always safe).** All Postgres migrations are **expand-only / backward-compatible** within a release pair: add columns/tables, backfill, dual-write; never drop or rename in the same release that starts using the new shape. The *previous* app version must run against the *new* schema. Destructive "contract" migrations ship a release later, only after the old code is gone. This makes rollback a pure artifact swap — **no down-migrations in MVP**.

**In-flight exports during deploy.** The render worker handles `SIGTERM` by finishing the current FFmpeg job (or letting BullMQ re-queue it on the next worker if killed); deploys prefer to **drain** the `render` queue briefly rather than abort a user's export mid-render.

---

### 6.9 Incident-lite runbook

MVP runs an **incident-lite** model: no formal sev-tiering rotation, but a written first-response per failure class so the on-call (whoever is paged in Slack) acts the same way each time. Every alert in §6.6 links here.

| Symptom (alert) | Likely cause | First response | Rollback trigger |
|---|---|---|---|
| API 5xx surge | bad release, DB pool saturation | check Sentry for the new `release`; check `db_pool_in_use` | 5xx > 1% for 5 min after a deploy → **rollback** |
| Export failure-rate spike | FFmpeg regression (bad worker image / unpinned build), corrupt input, OOM | inspect `export_failed.failureStage` + worker logs; confirm **pinned FFmpeg** matches lockfile | failure rate > 10% over 10 min → **rollback worker image** |
| Queue depth climbing | worker down, or abuse (Free export flooding) | verify worker liveness; check per-user rate limit (5/min, §17.4) is firing | worker crash-loop → redeploy previous worker `gitSha` |
| Export p95 regressed | release made the command builder slower, or worker contention | compare p95 to §8 baseline; bisect by `release` | p95 > 1.5× baseline sustained → **rollback** |
| Fidelity regression reported by a user | a parity bug escaped CI golden frames | reproduce against `fixtures/`; if real, **add the failing case to the golden matrix** then fix | n/a (fix-forward + new fixture) |
| Leaked secret | key in logs/commit | rotate the key in the secret store immediately; invalidate sessions if `JWT_SECRET` | P1 — rotate first, post-mortem after |
| Browser-gate bypass / Safari breakage | gate logic regressed | confirm Chrome/Edge unaffected; hotfix the gate | n/a |

**Post-incident:** a short written note in `#vf-ops` (what broke, blast radius, fix, follow-up). If the cause was a fidelity/parity gap, the **mandatory** follow-up is a new committed golden fixture so the same defect can never re-ship — this is how the §1 invariant ("a human cannot find an edit the export disagrees with") stays true operationally.

---

### 6.10 Backup & retention

| Asset class | Store | Backup mechanism | Retention | Spec anchor |
|---|---|---|---|---|
| Project JSON + users + assets/exports rows | Postgres (`JSONB`) | Managed **PITR** (continuous WAL) + nightly snapshot | snapshots 7 days (MVP) | §18, §11 |
| Original uploads (immutable) | S3 `originals/` | **S3 versioning** + lifecycle | retained while referenced; load-bearing for source re-link | §4.2, §10.2 |
| Proxies / thumbnails / waveforms | S3 `proxies/` | regenerable from originals (not backed up) | follows source; recreated on demand | §4.2 |
| **Exports (rendered MP4)** | S3 `exports/` | **not** backed up (re-renderable from project JSON) | **7-day lifecycle expiry**, then auto-deleted | §10.2, §15.3 |
| Sentry events | Sentry | n/a | 90 days (vendor default) | §20.1 |
| Funnel events | warehouse sink | n/a | MVP-minimal | §20.1 |

**7-day export expiry — the load-bearing detail.** An export is **downloadable for 7 days**; the object itself is removed by an S3 **lifecycle rule** keyed on the `exports/` prefix. Within that window, the download URL is a **per-request, 1-hour presigned URL** re-minted on demand by `GET /api/v1/exports/:id` (the frontend handles a `403` by re-fetching a fresh URL) — there is no stored long-lived URL (§10.2, §15.3). This keeps the "7-day product promise" while exports stay cheap to store (they are deterministically re-renderable from the project JSON, so they are never backed up).

```json
// S3 lifecycle on the exports bucket (MinIO honors the same API in local/ci)
{
  "Rules": [{
    "ID": "vf-export-7day-expiry",
    "Filter": { "Prefix": "exports/" },
    "Status": "Enabled",
    "Expiration": { "Days": 7 }
  }]
}
```

```bash
# Apply identically to MinIO (local/ci) and S3 (staging/prod) — same SDK/API
aws s3api put-bucket-lifecycle-configuration \
  --endpoint-url "${S3_ENDPOINT:-https://s3.amazonaws.com}" \
  --bucket "$S3_BUCKET_EXPORTS" \
  --lifecycle-configuration file://deploy/s3/exports-lifecycle.json
```

**Restore drill (MVP).** Two things must be rehearsed before launch: (1) a **Postgres PITR restore** to a scratch instance (verify a project round-trips through save/load and re-validates against the §18 schema), and (2) an **export re-render** from a restored project JSON, asserting it still matches its golden frames — proving exports never needed backing up. Both run on `staging` and are checked off in M3 hardening (`MVP_Scope.md` §7).


---

## 7. Milestone Delivery Plan (M0–M4 across the pipelines)

This section maps the MVP build milestones **M0–M4** (`MVP_Scope.md` §7) onto the two runtime pipelines this document specifies — the **import pipeline** (Spec §4) and the **export pipeline** (Spec §10) — plus the supporting substrate (data model §18, observability §20, testing/CI §22). For each milestone it states four things explicitly:

1. **Runtime pipeline** — what code lands in the live import/preview/export path.
2. **CI gates ON** — which `.github/workflows` stages flip from "advisory" to "blocking" (Spec §22.7 stages 1–8).
3. **From design** — what the separately-supplied visual design must provide *by this milestone* for the implementation to consume it cleanly. (Design tokens and component contracts are referenced here; the design→code handoff mechanics live in §3 of this document.)
4. **Exit gate** — the demoable, falsifiable check from `MVP_Scope.md` §7 / §9.

> **Sequencing law (non-negotiable, from `MVP_Scope.md` §7 + §10 risks):** the headless `@videoforge/ffmpeg-graph` package (the `filter_complex` builder, Spec §10.3) and the **golden-frame + audio-RMS harness** (Spec §22.3 / §22.4) are built at **M0, before any UI exists**. The fidelity invariant is a *tested artifact from day one*, not a slogan retrofitted at the end. Everything downstream is verified against it.

### 7.0 Pipeline-build order at a glance

```mermaid
flowchart LR
    subgraph M0["M0 — Spine + Gate (NO UI)"]
        A["@videoforge/ffmpeg-graph<br/>(headless filter_complex builder)"]
        B["§18 JSON Schema + invariant tests"]
        C["Golden-frame SSIM/PSNR<br/>+ OfflineAudioContext RMS harness"]
        D["WebCodecs 4-track spike<br/>(throwaway)"]
    end
    subgraph M1["M1 — Import pipeline + spine"]
        E["presign→confirm→BullMQ<br/>proxy/thumb/waveform→asset:ready"]
        F["projects API + auth + workspace"]
    end
    subgraph M2["M2 — Preview + timeline"]
        G["WebCodecs preview engine<br/>(master clock, Audio Link)"]
        H["multi-track timeline UI"]
    end
    subgraph M3["M3 — Export productionized"]
        I["render queue→FFmpeg worker→S3<br/>(graph fed from LIVE project JSON)"]
    end
    subgraph M4["M4 — Creative layer + launch"]
        J["keyframes, color-grade, Ken Burns,<br/>crossfade, fades, text, captions"]
    end
    A --> I
    B --> F
    C --> I
    D --> G
    E --> G
    F --> G
    G --> H --> I --> J
```

The arrows encode the hard dependency: **the export graph builder (A) and the gate harness (C) sit upstream of the productionized export (M3) and even of the preview engine (M2)** — the preview is built to agree with an already-tested export contract, never the reverse.

---

### 7.1 M0 — Risk spikes, spine skeleton, and the fidelity gate

Prove the two genuine unknowns and stand up the tested invariant **before** any product surface. No editor UI is committed in M0.

**Runtime pipeline (headless only):**
- `packages/ffmpeg-graph/` — pure TypeScript. Input: a hand-authored §18 project JSON. Output: a single FFmpeg `filter_complex` invocation string (per-clip `-ss`/`-to` trim, bottom-up `overlay`, per-track `volume`→`pan`→`amix=inputs=N:normalize=0`+`alimiter`, mute/solo gating, Free watermark final overlay — Spec §10.3). Zero I/O, zero browser, fully unit-testable.
- `packages/schema/` — §18 JSON Schema (draft 2020-12) compiled with Ajv; the locked invariants from `MVP_Scope.md` §5 (integer-ms time; `trimIn`/`trimOut` from source origin; percentage geometry 0–100; UUIDv4 ids; array-index z-order; transitions-as-objects; persisted audio mix fields).
- Throwaway spike under `spikes/webcodecs-4track/` — `VideoDecoder` → Canvas 2D composite of 2–4 pre-made 720p proxies synced to an `AudioContext.currentTime` clock; measures FPS/seek against Spec §5.2. **Discarded after measurement** — it informs M2, it is not M2 code.
- `tools/golden/` + `tools/audio-rms/` — the SSIM/PSNR extractor (`ffmpeg -ss {t} -frames:v 1` → PNG → `ssim`/`psnr` filters, Spec §22.3) and the `OfflineAudioContext` RMS comparator (Spec §22.4), keyed by fixture MD5 + pinned-encoder version.
- `fixtures/` — CC0 media under `fixtures/media/` (Git LFS), `fixtures/manifest.json` (MD5/duration/codec/res/license), and committed `fixtures/golden/`. The **pinned FFmpeg build** (exact version + flags) recorded in the fixture lockfile.

**CI gates ON (`.github/workflows/ci.yml`):**

| Stage (§22.7) | Status at M0 | What it runs |
|---|---|---|
| 1. Static | Blocking | `tsc`, lint, format, `pnpm audit` |
| 2. Unit + Component | Blocking | Vitest: graph-builder string assertions, schema invariant tests, timecode/CRF/plan-cap clamp math |
| 3. Integration | Blocking | export-command builder produces a real FFmpeg command from a real project JSON; in-memory S3 double |
| 5. Deterministic render | Blocking | Golden-frame SSIM/PSNR on the trim+split fixture export |
| 6. Performance gates | Advisory→Blocking (export RTF only) | export real-time-factor baseline recorded on the pinned worker |

`MINIO_ENDPOINT`, `MINIO_ROOT_USER`, `MINIO_ROOT_PASSWORD`, `S3_BUCKET`, `FFMPEG_BIN` (pinned build path) and `FIXTURE_MANIFEST` are wired into the CI env at M0 so every later stage inherits the same local-disk S3 double + pinned encoder.

**From design (M0):**
- **The 9:16 canvas frame spec** — exact aspect, the Free-tier branding-watermark slot (bottom-right, ~10% canvas width, 70% opacity, Spec §10.2) as a *position+size contract*, not yet pixels. The watermark composite lands in the graph builder at M0, so its geometry must be design-locked here to avoid re-baking goldens later.
- Nothing else. No editor chrome is needed; M0 is gate-and-spine.

**Exit gate (demoable):** A trimmed + split fixture project, hand-authored as JSON, exports through the **real** `@videoforge/ffmpeg-graph` builder and matches its committed golden frames (SSIM ≥ 0.985 / PSNR ≥ 38 dB) and golden audio buffer; the 4-track preview spike hits the §5.2 targets on mid-tier hardware. **Either spike failing here re-plans the project before product investment.**

---

### 7.2 M1 — Data model + auth + import pipeline

A logged-in user can upload media and watch it become a usable, proxy-backed asset. This stands up the **entire import pipeline** (Spec §4).

**Runtime pipeline:**
- **Import path (Spec §4.2):** client MD5 → `POST /api/v1/assets/presign` (carries `md5Hash`, returns `existingAssetId` on workspace hash-match → client skips upload) → resumable 10 MB multipart upload to S3/MinIO → `POST /api/v1/assets/:id/confirm` enqueues BullMQ jobs → **(a)** 720p H.264/AAC base proxy + quarter-res Low rendition, **(b)** 160×90 WebP sprite sheet (1/sec), **(c)** waveform peaks JSON → `asset:ready` WebSocket maps server `PROCESSING→READY` to client `uploading/ready`. Original preserved immutable in S3.
- **Spine:** §18 schema in code with validation on every save; `POST/GET/PATCH /api/v1/projects` with server-owned monotonic `revision` (fast path only); JWT (15 min) + rotating refresh (httpOnly) + Google OAuth2; single implicit Free workspace with row-level `workspaceId` isolation; hard-coded plan-limit constants (3v/2a/2ov/1cap, 10-min, 1080p cap, watermark).
- **Surfaces (thin):** flat media-library grid, project dashboard (list/open/create/duplicate), debounced 3 s auto-save + Ctrl+S, Immer-patch undo/redo (200-op).

**CI gates ON:**

| Stage (§22.7) | New at M1 | What it runs |
|---|---|---|
| 4. e2e (PR subset) | Blocking | Playwright Chromium: import a fixture asset, asset reaches READY, MD5 dedupe (no second asset on re-import) |
| 8. Security review | Blocking (conditional) | static scan triggered because auth + upload surfaces now exist (Spec §17) |

Stage 3 Integration extends to the **proxy pipeline producing the 720p rendition** and the presign/confirm flow against the MinIO double seeded from `fixtures/manifest.json`.

**From design (M1):**
- **Auth screens** (signup / login / Google button / password reset) and the **project dashboard grid** (card, empty state, create/duplicate affordances).
- **Media-library panel** layout: asset card, upload-progress state, processing spinner, the `uploading`/`ready` visual states, in-use-on-delete warning.
- Design tokens (color/space/type scale) delivered as the token source the implementation imports (see §3). These tokens are consumed by M1 surfaces and reused by all later UI.

**Exit gate (demoable):** Drop `bunny_h264_3s.mp4` → asset goes UPLOADING→READY within the §4.2 SLA (base 720p proxy ≤ 2× realtime), base 720p proxy exists, re-importing the same file creates **no duplicate** (MD5 dedupe), and the project round-trips through save / auto-save / undo.

---

### 7.3 M2 — Interactive preview + timeline core

Arrange and trim a multi-clip sequence and play it back in A/V sync, responsively. This is the **preview pipeline** (Spec §5) — risk #1.

**Runtime pipeline:**
- **Preview engine (Spec §5.1):** real WebCodecs `VideoDecoder` → Canvas 2D bottom-up composite, gated against the **`AudioContext.currentTime` master clock** (never wall-clock); audio nodes created **once per session** (refs, not setState, in the rAF loop); master-clock seek (nearest keyframe → single frame) + frame-step via exact `VideoDecoder` timestamps; auto-degrade to quarter-res **Low** on frame-budget overrun (degrade, never silently drop).
- **Timeline (Spec §3):** multi-track (9:16 default), sticky ruler + draggable playhead, virtual-scrolled clip rendering (±200px, `React.memo`, `key=clipId`), select/move (same + cross-track), trim (1-frame min, gaps NOT auto-closed), split at playhead (S), delete + ripple, duplicate (Ctrl+D), **Audio Link** (linked audio splits *and* moves with its video clip), mute/solo per audio track, snapping, zoom (10%–2000%), speed 0.1×–16× (frame-drop preview).
- The golden-frame harness is also stood up against **live preview frames** here (per `MVP_Scope.md` §7 M2), so preview↔export drift is observable before M3 wires the live export.

**CI gates ON:**

| Stage (§22.7) | New at M2 | What it runs |
|---|---|---|
| 6. Performance gates | Blocking (playback gate) | §22.5 playback gate in Chromium under Playwright: ≥60fps 1080p single track, ≥30fps 4 tracks, seek p95 budgets, degraded-mode auto-activation |

Stage 4 e2e grows the "place + split a clip" and "linked-audio split" journeys. Web Audio routing-graph tests (mute/solo wiring, master-gain-is-preview-only) land at the unit/component tier (§22.4).

**From design (M2 — the heaviest design milestone):**
- **Full three-zone editor shell** (Spec §2.1): left media panel, center 9:16 canvas + transport, bottom timeline, right properties/caption panel.
- **Timeline visual language:** clip block (selected/locked states), Audio Link chain icon, track headers (mute/solo/lock), ruler/playhead, orange snap line, zoom control.
- **Transport bar** + timecode display.
- These must arrive as the design-token-bound components specified in §3 so the virtual-scroll renderer can mount them per `clipId` without restyling.

**Exit gate (demoable):** Trim a clip with embedded audio → its linked audio splits/moves with it (no desync); preview holds 60fps single 1080p track / 30fps 4 tracks / <100ms seek; mute/solo audibly changes the mix; the playback gate is green in CI.

---

### 7.4 M3 — Export pipeline productionized + invariant fully enforced

"What you cut is what you get" — a downloadable MP4 that matches the timeline. This productionizes the **export pipeline** (Spec §10) — risk #2 — around the M0 graph builder.

**Runtime pipeline:**
- **Render path (Spec §10.2):** `POST /api/v1/exports` → DB record `QUEUED` → BullMQ "render" queue → containerized **pinned-build FFmpeg worker** downloads referenced assets from S3 → constructs the command via the **same `@videoforge/ffmpeg-graph` package** fed from the **live** project JSON → streams progress to Redis pub/sub → WebSocket to the export modal → output to `exports/` prefix, status `COMPLETE`.
- **Graph features now driven by real projects (Spec §10.3):** per-clip `-ss`/`-to` (honors gaps, no ghost footage); bottom-up `overlay`; per-track `volume`→`pan`→`amix=normalize=0`+`alimiter`; mute/solo gating; **proxy→source re-link ON by default** with pre-export proxy-downgrade warning (test asserts *source*, not proxy, is fetched when present); ≤1080p frontend clamp (no over-cap job); MP4/H.264 Auto-CRF (x264 CRF 18); 9:16 TikTok/Reels + IG + YouTube 1080p presets; mandatory Free watermark; speed-change `atempo` (pitch-preserving).
- **Delivery:** progress over WebSocket; 7-day download via re-minted 1-hour signed S3 URLs; pre-flight estimated file size + render time in the export modal.

**CI gates ON — the north-star gate is now fully enforced end-to-end:**

| Stage (§22.7) | New / extended at M3 | What it runs |
|---|---|---|
| 5. Deterministic render | Blocking (extended) | golden-frame matrix now includes multi-track stacking + linked-audio-move from the *live* render path |
| 6. Performance gates | Blocking (export gate) | §22.5 export RTF ≥ 4× realtime vs committed baseline; peak worker RSS ceiling; queue-to-first-byte |
| 4. e2e | Blocking (extended) | export at 1080p → job `SUCCEEDED` → download authorisation |

The **audio-pitch test** (§22.4: preview path shifts pitch, export path preserves it via `atempo`, golden-spectrum compare) becomes blocking here.

**From design (M3):**
- **Export modal** (Spec §10.1, collapsed cut): Format & Quality essentials (MP4, ≤1080p, social presets) + Captions tab + the **pre-flight estimate** panel + the proxy-downgrade warning banner.
- **Export progress UX:** progress bar, the notification-bell surface (Spec §2.1 / §10.2), completed-with-download state.

**Exit gate (demoable):** Export a multi-track project; the downloaded MP4 has **zero ghost footage**, the audio mix matches the preview (RMS within tolerance, pitch preserved), the **original (not proxy)** source was fetched, and the full golden-frame fixture matrix is green in CI.

---

### 7.5 M4 — Thin creative layer (exercises parity) + hardening + launch

Add the smallest creative surface that proves the two parity risks (WebGL↔FFmpeg, drawtext↔canvas), land the creator demo, and ship. Every addition must keep **both** gates green.

**Runtime pipeline (additions ride the existing import→preview→export spine):**
- **Keyframe engine (shared infra):** per-property keyframes — opacity, position X/Y, scale, rotation — Linear/Ease only (Spec §6.5). Drives transforms, **Ken Burns** (`zoompan` on export), and the audio **volume envelope**.
- **One color-grade** (brightness/contrast/saturation) via offscreen WebGL → composited into 2D in preview; FFmpeg `eq` on export. Golden class: SSIM ≥ 0.990 / PSNR ≥ 40 dB.
- **Crossfade transition** (top-level object, `xfade` on export).
- **Audio:** per-clip linear fades (`afade`) + volume-envelope keyframes (`volume` keyframes).
- **Text overlay:** `drawtext`-reproducible subset only (solid + outside stroke + hard-offset shadow → `borderw`/`bordercolor` + `shadowcolor`/`shadowx`/`shadowy`, no blur). Percentage-positioned, bi-directional canvas↔timeline selection.
- **Captions:** import .srt/.vtt onto the single caption track + hand-authored block table; one readable 9:16 default style → `subtitles` burned-in **and** sidecar .SRT/.VTT export.
- **Hardening:** empty-state onboarding funnel (drives TTFE); Chrome/Edge browser gate; per-user export rate limit (5/min, Redis sliding window); upload/playback/export error states (Spec §16).

**CI gates ON — the matrix expands, gates stay green:**
- Stage 5 deterministic render grows to the **full §1 north-star matrix**: trim, split, multi-track stacking, linked-audio move, speed change, **color-grade** (the WebGL↔FFmpeg parity proof), **transform keyframe**, **crossfade**, **burned-in caption** (the drawtext↔canvas parity proof). Effects/composite frames held to SSIM ≥ 0.990 / PSNR ≥ 40 dB.
- Stage 7 full e2e matrix (Chromium/Firefox/WebKit incl. the Chrome/Edge gate message on unsupported browsers) becomes the **release gate**, with zero open `@flaky`-quarantined tests on affected journeys.

**From design (M4):**
- **Properties panel** controls: keyframe editor affordance, color-grade sliders, transition handle, audio fade handles + volume-envelope curve.
- **Caption editor panel** (block table: start | end | text) + the default caption style.
- **Onboarding empty-state funnel** visuals (import → export narrative) and the Chrome/Edge gate screen.
- This closes the design surface; no design dependency remains after M4.

**Exit gate (demoable):** A creator goes import → 9:16 rough-cut → keyframed Ken Burns + color grade + fades + captions → exported MP4 in **< 10 minutes**, output matches the timeline, and the expanded golden-frame matrix is green.

---

### 7.6 Critical-path table

| Milestone | Key deliverables | Pipeline pieces stood up | Design dependency | Exit gate |
|---|---|---|---|---|
| **M0** | `@videoforge/ffmpeg-graph` builder; §18 schema + invariant tests; golden-frame SSIM/PSNR + RMS harness; CC0 fixtures + pinned FFmpeg; WebCodecs 4-track spike (throwaway) | Headless export-graph builder; gate harness; MinIO + pinned-encoder CI env | **9:16 canvas frame + watermark slot geometry only** (locked so goldens are stable) | Hand-authored trim+split JSON exports through the real builder, matches committed goldens (SSIM ≥ 0.985 / PSNR ≥ 38 dB) + golden audio; spike hits §5.2 |
| **M1** | §18 in code + validation; projects API + `revision`; JWT + Google + Free workspace + hard-coded limits; resumable upload; dashboard; flat library | **Import pipeline** (presign→confirm→BullMQ proxy/thumb/waveform→`asset:ready`); originals immutable; save/auto-save/undo | Auth screens; dashboard; media-library panel; **design tokens delivered** | Drop `bunny_h264_3s.mp4` → READY within SLA, 720p proxy exists, re-import = no dup, project round-trips |
| **M2** | WebCodecs preview engine (master clock, reused nodes, seek, frame-step, auto-degrade); multi-track timeline (Audio Link, mute/solo, snap, zoom, speed); transport | **Preview pipeline** (risk #1); golden harness vs live preview frames | **Full three-zone editor shell** + timeline/transport visual language | Linked audio splits/moves (no desync); 60fps/30fps/seek budgets; mute/solo audible; playback gate green |
| **M3** | Render queue → FFmpeg worker → S3; command from **live** JSON; trim/composite/`amix`+`alimiter`/mute-solo; proxy→source re-link + downgrade warning; ≤1080p clamp; MP4 Auto-CRF; presets; watermark; progress WS; 7-day download; pre-flight estimate | **Export pipeline** productionized (risk #2); fidelity north-star fully enforced E2E | Export modal + pre-flight estimate + downgrade banner; progress/notification-bell UX | Multi-track export: zero ghost footage, audio matches preview (RMS+pitch), source-not-proxy fetched, full matrix green |
| **M4** | Transform keyframes (Linear/Ease); WebGL color-grade (`eq` parity); Ken Burns; crossfade; fades + volume envelope; drawtext-subset text; manual/imported captions (burned-in + sidecar); onboarding; browser gate; rate limit; error states | Creative layer rides existing spine; both parity risks proven | Properties panel; caption editor; onboarding funnel; Chrome/Edge gate screen | Creator import→export in < 10 min, output matches timeline, expanded golden matrix green |

---

### 7.7 Dependency notes

- **M0 precedes UI, by law.** The `@videoforge/ffmpeg-graph` package and the golden-frame/RMS harness are M0 deliverables. They have **no dependency on any frontend code** and are the dependency *of* the preview engine (M2) and the productionized export (M3). The preview is written to agree with an already-tested export contract — reversing this order would make the fidelity invariant unprovable until the end, which is exactly the failure mode `MVP_Scope.md` §10 calls out.
- **The §18 schema + invariants are locked at M0/M1, before clips exist.** A wrong unit/ordering invariant produces Canva-style ghost footage and silently invalidates every saved project; it is expensive to change after the first clip is persisted, so it is frozen with Ajv validation on every save and in CI before any UI is built.
- **The keyframe engine is shared infrastructure** (M4) — audio volume envelope, Ken Burns, and transform keyframes all ride it — so it lands once, early in M4, and the three consumers attach to it rather than each reimplementing interpolation.
- **The watermark geometry is a hidden M0 dependency on design.** Because the Free-tier watermark is baked into the M0 graph builder and therefore into the committed golden frames, changing its position/size *after* M0 forces a reviewed `pnpm test:golden --update`. Lock the slot at M0.
- **Design tokens are an M1 dependency for every later surface.** Tokens delivered at M1 (consumed by auth/dashboard/library) are reused unchanged by the M2 editor shell and M3/M4 panels; see §3 for the token→code contract.

---

### 7.8 Parallelizable vs sequential guide

Use this to split work across people/agents. "Track" = an independent work-stream that can proceed once its upstream dependency is green.

**Hard-sequential backbone (cannot be parallelized away):**

```
M0 graph builder + gate harness  →  M2 preview engine  →  M3 live export  →  M4 expanded matrix
```

Each arrow is a real data dependency: the preview is verified against the M0 export contract; the M3 live export reuses the M0 builder; the M4 matrix extends M3's enforced gate.

**What can run in parallel:**

| Phase | Track A | Track B | Track C | Join point |
|---|---|---|---|---|
| **M0** | `ffmpeg-graph` builder + integration tests | §18 schema + invariant + Ajv-in-CI | Golden/RMS harness + fixtures + pinned-encoder lockfile + WebCodecs spike | M0 exit gate (one fixture exports + matches goldens) |
| **M1** | Auth + projects API + workspace/limits + DB | Import pipeline (presign/confirm/BullMQ proxy-thumb-waveform/`asset:ready`/S3) | Dashboard + media-library UI on delivered tokens | Drop-file→READY e2e |
| **M2** | Preview engine (decode/composite/master-clock/seek/degrade) — depends on M0 spike + M1 assets | Timeline editing model + reducers (split/ripple/Audio Link) — depends on M0 schema | Editor-shell + timeline/transport UI on M2 design | Playback gate green |
| **M3** | Render worker + BullMQ + S3 lifecycle — depends on M0 builder | Export API + progress WS + download URLs | Export-modal UI + pre-flight estimate | Multi-track export matrix green |
| **M4** | Keyframe engine + color-grade (WebGL+`eq`) + crossfade + Ken Burns | Audio fades + volume envelope + text/`drawtext` + captions | Onboarding + browser gate + rate limit + error states | Creator < 10-min e2e + expanded matrix |

**Rules of thumb for splitting:**
- The **gate harness (Track C at M0)** unblocks everyone; staff it first so other tracks get fast feedback.
- **Backend import (M1 Track B)** and **timeline model (M2 Track B)** are pure/headless and can run ahead of their UI tracks — they only need the M0 schema.
- **UI tracks block on design**, never the reverse: a UI track for milestone N cannot start its visual work until the §3 token/component contract for that surface is delivered (M0 watermark slot, M1 tokens + dashboard/library, M2 editor shell, M3 export modal, M4 panels).
- A single agent taking the **hard-sequential backbone** end-to-end is the minimum viable team; every additional agent maps cleanly to a Track A/B/C row above.

---

### 7.9 Definition of MVP-shippable (one-screen checklist)

Phase 0 ships **only when every box below is checked** — these combine the `MVP_Scope.md` §9 success criteria with the pipeline gates of this document. Each box is falsifiable and CI- or demo-verifiable.

**Fidelity invariant (the whole bet)**
- [ ] Golden-frame gate green across the full matrix: trim, split, multi-track stacking, linked-audio move, speed, color-grade, transform keyframe, crossfade, burned-in caption (SSIM ≥ 0.985 / PSNR ≥ 38 dB lossy; ≥ 0.990 / ≥ 40 dB effects/composite). [§22.3, §1 north-star]
- [ ] Audio-RMS error ≤ −60 dBFS vs golden; pitch preserved on speed change (`atempo`). [§22.4]
- [ ] A human reviewer cannot find a timeline edit the export disagrees with. [§9.1]

**Performance gates (on pinned workers)**
- [ ] Playback gate green: ≥60fps 1080p single track / ≥30fps 4 tracks; seek <50ms / <100ms; degraded-mode auto-activates (no silent drops). [§22.5, §5.2]
- [ ] Export gate green: 1080p/30fps ≥ 4× realtime within 10% of baseline; worker RSS under ceiling. [§22.5, §10.2]
- [ ] Base 720p proxy ready ≤ 2× realtime of source duration. [§4.2]

**Edge-case correctness (dedicated tests)**
- [ ] Audio Link passes split / ripple / cross-track edge cases (no desync). [§9.4]
- [ ] Master-clock sync: no A/V drift over long playback; no per-scene audio restart. [§9.4, §5.1]
- [ ] Mute/solo respected on export (muted dropped from `amix`; solo drops non-soloed). [§10.3]
- [ ] Proxy→source re-link fetches the **original, not the proxy**, when present; pre-export downgrade warning shown. [§10.2, §9.4]

**Product funnel**
- [ ] Single user goes file-import → downloaded, watermark-correct MP4 in one Chrome/Edge session. [§9.3]
- [ ] Median TTFE < 10 min for a 60s captioned project; > 70% first-session export completion. [§1, §9.3]
- [ ] TTFE/fidelity funnel events emitted to the observability pipeline (`project_created`, `asset_uploaded`, `export_started`, `export_completed`). [§20.3]

**Free-tier guardrails**
- [ ] Free-tier limits enforced in the editor AND honored on export (3v/2a/2ov/1cap, 10-min, 1080p clamp). [§9.5, §15.2]
- [ ] Mandatory Free watermark injected (bottom-right, ~10% width, 70% opacity); per-user export rate limit (5/min). [§10.2, §17.4]
- [ ] Stripe stubbed; no entitlements service; limits are hard-coded constants. [§3.10]

**CI / release**
- [ ] Merge gate (§22.7 stages 1–6) green on every PR.
- [ ] Release gate: stage 7 full browser matrix green (incl. Chrome/Edge gate message on Safari/Firefox); zero open `@flaky` tests on affected journeys.
- [ ] §18 JSON Schema validation runs on every save and in CI; no malformed graph reaches preview or export. [§18.4]

