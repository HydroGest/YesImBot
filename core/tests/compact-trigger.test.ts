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

import { createCompactPlugin } from "../src/runtime/compact/index.js";

const mockGenerateText = vi.hoisted(() => vi.fn());

vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof Ai>();
  return {
    ...actual,
    generateText: mockGenerateText,
  };
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

describe("compact plugin trigger", () => {
  const mockLogger = { warn: vi.fn() };
  const mockPersona = vi.fn().mockResolvedValue({ name: "Athena", content: "I am Athena." });
  // The mocked AI SDK only forwards the model identity.
  const mockModel = {} as LanguageModel;

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
