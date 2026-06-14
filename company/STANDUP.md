# Standup Log

Append-only. Newest on top. Run `/standup` to generate a new entry.

Format per entry: **Shipped · In-flight · Blocked · Decisions needed · Today's plan.**

---

### 2026-06-14 — 🆚 Canva end-to-end parity sweep (CEO-requested) — AUDITED + FIRST FIX BATCH SHIPPED
- **CEO ask:** compare VideoForge to Canva end-to-end (import → drag-to-timeline → every editing feature →
  export), find the gaps, fix the issues, fill the gaps. Plus 3 gate decisions resolved up front:
  watermark-free 1080p, aspect-ratio chooser (no default), perf gate = absolute ≥30fps on pinned HW
  (⚠️ infra-spend follow-up queued for Anchor).
- **Audit (6 parallel persona auditors, read-only):** ~35 findings across import/timeline/canvas/audio+text/
  export/product, each classified BUG vs GAP-INSCOPE vs GAP-GATE. Headline: build is more complete than the
  roadmap implied, but there's a cluster of **preview≠export invariant cracks** (the wedge) + dead `alert()`
  stubs + the just-decided watermark-free not yet wired.
- **Shipped (4 disjoint fix bundles, commit `65014d4`):**
  - **Invariant fixes:** watermark off-by-default (all 3 callers); caption burn-in now emits `force_style`
    from `CaptionStyle` so export==preview; font picker removed + preview locked to Inter (was 20 fonts in
    preview, Inter in export); removed clip-rotate handle + text rotation slider (never exported); audio
    fade in/out mid-clip divergence fixed.
  - **In-scope gaps filled:** ripple delete + Ctrl/Cmd+Delete (§3.3); track-lock button (orphaned action);
    copy/paste shortcuts; export-aspect mismatch warning; server fps clamp; unsupported-format rejection
    (415) + file-size ceilings (413); media-library rename/delete with in-use warning; WS `asset:ready`
    race fix.
  - **Hygiene:** removed canvas + timeline + editor `alert()` stub buttons/shortcuts.
- **Verified:** `pnpm typecheck` green (8/8, fixed 1 regression + pre-existing blockers); package suites
  green (script-studio snapshot refreshed for the schema `hidden` default); web tests **12 failing =
  identical to the pre-change baseline → zero new regressions** (the known WIP-red set).
