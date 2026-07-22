import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createEntry } from "@yesimbot/agent-runtime";
import { describe, expect, it, vi } from "vitest";

vi.mock("koishi", async () => import("@koishijs/core"));

import { type ChannelScope } from "../src/channel/index.js";
import { formatEvent } from "../src/event/formatter.js";
import { createEvent, type EventRecord } from "../src/event/index.js";
import { createJsonlStorage } from "../src/runtime/storage.js";
import { AssetStore } from "../src/shared/asset.js";

const scope: ChannelScope = { platform: "onebot", selfId: "bot-1", channelId: "room-42" };
const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function messageEvent(content?: string) {
  const record = {
    type: "message",
    platform: scope.platform,
    selfId: scope.selfId,
    timestamp: Date.parse("2026-07-18T12:34:00.000Z"),
    channel: { id: scope.channelId },
    user: { id: "10001", name: "Alice" },
    message: { id: "m-1" },
    ...(content === undefined ? {} : { content }),
  } as EventRecord<"message">;
  return createEvent(record);
}

function assetStore() {
  return { readByAssetId: vi.fn<() => Promise<Uint8Array>>() };
}

describe("formatEvent", () => {
  it("formats stored time and sender data with an optional raw message id", async () => {
    const result = await formatEvent(messageEvent("hello"), {
      scope,
      assetStore: assetStore(),
      includeMessageId: true,
    });

    expect(result).toEqual({
      role: "user",
      content: '[time="2026/7/18 20:34" sender="Alice (10001)" id="m-1"]\nhello',
    });
  });

  it("emits no model message when frozen content is absent", async () => {
    await expect(
      formatEvent(messageEvent(), { scope, assetStore: assetStore(), includeMessageId: false }),
    ).resolves.toBeUndefined();
  });

  it("reads frozen images only from the matching scoped AssetStore", async () => {
    const assets = assetStore();
    assets.readByAssetId.mockResolvedValue(pngBytes);

    const result = await formatEvent(messageEvent('<img id="asset_hash" mime="image/png"/>'), {
      scope,
      assetStore: assets,
      includeMessageId: false,
    });

    expect(assets.readByAssetId).toHaveBeenCalledWith(scope, "asset_hash");
    expect(result?.content).toEqual([
      { type: "text", text: '[time="2026/7/18 20:34" sender="Alice (10001)"]\n' },
      { type: "image", image: pngBytes, mediaType: "image/png" },
    ]);
  });

  it("reports missing assets and continues without replay-time access", async () => {
    const assets = assetStore();
    const missing = new Error("missing");
    assets.readByAssetId.mockRejectedValue(missing);
    const onAssetMissing = vi.fn();

    const result = await formatEvent(messageEvent('<img id="asset_missing" mime="image/png"/>'), {
      scope,
      assetStore: assets,
      includeMessageId: false,
      onAssetMissing,
    });

    expect(onAssetMissing).toHaveBeenCalledWith("asset_missing", missing);
    expect(result).toEqual({
      role: "user",
      content: '[time="2026/7/18 20:34" sender="Alice (10001)"]\n<img unavailable="true"/>',
    });
  });

  it("uses only persisted event data during replay", async () => {
    const assets = assetStore();
    const event = messageEvent("stored content");

    await expect(
      formatEvent(event, { scope, assetStore: assets, includeMessageId: false }),
    ).resolves.toEqual({
      role: "user",
      content: '[time="2026/7/18 20:34" sender="Alice (10001)"]\nstored content',
    });
    expect(assets.readByAssetId).not.toHaveBeenCalled();
  });

  it("reloads a persisted Event with an AssetStore image without remote access", async () => {
    const basePath = await mkdtemp(join(tmpdir(), "yesimbot-replay-"));
    const filePath = join(basePath, "events.jsonl");
    const assets = new AssetStore({ basePath, maxFileBytes: pngBytes.byteLength });
    const frozen = await assets.put(scope, pngBytes);
    const stored = messageEvent(`stored text <img id="${frozen.assetId}" mime="${frozen.mime}"/>`);
    await createJsonlStorage(filePath).append(createEntry("message", stored));
    const [entry] = await createJsonlStorage(filePath).read();
    const platformApi = vi.fn();
    vi.stubGlobal("fetch", platformApi);

    try {
      const result = await formatEvent((entry as { data: typeof stored }).data, {
        scope,
        assetStore: assets,
        includeMessageId: false,
      });

      expect(result).toEqual({
        role: "user",
        content: [
          { type: "text", text: '[time="2026/7/18 20:34" sender="Alice (10001)"]\nstored text ' },
          { type: "image", image: pngBytes, mediaType: "image/png" },
        ],
      });
      expect(platformApi).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("diagnoses a missing AssetStore image after JSONL reload without remote access", async () => {
    const sourcePath = await mkdtemp(join(tmpdir(), "yesimbot-replay-source-"));
    const filePath = join(sourcePath, "events.jsonl");
    const sourceAssets = new AssetStore({
      basePath: sourcePath,
      maxFileBytes: pngBytes.byteLength,
    });
    const frozen = await sourceAssets.put(scope, pngBytes);
    const stored = messageEvent(`stored text <img id="${frozen.assetId}" mime="${frozen.mime}"/>`);
    await createJsonlStorage(filePath).append(createEntry("message", stored));
    const [entry] = await createJsonlStorage(filePath).read();
    const assets = new AssetStore({
      basePath: await mkdtemp(join(tmpdir(), "yesimbot-replay-missing-")),
      maxFileBytes: pngBytes.byteLength,
    });
    const onAssetMissing = vi.fn();
    const platformApi = vi.fn();
    vi.stubGlobal("fetch", platformApi);

    try {
      await expect(
        formatEvent((entry as { data: typeof stored }).data, {
          scope,
          assetStore: assets,
          includeMessageId: false,
          onAssetMissing,
        }),
      ).resolves.toEqual({
        role: "user",
        content:
          '[time="2026/7/18 20:34" sender="Alice (10001)"]\nstored text <img unavailable="true"/>',
      });
      expect(onAssetMissing).toHaveBeenCalledOnce();
      expect(onAssetMissing.mock.calls[0]?.[0]).toBe(frozen.assetId);
      expect(onAssetMissing.mock.calls[0]?.[1]).toEqual(
        expect.objectContaining({ code: "ENOENT" }),
      );
      expect(platformApi).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("emits no model message for a persisted non-message event", async () => {
    const event = createEvent({
      type: "delivery.failed",
      platform: scope.platform,
      selfId: scope.selfId,
      timestamp: Date.parse("2026-07-18T12:34:00.000Z"),
      channel: { id: scope.channelId },
      delivery: {
        turnId: "turn-1",
        messageId: "assistant-1",
        error: { name: "Error", message: "offline" },
      },
    } as EventRecord<"delivery.failed">);

    await expect(
      formatEvent(event, { scope, assetStore: assetStore(), includeMessageId: false }),
    ).resolves.toBeUndefined();
  });

  it("projects frozen non-message content without an event header", async () => {
    const event = createEvent({
      type: "delivery.failed",
      platform: scope.platform,
      selfId: scope.selfId,
      timestamp: Date.parse("2026-07-18T12:34:00.000Z"),
      channel: { id: scope.channelId },
      delivery: {
        turnId: "turn-1",
        messageId: "assistant-1",
        error: { name: "Error", message: "offline" },
      },
      content: "delivery failed",
    } as EventRecord<"delivery.failed">);

    await expect(
      formatEvent(event, { scope, assetStore: assetStore(), includeMessageId: false }),
    ).resolves.toEqual({
      role: "user",
      content: "delivery failed",
    });
  });

  it("projects a frozen non-message image without an empty text part", async () => {
    const assets = assetStore();
    assets.readByAssetId.mockResolvedValue(pngBytes);
    const event = createEvent({
      type: "delivery.failed",
      platform: scope.platform,
      selfId: scope.selfId,
      timestamp: Date.parse("2026-07-18T12:34:00.000Z"),
      channel: { id: scope.channelId },
      delivery: {
        turnId: "turn-1",
        messageId: "assistant-1",
        error: { name: "Error", message: "offline" },
      },
      content: '<img id="asset_hash" mime="image/png"/>',
    } as EventRecord<"delivery.failed">);

    await expect(
      formatEvent(event, { scope, assetStore: assets, includeMessageId: false }),
    ).resolves.toEqual({
      role: "user",
      content: [{ type: "image", image: pngBytes, mediaType: "image/png" }],
    });
  });
});
