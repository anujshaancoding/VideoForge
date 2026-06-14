// ─────────────────────────────────────────────────────────────────────────────
// stockLibrary — the CC0 / zero-license-risk media catalogue (pure, testable).
//
// This is the SCAFFOLD for the in-app media library (Stock / Elements / Audio).
// It ships with ONLY genuinely original, generated-on-device content — solid and
// gradient backgrounds — so there is no third-party licensing exposure. External
// stock video / music / image vetting is a SEPARATE queued gate (company/DECISIONS
// 2026-06-14): those categories are present but intentionally empty here.
//
// Invariant note (CLAUDE.md "preview == export"): a `StockItem` is NOT a new
// project construct. When the user adds a background we RENDER it to a PNG Blob in
// the browser and run it through the EXISTING upload pipeline (presign → PUT →
// confirm), so it becomes an ordinary image asset that already previews (canvas
// drawImage) and exports (asset:<id> input) identically. The library never touches
// `packages/project-schema` or `packages/ffmpeg-graph`.
// ─────────────────────────────────────────────────────────────────────────────

/** What a catalogue entry resolves to when added to a project. */
export type StockKind = 'background' | 'element' | 'music' | 'video' | 'image';

/**
 * License provenance for a catalogue entry.
 *  • 'generated' — synthesised on-device from a pure descriptor (no external bytes).
 *  • 'cc0'       — public-domain content (reserved for the future content gate).
 */
export type StockLicense = 'cc0' | 'generated';

/** A solid-fill background descriptor (rendered client-side to a PNG). */
export interface SolidSource {
  type: 'solid';
  /** #RRGGBB fill. */
  color: string;
}

/** A linear-gradient background descriptor (rendered client-side to a PNG). */
export interface GradientSource {
  type: 'gradient';
  /** Ordered color stops (#RRGGBB), drawn evenly across the gradient line. */
  stops: string[];
  /** Gradient angle in degrees, clockwise from the +x axis. Default 135 (top-left → bottom-right). */
  angleDeg: number;
}

/** Where a stock item's pixels come from. Generated items carry a pure descriptor. */
export type StockSource = SolidSource | GradientSource;

export interface StockItem {
  id: string;
  kind: StockKind;
  title: string;
  tags: string[];
  license: StockLicense;
  /** Required for cc0 content; omitted for purely generated content. */
  attribution?: string;
  /** The pixel source. Present for generated items; absent placeholders await the content gate. */
  source?: StockSource;
}

// ── The catalogue ────────────────────────────────────────────────────────────
// Palette is dark-theme-first and brand-consistent: deep neutrals, ink/charcoal,
// sky-blue (the selection hue), teal and slate. We deliberately AVOID Canva-style
// purple, and avoid amber #FF7A1A as a fill (amber is reserved for the Export CTA).

const SOLID_BACKGROUNDS: StockItem[] = [
  { id: 'bg-solid-ink',     kind: 'background', title: 'Ink',          tags: ['solid', 'dark', 'neutral'],  license: 'generated', source: { type: 'solid', color: '#0B0E14' } },
  { id: 'bg-solid-charcoal',kind: 'background', title: 'Charcoal',     tags: ['solid', 'dark', 'neutral'],  license: 'generated', source: { type: 'solid', color: '#161A22' } },
  { id: 'bg-solid-slate',   kind: 'background', title: 'Slate',        tags: ['solid', 'neutral', 'gray'],  license: 'generated', source: { type: 'solid', color: '#283143' } },
  { id: 'bg-solid-fog',     kind: 'background', title: 'Fog',          tags: ['solid', 'light', 'neutral'], license: 'generated', source: { type: 'solid', color: '#E7ECF3' } },
  { id: 'bg-solid-sky',     kind: 'background', title: 'Sky',          tags: ['solid', 'blue', 'accent'],   license: 'generated', source: { type: 'solid', color: '#2E90FA' } },
  { id: 'bg-solid-teal',    kind: 'background', title: 'Teal',         tags: ['solid', 'teal', 'cool'],     license: 'generated', source: { type: 'solid', color: '#0E7C86' } },
  { id: 'bg-solid-forest',  kind: 'background', title: 'Forest',       tags: ['solid', 'green', 'cool'],    license: 'generated', source: { type: 'solid', color: '#117A4F' } },
  { id: 'bg-solid-rose',    kind: 'background', title: 'Rose',         tags: ['solid', 'warm', 'pink'],     license: 'generated', source: { type: 'solid', color: '#C84A6A' } },
];

