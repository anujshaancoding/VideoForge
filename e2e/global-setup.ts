// ─────────────────────────────────────────────────────────────────────────────
// e2e/global-setup.ts — Auth fixture for Playwright e2e suite.
//
// Strategy: sign up (or reuse if email already taken) via POST /api/v1/auth/signup,
// then POST /api/v1/auth/login to obtain a session. The auth token is stored in
// Playwright storageState so every test can start with a valid logged-in session
// without repeating the auth flow.
//
// The setup also seeds the storageState with the JWT access token injected into
// the page's in-memory API client (lib/api.ts uses `accessToken` from module scope,
// NOT localStorage — so we must inject it via page.addInitScript on first load).
//
// The storageState file is written to e2e/.auth/session.json. Tests consume it
// via `use: { storageState: ... }` in playwright.config.ts.
//
// VITE_API_BASE_URL defaults to http://localhost:4000/api/v1 (matching lib/api.ts).
// ─────────────────────────────────────────────────────────────────────────────

import { chromium, type FullConfig } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';

const API_BASE =
  process.env['VITE_API_BASE_URL'] ?? 'http://localhost:4000/api/v1';

const E2E_EMAIL = process.env['E2E_EMAIL'] ?? 'e2e-sentinel@videoforge.test';
const E2E_PASSWORD = process.env['E2E_PASSWORD'] ?? 'e2e-sentinel-pw-1234';
const E2E_DISPLAY_NAME = 'Sentinel E2E';

/** Path where the storageState JSON is persisted between setup + tests. */
export const AUTH_FILE = path.join(
  path.dirname(new URL(import.meta.url).pathname),
  '.auth',
  'session.json',
);

async function apiPost(
  path_: string,
  body: Record<string, unknown>,
): Promise<{ ok: boolean; status: number; body: unknown }> {
  const res = await fetch(`${API_BASE}${path_}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const responseBody = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, body: responseBody };
}

export default async function globalSetup(_config: FullConfig): Promise<void> {
  // Ensure the .auth directory exists.
  const authDir = path.dirname(AUTH_FILE);
  if (!fs.existsSync(authDir)) {
    fs.mkdirSync(authDir, { recursive: true });
  }

  // --- Step 1: create the test user (idempotent — 409 = already exists, ok) ---
  const signupRes = await apiPost('/auth/signup', {
    email: E2E_EMAIL,
    password: E2E_PASSWORD,
    displayName: E2E_DISPLAY_NAME,
  });

  if (!signupRes.ok && signupRes.status !== 409) {
    throw new Error(
      `[global-setup] signup failed: HTTP ${signupRes.status} — ${JSON.stringify(signupRes.body)}`,
    );
  }

  // --- Step 2: login to get a fresh access token + refresh cookie ---
  const loginRes = await apiPost('/auth/login', {
    email: E2E_EMAIL,
    password: E2E_PASSWORD,
  });

  if (!loginRes.ok) {
    throw new Error(
      `[global-setup] login failed: HTTP ${loginRes.status} — ${JSON.stringify(loginRes.body)}`,
    );
  }

  const { accessToken } = loginRes.body as { accessToken: string };

  if (!accessToken) {
    throw new Error('[global-setup] login response missing accessToken');
  }

  // --- Step 3: build storageState manually with the API cookies ---
  //
  // The refresh cookie is set by the API at http://localhost:4000 (the API origin).
  // The web app at http://localhost:5173 calls POST /api/v1/auth/refresh with
  // `credentials: 'include'` — the browser sends the cookie to the API, NOT the
  // web app origin. Playwright's storageState must contain the cookie under the
  // API origin so it is included in cross-origin credential requests.
  //
  // Strategy:
  //   a) Use a Playwright browser context to POST /auth/login directly to the API
  //      so the browser jar captures the Set-Cookie from the API domain.
  //   b) Save the storageState which now includes the API-origin cookie.
  //   c) Patch the storageState's localStorage for the web app origin with the
  //      access token (belt-and-suspenders — the primary path is the refresh cookie).

  const apiOrigin = API_BASE.replace(/\/api\/v1$/, ''); // e.g. http://localhost:4000
  const webOrigin = process.env['BASE_URL'] ?? 'http://localhost:5173';

  const browser = await chromium.launch({ headless: true });

  // Create a context that can talk to both origins.
  const context = await browser.newContext({
    baseURL: webOrigin,
  });

  // Step 3a: POST /auth/login via the browser so the refresh cookie lands in
  // the browser's cookie jar for the API origin. We use page.evaluate with fetch
  // (which honours the browser's cookie jar) rather than the Node fetch above.
  const apiPage = await context.newPage();
  await apiPage.goto(apiOrigin); // navigate to the API origin to establish the origin context
  const loginResult = await apiPage.evaluate(
    async ({ apiBase, email, password }: { apiBase: string; email: string; password: string }) => {
      const res = await fetch(`${apiBase}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
        credentials: 'include',
      });
      const body = await res.json() as { accessToken?: string; error?: string };
      return { ok: res.ok, status: res.status, accessToken: body.accessToken ?? null, error: body.error ?? null };
    },
    { apiBase: API_BASE, email: E2E_EMAIL, password: E2E_PASSWORD },
  );

  if (!loginResult.ok || !loginResult.accessToken) {
    await browser.close();
    throw new Error(
      `[global-setup] browser login failed: HTTP ${loginResult.status} — ${loginResult.error ?? 'no token'}`,
    );
  }

  const browserAccessToken = loginResult.accessToken;

  // Step 3b: navigate to the web app so the web origin appears in storageState.
  const webPage = await context.newPage();
  await webPage.goto(webOrigin);
  await webPage.waitForLoadState('networkidle');

  // Inject the access token into localStorage under a known key so the app's
  // addInitScript hook can bootstrap the in-memory token without a /refresh call.
  await webPage.evaluate((token: string) => {
    localStorage.setItem('__vf_e2e_access_token__', token);
  }, browserAccessToken);

  // Step 3c: persist storageState — this now includes:
  //   • The vf_refresh cookie (httpOnly) for the API origin
  //   • The __vf_e2e_access_token__ localStorage entry for the web origin
  await context.storageState({ path: AUTH_FILE });

  // Patch: also inject the access token via a direct JSON edit so that even if
  // the web origin localStorage didn't capture, the file is consistent.
  const stored = JSON.parse(fs.readFileSync(AUTH_FILE, 'utf8')) as {
    cookies: Array<{ name: string; domain: string; value: string }>;
    origins: Array<{ origin: string; localStorage: Array<{ name: string; value: string }> }>;
  };

  const tokenEntry = { name: '__vf_e2e_access_token__', value: browserAccessToken };

  // Ensure the web origin entry has the token.
  let webOriginEntry = stored.origins.find((o) => o.origin === webOrigin);
  if (!webOriginEntry) {
    webOriginEntry = { origin: webOrigin, localStorage: [] };
    stored.origins.push(webOriginEntry);
  }
  const existingTokenIdx = webOriginEntry.localStorage.findIndex((e) => e.name === tokenEntry.name);
  if (existingTokenIdx >= 0) {
    webOriginEntry.localStorage[existingTokenIdx] = tokenEntry;
  } else {
    webOriginEntry.localStorage.push(tokenEntry);
  }

  fs.writeFileSync(AUTH_FILE, JSON.stringify(stored, null, 2));

  await browser.close();

  console.log(
    `[global-setup] auth fixture ready → ${AUTH_FILE} (token: ${browserAccessToken.slice(0, 20)}…)`,
  );
}
