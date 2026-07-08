import { createCustomMessage } from "@yesimbot/agent-runtime";
import { describe, expect, it } from "vitest";

import {
  createPlatformMessage,
  createMessageRoute,
  platformMessagePlugin,
  type PlatformMessage,
} from "../src/runtime/message.js";

describe("platform message runtime plugin", () => {
  it("creates a platform custom message while preserving Koishi content exactly", () => {
    const message = createPlatformMessage({
      id: "session_1",
      messageId: "message_1",
      timestamp: 123,
      platform: "onebot",
      selfId: "bot",
      channelId: "group",
      userId: "user_1",
      username: "Alice",
      content: '<at id="bot"/> hello',
    });

    expect(message).toMatchObject({
      role: "custom",
      type: "athena.platform.message",
      id: "message_1",
      timestamp: 123,
      data: {
        version: 1,
        source: {
          platform: "onebot",
          selfId: "bot",
          channelId: "group",
          conversationType: "group",
        },
        author: { id: "user_1", name: "Alice" },
        message: { content: '<at id="bot"/> hello' },
      },
    });
  });

  it("lets runtime message defaults fill missing message id and timestamp", () => {
    const message = createPlatformMessage({
      platform: "onebot",
      selfId: "bot",
      channelId: "group",
      userId: "user_1",
      content: "hello",
    });

    expect(message.id).toMatch(/[0-9a-f-]{36}/i);
    expect(message.timestamp).toEqual(expect.any(Number));
  });

  it("uses the same author fallback for self-message routing", () => {
    const route = createMessageRoute(
      {
        platform: "onebot",
        selfId: "bot",
        channelId: "group",
        author: { id: "bot" },
        content: "hello",
      } as never,
      { isBusy: false },
    );

    expect(route).toEqual({ action: "ignore" });
  });

  it("projects platform messages to user model messages with sender display", async () => {
    const data: PlatformMessage = {
      version: 1,
      source: {
        platform: "onebot",
        selfId: "bot",
        channelId: "group",
        conversationType: "group",
      },
      author: { id: "u1", name: "Alice" },
      message: { content: '<at id="bot"/> hello' },
    };

    const result = await platformMessagePlugin.toModelMessages?.(
      createCustomMessage("athena.platform.message", data, { id: "m1", timestamp: 1 }),
      {} as never,
    );

    expect(result).toEqual({
      role: "user",
      content: '[Alice]: <at id="bot"/> hello',
    });
  });

  it("leaves unknown custom messages for other plugins", async () => {
    const result = await platformMessagePlugin.toModelMessages?.(
      {
        role: "custom",
        type: "athena.platform.event",
        id: "evt_1",
        timestamp: 1,
        data: {
          version: 1,
          kind: "test.event",
          source: {
            platform: "onebot",
            selfId: "bot",
            channelId: "group",
            conversationType: "group",
          },
          author: { id: "u1" },
        },
      },
      {} as never,
    );

    expect(result).toBeUndefined();
  });
});