const GRADIENT_BACKGROUNDS: StockItem[] = [
  { id: 'bg-grad-midnight', kind: 'background', title: 'Midnight',     tags: ['gradient', 'dark', 'blue'],   license: 'generated', source: { type: 'gradient', stops: ['#0B0E14', '#1E2A44'], angleDeg: 135 } },
  { id: 'bg-grad-dusk',     kind: 'background', title: 'Dusk',         tags: ['gradient', 'dark', 'cool'],   license: 'generated', source: { type: 'gradient', stops: ['#161A22', '#2E90FA'], angleDeg: 135 } },
  { id: 'bg-grad-tide',     kind: 'background', title: 'Tide',         tags: ['gradient', 'blue', 'teal'],   license: 'generated', source: { type: 'gradient', stops: ['#0E7C86', '#2E90FA'], angleDeg: 120 } },
  { id: 'bg-grad-aurora',   kind: 'background', title: 'Aurora',       tags: ['gradient', 'green', 'teal'],  license: 'generated', source: { type: 'gradient', stops: ['#0E7C86', '#117A4F'], angleDeg: 110 } },
  { id: 'bg-grad-ember',    kind: 'background', title: 'Ember',        tags: ['gradient', 'warm', 'rose'],   license: 'generated', source: { type: 'gradient', stops: ['#3A1726', '#C84A6A'], angleDeg: 130 } },
  { id: 'bg-grad-slate',    kind: 'background', title: 'Steel',        tags: ['gradient', 'neutral', 'gray'],license: 'generated', source: { type: 'gradient', stops: ['#283143', '#0B0E14'], angleDeg: 160 } },
  { id: 'bg-grad-frost',    kind: 'background', title: 'Frost',        tags: ['gradient', 'light', 'cool'],  license: 'generated', source: { type: 'gradient', stops: ['#E7ECF3', '#9BB7D4'], angleDeg: 135 } },
  { id: 'bg-grad-ink-sky',  kind: 'background', title: 'Ink to Sky',   tags: ['gradient', 'dark', 'blue'],   license: 'generated', source: { type: 'gradient', stops: ['#0B0E14', '#283143', '#2E90FA'], angleDeg: 145 } },
];

/**
 * The full library seed. Backgrounds are live (generated, zero-license-risk).
 * Music / video / image-stock are deferred to the content/license gate — they are
 * represented by the empty `STOCK_CATEGORIES` states, not by placeholder rows here.
 */
export const STOCK_LIBRARY: StockItem[] = [
  ...SOLID_BACKGROUNDS,
  ...GRADIENT_BACKGROUNDS,
];

/** A media-library tab/category and its current contents. */
export interface StockCategory {
  /** Which MediaPanel tab surfaces this category. */
  tab: 'stock' | 'elements';
  /** Which kinds of item belong to this category. */
  kinds: StockKind[];
  /** Copy shown when the category has no live content yet (awaiting the gate). */
  comingSoon: string;
}

/**
 * The category map the panels render. `stock` currently shows backgrounds; music
 * and video stock are honestly "coming soon" pending the license gate. `elements`
 * is empty because shapes/stickers cannot yet export (buildFilterComplex omits
 * image/shape/lottie/sticker overlays — see its header note), so adding them would
 * break the preview == export invariant.
 */
