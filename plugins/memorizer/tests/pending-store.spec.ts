import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { PendingStore } from "../src/store/pending.js";

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

const channel = { type: "guild", platform: "test", channelId: "room", guildId: "room" } as const;

async function store(): Promise<PendingStore> {
  const root = await mkdtemp(path.join(tmpdir(), "yesimbot-pending-"));
  roots.push(root);
  const pending = new PendingStore(root);
  await pending.init();
  return pending;
}

describe("PendingStore", () => {
  it("stores only requests and selects the ordered prefix with the overflow item", async () => {
    const pending = await store();
    await pending.enqueue({ content: "first", sources: ["one"], channel, turnId: "turn", messageCount: 200, queuedAt: 1 });
    await pending.enqueue({ content: "second", sources: ["two"], channel, turnId: "turn", messageCount: 200, queuedAt: 2 });
    const batch = await pending.nextBatch(channel, 10, 300);

    expect(batch.map((item) => item.content)).toEqual(["first", "second"]);
    expect(JSON.stringify(await pending.list())).not.toContain("messages");
  });

  it("only completes or retries selected entries and unsuspends a channel on new input", async () => {
    const pending = await store();
    const first = await pending.enqueue({ content: "first", sources: ["one"], channel, turnId: "turn", messageCount: 1, queuedAt: 1 });
    const second = await pending.enqueue({ content: "second", sources: ["two"], channel, turnId: "turn", messageCount: 1, queuedAt: 2 });
    await pending.fail([first.id], new Error("offline"), 1_000, 8);
    await pending.complete([second.id]);
    expect(await pending.list()).toMatchObject([{ id: first.id, attempts: 1, suspended: false, nextAttemptAt: 61_000 }]);

    await pending.fail([first.id], new Error("offline"), 2_000, 8);
    await pending.fail([first.id], new Error("offline"), 3_000, 8);
    await pending.fail([first.id], new Error("offline"), 4_000, 8);
    await pending.fail([first.id], new Error("offline"), 5_000, 8);
    await pending.fail([first.id], new Error("offline"), 6_000, 8);
    await pending.fail([first.id], new Error("offline"), 7_000, 8);
    await pending.fail([first.id], new Error("offline"), 8_000, 8);
    expect((await pending.list())[0]).toMatchObject({ suspended: true, attempts: 8 });
    await pending.enqueue({ content: "wake", sources: ["three"], channel, turnId: "turn", messageCount: 1, queuedAt: 9_000 });
    expect((await pending.list()).find((item) => item.id === first.id)).toMatchObject({ suspended: false, attempts: 8, nextAttemptAt: 9_000 });
  });
});
