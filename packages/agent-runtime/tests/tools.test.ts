import type { LanguageModelV3FinishReason, LanguageModelV3StreamPart } from "@ai-sdk/provider";
import type { LanguageModelV3, LanguageModelV3CallOptions } from "ai";
import { describe, expect, it, vi } from "vitest";
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
  } as unknown as LanguageModelV3 & { observedToolNames: string[][] };
}

function createSingleToolCallModel() {
  const stopReason = "stop" as unknown as LanguageModelV3FinishReason;
  const toolCallsReason = "tool-calls" as unknown as LanguageModelV3FinishReason;
  let callCount = 0;
  const observedPrompts: LanguageModelV3CallOptions["prompt"][] = [];
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
      observedPrompts.push(structuredClone(options.prompt));
      const tools = options.tools ?? {};
      observedToolNames.push(
        Array.isArray(tools)
          ? tools.map((tool) => String((tool as { name: unknown }).name))
          : Object.keys(tools),
      );
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
    observedPrompts,
    observedToolNames,
  } as unknown as LanguageModelV3 & {
    observedPrompts: LanguageModelV3CallOptions["prompt"][];
    observedToolNames: string[][];
  };
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

  it("copies descriptors from every stable tool source", () => {
    const baseExecute = async () => "base";
    const pluginExecute = async () => "plugin";
    const legacyExecute = async () => "legacy";
    const terminalExecute = async () => "terminal";
    const base = {
      name: "base",
      description: "base original",
      inputSchema: z.object({}),
      execute: baseExecute,
    };
    const plugin = {
      name: "plugin",
      description: "plugin original",
      inputSchema: z.object({}),
      execute: pluginExecute,
    };
    const legacy = {
      name: "legacy",
      description: "legacy original",
      inputSchema: z.object({}),
      execute: legacyExecute,
    };
    const terminal = {
      name: "terminal",
      description: "terminal original",
      inputSchema: z.object({}),
      execute: terminalExecute,
    };
    const merged = mergeTools([[base], [plugin], [legacy], [terminal]]);

    base.name = "base mutated";
    base.description = "base mutated";
    base.execute = async () => "base mutated";
    plugin.name = "plugin mutated";
    plugin.description = "plugin mutated";
    plugin.execute = async () => "plugin mutated";
    legacy.name = "legacy mutated";
    legacy.description = "legacy mutated";
    legacy.execute = async () => "legacy mutated";
    terminal.name = "terminal mutated";
    terminal.description = "terminal mutated";
    terminal.execute = async () => "terminal mutated";

    expect(merged.map(({ name, description }) => ({ name, description }))).toEqual([
      { name: "base", description: "base original" },
      { name: "plugin", description: "plugin original" },
      { name: "legacy", description: "legacy original" },
      { name: "terminal", description: "terminal original" },
    ]);
    expect(merged.map((tool) => tool.execute)).toEqual([
      baseExecute,
      pluginExecute,
      legacyExecute,
      terminalExecute,
    ]);
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

    await expect(agent.init()).rejects.toBeInstanceOf(ToolConflictError);
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

  it("resolves deprecated tool extensions once and reuses the frozen registry", async () => {
    const model = createToolModel();
    const extend = vi.fn(
      (tools) =>
        [
          ...tools,
          { name: "legacy", inputSchema: z.object({}), execute: async () => "legacy" },
        ] as never,
    );
    const agent = createAgent({
      model,
      tools: [{ name: "base", inputSchema: z.object({}), execute: async () => "base" } as never],
      plugins: [
        {
          name: "stable",
          tools: [{ name: "stable", inputSchema: z.object({}), execute: async () => "stable" }],
          extendTools: extend,
        },
      ],
    });

    agent.send(createUserMessage("first"));
    await agent.wait();
    agent.send(createUserMessage("second"));
    await agent.wait();

    expect(extend).toHaveBeenCalledOnce();
    expect(model.observedToolNames).toEqual([
      ["base", "stable", "legacy"],
      ["base", "stable", "legacy"],
    ]);
  });

  it("fails initialization when a required deprecated tool extension throws", async () => {
    const agent = createAgent({
      model: createToolModel(),
      plugins: [
        {
          name: "broken",
          extendTools() {
            throw new Error("tool init failed");
          },
        },
      ],
    });

    await expect(agent.init()).rejects.toThrow("tool init failed");
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

  it("uses the initialized tool name, description, and execute function after caller mutation", async () => {
    const model = createSingleToolCallModel();
    const executions: string[] = [];
    const tool = {
      name: "inspect",
      description: "inspect original",
      inputSchema: z.object({}),
      execute: async () => {
        executions.push("original");
        return "original";
      },
    };
    const agent = createAgent({ model, tools: [tool] });

    await agent.init();
    tool.name = "inspect_mutated";
    tool.description = "inspect mutated";
    tool.execute = async () => {
      executions.push("mutated");
      return "mutated";
    };
    agent.send(createUserMessage("hello"));
    await agent.wait();

    expect(model.observedToolNames).toEqual([["inspect"], ["inspect"]]);
    expect(executions).toEqual(["original"]);
  });

  it("extends the prior provider prompt during a tool loop", async () => {
    const model = createSingleToolCallModel();
    const agent = createAgent({
      model,
      systemPrompt: "stable",
      tools: [
        {
          name: "inspect",
          inputSchema: z.object({}),
          execute: async () => ({ ok: true }),
        },
      ],
    });

    agent.send(createUserMessage("inspect"));
    await agent.wait();

    const [firstPrompt, secondPrompt] = model.observedPrompts;
    expect(firstPrompt).toBeDefined();
    expect(secondPrompt?.slice(0, firstPrompt!.length)).toEqual(firstPrompt);
    expect(secondPrompt!.length).toBeGreaterThan(firstPrompt!.length);
    expect(model.observedToolNames).toEqual([["inspect"], ["inspect"]]);
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
