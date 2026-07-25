import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createEntry, type AgentMessage, type ModelMessageContext } from "@yesimbot/agent-runtime";
import { describe, expect, it, vi } from "vitest";

vi.mock("koishi", async () => import("@koishijs/core"));

import { type ChannelScope } from "../src/channel/index.js";
import { formatEvent } from "../src/event/formatter.js";
import { createEvent, type EventRecord } from "../src/event/index.js";
import { selectEventFiles, type MediaSelectionOptions } from "../src/event/media.js";
import { createJsonlStorage } from "../src/runtime/storage.js";
import { AssetStore } from "../src/shared/asset.js";
import { ChannelStorage } from "../src/storage/index.js";

const scope: ChannelScope = {
  platform: "onebot",
  selfId: "bot-1",
  channelId: "room-42",
  isDirect: false,
};
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

function selectionContext(
  history: readonly AgentMessage[],
  current: readonly AgentMessage[] = [],
): ModelMessageContext {
  return { history, current } as ModelMessageContext;
}

function selectionOptions(
  assets: ReturnType<typeof assetStore>,
  overrides: Partial<Omit<MediaSelectionOptions, "assetStore" | "scope">> = {},
): MediaSelectionOptions {
  return {
    scope,
    assetStore: assets,
    imageInput: true,
    policy: {
      enabled: true,
      maxImages: 4,
      maxImageBytes: 5 * 1024 * 1024,
      maxTotalImageBytes: 10 * 1024 * 1024,
      strategy: "current-first",
    },
    ...overrides,
  };
}

