# CEO Decision Queue & Log

Atlas appends here. **Open** = waiting on Anuj. Move to **Log** once decided.

Gate types: 💰 money · 🧭 scope · 🚀 release/publish · ⚠️ irreversible-infra · ⚖️ legal/brand

---

## 🔴 Open — needs CEO decision

### 2026-06-14 ⚖️/🧭 CC0 library — external content sourcing + license vetting
- **Raised by:** Atlas (building the CEO-greenlit CC0 stock+music library)
- **Context:** The library splits into (1) **engineering** — manifest format + Stock/Audio/Elements panel UI
  + drag→import flow (Atlas is building this now, $0, no gate); and (2) **content** — the actual stock
  video/photo + royalty-free music files, which must be genuinely CC0/public-domain and license-vetted
  before shipping externally. Seeding zero-risk *generated* content (solid/gradient backgrounds, simple
  elements) is safe and ships now; real stock video + music needs sourcing (Scout) + per-asset license
  vetting (Ward), and possibly bundling vs. hotlinking decisions.
- **Decisions needed:** (a) approve a specific CC0 source set (e.g. Pixabay/Pexels CC0, public-domain
  archives) for Scout to curate; (b) ⚖️ confirm Ward license-vets each bundled asset before external launch;
  (c) bundle-in-repo (owned, $0, reliable) vs. hotlink (no storage, but reliability/ToS risk).
- **Atlas recommends:** ship the engineering scaffold + generated zero-risk seed now (no gate); have Scout
  curate a small bundled CC0 set + Ward vet licenses as a parallel track before this is exposed at launch.
  Bundle-in-repo over hotlinking.
- **Decision:** ⏳ pending (does NOT block the scaffold build)


### 2026-06-05 🧭 Canva-parity product push — scope gates from the flow teardown
- **Raised by:** Atlas (CEO-requested "compare every flow vs Canva, work on what's left"); teardown by Iris, Pixel, Vera, Reel, Scout.
- **Context:** Full flow-by-flow teardown vs Canva done. Two classes of work fell out: **(A) in-scope items already promised in `MVP_Scope.md` but dead/broken in code** (no gate — Atlas will action), and **(B) Canva-parity pulls beyond MVP** (these gates).
- **Strategic frame (Scout):** don't chase Canva on breadth/templates/AI/polish — losing race. Win provably on **(1) edit==export fidelity** and **(2) speed on heavy projects** — the two things Canva 2.0 broke. Close the one real *adoption* hole: an empty asset library.
- **Scope gates needing a decision:**
  1. 🧭 **Minimal CC0 stock + royalty-free music library** — the single biggest adoption blocker (first-run users have nothing to edit). Phase-1 in scope doc; Atlas rec: **pull forward, small CC0 set.**
  2. 🧭 **Realize Script Studio v1** (assembler P0 already shipped; this approves TTS-as-asset + input modal + `script` job) — our only category-defining wedge; currently dead code without it.
  3. 🧭 **Timeline multi-select + marquee + group move** — common Canva expectation; not in §3.2.
  4. 🧭 **Real template thumbnails + visual drag slot-fill** (replace gradient placeholders + id `<select>`) — templates are a Phase-1 gate already.
  5. 🧭 **WebCodecs vs current `<video>` decode path** — we shipped `<video>`+drift, not the spec's `VideoDecoder`. Accept the deviation for MVP or fund the rewrite? (Forge call.)
  - Bigger/later (note only): mobile/touch reach (Phase 4), AI repurposing on Whisper (Phase 2), share links (Phase 1).
