# VideoForge — Landing Page Copy

Status: DRAFT — awaiting CEO go-live approval before any external publish.

---

## SEO

**title tag** (~55 chars):
```
VideoForge — Browser Video Editor, Export What You See
```

**meta description** (~150 chars):
```
VideoForge is a browser-based multi-track video editor that exports exactly what your timeline shows. No ghost footage. No audio desync. Free. Chrome and Edge only.
```

---

## Hero Section

**Headline** (≤8 words):
```
The export matches your edit. Always.
```

**Subhead** (1–2 sentences):
```
VideoForge is a multi-track video editor that runs in your browser. The MP4 you download is generated from the same project graph your timeline previews — what you cut is what you get.
```

**Primary CTA** (amber button — the one Export/action CTA):
```
Start editing free
```

**Secondary CTA** (ghost/text link):
```
Read the docs
```

**Browser requirement note** (small, below CTAs):
```
Works in Chrome and Edge on desktop. Safari and Firefox are not supported.
```

---

## Feature Blocks

### Block 1
**Title:** Frame-accurate export
**Icon:** `Scissors`
**Description:** Trims, splits, and gaps are written to a non-destructive project graph. The FFmpeg export command is built from that same graph — no trimmed footage reappearing, no audio scrambling on a simple cut.

### Block 2
**Title:** Multi-track timeline
**Icon:** `Layers`
**Description:** Up to three video tracks, two audio tracks, two overlay tracks, and one caption track. Clips carry their audio; linked audio moves and splits with the video clip so the mix never falls out of sync.

### Block 3
**Title:** Script to video
**Icon:** `Wand2`
**Description:** Paste a script, review the auto-planned scenes, then generate a real editable timeline with voiceover and sketch-style visuals. Open the result in the editor and replace any shot with your own footage.

### Block 4
**Title:** Export to TikTok, YouTube, or Instagram
**Icon:** `Download`
**Description:** One-click presets for 9:16, 16:9, 1:1, 4:5, and 4:3. Exports H.264 MP4 up to 1080p. Pre-flight shows estimated file size and render time before you queue the job.

---

## How It Works

### Path A — Start from a script

1. **Paste your script.** Script Studio reads your text, estimates scene durations, and plans voiceover, captions, and a shot brief for each scene.
2. **Review and adjust.** Edit the voiceover, captions, and sketch style per scene before generating anything.
3. **Generate and refine.** VideoForge builds a full timeline with TTS voiceover and sketch visuals. Open it in the editor, swap in your own footage with the Auto-arrange tray, and export.

### Path B — Start from the editor

1. **Create a project.** Pick an aspect ratio (9:16, 16:9, 1:1, 4:5, 4:3, or custom) or start from a template.
2. **Import and arrange.** Drop your media into the timeline. Trim, split, move, and stack clips across multiple tracks. Add text overlays, captions, color grade, and Ken Burns motion.
3. **Export.** Click Export, choose a preset and resolution, and download the MP4 when the render is done. The file matches what you saw in the preview.

---

## Trust / Credibility Line

```
The export FFmpeg graph is generated directly from the same project JSON your timeline previews — the same code path, not a copy. Verified by an automated golden-frame fidelity gate on every build.
```

---

## Closing CTA Section

**Heading:**
```
Start your first project
```

**Button label:**
```
Open VideoForge free
```

---

## Footer Tagline

```
VideoForge — what you cut is what you get.
```

---

## Implementation Notes for Engineers

- The amber `#FF7A1A` / `bg-vf-accent` class applies only to the primary CTA button ("Start editing free" / "Open VideoForge free"). No other element on the landing page should use amber.
- Selection / secondary accent: sky-blue (`--vf-selection`), used for links and secondary emphasis.
- The hero headline and subhead should render on a dark background (`bg-vf-bg-app` or equivalent), not white.
- "Script to video" block: do not imply this is AI-generated in a vague way. The copy above is precise — TTS voiceover + sketch visuals, fully editable in the existing editor. Do not add promises about AI quality.
- Free tier: exports are watermark-free at 1080p (per CEO decision 2026-06-14). The copy above does not mention a watermark, which is accurate. Do not add watermark language without checking with Atlas first.
- The browser requirement note must be visible on the hero, not buried in a footer. Safari and Firefox users will bounce without it; surfacing it early reduces support noise.
