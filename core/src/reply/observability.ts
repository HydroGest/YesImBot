import type { DegradationReason } from "./ocl.js";

export type ReplyDeliveryStatus = "delivered" | "failed" | "cancelled" | "incomplete" | "skipped";

export interface ReplyObservation {
  readonly provider: string;
  readonly segmentCount: number;
  readonly segmentLengths: readonly number[];
  readonly controlAdopted: boolean;
  readonly skipped: boolean;
  readonly totalDeliveryMs: number;
  readonly deliveryStatus: ReplyDeliveryStatus;
  readonly degradationReason?: DegradationReason;
}

export interface ProviderComplianceSnapshot {
  readonly provider: string;
  readonly totalReplies: number;
  readonly controlElementAdoptionCount: number;
  readonly controlElementAdoptionRate: number;
  readonly degradationCount: number;
  readonly degradationRate: number;
  readonly skipCount: number;
  readonly skipRate: number;
}

export interface AntiTemplateSnapshot {
  readonly segmentCountEntropyBits: number;
  readonly maximumIdenticalCountRunLength: number;
  readonly segmentLengthVariance: number;
  readonly runLengthAlarmed: boolean;
}

export interface ReplyDiagnostic extends ReplyObservation, AntiTemplateSnapshot {
  readonly event: "reply.delivery_observed";
  readonly providerCompliance: ProviderComplianceSnapshot;
}

export const REPLY_OBSERVABILITY_WINDOW_SIZE = 8;

// These fixture measurements are conservative observational starting points, not model targets or guardrails.
export const REPLY_OBSERVABILITY_BASELINE = Object.freeze({
  segmentCountEntropyBits: 1.561278,
  maximumIdenticalCountRunLength: 1,
  segmentLengthVariance: 10.666667,
});

// Observation-only alarm: recalibrate from deployed data before treating it as an operational policy.
export const IDENTICAL_SEGMENT_COUNT_RUN_LENGTH_ALARM_THRESHOLD = 4;

export function slidingWindowSegmentCountEntropy(
  segmentCounts: readonly number[],
  windowSize = REPLY_OBSERVABILITY_WINDOW_SIZE,
): number {
  const counts = segmentCounts.slice(-normalizedWindowSize(windowSize));
  if (counts.length === 0) return 0;
  const frequencies = new Map<number, number>();
  for (const count of counts) frequencies.set(count, (frequencies.get(count) ?? 0) + 1);
  return [...frequencies.values()].reduce((entropy, frequency) => {
    const probability = frequency / counts.length;
    return entropy - probability * Math.log2(probability);
  }, 0);
}

export function maximumIdenticalCountRunLength(segmentCounts: readonly number[]): number {
  let maximum = 0;
  let current = 0;
  let previous: number | undefined;
  for (const count of segmentCounts) {
    current = count === previous ? current + 1 : 1;
    maximum = Math.max(maximum, current);
    previous = count;
  }
  return maximum;
}

export function populationVariance(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const mean = values.reduce((total, value) => total + value, 0) / values.length;
  return values.reduce((total, value) => total + (value - mean) ** 2, 0) / values.length;
}

export class ProviderComplianceHarness {
  private readonly observations = new Map<string, ReplyObservation[]>();

  record(observation: ReplyObservation): ProviderComplianceSnapshot {
    const providerObservations = this.observations.get(observation.provider) ?? [];
    providerObservations.push(observation);
    this.observations.set(observation.provider, providerObservations);
    return providerComplianceSnapshot(observation.provider, providerObservations);
  }

  snapshot(provider: string): ProviderComplianceSnapshot {
    return providerComplianceSnapshot(provider, this.observations.get(provider) ?? []);
  }
}

export class ReplyObservability {
  private readonly observations: ReplyObservation[] = [];
  private readonly compliance = new ProviderComplianceHarness();

  record(observation: ReplyObservation): ReplyDiagnostic {
    this.observations.push(observation);
    const counts = this.observations.map((entry) => entry.segmentCount);
    const recentCounts = counts.slice(-REPLY_OBSERVABILITY_WINDOW_SIZE);
    const maximumRunLength = maximumIdenticalCountRunLength(recentCounts);
    return {
      event: "reply.delivery_observed",
      ...observation,
      segmentCountEntropyBits: slidingWindowSegmentCountEntropy(recentCounts),
      maximumIdenticalCountRunLength: maximumRunLength,
      segmentLengthVariance: populationVariance(observation.segmentLengths),
      runLengthAlarmed: maximumRunLength >= IDENTICAL_SEGMENT_COUNT_RUN_LENGTH_ALARM_THRESHOLD,
      providerCompliance: this.compliance.record(observation),
    };
  }
}

function providerComplianceSnapshot(
  provider: string,
  observations: readonly ReplyObservation[],
): ProviderComplianceSnapshot {
  const totalReplies = observations.length;
  const controlElementAdoptionCount = observations.filter((entry) => entry.controlAdopted).length;
  const degradationCount = observations.filter((entry) => entry.degradationReason !== undefined).length;
  const skipCount = observations.filter((entry) => entry.skipped).length;
  return {
    provider,
    totalReplies,
    controlElementAdoptionCount,
    controlElementAdoptionRate: rate(controlElementAdoptionCount, totalReplies),
    degradationCount,
    degradationRate: rate(degradationCount, totalReplies),
    skipCount,
    skipRate: rate(skipCount, totalReplies),
  };
}

function normalizedWindowSize(windowSize: number): number {
  return Number.isSafeInteger(windowSize) && windowSize > 0 ? windowSize : REPLY_OBSERVABILITY_WINDOW_SIZE;
}

function rate(count: number, total: number): number {
  return total === 0 ? 0 : count / total;
}
