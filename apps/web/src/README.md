# @videoforge/web — source notes

Vite + React 18 + TypeScript frontend for the VideoForge MVP. Dark-theme-first,
Chrome/Edge desktop only (see `lib/browser.ts` / `routes/BrowserGate.tsx`).

## Layout

- `main.tsx` — entry; mounts `<App>`, imports the global stylesheet.
- `App.tsx` — router (`/` Dashboard, `/new` New-Project modal, `/editor/:id` Editor)
  behind the browser-support gate.
- `styles/tokens.css` — every `--vf-*` design token (Design_Instructions_MVP.md §2).
  Re-skin = replace these values; no component or Tailwind change.
- `styles/index.css` — Tailwind layers + global dark body + focus-ring token.
- `store/editorStore.ts` — the Zustand + Immer store (the contract's public API).
- `store/history.ts` — Immer-patch undo/redo (capped at 200).
- `lib/projectStore.ts` — **MVP-STUB**: localStorage project persistence standing in
  for the apps/api backend (`POST/GET /api/v1/projects`).
- `components/ui/` — shared primitives (Button, IconButton, Slider, Panel, Modal,
  Tooltip, Field).
- `components/editor/index.ts` — barrel for the seven editor shell components.
- `routes/` — BrowserGate, Dashboard, NewProjectModal, Editor.

## AI Edit Command Bar

Prompt-based editing lives in `ai-edit/` and is deliberately structured:

- `parser.ts` converts natural language into an `EditPlan`. The local rule parser
  works without API keys; `parseWithLLM()` is an adapter seam for OpenAI/Anthropic/Groq
  and only exchanges compact timeline metadata, never video files.
- `validation.ts` checks time ranges, target ids, safe effect ranges, aspect ratios,
  audio targets, and destructive-edit confirmation before anything applies.
- `store/editorStore.ts` exposes `applyAIEditPlan(plan)`, which applies the validated
  plan through one undoable Zustand/Immer commit. AI output never mutates arbitrary UI
  state directly.
- `components/editor/ai-edit/` contains the command bar, preview/confirmation panel,
  action list, and error message UI.

Supported local commands include trim/delete ranges, fade/crossfade transitions,
brightness/contrast/saturation, 9:16/16:9/1:1/4:5 aspect changes, zoom, audio volume,
mute ranges, fade in/out, and manual caption text. Automatic silence removal is parsed
and validated, but currently returns a visible unsupported warning because waveform
silence detection is not implemented yet.

## Intentional stubs (compile + run, honestly placeholdered)

Per the contract, heavy capabilities are clearly-commented placeholders, marked with
`// MVP-STUB:` and a spec pointer:

- **WebCodecs decode / Web Audio engine** — the real-time preview does NOT decode
  video or run a Web Audio graph yet. `CanvasStage` (built by the EditorShell stage)
  draws clip/overlay rectangles + labels via Canvas 2D from the store instead of
  decoding media (Design_Instructions_MVP.md §5; Spec §15). The store, layout, and
  data model are all real; only the pixel pipeline is stubbed.
- **Asset durations** — new clips dropped from the media panel get a default source
  span (no ffprobe/decode yet). See `editorStore.ts` `DEFAULT_NEW_CLIP_MS`.
- **Persistence** — `lib/projectStore.ts` uses localStorage until apps/api is wired.

## Editor shell ownership

`components/editor/{TopBar,MediaPanel,CanvasStage,Transport,Timeline,Inspector,StatusBar}.tsx`
are created by the **EditorShell** stage. They are default-exported, zero-prop,
store-driven components. This stage created only the `index.ts` barrel; `Editor.tsx`
composes them in the §3 six-band layout.
