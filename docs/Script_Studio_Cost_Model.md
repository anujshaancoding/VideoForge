# Script Studio — True-Cost Reality Check

**Author:** Ledger (Finance / BizOps — advisory) · reports to Atlas  
**Date:** 2026-06-05  
**Status:** Pre-build cost model. Advisory only. No spend authority. All 💰 gates route to Atlas → CEO.  
**Reads:** `company/COMPANY_OS.md`, `docker-compose.yml`, `apps/render-worker/Dockerfile`,
`docs/Script_Studio_Research.md`, `docs/Script_Studio_Architecture.md`, `docs/MVP_Scope.md`.

---

## 0. The honest framing

The CEO mandate is "$0, no purchases." That constraint is **real and correct for software and
licensing** — every component Scout and Forge selected (Kokoro-82M Apache-2.0, piper-plus MIT,
whisperX Apache-2.0, Pexels free API, FFmpeg existing) costs **$0 to license and $0 to
acquire**. The rule holds.

What "free software on our own compute" does not make free is the **time on the CPU that is
already paying rent**. The render-worker container already runs under a hard 2 CPU / 2 GB cap
(imposed after the overheating incident that pegged the host Docker VM at ~615% CPU). Script
Studio adds a new class of work — TTS synthesis + optional forced-alignment — to that same
capped container. This document models what that addition actually costs in compute time, storage,
and rate-limit exposure so the CEO can make an informed decision before a line of product code
is written.

**The bottom line (preview):** at self-host/MVP scale, Script Studio is genuinely $0. The first
threshold where "free" forces a 💰 decision is a single concurrent user generating a video longer
than ~4–5 minutes — that is where the render-worker's 2-CPU cap starts to serialize work that
used to run in parallel, degrading export throughput below the 4× realtime target committed in
`MVP_Scope.md §8`.

---

## 1. Software / licensing cost — the $0 confirmation

| Component | License | Cost | Commercial OK? | Note |
|---|---|---|---|---|
| **Kokoro-82M TTS** (primary) | Apache-2.0 | $0 | Yes | Engine + default voices; voice model licenses must be checked per voice before shipping |
| **piper-plus** (fallback) | MIT | $0 | Yes | Avoids GPL-3.0 piper1-gpl fork; piper voice models carry per-voice licenses — vet each |
| **whisperX forced-align** | Apache-2.0 | $0 | Yes | Fallback only; not on the hot path if TTS timestamps are used |
| **Pexels API** | Free tier, no card | $0 | Yes | ToS requires attribution; 200 req/hr / 20k req/mo default ceiling |
| **Pixabay API** | Free tier, no card | $0 | Yes | Requests (not strictly requires) attribution |
| **FFmpeg** | LGPL/GPL (existing) | $0 | Already used | No change to licensing exposure |
| **Generated text-cards** | Own code | $0 | N/A | Zero external dependency |

**Licensing verdict: $0, confirmed.** No vendor, no card, no per-use fee. The "no purchases"
mandate is structurally satisfied by the chosen stack.

**Caveat that survives this verdict:** Piper and Kokoro voice *models* ship under per-voice
licenses that are separate from the engine license. Before a specific voice ships to users,
each voice file's license must be individually verified (Scout/Ward lane). This is a legal gate,
not a cost gate — but it is real and must not be skipped.

---

## 2. Compute cost per generation

### 2.1 Assumptions

| Parameter | Value | Basis |
|---|---|---|
| Script length (typical) | 300 words | ~2 min video at ~150 wpm |
| Script length (long) | 750 words | ~5 min video |
| Spoken duration (typical) | 120 s | at ~150 wpm |
| Spoken duration (long) | 300 s | at ~150 wpm |
| Piper TTS speed | 5–10× realtime on commodity CPU (1 core) | Forge/Scout cite "faster-than-realtime on commodity CPU"; Piper benchmarks on ARM/x86 cores at 5–10× RTF for the English neural voices |
| Kokoro ONNX speed | 2–4× realtime on commodity CPU (1 core) | Heavier model than Piper; CPU-only ONNX inference; 82M params |
| whisperX forced-align | ~1× realtime (wav2vec2 CPU) | Used only as fallback; NOT on the primary path |
| FFmpeg assembly + mux | ~0.5–1 s per generation | Negligible vs TTS; text-card compositing adds a few extra frames |
| Worker CPU cap | 2.0 vCPU | docker-compose.yml `deploy.resources.limits.cpus: "2.0"` |
| Worker RAM cap | 2 GB | docker-compose.yml `deploy.resources.limits.memory: 2g` |

