# VideoForge User Guide

---

## What is VideoForge?

VideoForge is a browser-based multi-track video editor. You import your footage, arrange it on a timeline, and export an MP4. The core promise: the exported file matches your timeline frame for frame. Trimmed clips stay trimmed. Audio stays in sync. What you cut is what you get.

**Browser requirement:** VideoForge requires Chrome or Edge on a desktop or laptop. It uses WebCodecs for video decoding, which is not available in Safari or Firefox. If you open VideoForge in an unsupported browser, you will see a message explaining this — the editor will not open in a broken state.

**Free tier:** VideoForge is currently free. There is no billing, no watermark, and no paywall on export.

---

## Getting Started

### Sign up and sign in

Go to VideoForge in Chrome or Edge. Create an account with an email and password, or sign in with Google. After signing in you land on the **project dashboard**.

### The project dashboard

The dashboard shows all your projects as cards. Each card displays the project title, aspect ratio, and when it was last edited. From the dashboard you can:

- **Open** a project (click the card or the "Open" option in the card menu)
- **Rename** a project (card menu or click the title while hovering)
- **Duplicate** a project
- **Delete** a project (requires confirmation; this cannot be undone)

Two entry points for creating new work are always visible: **+ New** opens the project creation modal, and **From a script** opens Script Studio.

---

## Path A: Script Studio

Script Studio lets you turn a written script into an editable video timeline. It generates TTS voiceover audio, sketch-style visuals, and on-screen captions per scene, then opens the result in the editor where you can swap in your own footage.

### Step 1 — Paste your script

Click **From a script** on the dashboard. On the Script Studio page:

1. Paste your script into the text area. The word count and estimated video duration appear automatically.
2. Choose a **voice** for the TTS voiceover.
3. Choose a **sketch style** for the generated visuals.
4. Optionally check **Add background music**.
5. Give your project a title (optional — you can rename it later).
6. Click **Plan scenes**.

Script Studio reads your text and plans it into scenes. Each scene gets a voiceover segment, a shot brief (a description of what footage that scene needs), and suggested captions.

### Step 2 — Review the scene plan

You see a list of scenes. For each scene you can edit:

- **Voiceover** — the text that will be read by TTS
- **Small caption** — a short line that appears in the video
- **Big caption** — prominent word-by-word caption text for that scene

The shot brief (the description of footage you need for that scene) is shown for reference but is not editable here. Make any changes, then click **Generate video**.

### Step 3 — Generate

VideoForge builds the timeline: it runs TTS on the voiceover text, generates sketch visuals, and assembles a full project. A progress bar shows status. When generation is complete, the editor opens automatically with the new project loaded.

### Step 4 — Auto-arrange your footage

When the editor opens from Script Studio, an **Auto-arrange** tray appears. This tray shows the shot briefs for each scene and lets you fill them with your own clips. Drag footage from the Media panel into the tray slots, or close the tray and drag directly onto the timeline. The **Auto-arrange** button in the bottom-right corner of the editor reopens the tray at any time.

---

## Path B: Manual Editor

### Creating a project

From the dashboard, click **+ New**. A modal opens with two sections:

1. **Choose an aspect ratio** — pick from 9:16 (TikTok, Reels, Shorts), 16:9 (YouTube), 1:1 (Instagram feed), 4:5 (Instagram portrait), 4:3 (classic / presentations), or Custom (enter your own width and height in pixels).
2. **Or start from a template** — the template grid below the ratio tiles shows available templates filtered by the aspect ratio you chose. Click a template to preview and select it. Selecting a template auto-selects its ratio.

Give your project a name (optional), then click **Create project** or **Use template**.

### The editor layout

The editor has four bands:

| Band | What it does |
|---|---|
| **Top bar** | Project title, undo/redo buttons, Export button |
| **Canvas area** | Left panel rail, media / template / text / caption panel (expands when a rail tab is active), center canvas with transport controls below it, right Inspector panel |
| **Timeline** | Multi-track clip arrangement with ruler, playhead, and the AI command bar above it |
| **Status bar** | Zoom level, playhead timecode, keyboard shortcuts button |

### Importing media

Click the **Media** tab in the left rail to open the media panel. Drag a file from your computer into the panel, or click to browse. Supported formats: MP4/MOV (H.264), MP3, WAV, AAC, JPG, PNG.

Files are uploaded to VideoForge servers. A progress indicator appears while the file uploads and is processed into a preview proxy. When processing is complete the clip thumbnail appears in the media panel and is ready to use.

To add a clip to the timeline: drag it from the media panel and drop it onto a track in the timeline. The clip snaps to the playhead position on drop.

**Upload limits (free tier):** 20 GB per video file, 2 GB per audio file, 100 MB per image.

### The timeline

The timeline is the main editing surface. It shows:

- A **ruler** at the top with timecode. Click anywhere on the ruler to jump the playhead to that position.
- A **playhead** (vertical line) marking the current position.
- **Tracks** stacked vertically. Track order (top to bottom) matches visual layer order (top tracks appear in front in the canvas).

