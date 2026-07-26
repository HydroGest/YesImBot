import { describe, expect, it } from "vitest";

import {
  IDENTICAL_SEGMENT_COUNT_RUN_LENGTH_ALARM_THRESHOLD,
  maximumIdenticalCountRunLength,
  populationVariance,
  ProviderComplianceHarness,
  REPLY_OBSERVABILITY_BASELINE,
  ReplyObservability,
  slidingWindowSegmentCountEntropy,
} from "../src/reply/observability.js";

describe("reply observability", () => {
  it("measures a repeated segment-count run while varied counts retain entropy", () => {
    const variedCounts = [1, 2, 1, 3, 2, 1, 2, 3];
    const repeatedCounts = Array.from({ length: IDENTICAL_SEGMENT_COUNT_RUN_LENGTH_ALARM_THRESHOLD }, () => 2);

    expect(slidingWindowSegmentCountEntropy(variedCounts)).toBeCloseTo(
      REPLY_OBSERVABILITY_BASELINE.segmentCountEntropyBits,
      5,
    );
    expect(slidingWindowSegmentCountEntropy(variedCounts)).toBeGreaterThan(
      slidingWindowSegmentCountEntropy(repeatedCounts),
    );
    expect(maximumIdenticalCountRunLength(repeatedCounts)).toBe(
      IDENTICAL_SEGMENT_COUNT_RUN_LENGTH_ALARM_THRESHOLD,
    );
    expect(populationVariance([4, 8, 12])).toBeCloseTo(
      REPLY_OBSERVABILITY_BASELINE.segmentLengthVariance,
      5,
    );
  });

  it("records configured-provider control adoption, degradation, and skip rates without invocation", () => {
    const harness = new ProviderComplianceHarness();
    harness.record({
      provider: "configured-provider",
      segmentCount: 2,
      segmentLengths: [4, 8],
      controlAdopted: true,
      skipped: false,
      totalDeliveryMs: 10,
      deliveryStatus: "delivered",
    });
    const snapshot = harness.record({
      provider: "configured-provider",
      segmentCount: 0,
      segmentLengths: [],
      controlAdopted: true,
      skipped: true,
      degradationReason: "no_segments",
      totalDeliveryMs: 0,
      deliveryStatus: "skipped",
    });

    expect(snapshot).toEqual({
      provider: "configured-provider",
      totalReplies: 2,
      controlElementAdoptionCount: 2,
      controlElementAdoptionRate: 1,
      degradationCount: 1,
      degradationRate: 0.5,
      skipCount: 1,
      skipRate: 0.5,
    });
  });

  it("raises the observation-only alarm for a fixed-count regression", () => {
    const observability = new ReplyObservability();
    let diagnostic = observability.record({
      provider: "configured-provider",
      segmentCount: 2,
      segmentLengths: [5, 5],
      controlAdopted: true,
      skipped: false,
      totalDeliveryMs: 1,
      deliveryStatus: "delivered",
    });
    for (let index = 1; index < IDENTICAL_SEGMENT_COUNT_RUN_LENGTH_ALARM_THRESHOLD; index += 1) {
      diagnostic = observability.record({
        provider: "configured-provider",
        segmentCount: 2,
        segmentLengths: [5, 5],
        controlAdopted: true,
        skipped: false,
        totalDeliveryMs: 1,
        deliveryStatus: "delivered",
      });
    }

    expect(diagnostic.maximumIdenticalCountRunLength).toBe(
      IDENTICAL_SEGMENT_COUNT_RUN_LENGTH_ALARM_THRESHOLD,
    );
    expect(diagnostic.runLengthAlarmed).toBe(true);
  });
});
