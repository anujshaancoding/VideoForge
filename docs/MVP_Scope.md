# VideoForge — MVP Scope (Phase 0)

> Definitive, normative scope for the first shippable VideoForge. This document is the written contract: anything not marked ✅ here is out of MVP by design, not by oversight. It synthesizes an engineering-risk-first spine (the fidelity invariant is a *tested* artifact, not a slogan), a lean Free-tier-only / no-billing cut to ship fast, a thin creative layer chosen specifically to exercise the two real preview↔export parity risks, and a creator-facing vertical-first presentation. Section references (`§n`) point at `VideoForge_Spec_v1.1.md`.

---

## 1. MVP thesis & north-star metric

VideoForge's entire defensible wedge is one architectural invariant: **the export FFmpeg `filter_complex` is generated from the exact same non-destructive JSON project graph (§18) that the client WebCodecs/Canvas preview renders**, so the timeline and the export agree *by construction*. This is the trust Canva broke — trimmed-out "bad takes" reappear as ghost footage, trimming one clip scrambles the whole audio track, and 4K silently downgrades to 1080p (Market themes 1, 3, 5). The MVP is a deliberately thin, single-user editor that does the one thing Canva broke — **"what you cut is what you get"** — and proves it with an automated golden-frame + audio-RMS + perf gate from day one, before any breadth is added. Everything that does not exercise or threaten that loop (collaboration, AI captions, deep effects, mobile, most export formats, billing) is cut.

**North-star metric (engineering gate):** **Export-fidelity pass rate** — the % of golden-frame export fixtures (SSIM ≥ 0.985 / PSNR ≥ 38 dB per §22.3) plus audio-RMS/pitch checks (§22.4) that pass on every PR, across a fixture matrix of trim, split, multi-track stacking, linked-audio move, speed change, color-grade, keyframed transform, and burned-in caption. **MVP is "done" only when this gate is green in CI and a human cannot find a timeline edit the export disagrees with.**

**North-star metric (product/adoption gate):** **Time-to-first-successful-export (TTFE)** — median minutes from first media import to a downloaded MP4 whose output matches the timeline (zero ghost-footage / audio-desync defects). Target: < 10 minutes for a 60-second project; > 70% of first-session projects reach a completed export.

These are complementary: fidelity-pass-rate measures *trust*, TTFE measures the *funnel*.

---

## 2. What the MVP is / is NOT

**The MVP IS:**
- A single-user, browser-based (Chrome/Edge) multi-track video editor at the Free-tier ceilings.
- Import → multi-track rough-cut (trim/split/move/ripple with linked audio) → responsive proxy-first preview → server-side FFmpeg export to an H.264 MP4 (≤ 1080p) that matches the preview, with a CI-enforced fidelity invariant.
- A thin but *real* creative layer: per-property transform keyframes, one color-grade effect, per-clip fades + volume envelope, drawtext-subset text, manual/imported SRT/VTT captions (sidecar + burned-in), and a crossfade transition — chosen to exercise the WebGL↔FFmpeg and drawtext↔canvas parity risks before launch.
- Vertical-9:16-first by default with TikTok/Reels/YouTube export presets.

**The MVP is NOT:**
- Not collaborative (no CRDT, presence, comments, soft-locks, roles).
- Not AI-assisted (no Whisper auto-captions, no scene detection, no transcript editing, no upscaler).
- Not a billing system (Free-tier-only; plan limits hard-coded; Stripe stubbed; the only monetization hook is the mandatory Free watermark).
- Not a deep NLE (no slip/slide arbitration, no blend modes beyond Normal, no masks, no Bezier curve editor, no 10-band EQ / compressor / de-noise / reverb / ducking).
- Not multi-format export (no H.265 / VP9 / ProRes / GIF / audio-only / image-sequence; no 4K; no HDR).
- Not cross-browser (Safari/Firefox get a clear "use Chrome/Edge" gate, not a broken editor).
- Not mobile/touch-native.

---

## 3. In-scope feature set, by module

Legend: ✅ = build for MVP · ⛔ = deferred (explicit cut, listed so the boundary is unambiguous).

### 3.1 Import / Media

| Feature | In MVP? | Notes / acceptance bar | Spec ref |
|---|---|---|---|
| Drag-drop + File>Import upload | ✅ | To S3 (or local-disk double in dev) via presigned URL. | §4.2 |
| Resumable chunked multipart upload (10 MB, parallel) | ✅ | Generous ceilings honored (20 GB video / 2 GB audio / 100 MB image) — an explicit anti-Canva win. Resumable on network failure. | §4.1, §4.2 |
| MD5 dedupe folded into presign | ✅ | `presign` accepts `md5Hash`, returns `existingAssetId` on workspace hash match; client skips upload. Cheap, on the upload path. | §4.2, §14.2 |
| Async proxy transcode → base 720p H.264/AAC rendition | ✅ | This is what the preview decodes. SLA: base 720p proxy ≤ 2× realtime, measured in CI. | §4.2 |
| Quarter-res "Low" rendition | ✅ | Pressure-release valve for the auto-degrade preview mode. | §4.2, §5.3 |
| Thumbnail sprite sheet (1/sec, 160×90 WebP) | ✅ | Clip strips. CSS `background-position`, never per-frame `<img>`. | §4.2, §15.3 |
| Waveform peaks JSON | ✅ | Audio clip rendering + scrub. | §4.2 |
| `asset:ready` WebSocket → clip becomes usable | ✅ | Maps server `PROCESSING→READY` to client `uploading/ready`. | §4.2 |
| Original preserved immutable in S3 for export re-link | ✅ | Load-bearing for the "no silent 4K downgrade" guarantee. | §4.2, §10.1 |
| Common input formats (MP4/H.264, MOV/H.264, MP3/WAV/AAC, JPG/PNG) | ✅ | Single decode path. Other containers/codecs deferred. | §4.1 |
| Flat media-library grid (drag to timeline, rename/delete with in-use warning) | ✅ | Snap-to-playhead on drop. | §4.3 |
| 4K-capped proxy rendition for 4K sources | ⛔ | Phase 2 — MVP previews 720p and exports ≤ 1080p. | §4.2 |
| Exotic containers (H.265/AV1/MKV/AVI/FLV/WMV/TS, ProRes, FLAC/OGG/AIFF) | ⛔ | Phase 1/2 — each is an incremental decode/transcode arm. | §4.1 |
| HEIC decode, animated-GIF looping proxy | ⛔ | Phase 2 derivative paths. | §4.2 e/f |
| Library search / tags / filters / hover-strip / usage badges | ⛔ | Phase 1 — flat list suffices. | §4.3 |
| Stock library (Pexels/Unsplash/Pixabay) + attribution | ⛔ | Phase 1/2. | §4.3 |

