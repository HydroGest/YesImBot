import type { Element } from "koishi";

import type { PacingConfig } from "./config.js";
import type { EventRecord, MessageRecord } from "./messages.js";
import type { ChannelOutput, ChannelRuntimeResult } from "./runtime/channel.js";

interface DeliveryOptions {
  readonly record: MessageRecord | EventRecord;
  readonly result: Extract<ChannelRuntimeResult, { readonly kind: "run" }>;
  readonly pacing: PacingConfig;
  readonly send: (segment: Element[]) => Promise<unknown>;
  readonly warn: (cause: unknown) => void;
}

export async function deliverOutput({
  record,
  result,
  pacing,
  send,
  warn,
}: DeliveryOptions): Promise<void> {
  let acknowledged = false;
  let consumedDeliveryMs = 0;
  for await (const output of result.output) {
    for (const [index, segment] of output.segments.entries()) {
      if (result.delivery.signal.aborted) return;
      const delayMs = nextSegmentDelayMs({
        text: segment.join(""),
        consumedDeliveryMs,
        config: pacing,
      });
      const startedAt = Date.now();
      await waitForDelay(delayMs, result.delivery.signal);
      consumedDeliveryMs += Math.max(delayMs, Date.now() - startedAt);
      if (result.delivery.signal.aborted) return;
      try {
        await send(segment);
        if (!acknowledged) {
          acknowledged = true;
          await result.delivery.onDelivered();
        }
      } catch (cause) {
        await reportDeliveryFailure({
          record,
          output,
          index,
          cause,
          delivery: result.delivery,
          warn,
        });
        return;
      }
    }
  }
}

async function reportDeliveryFailure(input: {
  readonly record: MessageRecord | EventRecord;
  readonly output: ChannelOutput;
  readonly index: number;
  readonly cause: unknown;
  readonly delivery: {
    fail(record: EventRecord<"delivery.failed">): Promise<void>;
  };
  readonly warn: (cause: unknown) => void;
}): Promise<void> {
  const error = normalizeDeliveryError(input.cause);
  try {
    await input.delivery.fail({
      eventType: "delivery.failed",
      platform: input.record.platform,
      selfId: input.record.selfId,
      timestamp: Date.now(),
      channel: input.record.channel,
      delivery: {
        turnId: input.output.turnId,
        messageId: input.output.messageId,
        segmentIndex: input.index + 1,
        segmentTotal: input.output.segments.length,
        error,
      },
      text: `Delivery of assistant message ${input.output.messageId} failed: ${error.message}`,
    });
  } catch (feedbackCause) {
    input.warn(feedbackCause);
  }
}

function nextSegmentDelayMs(input: {
  readonly text: string;
  readonly consumedDeliveryMs: number;
  readonly config: PacingConfig;
}): number {
  const jitter = 0.85 + (1.15 - 0.85) * Math.random();
  const typingMs = ([...input.text].length / input.config.charactersPerSecond) * 1_000 * jitter;
  const delayMs = Math.min(Math.max(typingMs, 250), 10_000);
  return input.consumedDeliveryMs + delayMs >= input.config.maxTotalDelayMs
    ? 250
    : Math.round(delayMs);
}

function waitForDelay(delayMs: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(finish, delayMs);
    const onAbort = () => finish();
    function finish(): void {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      resolve();
    }
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function normalizeDeliveryError(cause: unknown): { name: string; message: string; code?: string } {
  const error = cause instanceof Error ? cause : new Error(String(cause));
  const code =
    typeof (cause as { code?: unknown } | null)?.code === "string"
      ? (cause as { code: string }).code
      : undefined;
  return { name: error.name, message: error.message, ...(code === undefined ? {} : { code }) };
}
