// ─────────────────────────────────────────────────────────────────────────────
// PINNED CONTRACT C — Script Studio v2 routes (`/api/v1/script`).
//
//   POST /plan      → { script, voiceId? }            → 200 { plan, source }
//   POST /generate  → { title, plan, voiceId, withMusic } → 201 { projectId }  (inline ≤8 scenes)
//                                                          → 202 { jobId, mode:"queued" } (long)
//   POST /arrange   → { projectId, assetIds[] }        → 200 { project }
//
// AUTH: every route requires a valid access token (app.authenticate preHandler).
// workspaceId = the authenticated userId (user-is-the-workspace MVP model).
//
// The planner NEVER 5xxs for content reasons (missing key / Groq error / schema-fail
// → heuristic). generate runs inline for short plans, else enqueues a bounded
// `script` job; either way the result yields a projectId.
// ─────────────────────────────────────────────────────────────────────────────

import type { FastifyInstance } from 'fastify';
import { eq, and, inArray } from 'drizzle-orm';
import { validateProject, type Project } from '@videoforge/project-schema';
import { db } from '../db/client.js';
import { projects, scriptManifests, assets as assetsTable } from '../db/schema.js';
import { scriptQueue, type ScriptJobData } from '../queues.js';
import { planScript } from '../script/planner.js';
import { runGenerate, parsePlan } from '../script/generate.js';
import { arrangeAssets } from '../script/l1.js';
import type { PlacedAsset, PlannedScriptManifest } from '../script/l1.js';
import { generateSceneSketches } from '../script/sketchScenes.js';
import {
  isIllustrationStyle,
  DEFAULT_ILLUSTRATION_STYLE,
  type IllustrationStyle,
} from '../script/sketch.js';

/** Max script length accepted at /plan (bounds Groq tokens + heuristic work). */
const MAX_SCRIPT_CHARS = 20000;
/** Scenes ≤ this run inline; longer enqueue the bounded `script` job. */
const INLINE_SCENE_CAP = 8;

interface PlanBody {
  script?: unknown;
  voiceId?: unknown;
}
interface GenerateBody {
  title?: unknown;
  plan?: unknown;
  voiceId?: unknown;
  withMusic?: unknown;
  /** 'line' | 'pen' | 'graphite' | 'color' | 'photo' — auto-illustrate scenes;
   *  absent/invalid → none (text-card video). 'line' (default look) = minimal ink art. */
  sketchStyle?: unknown;
}
interface ArrangeBody {
  projectId?: unknown;
  assetIds?: unknown;
}
interface SketchBody {
  projectId?: unknown;
  style?: unknown;
}