- **Blocked / follow-ups:** (a) caption+watermark **goldens** need re-baseline when the golden gate (Now #1)
  is built; (b) ~3 pre-existing-red web tests now assert removed-by-design behavior (watermark disclosure,
  canvas toolbar) — update when the web-test backlog is cleared.
- **Decisions needed (queued for CEO):** sequencing of the already-approved big builds (CC0 library /
  Script Studio v1 / template thumbnails / multi-select) + new GAP-GATEs (versioning/restore, numeric
  transform inputs, canvas bg/fit, library search). Larger in-scope items still open: keyframe
  interpolation (§3.7 centerpiece, currently animates nothing), volume envelope UI, resumable upload,
  canvas alignment snapping.

### 2026-06-05 — 🎙️ Script Studio blueprint (CEO-requested: text→voice + script→video, $0) — BLUEPRINTED
- **CEO ask:** add an AI text-to-voice generator + a script→video generator, hard constraint **$0 / no
  purchases**. Atlas clarified scope with the CEO: script→video = **on-wedge AI assembly** (paste script
  → auto-built *editable* timeline), and the no-spend rule applies to the **solution**, not just research.
- **Discovery loop (no spend):** Scout (OSS options), Forge (architecture/invariant), then Vera (PRD),
  Iris (UX), Ledger (true cost). All five converged.
- **Verdict:** a **$0, invariant-safe** build is feasible. Plan = self-hosted **Piper** (MIT, CPU TTS,
  native timestamps → free captions) + **text-card scenes** (reuse shipped `drawtext`) + captions from
  TTS timings. New pure `packages/script-studio` emits a valid `Project` + sidecar manifest (Templates
  pattern). **Zero changes to `project-schema`/`ffmpeg-graph`** — preview==export by construction.
  v2: Pexels stock video + Kokoro higher-quality voice.
- **Cost (Ledger):** software $0; fits inside the existing 2-CPU worker cap; "free" only ever costs at
  ~2,000 generations/mo (~$5/mo worker bump) — well past launch.
- **Docs:** `docs/Script_Studio_Research.md`, `_Architecture.md`, `_PRD.md`, `_Design_Brief.md`,
  `_Cost_Model.md`.
- **Decision queued:** 🧭/💰 scope + sequencing + infra delta (Atlas recommends **B** — start the pure
  assembler P0 now, hold infra/worker stages until the Phase-0 fidelity gate is green; zero launch risk).
- **Decision (CEO, 2026-06-05):** ✅ **B** — Script Studio approved; **start P0 now** (pure assembler),
  worker infra delta approved for P1 (lands after the Phase-0 fidelity gate is green). Launch-hardening
  continues undisturbed.
- **P0 SHIPPED (Reel, reviewed by Forge):** new pure package **`packages/script-studio`** — `segment.ts`
  (deterministic script→segments), `assemble.ts` (`assembleScript → {document, manifest}`: voice-over
  track + text-card overlays + caption blocks), `ScriptManifest` sidecar. Reuses `packages/templates`
  authoring via a new additive `./authoring` export. **Invariant guard:** text cards authored only in the
  export-rendered `drawtext` subset, enforced by a CI test. **Verified:** 25/25 tests, full `pnpm
  typecheck` (8 projects) + `pnpm lint` green; **zero changes to `project-schema`/`ffmpeg-graph`**.
  **Forge verdict:** APPROVE-WITH-NITS — preview==export by construction. 3 non-blocking nits folded into
  P1 (add a Zod `ScriptManifestSchema`; parameterize the guard test over a poisoned sceneStyle; a doc
  clarification).
- **Next (blocked on launch gate):** P1 = real Piper TTS on the render-worker (synthesize VO WAVs → inject
  as normal assets → probe real durations into `assembleScript`) + the approved worker infra delta; then
  P2/P3 = stock scenes, caption word-timings, API route + Iris's script-input modal & editor landing.

### 2026-06-04 — ✨ Templates feature + text-overlay export (CEO-requested) — BUILT
- **Blueprint:** Scout (research → 5 day-to-day templates), Vera (spec + slot model), Iris (gallery +
  per-template visual direction), Forge (architecture: a template = a valid `Project` + a **sidecar**
  slot manifest — no schema break, no render-engine change, invariant safe).
- **Build:** new `packages/templates` (Birthday / Travel Recap / Photo Memories / Motivational Quote /
  Simple Promo); "Start from a template" gallery; clone/apply (`cloneTemplateToProject`, id-regen +
  ref-rewrite); slot-fill (`replaceClipAsset`); Core made `POST /projects` **and** `POST /exports`
  accept a document snapshot (anti-spoof, watermark/rate-limit intact); `pruneUnfilledSlots()` →
  export renders exactly the previewed (pruned) doc (also strengthens WYCIWYG).
- **Verify wave caught a real blocker:** text overlays rendered in **preview but not in export** (M0
  deferred `drawtext`) — would have shipped templates with missing titles/quotes/CTAs and violated the
  invariant. CEO approved fixing it.
- **Text-overlay export (CEO-approved):** Forge parity spec (`docs/Text_Overlay_Export_Spec.md`) →
  Reel added the `drawtext` stage + **Inter v4.0** in the worker image + a shared `layoutTextOverlay()`
  in project-schema; Pixel made the canvas consume the **same** helper + multi-line. Preview == export
  by construction; text now appears in exported MP4s.
- **Gate:** typecheck/lint green, **397 tests** (10 FFmpeg goldens skip locally → CI).
- **Remaining:** rebuild render-worker image (Inter+drawtext live); CI pixel-parity goldens (FFmpeg);
  live pick→fill→export proof; template poster thumbnails (cosmetic).

### 2026-06-04 — 🐞 Data-loss bug: reload wiped the user's work — FIXED (CEO manual testing)
- **Symptom:** CEO reported edits/settings vanish on browser reload.
- **Root cause (worse than reported — it OVERWROTE saved work):** on reload the in-memory access token is
  gone; the project `GET` **401s during the auth-`refresh` window**; `projectStore`'s blanket catch returned
  a **stale/seeded sampleProject**, masking the real server doc; **autosave then PATCHed that masked doc back
  over the good server document** → the user's real work was destroyed. Plus no flush-on-unload + only bare
  `S` (no Ctrl/Cmd+S).
- **Fix (Pixel, `apps/web` only):** `projectStore` rethrows on server-reachable errors (no masking) and uses
  localStorage **only when genuinely offline**; autosave is **armed-only** (after a real server hydrate) +
  **session-aware** (never PATCHes during the 401 window) + **flush-on-pagehide (keepalive)** + **Ctrl/Cmd+S**;
  `Editor` gates load on an authed user and shows a **Retry** screen on error; editor view prefs
  (zoom/panel tab/collapse) persisted to a separate localStorage key.
- **Verified:** typecheck/lint green, **124 tests** (5 new incl. "transient-401 before refresh does NOT wipe").
- **Forward note for Core (non-blocking):** autosave sends `baseRevision`; on an optimistic-concurrency **409**
  the client now surfaces a retriable error — future enhancement: auto-reload-and-merge on 409.

### 2026-06-04 — 🔥 Incident: Docker VM at 615% CPU (overheating) — RESOLVED
- **Symptom:** CEO's Mac overheating; Docker "Virtual Machine" process at 615% CPU, gone when Docker stopped.
- **Root cause:** the render-worker lost its Redis connection and **spin-looped on ioredis reconnect with
  no backoff** (`ECONNREFUSED` / `ENOTFOUND redis`) → ~6 cores pegged for hours (container Exited 137).
  A stale 67-job BullMQ backlog from the verification/e2e runs was secondary.
- **Fix:** flushed the backlog (Redis `FLUSHALL`); added a hard **CPU/mem cap (2 CPU / 2 GB)** to
  render-worker in `docker-compose.yml`; removed an inert src bind-mount; brought the stack up healthy
  (redis-first via `depends_on`) → worker connects clean, **now 0.00% CPU**.
- **Collateral fixed:** MinIO wouldn't start — Anchor's Wave-1 pin (`RELEASE.2024-11-07`) couldn't read the
  newer on-disk format (`xl meta version 3`). CEO chose keep-data → bumped MinIO pin to
  `RELEASE.2025-09-07T16-13-09Z` in `docker-compose.yml` **and** `.github/workflows/ci.yml` (kept in sync).
  Buckets/data preserved.
- **Verified:** render-worker 0.00% CPU (was 615%), all services healthy, buckets intact, clean redis connect.
- **Follow-up (Wave 3, needs worker code change + image rebuild):** harden the worker's ioredis
  `retryStrategy` with capped exponential backoff so a future Redis blip can't start a reconnect storm
  (the 2-CPU cap currently bounds the blast radius). Minor: worker base image is node:20 — AWS SDK v3 will
  require node ≥22 after Jan 2027.

### 2026-06-04 — Live end-to-end verification (CEO: "verify the whole thing live")
- **Method:** Ran the real running stack (Postgres/Redis/MinIO + API :4000 + web :5173 + render-worker
  container) — backend smoke via curl, UI via headless Chromium.
- **✅ Backend verified live:** signup→201+JWT, `/me`→200, refresh cookie set, unauth/bad-token→401,
  project create→list→get-by-id→200. **Cross-user isolation proven** (User B sees none of User A's
  data; B's fetch of A's project → 404; owner → 200). The new auth code IS what's running.
- **✅ App UI verified live (screenshot):** logged in as the e2e user; the **onboarding funnel empty
  state renders exactly per Iris's brief** ("Drop a video to start", correct copy, amber reserved for
  Export, non-amber New-Project CTA). The app works in a real browser.
