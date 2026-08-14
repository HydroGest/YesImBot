import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { buildCoreSystemPrompt } from "../src/runtimes/prompt.js";

describe("buildCoreSystemPrompt", () => {
  it("injects final reply wrapper instructions when enabled", async () => {
    const root = await mkdtemp(join(tmpdir(), "yesimbot-prompt-"));
    try {
      const prompt = await buildCoreSystemPrompt({
        basePath: root,
        channel: { type: "guild", platform: "test", channelId: "room", guildId: "room" },
        selfId: "bot",
        customInnerThought: false,
        finalReplyTag: "reply",
      });

      expect(prompt[0].content).toContain("# 最终回复标签");
      expect(prompt[0].content).toContain("<reply>…</reply>");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("omits final reply wrapper instructions when disabled", async () => {
    const root = await mkdtemp(join(tmpdir(), "yesimbot-prompt-"));
    try {
      const prompt = await buildCoreSystemPrompt({
        basePath: root,
        channel: { type: "guild", platform: "test", channelId: "room", guildId: "room" },
        selfId: "bot",
        customInnerThought: false,
      });

      expect(String(prompt[0].content)).not.toContain("# 最终回复标签");
      expect(String(prompt[0].content)).not.toContain("<reply>");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