### 3.2 Timeline

| Feature | In MVP? | Notes / acceptance bar | Spec ref |
|---|---|---|---|
| Multi-track timeline, shared time axis, sticky ruler, draggable playhead | ✅ | Click-to-jump + scrub on ruler. | §3.1 |
| Free-tier track ceilings (3 video / 2 audio / 2 overlay / 1 caption) | ✅ | Enforced in the editor; the export honors them. **Default new project = vertical 9:16.** | §15.2 |
| Virtual-scrolled clip rendering (±200px buffer) | ✅ | `React.memo` per clip, `key=clipId`. The performance substrate. | §3.1, §15.3 |
| Select / move (same + cross-track) | ✅ | Cross-track insert/swap. | §3.3 |
| Trim start/end, 1-frame minimum, gaps NOT auto-closed | ✅ | `trimIn`/`trimOut` from source origin. The export must honor this exactly (no ghost footage). | §3.3, §18.3 |
| Split at playhead (S) | ✅ | Creates two independent clips. **Linked audio splits simultaneously.** | §3.3 |
| Delete + ripple delete/trim | ✅ | Ctrl+Delete ripple. | §3.3 |
| Duplicate (Ctrl+D) + copy/paste | ✅ | Direct counter to Canva's removed page-duplication. | §3.3 |
| **Audio Link** (linked audio moves AND splits with its video clip) | ✅ | The anti-desync mechanism — non-negotiable. Chain icon; right-click Unlink. Dedicated edge-case tests for split/ripple/cross-track. | §3.2, §3.3 |
| Mute/solo per audio track, **respected on export** | ✅ | Muted tracks dropped from `amix`; any solo drops all non-soloed. Preview == export. | §3.2, §10.3 |
| Snapping to clip edges + playhead, Alt-to-disable | ✅ | Orange snap line. | §3.5 |
| Timeline zoom (10%–2000%, slider + Ctrl+scroll), fit-to-window | ✅ | Centered on playhead. | §3.4 |
| Speed change 0.1×–16× | ✅ | Client frame-drop preview; pitch-preserving `atempo` on export. High demand (theme 9), cheap in preview. | §3.3, §5.1 |
| Slip/Slide (S-key 4px arbitration) | ⛔ | Phase 1/2 polish. | §3.3 |
| Freeze-frame insert | ⛔ | Phase 1. | §3.3 |
| Markers / chapters / beat detection | ⛔ | Phase 1. | §3.6 |
| Blend modes beyond Normal | ⛔ | Phase 2 — Add/Subtract are explicit WebGL↔FFmpeg divergence points; out of MVP parity scope. | §3.2 |
| Mini-map, snap-to-grid | ⛔ | Phase 1. | §3.4, §3.5 |
| Voice-over recording track (MediaRecorder) | ⛔ | Phase 1 — close to MVP but off the import→export critical path. | §3.2 |

### 3.3 Playback / Preview (risk #1)

| Feature | In MVP? | Notes / acceptance bar | Spec ref |
|---|---|---|---|
| WebCodecs `VideoDecoder` → Canvas 2D composite (rAF loop) | ✅ | Draws gated against the master clock; bottom-up track stacking. | §5.1 |
| **AudioContext.currentTime master clock** | ✅ | Frames sync to the audio clock, never wall-clock. Prevents A/V drift. Non-negotiable from M2. | §5.1 |
| Reused audio nodes (created once per session) | ✅ | Never a new `AudioContext` per play — browser limits. Refs, not setState, in the RAF loop. | §5.1, §15.3 |
| Multi-track composite up to 4 video tracks (Free = 3) + per-clip opacity | ✅ | Bottom-up. | §5.1 |
| Web Audio mix: per-clip gain, per-track gain/pan, master monitor gain | ✅ | Master volume is preview-only (does not affect export). | §7.1 |
| Master-clock seek (nearest keyframe → single frame) + frame-step | ✅ | Frame-step via exact `VideoDecoder` timestamps. | §5.1 |
| Auto degraded-quality mode (switch to quarter-res Low) on frame-budget overrun | ✅ | Degrade, never silently drop frames. | §5.3, §16.2 |
| Transport: play/pause, skip start/end, frame-step arrows, click-ruler seek | ✅ | Timecode display with click-to-jump. | §5.3 |
| Vertical 9:16 canvas as the default preview frame | ✅ | Creator-first default; aspect togglable. | §2.2 |
| J/K/L shuttle (2×/4×/8×), loop work-area | ⛔ | Phase 1 polish. | §5.1 |
| OffscreenCanvas worker compositing | ⛔ | Phase 1 optimization (only if the perf gate forces it). | §5.1 |
| ffmpeg.wasm decode fallback (Safari/Firefox) | ⛔ | Phase 1 — MVP is Chrome/Edge only, with a clear gate message. | §15.1 |

