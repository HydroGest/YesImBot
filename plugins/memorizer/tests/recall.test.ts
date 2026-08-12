import { describe, expect, it } from "vitest";

import { createChannelTools } from "../src/plugin.js";
import { MemoryStore } from "../src/store/memory.js";
import { PendingStore } from "../src/store/pending.js";

const channel = { type: "guild", platform: "test", channelId: "room", guildId: "room" } as const;

function store(rows: Array<Record<string, unknown>>): MemoryStore {
  return {
    queryVisible: async (_context, userIds, query) =>
      rows
        .filter((row) => row.scope !== "user" || userIds.includes(row.userId as string))
        .filter((row) => !query.scopes || query.scopes.includes(row.scope as "channel" | "user" | "shared"))
        .map((row) => ({ ...row })),
    touch: async (ids) => {
      for (const row of rows) if (ids.includes(row.id as string)) row.accessCount = Number(row.accessCount) + 1;
    },
  } as unknown as MemoryStore;
}

function recallTool(rows: Array<Record<string, unknown>>, options: { embed?: (query: string) => Promise<readonly number[]> } = {}) {
  const tools = createChannelTools(channel, store(rows), {} as PendingStore, {
    evidenceCount: async () => 0,
    readConversation: async () => [],
    rearm: async () => {},
    search: async () => ({ answer: "", memories: [], unresolved: [] }),
    embeddingModel: options.embed ? ({ modelId: "test" } as never) : undefined,
  });
  return tools.find((t) => t.name === "recall")!;
}

describe("recall tool", () => {
  it("limits user memory to participants in the current turn and returns projections only", async () => {
    const rows = [
      { id: "channel", type: "fact", content: "channel fact", scope: "channel", importance: 1, confidence: 1, updatedAt: 0, accessCount: 0 },
      { id: "alice", type: "fact", content: "alice fact", scope: "user", userId: "alice", importance: 1, confidence: 1, updatedAt: 0, accessCount: 0 },
      { id: "bob", type: "fact", content: "bob fact", scope: "user", userId: "bob", importance: 1, confidence: 1, updatedAt: 0, accessCount: 0 },
    ];
    const tool = recallTool(rows);
    const result = await tool.execute({ limit: 10 }, { messages: [{ role: "custom", type: "yesimbot.message", data: { user: { id: "alice" } } }] } as never);

    expect(result).toMatchObject({
      semanticUsed: false,
      memories: [
        { id: "channel", evidenceCount: 0 },
        { id: "alice", evidenceCount: 0 },
      ],
    });
    expect(JSON.stringify(result)).not.toContain("bob");
  });

  it("does not embed unless semantic recall has an embedding model", async () => {
    const rows = [{ id: "shared", type: "fact", content: "fact", scope: "shared", importance: 1, confidence: 1, updatedAt: 0, accessCount: 0 }];
    const tool = recallTool(rows);

    await expect(tool.execute({ semantic: false }, { messages: [] } as never)).resolves.toMatchObject({ semanticUsed: false });
    await expect(tool.execute({ semantic: true }, { messages: [] } as never)).resolves.toMatchObject({ semanticUsed: false });
  });
});
