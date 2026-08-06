import { createEntry, createMemoryStorage } from "@yesimbot/agent-runtime";
import type {
  AgentEntry,
  AgentMessage,
  AgentPluginRuntime,
  AgentStorage,
  TurnFinishContext,
  TurnResult,
} from "@yesimbot/agent-runtime";
import type * as Ai from "ai";
import type { LanguageModel } from "ai";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { executeCompact } from "../src/runtime/compact/execute.js";
import { filterEntriesForCompression } from "../src/runtime/compact/filter.js";
import { createCompactPlugin } from "../src/runtime/compact/plugin.js";
import { transformCompactEntries } from "../src/runtime/compact/transform.js";

const mockGenerateText = vi.hoisted(() => vi.fn());
// The mocked AI SDK only forwards the model identity.
const mockModel = {} as LanguageModel;
const mockLogger = { warn: vi.fn() };

vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof Ai>();
  return { ...actual, generateText: mockGenerateText };
});

function makeMessages(count: number, prefix = "message") {
  return Array.from({ length: count }, (_, i) =>
    createEntry(
      "message",
      {
        role: "custom",
        type: "yesimbot.message",
        data: {
          user: { id: `u${i}` },
          elements: [{ type: "text", attrs: { content: `${prefix} ${i}` }, children: [] }],
        },
      } as unknown as AgentMessage,
      { id: `e${i}` },
    ),
  );
}

function makeMockRuntime(
  storage: AgentStorage<AgentEntry>,
): AgentPluginRuntime & { storage: AgentStorage<AgentEntry> } {
  return {
    storage,
    id: "test",
    channel: {} as AgentPluginRuntime["channel"],
    state: {} as AgentPluginRuntime["state"],
  };
}

describe("transformCompactEntries", () => {
  it("returns entries unchanged when no compact entry exists", () => {
    const entries = [
      createEntry("message", { role: "user", id: "m1", timestamp: 1, content: "hi" } as AgentMessage),
      createEntry("message", { role: "assistant", id: "m2", timestamp: 2, content: "hello" } as AgentMessage),
    ];
    expect(transformCompactEntries(entries)).toEqual(entries);
  });

  it("replaces entries before lastEntryId with summary", () => {
    const entries = [
      createEntry("message", { role: "user", id: "m1", timestamp: 1, content: "hi" } as AgentMessage, { id: "e1" }),
      createEntry("message", { role: "assistant", id: "m2", timestamp: 2, content: "hello" } as AgentMessage, {
        id: "e2",
      }),
      createEntry("message", { role: "user", id: "m3", timestamp: 3, content: "how" } as AgentMessage, { id: "e3" }),
      createEntry("compact", { summary: "User greeted.", lastEntryId: "e2" }, { id: "c1" }),
      createEntry("message", { role: "user", id: "m4", timestamp: 4, content: "ok" } as AgentMessage, { id: "e4" }),
    ];

    const result = transformCompactEntries(entries);
    expect(result).toHaveLength(3); // summary + e3 + e4
    expect(result[0].type).toBe("message");
    expect((result[0] as AgentEntry<"message">).data.content).toContain("User greeted.");
    expect(result[1].id).toBe("e3");
    expect(result[2].id).toBe("e4");
  });

  it("uses the last compact entry when multiple exist", () => {
    const entries = [
      createEntry("message", { role: "user", id: "m1", timestamp: 1, content: "a" } as AgentMessage, { id: "e1" }),
      createEntry("compact", { summary: "first", lastEntryId: "e1" }, { id: "c1" }),
      createEntry("message", { role: "user", id: "m2", timestamp: 2, content: "b" } as AgentMessage, { id: "e2" }),
      createEntry("compact", { summary: "second", lastEntryId: "e2" }, { id: "c2" }),
      createEntry("message", { role: "user", id: "m3", timestamp: 3, content: "c" } as AgentMessage, { id: "e3" }),
    ];

    const result = transformCompactEntries(entries);
    expect(result).toHaveLength(2); // summary + e3
    expect((result[0] as AgentEntry<"message">).data.content).toContain("second");
  });

  it("uses compact entry id for summary entry id", () => {
    const entries = [
      createEntry("message", { role: "user", id: "m1", timestamp: 1, content: "hi" } as AgentMessage, { id: "e1" }),
      createEntry("compact", { summary: "A summary.", lastEntryId: "e1" }, { id: "c1" }),
    ];

    const result = transformCompactEntries(entries);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("c1");
    expect((result[0] as AgentEntry<"message">).data.role).toBe("system");
    expect((result[0] as AgentEntry<"message">).data.content).toBe("<context_summary>\nA summary.\n</context_summary>");
  });

  it("handles lastEntryId not found by returning summary + entries after compact", () => {
    const entries = [
      createEntry("message", { role: "user", id: "m1", timestamp: 1, content: "hi" } as AgentMessage, { id: "e1" }),
      createEntry("compact", { summary: "Ghost compact.", lastEntryId: "nonexistent" }, { id: "c1" }),
      createEntry("message", { role: "user", id: "m2", timestamp: 2, content: "after" } as AgentMessage, { id: "e2" }),
    ];

    const result = transformCompactEntries(entries);
    expect(result).toHaveLength(2);
    expect(result[0].type).toBe("message");
    expect((result[0] as AgentEntry<"message">).data.content).toContain("Ghost compact.");
    expect(result[1].id).toBe("e2");
  });
});