### 2.2 Per-generation CPU time estimate

**Primary path: Piper TTS (faster, CPU-optimized)**

```
Typical (120 s VO):
  TTS synthesis:    120 s / 7× RTF  = ~17 s on 1 core
  Assembly + mux:                   ~1 s
  Total added load:                 ~18 s CPU-seconds (1 core equivalent)

Long (300 s VO):
  TTS synthesis:    300 s / 7× RTF  = ~43 s on 1 core
  Assembly + mux:                   ~1 s
  Total added load:                 ~44 s CPU-seconds
```

**Alternative path: Kokoro-82M ONNX (higher quality, slower)**

```
Typical (120 s VO):
  TTS synthesis:    120 s / 3× RTF  = ~40 s on 1 core
  Assembly + mux:                   ~1 s
  Total added load:                 ~41 s CPU-seconds

Long (300 s VO):
  TTS synthesis:    300 s / 3× RTF  = ~100 s on 1 core
  Assembly + mux:                   ~1 s
  Total added load:                 ~101 s CPU-seconds
```

**Fallback path: + whisperX forced-align (not on primary path)**

```
whisperX forced-align adds ~1× RTF → adds 120 s (typical) or 300 s (long) of extra CPU time.
This path is only activated when TTS does not emit word timestamps.
Primary Piper/Kokoro paths emit native timestamps and avoid this entirely.
```

### 2.3 Context: what the existing render job costs

The existing FFmpeg export already runs inside this 2-CPU cap. For context:

```
Existing render job (1080p/30fps, 60 s project):
  At committed ≥4× realtime throughput (MVP_Scope §8):  ~15 s wall-clock on 2 CPUs
  CPU-seconds consumed:                                  ~30 CPU-seconds (2 cores × 15 s)
```

Script Studio adds a *new, sequential BullMQ job* (`script` job type) that runs **before** the
render job. These are not concurrent by design (Forge §2.3: synthesize → probe → assemble →
persist → then user triggers export). So the question is not "do they collide?" but rather:
**does the script job's duration overlap with another user's render job?**

---

## 3. Does Script Studio fit inside the 2-CPU / 2-GB cap?

### 3.1 CPU

**Single user, single job (the MVP/self-host scenario):**

The script job uses 1 core at a time (single-threaded TTS inference). The 2-CPU cap is not
hit. Wall-clock time for the TTS phase: ~18 s (Piper, typical) to ~101 s (Kokoro, long script).
This is acceptable latency for an async job.

**Concurrent load (the risk scenario):**

If a render job and a script job run simultaneously (two users, or one user exports immediately
after generating), both compete for the 2-CPU cap. Neither will crash — Docker's limit enforces
soft throttling — but the render job's effective throughput drops below the 4× realtime target.
For a 60 s export that normally finishes in ~15 s wall-clock, adding a concurrent TTS job that
consumes ~1 CPU reduces available render throughput to ~1 CPU, pushing wall-clock to ~30 s.
That is still a 2× realtime export, which is usable — but it breaks the committed 4× gate.

**Verdict:** The 2-CPU cap is not a blocker for self-host/MVP single-user. It **starts to
pressure the export fidelity gate** under concurrent load, which at self-host scale means
"two things happening at the same time" — an unlikely but not impossible condition.

### 3.2 RAM

Piper inference (neural English voices): ~150–400 MB resident during synthesis.
Kokoro-82M ONNX: ~600–900 MB resident during inference.
Existing FFmpeg jobs: ~200–400 MB peak per job.

```
Worst-case concurrent RAM (Kokoro + FFmpeg):
  Kokoro ONNX:     ~800 MB
  FFmpeg render:   ~350 MB
  Node + BullMQ:   ~150 MB
  Total estimate:  ~1,300 MB  →  within the 2 GB cap, ~650 MB headroom
```

Piper is more comfortable: ~550 MB total concurrent, ~1,450 MB headroom.

**Verdict:** RAM is not a constraint at this scale with either engine. Kokoro is tighter but
still safe. No 💰 decision required for RAM.

