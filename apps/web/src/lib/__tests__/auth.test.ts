import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  apiSignup,
  apiLogin,
  apiLogout,
  apiCreateExport,
  apiListProjects,
  getAccessToken,
  setAccessToken,
  refreshSession,
  onNeedsLogin,
  ApiError,
} from "../api.js";

// ─────────────────────────────────────────────────────────────────────────────
// Auth-aware api client tests (Wave 2):
//   • signup happy-path     → stores access token, returns {accessToken,user}
//   • login happy-path      → stores access token, sends Bearer + credentials
//   • 401 → refresh → retry → a protected GET retries once with the new token
//   • logout clears the in-memory session
//   • 429 from exports surfaces the friendly "exporting too fast" message
// ─────────────────────────────────────────────────────────────────────────────

interface MockRes {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
  text: () => Promise<string>;
}

function jsonRes(status: number, body: unknown): MockRes {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

const SESSION = {
  accessToken: "access-123",
  user: { id: "u1", email: "a@b.com", displayName: "Ann" },
};

beforeEach(() => {
  setAccessToken(null);
});

afterEach(() => {
  vi.restoreAllMocks();
  setAccessToken(null);
});

describe("signup happy-path", () => {
  it("returns the session and stores the access token in memory", async () => {
    const fetchMock = vi.fn(async () => jsonRes(201, SESSION)) as unknown as typeof fetch;
    globalThis.fetch = fetchMock;

    const session = await apiSignup({ email: "a@b.com", password: "password123", displayName: "Ann" });

    expect(session).toEqual(SESSION);
    expect(getAccessToken()).toBe("access-123");

    const [url, init] = (fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(String(url)).toMatch(/\/auth\/signup$/);
    expect((init as RequestInit).method).toBe("POST");
    expect((init as RequestInit).credentials).toBe("include");
    expect(JSON.parse((init as RequestInit).body as string)).toMatchObject({
      email: "a@b.com",
      displayName: "Ann",
    });
  });
});

describe("login happy-path", () => {
  it("stores the token and sends credentials:include", async () => {
    const fetchMock = vi.fn(async () => jsonRes(200, SESSION)) as unknown as typeof fetch;
    globalThis.fetch = fetchMock;

    const session = await apiLogin({ email: "a@b.com", password: "password123" });

    expect(session.user.email).toBe("a@b.com");
    expect(getAccessToken()).toBe("access-123");
    const [, init] = (fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect((init as RequestInit).credentials).toBe("include");
  });

  it("throws an ApiError with code InvalidCredentials on 401", async () => {
    const fetchMock = vi.fn(async () => jsonRes(401, { error: "InvalidCredentials" })) as unknown as typeof fetch;
    globalThis.fetch = fetchMock;

    await expect(apiLogin({ email: "a@b.com", password: "wrong" })).rejects.toMatchObject({
      status: 401,
      code: "InvalidCredentials",
    });
    // /auth/* paths never trigger the refresh-retry, so exactly one call is made.
    expect((fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);
  });
});

describe("401 → refresh → retry on a protected request", () => {
  it("refreshes once and replays the original request with the new token", async () => {
    setAccessToken("stale-token");
    const calls: Array<{ path: string; auth: string | undefined }> = [];

    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      const path = url.replace(/^.*\/api\/v1/, "");
      const auth = (init.headers as Record<string, string>)?.["Authorization"];
      calls.push({ path, auth });

      if (path === "/projects" && auth === "Bearer stale-token") return jsonRes(401, { error: "Unauthorized" });
      if (path === "/auth/refresh") return jsonRes(200, { accessToken: "fresh-token", user: SESSION.user });
      if (path === "/projects" && auth === "Bearer fresh-token") return jsonRes(200, { items: [{ id: "p1" }] });
      return jsonRes(500, {});
    }) as unknown as typeof fetch;
    globalThis.fetch = fetchMock;

    const items = await apiListProjects();

    expect(items).toEqual([{ id: "p1" }]);
    expect(calls.map((c) => c.path)).toEqual(["/projects", "/auth/refresh", "/projects"]);
    expect(calls[2]!.auth).toBe("Bearer fresh-token");
    expect(getAccessToken()).toBe("fresh-token");
  });

  it("emits needs-login and does NOT loop when refresh also fails", async () => {
    setAccessToken("stale-token");
    const needsLogin = vi.fn();
    const off = onNeedsLogin(needsLogin);

    let projectsCalls = 0;
    let refreshCalls = 0;
    const fetchMock = vi.fn(async (url: string) => {
      const path = String(url).replace(/^.*\/api\/v1/, "");
      if (path === "/projects") {
        projectsCalls++;
        return jsonRes(401, { error: "Unauthorized" });
      }
      if (path === "/auth/refresh") {
        refreshCalls++;
        return jsonRes(401, {});
      }
      return jsonRes(500, {});
    }) as unknown as typeof fetch;
    globalThis.fetch = fetchMock;

    await expect(apiListProjects()).rejects.toBeInstanceOf(ApiError);

    expect(needsLogin).toHaveBeenCalledTimes(1);
    expect(refreshCalls).toBe(1); // exactly one refresh attempt
    expect(projectsCalls).toBe(1); // original request NOT replayed after failed refresh
    expect(getAccessToken()).toBeNull();
    off();
  });
});

describe("logout clears the session", () => {
  it("drops the in-memory token even after the network call resolves", async () => {
    setAccessToken("access-123");
    const fetchMock = vi.fn(async () => jsonRes(200, {})) as unknown as typeof fetch;
    globalThis.fetch = fetchMock;

    await apiLogout();

    expect(getAccessToken()).toBeNull();
    const [url] = (fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(String(url)).toMatch(/\/auth\/logout$/);
  });
});

describe("refresh failure on boot", () => {
  it("returns null and clears the token without throwing", async () => {
    setAccessToken("whatever");
    globalThis.fetch = vi.fn(async () => jsonRes(401, {})) as unknown as typeof fetch;
    const session = await refreshSession();
    expect(session).toBeNull();
    expect(getAccessToken()).toBeNull();
  });
});

describe("429 friendly message from exports", () => {
  it("surfaces the 'exporting too fast' message, not a raw crash", async () => {
    setAccessToken("access-123");
    globalThis.fetch = vi.fn(async () => jsonRes(429, { error: "RateLimited" })) as unknown as typeof fetch;

    const err = await apiCreateExport({ projectId: "p1", settings: {} }).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(429);
    expect((err as ApiError).message).toMatch(/exporting too fast/i);
  });
});
