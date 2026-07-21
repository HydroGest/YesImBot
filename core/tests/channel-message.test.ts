import { describe, expect, it, vi } from "vitest";

vi.mock("koishi", async () => import("@koishijs/core"));

import { h } from "koishi";

import { DEFAULT_MESSAGE_ROUTING } from "../src/config.js";
import type { Platform } from "../src/platform/index.js";
import { classifyMessage, createPlatformMessage } from "../src/runtime/message.js";

describe("platform message runtime plugin", () => {
  it("creates a platform custom message with persisted literal content", () => {
    const platformMessage: Platform.Message = {
      source: { platform: "onebot", selfId: "bot" },
      scope: { type: "channel", channelId: "group", channelType: "group" },
      sender: { id: "user_1", name: "Alice" },
      messageId: "message_1",
      timestamp: 123,
      receivedAt: 456,
      elements: [h("at", { id: "bot" }), h.text(" hello")],
    };

    const message = createPlatformMessage(platformMessage);

    expect(message).toMatchObject({
      role: "custom",
      type: "athena.platform.message",
      id: "message_1",
      timestamp: 123,
    });
    const data = message.data as Platform.MessageRecord;
    expect(data.content).toBe('<at id="bot"/> hello');
    expect(data).not.toHaveProperty("elements");
  });

  it("uses receivedAt as fallback when timestamp is absent", () => {
    const platformMessage: Platform.Message = {
      source: { platform: "onebot", selfId: "bot" },
      scope: { type: "channel", channelId: "group", channelType: "group" },
      sender: { id: "user_1" },
      messageId: "message_2",
      receivedAt: 789,
      elements: [h.text("hello")],
    };

    const message = createPlatformMessage(platformMessage);

    expect(message).toMatchObject({
      id: "message_2",
      timestamp: 789,
    });
    expect((message.data as Platform.MessageRecord).content).toBe("hello");
  });

  it("uses canonical sender identity for self-message routing", () => {
    const classification = classifyMessage(
      {
        source: { platform: "onebot", selfId: "bot" },
        scope: { type: "channel", channelId: "group", channelType: "group" },
        sender: { id: "bot" },
        messageId: "message_3",
        receivedAt: 1,
        elements: [h.text("hello")],
      },
      DEFAULT_MESSAGE_ROUTING,
    );

    expect(classification).toBe("ignore");
  });
});
