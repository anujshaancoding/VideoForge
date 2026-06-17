// ─────────────────────────────────────────────────────────────────────────────
// Script Studio v2 — sketch-scene orchestration (the "auto-illustrate" step).
//
//   generateSceneSketches(document, manifest, opts) -> { document, manifest, sources }
//
// The generative twin of /arrange: instead of slotting USER uploads onto the scene
// windows, it GENERATES one sketch image per scene from that scene's brollSuggestion,
// then runs the SAME pure placement (L1 arrangeAssets) to fill the b-roll track. The
// invariant is untouched — every generated frame becomes an ordinary photo asset, so
// the editor previews and the exporter renders exactly what the timeline shows.
//
// Per scene:  prompt (from brollSuggestion) → generateBaseImage (Draw Things → cloud →
// placeholder) → applySketch (uniform pen/graphite/color filter) → register as a photo
// asset (uploadOrder = sceneIndex). With one asset per scene in scene order, L1's
// round-robin (assets[i % n]) maps scene i → its own sketch i. CPU/GPU-bounded: the
// imagegen seam is single-flight, and scene count is capped at 40 upstream.
// ─────────────────────────────────────────────────────────────────────────────

import { join } from 'node:path';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import type { Project } from '@videoforge/project-schema';
import { generateBaseImage, type ImageSource } from './imagegen.js';
import { applySketch, type SketchStyle } from './sketch.js';
import { registerLocalFileAsAsset } from './assets.js';
import { cleanupFile } from './fs.js';
import { arrangeAssets } from './l1.js';
import type { PlacedAsset, PlannedScriptManifest } from './l1.js';

export interface SketchProgress {
  progress: number; // 0..100
  done: number;
  total: number;
}
export type SketchProgressFn = (p: SketchProgress) => void | Promise<void>;

export interface GenerateSketchesInput {
  workspaceId: string;
  style: SketchStyle;
  onProgress?: SketchProgressFn;
}

export interface GenerateSketchesResult {
  document: Project;
  manifest: PlannedScriptManifest;
  /** Engine that produced each scene's image, scene-ordered (manifest provenance + UX). */
  sources: ImageSource[];
}

/** Deterministic 31-bit seed from the project id + scene index (reproducible images). */
function seedFor(projectId: string, sceneIndex: number): number {
  let h = 2166136261;
  for (let i = 0; i < projectId.length; i += 1) {
    h ^= projectId.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  h ^= Math.imul(sceneIndex + 1, 2654435761);
  return Math.abs(h) % 2147483647;
}

/** Build a base-image prompt from a scene's b-roll suggestion (no style words — the
 * sketch filter owns the look; a light anchor keeps base images composed + coherent). */
function promptFor(description: string, keywords: string[]): string {
  const subject = description.trim() || keywords.join(', ') || 'a simple scene';
  const kw = keywords.length > 0 ? `${keywords.join(', ')}. ` : '';
  return `${subject}. ${kw}detailed illustration, single clear subject, soft natural lighting`;
}

/**
 * Generate + place one sketch per scene. Returns the new document + refreshed manifest
 * (b-roll clip ids) + per-scene image source. Side effects: registers N photo assets
 * (PROCESSING → READY async via the existing media pipeline). Throws only on real
 * I/O errors; image generation itself never throws (it degrades to a placeholder).
 */
export async function generateSceneSketches(
  document: Project,
  manifest: PlannedScriptManifest,
  input: GenerateSketchesInput,
): Promise<GenerateSketchesResult> {
  const { workspaceId, style, onProgress } = input;
  // Render each styled frame at the export canvas size so the 1080×1920 video is crisp
  // (the filter upscales/covers to this; line art thresholds sharp at full res).
  const target = { width: document.canvas.width, height: document.canvas.height };
  const scenes = [...manifest.scenes].sort((a, b) => a.sceneIndex - b.sceneIndex);
  const total = scenes.length;

  const placed: PlacedAsset[] = [];
  const sources: ImageSource[] = [];
  const cleanup: string[] = [];

  try {
    for (let i = 0; i < total; i += 1) {
      const scene = scenes[i]!;
      const sug = scene.brollSuggestion;
      const prompt = promptFor(sug?.description ?? '', sug?.keywords ?? []);

      const base = await generateBaseImage(prompt, {
        seed: seedFor(manifest.projectId, scene.sceneIndex),
      });
      cleanup.push(base.pngPath);

      const dir = await mkdtemp(join(tmpdir(), 'vf-sketch-'));
      const sketchPath = join(dir, `scene-${scene.sceneIndex + 1}-${style}.png`);
      await applySketch(base.pngPath, style, sketchPath, target);
      cleanup.push(sketchPath);

      const { assetId } = await registerLocalFileAsAsset(
        sketchPath,
        workspaceId,
        `scene-${scene.sceneIndex + 1}-sketch.png`,
      );

      // Scene-entry animation. Default: a quick ~0.4s opacity FADE-IN (snappy; doesn't
      // outrun the narration). SKETCH_REVEAL='wipe' → the slow top→bottom draw-on
      // (over ~85% of the window); SKETCH_REVEAL='0' → instant (no animation).
      const anim = process.env['SKETCH_REVEAL'];
      const windowMs = Math.max(1, scene.endMs - scene.startMs);
      const animProps =
        anim === 'wipe'
          ? {
              revealWipe: {
                direction: 'top' as const,
                durationMs: Math.max(500, Math.round(windowMs * 0.85)),
                easing: 'linear' as const,
              },
            }
          : anim === '0'
            ? {}
            : { fadeInMs: 400 };
      placed.push({ assetId, mediaType: 'photo', uploadOrder: i, ...animProps });
      sources.push(base.source);

      if (onProgress) {
        await onProgress({ progress: Math.round(((i + 1) / total) * 100), done: i + 1, total });
      }
    }

    // Pure placement: one asset per scene, in scene order → scene i gets sketch i.
    const arranged = arrangeAssets(document, manifest, placed);
    return { document: arranged.document, manifest: arranged.manifest, sources };
  } finally {
    // Sketch + base bytes are already in S3 (the registered sketch); temp copies go.
    await Promise.allSettled(cleanup.map((p) => cleanupFile(p)));
  }
}
