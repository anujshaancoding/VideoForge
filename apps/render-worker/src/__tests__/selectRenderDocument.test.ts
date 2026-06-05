// ─────────────────────────────────────────────────────────────────────────────
// Document-SOURCE selection (Templates wave — the empty-slot fix, §10.2).
//
// CONTRACT (agreed w/ Core/Pixel): the render job payload carries the §18 document
// the API resolved for this export — there is NO DB fetch in the worker. The API
// puts a client-supplied render-snapshot (the previewed, pruned-of-unfilled-slots
// doc) OR the stored project onto the job, and the worker renders THAT exact doc.
//
// This locks down selectRenderDocument(): an explicit `document` snapshot wins;
// otherwise we fall back to `project` (the field apps/api currently inlines —
// see apps/api/src/queues.ts `RenderJobData.project`). The chosen doc must then
// build a valid filter graph unchanged (preview==export holds for the snapshot).
//
// Pure logic only — the S3 layer is mocked so this runs with NO network / Redis /
// FFmpeg (mirrors resolveAssets.test.ts).
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect, vi } from 'vitest';
import { sampleProject, type Project } from '@videoforge/project-schema';
import { buildExportCommand, type ExportSettings } from '@videoforge/ffmpeg-graph';

// Mock the S3 helpers so importing worker.js does no real I/O (vi.mock is hoisted).
vi.mock('../s3.js', () => ({
  downloadFromS3: vi.fn(),
  uploadToS3: vi.fn(),
  cleanupFile: vi.fn(),
  BUCKET_ORIGINALS: 'vf-originals',
  BUCKET_PROXIES: 'vf-proxies',
  BUCKET_EXPORTS: 'vf-exports',
}));

const { selectRenderDocument } = await import('../worker.js');

const settings: ExportSettings = {
  format: 'mp4',
  videoCodec: 'h264',
  resolution: { w: 1080, h: 1920 },
  fps: 30,
  crf: 18,
  captions: 'none',
  watermark: true,
};

/** A distinguishable §18 snapshot (e.g. the previewed, pruned-of-slots template). */
function snapshotDoc(): Project {
  const doc: Project = JSON.parse(JSON.stringify(sampleProject));
  doc.title = 'Previewed Snapshot — Pruned';
  return doc;
}

/** A distinguishable §18 "stored project" doc. */
function storedDoc(): Project {
  const doc: Project = JSON.parse(JSON.stringify(sampleProject));
  doc.title = 'Stored Project';
  return doc;
}

describe('selectRenderDocument() — render the API-provided document, never fetch by id', () => {
  it('prefers the explicit `document` snapshot when present', () => {
    const document = snapshotDoc();
    const project = storedDoc();
    const chosen = selectRenderDocument({ document, project }) as Project;
    expect(chosen.title).toBe('Previewed Snapshot — Pruned');
    expect(chosen).toBe(document); // exact reference — no copy/mutation
  });

  it('falls back to `project` when no document is provided (unchanged behaviour)', () => {
    const project = storedDoc();
    expect(selectRenderDocument({ project }) as Project).toBe(project);
    expect((selectRenderDocument({ document: undefined, project }) as Project).title).toBe(
      'Stored Project',
    );
    // A null document is treated as absent → fall back to project.
    expect(selectRenderDocument({ document: null, project }) as Project).toBe(project);
  });

  it('feeds the SELECTED document (snapshot) through buildExportCommand unchanged', () => {
    // The snapshot path must produce the SAME graph as building the snapshot directly:
    // the worker only changes the SOURCE field, never the doc → export parity holds.
    const document = snapshotDoc();
    const project = storedDoc();

    const selected = selectRenderDocument({ document, project }) as Project;
    const viaWorker = buildExportCommand(selected, settings);
    const direct = buildExportCommand(document, settings);

    expect(viaWorker.filterComplex).toBe(direct.filterComplex);
    expect(viaWorker.args).toEqual(direct.args);
    // And it is DISTINCT from what the stored project would have built (proves the
    // snapshot — not the stored doc — was the one rendered when both are present).
    const storedGraph = buildExportCommand(project, settings);
    // Same structural graph here (both derive from sampleProject) but the chosen doc
    // is the snapshot object, so a snapshot-only edit would diverge; assert identity.
    expect(selected).not.toBe(project);
    void storedGraph;
  });
});
