# VideoForge Roadmap

Owner: **Vera** (Head of Product). Source of scope truth: `docs/MVP_Scope.md`.
Keep this as a Now / Next / Later board. Atlas references it at standup.

Last updated: 2026-06-05

> **🎙️ Script Studio (CEO-requested, blueprint complete 2026-06-05)** — paste a script → auto-built
> *editable* timeline = OSS Piper voice-over + text-card scenes + auto-captions → edit & export in the
> existing editor. Confirmed **$0/no-purchase** and **invariant-safe** (new pure `packages/script-studio`,
> zero `project-schema`/`ffmpeg-graph` change). This is a 🧭 scope pull beyond Phase-0 MVP — sequencing +
> infra delta are queued in `DECISIONS.md` (Atlas rec: start the pure assembler P0 now, hold worker
> stages until the fidelity gate is green). Docs: `docs/Script_Studio_*`. v2: Pexels stock + Kokoro voice.

---

## Code State (assessed 2026-06-04)

### What is already working / substantially complete

| Module | Status |
|---|---|
| `packages/project-schema` — types, JSON Schema, Ajv validate(), fixtures | **Done** |
| `packages/ffmpeg-graph` — full `buildExportCommand()` with trim/composite/audio/captions/watermark/Ken Burns/xfade | **Done** |
| `packages/ffmpeg-graph` — golden test harness setup (SSIM/PSNR stubs) | **Partial** — harness wired, CC0 fixture media + real SSIM comparison not yet committed |
| `apps/api` — Fastify server, Postgres/Drizzle schema + migrate, projects CRUD with revision + plan limits | **Done** |
| `apps/api` — assets presign/confirm/poll (real S3 flow + MD5 dedup) | **Done** |
| `apps/api` — exports POST/GET/download (BullMQ enqueue + presigned URL) | **Done** |
| `apps/api` — WebSocket hub (`asset:ready`, `export:progress`, `export:complete`) | **Done** |
| `apps/api` — JWT plugin registered, httpOnly cookie plumbing | **Partial** — plugin wired, NO auth routes (login/signup/OAuth/reset) |
| `apps/render-worker` — real FFmpeg spawn + S3 download/upload + progress pub/sub | **Done** |
| `apps/render-worker` — media worker: 720p proxy + Low quarter-res + thumbnail sprite + waveform peaks | **Done** |
| `apps/web` — editor store (Zustand+Immer): all M4 actions (trim/split/move/link/keyframe/color grade/Ken Burns/crossfade/captions) | **Done** |
| `apps/web` — undo/redo (200-op Immer patch stack) | **Done** |
| `apps/web` — PreviewEngine: AudioContext master clock, per-asset pooled decoders, color grade (WebGL), Ken Burns, captions, overlays | **Done** |
| `apps/web` — Timeline UI: ruler, drag/trim/snap, Audio Link, mute/solo, zoom, track caps | **Done** |
| `apps/web` — MediaPanel: real presign→PUT→confirm→poll→WS upload flow, drag-to-timeline | **Done** |
| `apps/web` — ExportModal, Inspector, Transport, Dashboard, BrowserGate, NewProjectModal | **Done** |
| `apps/web` — Autosave (3s debounce), Ctrl+S, core keyboard shortcuts | **Done** |
| `apps/web` — Auth UI (login/signup/OAuth screens) | **NOT started** |
| CI golden-frame gate (real SSIM/PSNR runs on CC0 fixtures) | **NOT started** — harness skeleton exists, gate not green |
| Playwright e2e suite | **NOT started** |
| Docker-compose + `.github` CI pipeline | **NOT started** |

---

## Now (current build cycle — M0/M1 completions + auth + CI gate)

Priority order by dependency + MVP-done gate. All items are `✅` in `docs/MVP_Scope.md`.

| # | Item | Owner | Acceptance Criterion |
|---|---|---|---|
| 1 | **CI: golden-frame fidelity gate green** — commit CC0 fixture media (Git LFS), write real SSIM/PSNR comparison in `golden.test.ts`, wire as a PR merge gate | **Reel** + Sentinel | `pnpm test:golden` passes on every PR; fixture matrix covers trim, split, multi-track stack, linked-audio move, speed change — SSIM ≥ 0.985 / PSNR ≥ 38 dB; gate blocks merge on failure |
| 2 | **CI: playback perf gate** — Playwright headless check that the 4-track preview spike hits ≥ 30 fps / <100 ms seek on pinned hardware | **Sentinel** + Pixel | `pnpm test:perf` green in CI; degraded-quality auto-trigger verified |
| 3 | **Auth routes — email/password signup + login + JWT refresh + password reset** (`/api/v1/auth/*`) — the workspaceId isolation stub (`dev-workspace`) replaced by the real `ownerId` from the JWT claim | **Core** | A new user can sign up, log in, receive an httpOnly refresh cookie, and their projects are workspace-isolated; password reset email dispatches; `pnpm test:e2e` login flow passes |
| 4 | **Google OAuth2 sign-in** — `/api/v1/auth/google` callback + token exchange; web Google Sign-In button | **Core** | One-click Google login works end-to-end; user lands on Dashboard; no new workspace created on repeated login |
| 5 | **Docker-compose CI + `.github/workflows` pipeline** — stages: typecheck → lint → unit/integration → golden-frame → perf → e2e (§22.7) | **Anchor** | Every PR runs all 6 CI stages; pipeline is green on `main`; golden-frame and perf stages fail the PR if regressions detected |
| 6 | **Empty-state onboarding funnel** — first-session guided path from Dashboard → New Project (aspect-ratio chooser) → Import media CTA → timeline → Export button | **Pixel** + Iris | A net-new user reaches a completed export without any tooltip or help doc; TTFE measured via Sentry event; funnel event fires on first export |
| 7 | **Export rate limiting** — Redis sliding-window 5 exports/min per user, 429 surfaced in the UI | **Core** | A single user hitting the export endpoint 6 times in 60 s receives a 429; the web shows a clear "slow down" message (not a crash) |
| 8 | **Proxy→source re-link pre-export warning** — UI warning when an original is unreadable and the worker would fall back to the proxy | **Pixel** (UI) / Reel (worker test) | A test asserts that `resolveAssets()` fetches the original (not the proxy) when both keys are present; the export modal shows a warning badge when any asset has no original key |
| 9 | **Chrome/Edge browser gate** — detect Safari/Firefox on page load and render a clear "use Chrome or Edge" message, not a broken editor | **Pixel** | Safari/Firefox users see the gate screen; Chrome/Edge passes through; existing `BrowserGate.tsx` wired into the root route |
| 10 | **Sentry error tracking + TTFE/fidelity funnel events** — minimal observability (§20 stub) | **Anchor** | Sentry DSN configured; uncaught errors in web + render-worker ship to Sentry; `ttfe:export_complete` event fires with duration on every successful export |

