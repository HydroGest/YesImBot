import type { Element } from "koishi";

import type { EventRecord, MessageRecord } from "./messages/index.js";
import type { RuntimeResult } from "./runtimes/index.js";

/** Temporary Gateway-facing consumer; Task 4 owns pacing and delivery lifecycle. */
export async function deliverOutput(options: {
  readonly record: MessageRecord | EventRecord;
  readonly result: Extract<RuntimeResult, { readonly kind: "run" }>;
  readonly send: (segment: readonly Element[]) => Promise<unknown>;
  readonly fail: (cause: unknown) => Promise<void>;
}): Promise<void> {
  try {
    for await (const output of options.result.output) {
      for (const segment of output.segments) {
        if (options.result.signal.aborted) return;
        await options.send(segment);
      }
    }
  } catch (cause) {
    await options.fail(cause);
  }
}
