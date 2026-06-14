import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { apiConfirmUpload, apiPresign, apiDuplicateProject } from "../api.js";

// Regression guard for the upload "stuck at 100%" bug: body-less POSTs (asset
// confirm, project duplicate) must NOT send `Content-Type: application/json`,
// because Fastify rejects an empty JSON body (FST_ERR_CTP_EMPTY_JSON_BODY → 400),
// which left confirmed uploads stuck. Body-ful requests still send the JSON type.

function mockFetch(json: unknown = {}) {
  const fn = vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => json,
    text: async () => JSON.stringify(json),
  })) as unknown as typeof fetch;
  globalThis.fetch = fn;
  return fn as unknown as ReturnType<typeof vi.fn>;
}

const headersOf = (init: RequestInit | undefined) =>
  (init?.headers ?? {}) as Record<string, string>;

beforeEach(() => mockFetch());
afterEach(() => vi.restoreAllMocks());

describe("api client request headers", () => {
  it("does NOT set application/json for a body-less confirm POST", async () => {
    const fetchMock = mockFetch({ id: "a1", status: "PROCESSING" });
    await apiConfirmUpload("a1");
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toMatch(/\/assets\/a1\/confirm$/);
    expect((init as RequestInit).method).toBe("POST");
    expect((init as RequestInit).body).toBeUndefined();
    expect(headersOf(init as RequestInit)["Content-Type"]).toBeUndefined();
  });

  it("does NOT set application/json for a body-less duplicate POST", async () => {
    const fetchMock = mockFetch({ id: "p2" });
    await apiDuplicateProject("p1");
    const [, init] = fetchMock.mock.calls[0]!;
    expect(headersOf(init as RequestInit)["Content-Type"]).toBeUndefined();
  });

  it("DOES set application/json when a body is sent (presign)", async () => {
    const fetchMock = mockFetch({ assetId: "x", uploadUrl: "http://u", expiresAt: "" });
    await apiPresign({ filename: "a.mp4", fileSize: 10, contentType: "video/mp4", contentHash: "h" });
    const [, init] = fetchMock.mock.calls[0]!;
    expect((init as RequestInit).body).toBeTruthy();
    expect(headersOf(init as RequestInit)["Content-Type"]).toBe("application/json");
  });
});
