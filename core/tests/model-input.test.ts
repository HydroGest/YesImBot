import type { AgentMessage, AgentPlugin, ModelMessageContext } from "@yesimbot/agent-runtime";
import type { Mock } from "vitest";
import { describe, expect, it, vi } from "vitest";

vi.mock("koishi", async () => import("@koishijs/core"));

import { h } from "koishi";

import type { AssetStore } from "../src/asset.js";
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
  isDirect: false,
};
const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const FIVE_MIB = 5 * 1024 * 1024;

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

function assetStore() {
  const get = vi.fn<(id: string) => Promise<Uint8Array>>();
  return { get };
}

function pngBytesOfLength(byteLength: number): Uint8Array {
  const data = new Uint8Array(byteLength);
  data.set(pngBytes);

  return data;
}
type TestAssetStore = Pick<AssetStore, "get"> & {
  readonly get: Mock<(id: string) => Promise<Uint8Array>>;
};

const fiveMiBPngBytes = pngBytesOfLength(FIVE_MIB);
const oversizedPngBytes = pngBytesOfLength(FIVE_MIB + 1);

function context(history: readonly AgentMessage[], current: readonly AgentMessage[] = []): ModelMessageContext {
  return { history, current } as ModelMessageContext;
}

function plugin(
  assets: TestAssetStore,
  imageBudget: {
    readonly maxCount: number;
    readonly maxBytesPerImage: number;
    readonly maxTotalBytes: number;
  } | null = {
    maxCount: 4,
    maxBytesPerImage: FIVE_MIB,
    maxTotalBytes: 10 * 1024 * 1024,
  },
  warn = vi.fn(),
): AgentPlugin {
  return createModelInputPlugin({ assets, imageBudget, warn });
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
    const inputPlugin = plugin(assetStore(), null);

    expect(inputPlugin.enforce).toBe("pre");
    await expect(project(input, context([input]), inputPlugin)).resolves.toEqual({
      role: "user",
      content: '[time="2026/7/25 20:34" sender="Alice (10001)" id="m-1"]\nhello',
    });
  });

  it("hydrates JSONL-replayed Elements before rendering", async () => {
    const replayed = JSON.parse(JSON.stringify(createMessage(messageRecord()))) as Input;
    const inputPlugin = plugin(assetStore(), null);

    const first = await project(replayed, context([replayed]), inputPlugin);
    const second = await project(replayed, context([replayed]), inputPlugin);

    expect(first).toEqual(second);
    expect(String(first.content)).not.toContain("[object Object]");
    expect(first.content).toContain("\nhello");
  });

  it("formats events from only eventType and text", async () => {
    const event: Event = createEvent(formatterVariantRecord());
    const result = await project(event, context([event]), plugin(assetStore(), null));

    expect(result.content).toContain('"eventType":"formatter.variant"');
    expect(result.content).toContain('"text":"variant"');
    expect(result.content).not.toContain("extra");
  });

  it("does not read images when image input is disabled", async () => {
    const assets = assetStore();
    const input = createMessage(messageRecordWithText('<img id="00000000000000000000000000000000"/>'));

    await expect(project(input, context([input]), plugin(assets, null))).resolves.toMatchObject({
      role: "user",
    });
    expect(assets.get).not.toHaveBeenCalled();
  });

  it("scans history then current and nested elements in document order", async () => {
    const assets = assetStore();
    assets.get.mockResolvedValue(pngBytes);
    const historyFirst = createMessage(messageRecordWithText('<img id="11111111111111111111111111111111"/>'));
    const historySecond = createMessage({
      ...messageRecord(),
      messageId: "m-2",
      elements: [h("p", {}, [h("span", {}, [h("img", { id: "22222222222222222222222222222222" })])])],
    });
    const current = createMessage(messageRecordWithText('<img id="33333333333333333333333333333333"/>'));
    const inputPlugin = plugin(assets, { maxCount: 3, maxBytesPerImage: 8, maxTotalBytes: 24 });
    const modelContext = context([historyFirst, historySecond], [current]);

    await Promise.all([
      project(historyFirst, modelContext, inputPlugin),
      project(historySecond, modelContext, inputPlugin),
      project(current, modelContext, inputPlugin),
    ]);

    expect(assets.get.mock.calls.map(([id]) => id)).toEqual([
      "11111111111111111111111111111111",
      "22222222222222222222222222222222",
      "33333333333333333333333333333333",
    ]);
  });

  it.each([
    [new Uint8Array([0xff, 0xd8, 0xff]), "image/jpeg"],
    [pngBytes, "image/png"],
    [new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]), "image/gif"],
    [new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]), "image/webp"],
  ])("appends supported %s files without mutating source messages", async (bytes, mediaType) => {
    const assets = assetStore();
    assets.get.mockResolvedValue(bytes);
    const input = createMessage(messageRecordWithText('<img id="44444444444444444444444444444444"/>'));
    const original = input.data.elements;
    const result = await project(input, context([input]), plugin(assets));

    expect(result.content).toEqual([
      {
        type: "text",
        text: '[time="2026/7/18 20:34" sender="Alice (10001)" id="m-1"]\n<img id="44444444444444444444444444444444"/>',
      },
      { type: "file", data: bytes, mediaType },
    ]);
    expect(input.data.elements).toBe(original);
  });

  it("keeps text and records diagnostics for invalid or missing assets", async () => {
    const assets = assetStore();
    const warn = vi.fn();
    assets.get.mockImplementation(async (id) => {
      if (id === "55555555555555555555555555555555") return new Uint8Array([0x3c, 0x73, 0x76, 0x67]);
      if (id === "66666666666666666666666666666666") throw new Error("missing");
      return pngBytes;
    });
    const input = createMessage(
      messageRecordWithText(
        '<img id="55555555555555555555555555555555"/><img id="66666666666666666666666666666666"/><img id="77777777777777777777777777777777"/>',
      ),
    );
    const result = await project(input, context([input]), plugin(assets, undefined, warn));

    expect(Array.isArray(result.content) && result.content).toHaveLength(2);
    expect(warn.mock.calls.map(([event]) => event)).toEqual(["asset_invalid_mime", "asset_read_failed"]);
  });

  it("charges each reference and skips oversized candidates while accepting later files", async () => {
    const assets = assetStore();
    assets.get.mockImplementation(async (id) =>
      id === "88888888888888888888888888888888" ? new Uint8Array(9) : pngBytes,
    );
    const input = createMessage(
      messageRecordWithText(
        '<img id="88888888888888888888888888888888"/><img id="99999999999999999999999999999999"/><img id="99999999999999999999999999999999"/><img id="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"/>',
      ),
    );
    const result = await project(
      input,
      context([input]),
      plugin(assets, { maxCount: 2, maxBytesPerImage: 8, maxTotalBytes: 16 }),
    );

    expect(Array.isArray(result.content) && result.content.slice(1)).toHaveLength(2);
    expect(assets.get.mock.calls.map(([id]) => id)).toEqual([
      "88888888888888888888888888888888",
      "99999999999999999999999999999999",
      "99999999999999999999999999999999",
    ]);
  });

  it("accepts exact per-image and total limits and resets the budget for each context", async () => {
    const assets = assetStore();
    assets.get.mockResolvedValue(fiveMiBPngBytes);
    const first = createMessage(
      messageRecordWithText(
        '<img id="bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"/><img id="cccccccccccccccccccccccccccccccc"/><img id="dddddddddddddddddddddddddddddddd"/>',
      ),
    );
    const second = createMessage(messageRecordWithText('<img id="eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"/>'));
    const inputPlugin = plugin(assets);

    const initial = await project(first, context([first]), inputPlugin);
    const later = await project(second, context([second]), inputPlugin);

    expect(Array.isArray(initial.content) && initial.content.slice(1)).toHaveLength(2);
    expect(Array.isArray(later.content) && later.content.slice(1)).toHaveLength(1);
    expect(assets.get).toHaveBeenCalledTimes(3);
    expect(oversizedPngBytes.byteLength).toBe(FIVE_MIB + 1);
  });
});