**Free-tier track limits:** 3 video tracks, 2 audio tracks, 2 overlay tracks, 1 caption track.

**Track types:**
- **Video** — holds video and image clips
- **Audio** — holds audio-only clips
- **Overlay** — holds text blocks and other visual elements placed on the canvas
- **Caption** — holds timed caption blocks

#### Clip operations

| Operation | How to do it |
|---|---|
| Select a clip | Click it |
| Move a clip | Drag it left/right (same track or cross-track) |
| Trim the start | Drag the left edge of the clip |
| Trim the end | Drag the right edge of the clip |
| Split at playhead | Position the playhead, press `S` |
| Delete | Select, press `Delete` or `Backspace` |
| Ripple delete (close the gap) | Select, press `Ctrl+Delete` (or `Cmd+Delete` on Mac) |
| Duplicate | Select, press `Ctrl+D` / `Cmd+D` |
| Copy / Paste | `Ctrl+C` / `Ctrl+V` (or `Cmd+C` / `Cmd+V`) |

**Audio Link:** When a video clip has embedded audio, the audio is linked. Linked audio moves and splits with its video clip — the chain icon on the clip indicates the link is active. Right-click a clip to unlink audio if you want to move them independently.

**Snapping:** Clips snap to clip edges and the playhead by default. Hold `Alt` while dragging to disable snapping.

**Timeline zoom:** Use `Ctrl+Scroll` (or `Cmd+Scroll`) to zoom in and out, or use the zoom slider in the status bar. Zoom is centered on the playhead.

**Mute / Solo:** Each audio and video track has mute and solo buttons. Muted tracks are excluded from the export — the export matches the preview mix exactly.

**Speed:** Select a clip and use the Inspector panel to change playback speed (0.1x to 16x). Audio pitch is preserved on export.

### The canvas and preview

The center canvas shows the current frame at the playhead position. Click the canvas to select overlays. Use the transport controls below the canvas to play, pause, and seek.

The canvas defaults to 9:16 (vertical) for new projects. The aspect ratio is set when you create a project and does not change after that.

**Auto-degrade:** If the preview falls behind on slower hardware, VideoForge automatically switches to a lower-resolution proxy. This is indicated in the status bar. Export always uses the original source files regardless of which proxy the preview used.

### Adding text overlays

Click the **Text** tab in the left rail. You can add:

- Title
- Subtitle
- Body text
- Custom Text

Each option adds a text block to the overlay track at the current playhead position. You can also press `T` to add a default text block.

After adding a text block, select it on the timeline or canvas. The right Inspector panel shows controls for font, size, color, weight, alignment, position, and opacity. You can also type directly in the canvas to edit the text.

**Text shortcuts (when a text overlay is selected):**
- `Ctrl+B` / `Cmd+B` — Bold
- `Ctrl+I` / `Cmd+I` — Italic
- `Ctrl+U` / `Cmd+U` — Underline
- `Ctrl+Shift+L` / `Cmd+Shift+L` — Align left
- `Ctrl+Shift+C` / `Cmd+Shift+C` — Align center
- `Ctrl+Shift+R` / `Cmd+Shift+R` — Align right

Text style, position, and opacity can all be keyframed using the Inspector panel.

### Captions

Click the **Captions** tab in the left rail to work with captions.

To add captions manually: drag an `.srt` or `.vtt` file into the editor, or use File > Import Captions. You can also hand-author caption blocks in the caption editor panel (set start time, end time, and text for each block).

Captions appear on the caption track in the timeline. They preview on the canvas at the correct timecodes.

**Note:** Automatic caption generation from audio (Whisper transcription) is not available yet. Manual import and hand-authored captions are the current options.

### Color grade, keyframes, and transitions

**Color grade:** Select a video clip and use the Inspector panel to adjust brightness, contrast, and saturation. The preview and export use the same values — the grade you see is the grade you get.

**Keyframes:** Select a clip or overlay and use the Inspector panel to add keyframes for opacity, position X/Y, scale, and rotation. Use linear or ease interpolation. Ken Burns pan-and-zoom is implemented as start/end keyframes on scale and position.

**Crossfade transition:** In the timeline, position two clips so they overlap on the same track, then use the Inspector to set a crossfade. The dissolve is rendered identically in both the preview and the export.

### Templates

Click the **Templates** tab in the left rail to browse templates while in the editor. You can also start from a template when creating a new project (see the new project modal above). Templates include placeholder clips — slots you fill with your own footage. The export preflight checker will flag any unfilled slots before you can export.

---

## Exporting Your Video

When your edit is ready, click the **Export** button in the top bar (the amber button). The Export modal opens.

### Export settings

**Format & Quality tab:**

| Setting | Options |
|---|---|
| Preset | 9:16 (TikTok / Reels), 16:9 (YouTube), 1:1 (Instagram feed), 4:5 (Instagram portrait), 4:3 (Classic / TV), Custom (match project) |
| Resolution | 720p or 1080p (1080p is the maximum on the free tier) |
| Frame rate | 24, 25, or 30 fps |
| Format | MP4, H.264 (no other formats are available yet) |