describe("filterEntriesForCompression", () => {
  it("keeps only the specified message text and binary placeholders", () => {
    const entries = [
      createEntry("message", {
        role: "custom",
        type: "yesimbot.message",
        data: {
          user: { name: "Alice" },
          elements: [
            { type: "text", attrs: { content: "hello" }, children: [] },
            { type: "img", attrs: {}, children: [] },
            { type: "at", attrs: { name: "Bob" }, children: [] },
            { type: "file", attrs: {}, children: [] },
            { type: "p", attrs: {}, children: [{ type: "text", attrs: { content: "nested" }, children: [] }] },
          ],
        },
      } as unknown as AgentMessage),
      createEntry("message", {
        role: "assistant",
        id: "a",
        timestamp: 1,
        content: [
          { type: "text", text: "answered" },
          { type: "tool-call", toolCallId: "call", toolName: "tool", input: {} },
        ],
      } as unknown as AgentMessage),
      createEntry("message", {
        role: "custom",
        type: "yesimbot.event",
        data: { text: "notified" },
      } as unknown as AgentMessage),
      createEntry("message", {
        role: "user",
        id: "u",
        timestamp: 1,
        content: "internal user",
      } as unknown as AgentMessage),
      createEntry("message", { role: "tool", id: "t", timestamp: 1, content: [] } as unknown as AgentMessage),
    ];

    expect(filterEntriesForCompression(entries)).toBe(
      "[Alice]: hello[图片]@Bob[文件]nested\n[assistant]: answered\n[事件]: notified",
    );
  });
});

describe("executeCompact", () => {
  it("sends the compact prompts and returns a trimmed summary", async () => {
    mockGenerateText.mockResolvedValueOnce({ text: "  remembered context  " });
    const signal = new AbortController().signal;

    await expect(
      executeCompact({
        model: mockModel,
        personaName: "Athena",
        persona: "persona text",
        previousMemory: "older memory",
        conversation: "recent conversation",
        signal,
      }),
    ).resolves.toBe("remembered context");

    expect(mockGenerateText).toHaveBeenCalledWith({
      model: expect.any(Object),
      system: "你是 Athena 的记忆整理器。将近期对话压缩为第一人称的情景化记忆。",
      prompt: expect.stringContaining("<previous_memory>\nolder memory\n</previous_memory>"),
      abortSignal: signal,
    });
  });

  it("rejects an empty compact summary", async () => {
    mockGenerateText.mockResolvedValueOnce({ text: "  " });

    await expect(
      executeCompact({
        model: mockModel,
        personaName: "Athena",
        persona: "persona text",
        previousMemory: "",
        conversation: "recent conversation",
      }),
    ).rejects.toThrow("Compaction produced an empty summary.");
  });
});

