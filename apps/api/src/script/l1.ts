// ─────────────────────────────────────────────────────────────────────────────
// L1 integration boundary for Lane L2.
//
// L1 HAS LANDED: `@videoforge/script-studio` v2 now exports the Contract A/B surface
// per the pinned signatures, so this module is a thin re-export — the single import
// site L2 uses for the planner schema/heuristic and the pure assembler/placement.
// Re-exporting here (rather than importing the package directly across L2) keeps the
// integration seam in ONE file.
// ─────────────────────────────────────────────────────────────────────────────

export {
  scenePlanSchema,
  planFromHeuristic,
  assemblePlannedProject,
  arrangeAssets,
} from '@videoforge/script-studio';

export type {
  ScenePlan,
  PlannedScene,
  BrollSuggestion,
  AssemblePlannedInput,
  SceneVo,
  PlacedAsset,
  AssembledPlannedScript,
  PlannedScriptManifest,
  PlannedSceneMapping,
} from '@videoforge/script-studio';
