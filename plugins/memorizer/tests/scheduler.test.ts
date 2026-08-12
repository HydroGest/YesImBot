import { describe, expect, it, vi } from "vitest";

import { MemoryScheduler } from "../src/scheduler.js";

const channel = { type: "guild", platform: "test", channelId: "room", guildId: "room" } as const;

describe("MemoryScheduler", () => {
  it("groups due pending requests by channel and serializes same-channel runs", async () => {
    const run = vi.fn(async () => undefined);
    const scheduler = new MemoryScheduler(
      {
        nextDueAt: async () => undefined,
        list: async () => [
          { id: "one", channel, nextAttemptAt: 0, suspended: false },
          { id: "two", channel, nextAttemptAt: 0, suspended: false },
        ],
        nextBatch: async () => [{ id: "one", channel, nextAttemptAt: 0, suspended: false }],
        complete: async () => undefined,
        fail: async () => undefined,
      } as never,
      run,
      { maxPending: 10, maxMessages: 300 },
    );
    await Promise.all([scheduler.runDue(0), scheduler.runDue(0)]);
    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith(channel, [{ id: "one", channel, nextAttemptAt: 0, suspended: false }]);
  });
});