### 3.3 Summary — "does it fit?"

| Scenario | CPU fit? | RAM fit? | Export target met? |
|---|---|---|---|
| Single user, Piper TTS, solo job | Yes | Yes | Yes |
| Single user, Kokoro TTS, solo job | Yes | Yes | Yes |
| Two concurrent jobs (1 TTS + 1 render), Piper | Soft-throttled | Yes | Borderline (2× vs 4× RT) |
| Two concurrent jobs (1 TTS + 1 render), Kokoro | Soft-throttled | Yes | Misses 4× gate |
| whisperX fallback enabled, concurrent | Soft-throttled | Yes | Misses 4× gate |

---

## 4. Storage and egress delta

### 4.1 Per-generation storage (MinIO / S3)

| Artifact | Size estimate | Basis |
|---|---|---|
| TTS WAV (mono, 16-bit, 22 kHz) — typical 120 s | ~5 MB | 22,050 Hz × 2 bytes × 120 s |
| TTS WAV — long 300 s | ~13 MB | Same formula |
| TTS AAC proxy (existing `media` worker transcodes to AAC) | ~240 KB (typical) / ~600 KB (long) | AAC ~128 kbps, audio-only |
| Pexels stock video clip (if fetched and stored; optional) | ~5–20 MB per clip | Varies heavily by resolution/duration; Pexels free videos are typically 720p–1080p short clips |
| Generated text-card assets | ~0 MB (rendered on-the-fly by FFmpeg) | Text cards use `drawtext`; no stored asset |
| Sidecar `ScriptManifest` JSON | < 10 KB | Metadata only |

**Net storage delta per typical generation (text-cards only, no stock):**
- WAV original: ~5 MB
- AAC proxy: ~240 KB
- Manifest: negligible
- **Total: ~5.25 MB per typical generation**

**With Pexels stock (5 scenes, ~10 MB average per clip):**
- Add ~50 MB per generation

At self-host/MVP scale (tens of generations total), total storage impact is in the tens to low
hundreds of MB — negligible against MinIO running on local disk. At any hosted scale, this is
S3-standard storage cost, which at current AWS pricing runs ~$0.023/GB-month — about **$0.00012
per typical generation stored for one month**. Even at 1,000 generations per month, that is ~$0.12
in storage. This is not a decision-forcing number at MVP scale.

### 4.2 Egress delta

In the self-host / local MinIO scenario: no egress cost (all traffic stays local).

In a hypothetical hosted scenario:
- The rendered VO asset is exported once per export job (already inside the existing export
  egress budget — it exits as part of the MP4).
- If Pexels clips are fetched and cached in S3 before assembly, they add one S3 GET per unique
  clip per generation (if not deduplicated) and one ingress (which is free). Egress occurs at
  export as part of the final MP4, not as a separate download.

**Egress verdict: not a new cost vector at MVP scale.** The stock clips, if used, are paid for
via egress only at export time, not at fetch time. The VO WAV is internalized into the MP4 and
never separately downloaded. No new egress surface.

---

## 5. Free-tier API limits as a cost-shaped risk

### 5.1 Pexels API — 200 req/hr / 20,000 req/month

The Pexels API is genuinely free — no card, no payment tier — but rate limits impose an
implicit cost in the form of a caching requirement. Without caching:

```
A 5-scene video = 5 Pexels search API calls
200 req/hr limit → 40 concurrent video generations before throttling
At 20k req/mo default → ~4,000 video generations/month (5 calls each)
```

These are generous limits for MVP scale. The risk is not cost — it is **availability**. If the
API is hammered (user retries, a caching miss storm, or an automated test hitting the live API),
generation fails with HTTP 429 at no cost but with user-visible errors.

**Mitigation that keeps this at $0:** Cache Pexels search results and asset metadata in Redis or
a simple in-memory / PostgreSQL table by keyword + resolution + orientation. A cache hit costs
zero API calls. This is a build-once pattern that Forge/Core own; it does not require any spend.

**What changes the answer:** If the product ever runs multi-tenant with >4,000 Script Studio
generations per month that each search for fresh clips (no cache), a Pro Pexels API key
(~$50/mo for 5,000 req/hr) becomes worth evaluating. That is a 💰 gate — flag when monthly
generation volume approaches 2,000 (leaving a 50% buffer before the monthly ceiling).

