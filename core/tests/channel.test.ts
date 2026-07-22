import { describe, expect, it } from "vitest";

import {
  channelKey,
  channelPath,
  sameChannel,
  type ChannelScope,
} from "../src/channel/index.js";

const scope: ChannelScope = { platform: "onebot", selfId: "bot-1", channelId: "room/42" };

describe("ChannelScope", () => {
  it("keeps the canonical runtime key and deterministic session path", () => {
    expect(channelKey(scope)).toBe("onebot:bot-1:room/42");
    expect(channelPath("/tmp/athena", scope)).toBe(
      "/tmp/athena/sessions/onebot-bot-1-room_42.jsonl",
    );
  });

  it("compares channel identity without comparing object identity", () => {
    expect(sameChannel(scope, { ...scope })).toBe(true);
    expect(sameChannel(scope, { ...scope, channelId: "other" })).toBe(false);
  });
});