describe("compact plugin trigger", () => {
  const mockPersona = vi.fn().mockResolvedValue({ name: "Athena", content: "I am Athena." });

  beforeEach(() => {
    vi.clearAllMocks();
    mockPersona.mockResolvedValue({ name: "Athena", content: "I am Athena." });
  });

  it("triggers compaction when usage exceeds threshold", async () => {
    mockGenerateText.mockResolvedValue({ text: "Conversation summary." });

    const storage = createMemoryStorage(makeMessages(25));
    const plugin = createCompactPlugin({
      model: mockModel,
      threshold: 0.9,
      contextLength: 100_000,
      minMessages: 20,
      maxFailures: 3,
      persona: mockPersona,
      logger: mockLogger,
    });

    plugin.init!(makeMockRuntime(storage));

    await plugin.onTurnFinish!(
      { turnId: "t1", status: "done", messages: [], usage: { inputTokens: 95_000 } } as TurnResult,
      {} as TurnFinishContext,
    );

    await vi.waitFor(async () => {
      const entries = await storage.read();
      const compact = entries.find((e) => e.type === "compact");
      expect(compact).toBeDefined();
      expect((compact!.data as { summary: string }).summary).toBe("Conversation summary.");
    });
    expect(mockGenerateText).toHaveBeenCalledOnce();
  });

  it("skips when message count below minMessages", async () => {
    mockGenerateText.mockResolvedValue({ text: "Summary." });

    const storage = createMemoryStorage(makeMessages(5));
    const plugin = createCompactPlugin({
      model: mockModel,
      threshold: 0.9,
      contextLength: 100_000,
      minMessages: 20,
      maxFailures: 3,
      persona: mockPersona,
      logger: mockLogger,
    });

    plugin.init!(makeMockRuntime(storage));

    await plugin.onTurnFinish!(
      { turnId: "t1", status: "done", messages: [], usage: { inputTokens: 95_000 } } as TurnResult,
      {} as TurnFinishContext,
    );

    const entries = await storage.read();
    const compact = entries.find((e) => e.type === "compact");
    expect(compact).toBeUndefined();
    expect(mockGenerateText).not.toHaveBeenCalled();
  });

  it("falls back to char estimation when usage is null", async () => {
    mockGenerateText.mockResolvedValue({ text: "Char-based summary." });

    // 25 messages with content "message N" (~9 chars each) = ~225 chars
    // contextLength=100, charTokenRatio=1.0, threshold=0.9 => 100*1.0*0.9=90
    // 225 >= 90 so should trigger
    const storage = createMemoryStorage(makeMessages(25));
    const plugin = createCompactPlugin({
      model: mockModel,
      threshold: 0.9,
      contextLength: 100,
      charTokenRatio: 1.0,
      minMessages: 20,
      maxFailures: 3,
      persona: mockPersona,
      logger: mockLogger,
    });

    plugin.init!(makeMockRuntime(storage));

    await plugin.onTurnFinish!(
      { turnId: "t1", status: "done", messages: [], usage: undefined } as TurnResult,
      {} as TurnFinishContext,
    );

    await vi.waitFor(async () => {
      expect((await storage.read()).some((entry) => entry.type === "compact")).toBe(true);
    });
    expect(mockGenerateText).toHaveBeenCalledOnce();
  });

  it("returns before a slow threshold compaction finishes", async () => {
    let release!: (value: { text: string }) => void;
    mockGenerateText.mockReturnValueOnce(new Promise((resolve) => (release = resolve)));
    const storage = createMemoryStorage(makeMessages(25));
    const plugin = createCompactPlugin({
      model: mockModel,
      threshold: 0.9,
      contextLength: 100_000,
      minMessages: 20,
      persona: mockPersona,
      logger: mockLogger,
    });
    plugin.init!(makeMockRuntime(storage));

    let finished = false;
    const finish = plugin.onTurnFinish!(
      { turnId: "t1", status: "done", messages: [], usage: { inputTokens: 95_000 } } as TurnResult,
      {} as TurnFinishContext,
    );
    void finish.then(() => {
      finished = true;
    });
    await vi.waitFor(() => expect(finished).toBe(true));
    expect((await storage.read()).some((entry) => entry.type === "compact")).toBe(false);

    release({ text: "Slow summary." });
    await vi.waitFor(async () => {
      expect((await storage.read()).some((entry) => entry.type === "compact")).toBe(true);
    });
  });

  it("sizes fallback input from the latest compact boundary", async () => {
    const entries = [
      ...makeMessages(100, "x".repeat(100)),
      createEntry("compact", { summary: "short", lastEntryId: "e99" }, { id: "compact-1" }),
      ...makeMessages(20),
    ];
    const storage = createMemoryStorage(entries);
    const plugin = createCompactPlugin({
      model: mockModel,
      threshold: 0.9,
      contextLength: 500,
      charTokenRatio: 1,
      minMessages: 20,
      persona: mockPersona,
      logger: mockLogger,
    });
    plugin.init!(makeMockRuntime(storage));

    await plugin.onTurnFinish!(
      { turnId: "t1", status: "done", messages: [], usage: undefined } as TurnResult,
      {} as TurnFinishContext,
    );
    for (let index = 0; index < 5; index++) await Promise.resolve();

    expect(mockGenerateText).not.toHaveBeenCalled();
  });

  it("reports live consecutive failures", async () => {
    mockGenerateText.mockRejectedValue(new Error("model unavailable"));
    let getFailures!: () => number;
    const storage = createMemoryStorage(makeMessages(25));
    const plugin = createCompactPlugin({
      model: mockModel,
      threshold: 0.9,
      contextLength: 100_000,
      minMessages: 20,
      maxFailures: 3,
      persona: mockPersona,
      logger: mockLogger,
      onCompactStatus: (status) => (getFailures = status),
    });
    plugin.init!(makeMockRuntime(storage));

    await plugin.onTurnFinish!(
      { turnId: "t1", status: "done", messages: [], usage: { inputTokens: 95_000 } } as TurnResult,
      {} as TurnFinishContext,
    );

    await vi.waitFor(() => expect(getFailures()).toBe(1));
  });

  it("writes hard truncation after maxFailures consecutive failures", async () => {
    mockGenerateText.mockRejectedValue(new Error("model unavailable"));

    const storage = createMemoryStorage(makeMessages(25));
    const plugin = createCompactPlugin({
      model: mockModel,
      threshold: 0.9,
      contextLength: 100_000,
      minMessages: 20,
      maxFailures: 3,
      persona: mockPersona,
      logger: mockLogger,
    });
    plugin.init!(makeMockRuntime(storage));

    const triggerArgs: Parameters<NonNullable<typeof plugin.onTurnFinish>> = [
      { turnId: "t1", status: "done", messages: [], usage: { inputTokens: 95_000 } } as TurnResult,
      {} as TurnFinishContext,
    ];

    await plugin.onTurnFinish!(...triggerArgs);
    await vi.waitFor(() => expect(mockLogger.warn).toHaveBeenCalledTimes(1));
    await plugin.onTurnFinish!(...triggerArgs);
    await vi.waitFor(() => expect(mockLogger.warn).toHaveBeenCalledTimes(2));
    await plugin.onTurnFinish!(...triggerArgs);
    await vi.waitFor(() => expect(mockLogger.warn).toHaveBeenCalledWith("compact.hard_truncation"));

    const entries = await storage.read();
    const compact = entries.find((e) => e.type === "compact");
    expect(compact).toBeDefined();
    expect((compact! as AgentEntry<"compact">).data.summary).toBe("（由于上下文长度限制，更早的对话记录已被省略）");
  });

  it("resets failure count on successful compaction", async () => {
    mockGenerateText
      .mockRejectedValueOnce(new Error("fail 1"))
      .mockRejectedValueOnce(new Error("fail 2"))
      .mockResolvedValueOnce({ text: "Success summary." })
      .mockRejectedValueOnce(new Error("fail after reset"));

    const storage = createMemoryStorage(makeMessages(25));
    const plugin = createCompactPlugin({
      model: mockModel,
      threshold: 0.9,
      contextLength: 100_000,
      minMessages: 1,
      maxFailures: 3,
      persona: mockPersona,
      logger: mockLogger,
    });
    plugin.init!(makeMockRuntime(storage));

    const triggerArgs: Parameters<NonNullable<typeof plugin.onTurnFinish>> = [
      { turnId: "t1", status: "done", messages: [], usage: { inputTokens: 95_000 } } as TurnResult,
      {} as TurnFinishContext,
    ];

    await plugin.onTurnFinish!(...triggerArgs);
    await vi.waitFor(() => expect(mockLogger.warn).toHaveBeenCalledTimes(1));
    await plugin.onTurnFinish!(...triggerArgs);
    await vi.waitFor(() => expect(mockLogger.warn).toHaveBeenCalledTimes(2));
    await plugin.onTurnFinish!(...triggerArgs);
    await vi.waitFor(async () => {
      const entries = await storage.read();
      expect(entries.find((e) => e.type === "compact")).toBeDefined();
    });

    const entriesAfterSuccess = await storage.read();
    const successCompact = entriesAfterSuccess.find((e) => e.type === "compact");
    expect(successCompact).toBeDefined();
    expect((successCompact! as AgentEntry<"compact">).data.summary).toBe("Success summary.");

    await storage.append(makeMessages(1)[0]);
    await plugin.onTurnFinish!(...triggerArgs);
    await vi.waitFor(() => expect(mockLogger.warn).toHaveBeenCalledTimes(3));

    const entriesAfterFail = await storage.read();
    const hardTruncation = entriesAfterFail.find(
      (entry) => entry.type === "compact" && entry.data.summary === "（由于上下文长度限制，更早的对话记录已被省略）",
    );
    expect(hardTruncation).toBeUndefined();
    expect(mockLogger.warn).not.toHaveBeenCalledWith("compact.hard_truncation");
  });
});