Pixabay has similar structure (100 req/60s) and serves as a fallback mirror, not a remedy to
the rate-limit ceiling.

### 5.2 Rate limit risk matrix

| Volume | Pexels calls/mo | Within 20k limit? | Action |
|---|---|---|---|
| MVP / self-host: 100 generations | 500 | Yes (2.5% of limit) | No action needed |
| Early launch: 500 generations/mo | 2,500 | Yes (12.5% of limit) | Implement caching as a precaution |
| Growth: 2,000 generations/mo | 10,000 | Yes (50% of limit) | Caching required; monitor |
| Scale: 4,000 generations/mo | 20,000 | At ceiling | 💰 gate — evaluate paid API key |
| Beyond: 4,001+ generations/mo | 20,001+ | No | 💰 gate triggered |

---

## 6. Scenarios — where "free" stops being free

### Scenario A — Local dev / self-host (CEO's machine, MVP validation)

| Dimension | Assessment |
|---|---|
| Software/licensing | $0 — confirmed |
| CPU | No new cost. Single user, no concurrency. TTS adds latency, not spend. |
| RAM | No constraint |
| Storage | Negligible MB on local disk |
| Egress | $0 (MinIO, local) |
| API limits | No risk at personal-use volume |
| **Verdict** | **Genuinely $0. Build and run freely.** |

### Scenario B — Single hosted instance, low volume (self-host VPS, ~100 users/month)

| Dimension | Assessment |
|---|---|
| Software/licensing | $0 |
| CPU | The 2-CPU worker cap handles this. Occasional contention between TTS and render jobs at peak but no new spend — just queue depth increases. |
| RAM | 2 GB cap is sufficient |
| Storage | Add ~500 MB–5 GB/month of VO WAVs depending on caching strategy. At S3-standard pricing, $0.12–$0.11/mo. Rounds to $0. |
| Egress | Absorbed into existing export egress budget. No new line item. |
| API limits | Within Pexels 20k/month easily. Caching is good hygiene, not mandatory. |
| **Verdict** | **Still $0 in spend.** The only thing that costs here is developer time to wire caching and manage the queue. No 💰 gate triggered. |

### Scenario C — Hosted launch, moderate volume (~500 generations/month)

| Dimension | Assessment |
|---|---|
| Software/licensing | $0 |
| CPU | This is where the **2-CPU cap starts to matter as a latency / SLA issue, not a spend issue**. At 500 generations/month (~17/day), queue depth at peak hours could stack render + script jobs. Wall-clock TTS time (18–100 s) serializes against export jobs. Users wait longer but no money changes hands. |
| Storage | ~2.5 GB/month of VO WAVs (5 MB × 500). Managed by lifecycle policy (delete WAVs after export or after N days). S3 cost: ~$0.06/month. Negligible. |
| Egress | No change from Scenario B |
| API limits | 2,500 Pexels calls/month — 12.5% of limit. Caching recommended but not urgent. |
| **Verdict** | **Still $0 spend.** Latency degrades at peak. The **first 💰 pressure point** is not a vendor bill — it is the question "should we bump the render-worker to 4 CPUs?" That bump changes the docker-compose.yml and is free in dev; it costs money only if we are on a cloud VM (a bigger instance). |

### Scenario D — Hosted launch, growth volume (~2,000–4,000 generations/month)

This is where "free" begins to force decisions:

| Dimension | First 💰 threshold | Detail |
|---|---|---|
| **CPU / worker sizing** | **4,000 CPU-seconds of TTS added per month (Piper, typical script).** On a self-hosted VPS: worker upgrade from 2-core to 4-core is the lever. Cost depends on the hosting provider. A 4-core VPS (e.g. Hetzner CX32) runs ~$11/month vs ~$6/month for 2-core — a **$5/month delta, not a dramatic gate, but it is a real spend decision.** | The render-worker `deploy.resources.limits.cpus` in `docker-compose.yml` must be bumped; `MVP_Scope.md §8` 4× realtime export target cannot be reliably met with 2 CPUs handling concurrent TTS + render load at this volume. |
| **Pexels API rate limit** | **~4,000 generations/month hits the 20k/month ceiling** | Upgrade to Pexels Pro API (~$50/month) or accept text-card fallback for users who exceed the cache-miss budget. |
| **Storage lifecycle** | VO WAVs accumulate: 5 MB × 4,000 = ~20 GB/month if not pruned. At S3: ~$0.46/month. Not a crisis but needs a lifecycle policy. | Auto-delete WAVs after export or after 7-day download window closes — mirrors the existing export S3 lifecycle. |

