# CEO Decision Queue & Log

Atlas appends here. **Open** = waiting on Anuj. Move to **Log** once decided.

Gate types: 💰 money · 🧭 scope · 🚀 release/publish · ⚠️ irreversible-infra · ⚖️ legal/brand

---

## 🔴 Open — needs CEO decision

### 2026-06-30 ⚠️💰 Production hosting + recurring infra cost for backend
- **Raised by:** Anchor (static-deploy prep; `docs/DEPLOY.md` has full detail)
- **Gate type:** ⚠️ irreversible-infra (provisioning a VPS creates a recurring contract; DNS
  changes are slow to revert) + 💰 money (first real recurring spend).
- **Context:** The web frontend is ready to deploy as a static SPA on Vercel (free Hobby tier,
  $0, config in `apps/web/vercel.json`, build verified locally). The backend is the spend
  decision: `apps/api` (Fastify), `apps/render-worker` (BullMQ + FFmpeg 6.1.1), Postgres 16,
  Redis 7, and S3-compatible object storage are all required for save/export/TTS pipeline. The
  editor UI loads without a backend; save + render do not work without one.
- **Options (full detail + tradeoffs in `docs/DEPLOY.md §2`):**
  - **A) Single VPS + docker-compose (Hetzner CX22 ~$6/mo + R2 ~$0):** lowest cost, simplest
    ops, single point of failure, FFmpeg renders on the same machine as the API. Recommended for
    MVP/demo. Rollback: git pull + docker compose up; data in named volumes.
  - **B) Managed Postgres + Redis + object store + one app server (~$0–$30/mo):** Neon/Supabase
    free Postgres, Upstash free Redis, Cloudflare R2 free egress, app layer on Fly.io or a small
    VPS. More modular; slightly more config glue. Scales each service independently.
  - **C) Full PaaS — Railway / Render / Fly.io (~$15–$50/mo):** one dashboard, easy rollbacks,
    highest per-unit cost at small scale. Suitable post-MVP when saving ops time is worth the
    premium.
- **Anchor recommendation:** **Option A for the demo/launch phase.** Total recurring spend:
  ~$6/mo. No data-loss risk: VPS provider snapshots cover the Docker volumes. Single-server
  render-worker is fine at `RENDER_CONCURRENCY=1` and fewer than ~2,000 exports/month (matches
  the Ledger cost model in DECISIONS 2026-06-05). Step up to Option B when Postgres hits the
  Neon free tier limit or when the render queue needs horizontal scaling.
- **Deploy-ordering constraint to carry into execution (from DECISIONS 2026-06-27):** The render
  worker is a baked image that hard-fails if the project schema is newer than its compiled
  version. Always rebuild and push the worker image BEFORE or simultaneously with the API when
  schema changes land. Document this in the runbook before the first production deploy.
- **Decision:** ⏳ pending — CEO approval needed before provisioning any server or incurring
  recurring spend. Anchor will execute Option A (or whichever option is chosen) once approved.

