import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

// Auth screen component tests — exercise the real form against a mocked auth store.

const store = vi.hoisted(() => ({
  login: vi.fn(),
  signup: vi.fn(),
}));

vi.mock("../../store/authStore.js", () => ({
  useAuthStore: (sel: (s: { login: typeof store.login; signup: typeof store.signup }) => unknown) =>
    sel({ login: store.login, signup: store.signup }),
}));

const navigate = vi.fn();
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return { ...actual, useNavigate: () => navigate };
});

import { LoginScreen, SignupScreen } from "../AuthScreen.js";

beforeEach(() => {
  store.login.mockReset();
  store.signup.mockReset();
  navigate.mockReset();
});
afterEach(() => vi.clearAllMocks());

describe("LoginScreen", () => {
  it("submits email+password and navigates home on success", async () => {
    store.login.mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }} initialEntries={["/login"]}>
        <LoginScreen />
      </MemoryRouter>,
    );

    await user.type(screen.getByLabelText(/email/i), "a@b.com");
    await user.type(screen.getByLabelText(/^password$/i), "password123");
    await user.click(screen.getByRole("button", { name: /sign in/i }));

    await waitFor(() => expect(store.login).toHaveBeenCalledWith("a@b.com", "password123"));
    expect(navigate).toHaveBeenCalledWith("/", { replace: true });
  });

  it("shows a friendly error on invalid credentials", async () => {
    const { ApiError } = await vi.importActual<typeof import("../../lib/api.js")>("../../lib/api.js");
    store.login.mockRejectedValue(new ApiError("nope", 401, "InvalidCredentials"));
    const user = userEvent.setup();
    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }} initialEntries={["/login"]}>
        <LoginScreen />
      </MemoryRouter>,
    );

    await user.type(screen.getByLabelText(/email/i), "a@b.com");
    await user.type(screen.getByLabelText(/^password$/i), "wrong");
    await user.click(screen.getByRole("button", { name: /sign in/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/incorrect email or password/i);
    expect(navigate).not.toHaveBeenCalled();
  });

  it("the submit button is NOT the amber Export accent (brand rule)", () => {
    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }} initialEntries={["/login"]}>
        <LoginScreen />
      </MemoryRouter>,
    );
    const btn = screen.getByRole("button", { name: /sign in/i });
    // amber primary uses `bg-vf-accent`; auth submit must not.
    expect(btn.className).not.toMatch(/bg-vf-accent\b/);
  });
});

describe("SignupScreen", () => {
  it("submits email, password and optional display name", async () => {
    store.signup.mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }} initialEntries={["/signup"]}>
        <SignupScreen />
      </MemoryRouter>,
    );

    await user.type(screen.getByLabelText(/email/i), "new@b.com");
    await user.type(screen.getByLabelText(/display name/i), "Newbie");
    await user.type(screen.getByLabelText(/^password$/i), "password123");
    await user.click(screen.getByRole("button", { name: /create account/i }));

    await waitFor(() =>
      expect(store.signup).toHaveBeenCalledWith("new@b.com", "password123", "Newbie"),
    );
    expect(navigate).toHaveBeenCalledWith("/", { replace: true });
  });

  it("shows the EmailTaken message on a 409", async () => {
    const { ApiError } = await vi.importActual<typeof import("../../lib/api.js")>("../../lib/api.js");
    store.signup.mockRejectedValue(new ApiError("taken", 409, "EmailTaken"));
    const user = userEvent.setup();
    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }} initialEntries={["/signup"]}>
        <SignupScreen />
      </MemoryRouter>,
    );

    await user.type(screen.getByLabelText(/email/i), "taken@b.com");
    await user.type(screen.getByLabelText(/^password$/i), "password123");
    await user.click(screen.getByRole("button", { name: /create account/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/already registered/i);
  });
});
