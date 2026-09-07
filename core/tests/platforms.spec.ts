import { describe, expect, it, vi } from "vitest";

vi.mock("koishi", async () => import("@koishijs/core"));

import { h, type Session } from "koishi";

import { OneBotTranslator } from "../src/platforms/onebot.js";

function createSession(overrides: Record<string, unknown> = {}): Session {
  return {
    type: "message-created",
    platform: "onebot",
    selfId: "10000",
    channelId: "20000",
    userId: "30000",
    timestamp: 1,
    messageId: "40000",
    isDirect: false,
    event: { type: "message", channel: { type: 0, name: "Room" }, user: { id: "30000", name: "Alice" } },
    elements: [h.text("hello")],
    ...overrides,
  } as Session;
}

describe("OneBotTranslator", () => {
  it("persists live-session images through ChannelResources", async () => {
    const id = "0123456789abcdef0123456789abcdef";
    const resources = {
      persistElements: vi.fn(async (_ctx: unknown, elements: ReadonlyArray<{ type: string; attrs: Record<string, unknown> }>) =>
        elements.map((el) => (el.type === "img" ? h("img", { ...el.attrs, id }) : el)),
      ),
    };

    const record = await new OneBotTranslator({ http: vi.fn() } as never).translate(
      createSession({ elements: [h("img", { src: "https://onebot.example/image" })] }),
      resources as never,
    );

    expect(resources.persistElements).toHaveBeenCalledOnce();
    expect(record).toMatchObject({ platform: "onebot", selfId: "10000", messageId: "40000", elements: [h("img", { id })] });
  });

  it("maps a poke notice to its frozen event record", async () => {
    const record = await new OneBotTranslator({ http: vi.fn() } as never).translate(
      createSession({
        type: "notice",
        messageId: undefined,
        elements: undefined,
        event: { type: "notice", subtype: "poke", channel: { type: 0 }, _data: { user_id: 30000, target_id: 10000 } },
      }),
      { assets: { put: vi.fn() } } as never,
    );

    expect(record).toMatchObject({ eventType: "notice.poke", targetId: "10000", action: "拍了拍" });
    expect(record).not.toHaveProperty("_data");
  });
});