### 3.4 Audio

| Feature | In MVP? | Notes / acceptance bar | Spec ref |
|---|---|---|---|
| Per-track volume (0–200%), pan, mute/solo | ✅ | Preview == export parity (`volume`→`pan`, `amix=normalize=0` + `alimiter` master limiter). | §7.1, §10.3 |
| Per-clip gain + linear fade in/out handles | ✅ | `afade` on export. Common, cheap, high perceived polish — Canva has no smooth fades. | §7.1 |
| Volume envelope keyframes (per-clip gain node) | ✅ | Exported as `volume` keyframes. Exercises the keyframe engine on the audio side. | §3.2, §7.1 |
| **Auto-ducking** | ⛔ | **DECISION made: deferred to Phase 1 fast-follow.** Highest preview↔export parity risk in the audio path (Web Audio sidechain vs FFmpeg `sidechaincompress`, differing attack/release) and not required to prove the core loop. | §7.1 |
| Voice-over recording | ⛔ | Phase 1. | §3.2 |
| 10-band EQ, compressor, RNNoise de-noise, reverb, pitch shift, voice-enhance, stereo width | ⛔ | Phase 2 full audio rack. | §7.2 |
| Per-track level meters + LUFS | ⛔ | Phase 1/2. | §7.3 |

### 3.5 Captions

| Feature | In MVP? | Notes / acceptance bar | Spec ref |
|---|---|---|---|
| Import .srt/.vtt onto the single caption track | ✅ | Drag-to-track or File>Import Captions. | §9.2, §4.1 |
| Hand-authored / edited caption blocks (start \| end \| text table) | ✅ | Inline table edit in caption editor panel. This is the Phase 0 manual-caption scope exactly. | §9.2, §3.2 |
| One readable default caption style (font/size/color/outline/bottom-third) sized for 9:16 | ✅ | Maps cleanly to `subtitles` filter. | §3.2 |
| Burned-in caption export (subtitles filter) | ✅ | Parity verified by golden-frame test — exercises caption render parity. | §10.3, §22.3 |
| Downloadable sidecar .SRT/.VTT export | ✅ | Near-zero-cost, concrete Canva gap (theme 8). | §10.1 Advanced |
| **AI auto-caption (Whisper, word-level timestamps, accuracy tiers)** | ⛔ | **Phase 2, per §23.3.** Whisper is a whole GPU/CPU inference tier + word-level streaming + caption-editor depth; explicitly NOT Phase 0. | §9.1 |
| AI translate track, karaoke highlight, find&replace, merge/split, per-block style | ⛔ | Phase 2. | §9.2, §9.3 |

### 3.6 Text / Overlays

| Feature | In MVP? | Notes / acceptance bar | Spec ref |
|---|---|---|---|
| Text Block: solid color + outside stroke + hard-offset shadow | ✅ | Kept to the **`drawtext`-reproducible subset** (no server rasterization) to preserve parity. Maps to `drawtext` `borderw`/`bordercolor` + `shadowcolor`/`shadowx`/`shadowy` (no blur). | §8.1, §10.3 |
| Percentage-positioned overlay on canvas, bi-directional timeline↔canvas selection | ✅ | `canvasX%`/`Y%`/`width%`/`height%`. | §3.2, §18.3 |
| Font family + size (logical px, scaled on render) | ✅ | | §8.1 |
| Image overlays (logo/lower-third PNG via `overlay`) | ⛔ | Phase 2 nice-to-have (cheap, but off critical path). | §8.3 |
| Gradient / inside-stroke / blur-shadow text (server RGBA-PNG pre-render) | ⛔ | Phase 2 — needs the server rasterization stage; parity-risky. | §10.3 |
| Shapes (drawbox/overlay) | ⛔ | Phase 2. | §8.3 |
| Lottie / SVG / animated stickers (server rasterization) | ⛔ | Phase 2 — heavy render-worker stage. | §8.3, §10.3 |
| Text entry/exit animation presets | ⛔ | Phase 2. | §8.2 |

### 3.7 Effects / Transitions

| Feature | In MVP? | Notes / acceptance bar | Spec ref |
|---|---|---|---|
| One parameter-slider color grade (brightness/contrast/saturation) via offscreen WebGL → composited into 2D | ✅ | **Chosen to prove the WebGL-preview vs FFmpeg-export parity risk on the simplest effect.** FFmpeg `eq` parity verified by golden-frame test (effects/composite class: SSIM ≥ 0.990 / PSNR ≥ 40 dB). | §6.1, §5.1, §10.3, §22.3 |
| Per-property keyframes: opacity, position X/Y, scale, rotation | ✅ | Linear / Ease interpolation only. **The keyframe engine is shared infrastructure** (audio envelope + Ken Burns + transforms all ride it), so it must exist early. Answers Canva's "single biggest limitation" (theme 4). | §6.5 |
| Ken Burns / pan-zoom (zoompan) | ✅ | Implemented as transform keyframes (start/end scale+position). Staple short-form motion; near-free given the keyframe engine. | §6.3 |
| Crossfade / Dissolve transition (xfade) | ✅ | The single transition shorts actually use, beyond hard cut. Transition is a top-level object (`fromClipId`/`toClipId`). Golden-frame parity. | §6.4, §18.3 |
| Full color grade (hue/sharpness/blur/shadows/highlights/temp/tint/vignette/LUT) | ⛔ | Phase 2 — each is another FFmpeg filter parity surface. | §6.1 |
| Preset filter library | ⛔ | Phase 2. | §6.2 |
| Bezier interpolation + curve editor | ⛔ | Phase 2 — Linear/Ease covers MVP. | §6.5 |
| 12+ transitions (Wipe/Slide/Glitch/Film Burn/Whip Pan…) | ⛔ | Phase 2. | §6.4 |
| Masks / clipping, chroma key, vignette | ⛔ | Phase 2. | §6.6 |

