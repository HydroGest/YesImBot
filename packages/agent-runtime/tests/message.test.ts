import { streamText } from "ai";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createAgent } from "../src/agent.js";
import { createAgentChannel } from "../src/channel.js";
import { createMessageEntry } from "../src/entry.js";
import { buildModelMessages, createAssistantMessage, createCustomMessage, createSystemMessage, createToolMessage, createUserMessage } from "../src/message.js";
import { createPluginHost } from "../src/plugin.js";
import type { AgentPlugin } from "../src/plugin.js";
import { createStateManager } from "../src/state.js";
import { createMemoryStorage } from "../src/storage.js";

declare module "../src/message.js" {
  interface AgentCustomMessages {
    "compact.summary": CustomMessageBase<"compact.summary", { summary: string; entryIds: string[]; createdAt: number }>;
    "custom.note": CustomMessageBase<"custom.note", { text: string }>;
    "custom.visible": CustomMessageBase<"custom.visible", { text: string }>;
  }
}

vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();
  return {
    ...actual,
    streamText: vi.fn(() => ({
      fullStream: (async function* () {})(),
    })),
  };
});

const streamTextMock = vi.mocked(streamText);

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function createModelContext(plugins: AgentPlugin[] = []) {
  const storage = createMemoryStorage();
  const channel = createAgentChannel();
  const state = createStateManager({ storage });
  const pluginHost = createPluginHost({
    plugins,
    runtime: {
      id: "runtime_1",
      channel,
      state,
      storage,
    },
  });

  return {
    channel,
    pluginHost,
    context: {
      runtime: { id: "runtime_1" },
      channel,
      state,
    },
  };
}

describe("message constructors", () => {
  it("creates messages with message-owned ids and timestamps", () => {
    const message = createUserMessage("hello", {
      id: "msg_1",
      timestamp: 123,
    });

    const entry = createMessageEntry(message);

    expect("meta" in message).toBe(false);
    expect(message.id).toBe("msg_1");
    expect(message.timestamp).toBe(123);
    expect(entry.id).toMatch(UUID_REGEX);
    expect(Number.isFinite(entry.timestamp)).toBe(true);
    expect(entry.type).toBe("message");
    expect(entry.data).toBe(message);
  });

  it("preserves built-in message roles", () => {
    const systemMessage = createSystemMessage("rules");
    const assistantMessage = createAssistantMessage("answer");
    const toolMessage = createToolMessage([
      {
        type: "tool-result",
        toolCallId: "call_1",
        toolName: "lookup",
        output: { type: "json", value: { ok: true } },
      },
    ]);

    expect(systemMessage.role).toBe("system");
    expect(assistantMessage.role).toBe("assistant");
    expect(toolMessage.role).toBe("tool");
  });

  it("preserves custom message role, type, and data", () => {
    const message = createCustomMessage(
      "compact.summary",
      { summary: "summary", entryIds: ["entry_1"], createdAt: 123 },
      { id: "msg_summary", timestamp: 456 },
    );

    expect(message.role).toBe("custom");
    expect(message.type).toBe("compact.summary");
    expect(message.id).toBe("msg_summary");
    expect(message.timestamp).toBe(456);
    expect(message.data).toEqual({ summary: "summary", entryIds: ["entry_1"], createdAt: 123 });
    expect("meta" in message).toBe(false);
    expect("content" in message).toBe(false);
  });
});

