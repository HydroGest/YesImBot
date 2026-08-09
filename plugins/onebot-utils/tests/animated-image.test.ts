import type { AgentEntry } from "@yesimbot/agent-runtime";
import { createMessageEntry } from "@yesimbot/agent-runtime";
import { h, Universal, type Element } from "koishi";
import type { Message, MessageRecord } from "koishi-plugin-yesimbot";
import { describe, expect, it, vi } from "vitest";

vi.mock("koishi", async () => import("@koishijs/core"));

import { projectAnimatedImages } from "../src/animated-image.js";

const ID = "00000000000000000000000000000000";

function messageEntry(subType: unknown, id = ID, summary?: string): AgentEntry {
  const record: MessageRecord = {
    platform: "onebot",
    selfId: "bot-1",
    channel: { id: "group", type: Universal.Channel.Type.TEXT },
    user: { id: "user-1", name: "User" },
    messageId: "m-1",
    elements: [h("img", { id, ...(subType === undefined ? {} : { subType }), ...(summary === undefined ? {} : { summary }) })],
    timestamp: 1,
  };
  const message: Message = {
    id: "m-1",
    timestamp: 1,
    role: "custom",
    type: "yesimbot.message",
    data: {
      platform: record.platform,
      selfId: record.selfId,
      channel: record.channel,
      user: record.user,
      messageId: record.messageId,
      elements: record.elements,
    },
  };
  return createMessageEntry(message);
}

function textElement(content: string): Element {
  return h("text", { content });
}

describe("animated image projection", () => {
  it("replaces persisted subtype-one images with an animated emoji text element", () => {
    const [projected] = projectAnimatedImages([messageEntry(1, ID, "大笑")]);
    const message = projected.data as { data: { elements: readonly Element[] } };

    expect(message.data.elements).toEqual([textElement(`[动画表情: 大笑 asset://${ID}]`)]);
  });

  it("omits image summary when summary attachment is disabled", () => {
    const [projected] = projectAnimatedImages([messageEntry(1, ID, "大笑")], { attachImageSummary: false });
    const message = projected.data as { data: { elements: readonly Element[] } };

    expect(message.data.elements).toEqual([textElement(`[动画表情: asset://${ID}]`)]);
  });

  it("treats images with non-empty summary as animated without subtype metadata", () => {
    const [projected] = projectAnimatedImages([messageEntry(undefined, ID, "大笑")]);
    const message = projected.data as { data: { elements: readonly Element[] } };

    expect(message.data.elements).toEqual([textElement(`[动画表情: 大笑 asset://${ID}]`)]);
  });

  it("keeps ordinary images unchanged for Core projection", () => {
    const [projected] = projectAnimatedImages([messageEntry(undefined)]);
    const message = projected.data as { data: { elements: readonly Element[] } };

    expect(message.data.elements).toEqual([h("img", { id: ID })]);
  });

  it("supports snake_case subtype metadata", () => {
    const record: MessageRecord = {
      platform: "onebot",
      selfId: "bot-1",
      channel: { id: "group", type: Universal.Channel.Type.TEXT },
      user: { id: "user-1", name: "User" },
      messageId: "m-2",
      elements: [h("img", { id: ID, sub_type: "1", summary: "微笑" })],
      timestamp: 1,
    };
    const message: Message = {
      id: "m-2",
      timestamp: 1,
      role: "custom",
      type: "yesimbot.message",
      data: {
        platform: record.platform,
        selfId: record.selfId,
        channel: record.channel,
        user: record.user,
        messageId: record.messageId,
        elements: record.elements,
      },
    };
    const [projected] = projectAnimatedImages([createMessageEntry(message)]);
    const projectedMessage = projected.data as { data: { elements: readonly Element[] } };

    expect(projectedMessage.data.elements).toEqual([textElement(`[动画表情: 微笑 asset://${ID}]`)]);
  });
});
