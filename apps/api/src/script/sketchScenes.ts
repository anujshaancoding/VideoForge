// ─────────────────────────────────────────────────────────────────────────────
// Script Studio v2 — scene-image orchestration (the "auto-illustrate" step).
//
//   generateSceneSketches(document, manifest, opts) -> { document, manifest, sources }
//
// The generative twin of /arrange: instead of slotting USER uploads onto the scene
// windows, it PRODUCES one image per scene from that scene's brollSuggestion, then runs
// the SAME pure placement (L1 arrangeAssets) to fill the b-roll track. The invariant is
// untouched — every frame becomes an ordinary photo asset, so the editor previews and
// the exporter render exactly what the timeline shows.
//
// TWO image modes, chosen by `style`:
//   • sketch ('pen'|'graphite'|'color') — generateBaseImage (Draw Things → cloud →
//     placeholder) → applySketch (uniform filter so 30–40 images read as one hand).
//   • photo  — findSceneImage: RETRIEVE a real web image for the scene's keywords and
//     keep it intact (no filter). For scripts about real, named subjects (a game agent,
//     a person, a brand) where authenticity beats generation. Falls back to a (fitted,
//     un-sketched) AI image when search is off or finds nothing.
//
// CPU/GPU/NET-bounded: imagegen is single-flight, image search is timeout + max-bytes +
// concurrency capped, and scene count is capped at 40 upstream.
// ─────────────────────────────────────────────────────────────────────────────

import { join } from 'node:path';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import type { Project } from '@videoforge/project-schema';
import { generateBaseImage, type ImageSource } from './imagegen.js';
import { applySketch, type IllustrationStyle, type SketchTarget } from './sketch.js';
import { findSceneImage, fitToCanvas } from './imageSearch.js';
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
  style: IllustrationStyle;
  /** Project title — anchors web-image search queries to the script's topic
   *  ("Valorant" + scene keyword "Jett" → "valorant jett"). Photo mode only. */
  title?: string;
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

/** Build a base-image prompt from a scene's b-roll suggestion.
 *
 * SKETCH styles (pen/graphite/color) → prompt FOR minimal single-line ink art directly,
 * rather than rendering a detailed image and hoping the filter flattens it. The reference
 * look (CEO, 2026-06-27) is delicate continuous-line illustration with generous negative
 * space — a busy base thresholds into muddy crosshatch, the opposite of that. On SDXL-Turbo
 * (CFG≈1) the negative prompt is math-inert, so the POSITIVE prompt is the only lever; the
 * pen filter then cleans the lines. Sparse art is also deliberate: it keeps the image
 * subordinate so the narration + typewriter captions stay the hero.
 *
 * PHOTO mode keeps the old detailed-illustration anchor (its fallback wants a real frame). */
/** @internal Exported for unit tests only — callers should use generateSceneSketches. */
export function promptFor(description: string, keywords: string[], style: IllustrationStyle): string {
  const subject = description.trim() || keywords.join(', ') || 'a simple scene';
  if (style === 'photo') {
    const kw = keywords.length > 0 ? `${keywords.join(', ')}. ` : '';
    return `${subject}. ${kw}detailed illustration, single clear subject, soft natural lighting`;
  }
  const kw = keywords.length > 0 ? `${keywords.join(', ')}, ` : '';
  return (
    `single continuous line drawing of ${subject}, ${kw}` +
    'minimalist fine-line ink illustration, delicate thin black linework, ' +
    'clean white background, generous negative space, one subject, elegant and simple, line art'
  );
}

// Generic title words that add noise rather than topic to a web image search.
const TITLE_STOP = new Set([
  'reel', 'reels', 'video', 'videos', 'short', 'shorts', 'part', 'edit', 'final',
  'draft', 'project', 'clip', 'clips', 'the', 'a', 'an', 'of', 'for', 'to', 'and',
  'my', 'new', 'official', 'full', 'hd', '4k', 'untitled', 'script', 'studio',
]);

/** A short topic anchor from the title (drops generic words + bare numbers). */
function topicAnchor(title: string): string {
  const words = title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 1 && !TITLE_STOP.has(w) && !/^\d+$/.test(w));
  return words.slice(0, 3).join(' ');
}

/** Compose the web image-search query: topic anchor + the scene's keywords. This is
 *  the "research the keywords" step — the title disambiguates a bare keyword ("Jett")
 *  into the real subject ("valorant jett") so retrieval stays authentic to the script. */
