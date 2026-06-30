// ─────────────────────────────────────────────────────────────────────────────
// Editor component barrel.
//
// These seven components are the editor shell, OWNED BY THE EditorShell STAGE
// (this stage creates only this barrel). Each is a DEFAULT-exported, zero-prop
// React component that reads everything from useEditorStore (see the contract).
// Editor.tsx composes them in the §3 three-zone layout grid; importing through
// this barrel keeps those imports stable once the files land.
//
// File ownership (created by EditorShell, NOT this stage):
//   TopBar.tsx       — 56px top bar: logo, project name, undo/redo, save, Export CTA
//   MediaPanel.tsx   — left media library (Videos/Audio/Images/Text/Captions)
//   CanvasStage.tsx  — centered fixed-ratio preview (MVP-STUB: Canvas 2D draw, no
//                      WebCodecs decode / Web Audio engine yet — see §5 / §15)
//   Transport.tsx    — 48px transport bar: play/pause, skip, frame-step, timecode
//   Timeline.tsx     — multi-track timeline: ruler, playhead, clips, zoom (§6)
//   Inspector.tsx    — right context inspector + Caption Editor mode (§7)
//   StatusBar.tsx    — 28px status strip: playhead, duration, zoom %, save/render
// ─────────────────────────────────────────────────────────────────────────────

export { default as TopBar } from "./TopBar.js";
export { default as MediaPanel } from "./MediaPanel.js";
export { default as CanvasStage } from "./CanvasStage.js";
export { default as Transport } from "./Transport.js";
export { default as Timeline } from "./Timeline.js";
export { default as Inspector } from "./Inspector.js";
export { default as StatusBar } from "./StatusBar.js";
export { default as CommandEditBar } from "./ai-edit/CommandEditBar.js";
export { EditorErrorBoundary } from "./ErrorBoundary.js";
