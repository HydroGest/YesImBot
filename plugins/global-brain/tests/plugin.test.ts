import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { AgentPlugin, AgentTool } from "@yesimbot/agent-runtime";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  schema: {
    array: vi.fn<() => unknown>(),
    boolean: vi.fn<() => unknown>(),
    const: vi.fn<() => unknown>(),
    number: vi.fn<() => unknown>(),
    object: vi.fn<() => unknown>(),
    string: vi.fn<() => unknown>(),
    union: vi.fn<() => unknown>(),
  },
}));

vi.mock("koishi", () => {
  const chain = () => ({
    default: vi.fn<() => unknown>().mockReturnThis(),
    description: vi.fn<() => unknown>().mockReturnThis(),
    role: vi.fn<() => unknown>().mockReturnThis(),
    min: vi.fn<() => unknown>().mockReturnThis(),
    max: vi.fn<() => unknown>().mockReturnThis(),
  });
  for (const key of Object.keys(mocks.schema) as Array<keyof typeof mocks.schema>) mocks.schema[key].mockImplementation(chain);
  return { Context: class Context {}, Logger: class Logger {}, Schema: mocks.schema };
});

import GlobalBrainPlugin from "../src/index.js";

function createMemoryAssets() {
  return { put: vi.fn(async () => "asset-1"), get: vi.fn(async () => new Uint8Array()), clear: vi.fn(async () => undefined) };
}

function createMemoryArtifacts() {
  return { open: vi.fn(async () => ({ bytes: new Uint8Array(), mediaType: "text/plain" })) };
}

function createContext(baseDir: string) {
  const scopedLogger = { debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() };
  const rootLogger = Object.assign(
    vi.fn(() => scopedLogger),
    scopedLogger,
  );
  const plugins: Array<{ init: (scope: unknown, bot: unknown) => Promise<AgentPlugin | null> }> = [];
  const dispose = vi.fn<() => void>();
  const trigger = vi.fn(async () => undefined);
  const resources = { assets: createMemoryAssets(), artifacts: createMemoryArtifacts(), path: baseDir };
  const ctx = {
    baseDir,
    logger: rootLogger,
    on: vi.fn(),
    yesimbot: {
      agent: {
        use: vi.fn((plugin: (typeof plugins)[number]) => {
          plugins.push(plugin);
          return dispose;
        }),
      },
      resource: { get: vi.fn(async () => resources) },
      messenger: { post: trigger },
    },
  };
  return { ctx, dispose, plugins, trigger };
}

function channelScope(channelId: string) {
  return { type: "shared", platform: "onebot", channelId };
}

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "global-brain-plugin-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function getTools(plugin: AgentPlugin): Promise<AgentTool[]> {
  return typeof plugin.tools === "function" ? ((await plugin.tools({} as never)) ?? []) : (plugin.tools ?? []);
}

describe("GlobalBrainPlugin", () => {
  it("loads the custom prompt through the named agent plugin", async () => {
    await withTempDir(async (baseDir) => {
      const { ctx, plugins } = createContext(baseDir);
      const plugin = new GlobalBrainPlugin(ctx as never, { storageDir: baseDir, brainPrompt: "custom global brain prompt" } as never);
      await plugin.start();
      const runtimePlugin = await plugins[0]!.setup(channelScope("group-a"), { selfId: "bot-a" });

      expect(String(await runtimePlugin?.appendSystemPrompt?.({} as never))).toBe("custom global brain prompt");
    });
  });

  it("registers one named plugin and exposes brain tools per channel", async () => {
    await withTempDir(async (baseDir) => {
      const { ctx, plugins, dispose } = createContext(baseDir);
      const plugin = new GlobalBrainPlugin(
        ctx as never,
        { storageDir: baseDir, maxDigestThreads: 5, maxDigestReplies: 5, maxDigestContentLength: 80 } as never,
      );
      await plugin.start();
      const runtimePlugin = await plugins[0]!.setup(channelScope("group-a"), { selfId: "bot-a" });
      const tools = await getTools(runtimePlugin!);

      expect(ctx.yesimbot.agent.use).toHaveBeenCalledOnce();
      expect(tools.map((tool) => tool.name)).toEqual(["brain_deposit", "brain_read", "brain_reply", "brain_resolve", "brain_status"]);
      await plugin.stop();
      expect(dispose).toHaveBeenCalledOnce();
    });
  });

  it("submits an immediate share through Messenger.post with the producing Bot identity", async () => {
    await withTempDir(async (baseDir) => {
      const { ctx, plugins, trigger } = createContext(baseDir);
      const plugin = new GlobalBrainPlugin(
        ctx as never,
        { storageDir: baseDir, maxDigestThreads: 5, maxDigestReplies: 5, maxDigestContentLength: 80 } as never,
      );
      await plugin.start();
      const runtimePlugin = await plugins[0]!.setup(channelScope("group-a"), { selfId: "bot-a" });
      await plugins[0]!.setup(channelScope("group-b"), { selfId: "bot-a" });
      const deposit = (await getTools(runtimePlugin!)).find((tool) => tool.name === "brain_deposit")!;

      await deposit.execute?.({ kind: "share", content: "urgent", shareImmediately: true }, {} as never);
      await Promise.resolve();

      expect(trigger).toHaveBeenCalledOnce();
      expect(trigger.mock.calls[0]?.[0]).toMatchObject({ eventType: "global-brain.immediate", selfId: "bot-a" });
    });
  });
});
