import { describe, expect, it, vi } from "vitest";

vi.mock("koishi", async () => import("@koishijs/core"));

import type { Session } from "koishi";

import { resolveOneBotEvent } from "../src/events.js";

function makeSession(onebot: Record<string, unknown> = {}): Session {
  return {
    platform: "onebot",
    selfId: "10000",
    channelId: "20000",
    userId: "30000",
    timestamp: 1,
    event: {},
    onebot,
  } as unknown as Session;
}

describe("resolveOneBotEvent", () => {
  it("produces a typed reaction event from a valid reactions-updated notice", () => {
    const result = resolveOneBotEvent(
      makeSession({
        post_type: "notice",
        notice_type: "message_reactions_updated",
        group_id: "20000",
        message_id: "40000",
        user_id: "30000",
        reactions: [{ emoji_id: "100", emoji_type: "1", count: 5 }],
      }),
    );

    expect(result).toMatchObject({
      type: "onebot.message-reactions-updated",
      platform: "onebot",
      selfId: "10000",
      channel: { id: "20000" },
      reaction: {
        messageId: "40000",
        userId: "30000",
        reactions: [{ id: "100", type: "1", count: 5 }],
      },
    });
    expect(result).not.toHaveProperty("content");
  });

  it.each([
    {},
    { post_type: "notice", notice_type: "group_increase" },
    { post_type: "notice", notice_type: "message_reactions_updated", group_id: "20000" },
  ])("returns null for unsupported or incomplete input", (onebot) => {
    expect(resolveOneBotEvent(makeSession(onebot))).toBeNull();
  });

  it("preserves numeric protocol identifiers and zero reaction counts", () => {
    const result = resolveOneBotEvent(
      makeSession({
        post_type: "notice",
        notice_type: "message_reactions_updated",
        group_id: 20000,
        message_id: 40000,
        user_id: 30000,
        reactions: [{ emoji_id: 100, emoji_type: 1, count: 0 }],
      }),
    );
    expect(result?.reaction).toMatchObject({
      messageId: "40000",
      reactions: [{ id: "100", count: 0 }],
    });
  });
});
