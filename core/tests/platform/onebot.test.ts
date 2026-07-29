import { describe, expect, it, vi } from "vitest";

vi.mock("koishi", async () => import("@koishijs/core"));

import { h, type Session } from "koishi";

import type { AssetStore } from "../../src/asset.js";
import { resolveOneBotEvent } from "../../src/platforms/onebot/events.js";
import { createResolver } from "../../src/platforms/onebot/index.js";

function makeSession(overrides: Record<string, unknown> = {}): Session {
  return {
    platform: "onebot",
    selfId: "10000",
    channelId: "20000",
    userId: "30000",
    timestamp: 1,
    type: "message-created",
    messageId: "40000",
    event: { type: "message", user: { name: "Alice" }, channel: { name: "Room" } },
    elements: [h.text("hello")],
    onebot: {},
    ...overrides,
  } as unknown as Session;
}

function store(put: AssetStore["put"]): AssetStore {
  return { put, get: vi.fn(), clear: vi.fn(async () => undefined) };
}

describe("resolveOneBotEvent", () => {
  it("produces a typed reaction event", () => {
    const result = resolveOneBotEvent(makeSession({
      onebot: {
        post_type: "notice", notice_type: "message_reactions_updated", group_id: "20000",
        message_id: "40000", user_id: "30000", reactions: [{ emoji_id: "100", emoji_type: "1", count: 0 }],
      },
    }));
    expect(result).toMatchObject({
      kind: "event", eventType: "onebot.message-reactions-updated",
      reaction: { messageId: "40000", userId: "30000", reactions: [{ id: "100", type: "1", count: 0 }] },
    });
  });
});

describe("OneBot resolver", () => {
  it("persists nested images in document order while preserving non-image elements", async () => {
    const resolver = createResolver({ http: vi.fn() } as never);
    const persisted = h("img", { id: "0123456789abcdef0123456789abcdef" });
    const assets = store(vi.fn(async () => persisted));
    const result = await resolver.resolve(makeSession({
      elements: [h("p", { class: "copy" }, [
        h.text("before"), h("img", { src: "data:image/png;base64,iVBORw==" }), h.text("after"),
      ])],
    }), assets);

    expect(assets.put).toHaveBeenCalledOnce();
    expect(result).toMatchObject({
      kind: "message",
      elements: [h("p", { class: "copy" }, [h.text("before"), persisted, h.text("after")])],
    });
  });

  it("keeps an original image when loading or storing it fails", async () => {
    const resolver = createResolver({ http: vi.fn(async () => { throw new Error("offline"); }) } as never);
    const original = h("img", { src: "https://example.test/image.png" });
    const result = await resolver.resolve(makeSession({ elements: [original] }), store(vi.fn()));
    expect(result).toMatchObject({ kind: "message", elements: [original] });
  });

  it("does not turn an image without src into a resolution failure", async () => {
    const resolver = createResolver({ http: vi.fn() } as never);
    const original = h("img", { id: "existing" });
    const result = await resolver.resolve(makeSession({ elements: [original] }), store(vi.fn()));
    expect(result).toMatchObject({ kind: "message", elements: [original] });
  });

  it("returns supported notices and skips unsupported sessions", async () => {
    const resolver = createResolver({ http: vi.fn() } as never);
    await expect(resolver.resolve(makeSession({ type: "notice", elements: undefined }), store(vi.fn()))).resolves.toBeNull();
  });
});
