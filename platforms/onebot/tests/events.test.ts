import { describe, expect, it, vi } from "vitest";

vi.mock("koishi", async () => import("@koishijs/core"));

import type { Session } from "koishi";

import { refineMessageReactionsUpdated } from "../src/events.js";
import type { MessageReactionsUpdatedData } from "../src/events.js";

function makeSession(onebot: Record<string, unknown> = {}): Session {
  return {
    platform: "onebot",
    selfId: "10000",
    channelId: "20000",
    userId: "30000",
    event: {},
    onebot,
  } as unknown as Session;
}

describe("refineMessageReactionsUpdated", () => {
  it("produces an event draft from a valid reactions-updated notice", () => {
    const result = refineMessageReactionsUpdated(
      makeSession({
        post_type: "notice",
        notice_type: "message_reactions_updated",
        group_id: "20000",
        message_id: "40000",
        user_id: "30000",
        reactions: [{ emoji_id: "100", emoji_type: "1", count: 5 }],
      }),
    );

    expect(result).toBeDefined();
    expect(result!.type).toBe("onebot.message-reactions-updated");
    expect(result!.source).toEqual({ platform: "onebot", selfId: "10000" });
    expect(result!.scope).toEqual({ type: "channel", channelId: "20000" });
    expect(result!.data).toMatchObject({
      messageId: "40000",
      userId: "30000",
      reactions: [{ id: "100", type: "1", count: 5 }],
    });
    expect(typeof result!.content).toBe("string");
    expect(result!.content).toContain("40000");
  });

  it("returns undefined for non-notice sessions", () => {
    expect(refineMessageReactionsUpdated(makeSession({}))).toBeUndefined();
  });

  it("returns undefined for non-reactions notices", () => {
    expect(
      refineMessageReactionsUpdated(
        makeSession({
          post_type: "notice",
          notice_type: "group_increase",
        }),
      ),
    ).toBeUndefined();
  });

  it("returns undefined for incomplete notices", () => {
    expect(
      refineMessageReactionsUpdated(
        makeSession({
          post_type: "notice",
          notice_type: "message_reactions_updated",
          group_id: "20000",
        }),
      ),
    ).toBeUndefined();
  });

  it("treats reactions with 0 count as valid", () => {
    const result = refineMessageReactionsUpdated(
      makeSession({
        post_type: "notice",
        notice_type: "message_reactions_updated",
        group_id: "20000",
        message_id: "40000",
        user_id: "30000",
        reactions: [{ emoji_id: "100", emoji_type: "1", count: 0 }],
      }),
    );
    expect(result?.data.reactions[0].count).toBe(0);
  });

  it("uses string identifiers for numeric protocol ids", () => {
    const result = refineMessageReactionsUpdated(
      makeSession({
        post_type: "notice",
        notice_type: "message_reactions_updated",
        group_id: 20000,
        message_id: 40000,
        user_id: 30000,
        reactions: [{ emoji_id: 100, emoji_type: 1, count: 5 }],
      }),
    );
    expect(result?.data.messageId).toBe("40000");
    expect(result?.data.reactions[0].id).toBe("100");
  });
});
