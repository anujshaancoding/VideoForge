import { describe, it, expect } from "vitest";
import {
  createHistory,
  recordedProduce,
  pushHistory,
  canUndo,
  canRedo,
  undo,
  redo,
} from "../history.js";

// history.ts is pure (Immer patch stack). These tests pin the linear undo/redo
// semantics the store relies on: cap enforcement, redo-clearing, and round-trip.

interface Doc {
  n: number;
  items: string[];
}

const base: Doc = { n: 0, items: [] };

describe("recordedProduce", () => {
  it("captures forward + inverse patches for a mutation", () => {
    const { next, entry } = recordedProduce(base, (d) => {
      d.n = 5;
    });
    expect(next.n).toBe(5);
    expect(base.n).toBe(0); // original untouched (immer is immutable)
    expect(entry.patches.length).toBeGreaterThan(0);
    expect(entry.inverse.length).toBeGreaterThan(0);
  });

  it("produces no patches for a no-op recipe", () => {
    const { entry } = recordedProduce(base, () => {
      /* touch nothing */
    });
    expect(entry.patches).toHaveLength(0);
  });
});

describe("pushHistory", () => {
  it("appends an entry, sets canUndo, and clears redo (future)", () => {
    let h = createHistory(10);
    const { entry } = recordedProduce(base, (d) => {
      d.n = 1;
    });
    // Seed a future entry to prove it is cleared.
    h = { ...h, future: [entry] };
    h = pushHistory(h, entry);
    expect(h.past).toHaveLength(1);
    expect(h.future).toHaveLength(0);
    expect(canUndo(h)).toBe(true);
    expect(canRedo(h)).toBe(false);
  });

  it("skips no-op entries (empty patches) so they never pollute the stack", () => {
    const h = createHistory(10);
    const { entry } = recordedProduce(base, () => {});
    const after = pushHistory(h, entry);
    expect(after.past).toHaveLength(0);
  });

  it("enforces the cap by dropping the oldest entry (FIFO)", () => {
    let h = createHistory(3);
    for (let i = 1; i <= 5; i++) {
      const { entry } = recordedProduce(base, (d) => {
        d.n = i;
      });
      h = pushHistory(h, entry);
    }
    expect(h.past).toHaveLength(3); // capped at limit
  });
});

describe("undo / redo round-trip", () => {
  it("undo replays the inverse patch and redo replays the forward patch", () => {
    let h = createHistory(10);
    const step1 = recordedProduce(base, (d) => {
      d.n = 1;
      d.items.push("a");
    });
    h = pushHistory(h, step1.entry);
    const state = step1.next;

    expect(state).toEqual({ n: 1, items: ["a"] });

    const undone = undo(state, h);
    expect(undone.state).toEqual({ n: 0, items: [] });
    expect(canRedo(undone.history)).toBe(true);
    expect(canUndo(undone.history)).toBe(false);

    const redone = redo(undone.state, undone.history);
    expect(redone.state).toEqual({ n: 1, items: ["a"] });
    expect(canUndo(redone.history)).toBe(true);
    expect(canRedo(redone.history)).toBe(false);
  });

  it("undo on an empty stack is a safe no-op", () => {
    const h = createHistory(10);
    const result = undo(base, h);
    expect(result.state).toBe(base);
    expect(result.history).toBe(h);
  });

  it("redo on an empty future stack is a safe no-op", () => {
    const h = createHistory(10);
    const result = redo(base, h);
    expect(result.state).toBe(base);
  });
});