export async function scriptRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', app.authenticate);

  // ── POST /plan ───────────────────────────────────────────────────────────────
  app.post<{ Body: PlanBody }>('/plan', async (request, reply) => {
    const body = request.body ?? {};
    const script = typeof body.script === 'string' ? body.script.trim() : '';
    const voiceId = typeof body.voiceId === 'string' ? body.voiceId.trim() : '';

    if (!script) {
      return reply
        .code(400)
        .send({ error: 'BadRequest', message: 'script is required' });
    }
    if (script.length > MAX_SCRIPT_CHARS) {
      return reply.code(413).send({
        error: 'PayloadTooLarge',
        message: `script exceeds ${MAX_SCRIPT_CHARS} characters`,
      });
    }

    // Never 5xx for content reasons — planScript degrades to the heuristic.
    const { plan, source } = await planScript(script, voiceId);
    return reply.code(200).send({ plan, source });
  });

  // ── POST /generate ─────────────────────────────────────────────────────────────
  app.post<{ Body: GenerateBody }>('/generate', async (request, reply) => {
    const body = request.body ?? {};
    const title =
      typeof body.title === 'string' && body.title.trim()
        ? body.title.trim()
        : 'Script Studio Project';
    const voiceId =
      typeof body.voiceId === 'string' ? body.voiceId.trim() : '';
    const withMusic = body.withMusic === true;
    // Optional auto-illustrate style ('pen'|'graphite'|'color' sketch, or 'photo' real
    // web images); an invalid/absent value means "no images" (text-card video).
    const sketchStyle: IllustrationStyle | null = isIllustrationStyle(body.sketchStyle)
      ? body.sketchStyle
      : null;

    let plan;
    try {
      plan = parsePlan(body.plan);
    } catch {
      return reply
        .code(400)
        .send({ error: 'BadRequest', message: 'plan failed Contract A validation' });
    }

    const workspaceId = request.user.userId;

    // Long scripts (or any sketch run — image gen is slow) → bounded async job so the
    // request thread isn't held for minutes (WS: script:progress / script:complete).
    if (plan.scenes.length > INLINE_SCENE_CAP || sketchStyle) {
      const jobData: ScriptJobData = {
        workspaceId,
        title,
        plan,
        voiceId,
        withMusic,
        sketchStyle,
      };
      const job = await scriptQueue.add('generate', jobData);
      return reply.code(202).send({ mode: 'queued', jobId: job.id });
    }

    // Short scripts, no sketches → inline.
    const { projectId } = await runGenerate({
      workspaceId,
      title,
      plan,
      voiceId,
      withMusic,
      sketchStyle,
    });
    return reply.code(201).send({ projectId });
  });

  // ── POST /arrange ──────────────────────────────────────────────────────────────
  app.post<{ Body: ArrangeBody }>('/arrange', async (request, reply) => {
    const body = request.body ?? {};
    const projectId = typeof body.projectId === 'string' ? body.projectId : '';
    const assetIds = Array.isArray(body.assetIds)
      ? body.assetIds.filter((a): a is string => typeof a === 'string')
      : [];
    if (!projectId) {
      return reply
        .code(400)
        .send({ error: 'BadRequest', message: 'projectId is required' });
    }

    const workspaceId = request.user.userId;

    // Load project + its sidecar manifest (scene windows live there).
    const [projRow] = await db
      .select()
      .from(projects)
      .where(and(eq(projects.id, projectId), eq(projects.workspaceId, workspaceId)));
    if (!projRow) {
      return reply
        .code(404)
        .send({ error: 'NotFound', message: 'project not found' });
    }
    const [manRow] = await db
      .select()
      .from(scriptManifests)
      .where(
        and(
          eq(scriptManifests.projectId, projectId),
          eq(scriptManifests.workspaceId, workspaceId),
        ),
      );
    if (!manRow) {
      return reply.code(409).send({
        error: 'NotScriptProject',
        message: 'project has no script manifest; arrange is only for Script Studio projects',
      });
    }

    // The persisted sidecar manifest carries the scene windows + videoTrackId the
    // pure placement reads. L1's arrangeAssets reads brollSuggestion.mediaType
    // internally, so we just hand it the full manifest.
    const manifest = manRow.manifest as PlannedScriptManifest;

    // Resolve mediaType + durationMs for each uploaded asset from the assets table.
    let placed: PlacedAsset[] = [];
    if (assetIds.length > 0) {
      const rows = await db
        .select()
        .from(assetsTable)
        .where(
          and(
            eq(assetsTable.workspaceId, workspaceId),
            inArray(assetsTable.id, assetIds),
          ),
        );
      const byId = new Map(rows.map((r) => [r.id, r]));
      placed = assetIds
        .map((assetId, order): PlacedAsset | null => {
          const r = byId.get(assetId);
          if (!r) return null;
          const mediaType: 'photo' | 'video' = (r.contentType ?? '').startsWith('image/')
            ? 'photo'
            : 'video';
          return {
            assetId,
            mediaType,
            ...(typeof r.durationMs === 'number' ? { durationMs: r.durationMs } : {}),
            uploadOrder: order,
          };
        })
        .filter((a): a is PlacedAsset => a !== null);
    }

    // Pure re-placement → new document + refreshed manifest (b-roll clip ids).
    const document = projRow.document as Project;
    const arranged = arrangeAssets(document, manifest, placed);

    // Validate + PATCH (server stamps revision+1, mirroring the projects PATCH).
    const result = validateProject(arranged.document);
    if (!result.ok) {
      return reply
        .code(422)
        .send({ error: 'SchemaError', issues: result.errors });
    }
    const newRevision = projRow.revision + 1;
    const saved: Project = { ...result.value, revision: newRevision };
    await db
      .update(projects)
      .set({
        document: saved as unknown as Record<string, unknown>,
        revision: newRevision,
        updatedAt: new Date(),
      })
      .where(eq(projects.id, projectId));

    // Persist the refreshed manifest (its videoClipIds now point at the new b-roll
    // clips) so a subsequent re-arrange stays consistent.
    await db
      .update(scriptManifests)
      .set({
        manifest: arranged.manifest as unknown as Record<string, unknown>,
        updatedAt: new Date(),
      })
      .where(eq(scriptManifests.projectId, projectId));

    return reply.code(200).send({ project: saved });
  });

  // ── POST /sketch ─────────────────────────────────────────────────────────────
  // Auto-illustrate an EXISTING script project: generate one sketch per scene from its
  // stored brollSuggestions and place them on the b-roll track (style swap / regen).
  // The generative twin of /arrange. Runs inline — intended for small projects; the
  // primary script→video path generates sketches inside the queued /generate job.
  app.post<{ Body: SketchBody }>('/sketch', async (request, reply) => {
    const body = request.body ?? {};
    const projectId = typeof body.projectId === 'string' ? body.projectId : '';
    const style: IllustrationStyle = isIllustrationStyle(body.style)
      ? body.style
      : DEFAULT_ILLUSTRATION_STYLE;
    if (!projectId) {
      return reply
        .code(400)
        .send({ error: 'BadRequest', message: 'projectId is required' });
    }

    const workspaceId = request.user.userId;

    const [projRow] = await db
      .select()
      .from(projects)
      .where(and(eq(projects.id, projectId), eq(projects.workspaceId, workspaceId)));
    if (!projRow) {
      return reply.code(404).send({ error: 'NotFound', message: 'project not found' });
    }
    const [manRow] = await db
      .select()
      .from(scriptManifests)
      .where(
        and(
          eq(scriptManifests.projectId, projectId),
          eq(scriptManifests.workspaceId, workspaceId),
        ),
      );
    if (!manRow) {
      return reply.code(409).send({
        error: 'NotScriptProject',
        message: 'project has no script manifest; sketch is only for Script Studio projects',
      });
    }

    const manifest = manRow.manifest as PlannedScriptManifest;
    const document = projRow.document as Project;

    // Generate + place (registers photo assets, runs pure L1 placement). The project
    // title anchors photo-mode web searches to the script's topic.
    const sketched = await generateSceneSketches(document, manifest, {
      workspaceId,
      style,
      title: document.title,
    });

    const result = validateProject(sketched.document);
    if (!result.ok) {
      return reply.code(422).send({ error: 'SchemaError', issues: result.errors });
    }
    const newRevision = projRow.revision + 1;
    const saved: Project = { ...result.value, revision: newRevision };
    await db
      .update(projects)
      .set({
        document: saved as unknown as Record<string, unknown>,
        revision: newRevision,
        updatedAt: new Date(),
      })
      .where(eq(projects.id, projectId));
    await db
      .update(scriptManifests)
      .set({
        manifest: sketched.manifest as unknown as Record<string, unknown>,
        updatedAt: new Date(),
      })
      .where(eq(scriptManifests.projectId, projectId));

    return reply.code(200).send({ project: saved, style, sources: sketched.sources });
  });
}
