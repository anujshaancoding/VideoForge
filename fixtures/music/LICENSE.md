# Bundled music beds — CC0 1.0 Universal (Public Domain Dedication)

These short loopable music beds ship with VideoForge as the Script Studio v2
optional background-music set. They are **CC0 1.0 Universal** — public domain, **no
attribution required**.

## Provenance

The intended source was **FreePD** (confirmed CC0 1.0, no attribution). As of
2026-06 **FreePD.com is permanently closed** and serves no downloadable files, so a
runtime/build fetch from it is impossible. To preserve a $0, no-runtime-fetch, CC0
bundled set, these beds are **synthesized by Zentrix Studio** for VideoForge and
**dedicated to the public domain under CC0 1.0**. No third-party rights attach.

Regenerate deterministically with:

```
node fixtures/music/generate-beds.mjs
```

| File | Description | Length | Format | License |
|---|---|---|---|---|
| `bed-calm-cmaj.wav`   | Calm C-major pad   | 8s loop | WAV PCM 16-bit mono 44.1kHz | CC0 1.0 |
| `bed-warm-amin.wav`   | Warm A-minor pad   | 8s loop | WAV PCM 16-bit mono 44.1kHz | CC0 1.0 |
| `bed-bright-gmaj.wav` | Bright G-major pad | 8s loop | WAV PCM 16-bit mono 44.1kHz | CC0 1.0 |

The assembler loops/trims a bed to project length and ducks it under the voiceover
via the EXISTING `volumeEnvelope` field (no new ffmpeg filter), so playback stays
WYCIWYG-safe. CC0 requires no attribution; the source is logged in the
`ScriptManifest.attributions[]` as provenance regardless.

> DECISION FOR CEO/Ward: if a *human-composed* FreePD-equivalent CC0 set is
> preferred over these synthesized beds, drop replacement CC0 `.wav`/`.mp3` files in
> this directory (same filenames) — no code change is needed.