describe("model conversion", () => {
  it("exposes one frozen conversion boundary for transformed history and current input", async () => {
    const history = [createCustomMessage("custom.visible", { text: "history" })];
    const current = [createCustomMessage("custom.visible", { text: "current" })];
    const transformedHistory = [createCustomMessage("custom.visible", { text: "transformed" })];
    const contexts: Array<Parameters<NonNullable<AgentPlugin["toModelMessages"]>>[1]> = [];
    const { pluginHost, context } = createModelContext([
      {
        name: "boundary",
        transformMessages() {
          return transformedHistory;
        },
        toModelMessages(message, conversionContext) {
          contexts.push(conversionContext);
          if (message.role !== "custom" || message.type !== "custom.visible") {
            return undefined;
          }

          return { role: "user", content: message.data.text };
        },
      },
    ]);
    await pluginHost.init();

    const result = await buildModelMessages({ history, current, pluginHost, context });
    const firstContext = contexts[0];

    expect(contexts).toHaveLength(2);
    expect(contexts.every((conversionContext) => conversionContext === firstContext)).toBe(true);
    expect(firstContext?.history).toEqual(transformedHistory);
    expect(firstContext?.current).toEqual(current);
    expect(Object.isFrozen(firstContext)).toBe(true);
    expect(Object.isFrozen(firstContext?.history)).toBe(true);
    expect(Object.isFrozen(firstContext?.current)).toBe(true);
    expect("requestId" in (firstContext ?? {})).toBe(false);
    expect("activeTurnId" in (firstContext ?? {})).toBe(false);
    expect(Object.getOwnPropertySymbols(firstContext ?? {})).toEqual([]);
    expect(result).toEqual([
      { role: "user", content: "transformed" },
      { role: "user", content: "current" },
    ]);

    await buildModelMessages({ history, current, pluginHost, context });

    expect(contexts.at(-1)).not.toBe(firstContext);
  });

  it("exposes initial and joined batches only to their submitting model requests", async () => {
    let releaseInitialStream: (() => void) | undefined;
    let markInitialStreamStarted: (() => void) | undefined;
    const initialStreamStarted = new Promise<void>((resolve) => {
      markInitialStreamStarted = resolve;
    });
    const contexts: Array<Parameters<NonNullable<AgentPlugin["toModelMessages"]>>[1]> = [];
    streamTextMock.mockImplementationOnce(() => ({
      fullStream: (async function* () {
        markInitialStreamStarted?.();
        await new Promise<void>((resolve) => {
          releaseInitialStream = resolve;
        });
      })(),
    }));
    const agent = createAgent({
      model: {} as never,
      plugins: [
        {
          name: "boundary",
          toModelMessages(message, context) {
            contexts.push(context);
            if (message.role !== "custom" || message.type !== "custom.visible") {
              return undefined;
            }

            return { role: "user", content: message.data.text };
          },
        },
      ],
    });
    const initial = createCustomMessage("custom.visible", { text: "initial" });
    const joined = createCustomMessage("custom.visible", { text: "joined" });

    agent.send(initial);
    await initialStreamStarted;
    agent.send(joined, { ifBusy: "join" });
    releaseInitialStream?.();
    await agent.wait();

    expect(contexts).toHaveLength(3);
    expect(contexts[0]?.current).toEqual([initial]);
    expect(contexts[1]?.history).toEqual([initial]);
    expect(contexts[1]?.current).toEqual([joined]);
    expect(contexts[2]).toBe(contexts[1]);
  });

  it("exposes an empty current batch to a later tool step without joins", async () => {
    const contexts: Array<Parameters<NonNullable<AgentPlugin["toModelMessages"]>>[1]> = [];
    streamTextMock.mockImplementationOnce((options) => ({
      fullStream: (async function* () {
        await options.prepareStep?.({ stepNumber: 1 });
      })(),
    }));
    const agent = createAgent({
      model: {} as never,
      plugins: [
        {
          name: "boundary",
          toModelMessages(message, context) {
            contexts.push(context);
            if (message.role !== "custom" || message.type !== "custom.visible") {
              return undefined;
            }

            return { role: "user", content: message.data.text };
          },
        },
      ],
    });
    const initial = createCustomMessage("custom.visible", { text: "initial" });

    agent.send(initial);
    await agent.wait();

    expect(contexts).toHaveLength(2);
    expect(contexts[0]?.current).toEqual([initial]);
    expect(contexts[1]?.history).toEqual([initial]);
    expect(contexts[1]?.current).toEqual([]);
  });

  it("keeps persisted custom projections as a later model-request prefix", async () => {
    streamTextMock.mockClear();
    const contexts: Array<Parameters<NonNullable<AgentPlugin["toModelMessages"]>>[1]> = [];
    const agent = createAgent({
      model: {} as never,
      plugins: [
        {
          name: "visible-custom-message",
          toModelMessages(message, context) {
            contexts.push(context);
            if (message.role !== "custom" || message.type !== "custom.visible") {
              return undefined;
            }

            return { role: "user", content: message.data.text };
          },
        },
      ],
    });
    const first = createCustomMessage("custom.visible", { text: "first persisted" });
    const second = createCustomMessage("custom.visible", { text: "second current" });

    agent.send(first);
    await agent.wait();
    agent.send(second);
    await agent.wait();

    const firstRequest = streamTextMock.mock.calls[0]?.[0].messages;
    const laterRequest = streamTextMock.mock.calls[1]?.[0].messages;
    expect(firstRequest).toEqual([{ role: "user", content: "first persisted" }]);
    expect(laterRequest?.slice(0, firstRequest?.length)).toEqual(firstRequest);
    expect(laterRequest?.at(-1)).toEqual({ role: "user", content: "second current" });
    expect(contexts[1]?.history).toEqual([first]);
    expect(contexts[1]?.current).toEqual([second]);
    expect(contexts[1]).not.toHaveProperty("session");
  });

  it("transforms history before adding current turn messages", async () => {
    const history = [createUserMessage("old")];
    const current = [createUserMessage("current")];
    const { pluginHost, context } = createModelContext([
      {
        name: "prune",
        transformMessages: async () => [],
      },
    ]);

    await pluginHost.init();

    const result = await buildModelMessages({
      history,
      current,
      pluginHost,
      context,
    });

    expect(result).toEqual([expect.objectContaining({ role: "user", content: "current" })]);
  });

  it("omits custom messages when no plugin converts them", async () => {
    const { pluginHost, context } = createModelContext();
    await pluginHost.init();

    const result = await buildModelMessages({
      history: [createCustomMessage("custom.note", { text: "hidden" })],
      current: [createUserMessage("current")],
      pluginHost,
      context,
    });

    expect(result).toEqual([expect.objectContaining({ role: "user", content: "current" })]);
  });

  it("fails open for transform and custom conversion hooks", async () => {
    const { channel, pluginHost, context } = createModelContext([
      {
        name: "broken-transform",
        transformMessages() {
          throw new Error("bad transform");
        },
      },
      {
        name: "broken-convert",
        toModelMessages(message) {
          if (message.role === "custom") {
            throw new Error("bad convert");
          }
        },
      },
    ]);
    const seen: string[] = [];

    channel.subscribe("internal", (event) => {
      if (event.type === "plugin.error") {
        seen.push(`${event.plugin}:${event.error.name}:${event.error.message}`);
      }
    });
    await pluginHost.init();

    const result = await buildModelMessages({
      history: [createCustomMessage("custom.note", { text: "hidden" })],
      current: [createUserMessage("current")],
      pluginHost,
      context,
    });

    expect(result).toEqual([expect.objectContaining({ role: "user", content: "current" })]);
    expect(seen).toEqual(["broken-transform:Error:bad transform", "broken-convert:Error:bad convert"]);
  });

  it("continues custom conversion until a plugin returns model messages", async () => {
    const { pluginHost, context } = createModelContext([
      {
        name: "skip",
        toModelMessages() {
          return undefined;
        },
      },
      {
        name: "convert",
        toModelMessages(message) {
          if (message.role !== "custom" || message.type !== "custom.visible") {
            return undefined;
          }

          return { role: "user", content: message.data.text };
        },
      },
    ]);
    await pluginHost.init();

    const result = await buildModelMessages({
      history: [createCustomMessage("custom.visible", { text: "shown" })],
      current: [],
      pluginHost,
      context,
    });

    expect(result).toEqual([{ role: "user", content: "shown" }]);
  });

  it("emits clean model messages for built-in roles", async () => {
    const { pluginHost, context } = createModelContext();
    await pluginHost.init();
    const user = createUserMessage("current");

    const result = await buildModelMessages({
      history: [],
      current: [user],
      pluginHost,
      context,
    });

    expect(result).toEqual([{ role: "user", content: "current" }]);
    expect("meta" in result[0]).toBe(false);
  });
});

