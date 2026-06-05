// ─────────────────────────────────────────────────────────────────────────────
// @videoforge/templates — public entry point.
//
// Ships the 5 Phase-0 starter templates as DATA: each is a valid §18 `Project`
// document + its sidecar `TemplateManifest` slot metadata. Plus two pure helpers
// for the gallery (listManifests) and apply (getTemplate). This package never
// touches the render / ffmpeg-graph path — templates are ordinary Projects.
// ─────────────────────────────────────────────────────────────────────────────

import type { Template, TemplateManifest } from "./types.js";
import { happyBirthday } from "./templates/happyBirthday.js";
import { travelRecap } from "./templates/travelRecap.js";
import { photoMemories } from "./templates/photoMemories.js";
import { motivationalQuote } from "./templates/motivationalQuote.js";
import { simplePromo } from "./templates/simplePromo.js";

export * from "./types.js";
export {
  PLACEHOLDER_ASSET_IDS,
  PLACEHOLDER_AUDIO_ASSET_IDS,
  isPlaceholderAssetId,
} from "./placeholders.js";

/** The 5 starter templates, in gallery display order (Templates_Spec §3). */
export const TEMPLATES: readonly Template[] = [
  happyBirthday,
  travelRecap,
  photoMemories,
  motivationalQuote,
  simplePromo,
] as const;

/** Card metadata for every template (gallery). */
export function listManifests(): TemplateManifest[] {
  return TEMPLATES.map((t) => t.manifest);
}

/** Look up a template (manifest + document) by its manifest id. */
export function getTemplate(id: string): Template | undefined {
  return TEMPLATES.find((t) => t.manifest.id === id);
}

export {
  happyBirthday,
  travelRecap,
  photoMemories,
  motivationalQuote,
  simplePromo,
};
