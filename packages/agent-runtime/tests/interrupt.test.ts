import type { LanguageModelV3, LanguageModelV3CallOptions, LanguageModelV3FinishReason, LanguageModelV3StreamPart } from "@ai-sdk/provider";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { createAgent } from "../src/agent.js";
import { createUserMessage } from "../src/message.js";

function createInterruptibleModel() {
  return {
    specificationVersion: "v3",
    provider: "mock-provider",
    modelId: "mock-model",
    supportedUrls: {},
    async doGenerate() {
      throw new Error("not implemented");
    },
    async doStream(options: LanguageModelV3CallOptions) {
      if (options.abortSignal?.aborted) {
        throw new DOMException("Aborted", "AbortError");
      }

      return {
        stream: new ReadableStream<LanguageModelV3StreamPart>({
          start(controller) {
            controller.enqueue({ type: "stream-start", warnings: [] });
            options.abortSignal?.addEventListener("abort", () => controller.error(new DOMException("Aborted", "AbortError")), { once: true });
          },
        }),
      };
    },
  } as unknown as LanguageModelV3;
}

function createTextModel(text = "ok") {
  const finishReason = "stop" as unknown as LanguageModelV3FinishReason;

  return {
    specificationVersion: "v3",
    provider: "mock-provider",
    modelId: "mock-model",
    supportedUrls: {},
    async doGenerate() {
      throw new Error("not implemented");
    },
    async doStream() {
      return {
        stream: new ReadableStream<LanguageModelV3StreamPart>({
          start(controller) {
            controller.enqueue({ type: "stream-start", warnings: [] });
            controller.enqueue({ type: "text-start", id: "text_1" });
            controller.enqueue({ type: "text-delta", id: "text_1", delta: text });
            controller.enqueue({ type: "text-end", id: "text_1" });
            controller.enqueue({
              type: "finish",
              finishReason,
              usage: { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 1, text: 1, reasoning: 0 } },
            });
            controller.close();
          },
        }),
      };
    },
  } as unknown as LanguageModelV3;
}

function createToolCallModel() {
  const finishReason = "tool-calls" as unknown as LanguageModelV3FinishReason;

  return {
    specificationVersion: "v3",
    provider: "mock-provider",
    modelId: "mock-model",
    supportedUrls: {},
    async doGenerate() {
      throw new Error("not implemented");
    },
    async doStream() {
      return {
        stream: new ReadableStream<LanguageModelV3StreamPart>({
          start(controller) {
            controller.enqueue({ type: "stream-start", warnings: [] });
            controller.enqueue({ type: "tool-input-start", id: "call_1", toolName: "hang" });
            controller.enqueue({ type: "tool-input-end", id: "call_1" });
            controller.enqueue({ type: "tool-call", toolCallId: "call_1", toolName: "hang", input: "{}" });
            controller.enqueue({
              type: "finish",
              finishReason,
              usage: { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 1, text: 0, reasoning: 0 } },
            });
            controller.close();
          },
        }),
      };
    },
  } as unknown as LanguageModelV3;
}

describe("interrupt", () => {
  it("run yields turn.aborted before the stream ends", async () => {
    const agent = createAgent({ model: createInterruptibleModel() });
    const types: string[] = [];
    const stream = agent.run(createUserMessage("hello"));
    const interrupted = agent.interrupt("test");

    for await (const event of stream) {
      types.push(event.type);
    }
    await interrupted;

    expect(types.at(-1)).toBe("turn.aborted");
  });

  it("settles an active turn as aborted", async () => {
    const agent = createAgent({ model: createInterruptibleModel() });
    const events: string[] = [];
    agent.channel.subscribe("internal", (event) => {
      if ("type" in event) events.push(event.type);
    });
    agent.send(createUserMessage("hello"));

    await agent.interrupt("reset");
    await agent.wait();

    expect(agent.isIdle()).toBe(true);
    expect(events).toContain("turn.aborted");
  });

  it("is a no-op without an active turn", async () => {
    const agent = createAgent({ model: createTextModel("ok") });
    await expect(agent.interrupt()).resolves.toBeUndefined();
  });

  it("allows later turns after interrupt", async () => {
    const agent = createAgent({ model: createTextModel("after") });
    const events: string[] = [];
    agent.channel.subscribe("internal", (event) => {
      if (event.type === "turn.aborted" || event.type === "turn.done") {
        events.push(event.type);
      }
    });

    agent.send(createUserMessage("first"));
    await agent.interrupt("test");
    await agent.wait();
    expect(events).toContain("turn.aborted");

    agent.send(createUserMessage("second"));
    await agent.wait();
    expect(events).toContain("turn.done");
    expect(agent.isIdle()).toBe(true);
  });

  it("settles aborted when a running tool does not cooperate with abort", async () => {
    const agent = createAgent({
      model: createToolCallModel(),
      tools: [{ name: "hang", inputSchema: z.object({}), execute: async () => new Promise(() => undefined) } as never],
    });
    const events: string[] = [];
    agent.channel.subscribe("internal", (event) => {
      if (event.type === "turn.aborted") events.push(event.type);
    });
    const toolStarted = new Promise<void>((resolve) => {
      const unsubscribe = agent.channel.subscribe("internal", (event) => {
        if (event.type === "tool.start") {
          unsubscribe();
          resolve();
        }
      });
    });

    agent.send(createUserMessage("use tool"));
    await toolStarted;

    await expect(agent.interrupt("reset")).resolves.toBeUndefined();
    await agent.wait();
    expect(events).toContain("turn.aborted");
    expect(agent.isIdle()).toBe(true);
  });
});
