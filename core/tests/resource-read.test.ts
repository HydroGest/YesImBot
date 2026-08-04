import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { AgentPlugin } from "@yesimbot/agent-runtime";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("koishi", async () => import("@koishijs/core"));

import type { Context } from "koishi";

import { ArtifactService } from "../src/artifact.js";
import { AssetService } from "../src/asset.js";
import { Config } from "../src/config.js";
import {
  createReadProjectionPlugin,
  createResourceReader,
  type ResourceSchemeOpenHandler,
} from "../src/runtime/read.js";
import { ChannelStorage, type ChannelScope } from "../src/runtime/storage.js";

const scope: ChannelScope = {
  type: "shared",
  platform: "onebot",
  selfId: "bot-1",
  channelId: "room-42",
};
const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

describe("ResourceReader", () => {
  let basePath: string;
  let storage: ChannelStorage;
  let assets: AssetService;
  let artifacts: ArtifactService;
  let config: Config;

  beforeEach(async () => {
    basePath = await mkdtemp(join(tmpdir(), "yesimbot-resource-read-"));
    const ctx = {
      logger: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }),
    } as unknown as Context;
    storage = new ChannelStorage(ctx, { basePath });
    assets = new AssetService(storage);
    artifacts = new ArtifactService(storage);
    config = {
      basePath,
      chatModel: "test",
      logLevel: 2,
      allowedChannels: [],
      imageInput: false,
      resourceReadTimeoutMs: 30_000,
      will: { engine: "routing", direct: "trigger", mention: "trigger", group: "wait" },
      reply: { pacing: { charactersPerSecond: 8, maxTotalDelayMs: 60_000 }, customInnerThought: false },
      session: {
        compact: { threshold: 0.9, charTokenRatio: 1.8, minMessages: 20, maxFailures: 3, model: undefined },
        idle: { timeout: 7_200_000 },
      },
    };
  });

  afterEach(async () => {
    await rm(basePath, { recursive: true, force: true });
  });

  it("rejects registration of reserved schemes", () => {
    const registrations = new Map<string, { prompt: string; open: ResourceSchemeOpenHandler }>();
    const reader = createResourceReader({
      scope,
      assets: assets.createStore(scope),
      artifacts: artifacts.createStore(scope),
      registrations,
      config,
    });

    const open: ResourceSchemeOpenHandler = async () => ({ bytes: PNG_BYTES });
    expect(() => reader.registerResourceScheme("asset", "x", open)).toThrow();
    expect(() => reader.registerResourceScheme("artifact", "x", open)).toThrow();
  });

  it("rejects duplicate scheme registrations", () => {
    const registrations = new Map<string, { prompt: string; open: ResourceSchemeOpenHandler }>();
    const reader = createResourceReader({
      scope,
      assets: assets.createStore(scope),
      artifacts: artifacts.createStore(scope),
      registrations,
      config,
    });

    const open: ResourceSchemeOpenHandler = async () => ({ bytes: PNG_BYTES });
    reader.registerResourceScheme("skill", "first", open);
    expect(() => reader.registerResourceScheme("skill", "second", open)).toThrow();
  });

  it("rejects traversal attempts", async () => {
    const registrations = new Map<string, { prompt: string; open: ResourceSchemeOpenHandler }>();
    const reader = createResourceReader({
      scope,
      assets: assets.createStore(scope),
      artifacts: artifacts.createStore(scope),
      registrations,
      config,
    });

    const result = await reader.read("workspace:///../secret");
    expect(result).toMatchObject({ error: "invalid_resource_uri" });
  });

  it("returns unavailable for unregistered schemes", async () => {
    const registrations = new Map<string, { prompt: string; open: ResourceSchemeOpenHandler }>();
    const reader = createResourceReader({
      scope,
      assets: assets.createStore(scope),
      artifacts: artifacts.createStore(scope),
      registrations,
      config,
    });

    const result = await reader.read("skill://csv/SKILL.md");
    expect(result).toMatchObject({ error: "resource_unavailable" });
  });

  it("respects timeout configuration", async () => {
    const registrations = new Map<string, { prompt: string; open: ResourceSchemeOpenHandler }>();
    const reader = createResourceReader({
      scope,
      assets: assets.createStore(scope),
      artifacts: artifacts.createStore(scope),
      registrations,
      config: { ...config, resourceReadTimeoutMs: 1 },
    });

    reader.registerResourceScheme("test", "test", async (_scope, _uri, { signal }) => {
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => resolve({ bytes: PNG_BYTES }), 100);
        signal.addEventListener("abort", () => {
          clearTimeout(timeout);
          reject(new Error("Aborted"));
        });
      });
    });

    const result = await reader.read("test:///file");
    expect(result).toMatchObject({ error: "timeout" });
  });

  it("enforces a hard deadline when an opener ignores abort", async () => {
    const registrations = new Map<string, { prompt: string; open: ResourceSchemeOpenHandler }>();
    const reader = createResourceReader({
      scope,
      assets: assets.createStore(scope),
      artifacts: artifacts.createStore(scope),
      registrations,
      config: { ...config, resourceReadTimeoutMs: 1 },
    });

    reader.registerResourceScheme("slow", "slow", async () => Promise.withResolvers<{ bytes: Uint8Array }>().promise);
    await expect(reader.read("slow:///file")).resolves.toMatchObject({ error: "timeout" });
    await expect(reader.openBytes("slow:///file")).resolves.toBeUndefined();
  });

  it("aborts an opener when the current turn is cancelled", async () => {
    const registrations = new Map<string, { prompt: string; open: ResourceSchemeOpenHandler }>();
    const reader = createResourceReader({
      scope,
      assets: assets.createStore(scope),
      artifacts: artifacts.createStore(scope),
      registrations,
      config,
    });
    reader.registerResourceScheme("abort", "abort", async () => Promise.withResolvers<{ bytes: Uint8Array }>().promise);
    const controller = new AbortController();
    const pending = reader.read("abort:///file", controller.signal);
    controller.abort();
    await expect(pending).resolves.toMatchObject({ error: expect.any(String) });
  });

  it("rejects unbounded and unsafe registered opener results", async () => {
    const registrations = new Map<string, { prompt: string; open: ResourceSchemeOpenHandler }>();
    const reader = createResourceReader({
      scope,
      assets: assets.createStore(scope),
      artifacts: artifacts.createStore(scope),
      registrations,
      config,
    });
    reader.registerResourceScheme("unsafe", "unsafe", async () => ({
      bytes: new Uint8Array([1]),
      filename: "../secret.txt",
    }));
    await expect(reader.read("unsafe:///file")).resolves.toMatchObject({ error: "resource_read_failed" });

    const oversized = createResourceReader({
      scope,
      assets: assets.createStore(scope),
      artifacts: artifacts.createStore(scope),
      registrations: new Map([
        ["large", { prompt: "large", open: async () => ({ bytes: new Uint8Array(5 * 1024 * 1024 + 1) }) }],
      ]),
      config,
    });
    await expect(oversized.read("large:///file")).resolves.toMatchObject({ error: "resource_too_large" });
  });

  it("rejects an empty path before dispatching a custom scheme", async () => {
    const registrations = new Map<string, { prompt: string; open: ResourceSchemeOpenHandler }>();
    const open = vi.fn(async () => ({ bytes: PNG_BYTES }));
    const reader = createResourceReader({
      scope,
      assets: assets.createStore(scope),
      artifacts: artifacts.createStore(scope),
      registrations,
      config,
    });
    reader.registerResourceScheme("custom", "custom", open);
    await expect(reader.read("custom:///")).resolves.toMatchObject({ error: "invalid_resource_uri" });
    expect(open).not.toHaveBeenCalled();
  });

  it("marks long text reads with a bounded truncation marker", async () => {
    const registrations = new Map<string, { prompt: string; open: ResourceSchemeOpenHandler }>();
    const reader = createResourceReader({
      scope,
      assets: assets.createStore(scope),
      artifacts: artifacts.createStore(scope),
      registrations,
      config,
    });
    reader.registerResourceScheme("text", "text", async () => ({
      bytes: new TextEncoder().encode("x".repeat(30_001)),
    }));
    const result = await reader.read("text:///file");
    expect(result.text).toHaveLength(30_000);
    expect(result.text).toContain("内容已截断");
  });

  it("rejects authority, query, fragment, and encoded traversal", async () => {
    const registrations = new Map<string, { prompt: string; open: ResourceSchemeOpenHandler }>();
    const reader = createResourceReader({
      scope,
      assets: assets.createStore(scope),
      artifacts: artifacts.createStore(scope),
      registrations,
      config,
    });

    for (const uri of [
      "asset://a6e2b32e1d9d64b2e906ac5c3216d18f?x=1",
      "artifact://mcp/x#frag",
      "workspace://host/path",
      "workspace:///reports/%2e%2e/secret.txt",
      "asset://SHORT",
      "asset://a6e2b32e1d9d64b2e906ac5c3216d18f/extra",
    ]) {
      await expect(reader.read(uri)).resolves.toMatchObject({ error: "invalid_resource_uri" });
    }
  });
});

