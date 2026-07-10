import { streamText } from "ai";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createAgent } from "../src/agent.js";
import { createAgentChannel } from "../src/channel.js";
import { createMessageEntry } from "../src/entry.js";
import {
  buildModelMessages,
  createAssistantMessage,
  createCustomMessage,
  createSystemMessage,
  createToolMessage,
  createUserMessage,
} from "../src/message.js";
import { createPluginHost } from "../src/plugin.js";
import { createStateManager } from "../src/state.js";
import { createMemoryStorage } from "../src/storage.js";
import type { AgentPlugin } from "../src/types/plugin.js";

declare module "../src/types/message.js" {
  interface AgentCustomMessages {
    "compact.summary": CustomMessageBase<
      "compact.summary",
      { summary: string; entryIds: string[]; createdAt: number }
    >;
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
    expect(seen).toEqual([
      "broken-transform:Error:bad transform",
      "broken-convert:Error:bad convert",
    ]);
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

  it("passes structured prompt blocks through the ai-sdk system option", async () => {
    const agent = createAgent({
      model: {} as never,
      systemPrompt: "base",
      plugins: [
        {
          name: "legacy",
          extendSystemPrompt(prompt) {
            return `${prompt}\nlegacy`;
          },
        },
        {
          name: "structured",
          appendSystemPrompt() {
            return [
              "structured a",
              {
                role: "system",
                content: "structured b",
                providerOptions: { mock: { cache: true } },
              },
            ];
          },
        },
      ],
    });

    const turnId = agent.send(createUserMessage("hello"));
    await agent.wait();

    expect(streamTextMock).toHaveBeenCalledOnce();
    expect(streamTextMock.mock.calls[0]![0].system).toEqual([
      { role: "system", content: "base\nlegacy" },
      { role: "system", content: "structured a" },
      {
        role: "system",
        content: "structured b",
        providerOptions: { mock: { cache: true } },
      },
    ]);
    expect(streamTextMock.mock.calls[0]![0].messages).toEqual([
      expect.objectContaining({ role: "user", content: "hello" }),
    ]);
  });

  it("preserves string system output when no structured blocks exist", async () => {
    const agent = createAgent({
      model: {} as never,
      systemPrompt: "base",
      plugins: [
        {
          name: "legacy",
          extendSystemPrompt(prompt) {
            return `${prompt}\nlegacy`;
          },
        },
      ],
    });

    const turnId = agent.send(createUserMessage("hello"));
    await agent.wait();

    expect(streamTextMock.mock.calls[0]![0].system).toBe("base\nlegacy");
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

    const turnId = agent.send(createUserMessage("hello"));
    await agent.wait();

    expect(legacy).not.toHaveBeenCalled();
    expect(streamTextMock.mock.calls[0]![0].system).toEqual([
      { role: "system", content: "structured only" },
    ]);
  });
});