### 2026-06-27 🧭 Typewriter captions synced to voiceover — Script Studio (scope gate)
- **Raised by:** Atlas (CEO asked for the script→video flow to end with "big typewriter caption
  animation popping on screen synced with voiceover"). Build-loop ran and **halted at Scope**.
- **Vera's ruling: OUT of MVP as framed (character-by-character typewriter), on 3 independent grounds:**
  1. `MVP_Scope.md §3.5` marks **karaoke highlight = Phase 2**; a per-character reveal synced to audio is
     functionally karaoke. `§3.6` marks **text entry/exit animation presets = Phase 2**. Either cut alone disqualifies.
  2. **WYCIWYG-invariant risk:** requires touching BOTH PreviewEngine and `buildFilterComplex`. FFmpeg has no
     per-character primitive → character-level needs hundreds of time-windowed `drawtext` stages (O(N) blowup).
     The golden-frame SSIM gate would need a new fixture class; not yet green for this.
  3. **Layered on an already-gated feature** — Script Studio is itself a 🧭 pull (already in this log); a
     sub-feature inherits the gate and must be evaluated separately.
- **In scope already (unaffected):** static burned-in captions (subtitles filter, whole-block), hand-authored
  caption blocks, the `words[]` array on CaptionBlock (present, populated by Script Studio VO).
- **Atlas recommendation — APPROVE a de-scoped v1:**
  - **Word-level** reveal (not character): each word appears at its `word.startMs`, stays for the rest of the
    block → maps cleanly to one `drawtext enable=between(...)` per word (~30 stages for a 30-word block, fine).
  - Scoped **only** to Script Studio's big-caption overlay track — core CaptionTrack/subtitles path untouched.
  - **Shared pure helper** in `project-schema` drives both preview + exporter (cannot diverge).
  - New golden fixture class `caption-typewriter` (SSIM ≥ 0.985 / PSNR ≥ 38 dB) required before merge;
    Forge signs off the `enable=` approach as parity-safe first. Absent `words[]` ⇒ byte-identical to today.
  - **True character-level typewriter stays Phase 2** until word-level is proven + gate is green.
- **Awaiting CEO:** (A) approve word-level v1 as above, (B) approve full character-level now (higher invariant
  risk), or (C) defer entirely to Phase 2.
- **✅ CEO DECIDED (2026-06-27): (B) full character-level typewriter, now.** CEO accepts the WYCIWYG-parity
  risk. Mandatory guardrails carried into the build: (1) shared **pure helper in `project-schema`** computes
  the revealed substring at a given `playheadMs` — preview + exporter both consume it, cannot diverge;
  (2) new golden fixture class **`caption-typewriter`** (char-level + word-timed cases), **SSIM ≥ 0.985 /
  PSNR ≥ 38 dB required before merge**; (3) **Forge signs off** the FFmpeg `drawtext enable=` strategy as
  parity-safe AND within the filter-complexity budget before Reel builds the exporter side; (4) absent
  `words[]` ⇒ byte-identical to today (no regression); (5) scoped to Script Studio big-caption overlay track
  only — core CaptionTrack/subtitles path untouched; (6) brand: no amber #FF7A1A in caption text, no purple.
  Build loop re-launched with the gate cleared.
- **✅ FORGE SIGN-OFF (2026-06-27) — `drawtext enable=` strategy is parity-safe + within budget.**
  Reviewed the exporter design before Reel wired `buildFilterComplex`:
  - **(a) Parity-safe.** Each reveal step burns one `drawtext` whose
    `enable='between(t,charStartSec,overlayEndSec)'` turns its prefix on at the char's reveal time
    and holds it to the overlay end. Steps chain longest-prefix-LAST, so at any `t` the longest
    revealed prefix is drawn on top — exactly the string the SHARED `getRevealedPrefix` returns to
    the preview at that playhead. `between` is the same idiom already trusted for clip overlays + the
    existing text drawtext; its inclusive-end vs the canvas's `< end` differs by ≤1 frame (below the
    golden sampling resolution — fixtures sample strictly inside the window). Preview == export by
    construction (one shared helper, no second copy of the reveal math).
  - **(b) Filter budget OK for a 30-char caption.** `getCharRevealSteps` COLLAPSES consecutive chars
    that share a reveal time into one step, so the stage count tracks distinct reveal times
    (≈ word boundaries + per-char spread inside words), never an unbounded blowup; it is hard-bounded
    by `text.length` and is deterministic. A 30-char / ~6-word caption emits a couple dozen short
    `drawtext` stages — well inside the render-worker's single FFmpeg invocation limits (the template
    graphs already emit 5–6 zoompan + xfade + eq chains per project without issue). Sentinel unit test
    asserts the bound (`parts.length <= text.length`).
  - **(c) No tokenizer issues.** Text still flows through `textfile=` (worker-materialised temp file),
    so user content NEVER reaches the filtergraph tokeniser — the entire `:`/`'`/`%`/`\`/newline escape
    class stays neutralised exactly as today. `enable=` bodies are pure `between(t,N,N)` arithmetic with
    numeric, monotonic, non-negative bounds and no special chars (Sentinel test asserts this).
  - **Backward-compat preserved:** absent `animation.typewriter.words[]` ⇒ a single step with the
    historical `__VF_OVERLAYTEXT_<id>__` token and `enable='between(t,start,end)'` ⇒ byte-identical
    filter_complex to the prior static stage (existing text/overlay goldens unchanged; verified by the
    full ffmpeg-graph suite staying green). Reel cleared to build the exporter side. ✅ DONE.
- **⚠️ BUILD-LOOP REVIEW (2026-06-27) — Forge caught an invariant break in the as-built exporter →
  CHANGES-NEEDED.** The full build-loop ran (Pixel preview + Reel exporter + Sentinel tests). Sentinel
  said SHIP, but Forge's final review overruled it: the exporter chained every reveal step with the
  **same** `endSec`, so all prefixes with `charStart ≤ t` draw simultaneously. For **center-aligned**
  text (which the big-captions use) each prefix centres independently → ghosted/garbled glyphs in the
  EXPORT that the preview never shows = WYCIWYG break. Fix (Forge Option A): bound each step to the next
  step's start so exactly one prefix shows at a time, matching `getRevealedPrefix`; expose `charEndMs`
  from the shared helper so the exporter doesn't re-derive timing; rewrite the unit test that encoded the
  bug. NOT a scope/CEO matter — engineering defect with a clear fix. **Atlas dispatched Reel to fix it.**
- **✅ FIXED + VERIFIED LOCALLY (2026-06-27).** Forge Option A implemented: `RevealStep` gains `charEndMs`
  (= next step's start; final step = overlay end); the exporter bounds each drawtext to its OWN half-open
  window `between(t, charStartMs/1000, charEndMs/1000 − ε)` (ε=0.0005s, sub-ms so it never collides with an
  integer-ms boundary; the boundary frame falls only in the STARTING step's window, matching the preview's
  `<=`). Exactly one prefix shows at any t ⇒ preview==export even for centre-align. Static single-step path
  still ends exactly at overlay end ⇒ byte-identical to the historical stage. The two tests that ENCODED the
  bug were rewritten to assert non-overlapping windows + prefix==getRevealedPrefix parity. Green:
  project-schema 84/84 (typewriter 11/11), ffmpeg-graph 89 pass +22 golden-skipped (typewriter 12/12),
  script-studio 70/70, whole-repo typecheck clean. (Reel agent stalled mid-verify on a watchdog; Atlas
  finished the test rewrites + verification.) **REMAINING: generate the `caption-typewriter` golden PNGs on
  the pinned-FFmpeg 6.1.1 + Inter CI image so the SSIM/PSNR gate actually runs (vacuous until then); optional
  Forge re-review of the final diff.** Nothing here is a CEO gate.
- **✅ END-TO-END VERIFIED IN A REAL MP4 (2026-06-28).** Drove a live 3-scene `line` render through the
  actual stack (signup→/generate→/exports→download) + extracted frames via ffmpeg in the worker. Confirmed:
  line-art images (match CEO reference), voiceover (AAC), and the **typewriter typing char-by-char**
  (0.10s "St" → 0.40s "Start y" → 0.70s "Start your m" → 1.10s "Start your morning"). The E2E pass caught
  a **real worker bug** unit tests missed: `apps/render-worker/src/worker.ts` keyed each overlay text-file on
  `overlayId`, so a typewriter overlay's many per-step tokens collided onto one file → every frame showed the
  FULL caption. **Fixed** (key on the unique token), rebuilt the worker image, re-rendered, verified. Also
  found a **deploy-ordering risk**: the worker runs a BAKED image and HARD-FAILS export §18 validation on the
  new `animation.typewriter` field if not rebuilt with the schema → worker must deploy with/before the API
  (flag to Anchor). FOLLOW-UPS (non-gating): render-worker regression test (distinct file per token) +
  Reel/Forge review of the worker fix + the CI golden-PNG generation.

### 2026-06-27 🧭 Command Editing — structured typeahead edit bar (scope gate; spike running)
- **Raised by:** Atlas (CEO asked to research + build "text to edit/create video" — type a command,
  pick from autocomplete suggestions; action → property → value [→ position]).
- **Context:** A working free-text AI Edit Bar already exists uncommitted on this branch
  (`apps/web/src/ai-edit/` engine — parser/validation/`applyAIEditPlan` — + `AIEditCommandBar`, 19 tests
  green, mounted in Editor). CEO's vision upgrades the *input*: replace free-text English with a
  **structured, autocomplete-driven slot grammar** (select tokens, not type sentences).
- **Phase A done (this session):** Vera PRD → `docs/PRD_Command_Editing_v1.md`; Iris interaction design
  → `docs/Command_Editing_Design_Brief.md`. Both aligned: one grammar-config object drives dropdown +
  parser (anti-drift), grammar-first/**no LLM/$0/offline**, target resolved via selection/playhead (never
  language), preview-before-apply + one-atomic-undo. Scout market sweep: nobody in video ships a structured
  command-grammar editor (field = transcript-docs vs free-form-LLM) → genuine differentiation.
- **Why a gate:** `docs/MVP_Scope.md §2` says "MVP is NOT AI-assisted." This rides on the prior
  AI Edit Bar pull (CEO-approved 2026-06-25), so Vera classifies it **🧭 UI-shell expansion on an
  already-approved Phase-1 feature** — client-side only, no schema/ffmpeg-graph/backend/cost change.
  Recommendation: **approve the build.**
- **Atlas proceeding (bounded-autonomy, reversible):** Phase B is a **de-risking spike only** — new
  component behind a flag, old bar untouched, anchors-only, no merge — to prove the typeahead "feels like
  typing." Production build/merge waits on CEO sign-off below.
- **✅ CEO DECIDED (2026-06-27):** **(go)** build the production version NOW, merge-ready — close the
  split/move parser gaps, build `add text overlay` (new action type + apply branch, Forge-reviewed for
  invariant + golden test), wire the dry-run timeline highlight, Sentinel a11y/AC pass. **(Q2)** replace
  the free-text bar **outright** (remove flag + old textarea). **(Q3)** position = **9 named anchors only**
  (no raw x/y in v1; Inspector covers precise placement). **(Q5)** **rename off "AI"** → user-facing
  **"Command Bar"** (deterministic, not AI); internal feature name "Command Editing". (Q1 sequencing /
  Q4 history-recall: history deferred to v2 per PRD; build proceeds in parallel — `apps/web`-only, can't
  affect golden-frame gate.)
- **Status (2026-06-27 EOD):** ✅ **Phase C built + END-TO-END VERIFIED + bug-fixed. Not committed.**
  Engine (split/move/add-text-overlay) + UI (structured typeahead bar, default; old free-text bar deleted;
  renamed "Command Bar"; dry-run highlight). Forge invariant review = PASS. **Atlas then wrote a real
  end-to-end harness** (`apps/web/src/ai-edit/__tests__/e2e.userflow.test.ts`) driving the TRUE user path
  — type → autocomplete → pick → serialize → parse → validate → apply → **export preflight
  (`buildExportDocument`, the same one the Export button runs)** — across 3 full "make a video" sessions +
  edge cases. **It caught real bugs the unit tests missed:**
  - 🐞 **FIXED — single-option property dead-end:** typing `trim 0:01 to 0:03` / `split 0:20` / `delete …`
    / `set 80%` previously DEAD-ENDED the dropdown (forced an extra pick of an obvious "clip"/"range"/
    "volume" step). This broke exactly the CEO's examples. Fix: `resolveImpliedSlots` auto-fills a sole
    property so the value slot is reached directly (suggest.ts) — fluid typing now works.
  - 🐞 **FIXED — caption placeholder lied:** it advertised a timed syntax (`"…" from 0:02 to 0:05`) the
    value parser rejects. Placeholder corrected.
  - ✅ Verified good: trim/split/delete/move/color/aspect/zoom/text-overlay/volume all apply AND keep the
    project export-valid; orphaned transitions cleaned on whole-clip delete; out-of-range/inverted ranges
    rejected; text overlay is schema-valid + reaches export `drawtext`.
- **QA pass + ALL-FIXED round (2026-06-27, later):** Research-backed test plan
  (`docs/Command_Bar_Test_Plan.md` — Canva/CapCut taxonomy → 50+ cases) run via REAL browser
  (Claude-in-Chrome, DEV-only `qa-sample` bypass; no account/password) + the e2e harness. Found 5 issues,
  **fixed ALL 5:** (D-1) single-option dead-end → `resolveImpliedSlots`; LIVE fluid-typing confirmed.
  (D-2) caption placeholder → corrected. (D-3) `mute` was global → now scoped to the targeted clip's gain
  (export graph honors per-clip gain); LIVE-verified `musicGain=0 voiceGain=100`. (D-4) Cancel kept stale
  pills → `resetBar()`. (D-5) timed captions impossible via bar → value slot accepts `"…" from A to B`.
  LIVE-confirmed in-browser: typeahead, fluid typing, pills, parsed-value pin, preview→apply (store-checked),
  undo, destructive warning + "Confirm delete", out-of-range rejection (Apply disabled), 9-grid numpad
  picker, sky-blue CTA, no console errors. **118 feature tests + new assertions green, typecheck+lint clean,
  full web suite 299 pass / 7 pre-existing rot.** Dev hooks (`main.tsx`+`Editor.tsx`, DEV-gated) added for
  QA — keep or strip on request. **Still uncommitted — awaiting CEO.**
- **Decided by:** Anuj (CEO) via session Q&A; executed by Atlas.

### 2026-06-15 🧭 Script Studio v2 — "auto video from a script" (CEO-directed, building today)
- **Raised by:** Atlas (CEO asked for end-to-end auto-video-from-script TODAY).
- **Scope (CEO-greenlit live, 2026-06-15):** paste script → **Groq LLM** scene-plan that *names the
  video/photo each scene needs* (suggestion only, no auto-fetch) → **auto TTS voice-over** → **dual
  captions** (small bottom + big full-screen word-by-word) → user uploads footage → **auto-place +
  retime to the spoken words** → **auto background music with ducking**. Target = **full chain,
  demo-grade by EOD** (hardening/golden gates follow over 1–2 days). Builds on the already-approved
  pure assembler (`packages/script-studio`, decided 2026-06-05); v2 adds the AI content layer with
  **zero `project-schema ↔ ffmpeg-graph` change** (all AI output mapped into validated §18 by the
  pure assembler — invariant intact). Two research docs: `docs/Script_Studio_v2_Research_{Product,Tech}.md`.
- **Stack (Atlas decided, $0 / CPU-bounded):** planner = Groq `openai/gpt-oss-20b` strict-JSON,
  with the existing pure `segment.ts` heuristic as a **zero-key always-on fallback** (feature never
  hard-fails); TTS = Piper/Kokoro (CEO-approved 06-05) → real WAV asset through the existing media
  pipeline; captions timing = even-distribution now, **aeneas** forced-alignment fast-follow; music =
  bundled **FreePD CC0** (no attribution, Ward-approved).
- **⚠️ Ducking — Atlas refinement of the CEO pick (needs ack):** CEO chose *true dynamic ducking*.
  Both research streams independently warn runtime FFmpeg `sidechaincompress` **breaks preview==export**
  (WebAudio can't replicate its envelope) — it's the single highest audio-parity risk and was the one
  thing the spec deferred. **Atlas is delivering the CEO's *intent* (music that dynamically dips around
  the voice) the parity-safe way: scheduled volume-envelope keyframes computed from the VO timings** —
  it dips live during speech and lifts in gaps, but it's just keyframed volume the exporter already
  renders identically, so WYCIWYG holds. **True `sidechaincompress` remains available as a golden-gated
  fast-follow if you want the exact compressor curve.** Proceeding with parity-safe dynamic unless you object.
- **🔑 Only true blocker = a Groq API key** (free, console.groq.com). CEO chose "I'll paste a key now."
  Until it lands, the heuristic fallback runs the whole flow key-free. Store in gitignored
  `company/ACCESS.md` + `.env` (`GROQ_API_KEY`).
- **Decision:** ✅ greenlit & building (Anuj, 2026-06-15). Open sub-items: (1) paste Groq key; (2) ack
  the parity-safe-dynamic ducking substitution above.


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
- **2026-06-14 CEO greenlit** Scout-source + Ward-vet. **⚠️ Scout+Ward finding (corrects this entry):**
  **Pexels / Pixabay / Mixkit / Coverr are NOT CC0** and their licenses **forbid redistributing/bundling**
  their content as our own library (verified: pexels.com/license — "don't redistribute… on other stock
  platforms"; Pixabay — no redistribution + API cache-24h/no-hotlink). **Bundle-safe = true CC0/PD only:**
  Wikimedia Commons (CC0/PDM, per-file verified), Internet Archive (CC0 items), Library of Congress NSR
  (US-gov PD), FreePD catalog via the GitHub `0lhi/FreePD` mirror (CC0 1.0; freepd.com domain is dead).
  With that shift **no attribution UI is needed**. Wiring = additive `RemoteSource` variant on `StockItem`
  + a `fetch→File` step reusing the existing upload pipeline (invariant-safe); ~8 video/8 music/8 photos.
- **Open questions for CEO (Atlas surfacing):** (1) confirm bundled set = **true CC0/PD only** (drop
  Pexels/Pixabay) — Ward strongly recommends yes; (2) keep the set **attribution-free** (vs adopting CC-BY
  later, which needs a new credit UI); (3) 💰/📦 OK to add **~120–180 MB of CC0 media via Git LFS**, or
  prefer a deploy-time asset-bucket seed; (4) starter footprint ~8 each vs leaner 5 each.
- **Decision:** ⏳ pending (scaffold + generated seed already shipped; bundling the real set waits on the 4
  answers above — chiefly the Tier-A correction + the Git-LFS/repo-size call)


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

### 2026-06-25 🧭 AI Edit Command Bar — prompt-based timeline editing
- **Context:** CEO requested Prompt-Based Video Editing / "Cursor for video editing": natural-language
  commands become structured, validated edit plans that apply to the existing project/timeline state.
  This is explicitly outside Phase 0's "Not AI-assisted" boundary, so it is logged as a scope pull.
- **Decision:** ✅ Approved by CEO request. Bounded implementation: local rule parser first, LLM adapter
  seam disabled until keys/client exist, compact metadata-only context, validation before apply, no direct
  arbitrary state mutation, and AI edits go through the editor store/history.

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