function searchQueryFor(title: string, description: string, keywords: string[]): string {
  const anchor = topicAnchor(title);
  const kw = keywords.map((k) => k.trim()).filter(Boolean).slice(0, 4).join(' ');
  const q = [anchor, kw].filter(Boolean).join(' ').trim();
  return q || description.trim() || 'b-roll background';
}

/** Turn a raw base image into the final canvas-sized PNG: the pen/graphite/color sketch
 *  styles run the artistic filter; 'line' and 'photo' keep the source intact and just
 *  cover-fit it ('line' = the AI base is already minimal line art; 'photo' = a real frame). */
/** @internal Exported for unit tests only — callers should use generateSceneSketches. */
export async function finishFrame(
  srcPath: string,
  style: IllustrationStyle,
  sceneNum: number,
  target: SketchTarget,
): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'vf-frame-'));
  const dst = join(dir, `scene-${sceneNum}-${style}.png`);
  if (style === 'photo' || style === 'line') {
    await fitToCanvas(srcPath, dst, target);
  } else {
    await applySketch(srcPath, style, dst, target);
  }
  return dst;
}

/**
 * Produce + place one image per scene. Returns the new document + refreshed manifest
 * (b-roll clip ids) + per-scene image source. Side effects: registers N photo assets
 * (PROCESSING → READY async via the existing media pipeline). Throws only on real
 * I/O errors; image production itself never throws (search → AI → placeholder).
 */
export async function generateSceneSketches(
  document: Project,
  manifest: PlannedScriptManifest,
  input: GenerateSketchesInput,
): Promise<GenerateSketchesResult> {
  const { workspaceId, style, title = '', onProgress } = input;
  // Render each frame at the export canvas size so the 1080×1920 video is crisp (the
  // filter/cover-fit upscales to this; line art thresholds sharp at full res).
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
      const keywords = sug?.keywords ?? [];
      const description = sug?.description ?? '';
      const sceneNum = scene.sceneIndex + 1;

      let framePath: string;
      let frameSource: ImageSource;

      if (style === 'photo') {
        // Authentic path: retrieve a real web image for this scene's keywords.
        const query = searchQueryFor(title, description, keywords);
        const found = await findSceneImage(query, target);
        if (found) {
          framePath = found.pngPath; // already cover-fitted to canvas
          frameSource = 'websearch';
        } else {
          // Fallback: AI image, fitted but UN-sketched (photo mode wants a real frame).
          const base = await generateBaseImage(promptFor(description, keywords, 'photo'), {
            seed: seedFor(manifest.projectId, scene.sceneIndex),
          });
          cleanup.push(base.pngPath);
          framePath = await finishFrame(base.pngPath, 'photo', sceneNum, target);
          frameSource = base.source;
        }
      } else {
        // Sketch path: AI base → uniform artistic filter.
        const base = await generateBaseImage(promptFor(description, keywords, style), {
          seed: seedFor(manifest.projectId, scene.sceneIndex),
          // Inert on SDXL-Turbo (CFG≈1) but honored by FLUX/cloud: push away from the
          // things that ruin minimal line art (color, shading, clutter, extra subjects).
          negativePrompt:
            'color, shading, crosshatching, hatching, gradient, texture, photorealistic, ' +
            '3d render, busy background, cluttered, multiple subjects, heavy detail, ' +
            'text, watermark, signature, blurry',
        });
        cleanup.push(base.pngPath);
        framePath = await finishFrame(base.pngPath, style, sceneNum, target);
        frameSource = base.source;
      }
      cleanup.push(framePath);

      const { assetId } = await registerLocalFileAsAsset(
        framePath,
        workspaceId,
        `scene-${sceneNum}-${style === 'photo' ? 'photo' : 'sketch'}.png`,
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
      sources.push(frameSource);

      if (onProgress) {
        await onProgress({ progress: Math.round(((i + 1) / total) * 100), done: i + 1, total });
      }
    }

    // Pure placement: one asset per scene, in scene order → scene i gets frame i.
    const arranged = arrangeAssets(document, manifest, placed);
    return { document: arranged.document, manifest: arranged.manifest, sources };
  } finally {
    // Frame + base bytes are already in S3 (the registered frame); temp copies go.
    await Promise.allSettled(cleanup.map((p) => cleanupFile(p)));
  }
}