### 3.8 Export (risk #2)

| Feature | In MVP? | Notes / acceptance bar | Spec ref |
|---|---|---|---|
| **FFmpeg `filter_complex` generated DIRECTLY from the same project JSON the timeline renders** | ✅ | Built FIRST as a headless, unit-testable module (M0). The whole bet. | §10.3 |
| Per-clip `-ss`/`-to` trim inputs | ✅ | Accurate seek; export honors gaps. | §10.3 |
| Bottom-up `overlay` composite of video tracks | ✅ | Matches preview stacking. | §10.3 |
| Per-track audio chain (`volume`→`pan`) → `amix=inputs=N:normalize=0` + `alimiter` | ✅ | `normalize=0` so export loudness == preview mix. Master limiter prevents clipping. | §10.3 |
| Mute/solo gating of `amix` inputs | ✅ | Matches preview exactly. | §10.3 |
| **Proxy→source re-link at render time (ON by default)** + pre-export proxy-downgrade warning | ✅ | Original fetched when present/readable so true resolution renders; warn (never silently use proxy). Test asserts source — not proxy — is fetched when present. | §10.2 |
| MP4 / H.264 output, Auto CRF (x264 CRF 18) | ✅ | One great format. | §10.1 |
| Resolution ≤ 1080p (Free cap), frontend clamp (no above-cap job) | ✅ | Source on over-cap canvas resolves to 1080p, downscaled. | §10.1, §15.2 |
| 9:16 social presets (TikTok/Reels, IG) + YouTube 1080p | ✅ | One-click resolution+aspect choices; cheap, high-conversion. | §10.1 |
| Burned-in caption path (`subtitles`) + sidecar .SRT/.VTT | ✅ | Proves caption render parity. | §10.3, §10.1 |
| Mandatory Free-tier branding watermark (final overlay) | ✅ | The only monetization hook + abuse deterrent. Bottom-right, ~10% width, 70% opacity. | §10.2 |
| BullMQ render queue → FFmpeg worker → S3 output lifecycle | ✅ | Status QUEUED→COMPLETE. | §10.2 |
| Progress over WebSocket; 7-day download (1h re-minted signed URLs) | ✅ | | §10.2, §15.3 |
| Pre-flight estimated file size + render time | ✅ | Trust-building; surfaced in the export modal. | §10.2 |
| Speed-change `atempo` audio + `minterpolate` optical-flow toggle | ✅ (atempo) / ⛔ (minterpolate) | Pitch-preserving atempo is required for the speed feature; optical-flow interpolation is Phase 2. | §10.1 |
| H.265 / VP9 / ProRes / GIF / MP3 / WAV / image-sequence | ⛔ | Phase 1/2 — each new codec multiplies the golden-frame matrix; add only after H.264 fidelity is proven. | §10.1 |
| 4K export, HDR/Rec.2020, deinterlace, export denoise | ⛔ | Phase 2/3. | §10.1 |
| Work-area / custom-range export | ⛔ | Phase 1. | §10.1 |
| Batch / re-export queue UI, chapters/attribution metadata, direct social publish | ⛔ | Phase 1/2. | §10.4 |

### 3.9 Project / Persistence

| Feature | In MVP? | Notes / acceptance bar | Spec ref |
|---|---|---|---|
| Canonical project JSON document (single source of truth) | ✅ | Integer-ms time, percentage geometry, UUIDv4 ids, array-index ordering, transitions-as-objects, persisted audio mix fields. | §18.1, §18.3 |
| JSON Schema (draft 2020-12) validation on every save AND in CI | ✅ | A malformed graph never reaches preview or export. Locked before any UI is built. | §18.4 |
| `schemaVersion` field present from day one | ✅ | For future server-side migration. | §18.3 |
| POST/GET/PATCH `/api/v1/projects` with full-document save model | ✅ | Server-owned monotonic `revision` (fast path only — no merge UI). | §18.3, §11.2 |
| Debounced auto-save (3s) + Ctrl+S manual save | ✅ | Single-user. | §11.2 |
| Undo/redo (Immer patches, 200-op stack, single-user) | ✅ | On all edit ops. | §11.3 |
| Project dashboard (list/open/create/duplicate) | ✅ | | §11.1 |
| Offline IndexedDB write buffer with `baseRevision` | ⛔ | Phase 1 (single-user reconnect, no merge UI). | §11.2 |
| Auto-versions every 30 min + named versions + restore-to-branch | ⛔ | Phase 1 — strong anti-data-loss trust story (theme 6) but off the first-export critical path. | §11.4 |

### 3.10 Auth / Account

