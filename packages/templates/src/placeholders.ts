// ─────────────────────────────────────────────────────────────────────────────
// Bundled placeholder / sentinel media asset ids for the starter templates.
//
// Each media slot's Clip.sourceAssetId points at one of these well-known UUIDs.
// They are REAL UUID v4 values (so `validateProject()` — which requires a uuid for
// Clip.sourceAssetId — passes), but they reference bundled CC0 stand-in assets that
// are seeded into the dev/CI S3 double. The structural "filled" check used at export
// is `clip.sourceAssetId !== <placeholder id>` (Templates_Architecture §5.3), so the
// placeholder id is mirrored into each slot's `placeholder.asset.assetId`.
//
// NOTE: these ids are co-located with the template documents so the slot-integrity
// test can assert each media slot's placeholder assetId actually appears on its
// target element.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Distinct placeholder asset ids. A template assigns a fresh one per media slot so
 * filling one slot never makes a sibling read as "filled" by the structural check.
 * 24 ids cover every media slot across all 5 templates (19) with headroom.
 */
export const PLACEHOLDER_ASSET_IDS = [
  "10000000-0000-4000-8000-000000000001",
  "10000000-0000-4000-8000-000000000002",
  "10000000-0000-4000-8000-000000000003",
  "10000000-0000-4000-8000-000000000004",
  "10000000-0000-4000-8000-000000000005",
  "10000000-0000-4000-8000-000000000006",
  "10000000-0000-4000-8000-000000000007",
  "10000000-0000-4000-8000-000000000008",
  "10000000-0000-4000-8000-000000000009",
  "10000000-0000-4000-8000-00000000000a",
  "10000000-0000-4000-8000-00000000000b",
  "10000000-0000-4000-8000-00000000000c",
  "10000000-0000-4000-8000-00000000000d",
  "10000000-0000-4000-8000-00000000000e",
  "10000000-0000-4000-8000-00000000000f",
  "10000000-0000-4000-8000-000000000010",
  "10000000-0000-4000-8000-000000000011",
  "10000000-0000-4000-8000-000000000012",
  "10000000-0000-4000-8000-000000000013",
  "10000000-0000-4000-8000-000000000014",
  "10000000-0000-4000-8000-000000000015",
  "10000000-0000-4000-8000-000000000016",
  "10000000-0000-4000-8000-000000000017",
  "10000000-0000-4000-8000-000000000018",
] as const;

/** Well-known placeholder background-music asset ids (one per template's A1 slot). */
export const PLACEHOLDER_AUDIO_ASSET_IDS = {
  birthday: "20000000-0000-4000-8000-000000000001",
  travel: "20000000-0000-4000-8000-000000000002",
  memories: "20000000-0000-4000-8000-000000000003",
  quote: "20000000-0000-4000-8000-000000000004",
  promo: "20000000-0000-4000-8000-000000000005",
} as const;

/** True when an asset id is one of the bundled template placeholders (any kind). */
export function isPlaceholderAssetId(assetId: string): boolean {
  return (
    (PLACEHOLDER_ASSET_IDS as readonly string[]).includes(assetId) ||
    (Object.values(PLACEHOLDER_AUDIO_ASSET_IDS) as string[]).includes(assetId)
  );
}
