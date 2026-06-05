// ─────────────────────────────────────────────────────────────────────────────
// Vitest global setup (jsdom). Loaded before every test file.
//
// jsdom implements the DOM but not the browser media/observer APIs VideoForge
// touches (WebGL, Web Audio, WebCodecs, matchMedia, ResizeObserver). We mock the
// minimum surface so components mount and engines construct without a real browser
// (Pipeline §4.7: "no hard dependency on a live AudioContext in unit/component
// scope"). Tests that exercise these APIs install richer fakes from src/test/mocks.
// ─────────────────────────────────────────────────────────────────────────────

import "@testing-library/jest-dom/vitest";
import { afterEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";

// Unmount React trees between tests so the jsdom document stays clean.
afterEach(() => {
  cleanup();
});

// ── matchMedia (jsdom has none) ───────────────────────────────────────────────
if (typeof window.matchMedia !== "function") {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
}

// ── ResizeObserver / IntersectionObserver (jsdom has neither) ─────────────────
class NoopObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
  takeRecords(): unknown[] {
    return [];
  }
}
globalThis.ResizeObserver ??= NoopObserver as unknown as typeof ResizeObserver;
globalThis.IntersectionObserver ??=
  NoopObserver as unknown as typeof IntersectionObserver;

// ── requestAnimationFrame fallbacks (jsdom provides these, but be defensive) ──
if (typeof globalThis.requestAnimationFrame !== "function") {
  globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) =>
    setTimeout(() => cb(Date.now()), 0) as unknown as number) as typeof requestAnimationFrame;
  globalThis.cancelAnimationFrame = ((id: number) =>
    clearTimeout(id)) as typeof cancelAnimationFrame;
}

// ── scrollIntoView (used by some menus; jsdom stubs it as undefined) ──────────
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = vi.fn();
}

// ── URL.createObjectURL / revokeObjectURL (jsdom has none) ────────────────────
if (typeof URL.createObjectURL !== "function") {
  URL.createObjectURL = vi.fn(() => "blob:vf-test");
  URL.revokeObjectURL = vi.fn();
}

// ── Web Audio (jsdom has none) ────────────────────────────────────────────────
// AudioEngine constructs an AudioContext at module load (engine/index.ts), so any
// component importing the engine singletons needs this to even mount. Methods are
// no-ops sufficient for construction + the preview mix scheduling calls.
class MockAudioParam {
  value = 0;
  setValueAtTime = vi.fn();
  setTargetAtTime = vi.fn();
  linearRampToValueAtTime = vi.fn();
  cancelScheduledValues = vi.fn();
}
class MockAudioNode {
  connect = vi.fn();
  disconnect = vi.fn();
}
class MockGainNode extends MockAudioNode {
  gain = new MockAudioParam();
}
class MockStereoPannerNode extends MockAudioNode {
  pan = new MockAudioParam();
}
class MockBufferSourceNode extends MockAudioNode {
  buffer: unknown = null;
  playbackRate = new MockAudioParam();
  start = vi.fn();
  stop = vi.fn();
}
class MockAudioContext {
  currentTime = 0;
  state: AudioContextState = "running";
  destination = new MockAudioNode();
  createGain = vi.fn(() => new MockGainNode());
  createStereoPanner = vi.fn(() => new MockStereoPannerNode());
  createBufferSource = vi.fn(() => new MockBufferSourceNode());
  decodeAudioData = vi.fn(async () => ({ duration: 1 }) as unknown as AudioBuffer);
  resume = vi.fn(async () => {});
  close = vi.fn(async () => {});
}
globalThis.AudioContext ??= MockAudioContext as unknown as typeof AudioContext;
(globalThis as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext ??=
  MockAudioContext as unknown as typeof AudioContext;