| Feature | In MVP? | Notes / acceptance bar | Spec ref |
|---|---|---|---|
| JWT access (15 min) + rotating refresh (httpOnly cookie) | ✅ | | §17.1 |
| Email/password signup + login | ✅ | | §17.1 |
| Google OAuth2 sign-in | ✅ | Lowest-friction for creators. | §17.1 |
| Single implicit Free-tier workspace per user; row-level `workspaceId` isolation | ✅ | No plan selection, no collaborators, no roles. | §17.3 |
| **Free-tier limits hard-coded** (3v/2a/2ov/1cap tracks, 10-min duration, 1080p cap, watermark) | ✅ | Export depends on these. No entitlements service — limits are constants the editor + export read. | §15.2 |
| Per-user export rate limit (5/min) + abuse-deterrent watermark | ✅ | Free tier with server FFmpeg invites abuse; basic Redis sliding-window. | §17.4, §10.2 |
| Password reset / email verification | ✅ (reset) / ⛔ (verification) | Reset is table-stakes; verification can be Phase 1. | §17.1 |
| GitHub OAuth | ⛔ | Phase 1. | §17.1 |
| **Stripe billing, plan tiers, entitlements service, Pro upgrade** | ⛔ | **Phase 1.** Free-tier-only removes the entire §21 surface — the single biggest schedule win. | §21 |
| SSO/SAML, MFA, audit logs | ⛔ | Phase 3 Enterprise. | §17.1 |

### 3.11 UI Shell

| Feature | In MVP? | Notes / acceptance bar | Spec ref |
|---|---|---|---|
| Three-zone editor layout (left media panel, center 9:16 canvas + transport, bottom timeline, right properties/caption panel) | ✅ | | §2.1 |
| Fixed-ratio canvas with aspect-ratio / resolution project settings | ✅ | 9:16 default; 16:9 / 1:1 togglable. | §2.2, §11.5 |
| Bi-directional canvas↔timeline selection binding for overlays | ✅ | | §2.2, §3.2 |
| Export modal (Format & Quality essentials + Captions tab) with pre-flight estimate | ✅ | Collapsed to the few controls that matter (MP4, ≤1080p, presets, captions). | §10.1, §10.2 |
| Core keyboard shortcuts (Space, S split, Del, Ctrl+D, Ctrl+Z/Y, Ctrl+S, frame-step arrows) | ✅ | | §13 |
| Empty-state onboarding funnel → import→export | ✅ | Drives TTFE. | §2.1 |
| Upload/processing/export progress (toast + notification bell) | ✅ | | §2.1, §10.2 |
| Chrome/Edge-only browser gate message | ✅ | Detect + warn on Safari/Firefox; do not render a broken editor. | §15.1 |
| History panel, Markers panel, full shortcut map, queue tab | ⛔ | Phase 1. | §13, §3.6 |
| Responsive / touch timeline | ⛔ | Phase 4 (mobile). | §15.1 |

---

## 4. Explicitly deferred to later phases

| Feature | Deferred to | Why cut from MVP |
|---|---|---|
| Real-time collaboration: CRDT/LWW sync, presence/cursors, soft-locks, comments, @mentions, approval workflow | Phase 1 | Single-user fast-path save/undo proves the core loop; collaboration rides on a stable spine and adds a large sync subsystem (§12, §17.2). |
| Project roles & capability matrix (Admin/Editor/Commenter/Viewer) | Phase 1 | No collaborators in MVP. |
| Offline IndexedDB edit cache + reconnect rebase | Phase 1 | Resilience, not on the critical path to a first export. |
| Versioning: auto-versions, named versions, restore-to-branch | Phase 1 | Strong trust story (theme 6) but does not change whether export == timeline. |
| Voice-over recording, freeze-frame, slip/slide, markers/chapters, beat detection, mini-map, blend modes | Phase 1 | Timeline polish; none alters the fidelity invariant. |
| Auto-ducking (sidechain preview / `sidechaincompress` export) | Phase 1 (fast-follow) | Highest preview↔export parity risk in audio; not required to prove the loop. Ship gain/pan/fade/envelope first. |
| Stock media library (Pexels/Unsplash/Pixabay) + attribution | Phase 1/2 | Adoption nicety; off critical path. |
| Stripe billing, plan matrix, entitlements service, metered usage, dunning, proration, tax | Phase 1 | Free-tier-only deletes the entire §21 surface — largest off-path body of work. |
| Additional input containers/codecs (H.265/AV1/MKV/AVI/FLV/WMV/TS, ProRes, FLAC/OGG/AIFF), HEIC, animated-GIF, 4K proxy | Phase 1/2 | Keep one decode path until fidelity is proven; each is an incremental arm. |
| Export breadth: H.265, VP9/WEBM, ProRes/MOV, GIF, MP3/WAV, image-sequence, 4K, HDR/Rec.2020, deinterlace, export denoise, optical-flow interpolation, work-area range, social publish, batch/re-export UI | Phase 1/2 | Each new codec multiplies the golden-frame matrix with no parity payoff; add once H.264 fidelity loop is proven. |
| AI auto-caption generation (Whisper/Faster-Whisper, word-level timestamps, accuracy tiers) | Phase 2 | A whole GPU/CPU inference tier + word-level streaming; explicitly Phase 2 per §23.3. MVP ships manual/imported captions only. |
| AI translate track, karaoke highlight, find&replace, merge/split, per-block caption style | Phase 2 | Caption-editor depth rides on Phase 2 AI work. |
| Scene detection for AI-assisted auto-edit | Phase 2 | Off critical path (§4.2 d). |
| Deep effects: full color grade + LUT, preset filters, 12+ transitions, masks, chroma key, vignette, Bezier curve editor | Phase 2 | MVP keeps one color-grade + transform keyframes + Ken Burns + crossfade to prove parity; breadth rides on the proven spine. |
| Full audio rack: 10-band EQ, compressor, RNNoise de-noise, reverb (afir), pitch shift, voice-enhance, stereo width, meters/LUFS | Phase 2 | Heavy; not required to prove the loop. |
| Lottie/SVG/sticker overlays + server-side rasterization; gradient/blur-shadow text | Phase 2 | Heavy, parity-risky render-worker stage. MVP keeps drawtext-reproducible text only. |
| Enterprise: SSO/SAML, MFA, dedicated render pool, audit logs, org roles, Business/Enterprise tiers | Phase 3 | Org-grade identity & governance; depends on collaboration + billing. |
| ffmpeg.wasm decode fallback (Safari/Firefox) | Phase 1 | MVP targets Chrome/Edge (WebCodecs) only to keep one decode path. |
| Dedicated mobile/tablet touch-native editor, phone-portrait layout, mobile capture→edit | Phase 4 | Highest-value NEW bet, but unspecced and depends on a proven core (§23.4). |
| 8K export, 5.1 surround | Not planned | Already out of scope per §23.1 / v1.1 corrections. |

