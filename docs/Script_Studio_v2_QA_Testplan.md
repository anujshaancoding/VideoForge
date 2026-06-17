# Script Studio v2 — QA Test Plan ("auto video from a script")

How to validate the feature end-to-end. Owner: Sentinel (QA), runnable by the CEO.
**Golden rule for this product:** the exported MP4 must match the editor preview frame-for-frame and
beat-for-beat (the "what you cut is what you get" invariant). Every test ends by checking that.

---

## 0. Pre-flight (get the stack up)

```bash
cd VideoForge
pnpm services:up          # Postgres + Redis + MinIO (Docker)
pnpm --filter @videoforge/api migrate     # applies script_manifests (migration 0002)
pnpm dev                  # web (5173) + api (4000)
# start the render-worker too (docker compose / the worker process) for TTS + export
```
**Ready when:** http://localhost:5173 loads in **Chrome/Edge**, you can log in
(`ceo@zentrix.test` / `Zentrix2026!`), and `curl localhost:4000/health` is OK.
First **Generate** downloads the kokoro voice model once (~tens of MB) — expect a one-time delay.
`ffprobe` must be on `FFPROBE_PATH` for exact audio timing.

---

## 1. Sample script (paste this into the textarea)

```
Most people never start because editing looks hard.

VideoForge fixes that. Paste a script and it plans every scene for you.

It even tells you which shot to film or photograph.

Record your voice automatically. Add big captions that pop.

Then drop in your own clips. We place them and match the timing to your words.

Export, and what you saw is exactly what you get.
```
Expect **~6 scenes**.

---

## 2. Happy-path test (the main flow)

| # | Step | Do this | ✅ Pass criteria |
|---|---|---|---|
| 2.1 | **Enter** | Dashboard → **"Start from a script"** | Lands on `/script` paste screen; voice picker shows 4 voices |
| 2.2 | **Plan** | Paste the script, pick a voice, click Plan | Returns ~6 scenes in a few seconds. **No "Draft plan" badge** (means Groq answered, not the fallback). Each scene shows: voiceover line, **the shot it needs** (photo/video + keywords + description), a small caption, and big-caption words |
| 2.3 | **Edit plan** | Change one scene's voiceover text; toggle **background music ON** | Edits persist in the review list; music toggle stays on |
| 2.4 | **Generate** | Click Generate | Progress shows, then it **opens in the editor**. A real project exists (refresh-safe) |
| 2.5 | **Inspect timeline** | Look at the tracks | A **voiceover** track with audio per scene; a **small caption** (lower third) + a **big full-screen caption** that advances word-by-word; a **music** track; **b-roll/video track empty** (no footage yet) |
| 2.6 | **Play preview** | Hit play | You **hear the synthesized voice**; captions appear in sync; **music plays quietly under the voice and swells at the very start/end** (the dynamic duck) |
| 2.7 | **Auto-arrange** | Click **"Auto-arrange footage"**, upload 3–5 of your own images/videos | They upload (progress), then **auto-place onto the b-roll track**, one per scene, **trimmed/looped to fit each scene's voice window** |
| 2.8 | **Verify timing** | Scrub the timeline | Each clip's on-screen time lines up with the matching spoken line (visuals follow the voice) |
| 2.9 | **Export** | Export modal → 9:16 → Export | Render completes; download the MP4 |
| 2.10 | **THE INVARIANT** | Watch the exported MP4 vs the preview | **Same captions, same voice, same clip cuts/timing, same music level/dip.** No ghost footage, no desync. If anything differs → that's the bug that matters most — report it |

---

## 3. Edge / negative cases (where it tends to break)

| Test | How | Expected |
|---|---|---|
| **No-key fallback** | Temporarily blank `GROQ_API_KEY` in `.env`, restart api, run Plan | Still returns a plan, now labeled **"Draft plan"** (heuristic). Never errors |
| **Groq vs heuristic A/B** | Run the same script with key on, then off | Both produce a valid plan; Groq's scene splits/keywords should read smarter |
| **Tiny script** | Paste one sentence | 1 scene; generate + export still works |
| **Big script** | Paste ~30+ sentences | Capped at 40 scenes; long ones run as a queued job with progress (not a hang) |
| **No footage** | Generate, then export **without** auto-arranging | Exports with text cards over the canvas background (no broken/black frames) |
| **Fewer assets than scenes** | Upload 2 assets for 6 scenes | Round-robin reuse; no scene left with a broken clip |
| **More assets than scenes** | Upload 10 for 6 scenes | Extra assets ignored gracefully (or cycled), no crash |
| **Music off** | Toggle music off at generate | No music track; voice + captions only; no silent/ghost audio track |
| **Wrong browser** | Open in Safari/Firefox | Clean "use Chrome/Edge" gate, not a broken editor |

---

## 4. Fidelity spot-checks (the trust layer)

- **Audio sync over length:** play the full preview to the end — voice and captions must not drift.
- **Duck behavior:** confirm music is **full at the intro/outro** and **dips under every spoken section**
  (this is the dynamic-but-parity-safe duck). It should sound the same in the exported file.
- **Caption parity:** the big word-by-word caption and the small caption must look the same in the
  export as in the preview (font, position, timing).
- **Determinism:** generate the same script + voice twice → the built timeline structure should match.

---

## 5. Automated checks already green (re-run anytime)

```bash
pnpm typecheck                                   # whole monorepo
pnpm --filter @videoforge/script-studio test     # 68 — plan, assemble, placement, duck, arrange
pnpm --filter @videoforge/api test               # planner fallback + route contracts (2 pre-existing reds unrelated)
pnpm --filter @videoforge/web test               # Script Studio route render
```

---

## 6. What to report back (per bug)

`Step # → what you did → what you expected → what happened` + whether the **export matched the preview**.
Flag anything where export ≠ preview as **P0** (it breaks our core promise); everything else is polish.
