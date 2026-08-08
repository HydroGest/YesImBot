import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createEntry } from "@yesimbot/agent-runtime";
import { afterEach, describe, expect, it } from "vitest";

import { Conversation } from "../src/conversations/index.js";

describe("Conversation.archive", () => {
  const roots: string[] = [];
  afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

  it("switches active storage to a fresh session", async () => {
    const root = await mkdtemp(join(tmpdir(), "yesimbot-archive-"));
    roots.push(root);
    const conversation = new Conversation(root);
    await conversation.init();
    await conversation.storage.append(createEntry("message", { id: "m1", timestamp: 1, role: "user", content: "hello" }));

    await conversation.archive();

    expect(await conversation.storage.read()).toEqual([]);
    expect(await conversation.list()).toHaveLength(2);
  });
  it("rejects archiving an empty session without creating a destination", async () => {
    const root = await mkdtemp(join(tmpdir(), "yesimbot-archive-"));
    roots.push(root);
    const conversation = new Conversation(root);
    await conversation.init();
    const before = await conversation.list();
    await expect(conversation.archive(true)).rejects.toThrow("Cannot archive an empty session");
    expect(await conversation.list()).toEqual(before);
  });

  it("creates a blank destination when noSummary is explicit", async () => {
    const root = await mkdtemp(join(tmpdir(), "yesimbot-archive-"));
    roots.push(root);
    const conversation = new Conversation(root);
    await conversation.init();
    await conversation.storage.append(createEntry("message", { id: "m1", timestamp: 1, role: "user", content: "hello" }));
    await conversation.archive(true);
    expect(await conversation.storage.read()).toEqual([]);
    expect((await conversation.list()).filter((item) => item.isActive)).toHaveLength(1);
  });
});
