import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { AgentPlugin } from "@yesimbot/agent-runtime";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  schema: {
    string: vi.fn<() => unknown>(),
    number: vi.fn<() => unknown>(),
    boolean: vi.fn<() => unknown>(),
    object: vi.fn<() => unknown>(),
  },
}));

vi.mock("koishi", () => {
  const chain = () => ({
    default: vi.fn<() => unknown>().mockReturnThis(),
    description: vi.fn<() => unknown>().mockReturnThis(),
    min: vi.fn<() => unknown>().mockReturnThis(),
    max: vi.fn<() => unknown>().mockReturnThis(),
    role: vi.fn<() => unknown>().mockReturnThis(),
  });
  for (const key of Object.keys(mocks.schema) as Array<keyof typeof mocks.schema>) {
    mocks.schema[key].mockImplementation(chain);
  }
  return {
    Context: class Context {},
    Logger: class Logger {},
    Schema: mocks.schema,
  };
});

import GlobalBrainPlugin from "../src/index.js";

function createLogger() {
  return {
    debug: vi.fn<() => void>(),
    error: vi.fn<() => void>(),
    info: vi.fn<() => void>(),
    warn: vi.fn<() => void>(),
  };
}

function createMemoryAssets() {
  return {
    put: vi.fn<(bytes: Uint8Array) => Promise<string>>(async () => "asset-1"),
    get: vi.fn<(id: string) => Promise<Uint8Array>>(async () => new Uint8Array()),
    clear: vi.fn<() => Promise<void>>(async () => undefined),
  };
}

function createMemoryArtifacts() {
  return {
    open: vi.fn<(uri: string) => Promise<{ bytes: Uint8Array; mediaType?: string; filename?: string }>>(async () => ({
      bytes: new Uint8Array(),
      mediaType: "text/plain",
    })),
  };
}

function createContext(baseDir: string) {
  const scopedLogger = createLogger();
  const rootLogger = Object.assign(
    vi.fn<() => ReturnType<typeof createLogger>>(() => scopedLogger),
    createLogger(),
  );
  type ChannelPluginFactoryMock = (context: unknown) => AgentPlugin;
  const factories: ChannelPluginFactoryMock[] = [];
  const dispose = vi.fn<() => void>();
  const trigger = vi.fn<(event: unknown) => Promise<void>>(async () => undefined);
  const ctx = {
    baseDir,
    logger: rootLogger,
    on: vi.fn<(event: string, handler: () => unknown) => void>(),
    yesimbot: {
      assets: {
        createStore: vi.fn<() => ReturnType<typeof createMemoryAssets>>(() => createMemoryAssets()),
      },
      registerChannelPlugin: vi.fn<(factory: ChannelPluginFactoryMock) => () => void>((factory) => {
        factories.push(factory);
        return dispose;
      }),
      trigger,
    },
  };

  return { ctx, dispose, factories, scopedLogger, trigger };
}

function channelContext(channelId: string) {
  return {
    scope: {
      type: "shared",
      platform: "onebot",
      selfId: "bot-a",
      channelId,
    },
    artifacts: createMemoryArtifacts(),
  };
}

async function getTools(plugin: AgentPlugin) {
  return typeof plugin.tools === "function" ? ((await plugin.tools({} as never)) ?? []) : (plugin.tools ?? []);
}

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "global-brain-plugin-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe("GlobalBrainPlugin", () => {
  it("uses the configured brainPrompt override", async () => {
    await withTempDir(async (baseDir) => {
      const { ctx, factories } = createContext(baseDir);
      const plugin = new GlobalBrainPlugin(ctx as never, {
        storageDir: baseDir,
        brainPrompt: "custom global brain prompt",
        maxDigestThreads: 5,
        maxDigestReplies: 5,
        maxDigestContentLength: 80,
        maxBlobBytes: 5 * 1024 * 1024,
      });

      await plugin.start();

      const runtimePlugin = factories[0]!(channelContext("group-a") as never);
      const prompt = await runtimePlugin.appendSystemPrompt?.({} as never);
      expect(String(prompt)).toBe("custom global brain prompt");

      await plugin.stop();
    });
  });

  it("registers brain tools, prompt policy, and one-shot digest injection", async () => {
    await withTempDir(async (baseDir) => {
      const { ctx, factories, dispose } = createContext(baseDir);
      const plugin = new GlobalBrainPlugin(ctx as never, {
        storageDir: baseDir,
        maxDigestThreads: 5,
        maxDigestReplies: 5,
        maxDigestContentLength: 80,
        maxBlobBytes: 5 * 1024 * 1024,
      });

      await plugin.start();

      expect(ctx.yesimbot.registerChannelPlugin).toHaveBeenCalledOnce();
      const pluginA = factories[0]!(channelContext("group-a") as never);
      const tools = await getTools(pluginA);
      expect(tools.map((tool) => tool.name)).toEqual(["brain_deposit", "brain_read", "brain_reply", "brain_resolve", "brain_status"]);

      const prompt = await pluginA.appendSystemPrompt?.({} as never);
      expect(String(prompt)).toContain("Global Brain");
      expect(String(prompt)).toContain("unread");
      expect(String(prompt)).not.toContain("askLocal");

      const deposit = tools.find((tool) => tool.name === "brain_deposit")!;
      const created = (await deposit.execute?.({ kind: "question", content: "谁有 XX 的资料？", tags: ["search"] }, {} as never)) as {
        outcome: "created";
        thread: { id: string };
      };
      expect(created.outcome).toBe("created");

      const pluginB = factories[0]!(channelContext("group-b") as never);
      const messages = [{ role: "user" as const, content: "hello" }];
      const prepared = await pluginB.prepareStep?.(messages, {
        turnId: "turn-b",
        stepNumber: 0,
      } as never);
      expect(JSON.stringify(prepared)).toContain("全局脑");
      expect(JSON.stringify(prepared)).toContain(created.thread.id);

      const preparedAgain = await pluginB.prepareStep?.(messages, {
        turnId: "turn-b",
        stepNumber: 1,
      } as never);
      expect(preparedAgain).toHaveLength(messages.length);

      await plugin.stop();
      expect(dispose).toHaveBeenCalledOnce();
    });
  });

  it("triggers immediate requests in other registered sessions", async () => {
    await withTempDir(async (baseDir) => {
      const { ctx, factories, trigger } = createContext(baseDir);
      const plugin = new GlobalBrainPlugin(ctx as never, {
        storageDir: baseDir,
        maxDigestThreads: 5,
        maxDigestReplies: 5,
        maxDigestContentLength: 80,
        maxBlobBytes: 5 * 1024 * 1024,
      });

      await plugin.start();

      const pluginA = factories[0]!(channelContext("group-a") as never);
      factories[0]!(channelContext("group-b") as never);
      const tools = await getTools(pluginA);
      const deposit = tools.find((tool) => tool.name === "brain_deposit")!;
      const created = (await deposit.execute?.({ kind: "share", content: "urgent", shareImmediately: true }, {} as never)) as { thread: { id: string } };

      await Promise.resolve();
      expect(trigger).toHaveBeenCalledTimes(1);
      const event = trigger.mock.calls[0]?.[0] as {
        eventType: string;
        channel: { id: string };
        thread: { id: string; content: string };
      };
      expect(event.eventType).toBe("global-brain.immediate");
      expect(event.channel.id).toBe("group-b");
      expect(event.thread.id).toBe(created.thread.id);
      expect(event.thread.content).toBe("urgent");

      await plugin.stop();
    });
  });
});
