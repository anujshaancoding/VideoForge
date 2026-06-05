import { describe, it, expect, afterEach } from "vitest";
import { getBrowserSupport, isSupportedBrowser } from "../browser.js";

// The Chrome/Edge-only gate is a tested, selectable behaviour (Pipeline §4.7) —
// the editor must refuse non-Chromium / non-WebCodecs / mobile clients rather than
// render a broken preview. These pin the detection matrix.

const UA = {
  chrome:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  edge:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0",
  safari:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
  firefox:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0",
  mobileChrome:
    "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
};

function setUA(ua: string): void {
  Object.defineProperty(window.navigator, "userAgent", { value: ua, configurable: true });
}
function setWebCodecs(present: boolean): void {
  if (present) (globalThis as { VideoDecoder?: unknown }).VideoDecoder = class {};
  else delete (globalThis as { VideoDecoder?: unknown }).VideoDecoder;
}

afterEach(() => {
  setWebCodecs(false);
});

describe("getBrowserSupport", () => {
  it("supports desktop Chrome with WebCodecs", () => {
    setUA(UA.chrome);
    setWebCodecs(true);
    const s = getBrowserSupport();
    expect(s).toMatchObject({
      supported: true,
      isChromium: true,
      hasWebCodecs: true,
      isDesktop: true,
      engine: "chromium",
    });
  });

  it("supports desktop Edge (Chromium)", () => {
    setUA(UA.edge);
    setWebCodecs(true);
    expect(getBrowserSupport().isChromium).toBe(true);
    expect(isSupportedBrowser()).toBe(true);
  });

  it("rejects Chromium WITHOUT WebCodecs", () => {
    setUA(UA.chrome);
    setWebCodecs(false);
    const s = getBrowserSupport();
    expect(s.hasWebCodecs).toBe(false);
    expect(s.supported).toBe(false);
  });

  it("rejects Safari (WebKit)", () => {
    setUA(UA.safari);
    setWebCodecs(true); // even if present, engine is not Chromium
    const s = getBrowserSupport();
    expect(s.isChromium).toBe(false);
    expect(s.engine).toBe("webkit");
    expect(s.supported).toBe(false);
  });

  it("rejects Firefox (Gecko)", () => {
    setUA(UA.firefox);
    setWebCodecs(true);
    const s = getBrowserSupport();
    expect(s.isChromium).toBe(false);
    expect(s.engine).toBe("gecko");
    expect(s.supported).toBe(false);
  });

  it("rejects mobile Chrome (not desktop)", () => {
    setUA(UA.mobileChrome);
    setWebCodecs(true);
    const s = getBrowserSupport();
    expect(s.isDesktop).toBe(false);
    expect(s.supported).toBe(false);
  });
});
