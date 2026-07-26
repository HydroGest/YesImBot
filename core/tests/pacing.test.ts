import { describe, expect, it } from "vitest";

import type { PacingConfig } from "../src/config.js";
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

describe("nextSegmentDelayMs", () => {
  it("uses host pacing state rather than literal model sleep text", () => {
    const base = {
      config,
      elapsedGenerationMs: 5_000,
      consumedDeliveryMs: 0,
      random: () => 0.75,
    };

    const firstDelay = nextSegmentDelayMs({ ...base, segment: { text: "abcdefghij" }, isFirst: true });
    const laterDelay = nextSegmentDelayMs({ ...base, segment: { text: "abcdefghij" }, isFirst: false });
    const literalSleepDelay = nextSegmentDelayMs({
      ...base,
      segment: { text: '<sleep ms="100000"/>' },
      isFirst: false,
    });
    const plainTextDelay = nextSegmentDelayMs({
      ...base,
      segment: { text: "x".repeat('<sleep ms="100000"/>'.length) },
      isFirst: false,
    });

    expect(firstDelay).toBeGreaterThanOrEqual(config.firstSegmentResidualMinMs);
    expect(firstDelay).toBeLessThanOrEqual(config.firstSegmentResidualMaxMs);
    expect(laterDelay).toBeGreaterThan(firstDelay);
    expect(literalSleepDelay).toBe(plainTextDelay);
  });

  it("uses minimum spacing after host delivery time reaches its total limit", () => {
    expect(
      nextSegmentDelayMs({
        segment: { text: "abcdefghij" },
        isFirst: false,
        config: { ...config, maxTotalDelayMs: 1_000 },
        elapsedGenerationMs: 0,
        consumedDeliveryMs: 950,
        random: () => 0.5,
      }),
    ).toBe(config.minDelayMs);
  });
});