describe("createReadProjectionPlugin", () => {
  const budget = { maxCount: 4, maxBytesPerImage: 5 * 1024 * 1024, maxTotalBytes: 10 * 1024 * 1024 };
  let basePath: string;
  let storage: ChannelStorage;
  let artifacts: ArtifactService;
  let config: Config;

  beforeEach(async () => {
    basePath = await mkdtemp(join(tmpdir(), "yesimbot-read-project-"));
    const ctx = {
      logger: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }),
    } as unknown as Context;
    storage = new ChannelStorage(ctx, { basePath });
    artifacts = new ArtifactService(storage);
    config = {
      basePath,
      chatModel: "test",
      logLevel: 2,
      allowedChannels: [],
      imageInput: false,
      resourceReadTimeoutMs: 30_000,
      will: { engine: "routing", direct: "trigger", mention: "trigger", group: "wait" },
      reply: { pacing: { charactersPerSecond: 8, maxTotalDelayMs: 60_000 }, customInnerThought: false },
      session: {
        compact: { threshold: 0.9, charTokenRatio: 1.8, minMessages: 20, maxFailures: 3, model: undefined },
        idle: { timeout: 7_200_000 },
      },
    };
  });

  afterEach(async () => {
    await rm(basePath, { recursive: true, force: true });
  });

  async function project(plugin: AgentPlugin, messages: unknown[]) {
    if (!plugin.prepareStep) throw new Error("prepareStep unavailable");
    return plugin.prepareStep(messages as never, {
      runtime: { id: "t" },
      channel: {} as never,
      state: {} as never,
      turnId: "t",
      stepNumber: 1,
    });
  }

  function readToolMessage(uri: string, mediaType?: string, output?: unknown) {
    const result: Record<string, unknown> = { uri, text: "[图片资源]" };
    if (mediaType !== undefined) result.mediaType = mediaType;
    return {
      role: "tool",
      content: [
        {
          type: "tool-result",
          toolCallId: "call-1",
          toolName: "read",
          output: output ?? result,
        },
      ],
    };
  }

  it("attaches one file part only for an image-capable budgeted read", async () => {
    const store = artifacts.createStore(scope);
    const uri = await store.forTool("mcp_test").put(PNG_BYTES, { mediaType: "image/png", filename: "x.png" });
    const registrations = new Map<string, { prompt: string; open: ResourceSchemeOpenHandler }>();
    const reader = createResourceReader({
      scope,
      assets: { get: vi.fn() } as never,
      artifacts: store,
      registrations,
      config,
    });
    const plugin = createReadProjectionPlugin(reader, true, budget);

    const prepared = await project(plugin, [readToolMessage(uri, "image/png")]);

    expect(prepared).toHaveLength(2);
    const last = prepared![1] as { role: string; content: unknown[] };
    expect(last.role).toBe("user");
    expect(last.content).toHaveLength(1);
    expect(last.content[0]).toMatchObject({ type: "file", mediaType: "image/png" });
  });

  it("unwraps the AI SDK JSON wrapper for an explicit read", async () => {
    const store = artifacts.createStore(scope);
    const uri = await store.forTool("mcp_test").put(PNG_BYTES, { mediaType: "image/png" });
    const reader = createResourceReader({
      scope,
      assets: { get: vi.fn() } as never,
      artifacts: store,
      registrations: new Map(),
      config,
    });
    const plugin = createReadProjectionPlugin(reader, true, budget);
    const result = { uri, mediaType: "image/png", text: "[图片资源]" };

    const prepared = await project(plugin, [readToolMessage(uri, undefined, { type: "json", value: result })]);
    expect(prepared).toHaveLength(2);
    expect((prepared![1] as { content: unknown[] }).content).toEqual([
      expect.objectContaining({ type: "file", mediaType: "image/png" }),
    ]);
  });

  it("does not re-project a historical read after another current message", async () => {
    const store = artifacts.createStore(scope);
    const uri = await store.forTool("mcp_test").put(PNG_BYTES, { mediaType: "image/png" });
    const reader = createResourceReader({
      scope,
      assets: { get: vi.fn() } as never,
      artifacts: store,
      registrations: new Map(),
      config,
    });
    const plugin = createReadProjectionPlugin(reader, true, budget);

    const prepared = await project(plugin, [readToolMessage(uri, "image/png"), { role: "user", content: "follow-up" }]);
    expect(prepared).toHaveLength(2);
    expect(prepared?.at(-1)).toEqual({ role: "user", content: "follow-up" });
  });

  it("detects image bytes without requiring an opener media type hint", async () => {
    const registrations = new Map<string, { prompt: string; open: ResourceSchemeOpenHandler }>();
    const reader = createResourceReader({
      scope,
      assets: { get: vi.fn() } as never,
      artifacts: artifacts.createStore(scope),
      registrations,
      config,
    });
    reader.registerResourceScheme("bytes", "bytes", async () => ({ bytes: PNG_BYTES }));
    const readResult = await reader.read("bytes:///image");
    const plugin = createReadProjectionPlugin(reader, true, budget);

    const prepared = await project(plugin, [readToolMessage("bytes:///image", undefined, readResult)]);
    expect(prepared).toHaveLength(2);
    expect((prepared![1] as { content: unknown[] }).content).toEqual([
      expect.objectContaining({ type: "file", mediaType: "image/png" }),
    ]);
  });

  it("never treats arbitrary bytes as an image because of a media type hint", async () => {
    const registrations = new Map<string, { prompt: string; open: ResourceSchemeOpenHandler }>();
    const reader = createResourceReader({
      scope,
      assets: { get: vi.fn() } as never,
      artifacts: artifacts.createStore(scope),
      registrations,
      config,
    });
    reader.registerResourceScheme("fake", "fake", async () => ({
      bytes: new Uint8Array([1, 2, 3]),
      mediaType: "image/png",
    }));
    const plugin = createReadProjectionPlugin(reader, true, budget);

    const prepared = await project(plugin, [readToolMessage("fake:///image", "image/png")]);
    expect(prepared).toHaveLength(1);
  });

  it("never projects when the model is not image-capable", async () => {
    const store = artifacts.createStore(scope);
    const uri = await store.forTool("mcp_test").put(PNG_BYTES, { mediaType: "image/png" });
    const registrations = new Map<string, { prompt: string; open: ResourceSchemeOpenHandler }>();
    const reader = createResourceReader({
      scope,
      assets: { get: vi.fn() } as never,
      artifacts: store,
      registrations,
      config,
    });
    const plugin = createReadProjectionPlugin(reader, false, budget);

    const prepared = await project(plugin, [readToolMessage(uri, "image/png")]);
    expect(prepared).toHaveLength(1);
  });

  it("never projects when image input is disabled", async () => {
    const store = artifacts.createStore(scope);
    const uri = await store.forTool("mcp_test").put(PNG_BYTES, { mediaType: "image/png" });
    const registrations = new Map<string, { prompt: string; open: ResourceSchemeOpenHandler }>();
    const reader = createResourceReader({
      scope,
      assets: { get: vi.fn() } as never,
      artifacts: store,
      registrations,
      config,
    });
    const plugin = createReadProjectionPlugin(reader, true, null);

    const prepared = await project(plugin, [readToolMessage(uri, "image/png")]);
    expect(prepared).toHaveLength(1);
  });

  it("preserves the read result when bytes cannot be opened", async () => {
    const registrations = new Map<string, { prompt: string; open: ResourceSchemeOpenHandler }>();
    const reader = createResourceReader({
      scope,
      assets: { get: vi.fn() } as never,
      artifacts: artifacts.createStore(scope),
      registrations,
      config,
    });
    const plugin = createReadProjectionPlugin(reader, true, budget);

    const prepared = await project(plugin, [
      readToolMessage("artifact://mcp_test/019d3b7e-1bd0-7e4f-9c5d-5bf3fd41f1d4"),
    ]);
    expect(prepared).toHaveLength(1);
  });

  it("skips oversized images while keeping the read text", async () => {
    const store = artifacts.createStore(scope);
    const big = new Uint8Array(6 * 1024 * 1024);
    big.set(PNG_BYTES);
    const uri = await store.forTool("mcp_test").put(big, { mediaType: "image/png" });
    const registrations = new Map<string, { prompt: string; open: ResourceSchemeOpenHandler }>();
    const reader = createResourceReader({
      scope,
      assets: { get: vi.fn() } as never,
      artifacts: store,
      registrations,
      config,
    });
    const plugin = createReadProjectionPlugin(reader, true, budget);

    const prepared = await project(plugin, [readToolMessage(uri, "image/png")]);
    expect(prepared).toHaveLength(1);
  });
});
