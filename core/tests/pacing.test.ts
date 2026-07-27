import { afterEach, describe, expect, it, vi } from "vitest";

import type { PacingConfig } from "../src/config.js";
import { nextSegmentDelayMs } from "../src/reply/pacing.js";

const config: PacingConfig = {
  charactersPerSecond: 10,
  maxTotalDelayMs: 60_000,
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("nextSegmentDelayMs", () => {
  it("keeps every segment delay between the fixed minimum and maximum", () => {
    const delays = ["", "x", "x".repeat(10), "x".repeat(200)].map((text) =>
      nextSegmentDelayMs({ text, consumedDeliveryMs: 0, config }),
    );

    for (const delay of delays) {
      expect(delay).toBeGreaterThanOrEqual(250);
      expect(delay).toBeLessThanOrEqual(10_000);
    }
  });

  it("does not pace a substantially longer text faster than a shorter text", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.5);

    const shortDelay = nextSegmentDelayMs({
      text: "x".repeat(10),
      consumedDeliveryMs: 0,
      config,
    });
    const longDelay = nextSegmentDelayMs({
      text: "x".repeat(100),
      consumedDeliveryMs: 0,
      config,
    });

    expect(longDelay).toBeGreaterThanOrEqual(shortDelay);
  });

  it("treats identical segments uniformly without a first-segment input", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.5);

    const firstDelay = nextSegmentDelayMs({
      text: "x".repeat(20),
      consumedDeliveryMs: 0,
      config,
    });
    const laterDelay = nextSegmentDelayMs({
      text: "x".repeat(20),
      consumedDeliveryMs: 0,
      config,
    });

    expect(laterDelay).toBe(firstDelay);
  });

  it("uses the minimum delay once delivery time reaches the total limit", () => {
    expect(
      nextSegmentDelayMs({
        text: "x".repeat(20),
        consumedDeliveryMs: config.maxTotalDelayMs,
        config,
      }),
    ).toBe(250);
  });

  it("keeps empty segments at the minimum delay", () => {
    expect(nextSegmentDelayMs({ text: "", consumedDeliveryMs: 0, config })).toBeGreaterThanOrEqual(250);
  });

  it("continues returning the minimum delay after the total limit instead of dropping segments", () => {
    const input = {
      text: "x".repeat(20),
      consumedDeliveryMs: config.maxTotalDelayMs,
      config,
    };

    expect(nextSegmentDelayMs(input)).toBe(250);
    expect(nextSegmentDelayMs(input)).toBe(250);
    expect(nextSegmentDelayMs(input)).toBe(250);
  });
});
