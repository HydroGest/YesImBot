import type { LanguageModel } from "ai";
import { describe, expect, it, vi } from "vitest";

import { createAgent, createEntry, createMemoryStorage } from "../src/index.js";
import type { AgentEntry, AgentMessage } from "../src/index.js";

describe("transformEntries hook", () => {
  it("plugin can filter entries before model context is built", async () => {
    const transformFn = vi.fn((entries: readonly AgentEntry[]) => entries.filter((entry) => entry.type === "message"));

    const plugin: AgentPlugin = { name: "test-transform", transformEntries: transformFn };

    const storage = createMemoryStorage([
      createEntry("message", { role: "user", id: "m1", timestamp: 1, content: "hello" } as AgentMessage),
      createEntry("state", { version: 1 } as AgentEntry<"state">["data"]),
      createEntry("message", { role: "assistant", id: "m2", timestamp: 2, content: "hi" } as AgentMessage),
    ]);

    const mockModel = {
      doGenerate: vi.fn().mockResolvedValue({ text: "response", finishReason: "stop", usage: { promptTokens: 10, completionTokens: 5 } }),
      provider: "mock",
      modelId: "mock-model",
      specificationVersion: "v1",
    } as unknown as LanguageModel;

    const agent = createAgent({ model: mockModel, storage, plugins: [plugin], systemPrompt: "test" });

    await agent.init();
    expect(transformFn).not.toHaveBeenCalled();
  });

  it("transformEntries is called when collecting history entries", async () => {
    const callCount: number[] = [];
    const returnedCounts: number[] = [];
    const filterPlugin: AgentPlugin = {
      name: "filter-plugin",
      transformEntries(entries) {
        callCount.push(entries.length);
        const filtered = entries.filter((e) => e.type === "message");
        returnedCounts.push(filtered.length);
        return filtered;
      },
    };

    const storage = createMemoryStorage([
      createEntry("message", { role: "user", id: "m1", timestamp: 1, content: [] } as AgentMessage),
      createEntry("state", { version: 1 } as AgentEntry<"state">["data"]),
      createEntry("message", { role: "assistant", id: "m2", timestamp: 2, content: [] } as AgentMessage),
    ]);

    let _doGenerateCalled = false;
    const mockModel = {
      specificationVersion: "v1" as const,
      provider: "mock",
      modelId: "mock-model",
      doGenerate: vi.fn().mockImplementation(async () => {
        _doGenerateCalled = true;
        return {
          content: [{ type: "text", text: "response" }],
          finishReason: "stop",
          usage: { inputTokens: 10, outputTokens: 5 },
          rawCall: { rawPrompt: [], rawSettings: {} },
        };
      }),
    } as unknown as LanguageModel;

    const agent = createAgent({ model: mockModel, storage, plugins: [filterPlugin], systemPrompt: "test" });

    await agent.wait();

    expect(callCount.length).toBeGreaterThan(0);
    for (const count of callCount) {
      expect(count).toBeGreaterThan(0);
    }
    for (const returned of returnedCounts) {
      expect(returned).toBeLessThanOrEqual(callCount[0]);
    }
  });
});