- **Atlas recommends:** approve **#1 (CC0 library)** and **#2 (Script Studio v1)** now — highest leverage, on-wedge; **#4** if we want templates to convert. Hold **#3/#5** unless you want them. Meanwhile Atlas builds the in-scope (no-gate) fixes below.
- **Decision:** ✅ (Anuj, 2026-06-05) — approved **#1 CC0 stock+music library**, **#2 Script Studio v1** (TTS+modal+job), **#3 timeline multi-select+marquee**, **#4 template thumbnails+visual slot-fill**. **#5 WebCodecs** not raised → current `<video>` decode path stands as an accepted MVP deviation for now (revisit if parity edge-cases appear). Execution: **commit the existing trunk first** (checkpoint WIP + CPU fix → CI readout), then run the Tier-1 in-scope sprint + the four approved gates.
- **Raised by:** Atlas (CEO-requested feature; full blueprint by Scout, Forge, Vera, Iris, Ledger)
- **Context:** CEO asked to add an AI **text-to-voice generator** + **script→video generator**, with a
  hard **$0 / no-purchase** constraint. Blueprint complete and convergent. Scope = **"Script Studio"**:
  paste a script → auto-build a *real, editable* timeline (OSS voice-over + text-card scenes +
  auto-captions) → user edits & exports in the existing editor. Feasibility:
  - **$0 & invariant-safe — confirmed.** Self-hosted **Piper** (MIT, CPU TTS, native word timestamps →
    free captions) + generated **text-card scenes** (reuse the shipped `drawtext` path) + captions from
    TTS timings. New pure `packages/script-studio` emits a valid `Project` + sidecar manifest (the
    Templates pattern). **Zero changes to `project-schema`/`ffmpeg-graph`.** Preview==export by
    construction. (Pexels stock + Kokoro higher-quality voice deferred to v2.)
  - **Cost (Ledger):** software genuinely $0; runs inside the existing 2-CPU worker cap (~17s CPU per
    2-min VO). First time "free" ever costs anything ≈ 2,000 generations/month (~$5/mo worker bump) —
    far past launch. No 💰 gate triggered to build or run at our scale.
  - **Out-of-MVP:** every component is `⛔` Phase 1/2 in `docs/MVP_Scope.md` → this is a 🧭 Scope gate.
- **Decisions needed:**
  1. 🧭 **Approve Script Studio** as a feature (CEO already requested it — this confirms the scope pull).
  2. **Sequencing** — **A)** post-MVP sprint, start when the Phase-0 done-gate (fidelity CI) is green;
     **B)** start the pure assembler **P0 now** (no infra, zero launch conflict) and hold the
     infra/worker stages until the launch gate clears; **C)** full parallel build now (fastest to the
     feature, but adds delivery risk to launch-hardening — Vera advises against).
  3. ⚙️ **Approve the render-worker infra delta** (add Piper binary + one voice model to the image + a
     `script` BullMQ job; $0 software, modest own-CPU) — needed before the build's P1, not before P0.
  4. ⚖️ minor: vet the specific Piper **voice-model license** before shipping a voice (per-voice terms).
- **Atlas recommends:** **B** — start P0 (the pure, headless assembler + CI guards) now since it can't
  touch or destabilize the launch path, and approve the infra delta so P1 is unblocked the moment
  Phase-0 is green. Best of both: real progress on your feature now, zero risk to the MVP ship date.
- **Cost/risk if wrong:** essentially none for B (P0 is isolated). C risks the launch timeline.
- **Decision:** ✅ **B — start P0 now, infra after** (Anuj, 2026-06-05). Script Studio **approved** as a
  feature (🧭 scope pull confirmed). Build the pure headless assembler (`packages/script-studio` + CI
  guards) **now** — it can't touch the launch path. **Render-worker infra delta approved** (Piper binary
  + 1 voice model + a `script` BullMQ job, $0) to be landed when P1 starts, after the Phase-0 fidelity
  gate is green. Per-voice license vetting required before a voice ships. Pexels stock + Kokoro = v2.

