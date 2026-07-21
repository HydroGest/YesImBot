import { describe, expect, it, vi } from "vitest";

vi.mock("koishi", async () => import("@koishijs/core"));

import { h } from "koishi";

import { DEFAULT_MESSAGE_ROUTING, type MessageRoutingConfig } from "../src/config.js";
import type { Platform } from "../src/platform/types.js";
import {
  classifyMessage,
  createPlatformMessage,
  getChannelScope,
  isSelfMessage,
  mentionsSelf,
} from "../src/runtime/message.js";

function platformMessage(overrides: Partial<Platform.Message> = {}): Platform.Message {
  return {
    source: { platform: "test", selfId: "bot" },
    scope: { type: "channel", channelId: "room", channelType: "group" },
    sender: { id: "user" },
    messageId: "m1",
    receivedAt: 1,
    elements: [h.text("hello")],
    ...overrides,
  };
}

describe("message flow helpers", () => {
  it("detects bot self messages", () => {
    expect(isSelfMessage(platformMessage({ sender: { id: "bot" } }))).toBe(true);
    expect(isSelfMessage(platformMessage())).toBe(false);
  });

  it("derives channel scope from the canonical message", () => {
    expect(getChannelScope(platformMessage())).toEqual({
      platform: "test",
      selfId: "bot",
      channelId: "room",
    });
  });

  it("detects bot mentions from canonical elements", () => {
    expect(mentionsSelf(platformMessage({ elements: [h("at", { id: "bot" })] }))).toBe(true);
    expect(mentionsSelf(platformMessage({ elements: [h("at", { id: "other" })] }))).toBe(false);
  });

  it("classifies canonical messages with the default routing policy", () => {
    expect(classifyMessage(platformMessage(), DEFAULT_MESSAGE_ROUTING)).toBe("append");
    expect(
      classifyMessage(
        platformMessage({ elements: [h("at", { id: "bot" })] }),
        DEFAULT_MESSAGE_ROUTING,
      ),
    ).toBe("reply");
    expect(
      classifyMessage(
        platformMessage({
          scope: { type: "channel", channelId: "dm", channelType: "private" },
        }),
        DEFAULT_MESSAGE_ROUTING,
      ),
    ).toBe("reply");
    expect(
      classifyMessage(platformMessage({ sender: { id: "bot" } }), DEFAULT_MESSAGE_ROUTING),
    ).toBe("ignore");
  });

  it("maps each non-self scenario independently", () => {
    const routing: MessageRoutingConfig = {
      direct: "append",
      mention: "append",
      group: "reply",
    };

    expect(
      classifyMessage(
        platformMessage({
          scope: { type: "channel", channelId: "dm", channelType: "private" },
        }),
        routing,
      ),
    ).toBe("append");
    expect(classifyMessage(platformMessage({ elements: [h("at", { id: "bot" })] }), routing)).toBe(
      "append",
    );
    expect(classifyMessage(platformMessage(), routing)).toBe("reply");
    expect(classifyMessage(platformMessage({ sender: { id: "bot" } }), routing)).toBe("ignore");
  });

  it("creates a persisted platform message from a domain message with elements", () => {
    const domainMessage: Platform.Message = {
      source: { platform: "onebot", selfId: "bot" },
      scope: { type: "channel", channelId: "group", channelType: "group" },
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
