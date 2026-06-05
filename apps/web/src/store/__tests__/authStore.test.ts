import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// authStore tests — login/signup/logout/restore via mocked lib/api.js.
// We mock the api module so the store logic is exercised without a network.

const api = vi.hoisted(() => ({
  apiLogin: vi.fn(),
  apiSignup: vi.fn(),
  apiLogout: vi.fn(),
  refreshSession: vi.fn(),
  onNeedsLogin: vi.fn(() => () => {}),
}));

vi.mock("../../lib/api.js", () => api);

import { useAuthStore } from "../authStore.js";

const USER = { id: "u1", email: "a@b.com", displayName: "Ann" };

beforeEach(() => {
  useAuthStore.setState({ user: null, initializing: true });
  api.apiLogin.mockReset();
  api.apiSignup.mockReset();
  api.apiLogout.mockReset();
  api.refreshSession.mockReset();
});

afterEach(() => vi.clearAllMocks());

describe("authStore login happy-path", () => {
  it("sets user and clears initializing on a successful login", async () => {
    api.apiLogin.mockResolvedValue({ accessToken: "t", user: USER });
    await useAuthStore.getState().login("a@b.com", "password123");
    expect(api.apiLogin).toHaveBeenCalledWith({ email: "a@b.com", password: "password123" });
    expect(useAuthStore.getState().user).toEqual(USER);
    expect(useAuthStore.getState().initializing).toBe(false);
  });

  it("propagates login errors (so the screen can show them) and leaves user null", async () => {
    api.apiLogin.mockRejectedValue(new Error("InvalidCredentials"));
    await expect(useAuthStore.getState().login("a@b.com", "nope")).rejects.toThrow();
    expect(useAuthStore.getState().user).toBeNull();
  });
});

describe("authStore signup happy-path", () => {
  it("forwards an optional displayName and sets the user", async () => {
    api.apiSignup.mockResolvedValue({ accessToken: "t", user: USER });
    await useAuthStore.getState().signup("a@b.com", "password123", "Ann");
    expect(api.apiSignup).toHaveBeenCalledWith({
      email: "a@b.com",
      password: "password123",
      displayName: "Ann",
    });
    expect(useAuthStore.getState().user).toEqual(USER);
  });

  it("omits displayName when not provided", async () => {
    api.apiSignup.mockResolvedValue({ accessToken: "t", user: USER });
    await useAuthStore.getState().signup("a@b.com", "password123");
    expect(api.apiSignup).toHaveBeenCalledWith({ email: "a@b.com", password: "password123" });
  });
});

describe("authStore logout clears session", () => {
  it("nulls the user after logout", async () => {
    useAuthStore.setState({ user: USER, initializing: false });
    api.apiLogout.mockResolvedValue(undefined);
    await useAuthStore.getState().logout();
    expect(api.apiLogout).toHaveBeenCalled();
    expect(useAuthStore.getState().user).toBeNull();
  });
});
