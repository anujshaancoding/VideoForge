// ─────────────────────────────────────────────────────────────────────────────
// Undo/redo via Immer patches (enablePatches).
//
// The editor store mutates the project draft through Immer; every mutation that
// should be undoable is run through `recordedProduce`, which captures the forward
// patches and their inverse. Patches are far cheaper than full-document snapshots
// for a large project doc, and `applyPatches` makes undo/redo a constant-time
// patch replay rather than a structural diff.
//
// The stack is capped (default 200, per the contract) on the UNDO side; the redo
// side is cleared whenever a fresh recorded mutation lands (standard linear
// history semantics).
// ─────────────────────────────────────────────────────────────────────────────

import { applyPatches, enablePatches, produceWithPatches, type Patch } from "immer";

// Patch recording is opt-in in Immer; enable it once at module load.
enablePatches();

/** One undoable step: the forward patches and the inverse to undo it. */
export interface HistoryEntry {
  patches: Patch[];
  inverse: Patch[];
}

/** Linear undo/redo history of patch pairs. */
export interface History {
  past: HistoryEntry[];
  future: HistoryEntry[];
  /** Max retained undo entries (oldest dropped past this). */
  limit: number;
}

export function createHistory(limit = 200): History {
  return { past: [], future: [], limit };
}

export function canUndo(history: History): boolean {
  return history.past.length > 0;
}

export function canRedo(history: History): boolean {
  return history.future.length > 0;
}

/**
 * Apply `recipe` to `base`, returning the next state plus the recorded
 * {@link HistoryEntry}. The caller decides whether to push the entry (skip it for
 * no-op recipes that produced no patches).
 */
export function recordedProduce<T>(
  base: T,
  recipe: (draft: T) => void,
): { next: T; entry: HistoryEntry } {
  const [next, patches, inverse] = produceWithPatches(base, recipe);
  return { next: next as T, entry: { patches: [...patches], inverse: [...inverse] } };
}

/** Push a new undoable entry, clearing redo and enforcing the cap. */
export function pushHistory(history: History, entry: HistoryEntry): History {
  if (entry.patches.length === 0) return history; // no-op — don't pollute the stack
  const past = [...history.past, entry];
  // Drop oldest entries beyond the cap (FIFO on the past stack).
  while (past.length > history.limit) past.shift();
  return { past, future: [], limit: history.limit };
}

export interface ApplyResult<T> {
  state: T;
  history: History;
}

/** Replay the most recent inverse patch set; move it onto the redo stack. */
export function undo<T>(state: T, history: History): ApplyResult<T> {
  const entry = history.past[history.past.length - 1];
  if (!entry) return { state, history };
  const nextState = applyPatches(state as object, entry.inverse) as T;
  return {
    state: nextState,
    history: {
      ...history,
      past: history.past.slice(0, -1),
      future: [...history.future, entry],
    },
  };
}

/** Replay the most recent redo entry's forward patches. */
export function redo<T>(state: T, history: History): ApplyResult<T> {
  const entry = history.future[history.future.length - 1];
  if (!entry) return { state, history };
  const nextState = applyPatches(state as object, entry.patches) as T;
  return {
    state: nextState,
    history: {
      ...history,
      past: [...history.past, entry],
      future: history.future.slice(0, -1),
    },
  };
}
