import { describe, expect, it } from "vitest";

import {
  createMessageRoute,
  getChannelScope,
  getChannelType,
  isSelfMessage,
  mentionsSelf,
} from "../src/runtime/message.js";

describe("message flow helpers", () => {
  it("detects bot self messages", () => {
    expect(isSelfMessage({ userId: "bot", selfId: "bot" })).toBe(true);
    expect(isSelfMessage({ userId: "user", selfId: "bot" })).toBe(false);
  });

  it("detects direct channel type and scope without including type in the scope", () => {
    const session = {
      platform: "onebot",
      selfId: "bot",
      channelId: "private:user",
      subtype: "private",
    };

    expect(getChannelType(session)).toBe("private");
    expect(getChannelScope(session)).toEqual({
      platform: "onebot",
      selfId: "bot",
      channelId: "private:user",
    });
  });

  it("detects bot mentions from Koishi element strings and elements", () => {
    expect(mentionsSelf({ selfId: "bot", content: '<at id="bot"/> hello' })).toBe(true);
    expect(
      mentionsSelf({
        selfId: "bot",
        content: "hello",
        elements: [{ type: "at", attrs: { id: "bot" } }],
      }),
    ).toBe(true);
    expect(mentionsSelf({ selfId: "bot", content: '<at id="other"/> hello' })).toBe(false);
  });

  it("routes ordinary group messages to append and reply-eligible messages to send or join", () => {
    const group = {
      platform: "onebot",
      selfId: "bot",
      channelId: "group",
      userId: "user",
      content: "hello",
    };

    expect(createMessageRoute(group, { isBusy: false })).toEqual({ action: "append" });
    expect(
      createMessageRoute({ ...group, content: '<at id="bot"/> hello' }, { isBusy: false }),
    ).toEqual({ action: "send" });
    expect(
      createMessageRoute({ ...group, content: '<at id="bot"/> hello' }, { isBusy: true }),
    ).toEqual({ action: "join" });
    expect(createMessageRoute({ ...group, subtype: "private" }, { isBusy: false })).toEqual({
      action: "send",
    });
    expect(createMessageRoute({ ...group, userId: "bot" }, { isBusy: false })).toEqual({
      action: "ignore",
    });
  });
});
