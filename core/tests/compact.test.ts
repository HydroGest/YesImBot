import { createEntry } from "@yesimbot/agent-runtime";
import type { AgentEntry, AgentMessage } from "@yesimbot/agent-runtime";
import type * as Ai from "ai";
import type { LanguageModel } from "ai";
import { describe, expect, it, vi } from "vitest";

import { executeCompact, filterEntriesForCompression, transformCompactEntries } from "../src/runtime/compact/index.js";

const mockGenerateText = vi.hoisted(() => vi.fn());
// The mocked AI SDK only forwards the model identity.
const mockModel = {} as LanguageModel;

vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof Ai>();
  return { ...actual, generateText: mockGenerateText };
});

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
