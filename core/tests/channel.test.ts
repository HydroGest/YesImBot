import { describe, expect, it, vi } from "vitest";

vi.mock("koishi", async () => import("@koishijs/core"));

import * as core from "../src/index.js";
import { channelDirectoryName, type ChannelScope } from "../src/runtime/storage.js";

const shared = (selfId: string): ChannelScope => ({
  type: "shared",
  platform: "onebot",
  selfId,
  channelId: "123456",
});

const direct = (selfId: string): ChannelScope => ({
  type: "direct",
  platform: "onebot",
  selfId,
  channelId: "123456",
});

describe("ChannelScope storage coordinates", () => {
  it("uses one readable shared directory regardless of the current Bot", () => {
    expect(channelDirectoryName(shared("10000"))).toBe("shared-onebot-123456");
    expect(channelDirectoryName(shared("20000"))).toBe("shared-onebot-123456");
  });

  it("uses distinct readable direct directories for distinct Bots", () => {
    expect(channelDirectoryName(direct("10000"))).toBe("direct-onebot-123456-10000");
    expect(channelDirectoryName(direct("20000"))).toBe("direct-onebot-123456-20000");
  });

  it("encodes delimiter-looking coordinates without escaping the channel root", () => {
    expect(
      channelDirectoryName({
        type: "shared",
        platform: "one/bot",
        selfId: "bot/../one",
        channelId: "room/../alpha",
      }),
    ).toBe("shared-one%2f%bot-room%2f%%2e%%2e%%2f%alpha");
  });

  it.each(["platform", "selfId", "channelId"] as const)("rejects empty %s", (field) => {
    const scope = { ...direct("10000"), [field]: "" };
    expect(() => channelDirectoryName(scope)).toThrow();
  });

  it("exports ChannelScope without a public channel identity", () => {
    const exported = core as Record<string, unknown>;
    expect(["channel", "Identity"].join("") in exported).toBe(false);
    expect("channelKey" in exported).toBe(false);
  });
});
