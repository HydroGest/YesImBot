import { describe, expect, it, vi } from "vitest";

vi.mock("koishi", async () => import("@koishijs/core"));

import { channelKey, sameChannel, type ChannelScope } from "../src/channel/index.js";

const shared = (selfId: string): ChannelScope => ({
  platform: "onebot",
  selfId,
  channelId: "123456",
  isDirect: false,
});

const direct = (selfId: string): ChannelScope => ({
  platform: "onebot",
  selfId,
  channelId: "123456",
  isDirect: true,
});

describe("channelKey", () => {
  it("matches the shared conformance vector and ignores selfId", () => {
    expect(channelKey(shared("10000"))).toBe("a5vnf2ijd75c2ibyo2s5czdir4");
    expect(channelKey(shared("20000"))).toBe("a5vnf2ijd75c2ibyo2s5czdir4");
    expect(sameChannel(shared("10000"), shared("20000"))).toBe(true);
  });

  it("matches direct conformance vectors and retains selfId", () => {
    expect(channelKey(direct("10000"))).toBe("ymdz53gzamgvzjzrtf6vesoal4");
    expect(channelKey(direct("20000"))).toBe("3fdpuhlm2tmzybzrlgxotmtmxq");
    expect(sameChannel(direct("10000"), direct("20000"))).toBe(false);
  });

  it("matches the Unicode vector without normalization", () => {
    expect(
      channelKey({
        platform: "测试",
        selfId: "机器人 01",
        channelId: "群/α",
        isDirect: false,
      }),
    ).toBe("jhmjjrbkhmceyookuqyolglf7m");
  });

  it.each(["platform", "selfId", "channelId"] as const)("rejects empty %s", (field) => {
    const scope = { ...direct("10000"), [field]: "" };
    expect(() => channelKey(scope)).toThrow(`ChannelScope.${field}`);
  });
});
