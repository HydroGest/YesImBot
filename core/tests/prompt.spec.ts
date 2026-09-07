import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { buildCoreSystemPrompt } from "../src/runtimes/prompt.js";

describe("buildCoreSystemPrompt", () => {
  it("tells the model that text output is never delivered and send_message is the only path", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "yesimbot-prompt-"));
    try {
      const prompt = await buildCoreSystemPrompt({
        basePath: root,
        channel: { type: "guild", platform: "test", channelId: "room", guildId: "room" },
        selfId: "bot",
        customInnerThought: false,
      });

      const constitution = String(prompt[0].content);
      expect(constitution).toContain("你输出的文本不会被发送到任何地方");
      expect(constitution).toContain("send_message");
      expect(constitution).not.toContain("# 最终回复标签");
      expect(constitution).not.toContain("<reply>");
      expect(constitution).not.toContain("<message/>");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("points inner thought at the send_message field instead of an output tag", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "yesimbot-prompt-"));
    try {
      const enabled = await buildCoreSystemPrompt({
        basePath: root,
        channel: { type: "guild", platform: "test", channelId: "room", guildId: "room" },
        selfId: "bot",
        customInnerThought: true,
      });
      const disabled = await buildCoreSystemPrompt({
        basePath: root,
        channel: { type: "guild", platform: "test", channelId: "room", guildId: "room" },
        selfId: "bot",
        customInnerThought: false,
      });

      expect(String(enabled[0].content)).toContain("send_message 的 inner_thought 字段");
      expect(String(disabled[0].content)).not.toContain("# 内心独白");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("no longer emits a separate message-elements system block", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "yesimbot-prompt-"));
    try {
      const prompt = await buildCoreSystemPrompt({
        basePath: root,
        channel: { type: "guild", platform: "test", channelId: "room", guildId: "room" },
        selfId: "bot",
      });

      expect(prompt.map((block) => String(block.content)).some((content) => content.startsWith("# 消息元素"))).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
