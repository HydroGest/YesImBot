import { describe, expect, it } from "vitest";

import {
  channelFileName,
  channelKey,
  channelPath,
  sameChannel,
  type ChannelScope,
} from "../src/channel/index.js";

const scope: ChannelScope = { platform: "onebot", selfId: "bot-1", channelId: "room/42" };

describe("ChannelScope", () => {
  it("uses an injective canonical identity and an opaque v2 persistence path", () => {
    const delimiterCollision: ChannelScope = {
      platform: "onebot:bot-1",
      selfId: "room",
      channelId: "42",
    };

    expect(channelKey(scope)).not.toBe(channelKey(delimiterCollision));
    expect(channelKey(scope)).toBe(JSON.stringify(["onebot", "bot-1", "room/42"]));
    expect(channelFileName(scope)).toMatch(/^channel_v2_[A-Za-z0-9_-]{43}$/);
    expect(channelFileName(scope)).not.toContain(scope.platform);
    expect(channelFileName(scope)).not.toContain(scope.selfId);
    expect(channelFileName(scope)).not.toContain(scope.channelId);
    expect(channelPath("/tmp/athena", scope)).toBe(
      `/tmp/athena/sessions/${channelFileName(scope)}.jsonl`,
    );
  });

  it("keeps filename-safe collisions in separate scopes", () => {
    const slash: ChannelScope = { ...scope, channelId: "room/a" };
    const question: ChannelScope = { ...scope, channelId: "room?a" };

    expect(channelFileName(slash)).not.toBe(channelFileName(question));
    expect(channelPath("/tmp/athena", slash)).not.toBe(channelPath("/tmp/athena", question));
  });

  it("compares channel identity without comparing object identity", () => {
    expect(sameChannel(scope, { ...scope })).toBe(true);
    expect(sameChannel(scope, { ...scope, channelId: "other" })).toBe(false);
  });
});
