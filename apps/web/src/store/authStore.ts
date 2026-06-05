// ─────────────────────────────────────────────────────────────────────────────
// authStore — the web app's auth state (Wave 2), backed by Core's email/password
// auth in apps/api (`/api/v1/auth`).
//
// • The access token lives ONLY in lib/api.ts memory (never here, never storage).
//   This store mirrors the derived `user`, never the raw JWT.
// • On app boot we call `restore()` → POST /refresh, silently restoring a session
//   from the httpOnly `vf_refresh` cookie. If it fails we land logged-out (no error).
// • A "needs-login" signal from lib/api.ts (a refresh that failed mid-request) drops
//   the session here too, so the router falls back to /login.
// ─────────────────────────────────────────────────────────────────────────────

import { create } from 'zustand';
import {
  apiLogin,
  apiLogout,
  apiSignup,
  onNeedsLogin,
  refreshSession,
  type AuthUser,
} from '../lib/api.js';

export interface AuthState {
  /** The signed-in user, or null when logged out. */
  user: AuthUser | null;
  /** True until the boot-time refresh resolves — gates routing so we don't flash /login. */
  initializing: boolean;
  /** Restore a session from the refresh cookie (idempotent, runs once on boot). */
  restore: () => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  signup: (email: string, password: string, displayName?: string) => Promise<void>;
  logout: () => Promise<void>;
}

let restorePromise: Promise<void> | null = null;

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  initializing: true,

  restore: () => {
    // Guard against double-invocation (React 18 StrictMode mounts effects twice).
    if (restorePromise) return restorePromise;
    restorePromise = (async () => {
      const session = await refreshSession();
      set({ user: session?.user ?? null, initializing: false });
    })();
    return restorePromise;
  },

  login: async (email, password) => {
    const session = await apiLogin({ email, password });
    set({ user: session.user, initializing: false });
  },

  signup: async (email, password, displayName) => {
    const session = await apiSignup({
      email,
      password,
      ...(displayName ? { displayName } : {}),
    });
    set({ user: session.user, initializing: false });
  },

  logout: async () => {
    await apiLogout();
    set({ user: null });
  },
}));

// When a mid-request refresh fails, lib/api.ts clears the in-memory token and fires
// this signal. Mirror that here so the session drops and the router shows /login.
onNeedsLogin(() => {
  useAuthStore.setState({ user: null, initializing: false });
});
