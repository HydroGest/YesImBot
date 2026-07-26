import { describe, expect, it } from "vitest";

import type { PacingConfig } from "../src/config.js";
import type { ReplySegment } from "../src/reply/ocl.js";
import { nextSegmentDelayMs } from "../src/reply/pacing.js";

const config: PacingConfig = {
  minDelayMs: 100,
  maxSegmentDelayMs: 2_000,
  maxTotalDelayMs: 10_000,
  cjkCharactersPerSecond: 2,
  latinCharactersPerSecond: 10,
  randomFactorMin: 0.8,
  randomFactorMax: 1.2,
  firstSegmentResidualMinMs: 150,
  firstSegmentResidualMaxMs: 300,
};

function segment(text: string, overrides: Partial<ReplySegment> = {}): ReplySegment {
  return {
    text,
    index: 2,
    total: 2,
    sleepHintMs: 0,
    ...overrides,
  };
}

describe("nextSegmentDelayMs", () => {
  it("keeps character-derived delays within the configured segment bounds", () => {
    const minimumDelay = nextSegmentDelayMs({
      segment: segment(""),
      config,
      elapsedGenerationMs: 0,
      consumedDeliveryMs: 0,
      random: () => -1,
    });
    const delay = nextSegmentDelayMs({
      segment: segment("很长".repeat(10_000)),
      config,
      elapsedGenerationMs: 0,
      consumedDeliveryMs: 0,
      random: () => 2,
    });

    expect(minimumDelay).toBe(config.minDelayMs);
    expect(delay).toBe(config.maxSegmentDelayMs);
  });

  it("increases with visible length and charges CJK at its own configured rate", () => {
    const shortLatin = nextSegmentDelayMs({
      segment: segment("a"),
      config,
      elapsedGenerationMs: 0,
      consumedDeliveryMs: 0,
      random: () => 0.5,
    });
    const longLatin = nextSegmentDelayMs({
      segment: segment("aaaa"),
      config,
      elapsedGenerationMs: 0,
      consumedDeliveryMs: 0,
      random: () => 0.5,
    });
    const cjk = nextSegmentDelayMs({
      segment: segment("中"),
      config,
      elapsedGenerationMs: 0,
      consumedDeliveryMs: 0,
      random: () => 0.5,
    });

    expect(longLatin).toBeGreaterThan(shortLatin);
    expect(cjk).toBeGreaterThan(longLatin);
  });

  it("subtracts elapsed generation only from the first segment while retaining a residual", () => {
    const firstDelay = nextSegmentDelayMs({
      segment: segment("abcdefghij", { index: 1 }),
      config,
      elapsedGenerationMs: 5_000,
      consumedDeliveryMs: 0,
      random: () => 0.75,
    });
    const laterDelay = nextSegmentDelayMs({
      segment: segment("abcdefghij"),
      config,
      elapsedGenerationMs: 5_000,
      consumedDeliveryMs: 0,
      random: () => 0.75,
    });

    expect(firstDelay).toBeGreaterThanOrEqual(config.firstSegmentResidualMinMs);
    expect(firstDelay).toBeLessThanOrEqual(config.firstSegmentResidualMaxMs);
    expect(laterDelay).toBeGreaterThan(firstDelay);
  });

  it("adds sleep hints but clamps their combined delay to the segment ceiling", () => {
    const delay = nextSegmentDelayMs({
      segment: segment("a", { sleepHintMs: 100_000 }),
      config,
      elapsedGenerationMs: 0,
      consumedDeliveryMs: 0,
      random: () => 0.5,
    });

    expect(delay).toBe(config.maxSegmentDelayMs);
  });

  it("uses minimum spacing once delivery time would exhaust the total ceiling", () => {
    const constrainedConfig = { ...config, maxTotalDelayMs: 1_000 };
    const delay = nextSegmentDelayMs({
      segment: segment("abcdefghij"),
      config: constrainedConfig,
      elapsedGenerationMs: 0,
      consumedDeliveryMs: 950,
      random: () => 0.5,
    });

    expect(delay).toBe(constrainedConfig.minDelayMs);
  });
});
