import { createUserMessage } from "@yesimbot/agent-runtime";
import { describe, expect, it } from "vitest";

import { createChannelTools } from "../src/plugin.js";
import { MemoryStore } from "../src/store/memory.js";
import { PendingStore } from "../src/store/pending.js";

const channel = { type: "guild", platform: "test", channelId: "room", guildId: "room" } as const;

describe("remember channel tool", () => {
  it("validates sources through conversation read before enqueueing and arms the scheduler", async () => {
    const calls: string[] = [];
    const pending = { enqueue: async (input: unknown, _delay: unknown) => ({ id: "pending", ...(input as object) }) } as unknown as PendingStore;
    const tools = createChannelTools(channel, {} as MemoryStore, pending, {
      batchDelayMs: 100,
      evidenceCount: async () => 0,
      readConversation: async (_context, options) => {
        expect(options).toEqual({ messageIds: ["source"], before: 10, after: 10, limit: 50 });
        return [{ messageId: "source" } as never];
      },
      rearm: async () => {
        calls.push("arm");
      },
      search: async () => ({ answer: "", memories: [], unresolved: [] }),
    });
    const tool = tools.find((candidate) => candidate.name === "remember")!;

    await expect(
      tool.execute({ content: "remember", sources: ["source", "source"] }, { turnId: "turn", messages: [createUserMessage("ignored")] } as never),
    ).resolves.toEqual({
      queued: true,
      pendingId: "pending",
      sourceCount: 1,
    });
    expect(calls).toEqual(["arm"]);
  });
});