---

## Next (following build cycle — M2/M3 polish + launch hardening)

Items below are all `✅` in `docs/MVP_Scope.md` but depend on Now items being green first.

- **Ripple delete / Ctrl+Delete** — the delete path already exists; ripple variant closes gaps on the timeline. Owner: **Pixel**.
- **Speed change 0.1×–16× UI** — store action `setClipSpeed` exists; Inspector slider + preview frame-drop behaviour needs to be wired. Owner: **Pixel**.
- **Per-clip fades + volume envelope handles on the timeline** — store actions exist (`setClipFade`, `setClipGain`); drag handles in the clip block needed. Owner: **Pixel**.
- **Caption import UI** — drag `.srt`/`.vtt` onto the caption track; inline table editor in the caption panel; export modal Captions tab (burn-in vs. sidecar). Owner: **Pixel** + Core (sidecar download endpoint).
- **Export pre-flight estimate** (file size + render time) surfaced in the Export modal — the `buildExportCommand` output gives input count; tie to a rough heuristic. Owner: **Pixel** / Core.
- **9:16 / 16:9 / 1:1 social export presets** (TikTok/Reels/IG/YouTube) — one-click buttons in the export modal; resolution clamped server-side. Owner: **Pixel** / Core.
- **Sentinel Playwright e2e** — import → trim → export golden user journey; Audio Link split/ripple edge cases; mute/solo export parity. Owner: **Sentinel**.
- **Project dashboard** — list/open/create/duplicate fully wired to the real API (Dashboard.tsx already calls the API; confirm it works with real auth). Owner: **Pixel** / Core.
- **Upload error states** (failed presign, S3 PUT timeout, processing failure) — toast + retry CTA. Owner: **Pixel**.

---

## Later (post-MVP — each needs a 🧭 Scope decision to pull forward)

These are the Phase 1 / Phase 2 items from `docs/MVP_Scope.md §4`. Listed here for visibility; none are buildable without a CEO scope gate.

| Item | Why deferred |
|---|---|
| Offline IndexedDB write buffer + reconnect rebase | Single-user is fine for MVP; adds a complex merge path |
| Auto-versions every 30 min + named versions + restore | Trust story but not on the first-export critical path |
| Voice-over recording (MediaRecorder) | Off the import→export critical path |
| Auto-ducking (sidechain `sidechaincompress`) | Highest preview↔export parity risk in audio; explicitly Phase 1 fast-follow |
| Stock media library (Pexels/Unsplash) | Adoption nicety; off critical path |
| Stripe billing, plan tiers, Pro upgrade, entitlements service | Free-only removes the entire §21 surface — biggest schedule win |
| AI auto-captions (Whisper), scene detection, transcript editing | Phase 2 GPU/CPU inference tier |
| Full color grade (hue/LUT/temp/tint/vignette), 12+ transitions, masks, chroma key | Phase 2 — breadth rides on proven fidelity spine |
| Full audio rack (EQ, compressor, RNNoise, reverb, pitch shift) | Phase 2 |
| Lottie/SVG/sticker overlays + server-side rasterization | Phase 2 — heavy render-worker stage |
| H.265 / VP9 / ProRes / GIF / 4K / HDR export | Phase 1/2 — each multiplies the golden-frame matrix |
| Additional input containers (H.265/AV1/MKV/AVI/FLV) | Phase 1/2 — keep one decode path until fidelity proven |
| Real-time collaboration (CRDT, presence, soft-locks, comments) | Phase 1 — single-user fast-path first |
| GitHub OAuth, MFA, SSO/SAML | Phase 1/3 |
| Responsive/touch timeline, mobile capture | Phase 4 |
| ffmpeg.wasm Safari/Firefox fallback | Phase 1 |

---

## Phase context

- **Phase 0 / Free-tier MVP** — Chrome/Edge only, WebCodecs decode, watermarked export,
  billing stubbed (`BILLING_MODE=stub`). No upgrade CTA.
- Defensible wedge: **what you cut is what you get** (export = preview, frame-for-frame).
- **MVP is "done" only when:** (a) golden-frame + audio-RMS CI gate is green across the full
  fixture matrix, AND (b) a single user can go import → edit → export in < 10 min median TTFE.