---

## 5. MVP data model subset (§18)

The MVP needs the **full structural spine of §18** (the invariants are load-bearing for both preview and export and are expensive to change after clips exist) but only a **subset of the track/clip/effect fields**.

**Build now (full):**
- `Project`: `schemaVersion`, `revision`, `id`, `title`, `canvas`, `tracks[]`, `captionTracks[]`, `transitions[]`, `ownerId`, `workspaceId`, `createdAt`, `updatedAt`. Keep `markers[]`/`exportPresets[]` as empty arrays (schema-present, unused).
- `CanvasConfig`: `width`, `height`, `frameRate`, `aspectRatio`, `backgroundColor`. Default new project = 1080×1920 (9:16).
- **Invariants (locked in code + JSON Schema before any UI):** integer-ms time everywhere (`startOnTimeline`/`endOnTimeline`/`trimIn`/`trimOut`/`durationMs`/keyframe `timeMs`); `trimIn`/`trimOut` measured from **source asset origin**; percentage canvas geometry (`canvasX`/`canvasY`/`width`/`height` ∈ 0–100); UUIDv4 ids (validated by pattern); array index = z-order / mix order (no `zIndex` field); transitions are top-level objects referencing `fromClipId`/`toClipId`; persisted audio mix fields (`volume`/`pan`/`volumeEnvelope`/`muted`/`solo`) honored on export.
- Track types: **`VideoTrack`, `AudioTrack`, `CaptionTrack`, `OverlayTrack`** — one of each is enough for the wedge. Clip base fields: `id`, `assetId`, `startOnTimeline`, `endOnTimeline`, `trimIn`, `trimOut`, `speed`, `opacity`, plus `keyframes{}` for opacity/position/scale/rotation and `colorGrade{brightness,contrast,saturation}`.
- `Transition`: `fromClipId`, `toClipId`, `trackId`, `type` (crossfade only in MVP), `durationMs`, `params`.
- `CaptionBlock`: `startMs`, `endMs`, `text`. (`words[]` optional, unpopulated in MVP — no Whisper.)

**Defer (schema-present-but-unused or omitted until later phase):**
- `VoiceOverTrack` — Phase 1 (recording).
- `collaborators[]`, project roles, `isPublic`, `templateId` — Phase 1 (collaboration). Seed `collaborators: []`.
- `markers[]` populated content — Phase 1.
- Blend-mode fields, mask objects, Bezier interpolation type, preset-filter ids, full color-grade fields, per-block caption style overrides, `source` (stock attribution) object — Phase 2.
- Anything driving billing/entitlements — Phase 1 (lives outside the project document anyway).

**Concurrency note:** MVP uses the **fast path only** — `revision` for stale-base detection, full-document `PATCH`, single-user last-write-wins. No Immer-patch WebSocket streaming, no 409 rebase/merge prompt (those are Phase 1 collaboration).

---

## 6. MVP tech stack

| Layer | Choice | MVP notes / what's stubbed |
|---|---|---|
| Frontend | React + TypeScript (Vite) | Chrome/Edge only; browser-gate Safari/Firefox. |
| State | Zustand + **Immer** | Immer patches power undo/redo (200-op) and the full-document save. |
| Preview compositor | **WebCodecs `VideoDecoder` → Canvas 2D** (main visible canvas) | Bottom-up composite; gated to the audio master clock. OffscreenCanvas worker NOT in MVP (add only if perf gate forces it). |
| Effects pass | Offscreen **WebGL** for the one color-grade, transferred into 2D via `drawImage`/`transferToImageBitmap` | Single effect to prove WebGL↔FFmpeg parity. |
| Audio | **Web Audio API** — single reused `AudioContext`, per-clip gain, per-track gain/`StereoPannerNode`/master `GainNode` | `AudioContext.currentTime` is the master clock. |
| Backend | Node + TypeScript (Express/Fastify) | REST `/api/v1/*` + WebSocket for `asset:ready` and export progress. |
| Queue | **BullMQ** on Redis | One "render" queue + proxy/thumbnail/waveform jobs. No long-job split / autoscale in MVP. |
| Storage | **S3** (originals immutable + proxies + exports) | Dev/CI: **local-disk S3 double** (e.g. MinIO) seeded from `fixtures/manifest.json`. |
| FFmpeg worker | Containerized FFmpeg worker, **pinned build** (version + flags in fixture lockfile) | Single worker pool sized to the 4× realtime target; **no k8s autoscaling, no per-job container isolation** in MVP. `-threads 0` on ≥4 vCPU. |
| Proxy transcode | FFmpeg → 720p H.264/AAC base + quarter-res Low | SLA: base ≤ 2× realtime, gated in CI. |
| DB | **PostgreSQL** — project as `JSONB`, assets/users/exports as rows | Row-level `workspaceId` isolation. Plan limits are hard-coded constants, NOT an entitlements table. |
| Auth | JWT + refresh (httpOnly), Google OAuth2 | **Stripe stubbed** — single Free plan, billing endpoints mocked. |
| Schema validation | JSON Schema draft 2020-12 (Ajv) | Runs on every save and in CI; malformed graph never reaches preview/export. |
| Test harness | Vitest (unit/integration), Playwright (e2e), **golden-frame SSIM/PSNR via FFmpeg `ssim`/`psnr`**, `OfflineAudioContext` RMS, perf gates | Fixtures CC0 under `fixtures/media/` (Git LFS); goldens keyed by fixture MD5 + pinned encoder. |
| Observability | Minimal: Sentry error tracking + TTFE/fidelity funnel events | Full RUM / tracing / SLO alerting deferred (§20). |

