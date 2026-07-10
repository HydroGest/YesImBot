import type {
  LanguageModelV3,
  LanguageModelV3FinishReason,
  LanguageModelV3CallOptions,
  LanguageModelV3StreamPart,
} from "@ai-sdk/provider";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { createAgent } from "../src/agent.js";
import { ToolConflictError } from "../src/errors.js";
import { createUserMessage } from "../src/message.js";
import { mergeTools, runAfterToolHooks, runBeforeToolHooks } from "../src/tools.js";

function createToolModel() {
  const finishReason = "stop" as unknown as LanguageModelV3FinishReason;
  const observedToolNames: string[][] = [];
  return {
    specificationVersion: "v3",
    provider: "mock-provider",
    modelId: "mock-model",
    supportedUrls: {},
    async doGenerate() {
      throw new Error("not implemented");
    },
    async doStream(options: LanguageModelV3CallOptions) {
      const tools = options.tools ?? {};
      observedToolNames.push(
        Array.isArray(tools)
          ? tools.map((tool) => String((tool as { name: unknown }).name))
          : Object.keys(tools),
      );
      return {
        stream: new ReadableStream<LanguageModelV3StreamPart>({
          start(controller) {
            controller.enqueue({ type: "stream-start", warnings: [] });
            controller.enqueue({ type: "text-start", id: "text_1" });
            controller.enqueue({ type: "text-delta", id: "text_1", delta: "ok" });
            controller.enqueue({ type: "text-end", id: "text_1" });
            controller.enqueue({
              type: "finish",
              finishReason,
              usage: {
                inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
                outputTokens: { total: 1, text: 1, reasoning: 0 },
              },
            } as LanguageModelV3StreamPart);
            controller.close();
          },
        }),
      };
    },
    observedToolNames,
  } as unknown as LanguageModelV3;
}

