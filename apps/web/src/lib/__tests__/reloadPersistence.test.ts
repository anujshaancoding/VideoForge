import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { sampleProject, type Project } from "@videoforge/project-schema";

// ─────────────────────────────────────────────────────────────────────────────
// Reload-persistence regression test — the "settings vanish on reload" fix.
//
// Simulates the full reload path against a MOCKED backend (globalThis.fetch), so
// the REAL api.ts / projectStore.ts / useAutosave.ts / editorStore.ts run together:
//
//   1. edit → reload → state restored:
//        • boot refresh restores a session (sets the in-memory access token)
//        • GET /projects/:id returns the SAVED document → store hydrates from it
//        • an edit triggers autosave → PATCH /projects/:id with the EDITED doc
//        • Ctrl/Cmd+S (saveNow) flushes an immediate save
//
//   2. a transient 401 BEFORE refresh does NOT wipe the document:
//        • GET 401s (and the single silent refresh also 401s) → getProject REJECTS
//          (it must NOT fall back to a seeded/stale localStorage doc)
//        • autosave stays DISARMED → no PATCH is sent, so the server doc is intact
// ─────────────────────────────────────────────────────────────────────────────

import {
  setAccessToken,
  refreshSession,
  hasSession,
  ApiError,
} from "../api.js";
import { getProject, saveProject } from "../projectStore.js";
import {
  useAutosave,
  armAutosave,
  disarmAutosave,
  saveNow,
} from "../useAutosave.js";
import { useEditorStore } from "../../store/editorStore.js";

// ── fetch mock plumbing ─────────────────────────────────────────────────────────

interface MockRes {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
  text: () => Promise<string>;
}
function res(status: number, body: unknown): MockRes {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

const PROJECT_ID = sampleProject.id;
const USER = { id: "u1", email: "creator@studio.com", displayName: "Creator" };

/** The document "saved on the server" — sampleProject at revision 7. */
function serverDoc(): Project {
  return { ...structuredClone(sampleProject), revision: 7 } as Project;
}

beforeEach(() => {
  setAccessToken(null);
  disarmAutosave();
  localStorage.clear();
  // Reset the editor store to the seed (mimics a fresh page load).
  useEditorStore.setState({ project: structuredClone(sampleProject) as Project });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  setAccessToken(null);
  disarmAutosave();
  localStorage.clear();
});

// ── 1) edit → reload → restored ──────────────────────────────────────────────────

describe("edit → reload → state restored", () => {
  it("restores the session, hydrates the store from the saved GET, and autosaves the edit", async () => {
    // The PATCH bodies the client sends — asserted at the end.
    const patches: Array<{ document: Project; baseRevision: number }> = [];

    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const path = String(url).replace(/^.*\/api\/v1/, "");
      const method = init?.method ?? "GET";
      if (path === "/auth/refresh" && method === "POST") {
        return res(200, { accessToken: "fresh-token", user: USER });
      }
      if (path === `/projects/${PROJECT_ID}` && method === "GET") {
        return res(200, {
          id: PROJECT_ID,
          name: "Summer Sale Promo",
          document: serverDoc(),
          revision: 7,
          createdAt: "t",
          updatedAt: "t",
        });
      }
      if (path === `/projects/${PROJECT_ID}` && method === "PATCH") {
        const body = JSON.parse(init!.body as string) as { document: Project; baseRevision: number };
        patches.push(body);
        return res(200, { revision: body.baseRevision + 1, updatedAt: "t2" });
      }
      return res(500, { error: "unexpected", path, method });
    }) as unknown as typeof fetch;
    globalThis.fetch = fetchMock;

    // ── Boot: restore the session from the refresh cookie (App does this). ──
    const session = await refreshSession();
    expect(session?.user).toEqual(USER);
    expect(hasSession()).toBe(true);

    // ── Editor mount: fetch the saved project and hydrate the store. ──
    const loaded = await getProject(PROJECT_ID);
    expect(loaded).not.toBeNull();
    expect(loaded!.revision).toBe(7);
    act(() => {
      useEditorStore.getState().loadProject(loaded!);
      armAutosave(loaded!.id); // editor arms autosave only after a real hydrate
    });
    // The store now holds the SERVER document, not the bare seed default.
    expect(useEditorStore.getState().project.revision).toBe(7);

    // Mount the autosave hook (StatusBar does this) under fake timers so we can
    // advance the 3s debounce deterministically.
    vi.useFakeTimers();
    const { result, unmount } = renderHook(() => useAutosave());
    expect(result.current).toBe("saved");

    // ── Make an edit (adds a track) → autosave should fire. ──
    act(() => {
      useEditorStore.getState().addTrack("overlay");
    });
    expect(result.current).toBe("unsaved");

    // Advance the debounce; flush the resulting async save.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });

    expect(patches).toHaveLength(1);
    expect(patches[0]!.baseRevision).toBe(7);
    // The PATCH carried the EDITED document (the new overlay track), not the seed.
    const sentTrackKinds = patches[0]!.document.tracks.map((t) => t.type);
    expect(sentTrackKinds.filter((k) => k === "overlay").length).toBeGreaterThanOrEqual(2);
    expect(result.current).toBe("saved");
    // The store's revision advanced from the PATCH response (7 → 8).
    expect(useEditorStore.getState().project.revision).toBe(8);

    // ── Ctrl/Cmd+S (saveNow) flushes an immediate save of a fresh edit. ──
    act(() => {
      useEditorStore.getState().addTrack("audio");
    });
    act(() => {
      saveNow();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(patches).toHaveLength(2);
    expect(patches[1]!.baseRevision).toBe(8);

    unmount();
  });

  it("flushes a pending debounced save on page hide with keepalive (last edits survive reload)", async () => {
    const seen: Array<{ method: string; keepalive: boolean }> = [];
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const path = String(url).replace(/^.*\/api\/v1/, "");
      const method = init?.method ?? "GET";
      if (path === "/auth/refresh") return res(200, { accessToken: "fresh-token", user: USER });
      if (path === `/projects/${PROJECT_ID}` && method === "PATCH") {
        seen.push({ method, keepalive: init?.keepalive === true });
        return res(200, { revision: 8, updatedAt: "t" });
      }
      return res(500, {});
    }) as unknown as typeof fetch;
    globalThis.fetch = fetchMock;

    await refreshSession();
    act(() => {
      useEditorStore.getState().loadProject(serverDoc());
      armAutosave(PROJECT_ID);
    });

    vi.useFakeTimers();
    const { unmount } = renderHook(() => useAutosave());

    // Edit, then hide the tab BEFORE the 3s debounce elapses.
    act(() => {
      useEditorStore.getState().addTrack("overlay");
    });
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(seen).toHaveLength(1);
    expect(seen[0]!.keepalive).toBe(true); // survives the unload
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
    unmount();
  });
});

