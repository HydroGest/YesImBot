import type { AgentMessage, AgentPlugin, ModelMessageContext } from "@yesimbot/agent-runtime";
import { describe, expect, it, vi } from "vitest";

vi.mock("koishi", async () => import("@koishijs/core"));

import { h } from "koishi";

import {
  createEvent,
  createMessage,
  type Event,
  type EventRecord,
  type Input,
  type MessageRecord,
} from "../src/messages.js";
import { createModelInputPlugin } from "../src/runtime/model-input.js";
import type { ChannelScope } from "../src/runtime/storage.js";

declare module "koishi-plugin-yesimbot" {
  interface EventMap {
    "formatter.variant": {
      extra: { secret: string };
    };
  }
}

const scope: ChannelScope = {
  platform: "onebot",
  selfId: "bot-1",
  channelId: "room-42",
  type: "shared",
};
const ASSET_ID = "00000000000000000000000000000000";

function messageRecord(overrides: { timestamp?: number } = {}): MessageRecord {
  return {
    platform: scope.platform,
    selfId: scope.selfId,
    channel: { id: scope.channelId },
    user: { id: "10001", name: "Alice" },
    messageId: "m-1",
    elements: [h.text("hello")],
    timestamp: overrides.timestamp ?? Date.parse("2026-07-18T12:34:00.000Z"),
  };
}

function messageRecordWithText(text: string, overrides: { timestamp?: number } = {}): MessageRecord {
  return {
    ...messageRecord(overrides),
    elements: h.parse(text),
  };
}

function deliveryFailureRecord(): EventRecord<"delivery.failed"> {
  return {
    eventType: "delivery.failed",
    platform: scope.platform,
    selfId: scope.selfId,
    channel: { id: scope.channelId },
    delivery: {
      turnId: "turn-1",
      messageId: "assistant-1",
      segmentIndex: 1,
      segmentTotal: 1,
      error: { name: "Error", message: "offline" },
    },
    text: "failed",
    timestamp: Date.parse("2026-07-18T12:34:00.000Z"),
  };
}

function formatterVariantRecord(): EventRecord<"formatter.variant"> {
  return {
    eventType: "formatter.variant",
    platform: scope.platform,
    selfId: scope.selfId,
    channel: { id: scope.channelId },
    extra: { secret: "do-not-project" },
    text: "variant",
    timestamp: Date.parse("2026-07-18T12:34:00.000Z"),
  };
}

function context(history: readonly AgentMessage[], current: readonly AgentMessage[] = []): ModelMessageContext {
  return { history, current } as ModelMessageContext;
}

function plugin(
  imageBudget: { maxCount: number; maxBytesPerImage: number; maxTotalBytes: number } | null = null,
): AgentPlugin {
  return createModelInputPlugin({ imageBudget, warn: vi.fn() });
}

async function project(input: Input, modelContext: ModelMessageContext, inputPlugin: AgentPlugin) {
  if (!inputPlugin.toModelMessages) throw new Error("Model-input hook is unavailable");
  const result = await inputPlugin.toModelMessages(input, modelContext);
  if (!result || Array.isArray(result) === false) throw new Error("Expected one model message");
  return result[0];
}

describe("createModelInputPlugin", () => {
  it("always formats a message with the fixed header including its ID", async () => {
    const input = createMessage(messageRecord({ timestamp: new Date("2026-07-25T12:34:00.000Z").valueOf() }));
    const inputPlugin = plugin();

    expect(inputPlugin.enforce).toBe("pre");
    await expect(project(input, context([input]), inputPlugin)).resolves.toEqual({
      role: "user",
      content: '[time="2026/7/25 20:34" sender="Alice (10001)" id="m-1"]\nhello',
    });
  });

  it("hydrates JSONL-replayed Elements before rendering", async () => {
    const replayed = JSON.parse(JSON.stringify(createMessage(messageRecord()))) as Input;
    const inputPlugin = plugin();

    const first = await project(replayed, context([replayed]), inputPlugin);
    const second = await project(replayed, context([replayed]), inputPlugin);

    expect(first).toEqual(second);
    expect(String(first.content)).not.toContain("[object Object]");
    expect(first.content).toContain("\nhello");
  });

  it("formats events from only eventType and text", async () => {
    const event: Event = createEvent(formatterVariantRecord());
    const result = await project(event, context([event]), plugin());

    expect(result.content).toContain('"eventType":"formatter.variant"');
    expect(result.content).toContain('"text":"variant"');
    expect(result.content).not.toContain("extra");
  });

  it("renders persisted image references as safe asset text without bytes", async () => {
    const input = createMessage(messageRecordWithText(`<img id="${ASSET_ID}"/>`));
    const result = await project(input, context([input]), plugin());

    expect(result.content).toContain(`[图片：asset://${ASSET_ID}]`);
    expect(result.content).not.toContain("<img");
  });

  it("never leaks src, data URIs, or platform URLs for unpersisted images", async () => {
    const input = createMessage(
      messageRecordWithText('<img src="https://example.test/x.png"/><img src="data:image/png;base64,AAAA"/>'),
    );
    const result = await project(input, context([input]), plugin());

    expect(result.content).toContain("[图片]");
    expect(String(result.content)).not.toContain("https://");
    expect(String(result.content)).not.toContain("base64");
  });

  it("keeps nested image elements discoverable in document order", async () => {
    const input = createMessage({
      ...messageRecord(),
      elements: [h("p", {}, [h("span", {}, [h("img", { id: "11111111111111111111111111111111" })])])],
    });
    const result = await project(input, context([input]), plugin());

    expect(result.content).toContain("[图片：asset://11111111111111111111111111111111]");
  });

  it("never reads asset bytes during model projection", async () => {
    const input = createMessage(messageRecordWithText(`<img id="${ASSET_ID}"/>`));
    const result = await project(input, context([input]), plugin());

    expect(result.content).toContain(`asset://${ASSET_ID}`);
  });

  it("formats delivery-failed notifications without instruction text", async () => {
    const event: Event = createEvent(deliveryFailureRecord());
    const result = await project(event, context([event]), plugin());

    expect(result.content).toContain("[SYSTEM_NOTIFICATION]");
    expect(result.content).toContain('"eventType":"delivery.failed"');
  });
});
