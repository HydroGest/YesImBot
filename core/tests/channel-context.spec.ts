import { describe, expect, it, vi } from "vitest";

vi.mock("koishi", async () => import("@koishijs/core"));

import { type ChannelContext, deriveChannelKey } from "../src/channels/context.js";

describe("deriveChannelKey", () => {
  it("derives key for type=channel", () => {
    const ctx: ChannelContext = { type: "channel", platform: "onebot", channelId: "100", guildId: "200" };
    expect(deriveChannelKey(ctx)).toBe("channel:onebot:200:100");
  });

  it("derives key for type=guild", () => {
    const ctx: ChannelContext = { type: "guild", platform: "discord", channelId: "300", guildId: "300" };
    expect(deriveChannelKey(ctx)).toBe("guild:discord:300");
  });

  it("derives key for type=direct", () => {
    const ctx: ChannelContext = { type: "direct", platform: "telegram", channelId: "u:42", selfId: "bot1", userId: "user42" };
    expect(deriveChannelKey(ctx)).toBe("direct:telegram:user42:bot1");
  });

  it("throws when channel type is missing guildId", () => {
    const ctx = { type: "channel", platform: "onebot", channelId: "100", guildId: "" } as unknown as ChannelContext;
    expect(() => deriveChannelKey(ctx)).toThrow();
  });

  it("throws when direct type is missing selfId", () => {
    const ctx = { type: "direct", platform: "onebot", channelId: "100", selfId: "", userId: "u1" } as unknown as ChannelContext;
    expect(() => deriveChannelKey(ctx)).toThrow();
  });

  it("throws when direct type is missing userId", () => {
    const ctx = { type: "direct", platform: "onebot", channelId: "100", selfId: "bot1", userId: "" } as unknown as ChannelContext;
    expect(() => deriveChannelKey(ctx)).toThrow();
  });

  it("throws on unknown type", () => {
    const ctx = { type: "unknown", platform: "onebot", channelId: "100" } as unknown as ChannelContext;
    expect(() => deriveChannelKey(ctx)).toThrow();
  });
});
