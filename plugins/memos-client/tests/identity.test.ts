import { createChannelScopeId } from "koishi-plugin-yesimbot/channel";
import { describe, expect, it } from "vitest";

import { deriveMemosIdentity } from "../src/identity.js";

describe("MemOS identity", () => {
  const channelScope = {
    platform: "onebot",
    selfId: "bot",
    channelId: "group",
  } as const;

  it("uses subject-scoped user ids for group chats without bot self id", () => {
    const identity = deriveMemosIdentity({
      channelScope,
      channelType: "group",
      authorId: "user",
      messageId: "msg",
      turnId: "turn",
    });
    const otherBotIdentity = deriveMemosIdentity({
      channelScope: { ...channelScope, selfId: "other-bot" },
      channelType: "group",
      authorId: "user",
      messageId: "msg",
      turnId: "turn",
    });

    expect(identity.userId).toMatch(/^yb_subject_[A-Za-z0-9_-]{22}$/);
    expect(otherBotIdentity.userId).toBe(identity.userId);
    expect(otherBotIdentity.agentId).not.toBe(identity.agentId);
    expect(identity.conversationId).toMatch(/^yb_conv_[A-Za-z0-9_-]{22}$/);
    expect(identity.agentId).toMatch(/^yb_agent_[A-Za-z0-9_-]{22}$/);
    expect(identity.info.memory_scope).toBe("channel");
    expect(identity.info.scene).toBe("group_chat");
    expect(JSON.stringify(identity.info)).not.toContain('"channelId"');
    expect(JSON.stringify(identity.info)).not.toContain('"authorId"');
    expect(JSON.stringify(identity.info)).not.toContain('"selfId"');
    expect(JSON.stringify(identity.info)).not.toContain('"messageId"');
    expect(JSON.stringify(identity.info)).not.toContain('"raw_channel_id"');
    expect(JSON.stringify(identity.info)).not.toContain('"raw_author_id"');
    expect(JSON.stringify(identity.info)).not.toContain('"raw_self_id"');
    expect(JSON.stringify(identity.info)).not.toContain('"raw_message_id"');
    expect(identity.info.channel_hash).toBe(createChannelScopeId(channelScope));
    expect(identity.info.channel_hash).toMatch(/^ch_v1_[a-z2-7]{16}$/);
    expect(identity.info.subject_hash).toHaveLength(22);
    expect(identity.info.author_hash).toHaveLength(22);
    expect(identity.info.message_hash).toHaveLength(22);
  });

  it("uses turn-scoped conversation ids for runtime writes", () => {
    const firstTurn = deriveMemosIdentity({
      channelScope,
      channelType: "group",
      authorId: "user",
      turnId: "turn-a",
    });
    const secondTurn = deriveMemosIdentity({
      channelScope,
      channelType: "group",
      authorId: "user",
      turnId: "turn-b",
    });

    expect(firstTurn.userId).toBe(secondTurn.userId);
    expect(firstTurn.conversationId).not.toBe(secondTurn.conversationId);
    expect(firstTurn.conversationId).not.toBe(`yb_conv_${createChannelScopeId(channelScope)}`);
  });

  it("uses subject-scoped user ids for private chats", () => {
    const identity = deriveMemosIdentity({
      channelScope: {
        platform: "onebot",
        selfId: "bot",
        channelId: "private",
      },
      channelType: "private",
      authorId: "user",
      messageId: "msg",
      turnId: "turn",
    });
    const otherBotIdentity = deriveMemosIdentity({
      channelScope: {
        platform: "onebot",
        selfId: "other-bot",
        channelId: "private",
      },
      channelType: "private",
      authorId: "user",
      messageId: "msg",
      turnId: "turn",
    });

    expect(identity.userId).toMatch(/^yb_subject_[A-Za-z0-9_-]{22}$/);
    expect(otherBotIdentity.userId).toBe(identity.userId);
    expect(identity.info.memory_scope).toBe("user");
    expect(identity.info.scene).toBe("private_chat");
  });

  it("allows forcing user scoped memory in group chats", () => {
    const identity = deriveMemosIdentity({
      channelScope,
      channelType: "group",
      authorId: "user",
      turnId: "turn",
      memoryScope: "user",
    });

    expect(identity.userId).toMatch(/^yb_subject_[A-Za-z0-9_-]{22}$/);
    expect(identity.info.memory_scope).toBe("user");
  });

  it("allows forcing channel scoped memory in private chats", () => {
    const identity = deriveMemosIdentity({
      channelScope: {
        platform: "onebot",
        selfId: "bot",
        channelId: "private",
      },
      channelType: "private",
      authorId: "user",
      turnId: "turn",
      memoryScope: "channel",
    });

    expect(identity.userId).toMatch(/^yb_subject_[A-Za-z0-9_-]{22}$/);
    expect(identity.info.memory_scope).toBe("channel");
  });

  it("includes raw ids only when explicitly opted in", () => {
    const identity = deriveMemosIdentity({
      channelScope,
      channelType: "group",
      authorId: "user",
      messageId: "msg",
      turnId: "turn",
      includeRawIdentityInfo: true,
    });

    expect(identity.info).toMatchObject({
      raw_channel_id: "group",
      raw_author_id: "user",
      raw_self_id: "bot",
      raw_message_id: "msg",
    });
  });
});
