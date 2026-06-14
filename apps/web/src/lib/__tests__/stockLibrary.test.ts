import { describe, it, expect } from "vitest";
import {
  STOCK_LIBRARY,
  STOCK_CATEGORIES,
  stockItemsForTab,
  thumbnailCss,
  paintBackground,
  type StockItem,
} from "../stockLibrary.js";

// The stock library is the CC0 / zero-license-risk scaffold. These tests pin the
// invariant-relevant contract: every live item is GENERATED (no third-party bytes),
// has a generatable source, and resolves to a brand-safe thumbnail CSS — and the
// "coming soon" categories stay honestly empty until the content/license gate.

describe("STOCK_LIBRARY seed", () => {
  it("is non-empty and contains only generated, zero-license-risk content", () => {
    expect(STOCK_LIBRARY.length).toBeGreaterThan(0);
    for (const item of STOCK_LIBRARY) {
      // No external/CC0 media is bundled in this scaffold — generated only.
      expect(item.license).toBe("generated");
      // A generated item must carry a pure descriptor we can rasterise on-device.
      expect(item.source).toBeDefined();
    }
  });

  it("has unique ids", () => {
    const ids = STOCK_LIBRARY.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("never uses the reserved Export-CTA amber as a background fill", () => {
    const hexes = STOCK_LIBRARY.flatMap((i) =>
      i.source?.type === "solid"
        ? [i.source.color]
        : i.source?.type === "gradient"
          ? i.source.stops
          : [],
    ).map((h) => h.toUpperCase());
    expect(hexes).not.toContain("#FF7A1A");
  });
});

describe("stockItemsForTab", () => {
  it("returns only items with a generatable source for the stock tab", () => {
    const items = stockItemsForTab("stock");
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((i) => i.source !== undefined)).toBe(true);
  });

  it("returns nothing for the elements tab (deferred to the license gate)", () => {
    expect(stockItemsForTab("elements")).toEqual([]);
  });

  it("exposes an honest coming-soon note per category", () => {
    expect(STOCK_CATEGORIES.stock.comingSoon).toMatch(/coming soon/i);
    expect(STOCK_CATEGORIES.elements.comingSoon).toMatch(/coming soon/i);
  });
});

describe("thumbnailCss", () => {
  it("renders a solid color and a linear-gradient", () => {
    const solid = STOCK_LIBRARY.find((i) => i.source?.type === "solid")!;
    const grad = STOCK_LIBRARY.find((i) => i.source?.type === "gradient")!;
    expect(thumbnailCss(solid)).toMatch(/^#[0-9a-fA-F]{6}$/);
    expect(thumbnailCss(grad)).toMatch(/^linear-gradient\(/);
  });
});

describe("paintBackground", () => {
  it("fills a solid color across the canvas box", () => {
    const calls: Array<[number, number, number, number]> = [];
    const ctx = {
      set fillStyle(_v: unknown) {},
      fillRect: (...a: [number, number, number, number]) => calls.push(a),
      createLinearGradient: () => ({ addColorStop: () => {} }),
    } as unknown as CanvasRenderingContext2D;
    const item: StockItem = {
      id: "x",
      kind: "background",
      title: "x",
      tags: [],
      license: "generated",
      source: { type: "solid", color: "#123456" },
    };
    paintBackground(ctx, item.source!, 100, 50);
    expect(calls).toContainEqual([0, 0, 100, 50]);
  });
});
