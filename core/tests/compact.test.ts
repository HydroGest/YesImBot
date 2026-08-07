import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createEntry } from "@yesimbot/agent-runtime";
import { afterEach, describe, expect, it } from "vitest";

import { Conversation } from "../src/conversations/index.js";

describe("Conversation.compact", () => {
  const roots: string[] = [];
  afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

  it("writes a new active compact session rather than returning a transition placeholder", async () => {
    const root = await mkdtemp(join(tmpdir(), "yesimbot-conversation-"));
    roots.push(root);
    const conversation = new Conversation(root);
    await conversation.init();
    await conversation.storage.append(
      createEntry("message", { id: "m1", timestamp: 1, role: "user", content: "first" }),
      createEntry("message", { id: "m2", timestamp: 2, role: "assistant", content: "second" }),
    );

    await expect(conversation.compact("manual")).resolves.toEqual({ compacted: true });
    expect((await conversation.list()).filter((item) => item.isActive)).toHaveLength(1);
    expect(await conversation.storage.read()).toHaveLength(1);
  });
});