describe("system prompt resolution", () => {
  beforeEach(() => {
    streamTextMock.mockClear();
  });

  it("resolves structured system input and plugin blocks once", async () => {
    const resolveBase = vi.fn(async () => [
      "constitution",
      {
        role: "system" as const,
        content: "operator",
        providerOptions: { mock: { cache: true } },
      },
    ]);
    const append = vi.fn(() => "plugin prompt");
    const agent = createAgent({
      model: {} as never,
      systemPrompt: resolveBase,
      plugins: [
        {
          name: "stable",
          appendSystemPrompt: append,
        },
      ],
    });

    agent.send(createUserMessage("first"));
    await agent.wait();
    agent.send(createUserMessage("second"));
    await agent.wait();

    expect(resolveBase).toHaveBeenCalledOnce();
    expect(append).toHaveBeenCalledOnce();
    expect(streamTextMock).toHaveBeenCalledTimes(2);
    expect(streamTextMock.mock.calls[0]![0].system).toEqual([
      { role: "system", content: "constitution" },
      {
        role: "system",
        content: "operator",
        providerOptions: { mock: { cache: true } },
      },
      { role: "system", content: "plugin prompt" },
    ]);
    expect(streamTextMock.mock.calls[1]![0].system).toEqual(streamTextMock.mock.calls[0]![0].system);
    const firstMessages = streamTextMock.mock.calls[0]![0].messages;
    const secondMessages = streamTextMock.mock.calls[1]![0].messages;
    expect(secondMessages.slice(0, firstMessages.length)).toEqual(firstMessages);
    expect(secondMessages.at(-1)).toEqual(expect.objectContaining({ role: "user", content: "second" }));
  });

  it("snapshots configured and plugin system blocks for later model calls", async () => {
    const configuredBlock = {
      role: "system" as const,
      content: "configured-original",
      providerOptions: { mock: { cache: "configured-original" } },
    };
    const pluginBlock = {
      role: "system" as const,
      content: "plugin-original",
      providerOptions: { mock: { cache: "plugin-original" } },
    };
    const agent = createAgent({
      model: {} as never,
      systemPrompt: [configuredBlock],
      plugins: [{ name: "stable", appendSystemPrompt: () => pluginBlock }],
    });

    agent.send(createUserMessage("first"));
    await agent.wait();
    configuredBlock.content = "configured-mutated";
    configuredBlock.providerOptions.mock.cache = "configured-mutated";
    pluginBlock.content = "plugin-mutated";
    pluginBlock.providerOptions.mock.cache = "plugin-mutated";
    agent.send(createUserMessage("second"));
    await agent.wait();

    expect(streamTextMock.mock.calls.map(([call]) => call.system)).toEqual([
      [
        {
          role: "system",
          content: "configured-original",
          providerOptions: { mock: { cache: "configured-original" } },
        },
        {
          role: "system",
          content: "plugin-original",
          providerOptions: { mock: { cache: "plugin-original" } },
        },
      ],
      [
        {
          role: "system",
          content: "configured-original",
          providerOptions: { mock: { cache: "configured-original" } },
        },
        {
          role: "system",
          content: "plugin-original",
          providerOptions: { mock: { cache: "plugin-original" } },
        },
      ],
    ]);
  });

  it("runs the deprecated string reducer once for a legacy string prompt", async () => {
    const legacy = vi.fn((prompt: string) => `${prompt}\nlegacy`);
    const agent = createAgent({
      model: {} as never,
      systemPrompt: "base",
      plugins: [
        {
          name: "legacy",
          extendSystemPrompt: legacy,
        },
      ],
    });

    agent.send(createUserMessage("first"));
    await agent.wait();
    agent.send(createUserMessage("second"));
    await agent.wait();

    expect(legacy).toHaveBeenCalledOnce();
    expect(streamTextMock.mock.calls.map(([call]) => call.system)).toEqual(["base\nlegacy", "base\nlegacy"]);
  });

  it("allows structured prompt blocks without a base system prompt", async () => {
    const legacy = vi.fn();
    const agent = createAgent({
      model: {} as never,
      plugins: [
        {
          name: "structured-only",
          extendSystemPrompt: legacy,
          appendSystemPrompt() {
            return "structured only";
          },
        },
      ],
    });

    agent.send(createUserMessage("hello"));
    await agent.wait();

    expect(legacy).not.toHaveBeenCalled();
    expect(streamTextMock.mock.calls[0]![0].system).toEqual([{ role: "system", content: "structured only" }]);
  });

  it("fails initialization before plugin startup when base system resolution fails", async () => {
    const init = vi.fn();
    const agent = createAgent({
      model: {} as never,
      systemPrompt: async () => {
        throw new Error("prompt read failed");
      },
      plugins: [{ name: "plugin", init }],
    });

    await expect(agent.init()).rejects.toThrow("prompt read failed");
    expect(init).not.toHaveBeenCalled();
  });
});
