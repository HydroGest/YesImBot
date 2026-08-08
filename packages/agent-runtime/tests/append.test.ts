import type {
  LanguageModelV3,
  LanguageModelV3CallOptions,
  LanguageModelV3FinishReason,
  LanguageModelV3Message,
  LanguageModelV3StreamPart,
} from "@ai-sdk/provider";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { createAgent } from "../src/agent.js";
import { AgentEntry } from "../src/entry.js";
import { createCustomMessage, createUserMessage } from "../src/message.js";
import { AgentPlugin } from "../src/plugin.js";
import { createMemoryStorage } from "../src/storage.js";

function flattenPromptContent(message: LanguageModelV3Message) {
  if (typeof message.content === "string") {
    return message.content;
  }

  return message.content
    .map((part) => {
      if (part.type === "text") {
        return part.text;
      }
      if (part.type === "tool-call") {
        return { type: part.type, toolName: part.toolName, toolCallId: part.toolCallId };
      }
      if (part.type === "tool-result") {
        return { type: part.type, toolName: part.toolName, toolCallId: part.toolCallId };
      }
      return { type: part.type };
    })
    .flat();
}

function createToolLoopModel(modelRequests: LanguageModelV3Message[][]) {
  const stopReason = "stop" as unknown as LanguageModelV3FinishReason;
  const toolCallsReason = "tool-calls" as unknown as LanguageModelV3FinishReason;

  return {
    specificationVersion: "v3",
    provider: "mock-provider",
    modelId: "mock-model",
    supportedUrls: {},
    async doGenerate() {
      throw new Error("not implemented");
    },
    async doStream(options: LanguageModelV3CallOptions) {
      modelRequests.push(options.prompt);

      if (modelRequests.length === 1) {
        return {
          stream: new ReadableStream<LanguageModelV3StreamPart>({
            start(controller) {
              controller.enqueue({ type: "stream-start", warnings: [] });
              controller.enqueue({ type: "tool-input-start", id: "call_1", toolName: "lookup" });
              controller.enqueue({
                type: "tool-input-delta",
                id: "call_1",
                delta: '{"value":"trigger"}',
              });
              controller.enqueue({ type: "tool-input-end", id: "call_1" });
              controller.enqueue({
                type: "tool-call",
                toolCallId: "call_1",
                toolName: "lookup",
                input: '{"value":"trigger"}',
              });
              controller.enqueue({
                type: "finish",
                finishReason: toolCallsReason,
                usage: {
                  inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
                  outputTokens: { total: 1, text: 0, reasoning: 0 },
                },
              });
              controller.close();
            },
          }),
        };
      }

      return {
        stream: new ReadableStream<LanguageModelV3StreamPart>({
          start(controller) {
            controller.enqueue({ type: "stream-start", warnings: [] });
            controller.enqueue({ type: "text-start", id: "text_2" });
            controller.enqueue({ type: "text-delta", id: "text_2", delta: "done" });
            controller.enqueue({ type: "text-end", id: "text_2" });
            controller.enqueue({
              type: "finish",
              finishReason: stopReason,
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

function createChainedToolLoopModel(modelRequests: LanguageModelV3Message[][]) {
  const stopReason = "stop" as unknown as LanguageModelV3FinishReason;
  const toolCallsReason = "tool-calls" as unknown as LanguageModelV3FinishReason;

  return {
    specificationVersion: "v3",
    provider: "mock-provider",
    modelId: "mock-model",
    supportedUrls: {},
    async doGenerate() {
      throw new Error("not implemented");
    },
    async doStream(options: LanguageModelV3CallOptions) {
      modelRequests.push(options.prompt);

      const callNumber = modelRequests.length;
      if (callNumber <= 2) {
        const callId = `call_${callNumber}`;
        return {
          stream: new ReadableStream<LanguageModelV3StreamPart>({
            start(controller) {
              controller.enqueue({ type: "stream-start", warnings: [] });
              controller.enqueue({ type: "tool-input-start", id: callId, toolName: "lookup" });
              controller.enqueue({
                type: "tool-input-delta",
                id: callId,
                delta: `{"value":"step-${callNumber}"}`,
              });
              controller.enqueue({ type: "tool-input-end", id: callId });
              controller.enqueue({
                type: "tool-call",
                toolCallId: callId,
                toolName: "lookup",
                input: `{"value":"step-${callNumber}"}`,
              });
              controller.enqueue({
                type: "finish",
                finishReason: toolCallsReason,
                usage: {
                  inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
                  outputTokens: { total: 1, text: 0, reasoning: 0 },
                },
              });
              controller.close();
            },
          }),
        };
      }

      return {
        stream: new ReadableStream<LanguageModelV3StreamPart>({
          start(controller) {
            controller.enqueue({ type: "stream-start", warnings: [] });
            controller.enqueue({ type: "text-start", id: "text_3" });
            controller.enqueue({ type: "text-delta", id: "text_3", delta: "done" });
            controller.enqueue({ type: "text-end", id: "text_3" });
            controller.enqueue({
              type: "finish",
              finishReason: stopReason,
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

function createTextModel(modelRequests: LanguageModelV3Message[][]) {
  const stopReason = "stop" as unknown as LanguageModelV3FinishReason;

  return {
    specificationVersion: "v3",
    provider: "mock-provider",
    modelId: "mock-model",
    supportedUrls: {},
    async doGenerate() {
      throw new Error("not implemented");
    },
    async doStream(options: LanguageModelV3CallOptions) {
      modelRequests.push(options.prompt);
      return {
        stream: new ReadableStream<LanguageModelV3StreamPart>({
          start(controller) {
            controller.enqueue({ type: "stream-start", warnings: [] });
            controller.enqueue({ type: "text-start", id: "text_1" });
            controller.enqueue({ type: "text-delta", id: "text_1", delta: "done" });
            controller.enqueue({ type: "text-end", id: "text_1" });
            controller.enqueue({
              type: "finish",
              finishReason: stopReason,
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

describe("append", () => {
  it("does not persist the same message again when append is followed by run", async () => {
    const storage = createMemoryStorage();
    const agent = createAgent({ model: createTextModel([]), storage });
    const message = createCustomMessage("test.event", { value: "committed" });

    await agent.append(message);
    await Array.fromAsync(agent.run(message));

    const entries = await storage.read();
    expect(entries.filter((entry) => entry.type === "message" && entry.data.id === message.id)).toHaveLength(1);
  });

  it("does not persist the same message again when append is followed by busy join", async () => {
    const modelRequests: LanguageModelV3Message[][] = [];
    let releaseTool: (() => void) | undefined;
    const toolReady = new Promise<void>((resolve) => {
      releaseTool = resolve;
    });
    const agent = createAgent({
      model: createToolLoopModel(modelRequests),
      tools: [
        {
          name: "lookup",
          inputSchema: z.object({ value: z.string() }),
          execute: async () => {
            await toolReady;
            return { ok: true };
          },
        } as never,
      ],
    });
    const started = new Promise<void>((resolve) => {
      const unsubscribe = agent.channel.subscribe("internal", (event) => {
        if (event.type === "tool.start") {
          unsubscribe();
          resolve();
        }
      });
    });
    const message = createCustomMessage("test.event", { value: "committed" });

    agent.send(createUserMessage("trigger"));
    await started;
    await agent.append(message);
    agent.send(message, { ifBusy: "join" });
    releaseTool?.();
    await agent.wait();

    const entries = await agent.storage.read();
    expect(entries.filter((entry) => entry.type === "message" && entry.data.id === message.id)).toHaveLength(1);
  });

  it("persists messages through append hooks after initializing stable resources", async () => {
    const storage = createMemoryStorage();
    const transformMessages = vi.fn<NonNullable<AgentPlugin["transformMessages"]>>();
    const toModelMessages = vi.fn<NonNullable<AgentPlugin["toModelMessages"]>>();
    const extendSystemPrompt = vi.fn<NonNullable<AgentPlugin["extendSystemPrompt"]>>();
    const extendTools = vi.fn<NonNullable<AgentPlugin["extendTools"]>>();
    const beforeToolCall = vi.fn<NonNullable<AgentPlugin["beforeToolCall"]>>();
    const afterToolCall = vi.fn<NonNullable<AgentPlugin["afterToolCall"]>>();
    const onTurnFinish = vi.fn<NonNullable<AgentPlugin["onTurnFinish"]>>();

    const agent = createAgent({
      model: {} as never,
      storage,
      plugins: [
        {
          name: "append-only",
          onAppend(entries) {
            return entries;
          },
          transformMessages,
          toModelMessages,
          extendSystemPrompt,
          extendTools,
          beforeToolCall,
          afterToolCall,
          onTurnFinish,
        },
      ],
    });

    await agent.append(createUserMessage("observed"));

    const entries = await storage.read();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      type: "message",
      data: { role: "user", content: "observed" },
    });
    expect(transformMessages).not.toHaveBeenCalled();
    expect(toModelMessages).not.toHaveBeenCalled();
    expect(extendSystemPrompt).not.toHaveBeenCalled();
    expect(extendTools).toHaveBeenCalledOnce();
    expect(beforeToolCall).not.toHaveBeenCalled();
    expect(afterToolCall).not.toHaveBeenCalled();
    expect(onTurnFinish).not.toHaveBeenCalled();
  });

  it("persists transformed append entries and emits message.appended", async () => {
    const storage = createMemoryStorage();
    const agent = createAgent({
      model: {} as never,
      storage,
      plugins: [
        {
          name: "append-transform",
          onAppend(entries): AgentEntry[] {
            return entries.map((entry) =>
              entry.type === "message" && entry.data.role === "user"
                ? {
                    ...entry,
                    data: createUserMessage(`${entry.data.content} transformed`),
                  }
                : entry,
            );
          },
        },
      ],
    });

    const seen: Array<{ type: string; hasTurnId: boolean }> = [];
    agent.channel.subscribe("internal", (event) => {
      if (event.type === "message.appended") {
        seen.push({ type: event.type, hasTurnId: "turnId" in event });
      }
    });

    await agent.append(createUserMessage("event"));

    expect(seen).toEqual([{ type: "message.appended", hasTurnId: false }]);
    expect(await storage.read()).toMatchObject([
      {
        type: "message",
        data: { content: "event transformed" },
      },
    ]);
  });

  it("does not block append completion when message.appended listeners await append", async () => {
    const agent = createAgent({ model: {} as never });
    let appendedFollowUp = false;
    let listenerDoneResolve: (() => void) | undefined;
    const listenerDone = new Promise<void>((resolve) => {
      listenerDoneResolve = resolve;
    });

    agent.channel.subscribe("internal", async (event) => {
      if (event.type !== "message.appended" || appendedFollowUp) {
        return;
      }

      appendedFollowUp = true;
      await agent.append(createUserMessage("follow-up"));
      listenerDoneResolve?.();
    });

    const result = await Promise.race([
      agent.append(createUserMessage("first")),
      new Promise<symbol>((resolve) => {
        setTimeout(() => resolve(Symbol.for("timeout")), 100);
      }),
    ]);

    expect(result).not.toBe(Symbol.for("timeout"));
    await listenerDone;
    expect(await agent.storage.read()).toMatchObject([
      { type: "message", data: { content: "first" } },
      { type: "message", data: { content: "follow-up" } },
    ]);
  });

  it("does not duplicate current input when storage clones entries on read", async () => {
    const modelRequests: LanguageModelV3Message[][] = [];
    const baseStorage = createMemoryStorage();
    const storage = {
      append: baseStorage.append,
      clear: baseStorage.clear,
      async read() {
        return structuredClone(await baseStorage.read());
      },
    };
    const agent = createAgent({
      model: createTextModel(modelRequests),
      storage,
    });

    await agent.wait();
    expect(agent.isIdle()).toBe(true);
    expect(modelRequests[0].map(flattenPromptContent)).toEqual([["hello"]]);
  });

  it("uses transformed append entries as the current model input", async () => {
    const modelRequests: LanguageModelV3Message[][] = [];
    const agent = createAgent({
      model: createTextModel(modelRequests),
      plugins: [
        {
          name: "rewrite-current",
          onAppend(entries): AgentEntry[] {
            return entries.map((entry) =>
              entry.type === "message" && entry.data.role === "user"
                ? {
                    ...entry,
                    data: createUserMessage(`${entry.data.content} transformed`),
                  }
                : entry,
            );
          },
        },
      ],
    });

    agent.send(createUserMessage("hello"));

    await agent.wait();
    const entries = await agent.storage.read();
    const messages = entries.filter((entry) => entry.type === "message").map((entry) => entry.data);
    expect(messages[0]).toMatchObject({ role: "user", content: "hello transformed" });
    expect(modelRequests[0].map(flattenPromptContent)).toEqual([["hello transformed"]]);
  });

  it("makes active turn appends visible at the next model boundary without joining input", async () => {
    const modelRequests: LanguageModelV3Message[][] = [];
    let releaseTool: (() => void) | undefined;
    const toolReady = new Promise<void>((resolve) => {
      releaseTool = resolve;
    });
    const agent = createAgent({
      model: createToolLoopModel(modelRequests),
      tools: [
        {
          name: "lookup",
          inputSchema: z.object({ value: z.string() }),
          execute: async () => {
            await toolReady;
            return { ok: true };
          },
        } as never,
      ],
    });

    const started = new Promise<void>((resolve) => {
      const unsubscribe = agent.channel.subscribe("internal", (event) => {
        if (event.type === "tool.start") {
          unsubscribe();
          resolve();
        }
      });
    });

    await started;
    await agent.append(createUserMessage("observed while busy"));
    releaseTool?.();

    await agent.wait();
    expect(agent.isIdle()).toBe(true);

    expect(modelRequests).toHaveLength(2);
    expect(modelRequests[1].map(flattenPromptContent)).toEqual([
      ["trigger"],
      ["observed while busy"],
      [expect.objectContaining({ type: "tool-call", toolName: "lookup" })],
      [expect.objectContaining({ type: "tool-result", toolName: "lookup" })],
    ]);
  });

  it("replays tool results as normalized tool messages only", async () => {
    const modelRequests: LanguageModelV3Message[][] = [];
    const agent = createAgent({
      model: createToolLoopModel(modelRequests),
      tools: [
        {
          name: "lookup",
          inputSchema: z.object({ value: z.string() }),
          execute: async () => ({ ok: true }),
        } as never,
      ],
    });

    await agent.wait();
    expect(agent.isIdle()).toBe(true);
    expect(modelRequests).toHaveLength(2);

    const secondPrompt = modelRequests[1];
    expect(secondPrompt.map((message) => message.role)).toEqual(["user", "assistant", "tool"]);

    const assistantContent = secondPrompt[1].content;
    expect(Array.isArray(assistantContent)).toBe(true);
    expect(assistantContent).toEqual([expect.objectContaining({ type: "tool-call", toolName: "lookup" })]);

    const toolContent = secondPrompt[2].content;
    expect(Array.isArray(toolContent)).toBe(true);
    expect(toolContent).toEqual([
      expect.objectContaining({
        type: "tool-result",
        toolName: "lookup",
        output: { type: "json", value: { ok: true } },
      }),
    ]);
  });

  it("does not duplicate prior response messages at later tool-loop boundaries", async () => {
    const modelRequests: LanguageModelV3Message[][] = [];
    const agent = createAgent({
      model: createChainedToolLoopModel(modelRequests),
      tools: [
        {
          name: "lookup",
          inputSchema: z.object({ value: z.string() }),
          execute: async ({ value }: { value: string }) => ({ value }),
        } as never,
      ],
    });

    await agent.wait();
    expect(agent.isIdle()).toBe(true);
    expect(modelRequests).toHaveLength(3);
    expect(modelRequests[2].map(flattenPromptContent)).toEqual([
      ["trigger"],
      [expect.objectContaining({ type: "tool-call", toolCallId: "call_1" })],
      [expect.objectContaining({ type: "tool-result", toolCallId: "call_1" })],
      [expect.objectContaining({ type: "tool-call", toolCallId: "call_2" })],
      [expect.objectContaining({ type: "tool-result", toolCallId: "call_2" })],
    ]);

    const persistedMessages = (await agent.storage.read()).filter((entry) => entry.type === "message");
    expect(
      persistedMessages.filter(
        (entry) => entry.data.role === "tool" && entry.data.content.some((part) => part.type === "tool-result" && part.toolCallId === "call_1"),
      ),
    ).toHaveLength(1);
  });

  it("waits for queued append pipelines and preserves call order at model boundaries", async () => {
    const modelRequests: LanguageModelV3Message[][] = [];
    let releaseTool: (() => void) | undefined;
    let releaseSlowAppend: (() => void) | undefined;
    const toolReady = new Promise<void>((resolve) => {
      releaseTool = resolve;
    });
    const slowAppendReady = new Promise<void>((resolve) => {
      releaseSlowAppend = resolve;
    });
    const agent = createAgent({
      model: createToolLoopModel(modelRequests),
      tools: [
        {
          name: "lookup",
          inputSchema: z.object({ value: z.string() }),
          execute: async () => {
            await toolReady;
            return { ok: true };
          },
        } as never,
      ],
      plugins: [
        {
          name: "slow-first-append",
          async onAppend(entries) {
            if (entries.some((entry) => entry.type === "message" && entry.data.role === "user" && entry.data.content === "slow observation")) {
              await slowAppendReady;
            }
            return entries;
          },
        },
      ],
    });

    const started = new Promise<void>((resolve) => {
      const unsubscribe = agent.channel.subscribe("internal", (event) => {
        if (event.type === "tool.start") {
          unsubscribe();
          resolve();
        }
      });
    });

    await started;
    const slowAppend = agent.append(createUserMessage("slow observation"));
    const fastAppend = agent.append(createUserMessage("fast observation"));
    releaseTool?.();
    await Promise.resolve();
    releaseSlowAppend?.();

    await Promise.all([slowAppend, fastAppend]);
    await agent.wait();
    expect(agent.isIdle()).toBe(true);

    expect(modelRequests).toHaveLength(2);
    expect(modelRequests[1].map(flattenPromptContent).slice(0, 3)).toEqual([["trigger"], ["slow observation"], ["fast observation"]]);
  });

  it("keeps joined busy input explicit at the tool-loop boundary while appended observations come from history", async () => {
    const modelRequests: LanguageModelV3Message[][] = [];
    let releaseTool: (() => void) | undefined;
    const toolReady = new Promise<void>((resolve) => {
      releaseTool = resolve;
    });
    const agent = createAgent({
      model: createToolLoopModel(modelRequests),
      tools: [
        {
          name: "lookup",
          inputSchema: z.object({ value: z.string() }),
          execute: async () => {
            await toolReady;
            return { ok: true };
          },
        } as never,
      ],
    });

    const started = new Promise<void>((resolve) => {
      const unsubscribe = agent.channel.subscribe("internal", (event) => {
        if (event.type === "tool.start") {
          unsubscribe();
          resolve();
        }
      });
    });

    await started;
    await agent.append(createUserMessage("observed while busy"));
    agent.send(createUserMessage("joined while busy"), { ifBusy: "join" });
    releaseTool?.();

    await agent.wait();

    const entries = await agent.storage.read();
    const joined = entries.filter((entry) => entry.type === "message" && entry.data.role === "user" && entry.data.content === "joined while busy");
    expect(joined).toHaveLength(1);

    expect(modelRequests).toHaveLength(2);
    expect(modelRequests[1].map(flattenPromptContent)).toEqual([
      ["trigger"],
      ["observed while busy"],
      [expect.objectContaining({ type: "tool-call", toolName: "lookup" })],
      [expect.objectContaining({ type: "tool-result", toolName: "lookup" })],
      ["joined while busy"],
    ]);
  });
});
