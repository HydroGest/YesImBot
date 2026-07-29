import { createEntry, type AgentMessage, type ModelMessageContext } from "@yesimbot/agent-runtime";
import type { FilePart, UserModelMessage } from "ai";
import { describe, expect, it, vi } from "vitest";

vi.mock("koishi", async () => import("@koishijs/core"));

import { h } from "koishi";

import { type ChannelScope } from "../src/channel.js";
import { appendModelFiles, formatInput } from "../src/event/formatter.js";
import {
  createEvent,
  createMessage,
  type Event,
  type EventRecord,
  type MessageRecord,
} from "../src/input.js";
import { selectInputFiles, type MediaSelectionOptions } from "../src/media/index.js";

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

function messageRecordWithText(
  text: string,
  overrides: { timestamp?: number } = {},
): MessageRecord {
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
  const readByAssetId = vi.fn<() => Promise<Uint8Array>>();
  return { readByAssetId, get: (id: string) => readByAssetId(scope, id) };
}

function pngBytesOfLength(byteLength: number): Uint8Array {
  const data = new Uint8Array(byteLength);
  data.set(pngBytes);
  return data;
}

const fiveMiBPngBytes = pngBytesOfLength(FIVE_MIB);
const oversizedPngBytes = pngBytesOfLength(FIVE_MIB + 1);

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
      maxCount: 4,
      maxBytesPerImage: 5 * 1024 * 1024,
      maxTotalBytes: 10 * 1024 * 1024,
      selection: "current-first",
    },
    ...overrides,
  };
}