### 2026-06-04 🧭 Text overlays don't render in export (M0 gap) — blocks templates + breaks WYCIWYG
- **Raised by:** Reel (templates verify wave)
- **Context:** `buildFilterComplex` deliberately excludes text overlays from export ("out of the M0
  spine", `buildFilterComplex.ts:25`). Title/Body text a user adds — and the templates' titles/
  quotes/CTAs — show in the preview canvas but are **NOT** in the exported MP4 (only captions export
  via the subtitles filter). Impact: (1) templates aren't end-to-end (e.g. Motivational Quote exports
  with no quote); (2) any user who adds text finds it missing from their export; (3) contradicts the
  "what you cut is what you get" promise for text.
- **Options:** A) **Build text-overlay rendering (`drawtext`) into the export engine now** — Reel+Forge,
  re-baseline goldens. Fixes templates + the core text gap + the invariant. B) Workaround: rework the
  templates to put text on **caption tracks** (which DO export) — no engine change, but text is
  subtitle-styled at the bottom, not the designed titles/CTAs (looks worse). C) Ship templates with
  text **preview-only** (exported videos miss their text).
- **Atlas recommends:** **A** — it's essential for the templates feature you approved and is arguably a
  core bug fix (text you add should export) that restores the invariant. It IS real work on the
  highest-risk surface (`buildFilterComplex` + golden re-baseline), so flagging the cost honestly.
- **Decision:** ✅ **A — build text-overlay export** (Anuj, 2026-06-04). **Implemented:** Forge parity
  spec → Reel added `drawtext` to `buildFilterComplex` + Inter v4.0 in the worker image + a shared
  `layoutTextOverlay()` in project-schema; Pixel made the canvas use the same helper + multi-line.
  Preview == export by construction. Pixel-parity goldens generate in CI (no local FFmpeg).

### 2026-06-04 💰/🧭 Free-tier competitiveness — watermark & Pro toggle
- **Raised by:** Scout + Vera
- **Context:** Clipchamp & Canva already give **1080p, no watermark, free**. Our MVP plan exports a
  watermark. Scout: the parity wedge — not a watermarked free tier — must carry differentiation.
  Separately, `MVP_Scope §10` asks: ship Stripe fully stubbed, or add one hard-coded Pro path
  (watermark removal + 4K) behind a stubbed checkout?
- **Options:** A) Free + **watermark-free 1080p** (match market), Pro deferred. B) Keep watermark on
  free + add a stubbed Pro upgrade. C) Keep current plan (watermarked free, no Pro).
- **Atlas recommends:** **A** — lead on the parity guarantee, drop the below-market friction; defer
  Pro to post-MVP. Watermark is already a filter toggle, so near-zero eng cost.
- **Cost/risk if wrong:** launch messaging + first-impression of the free tier.
- **Decision:** ✅ **A — watermark-free 1080p** (Anuj, 2026-06-14). Lead on the parity guarantee, drop
  below-market friction. Pro deferred to post-MVP. Watermark becomes an off-by-default filter toggle on
  the free tier. Owner: Reel (graph toggle) + Pixel (export modal copy). Executed by Atlas.

### 2026-06-04 🧭 New-Project default aspect ratio
- **Raised by:** Vera
- **Context:** Spec/§10 assumes 9:16-vertical-first (creator wedge); README now says an aspect-ratio
  chooser with **no pre-selected default**. Inconsistent. Sets the demo narrative + TTFE benchmark
  project type.
- **Options:** A) Equal-weight chooser, no default (current README). B) Default to 9:16 vertical.
- **Atlas recommends:** **A** — the parity wedge isn't format-specific; stay format-agnostic. One-line
  config either way.
- **Cost/risk if wrong:** trivial to flip; mainly affects the demo story.
- **Decision:** ✅ **A — equal-weight chooser, no default** (Anuj, 2026-06-14). Stay format-agnostic; the
  parity wedge isn't format-specific. Owner: Pixel (NewProjectModal). Executed by Atlas.

