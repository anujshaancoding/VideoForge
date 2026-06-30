import { describe, expect, it } from "vitest";
import { parseTimeToSeconds } from "../time.js";

describe("parseTimeToSeconds", () => {
  it.each([
    ["0:30", 30],
    ["00:30", 30],
    ["1:20", 80],
    ["01:20", 80],
    ["1m 20s", 80],
    ["80 seconds", 80],
    ["80s", 80],
  ])("parses %s", (input, expected) => {
    expect(parseTimeToSeconds(input)).toBe(expected);
  });

  it("rejects invalid values safely", () => {
    expect(Number.isNaN(parseTimeToSeconds("nope"))).toBe(true);
    expect(Number.isNaN(parseTimeToSeconds("1:99"))).toBe(true);
  });
});