---

## 7. Build milestones M0–M4

> Sequencing rule: the FFmpeg command builder and the fidelity test harness come **first** (the spec leaves export last; we pull it to M0), and the riskiest unknowns are de-risked with throwaway spikes before any UI is committed.

### M0 — Risk spikes + spine skeleton + the fidelity gate
- **Goal:** Prove the two genuine unknowns and stand up the tested invariant before building product surface.
- **Deliverable:**
  1. Throwaway spike: WebCodecs decode + Canvas 2D composite of 2–4 pre-made 720p proxies synced to an `AudioContext` clock; measure FPS/seek vs §5.2.
  2. Headless, unit-testable FFmpeg `filter_complex` builder reading a hand-written project JSON.
  3. §18 JSON Schema + invariant tests; Ajv validation wired into CI.
  4. Golden-frame SSIM/PSNR harness (§22.3) + `OfflineAudioContext` RMS harness (§22.4) + CC0 fixture media (§22.6), wired as a CI merge gate (§22.7 stages 3/5).
- **Demoable acceptance check:** A trimmed + split fixture project, hand-authored as JSON, exports through the real command builder and **matches its committed golden frames (SSIM ≥ 0.985 / PSNR ≥ 38 dB) and golden audio buffer**; the 4-track preview spike hits the §5.2 targets on mid-tier hardware. Either spike failing here changes the plan *before* product investment.

### M1 — Data model + auth + import pipeline
- **Goal:** A logged-in user can upload media and see it become a usable, proxy-backed asset.
- **Deliverable:** §18 schema in code with validation; projects API (POST/GET/PATCH + `revision`); JWT + Google auth + single Free workspace + hard-coded plan limits; resumable chunked upload → BullMQ → 720p+Low proxy + thumbnail sprite + waveform → `asset:ready`; originals immutable; flat media library; project dashboard.
- **Demoable acceptance check:** Drop `bunny_h264_3s.mp4` → asset goes UPLOADING→READY within SLA, base 720p proxy exists, re-importing the same file creates no duplicate (MD5 dedupe), and the project round-trips through save/auto-save/undo.

### M2 — Interactive preview + timeline core
- **Goal:** Arrange and trim a multi-clip sequence and play it back in A/V sync, responsively.
- **Deliverable:** Real WebCodecs preview engine (master clock, reused audio nodes, seek, frame-step, auto-degrade); multi-track timeline (9:16 default, ruler, playhead, virtual scroll, select/move/trim/split/delete/ripple/duplicate, **Audio Link**, mute/solo, snapping, zoom, speed); transport. **Wire the §22.5 playback perf gate into CI.** Stand up the golden-frame harness against live preview frames here too.
- **Demoable acceptance check:** Trim a clip with embedded audio → its linked audio splits/moves with it (no desync); preview holds 60fps single 1080p track / 30fps 4 tracks / <100ms seek; mute/solo audibly changes the mix; the playback gate is green.

### M3 — Export pipeline productionized + the invariant fully enforced
- **Goal:** "What you cut is what you get" — a downloadable MP4 that matches the timeline.
- **Deliverable:** BullMQ render queue → FFmpeg worker → S3; command generated from the **live** project JSON; per-clip trim, bottom-up composite, per-track `amix=normalize=0` + `alimiter`, mute/solo gating, proxy→source re-link + pre-export downgrade warning, ≤1080p clamp, MP4/H.264 Auto-CRF, 9:16 social presets, Free watermark, progress over WebSocket, 7-day download, pre-flight estimate. **Wire the §22.5 export gate + audio-pitch test.** The fidelity north-star gate is now fully enforced end-to-end.
- **Demoable acceptance check:** Export a multi-track project; the downloaded MP4 has zero ghost footage, the audio mix matches the preview (RMS within tolerance, pitch preserved), the original (not proxy) source was fetched, and the full golden-frame fixture matrix is green in CI.

### M4 — Thin creative layer (exercises parity) + hardening + launch
- **Goal:** Add the smallest creative surface that proves the two parity risks and lands the creator demo, then ship.
- **Deliverable:** Per-property transform keyframes (opacity/position/scale/rotation, Linear/Ease); one WebGL color-grade with FFmpeg `eq` parity; Ken Burns; crossfade transition; per-clip fades + volume envelope; drawtext-subset text overlay; manual/imported captions with burned-in + sidecar .SRT/.VTT export; empty-state onboarding funnel; Chrome/Edge gate; export rate limiting; error states (upload/playback/export §16). Each addition must keep both gates green.
- **Demoable acceptance check:** A creator goes import → 9:16 rough-cut → keyframed Ken Burns + color grade + fades + captions → exported MP4 in **< 10 minutes**, output matches the timeline, and the expanded golden-frame matrix (trim, split, stacking, linked-audio move, speed, color-grade, transform-keyframe, crossfade, burned-in caption) is green.

