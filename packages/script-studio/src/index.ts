// ─────────────────────────────────────────────────────────────────────────────
// @videoforge/script-studio — public entry point (P0).
//
// A pure, headless assembler: a script string + caller-supplied VO asset ids and
// probed durations → a valid §18 `Project` + a sidecar `ScriptManifest`. No TTS,
// no FFmpeg, no I/O. Depends only on @videoforge/project-schema (+ templates
// authoring builders). Text cards are constrained to the export-rendered drawtext
// subset, so preview == export by construction (no new render path is added).
// ─────────────────────────────────────────────────────────────────────────────

export { segmentScript } from "./segment.js";
export type { ScriptSegment } from "./segment.js";

export {
  assembleScript,
  EXPORTABLE_TEXT_STYLE_KEYS,
  DEFAULT_SCENE_STYLE,
} from "./assemble.js";
export type { AssembleScriptInput, SegmentInput } from "./assemble.js";

export type {
  AssembledScript,
  ScriptManifest,
  ScriptSegmentMapping,
  ScriptSceneStyle,
  ScriptAttribution,
  PlannedScriptManifest,
  PlannedSceneMapping,
  AssembledPlannedScript,
} from "./types.js";

// ── Script Studio v2 — Contract A (scene plan) + Contract B (planned assembler) ──

export {
  scenePlanSchema,
  plannedSceneSchema,
  brollSuggestionSchema,
  validateScenePlan,
  planFromHeuristic,
  heuristicDurationMs,
  MAX_SCENES,
} from "./plan.js";
export type {
  ScenePlan,
  PlannedScene,
  BrollSuggestion,
  ValidateScenePlanResult,
} from "./plan.js";

export { assemblePlannedProject, arrangeAssets } from "./assemblePlanned.js";
export type {
  AssemblePlannedInput,
  SceneVo,
  PlacedAsset,
} from "./assemblePlanned.js";
