// ─────────────────────────────────────────────────────────────────────────────
// L2 integration smoke over L1's Contract B: assemblePlannedProject emits a §18-
// valid Project, is deterministic, supports music (volumeEnvelope duck), and
// arrangeAssets re-places b-roll purely. These run through the L1 boundary (l1.ts)
// with no I/O — they assert L2 consumes L1 per the pinned signatures. (L1 owns its
// own golden/snapshot suite; this is the seam check.)
// ─────────────────────────────────────────────────────────────────────────────

import { describe, expect, it } from 'vitest';
import { validateProject } from '@videoforge/project-schema';
import {
  assemblePlannedProject,
  arrangeAssets,
  planFromHeuristic,
  type ScenePlan,
  type SceneVo,
  type PlacedAsset,
} from '../l1.js';

function fakeVo(plan: ScenePlan): SceneVo[] {
  return plan.scenes.map((_s, i) => ({
    sceneIndex: i,
    voiceAssetId: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
    durationMs: 1200 + i * 100,
  }));
}

const plan = planFromHeuristic(
  'Scene one is here. Scene two follows. And scene three closes it out.',
);

describe('assemblePlannedProject (via L1 boundary)', () => {
  it('emits a §18-valid Project', () => {
    const { document } = assemblePlannedProject({
      plan,
      vo: fakeVo(plan),
      voiceId: 'af_heart',
      seed: 'seed-1',
      title: 'Test',
    });
    expect(validateProject(document).ok).toBe(true);
  });

  it('is deterministic — same input ⇒ byte-identical document', () => {
    const a = assemblePlannedProject({ plan, vo: fakeVo(plan), voiceId: 'v', seed: 's', title: 'T' });
    const b = assemblePlannedProject({ plan, vo: fakeVo(plan), voiceId: 'v', seed: 's', title: 'T' });
    expect(JSON.stringify(a.document)).toBe(JSON.stringify(b.document));
  });

  it('adds a music track (ducked via volumeEnvelope) when music is supplied', () => {
    const { document } = assemblePlannedProject({
      plan,
      vo: fakeVo(plan),
      music: { assetId: '00000000-0000-4000-8000-00000000ffff', durationMs: 5000 },
      voiceId: 'v',
      seed: 's',
      title: 'T',
    });
    const res = validateProject(document);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const audioTracks = res.value.tracks.filter((t) => t.type === 'audio');
    expect(audioTracks.length).toBeGreaterThanOrEqual(1);
    const env = (audioTracks[0] as { volumeEnvelope?: unknown[] }).volumeEnvelope ?? [];
    expect(env.length).toBeGreaterThan(0);
  });
});

describe('arrangeAssets (via L1 boundary)', () => {
  it('fills the b-roll track and keeps the document §18-valid', () => {
    const built = assemblePlannedProject({
      plan,
      vo: fakeVo(plan),
      voiceId: 'v',
      seed: 's',
      title: 'T',
    });
    const assets: PlacedAsset[] = [
      { assetId: '00000000-0000-4000-8000-0000000000a1', mediaType: 'video', durationMs: 800, uploadOrder: 0 },
      { assetId: '00000000-0000-4000-8000-0000000000a2', mediaType: 'photo', uploadOrder: 1 },
    ];
    const arranged = arrangeAssets(built.document, built.manifest, assets);
    const videoTrack = arranged.document.tracks.find(
      (t) => t.id === built.manifest.videoTrackId,
    ) as { clips?: unknown[] };
    expect((videoTrack.clips ?? []).length).toBeGreaterThan(0);
    expect(validateProject(arranged.document).ok).toBe(true);
  });
});