**The first real 💰 gate:** a 4-core VPS upgrade when concurrent TTS + render load breaks the
export throughput SLA. Estimated threshold: **~50–80 concurrent active users or ~2,000
generations/month**, whichever comes first.

---

## 7. Recommendation

### 7.1 Build decision — is this $0 at MVP/self-host scale?

**Yes. Unconditionally.** At the CEO's machine / single self-host level, Script Studio adds
zero incremental cost to the stack. The software is free, the APIs are free, the compute is
already paid for (the machine exists), and the storage delta is sub-MB. Build it.

### 7.2 The one build-time discipline that keeps it $0 longer

**Cache Pexels API responses in Redis from day one** (keyword + params → result TTL). This is
not a cost issue at MVP but it prevents an abrupt failure mode when volume grows. The fix is
cheap to build early and expensive to retrofit after users are hitting 429 errors. This is a
Core/Forge build decision, not a CEO gate.

### 7.3 What would change the answer

The following events each trigger a 💰 gate that Atlas should queue for the CEO:

| Trigger | Spend implication | When to expect it |
|---|---|---|
| Monthly generations exceed **~2,000** | Worker sizing: ~$5/month more for a 4-core VPS | Growth phase, well past MVP |
| Monthly generations exceed **~4,000** | Pexels Pro API: ~$50/month; or accept text-card-only fallback above the limit | Scale phase |
| Kokoro (not Piper) becomes the default engine | Worker RAM rises to ~900 MB peak; Kokoro is ~3× slower on CPU — halves effective TTS throughput vs Piper; earlier concurrency pressure | Depends on quality decision |
| whisperX forced-align wired as always-on (not fallback) | ~1× realtime CPU cost on every generation — eliminates the faster-than-realtime advantage | If Forge wires it by default |
| Pexels video clips cached in S3 permanently (no lifecycle) | Storage accumulates at ~50 MB/generation with stock; needs lifecycle policy | If caching is implemented without expiry |

### 7.4 What does NOT change the answer

- **Choosing Piper vs Kokoro as the engine.** Both are $0. The difference is latency (Piper is
  faster) vs quality (Kokoro sounds better). That is a product decision, not a financial one.
- **Adding whisperX as a fallback.** Still $0 software. Adds CPU time only if triggered.
- **Text-cards vs Pexels stock as the default.** Text-cards are strictly cheaper (no API, no
  storage). Pexels is still $0 but adds rate-limit and caching complexity.
- **The number of voices or scripts tested in dev.** All inference is on our own machine.

---

## 8. Decision routing summary for Atlas

**Is Script Studio genuinely $0 to build?** Yes — software, licensing, APIs all confirmed $0.

**Is it $0 to run at current self-host/MVP scale?** Yes — single-user, local MinIO, existing
worker covers it within the 2-CPU / 2-GB cap.

**Where does "free" first force a 💰 decision?**
- **Soft threshold (~50–80 concurrent users or ~2,000 gen/month):** CPU cap creates export
  latency degradation. Fix = bump the worker to 4 CPUs. Cost = depends on hosting; on a VPS
  ~$5/month delta. No action required until this threshold.
- **Hard threshold (~4,000 gen/month with Pexels stock):** Pexels free tier exhausted. Fix =
  Pexels Pro API (~$50/month) or text-card-only fallback above the limit.

**Ledger's advisory position:** Proceed with the build under the current $0 mandate. Wire
Pexels result caching in Redis at build time (not a gate — a build discipline). Re-engage Ledger
when monthly Script Studio generations approach **2,000** to model the worker sizing decision,
or when the team evaluates Kokoro vs Piper as the default (affects how early the concurrency
threshold arrives).

No 💰 gate is triggered by building or running this feature at MVP scale. The first gate is a
compute sizing decision at growth scale, not a vendor contract today.

---

*Ledger advisory — no spend, edit, or deploy authority. All 💰 gates require Atlas → CEO approval.*
