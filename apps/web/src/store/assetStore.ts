// ─────────────────────────────────────────────────────────────────────────────
// assetStore — the single source of truth for resolved media-asset metadata.
//
// The §18 project document references media by `sourceAssetId` ONLY (never URLs).
// The engines (PreviewEngine / AudioEngine) and the store therefore need a way to
// resolve an assetId → a real, presigned, playable proxy URL + duration/dimensions.
//
// Before this registry existed, both engines SYNTHESISED a URL
// (`http://localhost:9000/proxy/<id>.mp4`) that does not match MinIO's bucket/key
// shape and is unauthenticated — so real uploads never previewed. The registry is
// populated from the API's AssetRecord (presigned `proxyUrl`) on:
//   • upload / dedup / asset:ready (MediaPanel)
//   • project load (Editor fetches every referenced asset once)
//
// It is deliberately SEPARATE from the editor store: asset metadata is not part of
// the undoable project document and must not push history entries.
// ─────────────────────────────────────────────────────────────────────────────

import { create } from "zustand";
import type { AssetRecord } from "../lib/api.js";

export type AssetKind = "video" | "audio" | "image";

export interface AssetMeta {
  id: string;
  /** MIME content type, e.g. "video/mp4". */
  contentType: string;
  kind: AssetKind;
  /** Source duration in ms (null until probed by the worker's ffprobe step). */
  durationMs: number | null;
  width: number | null;
  height: number | null;
  /** Presigned, directly-playable proxy URL (video/audio). null until ready. */
  proxyUrl: string | null;
  /** Presigned thumbnail (image kind) / sprite URL. */
  thumbnailUrl: string | null;
  /** Presigned waveform-peaks JSON URL (audio). */
  waveformUrl: string | null;
}

export function kindFromContentType(mime: string): AssetKind {
  if (mime.startsWith("audio/")) return "audio";
  if (mime.startsWith("image/")) return "image";
  return "video";
}

/** Build an AssetMeta from an API AssetRecord. */
export function metaFromRecord(rec: AssetRecord): AssetMeta {
  return {
    id: rec.id,
    contentType: rec.contentType,
    kind: kindFromContentType(rec.contentType),
    durationMs: rec.durationMs,
    width: rec.width,
    height: rec.height,
    proxyUrl: rec.proxyUrl,
    thumbnailUrl: rec.thumbnailUrl,
    waveformUrl: rec.waveformUrl,
  };
}

interface AssetState {
  assets: Record<string, AssetMeta>;
  registerAsset: (meta: AssetMeta) => void;
  registerFromRecord: (rec: AssetRecord) => void;
  getAsset: (id: string) => AssetMeta | undefined;
}

export const useAssetStore = create<AssetState>((set, get) => ({
  assets: {},
  registerAsset: (meta) =>
    set((s) => ({ assets: { ...s.assets, [meta.id]: meta } })),
  registerFromRecord: (rec) =>
    set((s) => ({ assets: { ...s.assets, [rec.id]: metaFromRecord(rec) } })),
  getAsset: (id) => get().assets[id],
}));

/** Imperative accessor for non-React consumers (the engines). */
export function getAssetMeta(id: string): AssetMeta | undefined {
  const existing = useAssetStore.getState().assets[id];
  if (existing) return existing;

  // Demo videos used by templates have real playable content served from /demo-videos/
  if (id.startsWith("demo-video:")) {
    const slug = id.replace("demo-video:", "");
    const thumbMap: Record<string, string> = {
      "summer-sale": "/demo-videos/summer-sale-thumb.jpg",
      "product-launch": "/demo-videos/product-launch-thumb.jpg",
      "ig-reel": "/demo-videos/ig-reel-thumb.jpg",
    };
    return {
      id,
      kind: "video",
      contentType: "video/mp4",
      width: 720,
      height: 1280,
      durationMs: null,
      proxyUrl: `/demo-videos/${slug}-demo.mp4`,
      thumbnailUrl: thumbMap[slug] || null,
      waveformUrl: null,
    };
  }

  return undefined;
}