### 2026-06-04 🧭/💰 MVP auth scope + external credentials
- **Raised by:** Core
- **Context:** The `users` table already supports email/password + Google. Email/password auth needs
  no external service. **Google OAuth** needs a Google Cloud OAuth client (id/secret/redirect).
  **Password reset** needs an email provider (Resend/SendGrid/Postmark, ~$0 free tiers).
- **Options:** A) Ship **email/password only** now; defer Google + reset. B) + Google OAuth (you
  provide creds). C) Full (Google + reset; also provide email-provider key) — adds ~2 eng-days.
- **Atlas recommends:** **A** — fastest to a real-user-ready MVP; add the rest post-launch when
  credentials are provisioned. None of this blocks starting the build.
- **Decision:** ✅ **A — email/password only** (Anuj, 2026-06-04). Google OAuth + password reset
  deferred to post-launch fast-follow.

### 2026-06-04 🚀 Pre-launch enablement (CEO admin actions, ~$0)
- **Raised by:** Anchor
- **Context:** Two things only the CEO/repo-admin can do, needed before the gates actually protect
  `main` and before observability is live — neither blocks building: (1) create a **Sentry** account
  + provide `SENTRY_DSN` + `VITE_SENTRY_DSN` (free tier, $0); (2) enable **GitHub branch-protection**
  required status checks on `main` (Stages 1–3,5,6 + e2e once hardened).
- **Atlas recommends:** Do both before launch; free tier for Sentry. I'll wire the SDK as a no-op now
  so it lights up the moment the DSN exists.
- **Decision:** ⏳ pending (not urgent — needed before "done", not before "start")

### 2026-06-04 ⚙️/💰 Perf-gate threshold strategy
- **Raised by:** Sentinel + Anchor
- **Context:** The rewritten perf gate measures real browser fps/seek (ran 60fps / 25ms locally).
  But GitHub-hosted CI runners are noisy (shared vCPU, no GPU) — an absolute "≥30fps" gate would
  flake. Needed before the perf stage becomes a hard merge-blocker.
- **Options:** A) **Relative-regression** baseline (fail on >15% drop vs last green) on free CI —
  $0. B) **Self-hosted/pinned-hardware** runner enforcing absolute ≥30fps — more reliable, adds
  infra $/setup. C) Keep perf as a non-blocking warning for now.
- **Atlas recommends:** **A** for the CI merge gate ($0, catches regressions) + keep the absolute
  30fps target as a local/release check. Revisit B only if A proves too noisy.
- **Decision:** ✅ **B — absolute ≥30fps on pinned hardware** (Anuj, 2026-06-14). CEO chose the reliable
  absolute gate over the $0 relative-regression option. ⚠️ **Follow-up money/infra gate:** this requires a
  **self-hosted/pinned-hardware CI runner** — a new (small) infra spend. **Anchor to scope the cheapest
  viable option and report the actual $/mo BEFORE provisioning anything** (no spend without a sized, logged
  💰 decision). Until the runner exists, the perf stage runs as a non-blocking warning.

<!-- template:
### [DATE] [gate-emoji] <one-line title>
- **Raised by:** <persona>
- **Context:** <2–4 lines>
- **Options:** A) … B) … C) …
- **Atlas recommends:** <option + why>
- **Cost/risk if wrong:** <…>
- **Decision:** ⏳ pending
-->

---

## ✅ Log — decided

### 2026-06-14 🧭 Canva E2E parity sweep — next-build priority + 4 new scope-gate greenlights
- **Context:** After the Canva end-to-end audit + in-scope fix batch (see STANDUP 2026-06-14), CEO chose
  the next build and ruled on the new GAP-GATEs the audit surfaced.
- **Decisions (Anuj, 2026-06-14):**
  1. **Next build = CC0 stock + music library** (the #1 adoption hole; onboarding funnel currently
     dead-ends in an empty editor). Already approved 06-05; now prioritized first. (Content/license
     sub-gate queued above.)
  2. ✅ **Greenlit 4 new scope pulls beyond MVP:** (a) numeric X/Y/W/H transform inputs for canvas
     elements; (b) canvas background-color + per-image fit; (c) project versioning / restore (the
     "never lose your work" trust play); (d) media-library search/filter.