export const STOCK_CATEGORIES: Record<'stock' | 'elements', StockCategory> = {
  stock: {
    tab: 'stock',
    kinds: ['background', 'video', 'music', 'image'],
    comingSoon: 'Curated CC0 video & music coming soon.',
  },
  elements: {
    tab: 'elements',
    kinds: ['element'],
    comingSoon: 'Curated CC0 shapes & stickers coming soon.',
  },
};

/** Items for a given tab (only the generated, exportable ones are live today). */
export function stockItemsForTab(tab: 'stock' | 'elements'): StockItem[] {
  const kinds = new Set(STOCK_CATEGORIES[tab].kinds);
  return STOCK_LIBRARY.filter((i) => kinds.has(i.kind) && i.source !== undefined);
}

// ── Client-side rasterisation (pure-ish; uses the DOM canvas) ──────────────────

/** Default export dimensions for a generated background PNG (16:9, 1080p-friendly). */
export const BACKGROUND_RENDER_SIZE = { width: 1920, height: 1080 } as const;

/** Parse a CSS hex color (#RGB / #RRGGBB) to an `#RRGGBB` string usable by canvas. */
function normalizeHex(hex: string): string {
  const c = hex.replace(/^#/, '');
  if (c.length === 3) return `#${c[0]}${c[0]}${c[1]}${c[1]}${c[2]}${c[2]}`;
  return `#${c.slice(0, 6)}`;
}

/**
 * Paint a generated background `StockSource` onto a 2D canvas context at (w × h).
 * Pure with respect to the descriptor — the same descriptor always paints the same
 * pixels, which is why the rendered PNG is reproducible / dedup-friendly.
 */
export function paintBackground(
  ctx: CanvasRenderingContext2D,
  source: StockSource,
  width: number,
  height: number,
): void {
  if (source.type === 'solid') {
    ctx.fillStyle = normalizeHex(source.color);
    ctx.fillRect(0, 0, width, height);
    return;
  }
  // Gradient: map angle → a line across the canvas box.
  const rad = (source.angleDeg * Math.PI) / 180;
  const cx = width / 2;
  const cy = height / 2;
  const halfLen = (Math.abs(width * Math.cos(rad)) + Math.abs(height * Math.sin(rad))) / 2;
  const dx = Math.cos(rad) * halfLen;
  const dy = Math.sin(rad) * halfLen;
  const grad = ctx.createLinearGradient(cx - dx, cy - dy, cx + dx, cy + dy);
  const stops = source.stops.length > 1 ? source.stops : [source.stops[0] ?? '#000000', source.stops[0] ?? '#000000'];
  stops.forEach((stop, i) => grad.addColorStop(i / (stops.length - 1), normalizeHex(stop)));
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, width, height);
}

/**
 * Render a generated background item to a PNG `File` (via canvas.toBlob), ready to
 * feed straight into the existing upload pipeline. Throws if the item has no
 * generatable source or the canvas can't produce a blob.
 */
export async function renderBackgroundToFile(
  item: StockItem,
  size: { width: number; height: number } = BACKGROUND_RENDER_SIZE,
): Promise<File> {
  if (!item.source) throw new Error(`Stock item "${item.id}" has no generatable source`);
  const canvas = document.createElement('canvas');
  canvas.width = size.width;
  canvas.height = size.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas context unavailable');
  paintBackground(ctx, item.source, size.width, size.height);

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob((b) => resolve(b), 'image/png'),
  );
  if (!blob) throw new Error('canvas.toBlob produced no blob');
  // Deterministic, descriptive filename so the asset reads sensibly in the library.
  return new File([blob], `${item.id}.png`, { type: 'image/png' });
}

/** A small inline CSS background for thumbnails (no network, no pixels rendered). */
export function thumbnailCss(item: StockItem): string {
  const src = item.source;
  if (!src) return '#11151c';
  if (src.type === 'solid') return normalizeHex(src.color);
  const stops = src.stops.map(normalizeHex).join(', ');
  return `linear-gradient(${src.angleDeg}deg, ${stops})`;
}
