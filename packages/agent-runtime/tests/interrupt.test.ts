import type {
  LanguageModelV3,
  LanguageModelV3CallOptions,
  LanguageModelV3FinishReason,
  LanguageModelV3StreamPart,
} from "@ai-sdk/provider";
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
            options.abortSignal?.addEventListener(
              "abort",
              () => controller.error(new DOMException("Aborted", "AbortError")),
              { once: true },
            );
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
              usage: {
                inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
                outputTokens: { total: 1, text: 1, reasoning: 0 },
              },
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
            controller.enqueue({
              type: "tool-call",
              toolCallId: "call_1",
              toolName: "hang",
              input: "{}",
            });
            controller.enqueue({
              type: "finish",
              finishReason,
              usage: {
                inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
                outputTokens: { total: 1, text: 0, reasoning: 0 },
              },
            });
            controller.close();
          },
        }),
      };
    },
  } as unknown as LanguageModelV3;
}

describe("interrupt", () => {
  it("settles an active turn as aborted", async () => {
    const agent = createAgent({ model: createInterruptibleModel() });
    const turnId = agent.send(createUserMessage("hello"));

    await agent.interrupt("reset");
    const result = await agent.waitTurn(turnId);

    expect(result.status).toBe("aborted");
  });

  it("is a no-op without an active turn", async () => {
    const agent = createAgent({ model: createTextModel("ok") });
    await expect(agent.interrupt()).resolves.toBeUndefined();
  });

  it("allows later turns after interrupt", async () => {
    const agent = createAgent({ model: createTextModel("after") });
    agent.setTools([]);
    const first = agent.send(createUserMessage("first"));

    await agent.interrupt("test");
    expect((await agent.waitTurn(first)).status).toBe("aborted");

    const second = agent.send(createUserMessage("second"));
    expect((await agent.waitTurn(second)).status).toBe("done");
  });

  it("settles aborted when a running tool does not cooperate with abort", async () => {
    const agent = createAgent({
      model: createToolCallModel(),
      tools: [
        {
          name: "hang",
          inputSchema: z.object({}),
          execute: async () => new Promise(() => undefined),
        } as never,
      ],
    });
    const toolStarted = new Promise<void>((resolve) => {
      const unsubscribe = agent.channel.subscribe("internal", (event) => {
        if (event.type === "tool.start") {
          unsubscribe();
          resolve();
        }
      });
    });

    const turnId = agent.send(createUserMessage("use tool"));
    await toolStarted;

    await expect(agent.interrupt("reset")).resolves.toBeUndefined();
    await expect(agent.waitTurn(turnId)).resolves.toMatchObject({ status: "aborted" });
  });
});