describe("formatInput", () => {
  it("narrows declaration-merged Event data by eventType", () => {
    const event: Event = createEvent(deliveryFailureRecord());

    if (event.data.eventType !== "delivery.failed") throw new Error("Unexpected event type");

    expect(event.data.delivery.messageId).toBe("assistant-1");
  });

  it("formats a message from stored text and resources", () => {
    const input = createMessage(
      messageRecord({
        timestamp: new Date("2026-07-25T12:34:00.000Z").valueOf(),
      }),
    );
    expect(formatInput(input, { includeMessageId: true })).toEqual({
      role: "user",
      content: '[time="2026/7/25 20:34" sender="Alice (10001)" id="m-1"]\nhello',
    });
  });

  it("projects JSONL-replayed elements deterministically", () => {
    const original = createMessage(messageRecord());
    const replayed = JSON.parse(JSON.stringify(original)) as typeof original;

    const first = formatInput(replayed, { includeMessageId: true }).content;
    const second = formatInput(replayed, { includeMessageId: true }).content;

    expect(first).toBe(second);
    expect(first).not.toContain("[object Object]");
    expect(first).toContain("\nhello");
  });

  it("formats a non-message event with eventType and text", () => {
    const content = formatInput(createEvent(deliveryFailureRecord()), {
      includeMessageId: false,
    }).content;
    expect(content).toContain('"eventType":"delivery.failed"');
    expect(content).toContain('"text":"failed"');
  });

  it("projects no declaration-merged event fields into the model notification", () => {
    const content = formatInput(createEvent(formatterVariantRecord()), {
      includeMessageId: false,
    }).content;

    expect(content).toContain('"eventType":"formatter.variant"');
    expect(content).toContain('"text":"variant"');
    expect(content).not.toContain("extra");
    expect(content).not.toContain("do-not-project");
  });

  describe("selectInputFiles", () => {
    it("does not read assets when either global or model image input is disabled", async () => {
      const assets = assetStore();
      const context = selectionContext([
        createMessage(messageRecordWithText('<img id="asset_disabled"/>')),
      ]);

      await expect(
        selectInputFiles(context, selectionOptions(assets, { imageInput: false })),
      ).resolves.toEqual(new Map());
      await expect(
        selectInputFiles(
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
      const current = createMessage(messageRecordWithText('<img id="asset_current"/>'));
      const history = createMessage(messageRecordWithText('<img id="asset_history"/>'));

      const initial = await selectInputFiles(
        selectionContext([history], [current]),
        selectionOptions(assets, {
          policy: { ...selectionOptions(assets).policy, maxCount: 1 },
        }),
      );
      const later = await selectInputFiles(
        selectionContext([history]),
        selectionOptions(assets, {
          policy: { ...selectionOptions(assets).policy, maxCount: 1 },
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

    it("uses a fresh unified budget for each model context", async () => {
      const assets = assetStore();
      assets.readByAssetId.mockResolvedValue(pngBytes);
      const first = createMessage(
        messageRecordWithText('<img id="asset_first"/><img id="asset_second"/>'),
      );
      const second = createMessage(messageRecordWithText('<img id="asset_later"/>'));
      const policy = {
        enabled: true,
        maxCount: 1,
        maxBytesPerImage: 8,
        maxTotalBytes: 8,
        selection: "current-first" as const,
      };

      const initial = await selectInputFiles(
        selectionContext([first]),
        selectionOptions(assets, { policy }),
      );
      const later = await selectInputFiles(
        selectionContext([second]),
        selectionOptions(assets, { policy }),
      );

      expect(initial.get(first.id)).toHaveLength(1);
      expect(later.get(second.id)).toHaveLength(1);
    });

    it("uses FIFO and LIFO event visitation while retaining source order within one Input", async () => {
      const assets = assetStore();
      assets.readByAssetId.mockResolvedValue(pngBytes);
      const first = createMessage(
        messageRecordWithText('<img id="asset_first_a"/><img id="asset_first_b"/>'),
      );
      const second = createMessage(messageRecordWithText('<img id="asset_second"/>'));

      await selectInputFiles(
        selectionContext([first, second]),
        selectionOptions(assets, {
          policy: { ...selectionOptions(assets).policy, selection: "fifo" },
        }),
      );
      await selectInputFiles(
        selectionContext([first, second]),
        selectionOptions(assets, {
          policy: { ...selectionOptions(assets).policy, selection: "lifo" },
        }),
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
      const input = createMessage(
        messageRecordWithText(
          '<img id="asset_svg"/><img id="asset_1"/><img id="asset_2"/><img id="asset_3"/><img id="asset_4"/><img id="asset_5"/>',
        ),
      );

      const selected = await selectInputFiles(selectionContext([input]), selectionOptions(assets));

      expect(selected.get(input.id)?.map((file) => file.mediaType)).toEqual([
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

    it("accepts an image at the exact default five MiB per-image boundary", async () => {
      const assets = assetStore();
      assets.readByAssetId.mockResolvedValue(fiveMiBPngBytes);
      const input = createMessage(messageRecordWithText('<img id="asset_boundary"/>'));

      const selected = await selectInputFiles(selectionContext([input]), selectionOptions(assets));

      expect(selected.get(input.id)?.map((file) => file.data.byteLength)).toEqual([FIVE_MIB]);
    });

    it("skips an image above the default five MiB boundary and accepts a later fitting image", async () => {
      const assets = assetStore();
      assets.readByAssetId.mockImplementation(async (_scope, assetId) =>
        assetId === "asset_oversized" ? oversizedPngBytes : fiveMiBPngBytes,
      );
      const input = createMessage(
        messageRecordWithText('<img id="asset_oversized"/><img id="asset_fitting"/>'),
      );

      const selected = await selectInputFiles(selectionContext([input]), selectionOptions(assets));

      expect(selected.get(input.id)?.[0]?.data).toBe(fiveMiBPngBytes);
      expect(assets.readByAssetId.mock.calls.map((call) => call[1])).toEqual([
        "asset_oversized",
        "asset_fitting",
      ]);
    });

    it("accepts the exact default ten MiB total boundary and stops before reading later candidates", async () => {
      const assets = assetStore();
      assets.readByAssetId.mockResolvedValue(fiveMiBPngBytes);
      const input = createMessage(
        messageRecordWithText(
          '<img id="asset_first"/><img id="asset_second"/><img id="asset_unread"/>',
        ),
      );

      const selected = await selectInputFiles(selectionContext([input]), selectionOptions(assets));

      expect(selected.get(input.id)?.map((file) => file.data.byteLength)).toEqual([
        FIVE_MIB,
        FIVE_MIB,
      ]);
      expect(assets.readByAssetId.mock.calls.map((call) => call[1])).toEqual([
        "asset_first",
        "asset_second",
      ]);
    });

    it("diagnoses invalid bytes and read failures without allowing diagnostic callbacks to interrupt selection", async () => {
      const assets = assetStore();
      const invalidBytes = new Uint8Array([0x3c, 0x73, 0x76, 0x67]);
      const readFailure = new Error("missing");
      assets.readByAssetId.mockImplementation(async (_scope, assetId) => {
        if (assetId === "asset_invalid") return invalidBytes;
        if (assetId === "asset_missing") throw readFailure;
        return pngBytes;
      });
      const diagnostics = vi.fn(() => {
        throw new Error("diagnostic failed");
      });
      const input = createMessage(
        messageRecordWithText(
          '<img id="asset_invalid"/><img id="asset_missing"/><img id="asset_valid"/>',
        ),
      );

      const selected = await selectInputFiles(
        selectionContext([input]),
        selectionOptions(assets, { onAssetFailure: diagnostics }),
      );

      expect(selected.get(input.id)?.map((file) => file.data)).toEqual([pngBytes]);
      expect(diagnostics).toHaveBeenCalledTimes(2);
      expect(diagnostics.mock.calls[0]?.[0]).toBe("asset_invalid");
      expect(diagnostics.mock.calls[0]?.[1]).toEqual(
        expect.objectContaining({ name: "UnsupportedImageMimeError" }),
      );
      expect(diagnostics.mock.calls[1]).toEqual(["asset_missing", readFailure]);
    });

    it("charges duplicate references independently and skips failures or oversized candidates for later fitting files", async () => {
      const assets = assetStore();
      const oversized = new Uint8Array(9);
      assets.readByAssetId.mockImplementation(async (_scope, assetId) => {
        if (assetId === "asset_missing") throw new Error("missing");
        return assetId === "asset_large" ? oversized : pngBytes;
      });
      const input = createMessage(
        messageRecordWithText(
          '<img id="asset_missing"/><img id="asset_large"/><img id="asset_duplicate"/><img id="asset_duplicate"/><img id="asset_svg"/>',
        ),
      );

      const selected = await selectInputFiles(
        selectionContext([input]),
        selectionOptions(assets, {
          policy: {
            ...selectionOptions(assets).policy,
            maxCount: 2,
            maxBytesPerImage: 8,
            maxTotalBytes: 16,
          },
        }),
      );

      expect(assets.readByAssetId.mock.calls.map((call) => call[1])).toEqual([
        "asset_missing",
        "asset_large",
        "asset_duplicate",
        "asset_duplicate",
      ]);
      expect(selected.get(input.id)?.map((file) => file.data)).toEqual([pngBytes, pngBytes]);
    });

    it("reads only matching scoped local assets and ignores non-Input custom messages", async () => {
      const assets = assetStore();
      assets.readByAssetId.mockResolvedValue(pngBytes);
      const input = createMessage(messageRecordWithText('<img id="asset_local"/>'));
      const unrelated = {
        id: "other",
        timestamp: 0,
        role: "custom",
        type: "other",
        data: {},
      } as AgentMessage;
      const platformApi = vi.fn();
      vi.stubGlobal("fetch", platformApi);

      try {
        await selectInputFiles(selectionContext([unrelated, input]), selectionOptions(assets));
        expect(assets.readByAssetId).toHaveBeenCalledWith(scope, "asset_local");
        expect(platformApi).not.toHaveBeenCalled();
      } finally {
        vi.unstubAllGlobals();
      }
    });

    it("finds frozen assets nested inside message elements", async () => {
      const assets = assetStore();
      assets.readByAssetId.mockResolvedValue(pngBytes);
      const input = createMessage({
        ...messageRecord(),
        elements: [
          h("p", {}, [
            h("span", {}, [h("img", { id: "asset_nested", mime: "image/png" })]),
          ]),
        ],
      });

      await selectInputFiles(selectionContext([input]), selectionOptions(assets));

      expect(input.data.elements[0]?.children[0]?.children[0]?.attrs.id).toBe("asset_nested");
      expect(assets.readByAssetId).toHaveBeenCalledWith(scope, "asset_nested");
    });
  });

  it("preserves the exact frozen message literal and appends selected files", () => {
    const files: readonly FilePart[] = [{ type: "file", data: pngBytes, mediaType: "image/png" }];
    const elements = [h("p", {}, [h.text("  "), h("img", { id: "asset_1" }), h.text("\n")])];

    expect(
      formatInput(createMessage({ ...messageRecord(), elements }), {
        includeMessageId: true,
        files,
      }),
    ).toEqual({
      role: "user",
      content: [
        {
          type: "text",
          text: '[time="2026/7/18 20:34" sender="Alice (10001)" id="m-1"]\n<p>  <img id="asset_1"/>\n</p>',
        },
        ...files,
      ],
    });
  });

  it("keeps empty message bodies and no-file content shapes unchanged", () => {
    const text = '[time="2026/7/18 20:34" sender="Alice (10001)"]\n';
    const input = createMessage(messageRecordWithText(""));
    const message = formatInput(input, { includeMessageId: false });
    const content: UserModelMessage["content"] = [{ type: "text", text: "original" }];

    expect(message).toEqual({ role: "user", content: text });
    expect(appendModelFiles(content, [])).toBe(content);
    expect(appendModelFiles("original", [])).toBe("original");
  });

  it("preserves array element references and appends files only at the tail", () => {
    const original: UserModelMessage["content"] = [{ type: "text", text: "first" }];
    const file: FilePart = { type: "file", data: pngBytes, mediaType: "image/png" };
    const result = appendModelFiles(original, [file]);

    expect(result).toEqual([{ type: "text", text: "first" }, file]);
    expect(Array.isArray(result) && result[0]).toBe(original[0]);
    expect(appendModelFiles("", [file])).toEqual([{ type: "text", text: "" }, file]);
  });

  it("wraps every non-message event with eventType and text in JSON", () => {
    const event = createEvent(deliveryFailureRecord());
    const file: FilePart = { type: "file", data: pngBytes, mediaType: "image/png" };

    const result = formatInput(event, { includeMessageId: false, files: [file] });
    expect(result.role).toBe("user");
    expect(Array.isArray(result.content)).toBe(true);
    const textPart = (result.content as Array<{ type: string; text: string }>)[0];
    expect(textPart.text).toContain("[SYSTEM_NOTIFICATION]");
    expect(textPart.text).toContain('"eventType":"delivery.failed"');
    expect(textPart.text).toContain('"text":"failed"');
    expect(textPart.text).toContain("[/SYSTEM_NOTIFICATION]");
  });
});
