import { describe, expect, it, vi } from "vitest";

vi.mock("koishi", async () => import("@koishijs/core"));

import * as core from "../src/index.js";
import { channelIdentity, sameChannel, type ChannelScope } from "../src/channel/index.js";

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

describe("channelIdentity", () => {
  it("matches the shared conformance vector and ignores selfId", () => {
    expect(channelIdentity(shared("10000"))).toBe("a5vnf2ijd75c2ibyo2s5czdir4");
    expect(channelIdentity(shared("20000"))).toBe("a5vnf2ijd75c2ibyo2s5czdir4");
    expect(sameChannel(shared("10000"), shared("20000"))).toBe(true);
  });

  it("matches direct conformance vectors and retains selfId", () => {
    expect(channelIdentity(direct("10000"))).toBe("ymdz53gzamgvzjzrtf6vesoal4");
    expect(channelIdentity(direct("20000"))).toBe("3fdpuhlm2tmzybzrlgxotmtmxq");
    expect(sameChannel(direct("10000"), direct("20000"))).toBe(false);
  });

  it("matches the Unicode vector without normalization", () => {
    expect(
      channelIdentity({
        platform: "测试",
        selfId: "机器人 01",
        channelId: "群/α",
        isDirect: false,
      }),
    ).toBe("jhmjjrbkhmceyookuqyolglf7m");
  });

  it.each(["platform", "selfId", "channelId"] as const)("rejects empty %s", (field) => {
    const scope = { ...direct("10000"), [field]: "" };
    expect(() => channelIdentity(scope)).toThrow(`ChannelScope.${field}`);
  });

  it("exports channelIdentity and not channelKey from the package root", () => {
    expect(core.channelIdentity).toEqual(expect.any(Function));
    expect("channelKey" in core).toBe(false);
  });
});