describe("formatEvent", () => {
  describe("selectEventFiles", () => {
    it("does not read assets when either global or model image input is disabled", async () => {
      const assets = assetStore();
      const context = selectionContext([messageEvent('<img id="asset_disabled"/>')]);

      await expect(
        selectEventFiles(context, selectionOptions(assets, { imageInput: false })),
      ).resolves.toEqual(new Map());
      await expect(
        selectEventFiles(
          context,
          selectionOptions(assets, {
            policy: { ...selectionOptions(assets).policy, enabled: false },
          }),
        ),
      ).resolves.toEqual(new Map());
      expect(assets.readByAssetId).not.toHaveBeenCalled();
    });

    it("visits current then history by default and resets its budget for a later empty current step", async () => {
      const assets = assetStore();
      assets.readByAssetId.mockResolvedValue(pngBytes);
      const current = messageEvent('<img id="asset_current"/>');
      const history = messageEvent('<img id="asset_history"/>');

      const initial = await selectEventFiles(
        selectionContext([history], [current]),
        selectionOptions(assets, {
          policy: { ...selectionOptions(assets).policy, maxImages: 1 },
        }),
      );
      const later = await selectEventFiles(
        selectionContext([history]),
        selectionOptions(assets, {
          policy: { ...selectionOptions(assets).policy, maxImages: 1 },
        }),
      );

      expect(initial.get(current.id)?.map((file) => file.mediaType)).toEqual(["image/png"]);
      expect(initial.get(history.id)?.length ?? 0).toBe(0);
      expect(later.get(history.id)?.map((file) => file.mediaType)).toEqual(["image/png"]);
      expect(assets.readByAssetId.mock.calls.map((call) => call[1])).toEqual([
        "asset_current",
        "asset_history",
      ]);
    });

    it("uses FIFO and LIFO event visitation while retaining source order within one Event", async () => {
      const assets = assetStore();
      assets.readByAssetId.mockResolvedValue(pngBytes);
      const first = messageEvent('<img id="asset_first_a"/><img id="asset_first_b"/>');
      const second = messageEvent('<img id="asset_second"/>');

      await selectEventFiles(
        selectionContext([first, second]),
        selectionOptions(assets, { policy: { ...selectionOptions(assets).policy, strategy: "fifo" } }),
      );
      await selectEventFiles(
        selectionContext([first, second]),
        selectionOptions(assets, { policy: { ...selectionOptions(assets).policy, strategy: "lifo" } }),
      );

      expect(assets.readByAssetId.mock.calls.map((call) => call[1])).toEqual([
        "asset_first_a",
        "asset_first_b",
        "asset_second",
        "asset_second",
        "asset_first_a",
        "asset_first_b",
      ]);
    });

    it("uses the default four-image limit and skips unsupported bytes before later valid images", async () => {
      const assets = assetStore();
      const unsupported = new Uint8Array([0x3c, 0x73, 0x76, 0x67]);
      assets.readByAssetId.mockImplementation(async (_scope, assetId) =>
        assetId === "asset_svg" ? unsupported : pngBytes,
      );
      const event = messageEvent(
        '<img id="asset_svg"/><img id="asset_1"/><img id="asset_2"/><img id="asset_3"/><img id="asset_4"/><img id="asset_5"/>',
      );

      const selected = await selectEventFiles(selectionContext([event]), selectionOptions(assets));

      expect(selected.get(event.id)?.map((file) => file.mediaType)).toEqual([
        "image/png",
        "image/png",
        "image/png",
        "image/png",
      ]);
      expect(assets.readByAssetId.mock.calls.map((call) => call[1])).toEqual([
        "asset_svg",
        "asset_1",
        "asset_2",
        "asset_3",
        "asset_4",
      ]);
    });

    it("charges duplicate references independently and skips failures or oversized candidates for later fitting files", async () => {
      const assets = assetStore();
      const oversized = new Uint8Array(9);
      assets.readByAssetId.mockImplementation(async (_scope, assetId) => {
        if (assetId === "asset_missing") throw new Error("missing");
        return assetId === "asset_large" ? oversized : pngBytes;
      });
      const event = messageEvent(
        '<img id="asset_missing"/><img id="asset_large"/><img id="asset_duplicate"/><img id="asset_duplicate"/><img id="asset_svg"/>',
      );

      const selected = await selectEventFiles(
        selectionContext([event]),
        selectionOptions(assets, {
          policy: {
            ...selectionOptions(assets).policy,
            maxImages: 2,
            maxImageBytes: 8,
            maxTotalImageBytes: 16,
          },
        }),
      );

      expect(assets.readByAssetId.mock.calls.map((call) => call[1])).toEqual([
        "asset_missing",
        "asset_large",
        "asset_duplicate",
        "asset_duplicate",
      ]);
      expect(selected.get(event.id)?.map((file) => file.data)).toEqual([pngBytes, pngBytes]);
    });

    it("reads only matching scoped local assets and ignores non-Event custom messages", async () => {
      const assets = assetStore();
      assets.readByAssetId.mockResolvedValue(pngBytes);
      const event = messageEvent('<img id="asset_local"/>');
      const unrelated = { id: "other", timestamp: 0, role: "custom", type: "other", data: {} } as AgentMessage;
      const platformApi = vi.fn();
      vi.stubGlobal("fetch", platformApi);

      try {
        await selectEventFiles(selectionContext([unrelated, event]), selectionOptions(assets));
        expect(assets.readByAssetId).toHaveBeenCalledWith(scope, "asset_local");
        expect(platformApi).not.toHaveBeenCalled();
      } finally {
        vi.unstubAllGlobals();
      }
    });
  });

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
    const storage = new ChannelStorage(basePath);
    await storage.start();
    const assets = new AssetStore({ storage, maxFileBytes: pngBytes.byteLength });
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
    const sourceStorage = new ChannelStorage(sourcePath);
    await sourceStorage.start();
    const sourceAssets = new AssetStore({
      storage: sourceStorage,
      maxFileBytes: pngBytes.byteLength,
    });
    const frozen = await sourceAssets.put(scope, pngBytes);
    const stored = messageEvent(`stored text <img id="${frozen.assetId}" mime="${frozen.mime}"/>`);
    await createJsonlStorage(filePath).append(createEntry("message", stored));
    const [entry] = await createJsonlStorage(filePath).read();
    const storage = new ChannelStorage(await mkdtemp(join(tmpdir(), "yesimbot-replay-missing-")));
    await storage.start();
    const assets = new AssetStore({
      storage,
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
