import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createMessageEntry, createUserMessage, type AgentEntry } from "@yesimbot/agent-runtime";

import { afterEach, describe, expect, it } from "vitest";

import { createChatHistoryStore } from "../src/history.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function messageEntry(id: string, timestamp: number): AgentEntry {
  const message = createUserMessage("hello", { id: `${id}-message`, timestamp });
  return createMessageEntry(message, { id, timestamp });
}

describe("createChatHistoryStore", () => {
  it("trims to the newest entries and persists the rewrite", async () => {
    const root = await mkdtemp(join(tmpdir(), "chat-learning-history-"));
    roots.push(root);
    const path = join(root, "history.jsonl");
    const store = createChatHistoryStore(path);
    await store.init();
    const now = Date.now();
    await store.append([messageEntry("e1", now - 2000), messageEntry("e2", now - 1000), messageEntry("e3", now)]);

    const retained = await store.trim(1_000_000, 2);

    expect(retained.map((entry) => entry.id)).toEqual(["e2", "e3"]);
    const reopened = createChatHistoryStore(path);
    await reopened.init();
    expect((await reopened.read()).map((entry) => entry.id)).toEqual(["e2", "e3"]);
  });

  it("drops entries older than the retention window", async () => {
    const root = await mkdtemp(join(tmpdir(), "chat-learning-history-"));
    roots.push(root);
    const path = join(root, "history.jsonl");
    const store = createChatHistoryStore(path);
    await store.init();
    const now = Date.now();
    await store.append([messageEntry("old", now - 2000), messageEntry("new", now - 1000)]);

    const retained = await store.trim(1500, 100);

    expect(retained.map((entry) => entry.id)).toEqual(["new"]);
  });
});