---

## 8. MVP performance & fidelity targets

MVP commits to the subset of §5.2 / §10.2 targets that the wedge depends on, enforced as CI gates (§22.5):

| Target | Commitment | Source |
|---|---|---|
| Preview — 1080p source, single video track | ≥ 60 fps, < 50 ms seek | §5.2 |
| Preview — 1080p source, up to 4 video tracks | ≥ 30 fps, < 100 ms seek | §5.2 |
| Preview — degraded mode auto-activates under frame-budget pressure | Must trigger (no silent frame drops) | §5.2, §16.2 |
| Audio | No A/V drift over long playback (master-clock gated); no per-scene audio restart | §5.1, §22.4 |
| Export — fidelity | Golden-frame SSIM ≥ 0.985 / PSNR ≥ 38 dB (lossy H.264); ≥ 0.990 / ≥ 40 dB (effect/composite frames); audio RMS error ≤ −60 dBFS vs golden; pitch preserved on speed change | §22.3, §22.4 |
| Export — throughput | 1080p/30fps renders at ≥ 4× realtime; relative to committed baseline on pinned worker | §10.2, §22.5 |
| Proxy SLA | Base 720p proxy ready ≤ 2× realtime of source duration | §4.2 |
| Merge gate | CI stages 1–6 green (incl. golden-frame + perf gates) on every PR | §22.7 |

Out of MVP commitment (deferred with their features): 4K-source preview row, complex 10+ track row, VP9/HDR golden classes, lossless/ProRes golden class.

---

## 9. Success criteria & explicit non-goals for Phase 0

**Phase 0 is "done" when:**
1. The export-fidelity gate (golden-frame + audio-RMS/pitch) is green in CI across the full fixture matrix, and a human cannot find a timeline edit the export disagrees with.
2. The playback and export perf gates are green on pinned workers.
3. A single user can go from file-import to a downloaded, watermark-correct MP4 in one Chrome/Edge session, with median TTFE < 10 min for a 60s captioned project and > 70% first-session export completion.
4. Audio Link, master-clock sync, mute/solo-on-export, and proxy→source re-link all pass dedicated edge-case tests (split/ripple/cross-track; long-playback drift; source-not-proxy fetch).
5. Free-tier limits are enforced and the export honors them; the Free watermark is injected.

**Explicit non-goals for Phase 0:** any collaboration; any AI (captions, scene detection, transcript editing); any billing/Stripe/entitlements service; any export format other than MP4/H.264 ≤1080p; 4K/HDR; blend modes, masks, Bezier curves, deep effects, full audio rack, auto-ducking; Lottie/SVG/server-rasterized text; voice-over recording; versioning/restore-to-branch; mobile/touch; Safari/Firefox support.

---

## 10. Top risks & mitigations

| Risk | Mitigation |
|---|---|
| **Export fidelity is the whole bet and the hardest to verify** — WebGL-preview color vs FFmpeg `eq`, drawtext-vs-canvas text, audio `amix` normalization are explicit divergence points. | Build the FFmpeg command builder FIRST as a headless unit (M0); stand up the golden-frame SSIM/PSNR + audio-RMS suite at M0; restrict MVP effects/text to the single-filter / drawtext-reproducible subset so parity is achievable before breadth. |
| **WebCodecs 4-track preview may miss §5.2 targets on mid-tier hardware** once 4 tracks + audio mixing + an effect run together. | Throwaway 4-track + master-clock spike in M0; wire the §22.5 playback gate at M2; quarter-res Low / auto-degrade is the pressure-release valve. |
| **A/V drift over long playback** if frames are wall-clock-timed or a new `AudioContext` is created per play. | Master-clock-gated draws + once-per-session reused audio nodes are non-negotiable from M2; `OfflineAudioContext` mix-correctness + long-playback drift tests. |
| **Wrong §18 invariant** (unit/ordering) produces Canva-style ghost footage / drift and invalidates saved projects later. | Lock §18 schema + invariants in code with JSON-Schema validation on every save and in CI **before any UI is built** (M0/M1). |
| **Silent 4K downgrade** if a missing/unreadable original is replaced by the proxy without warning. | Pre-export proxy-downgrade warning + a test asserting source (not proxy) is fetched when present (M3). |
| **WebCodecs is Chrome/Edge-only** — Safari/Firefox users get no preview until the wasm fallback lands. | Scope MVP to Chrome/Edge explicitly; gate other browsers with a clear message, not a broken editor. |
| **Render-worker cost/throughput** — server FFmpeg at 4× realtime + Free-tier server export invites abuse and starvation. | Size the worker pool to the 4× target; per-user export rate limit (5/min) + mandatory Free watermark as deterrent; long-job queue split is Phase 1. |
| **Scope creep back toward the full spec** — every cut module has a plausible "Canva-killer needs it" argument. | The north-star gates are the contract: a feature ships only if it keeps both gates green; §23 phase boundaries + the deferred table above are the written boundary. |

> **DECISION NEEDED:** Confirm the MVP launch persona/default. This document assumes **vertical-9:16-first** with social presets (creator wedge). If the primary launch target is horizontal/long-form (YouTube creators), the canvas default and preset emphasis flip — a one-line config change, but it sets the demo narrative.

> **DECISION NEEDED:** Confirm Free-tier-only at launch (Stripe fully stubbed) vs. shipping a single hard-coded Pro upgrade path (4K + watermark removal) behind a stubbed checkout. This scope assumes Free-only; adding a single Pro toggle is small but pulls a thin slice of §21 forward.