// ── 2) transient 401 before refresh must NOT wipe the saved document ──────────────

describe("transient 401 before refresh does NOT wipe the saved document", () => {
  it("getProject rejects (no stale fallback) so autosave stays disarmed and never PATCHes", async () => {
    // Simulate the reload auth race: no token yet, and BOTH the GET and its single
    // silent refresh come back 401 (cookie not yet valid / refresh briefly failing).
    let patchCalls = 0;
    let getCalls = 0;
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const path = String(url).replace(/^.*\/api\/v1/, "");
      const method = init?.method ?? "GET";
      if (path === `/projects/${PROJECT_ID}` && method === "GET") {
        getCalls++;
        return res(401, { error: "Unauthorized" });
      }
      if (path === "/auth/refresh" && method === "POST") {
        return res(401, { error: "Unauthorized" }); // refresh also fails (the race)
      }
      if (path === `/projects/${PROJECT_ID}` && method === "PATCH") {
        patchCalls++;
        return res(200, { revision: 99, updatedAt: "t" });
      }
      return res(500, { error: "unexpected", path, method });
    }) as unknown as typeof fetch;
    globalThis.fetch = fetchMock;

    // Pre-seed localStorage with a STALE doc under the same id — the old buggy
    // fallback would have returned this (or a seeded sample) and then saved it back.
    localStorage.setItem(
      "videoforge.projects.v1",
      JSON.stringify({ [PROJECT_ID]: { ...structuredClone(sampleProject), title: "STALE LOCAL" } }),
    );

    // getProject must REJECT on the 401 (server reachable) — never silently return
    // the stale/seeded local doc that would mask the real server document.
    await expect(getProject(PROJECT_ID)).rejects.toBeInstanceOf(ApiError);
    expect(getCalls).toBe(1);

    // The editor would surface a retry and NOT arm autosave. Prove that even with the
    // autosave hook mounted and an edit applied, nothing is PATCHed while disarmed.
    expect(hasSession()).toBe(false);
    disarmAutosave();
    useEditorStore.setState({ project: structuredClone(sampleProject) as Project });

    vi.useFakeTimers();
    const { unmount } = renderHook(() => useAutosave());
    act(() => {
      // An edit to the (unhydrated) seed must not be persisted: autosave is disarmed.
      useEditorStore.getState().addTrack("overlay");
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(patchCalls).toBe(0); // server document was never overwritten

    unmount();
  });

  it("saveProject rethrows a server-reachable failure instead of silently writing local", async () => {
    setAccessToken("tok"); // a live session, but the PATCH itself fails server-side
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const path = String(url).replace(/^.*\/api\/v1/, "");
      const method = init?.method ?? "GET";
      if (path === `/projects/${PROJECT_ID}` && method === "PATCH") {
        return res(409, { error: "RevisionConflict" });
      }
      if (path === "/auth/refresh") return res(401, {});
      return res(500, {});
    }) as unknown as typeof fetch;
    globalThis.fetch = fetchMock;

    await expect(saveProject(serverDoc(), 7)).rejects.toBeInstanceOf(ApiError);
    // It must NOT have masked the failure by writing to localStorage.
    expect(localStorage.getItem("videoforge.projects.v1")).toBeNull();
  });
});

// ── 3) genuine offline still falls back to localStorage ───────────────────────────

describe("genuine offline still uses the localStorage fallback", () => {
  it("getProject returns the local doc and saveProject writes locally on a network error", async () => {
    setAccessToken("tok");
    // A network failure throws a native TypeError (not an ApiError) — that's offline.
    globalThis.fetch = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    }) as unknown as typeof fetch;

    const local = { ...structuredClone(sampleProject), title: "OFFLINE COPY" } as Project;
    localStorage.setItem("videoforge.projects.v1", JSON.stringify({ [PROJECT_ID]: local }));

    const got = await getProject(PROJECT_ID);
    expect(got?.title).toBe("OFFLINE COPY");

    // Save while offline → persists to localStorage, no throw.
    const edited = { ...local, title: "OFFLINE EDIT" } as Project;
    await expect(saveProject(edited, 1)).resolves.toBeTruthy();
    const raw = JSON.parse(localStorage.getItem("videoforge.projects.v1")!) as Record<string, Project>;
    expect(raw[PROJECT_ID]!.title).toBe("OFFLINE EDIT");
  });
});
