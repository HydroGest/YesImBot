import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { createGlobalBrainStore, type GlobalBrainStore } from "../src/store.js";

const scopeA = {
  type: "shared",
  platform: "onebot",
  selfId: "bot-a",
  channelId: "group-a",
};

const scopeB = {
  type: "shared",
  platform: "onebot",
  selfId: "bot-a",
  channelId: "group-b",
};

async function makeStore(dir: string, now = 1_000): Promise<GlobalBrainStore> {
  const store = createGlobalBrainStore({
    filePath: join(dir, "brain.jsonl"),
    maxDigestThreads: 5,
    maxDigestReplies: 5,
    now: () => now,
    createId: createIdSequence(),
  });
  await store.init();
  return store;
}

function createIdSequence(): () => string {
  let next = 0;
  return () => `id-${++next}`;
}

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "global-brain-store-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe("GlobalBrainStore", () => {
  it("persists threads and replies and supports resolving", async () => {
    await withTempDir(async (dir) => {
      const store = await makeStore(dir);
      const thread = await store.deposit({
        kind: "question",
        sourceScope: scopeA as never,
        content: "谁手上有 XX 相关的资料？",
        tags: ["search"],
      });

      expect(thread.status).toBe("open");
      await expect(store.resolve(thread.id, scopeB as never)).rejects.toThrow(/source session/i);

      const reply = await store.reply({
        threadId: thread.id,
        sourceScope: scopeB as never,
        content: "我这边有资料。",
        replySource: "human",
        author: { id: "user-1", name: "Ada" },
      });

      const view = await store.read(thread.id);
      expect(view?.thread.id).toBe(thread.id);
      expect(view?.replies).toHaveLength(1);
      expect(view?.replies[0]?.replySource).toBe("human");
      expect(view?.replies[0]?.author).toEqual({ id: "user-1", name: "Ada" });
      expect(reply.id).toBe(view?.replies[0]?.id);

      await expect(store.resolve(thread.id, scopeA as never)).resolves.toMatchObject({ status: "resolved" });
      await expect(store.reply({ threadId: thread.id, sourceScope: scopeB as never, content: "晚了" })).rejects.toThrow(
        /resolved/i,
      );
    });
  });

  it("reloads persisted threads and replies", async () => {
    await withTempDir(async (dir) => {
      const first = await makeStore(dir);
      const thread = await first.deposit({
        kind: "share",
        sourceScope: scopeA as never,
        content: "一张很对味的梗图",
        tags: ["meme"],
      });
      await first.reply({
        threadId: thread.id,
        sourceScope: scopeB as never,
        content: "这个确实可以发。",
      });

      const reopened = createGlobalBrainStore({
        filePath: join(dir, "brain.jsonl"),
        maxDigestThreads: 5,
        maxDigestReplies: 5,
      });
      await reopened.init();

      const view = await reopened.read(thread.id);
      expect(view?.thread.content).toBe("一张很对味的梗图");
      expect(view?.replies).toHaveLength(1);
    });
  });

  it("lists participant scopes from threads and replies", async () => {
    await withTempDir(async (dir) => {
      const store = await makeStore(dir);
      const thread = await store.deposit({
        kind: "share",
        sourceScope: scopeA as never,
        content: "shared item",
        tags: [],
      });
      await store.reply({
        threadId: thread.id,
        sourceScope: scopeB as never,
        content: "answer",
      });

      const scopes = await store.participantScopes();
      expect(scopes).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ channelId: "group-a" }),
          expect.objectContaining({ channelId: "group-b" }),
        ]),
      );
    });
  });

  it("stores and reads content blobs", async () => {
    await withTempDir(async (dir) => {
      const store = await makeStore(dir);
      const bytes = new Uint8Array([1, 2, 3, 4]);

      const id = await store.putBlob(bytes);
      const loaded = await store.getBlob(id);

      expect(id).toMatch(/^[a-f0-9]{32}$/);
      expect([...loaded]).toEqual([1, 2, 3, 4]);
    });
  });

  it("digests new threads once and exposes replies to the source session", async () => {
    await withTempDir(async (dir) => {
      const store = await makeStore(dir);
      const thread = await store.deposit({
        kind: "question",
        sourceScope: scopeA as never,
        content: "谁有 XX 的资料？",
        tags: ["search"],
      });

      const firstDigest = await store.digest(scopeB as never);
      expect(firstDigest.threads.map((item) => item.id)).toEqual([thread.id]);
      expect(firstDigest.replies).toHaveLength(0);

      const secondDigest = await store.digest(scopeB as never);
      expect(secondDigest.threads).toHaveLength(0);

      await store.reply({
        threadId: thread.id,
        sourceScope: scopeB as never,
        content: "我有。",
      });

      const sourceDigest = await store.digest(scopeA as never);
      expect(sourceDigest.threads).toHaveLength(0);
      expect(sourceDigest.replies).toHaveLength(1);
      expect(sourceDigest.replies[0]?.thread.id).toBe(thread.id);

      const sourceDigestAgain = await store.digest(scopeA as never);
      expect(sourceDigestAgain.replies).toHaveLength(0);
    });
  });

  it("persists seen state across reloads", async () => {
    await withTempDir(async (dir) => {
      const store = await makeStore(dir);
      const thread = await store.deposit({
        kind: "share",
        sourceScope: scopeA as never,
        content: "一张梗图",
        tags: ["meme"],
      });
      await store.digest(scopeB as never);

      const reopened = createGlobalBrainStore({
        filePath: join(dir, "brain.jsonl"),
        maxDigestThreads: 5,
        maxDigestReplies: 5,
      });
      await reopened.init();

      const digest = await reopened.digest(scopeB as never);
      expect(digest.threads.map((item) => item.id)).not.toContain(thread.id);
    });
  });

  it("skips invalid persisted records with a warning", async () => {
    await withTempDir(async (dir) => {
      const filePath = join(dir, "brain.jsonl");
      const warn = vi.fn<() => void>();
      await writeFile(filePath, "not-json\n", "utf8");
      const store = createGlobalBrainStore({
        filePath,
        maxDigestThreads: 5,
        maxDigestReplies: 5,
        logger: { warn },
      });

      await store.init();

      await expect(store.status(scopeA as never)).resolves.toEqual([]);
      expect(warn).toHaveBeenCalled();
    });
  });
});
