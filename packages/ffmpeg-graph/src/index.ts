// ─────────────────────────────────────────────────────────────────────────────
// @videoforge/ffmpeg-graph — public entry point.
//
// The headless "what-you-cut-is-what-you-get" FFmpeg command builder (M0 spine).
// Pure + deterministic: same Project + ExportSettings ⇒ same argv/filter_complex.
// See buildFilterComplex.ts for the full §10.3 spec mapping.
// ─────────────────────────────────────────────────────────────────────────────

export {
  buildExportCommand,
  captionsToSrt,
  atempoChain,
  projectDurationMs,
  EMPTY_PROJECT_DURATION_MS,
} from "./buildFilterComplex.js";

export type {
  ExportSettings,
  InputSpec,
  BuildResult,
  TextFileSpec,
  FontSpec,
  AssetKind,
} from "./buildFilterComplex.js";
