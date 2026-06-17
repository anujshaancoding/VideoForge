// ─────────────────────────────────────────────────────────────────────────────
// Script Studio v2 — generate orchestration (Contract C #3), shared by the inline
// route path and the bounded `script` BullMQ worker.
//
// For each scene: synth VO (TTS seam, one at a time) → ffprobe duration → register
// the WAV as a media asset via the EXISTING originals-bucket/media pipeline →
// optionally pick a bundled FreePD-tier CC0 music bed (also registered as an asset)
// → call L1's pure `assemblePlannedProject(...)` (Contract B) → persist the §18
// Project via the same insert path the projects route uses, plus the sidecar
// ScriptManifest into `script_manifests`. Returns { projectId }.
//
// CPU-bounded by design: scene count is capped at 40 upstream (schema), and TTS runs
// strictly one synth at a time (tts.ts mutex). No new uncapped pool, no busy-loop.
// ─────────────────────────────────────────────────────────────────────────────

import { randomUUID } from 'node:crypto';
import { validateProject, type Project } from '@videoforge/project-schema';
import { db } from '../db/client.js';
import { projects, scriptManifests } from '../db/schema.js';
import { synthVoice } from './tts.js';
import { registerLocalFileAsAsset } from './assets.js';
import { pickMusicBed } from './music.js';
import { cleanupFile } from './fs.js';
import { generateSceneSketches } from './sketchScenes.js';
import type { SketchStyle } from './sketch.js';
import {
  scenePlanSchema,
  assemblePlannedProject,
  type ScenePlan,
  type SceneVo,
} from './l1.js';

export interface GenerateInput {
  workspaceId: string;
  title: string;
  plan: ScenePlan;
  voiceId: string;
  withMusic: boolean;
  /** When set, auto-generate one sketch image per scene (Draw Things → filter) and
   *  place it on the b-roll track before persisting. Null/omitted → text-card video. */
  sketchStyle?: SketchStyle | null;
}

export interface GenerateProgress {
  /** 0..100 overall progress. */
  progress: number;
  /** Scenes synthesized so far / total. */
  done: number;
  total: number;
}

export type ProgressFn = (p: GenerateProgress) => void | Promise<void>;

/** Validate + coerce an unknown plan into a ScenePlan. Throws on invalid. */
export function parsePlan(raw: unknown): ScenePlan {
  return scenePlanSchema.parse(raw);
}

/**
 * Run the full generate pipeline. Returns the new projectId. Errors here are real
 * (TTS/S3/DB) — NOT content errors (content already degraded to a valid plan
 * upstream). The caller maps a throw to a 5xx / job-failed event.
 */
export async function runGenerate(
  input: GenerateInput,
  onProgress?: ProgressFn,
): Promise<{ projectId: string }> {
  const { workspaceId, title, plan, voiceId, withMusic, sketchStyle } = input;
  const seed = randomUUID();
  const total = plan.scenes.length;
  const vo: SceneVo[] = [];
  const cleanup: string[] = [];
  // When sketches are on, the image stage is the long pole — reserve the back half of
  // the progress bar for it (VO 0..45, sketches 45..95). Otherwise VO owns 0..90.
  const voProgressMax = sketchStyle ? 45 : 90;

  try {
    // 1. Synthesize VO per scene (one at a time), probe duration, register asset.
    for (let i = 0; i < total; i += 1) {
      const scene = plan.scenes[i]!;
      const synth = await synthVoice(scene.voiceoverText, voiceId);
      cleanup.push(synth.wavPath);

      const { assetId } = await registerLocalFileAsAsset(
        synth.wavPath,
        workspaceId,
        `scene-${i + 1}-vo.wav`,
      );

      vo.push({
        sceneIndex: i,
        voiceAssetId: assetId,
        durationMs: synth.durationMs, // PROBED — the timing source of truth
        ...(synth.words ? { words: synth.words } : {}),
      });

      if (onProgress) {
        const progress = Math.round(((i + 1) / total) * voProgressMax);
        await onProgress({ progress, done: i + 1, total });
      }
    }

    // Music-only swell padding (ms) around the VO so the duck is audibly dynamic even
    // with continuous back-to-back VO. The assembler applies these ONLY when `music` is
    // set; the no-music timeline still starts at 0. Kept here so the bed-asset duration
    // request below can cover the FULL padded length.
    const MUSIC_LEAD_IN_MS = 1200;
    const MUSIC_LEAD_OUT_MS = 1200;

    // 2. Optionally attach a bundled CC0 music bed (registered as an asset too).
    let music: { assetId: string; durationMs: number } | null = null;
    if (withMusic) {
      const bed = await pickMusicBed(seed);
      if (bed) {
        const voSpan = vo.reduce((a, v) => a + v.durationMs, 0) || 1000;
        // Full padded project length the bed loops/trims to fill: intro + VO + outro.
        const paddedDur = MUSIC_LEAD_IN_MS + voSpan + MUSIC_LEAD_OUT_MS;
        const { assetId } = await registerLocalFileAsAsset(
          bed.path,
          workspaceId,
          bed.filename,
        );
        // durationMs here is the source length the bed loops/trims to fill the padded
        // project; the exporter loops the source via existing clip semantics (no
        // atempo/setpts).
        music = { assetId, durationMs: paddedDur };
      }
    }

    // 3. Pure assembly (Contract B). Same input ⇒ byte-identical document.
    const assembled = assemblePlannedProject({
      plan,
      vo,
      assets: [],
      music,
      // Lead-in/out applied only when music is enabled (assembler enforces this too).
      ...(music ? { musicLeadInMs: MUSIC_LEAD_IN_MS, musicLeadOutMs: MUSIC_LEAD_OUT_MS } : {}),
      voiceId,
      seed,
      title,
    });

    // 4. Optionally auto-illustrate: generate one sketch per scene and place it on the
    //    b-roll track (Draw Things → filter → photo asset → pure L1 placement). Falls
    //    back gracefully per-image; never throws for content reasons.
    let finalDoc = assembled.document;
    let finalManifest = assembled.manifest;
    if (sketchStyle) {
      const sk = await generateSceneSketches(assembled.document, assembled.manifest, {
        workspaceId,
        style: sketchStyle,
        // Map the 0..100 image progress onto the reserved 45..95 band.
        ...(onProgress
          ? {
              onProgress: async ({ progress }) => {
                await onProgress({ progress: 45 + Math.round(progress * 0.5), done: total, total });
              },
            }
          : {}),
      });
      finalDoc = sk.document;
      finalManifest = sk.manifest;
    }

    // 5. Validate + persist the §18 Project (same shape the projects route inserts).
    const result = validateProject(finalDoc);
    if (!result.ok) {
      throw new Error(
        `script generate: assembled document failed §18 validation (${result.errors.length} issue(s))`,
      );
    }
    const project: Project = result.value;

    await db.insert(projects).values({
      id: project.id,
      workspaceId,
      name: project.title,
      document: project as unknown as Record<string, unknown>,
      revision: project.revision,
    });

    // 6. Persist the sidecar manifest + plan (Arrange reads scene windows from it).
    await db.insert(scriptManifests).values({
      projectId: project.id,
      workspaceId,
      manifest: finalManifest as unknown as Record<string, unknown>,
      plan: plan as unknown as Record<string, unknown>,
    });

    if (onProgress) await onProgress({ progress: 100, done: total, total });

    return { projectId: project.id };
  } finally {
    // Temp VO WAVs are already in S3 (originals bucket); local copies are disposable.
    await Promise.allSettled(cleanup.map((p) => cleanupFile(p)));
  }
}
