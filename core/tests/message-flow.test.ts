import { describe, expect, it, vi } from "vitest";

vi.mock("koishi", async () => import("@koishijs/core"));

import { h } from "koishi";

import type { Platform } from "../src/platform/types.js";
import {
  classifyMessage,
  createPlatformMessage,
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

  it("classifies messages without consulting runtime busy state", () => {
    const group = {
      platform: "onebot",
      selfId: "bot",
      channelId: "group",
      userId: "user",
      content: "hello",
    };

    expect(classifyMessage(group)).toBe("append");
    expect(classifyMessage({ ...group, content: '<at id="bot"/> hello' })).toBe("reply");
    expect(classifyMessage({ ...group, subtype: "private" })).toBe("reply");
    expect(classifyMessage({ ...group, userId: "bot" })).toBe("ignore");
  });

  it("creates a persisted platform message from a domain message with elements", () => {
    const domainMessage: Platform.Message = {
      source: { platform: "onebot", selfId: "bot" },
      scope: { type: "channel", channelId: "group" },
      sender: { id: "user", name: "Alice" },
      messageId: "m1",
      receivedAt: 1,
      elements: [h.text("hello")],
    };

    const runtimeMessage = createPlatformMessage(domainMessage);

    expect(runtimeMessage.role).toBe("custom");
    expect(runtimeMessage.type).toBe("athena.platform.message");
    // Data is a MessageRecord (content literal, not elements).
    const data = runtimeMessage.data as Record<string, unknown>;
    expect(data.content).toBe("hello");
    expect(data.elements).toBeUndefined();
  });
});
