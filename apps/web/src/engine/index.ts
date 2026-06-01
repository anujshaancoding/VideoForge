// ─────────────────────────────────────────────────────────────────────────────
// Singleton engine instances — import these throughout the app; never `new`.
//
// AudioEngine MUST be instantiated before PreviewEngine because the preview
// engine reads audioEngine.audioCtx for its master clock.
// ─────────────────────────────────────────────────────────────────────────────

import { AudioEngine } from "./AudioEngine.js";
import { PreviewEngine } from "./PreviewEngine.js";

export { AudioEngine } from "./AudioEngine.js";
export { PreviewEngine } from "./PreviewEngine.js";

export const audioEngine = new AudioEngine();
export const previewEngine = new PreviewEngine();