function createSingleToolCallModel() {
  const stopReason = "stop" as unknown as LanguageModelV3FinishReason;
  const toolCallsReason = "tool-calls" as unknown as LanguageModelV3FinishReason;
  let callCount = 0;

  return {
    specificationVersion: "v3",
    provider: "mock-provider",
    modelId: "mock-model",
    supportedUrls: {},
    async doGenerate() {
      throw new Error("not implemented");
    },
    async doStream() {
      callCount += 1;
      if (callCount === 1) {
        return {
          stream: new ReadableStream<LanguageModelV3StreamPart>({
            start(controller) {
              controller.enqueue({ type: "stream-start", warnings: [] });
              controller.enqueue({ type: "tool-input-start", id: "call_1", toolName: "inspect" });
              controller.enqueue({ type: "tool-input-delta", id: "call_1", delta: "{}" });
              controller.enqueue({ type: "tool-input-end", id: "call_1" });
              controller.enqueue({
                type: "tool-call",
                toolCallId: "call_1",
                toolName: "inspect",
                input: "{}",
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
            controller.enqueue({
              type: "finish",
              finishReason: stopReason,
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

describe("tools", () => {
  it("throws on duplicate tool names", () => {
    expect(() =>
      mergeTools([
        [{ name: "search", inputSchema: z.object({}), execute: async () => "a" } as never],
        [{ name: "search", inputSchema: z.object({}), execute: async () => "b" } as never],
      ]),
    ).toThrow(ToolConflictError);
  });

  it("throws when plugins extend tools with a duplicate name", async () => {
    const model = createToolModel();
    const agent = createAgent({
      model,
      tools: [{ name: "search", inputSchema: z.object({}), execute: async () => "base" } as never],
      plugins: [
        {
          name: "duplicate-tools",
          extendTools(tools) {
            return [
              ...tools,
              { name: "search", inputSchema: z.object({}), execute: async () => "plugin" },
            ] as never;
          },
        },
      ],
    });

    const events: Array<{ type: string; error?: { name?: string } }> = [];
    agent.channel.subscribe("internal", (event) => {
      if (event.type === "turn.failed") {
        events.push(event);
      }
    });
    agent.send(createUserMessage("hello"));
    await agent.wait();
    expect(events).toEqual([
      expect.objectContaining({
        type: "turn.failed",
        error: expect.objectContaining({ name: "ToolConflictError" }),
      }),
    ]);
  });

  it("uses stable plugin tools without running dynamic hooks", async () => {
    const model = createToolModel();
    let createCount = 0;
    const agent = createAgent({
      model,
      plugins: [
        {
          name: "stable-tools",
          tools: () => {
            createCount += 1;
            return [
              {
                name: "stable_lookup",
                inputSchema: z.object({}),
                execute: async () => "ok",
              },
            ] as never;
          },
        },
      ],
    });

    const firstTurnId = agent.send(createUserMessage("hello"));
    await agent.wait();
    expect(agent.isIdle()).toBe(true);
    const secondTurnId = agent.send(createUserMessage("again"));
    await agent.wait();
    expect(agent.isIdle()).toBe(true);

    expect(createCount).toBe(1);
    expect((model as unknown as { observedToolNames: string[][] }).observedToolNames).toEqual([
      ["stable_lookup"],
      ["stable_lookup"],
    ]);
  });

  it("runs dynamic tool extensions after stable tools when present", async () => {
    const model = createToolModel();
    const seen: string[][] = [];
    const agent = createAgent({
      model,
      tools: [{ name: "base", inputSchema: z.object({}), execute: async () => "base" } as never],
      plugins: [
        {
          name: "stable-tools",
          tools: [{ name: "stable", inputSchema: z.object({}), execute: async () => "stable" }],
          extendTools(tools) {
            seen.push(tools.map((tool) => tool.name));
            return [
              ...tools,
              { name: "dynamic", inputSchema: z.object({}), execute: async () => "dynamic" },
            ] as never;
          },
        },
      ],
    });

    const turnId = agent.send(createUserMessage("hello"));
    await agent.wait();
    expect(agent.isIdle()).toBe(true);

    expect(seen).toEqual([["base", "stable"]]);
    expect((model as unknown as { observedToolNames: string[][] }).observedToolNames).toEqual([
      ["base", "stable", "dynamic"],
    ]);
  });

  it("injects turn execution context into stable tool calls", async () => {
    const seen: Array<{
      runtimeId: string;
      toolCallId: string;
      turnId: string;
      hasSignal: boolean;
    }> = [];
    const agent = createAgent({
      id: "runtime_tools",
      model: createSingleToolCallModel(),
      plugins: [
        {
          name: "stable-tools",
          tools: [
            {
              name: "inspect",
              inputSchema: z.object({}),
              execute: async (_input, context) => {
                seen.push({
                  runtimeId: context.runtime.id,
                  toolCallId: context.toolCallId,
                  turnId: context.turnId,
                  hasSignal: context.abortSignal instanceof AbortSignal,
                });
                return "ok";
              },
            },
          ],
        },
      ],
    });

    const turnId = agent.send(createUserMessage("hello"));
    await agent.wait();
    expect(agent.isIdle()).toBe(true);

    expect(seen).toEqual([
      {
        runtimeId: "runtime_tools",
        toolCallId: "call_1",
        turnId,
        hasSignal: true,
      },
    ]);
  });

  it("includes tool events in the run stream", async () => {
    const agent = createAgent({
      model: createSingleToolCallModel(),
      tools: [
        {
          name: "inspect",
          inputSchema: z.object({}),
          execute: async () => "ok",
        } as never,
      ],
    });
    const types: string[] = [];

    for await (const event of agent.run(createUserMessage("hello"))) {
      types.push(event.type);
    }

    expect(types).toContain("tool.start");
    expect(types).toContain("tool.done");
  });

  it("short-circuits before hooks on block", async () => {
    const calls: string[] = [];
    const decision = await runBeforeToolHooks(
      [
        {
          name: "a",
          beforeToolCall: () => {
            calls.push("a");
            return { type: "block", reason: "no" };
          },
        },
        {
          name: "b",

          beforeToolCall: () => {
            calls.push("b");
            return { type: "allow" };
          },
        },
      ],
      { toolCallId: "call_1", toolName: "search", args: {} },
      {} as never,
    );

    expect(decision).toEqual({ type: "block", reason: "no" });
    expect(calls).toEqual(["a"]);
  });

  it("preserves replacement decisions across later allow hooks", async () => {
    const decision = await runBeforeToolHooks(
      [
        {
          name: "replace",
          beforeToolCall: () => ({ type: "replace", args: { query: "replaced" } }),
        },
        {
          name: "allow",
          beforeToolCall: () => ({ type: "allow" }),
        },
      ],
      { toolCallId: "call_1", toolName: "search", args: { query: "original" } },
      {} as never,
    );

    expect(decision).toEqual({ type: "replace", args: { query: "replaced" } });
  });

  it("executes tools with replacement args even when a later before hook allows", async () => {
    const seen: unknown[] = [];
    const agent = createAgent({
      model: createSingleToolCallModel(),
      plugins: [
        {
          name: "inspect-tool",
          tools: [
            {
              name: "inspect",
              inputSchema: z.object({}),
              execute: async (args) => {
                seen.push(args);
                return "ok";
              },
            },
          ],
        },
        {
          name: "replace-args",
          beforeToolCall: () => ({ type: "replace", args: { query: "replaced" } }),
        },
        {
          name: "allow-later",
          beforeToolCall: () => ({ type: "allow" }),
        },
      ],
    });

    const turnId = agent.send(createUserMessage("hello"));

    await agent.wait();
    expect(agent.isIdle()).toBe(true);
    expect(seen).toEqual([{ query: "replaced" }]);
  });

  it("pipes after hooks over the current result", async () => {
    const result = await runAfterToolHooks(
      [
        {
          name: "a",

          afterToolCall: () => ({ result: { step: 1 } }),
        },
        {
          name: "b",

          afterToolCall: (current) => ({
            result: { ...(current.result as Record<string, unknown>), step: 2, done: true },
          }),
        },
      ],
      { toolCallId: "call_1", toolName: "search", args: {}, result: { step: 0 }, isError: false },
      {} as never,
    );

    expect(result.result).toEqual({ step: 2, done: true });
  });

  it("reports failed tool calls to after hooks", async () => {
    const seen: unknown[] = [];
    const agent = createAgent({
      model: createSingleToolCallModel(),
      plugins: [
        {
          name: "failing-tool",
          tools: [
            {
              name: "inspect",
              inputSchema: z.object({}),
              execute: async () => {
                throw new Error("inspect boom");
              },
            },
          ],
        },
        {
          name: "observer",
          afterToolCall(result) {
            seen.push(result);
          },
        },
      ],
    });

    const turnId = agent.send(createUserMessage("hello"));

    await agent.wait();
    expect(agent.isIdle()).toBe(true);
    expect(seen).toEqual([
      {
        toolCallId: "call_1",
        toolName: "inspect",
        args: {},
        result: expect.objectContaining({ name: "Error", message: "inspect boom" }),
        isError: true,
      },
    ]);
  });

  it("fails open when after hook throws while observing a failed tool", async () => {
    const pluginErrors: string[] = [];
    const agent = createAgent({
      model: createSingleToolCallModel(),
      plugins: [
        {
          name: "failing-tool",
          tools: [
            {
              name: "inspect",
              inputSchema: z.object({}),
              execute: async () => {
                throw new Error("inspect boom");
              },
            },
          ],
        },
        {
          name: "broken-observer",
          afterToolCall() {
            throw new Error("observer boom");
          },
        },
      ],
    });

    agent.channel.subscribe("internal", (event) => {
      if (event.type === "plugin.error") {
        pluginErrors.push(`${event.plugin}:${event.error.message}`);
      }
    });

    const turnId = agent.send(createUserMessage("hello"));

    await agent.wait();
    expect(agent.isIdle()).toBe(true);
    expect(pluginErrors).toContain("broken-observer:observer boom");
  });

  it("fails open when extendTools hook throws", async () => {
    const seen: string[] = [];
    const model = createToolModel();
    const agent = createAgent({
      model,
      tools: [
        {
          name: "base",
          inputSchema: z.object({}),
          execute: async () => "ok",
        } as never,
      ],
      plugins: [
        {
          name: "broken-tools",

          extendTools() {
            throw new Error("bad tools");
          },
        },
      ],
    });

    agent.channel.subscribe("internal", (event) => {
      if (event.type === "plugin.error") {
        seen.push(`${event.plugin}:${event.error.name}:${event.error.message}`);
      }
    });

    const turnId = agent.send(createUserMessage("hello"));
    await agent.wait();
    expect(agent.isIdle()).toBe(true);
    expect(seen).toEqual(["broken-tools:Error:bad tools"]);
    expect((model as unknown as { observedToolNames: string[][] }).observedToolNames).toHaveLength(
      1,
    );
  });
});

function createObservedToolModel() {
  const observedToolNames: string[][] = [];

  return {
    specificationVersion: "v3",
    provider: "mock-provider",
    modelId: "mock-model",
    supportedUrls: {},
    async doGenerate() {
      throw new Error("not implemented");
    },
    async doStream(options: LanguageModelV3CallOptions) {
      const tools = options.tools ?? {};
      observedToolNames.push(
        Array.isArray(tools)
          ? tools.map((tool) => String((tool as { name: unknown }).name))
          : Object.keys(tools),
      );

      return {
        stream: new ReadableStream<LanguageModelV3StreamPart>({
          start(controller) {
            controller.enqueue({ type: "stream-start", warnings: [] });
            controller.enqueue({
              type: "finish",
              finishReason: "stop" as unknown as LanguageModelV3FinishReason,
              usage: {
                inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
                outputTokens: { total: 0, text: 0, reasoning: 0 },
              },
            });
            controller.close();
          },
        }),
      };
    },
    observedToolNames,
  } as unknown as LanguageModelV3 & { observedToolNames: string[][] };
}

function createTerminalToolCallModel(toolName = "finalize_response") {
  let callCount = 0;
  const toolCallsReason = "tool-calls" as unknown as LanguageModelV3FinishReason;
  const stopReason = "stop" as unknown as LanguageModelV3FinishReason;

  return {
    specificationVersion: "v3",
    provider: "mock-provider",
    modelId: "mock-model",
    supportedUrls: {},
    async doGenerate() {
      throw new Error("not implemented");
    },
    async doStream() {
      callCount += 1;

      if (callCount === 1) {
        return {
          stream: new ReadableStream<LanguageModelV3StreamPart>({
            start(controller) {
              controller.enqueue({ type: "stream-start", warnings: [] });
              controller.enqueue({ type: "text-start", id: "text_1" });
              controller.enqueue({ type: "text-delta", id: "text_1", delta: "final answer" });
              controller.enqueue({ type: "text-end", id: "text_1" });
              controller.enqueue({ type: "tool-input-start", id: "call_1", toolName });
              controller.enqueue({ type: "tool-input-delta", id: "call_1", delta: "{}" });
              controller.enqueue({ type: "tool-input-end", id: "call_1" });
              controller.enqueue({
                type: "tool-call",
                toolCallId: "call_1",
                toolName,
                input: "{}",
              });
              controller.enqueue({
                type: "finish",
                finishReason: toolCallsReason,
                usage: {
                  inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
                  outputTokens: { total: 2, text: 2, reasoning: 0 },
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
            controller.enqueue({
              type: "finish",
              finishReason: stopReason,
              usage: {
                inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
                outputTokens: { total: 0, text: 0, reasoning: 0 },
              },
            });
            controller.close();
          },
        }),
      };
    },
    get callCount() {
      return callCount;
    },
  } as unknown as LanguageModelV3 & { readonly callCount: number };
}

describe("terminal tool", () => {
  it("does not add finalize_response unless enabled", async () => {
    const model = createObservedToolModel();
    const agent = createAgent({ model, tools: [] });

    const turnId = agent.send(createUserMessage("hello"));

    await agent.wait();
    expect(agent.isIdle()).toBe(true);
    expect(model.observedToolNames).toEqual([[]]);
  });

  it("adds finalize_response when terminalTool is true", async () => {
    const model = createObservedToolModel();
    const agent = createAgent({
      model,
      tools: [],
      terminalTool: true,
    });

    const turnId = agent.send(createUserMessage("hello"));

    await agent.wait();
    expect(agent.isIdle()).toBe(true);
    expect(model.observedToolNames).toEqual([["finalize_response"]]);
  });

  it("stops the loop successfully when the terminal tool is called", async () => {
    const model = createTerminalToolCallModel();
    const agent = createAgent({
      model,
      tools: [],
      terminalTool: true,
    });

    agent.send(createUserMessage("hello"));
    await agent.wait();

    const entries = await agent.storage.read();
    expect(model.callCount).toBe(1);
    expect(JSON.stringify(entries)).toContain('"finalized":true');
  });

  it("supports custom terminal tool names", async () => {
    const model = createTerminalToolCallModel("finish_turn");
    const agent = createAgent({
      model,
      tools: [],
      terminalTool: { name: "finish_turn" },
    });

    const turnId = agent.send(createUserMessage("hello"));

    await agent.wait();
    expect(agent.isIdle()).toBe(true);
    expect(model.callCount).toBe(1);
  });

  it("surfaces tool conflicts for terminal tool names", async () => {
    const agent = createAgent({
      model: createObservedToolModel(),
      terminalTool: true,
      tools: [
        {
          name: "finalize_response",
          inputSchema: z.object({}),
          execute: async () => ({ ok: true }),
        },
      ],
    });

    const events: Array<{ type: string; error?: { message?: string } }> = [];
    agent.channel.subscribe("internal", (event) => {
      if (event.type === "turn.failed") events.push(event);
    });
    agent.send(createUserMessage("hello"));
    await agent.wait();

    expect(events).toHaveLength(1);
    expect(events[0]?.error?.message).toContain("finalize_response");
  });
});