- **⚠️ Finding — e2e seed-debt (NOT an app bug):** 7/8 dashboard specs fail because they assume a
  pre-seeded "sample project"; under auth a fresh user correctly gets the empty onboarding state.
  **Fix (Sentinel, Wave 3):** global-setup must seed a per-user project via the API (or specs create
  their own) before the suite is trustworthy. Also: the e2e run's piped exit code masked Playwright's
  real failure — don't trust `| tail` exit codes for gating.
- **Not yet verified:** a real MP4 export (render-worker + FFmpeg producing a file) — best confirmed
  with a 2-min manual desktop-Chrome smoke using a real clip, or once MinIO is seeded for the export
  e2e spec.

### 2026-06-04 — Wave 2 shipped (web auth · security · Sentry · perf/e2e)
- **Shipped:**
  - 🔐 **Pixel** — web auth client + login/signup UI: in-memory access token, 401→refresh→retry,
    WS `?token=`, 429 friendly message. App is now **end-to-end runnable** (against a live API).
  - 🛡️ **Core** — Forge's 4 fixes: prod-secret throw, WS access-token-only, atomic (Lua) rate-limit,
    `hasOriginal` field. Also caught + fixed a **latent Wave-1 WS bug** (unauth sockets never closed,
    broadcasts silently no-op'd). 23 integration tests.
  - 🎬 **Reel** — enforced pinned-FFmpeg version in code; goldens still **must be generated in the
    pinned-FFmpeg CI/Docker** (no FFmpeg locally).
  - 🧪 **Sentinel** — perf gate rewritten to real browser fps/seek (ran 60fps / 25ms p95 locally);
    auth-aware e2e fixture + export-journey spec asserting the WS-progress fix.
  - 📡 **Anchor** — Sentry SDK across web/api/worker, no-op until DSN set; `window.Sentry` exposed
    for Pixel's TTFE shim. +73 lockfile pkgs, ~200KB bundle (code-split = Wave 3).
- **Gate:** typecheck ✅ · lint ✅ (0 errors) · 191 tests pass.
- **Remaining to launch (Wave 3):** generate+commit goldens in pinned-FFmpeg CI; live end-to-end
  browser verification; Ward security pass on the auth surface; CI gate-hardening (remove e2e
  continue-on-error, make golden/perf blocking) after the perf-threshold + goldens land; CEO actions
  (Sentry DSN, branch protection); deferred features (Google OAuth/reset, #8 badge, Next UI backlog).
- **Decisions open:** watermark/Pro, aspect default, pre-launch enablement, perf-gate threshold.

### 2026-06-04 — Wave 1 shipped (auth · fidelity gate · onboarding · CI)
- **Shipped (all 4 lanes, integrated + gated):**
  - 🔑 **Core** — real email/password auth (signup/login/refresh/logout/me), scrypt hashing (zero
    new deps), `dev-workspace` stub fully replaced by per-user isolation across API + WS + rate-limit.
  - 🛡️ **Reel** — fidelity gate is now real code (SSIM≥0.985 / PSNR≥38dB on trim/stack/speed matrix,
    CI hard-fail-on-missing) + proxy-vs-original worker test. **Golden PNGs not yet generated** (no
    FFmpeg locally — must run in pinned FFmpeg 6.1.1 CI and commit).
  - ✨ **Pixel** — onboarding funnel (first-run guidance, grey→amber "aha", parity reveal) +
    dependency-free analytics shim; +15 tests (93/93 web).
  - ⚙️ **Anchor** — CI reordered to spec, FFmpeg download cached, MinIO pinned + health-fixed,
    e2e job made runnable.
- **Gate:** typecheck ✅ · lint ✅ (0 errors after ignoring `.claude/`; 27 pre-existing a11y warnings)
  · tests ✅ (api 9/9 vs real Postgres/Redis, render-worker 3/3, web 93/93).
- **Forge review:** SHIP-WITH-FIXES — no critical/high; **no unauthenticated cross-user data path**.
- **Wave-2 backlog (from review + lane handoffs):**
  1. Pixel+Core: **web auth client + login/signup UI** (send credentials/Bearer, 401→refresh, 429 msg,
     WS `?token=`) — app isn't end-to-end runnable until this lands.
  2. Reel+Anchor: **generate + commit the 3 golden PNGs** in pinned FFmpeg CI; then make golden a hard gate.
  3. Core (security, do before any deploy): **throw on missing JWT secrets in prod** (no dev-default
     fallback); consider access-token-only WS auth; make export rate-limit atomic (Lua).
  4. Reel: assert `ffmpeg -version` == pinned 6.1.1 in the harness (currently doc-only).
  5. Anchor: wire **Sentry SDK** (shim is ready), remove e2e `continue-on-error`, real perf/golden
     gates; **CEO: branch protection + Sentry account**.
  6. Sentinel: **perf-gate rewrite** (real browser fps/seek) + e2e auth migration + export-journey specs.
  7. Pixel+Core: **#8 proxy-warning badge** (needs a `hasOriginal` API field).
- **Note:** repo carried a large pile of *pre-existing* uncommitted work; Wave 1 sits on top, all
  uncommitted. Recommend a checkpoint commit before Wave 2.

### 2026-06-04 — Full-team assessment of VideoForge (CEO: "ready ASAP")
- **Shipped:** Vera built the Now/Next/Later roadmap + code-state audit; Scout refreshed the
  competitive landscape; the full delivery team (Core, Reel, Pixel, Anchor, Sentinel, Iris)
  deep-assessed their lanes; Iris delivered the onboarding design brief (`docs/Onboarding_Funnel_Brief.md`).
- **Headline:** VideoForge is ~80–85% built. The hard parts (editor, API, render worker) are done.
  MVP gap = **auth** (the keystone blocker) + making the **CI fidelity/perf gates real** (both are
  currently passing stubs — the wedge is not yet protected) + onboarding polish + Sentry.
- **Effort:** ~16 human-equiv eng-days of work, heavily parallel; critical-path ≈ 3–4 days.
- **Blocked:** nothing — the entire critical path can start now with zero CEO decisions.
- **Decisions queued:** watermark/Pro, aspect-ratio default, MVP auth scope, pre-launch enablement
  (Sentry + branch protection). None block the build start.
- **Today's plan:** awaiting CEO green light to start Wave 1 (parallel build), then Forge review +
  Sentinel gate each lane before merge.

### 2026-06-04 — Company stood up
- **Shipped:** Zentrix Company OS scaffolded — 14 personas, decision queue, roadmap, build-loop
  workflow, `/standup` `/ship` `/decisions` commands.
- **In-flight:** none yet.
- **Blocked:** none.
- **Decisions needed:** none open.
- **Today's plan:** CEO to point Atlas at the first objective (e.g. "Vera, draft Now/Next/Later
  from MVP_Scope" or "Scout, refresh the competitive landscape").
