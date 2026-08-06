import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { AgentToolExecuteContext } from "@yesimbot/agent-runtime";
import { describe, expect, it, vi } from "vitest";

import { createGlobalBrainStore } from "../src/store.js";
import { createBrainTools } from "../src/tools.js";

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

function toolContext(): AgentToolExecuteContext {
  return {
    runtime: { id: "runtime" },
    channel: {} as never,
    state: {} as never,
    storage: {} as never,
    turnId: "turn-real",
    toolCallId: "tool-call",
  };
}

function createMemoryAssets() {
  const entries = new Map<string, Uint8Array>();
  return {
    entries,
    put: vi.fn<(bytes: Uint8Array) => Promise<string>>(async (bytes) => {
      const id = `asset-${entries.size + 1}`;
      entries.set(id, bytes.slice());
      return id;
    }),
    get: vi.fn<(id: string) => Promise<Uint8Array>>(async (id) => {
      const bytes = entries.get(id);
      if (!bytes) throw new Error("Asset not found");
      return bytes;
    }),
    clear: vi.fn<() => Promise<void>>(async () => entries.clear()),
  };
}

function createMemoryArtifacts() {
  return {
    open: vi.fn<(uri: string) => Promise<{ bytes: Uint8Array; mediaType: string; filename: string }>>(async () => ({
      bytes: new Uint8Array([4, 5, 6]),
      mediaType: "application/pdf",
      filename: "report.pdf",
    })),
  };
}

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "global-brain-tools-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe("GlobalBrain tools", () => {
  it("exposes only the intended brain_* tools and minimal schemas", async () => {
    await withTempDir(async (dir) => {
      const store = createGlobalBrainStore({
        filePath: join(dir, "brain.jsonl"),
        maxDigestThreads: 5,
        maxDigestReplies: 5,
      });
      await store.init();
      const tools = createBrainTools({
        store,
        scope: scopeA as never,
        assets: createMemoryAssets(),
        artifacts: createMemoryArtifacts(),
      });

      expect(tools.map((tool) => tool.name)).toEqual([
        "brain_deposit",
        "brain_read",
        "brain_reply",
        "brain_resolve",
        "brain_status",
      ]);
      const schema = JSON.stringify(tools.map((tool) => tool.inputSchema));
      expect(schema).toContain("kind");
      expect(schema).toContain("content");
      expect(schema).toContain("replySource");
      expect(schema).toContain("assetId");
      expect(schema).toContain("artifactUri");
      expect(schema).toContain("forward");
      expect(schema).toContain("shareImmediately");
      for (const forbidden of ["sourceScope", "storageDir", "filePath", "store"]) {
        expect(schema).not.toContain(forbidden);
      }
    });
  });

  it("creates threads, reads replies, relays human answers, and resolves own threads", async () => {
    await withTempDir(async (dir) => {
      const store = createGlobalBrainStore({
        filePath: join(dir, "brain.jsonl"),
        maxDigestThreads: 5,
        maxDigestReplies: 5,
      });
      await store.init();
      const tools = createBrainTools({
        store,
        scope: scopeA as never,
        assets: createMemoryAssets(),
        artifacts: createMemoryArtifacts(),
      });
      const context = toolContext();

      const created = (await tools[0]?.execute?.(
        { kind: "question", content: "谁有 XX 的资料？", tags: ["search"] },
        context,
      )) as { outcome: "created"; thread: { id: string } };
      expect(created.outcome).toBe("created");

      const reply = await tools[2]?.execute?.(
        {
          threadId: created.thread.id,
          content: "我这边有资料。",
          replySource: "human",
          author: { id: "user-1", name: "Ada" },
        },
        context,
      );
      expect(reply).toMatchObject({
        outcome: "created",
        reply: {
          replySource: "human",
          author: { id: "user-1", name: "Ada" },
        },
      });

      const read = await tools[1]?.execute?.({ threadId: created.thread.id }, context);
      expect(read).toMatchObject({ outcome: "ok", replies: [{ replySource: "human" }] });

      const resolved = await tools[3]?.execute?.({ threadId: created.thread.id }, context);
      expect(resolved).toEqual({ outcome: "resolved" });

      const status = await tools[4]?.execute?.({}, context);
      expect(status).toMatchObject({ outcome: "ok", threads: [{ replyCount: 1 }] });
    });
  });

  it("deposits assets and materializes them into the target scope on read", async () => {
    await withTempDir(async (dir) => {
      const store = createGlobalBrainStore({
        filePath: join(dir, "brain.jsonl"),
        maxDigestThreads: 5,
        maxDigestReplies: 5,
      });
      await store.init();
      const sourceAssets = createMemoryAssets();
      const assetId = "a".repeat(32);
      sourceAssets.entries.set(assetId, new Uint8Array([1, 2, 3]));
      const targetAssets = createMemoryAssets();
      const sourceTools = createBrainTools({
        store,
        scope: scopeA as never,
        assets: sourceAssets,
        artifacts: createMemoryArtifacts(),
      });
      const targetTools = createBrainTools({
        store,
        scope: scopeB as never,
        assets: targetAssets,
        artifacts: createMemoryArtifacts(),
      });

      const created = (await sourceTools[0]?.execute?.(
        { kind: "share", assetId, content: "一张梗图", tags: ["meme"] },
        toolContext(),
      )) as { outcome: "created"; thread: { id: string; payload: { kind: string; blobId: string } } };
      expect(created.outcome).toBe("created");
      expect(created.thread.payload).toMatchObject({ kind: "asset", blobId: expect.any(String) });

      const read = (await targetTools[1]?.execute?.({ threadId: created.thread.id }, toolContext())) as {
        outcome: "ok";
        localAssetUri?: string;
      };
      expect(read.outcome).toBe("ok");
      expect(read.localAssetUri).toBe("asset://asset-1");
      expect(targetAssets.put).toHaveBeenCalledOnce();
    });
  });

  it("deposits artifact and forward metadata", async () => {
    await withTempDir(async (dir) => {
      const store = createGlobalBrainStore({
        filePath: join(dir, "brain.jsonl"),
        maxDigestThreads: 5,
        maxDigestReplies: 5,
      });
      await store.init();
      const artifacts = createMemoryArtifacts();
      const tools = createBrainTools({
        store,
        scope: scopeA as never,
        assets: createMemoryAssets(),
        artifacts,
      });

      const artifact = (await tools[0]?.execute?.(
        { kind: "share", artifactUri: "artifact://web-fetch/0192abcd-0192-7000-8000-000000000000" },
        toolContext(),
      )) as { outcome: "created"; thread: { payload: { kind: string; mediaType: string; filename: string } } };
      expect(artifact.outcome).toBe("created");
      expect(artifact.thread.payload).toMatchObject({
        kind: "artifact",
        mediaType: "application/pdf",
        filename: "report.pdf",
      });

      const forward = (await tools[0]?.execute?.(
        {
          kind: "share",
          forward: { platform: "onebot", forwardId: "forward-1", summary: "炸裂转发" },
        },
        toolContext(),
      )) as { outcome: "created"; thread: { payload: { kind: string; forwardId: string } } };
      expect(forward.outcome).toBe("created");
      expect(forward.thread.payload).toMatchObject({ kind: "forward", forwardId: "forward-1" });
    });
  });

  it("dispatches immediate shares through the optional callback", async () => {
    await withTempDir(async (dir) => {
      const store = createGlobalBrainStore({
        filePath: join(dir, "brain.jsonl"),
        maxDigestThreads: 5,
        maxDigestReplies: 5,
      });
      await store.init();
      const onImmediateShare = vi.fn<(thread: unknown) => Promise<void>>(async () => undefined);
      const tools = createBrainTools({
        store,
        scope: scopeA as never,
        assets: createMemoryAssets(),
        artifacts: createMemoryArtifacts(),
        defaultShareImmediately: true,
        onImmediateShare,
      });
      const context = toolContext();

      const created = (await tools[0]?.execute?.(
        { kind: "share", content: "urgent", shareImmediately: true },
        context,
      )) as { outcome: "created"; thread: { id: string } };
      expect(created.outcome).toBe("created");
      expect(onImmediateShare).toHaveBeenCalledTimes(1);
      expect(onImmediateShare).toHaveBeenCalledWith(
        expect.objectContaining({ id: created.thread.id, kind: "share", content: "urgent" }),
      );

      onImmediateShare.mockClear();
      await tools[0]?.execute?.({ kind: "share", content: "waiting", shareImmediately: false }, context);
      expect(onImmediateShare).not.toHaveBeenCalled();

      await tools[0]?.execute?.({ kind: "share", content: "default immediate" }, context);
      expect(onImmediateShare).toHaveBeenCalledTimes(1);
    });
  });

  it("returns structured failures for unknown threads", async () => {
    await withTempDir(async (dir) => {
      const store = createGlobalBrainStore({
        filePath: join(dir, "brain.jsonl"),
        maxDigestThreads: 5,
        maxDigestReplies: 5,
      });
      await store.init();
      const tools = createBrainTools({
        store,
        scope: scopeA as never,
        assets: createMemoryAssets(),
        artifacts: createMemoryArtifacts(),
      });

      const read = await tools[1]?.execute?.({ threadId: "missing" }, toolContext());
      expect(read).toEqual({
        outcome: "failed",
        error: { code: "thread_not_found", message: "Thread does not exist" },
      });
    });
  });
});
