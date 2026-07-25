import { describe, expect, it } from "vitest";

import { deriveMemosIdentity, deriveMemosImportChunkIdentity } from "../src/identity.js";

describe("MemOS identity", () => {
  const channelScope = {
    platform: "onebot",
    selfId: "bot",
    channelId: "group",
    isDirect: false,
  } as const;

  it("uses the caller-provided Core channel identity as channel_hash", () => {
    const identity = deriveMemosIdentity({
      channelScope: {
        platform: "onebot",
        selfId: "10000",
        channelId: "123456",
        isDirect: false,
      },
      channelHash: "a5vnf2ijd75c2ibyo2s5czdir4",
      channelType: "group",
      authorId: "user-1",
      turnId: "turn-1",
    });
    expect(identity.info.channel_hash).toBe("a5vnf2ijd75c2ibyo2s5czdir4");
    expect(identity.agentId).toMatch(/^yb_agent_/);
    expect(identity.userId).toMatch(/^yb_subject_/);
    expect(identity.conversationId).toMatch(/^yb_conv_/);
  });

  it("produces same channel_hash across shared scope with different selfId", () => {
    const botA = deriveMemosIdentity({
      channelScope: {
        platform: "onebot",
        selfId: "10000",
        channelId: "123456",
        isDirect: false,
      },
      channelHash: "a5vnf2ijd75c2ibyo2s5czdir4",
      channelType: "group",
      authorId: "user-1",
      turnId: "turn-1",
    });
    const botB = deriveMemosIdentity({
      channelScope: {
        platform: "onebot",
        selfId: "20000",
        channelId: "123456",
        isDirect: false,
      },
      channelHash: "a5vnf2ijd75c2ibyo2s5czdir4",
      channelType: "group",
      authorId: "user-1",
      turnId: "turn-1",
    });

    expect(botA.info.channel_hash).toBe("a5vnf2ijd75c2ibyo2s5czdir4");
    expect(botB.info.channel_hash).toBe("a5vnf2ijd75c2ibyo2s5czdir4");
    expect(botA.agentId).not.toBe(botB.agentId);
    expect(botA.userId).toBe(botB.userId);
    expect(botA.conversationId).toBe(botB.conversationId);
  });

  it("isolates direct scope channel_hash per selfId", () => {
    const botA = deriveMemosIdentity({
      channelScope: {
        platform: "onebot",
        selfId: "10000",
        channelId: "123456",
        isDirect: true,
      },
      channelHash: "ymdz53gzamgvzjzrtf6vesoal4",
      channelType: "private",
      authorId: "user-1",
      turnId: "turn-1",
    });
    const botB = deriveMemosIdentity({
      channelScope: {
        platform: "onebot",
        selfId: "other-bot",
        channelId: "123456",
        isDirect: true,
      },
      channelHash: "de52upe373ixjr6dmt54sadbxu",
      channelType: "private",
      authorId: "user-1",
      turnId: "turn-1",
    });

    expect(botA.info.channel_hash).toBe("ymdz53gzamgvzjzrtf6vesoal4");
    expect(botB.info.channel_hash).toBe("de52upe373ixjr6dmt54sadbxu");
    expect(botA.agentId).not.toBe(botB.agentId);
    expect(botA.userId).toBe(botB.userId);
  });

  it("uses subject-scoped user ids for group chats without bot self id", () => {
    const identity = deriveMemosIdentity({
      channelScope,
      channelHash: "76rnoqazbgqomsofkjtqxbwi4a",
      channelType: "group",
      authorId: "user",
      messageId: "msg",
      turnId: "turn",
    });
    const otherBotIdentity = deriveMemosIdentity({
      channelScope: { ...channelScope, selfId: "other-bot" },
      channelHash: "76rnoqazbgqomsofkjtqxbwi4a",
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
    expect(identity.info.channel_hash).toBe("76rnoqazbgqomsofkjtqxbwi4a");
    expect(identity.info.channel_hash).toMatch(/^[a-z2-7]{25}[aeimquy4]$/);
    expect(identity.info.subject_hash).toHaveLength(22);
    expect(identity.info.author_hash).toHaveLength(22);
    expect(identity.info.message_hash).toHaveLength(22);
  });

  it("uses turn-scoped conversation ids for runtime writes", () => {
    const firstTurn = deriveMemosIdentity({
      channelScope,
      channelHash: "76rnoqazbgqomsofkjtqxbwi4a",
      channelType: "group",
      authorId: "user",
      turnId: "turn-a",
    });
    const secondTurn = deriveMemosIdentity({
      channelScope,
      channelHash: "76rnoqazbgqomsofkjtqxbwi4a",
      channelType: "group",
      authorId: "user",
      turnId: "turn-b",
    });

    expect(firstTurn.userId).toBe(secondTurn.userId);
    expect(firstTurn.conversationId).not.toBe(secondTurn.conversationId);
    expect(firstTurn.conversationId).not.toBe(`yb_conv_${firstTurn.info.channel_hash}`);
  });

  it("uses subject-scoped user ids for private chats", () => {
    const identity = deriveMemosIdentity({
      channelScope: {
        platform: "onebot",
        selfId: "bot",
        channelId: "private",
        isDirect: true,
      },
      channelHash: "avh4rqo2rempfq2gs2ehxe7bnm",
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
        isDirect: true,
      },
      channelHash: "g5lqg6ysfyc5vovopasee2uzle",
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
      channelHash: "76rnoqazbgqomsofkjtqxbwi4a",
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
        isDirect: true,
      },
      channelHash: "avh4rqo2rempfq2gs2ehxe7bnm",
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
      channelHash: "76rnoqazbgqomsofkjtqxbwi4a",
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

  it("uses the Core channel identity for imported history", () => {
    const identity = deriveMemosImportChunkIdentity({
      channelScope,
      channelHash: "76rnoqazbgqomsofkjtqxbwi4a",
      channelType: "group",
      chunkStartIso: "2026-07-22T00:00:00.000Z",
      chunkEndIso: "2026-07-22T00:01:00.000Z",
      firstMessageId: "first",
      lastMessageId: "last",
      chunkIndex: 0,
    });

    expect(identity.info.channel_hash).toBe("76rnoqazbgqomsofkjtqxbwi4a");
    expect(identity.info.channel_hash).toMatch(/^[a-z2-7]{25}[aeimquy4]$/);
  });
});