The modal shows an estimated file size and estimated render time before you start.

**Captions tab:**

If your project has a caption track, choose how captions are handled:

- **None** — no captions in the output
- **Burned-in** — captions are permanently drawn into the video frames
- **Sidecar file** — a separate .srt or .vtt file is generated alongside the MP4

### The export and WYCIWYG

Click **Export** to queue the render. A progress bar shows render status. When the render is complete, a **Download MP4** link appears. The download is available for 7 days; each time you click the link a fresh 1-hour download URL is generated.

The exported MP4 is built from the exact same project graph your timeline was previewing. There is no separate "export version" of your project. Every trim, split, stack, text overlay, color grade, and caption you see in the editor is exactly what appears in the file.

**If the Export button is disabled:** the preflight checker has found an issue. The modal shows a list of problems — click any item to jump directly to the affected clip or overlay so you can fix it.

---

## Saving Your Work

VideoForge auto-saves your project every 3 seconds after a change. You can also save manually at any time with `Ctrl+S` / `Cmd+S`. The save state is shown in the top bar.

**Undo / Redo:** `Ctrl+Z` / `Cmd+Z` to undo, `Ctrl+Shift+Z` or `Ctrl+Y` / `Cmd+Shift+Z` or `Cmd+Y` to redo. The undo stack holds up to 200 operations.

---

## Keyboard Shortcuts

Press `?` at any time in the editor to open the full shortcuts panel. The complete list:

### Playback

| Key | Action |
|---|---|
| `Space` | Play / Pause |
| `L` | Play forward |
| `K` | Stop |
| `J` | Rewind 2 seconds |
| `Left / Right arrow` | Step one frame (hold `Shift` for 10 frames) |
| `M` | Mute / unmute the first audio track |

### Editing

| Key | Action |
|---|---|
| `Ctrl+Z` / `Cmd+Z` | Undo |
| `Ctrl+Shift+Z` or `Ctrl+Y` | Redo |
| `Ctrl+C` / `Cmd+C` | Copy selection |
| `Ctrl+V` / `Cmd+V` | Paste |
| `Ctrl+D` / `Cmd+D` | Duplicate selection |
| `Delete` / `Backspace` | Delete selection |
| `Ctrl+Delete` / `Cmd+Delete` | Ripple delete (close the gap) |
| `Ctrl+S` / `Cmd+S` | Save now |

### Timeline and layout

| Key | Action |
|---|---|
| `S` | Split clip at playhead |
| `Left / Right arrow` | Nudge selected clip or overlay |
| `Up / Down arrow` | Move selected overlay up or down on canvas |
| `Ctrl+/` / `Cmd+/` | Toggle the left panel |

### Text (when a text overlay is selected)

| Key | Action |
|---|---|
| `T` | Add a text overlay at the playhead |
| `Ctrl+B` / `Cmd+B` | Bold |
| `Ctrl+I` / `Cmd+I` | Italic |
| `Ctrl+U` / `Cmd+U` | Underline |
| `Ctrl+Shift+L/C/R` | Align left / center / right |

### Other

| Key | Action |
|---|---|
| `?` | Open this shortcuts panel |

---

## Troubleshooting / FAQ

### The editor does not open — I see a browser warning

VideoForge requires Chrome or Edge on a desktop computer. If you see a browser gate message, switch to a supported browser. Safari and Firefox do not have WebCodecs, which VideoForge uses for video decoding.

### My clip shows a thumbnail but the preview is black

The clip may still be processing. VideoForge generates a 720p preview proxy after upload. The status indicator on the clip in the media panel changes to show when processing is complete. If the clip stays black after processing, try refreshing the page.

### The Export button is disabled

The export preflight checker has found one or more issues with your project. The modal shows a list — common causes are:

- An unfilled template media slot (a placeholder clip that has not been replaced with real footage). Click "Add media" next to the slot to jump to it.
- A validation error on a clip or overlay. Click "Jump to item" to select the affected element and fix it.

### My audio is out of sync in the preview

Check that the Audio Link is enabled on your video clips (the chain icon). If audio and video were unlinked manually and then moved independently, re-trim or re-position them to align. The master audio clock (`AudioContext.currentTime`) drives all playback, so the sync issue is in the edit rather than the engine.

### The export render is slow or queued

Renders run on a shared worker. During high load, your job may wait in the queue. The progress bar shows "Queued, waiting for worker" while waiting. If the job stays queued for more than a few minutes, close the modal and try again.

### I hit the 5 exports per minute limit

VideoForge limits exports to 5 per minute per account. Wait a moment and try again — your edit is saved.

### I cannot find my exported file

The download link is available for 7 days from the time of export. After 7 days the file is deleted from the server. Download and store your exports locally.

### A feature I expected is not available

VideoForge is in early access (Phase 0 / free tier). Features not currently available include: AI auto-captions (manual and imported captions only), H.265 / VP9 / ProRes / GIF export, 4K export, stock media library, collaboration, voiceover recording, auto-ducking, and blend modes beyond normal. These are planned for later phases.

---

*VideoForge — what you cut is what you get.*