- **Owners:** CC0 library — Pixel/Core/Forge (Scout+Ward on content). Transform inputs + bg/fit — Pixel.
  Versioning/restore — Core + Pixel. Library search — Pixel. To be sequenced after the CC0 library.
- **Decided by:** Anuj (CEO) via session Q&A; executed/queued by Atlas.


### 2026-06-10 🧭 Create→export reliability fix + full-roadmap pass (CEO test feedback)
- **Context:** CEO ran a real creator flow (Travel Recap → edit text → export) and **could not export** —
  `project failed §18 validation (3 issue(s))` + a `5 unfilled slots` warning. Rated 5.5/10; "fix the
  create→export path" called **non-negotiable**.
- **Atlas root-cause (reproduced deterministically):**
  1. **The 3 §18 issues** = the Italic/Underline text controls wrote `style.fontStyle`/`textDecoration`,
     keys absent from the strict `TextStyleSchema` → one `unrecognized_keys` issue per text overlay (3
     overlays = 3 issues). Preview tolerated them; only export-time validation rejected. (Also a latent
     italic preview≠export split: graph read `style.italic`, preview read `style.fontStyle`.)
  2. **The 5 unfilled slots** = slot-fill (drop + click) was gated on `meta.proxyUrl||thumbnailUrl`, which
     is `null` for a just-uploaded asset until the worker probes it → fill silently no-op'd, slot stayed a
     placeholder, a duplicate clip was added.
  3. **Opaque/unrecoverable error** = the export doc was sanitized *after* the local validate, so the
     server was first to reject it (no preflight, no jump-to-item).
- **Shipped (this session, verified — typecheck clean; golden/ffmpeg-graph 62, schema 47, templates 92, new lib regressions green):**
  Italic now writes the schema `italic` field (preview unified on it); slot-fill no longer gated on proxy;
  a client **export preflight** builds the exact worker snapshot, validates it, lists each blocker with a
  jump-to-item, and disables Export until clean; legacy bad style keys are stripped so pre-fix projects can
  still export. Single source of truth: `apps/web/src/lib/templates.ts › buildExportDocument`.
- **CEO decisions (3):** **(scope)** full-roadmap pass — go beyond the export fix; **(empty slots)** BLOCK
  with a preflight checklist (not silent prune to footage-less video) — shipped; **(underline)** implement
  end-to-end.
- **🧭 Underline — Atlas flag + re-scope:** FFmpeg `drawtext` has **no underline** and no shared glyph-width
  helper exists, so honoring the *what-you-cut-is-what-you-get* invariant needs a new text-metrics subsystem
  (Inter advance-width tables + golden parity) — a real task, not a button. Italic was already end-to-end so
  it shipped now; the **corrupting underline writers were removed** (so the doc can never be poisoned) and
  underline-render is queued as its own invariant-guarded milestone (owner Reel, guard Forge). Surfaced to CEO.
- **Decided by:** Anuj (CEO) via session Q&A; executed by Atlas.

### 2026-06-04 🧭 Company operating model
- **Decision:** Run Zentrix as a 14-persona org (Atlas + 13 specialists), bounded-autonomous
  with this decision queue. Full scaffold approved by CEO.
- **Decided by:** Anuj (CEO)

### 2026-06-04 🧭 Templates feature (scope expansion — CEO-approved)
- **Decision:** Build a **Templates** feature — 4–5 customizable "day-to-day life" templates for
  quick 30–40s videos: user picks one, swaps media/text/captions, and exports. Pulled forward from
  post-MVP at the CEO's explicit request. Must work **end-to-end**.
- **Decided by:** Anuj (CEO). Blueprint (research/spec/design/architecture) in progress; the specific
  5-template selection to be confirmed with the CEO before the build phase.
