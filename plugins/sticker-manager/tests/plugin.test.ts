/* eslint-disable vitest/require-mock-type-parameters */
import type { AgentPlugin } from "@yesimbot/agent-runtime";
import type { ChannelContext } from "koishi-plugin-yesimbot";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("koishi", () => {
  const chain = () => {
    const target: Record<string, unknown> = {};
    target.default = () => target;
    target.description = () => target;
    target.role = () => target;
    target.min = () => target;
    return target;
  };
  return {
    Context: class {},
    Logger: class {},
    Schema: { object: chain, union: chain, const: chain, dynamic: chain, string: chain, boolean: chain, path: chain, number: chain },
    h: { image: (src: string) => ({ type: "img", attrs: { src } }) },
  };
});

import StickerManagerPlugin from "../src/index.js";
import type { StickerConfig, StickerRow } from "../src/types.js";
import { createMemoryModel } from "./helpers.js";

type Factory = (context: { readonly scope: ChannelContext; readonly bot: unknown }) => AgentPlugin;

interface CommandRecord {
  name: string;
  disposed: boolean;
}

function createCommandMock() {
  const commands: CommandRecord[] = [];
  const command = vi.fn((def: string) => {
    const record: CommandRecord = { name: def.split(/\s+/, 1)[0] ?? def, disposed: false };
    commands.push(record);
    const api = {
      option: () => api,
      action: () => api,
      dispose: () => {
        record.disposed = true;
      },
    };
    return api;
  });
  return { commands, command };
}

const config: StickerConfig = {
  scope: "global",
  storagePath: "data",
  classificationModel: "",
  classificationPrompt: "{{categories}}",
  maxImportFileBytes: 1024 * 1024,
  tagMode: false,
  fuzzyTagMatch: true,
  tagRandomRange: 1,
  sendStaticAsGif: true,
  stickerElement: true,
};

describe("StickerManagerPlugin", () => {
  let ready: Array<() => Promise<void> | void> = [];
  let dispose: Array<() => Promise<void> | void> = [];
  let plugins: StickerManagerPlugin[] = [];
  let disposeAgent: () => void;

  afterEach(() => {
    vi.restoreAllMocks();
    ready = [];
    dispose = [];
    plugins = [];
    disposeAgent = vi.fn();
  });

  it("registers the model, AgentPlugin factory and commands on ready", async () => {
    const model = createMemoryModel<StickerRow>();
    const { commands, command } = createCommandMock();
    const ctx = {
      baseDir: process.cwd(),
      logger: () => ({ info: vi.fn(), success: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
      on: vi.fn((event: string, callback: () => Promise<void> | void) => {
        if (event === "ready") ready.push(callback);
        if (event === "dispose") dispose.push(callback);
      }),
      model,
      command,
      yesimbot: {
        agent: {
          use: vi.fn((plugin: StickerManagerPlugin) => {
            plugins.push(plugin);
            disposeAgent = vi.fn();
            return disposeAgent;
          }),
        },
        resource: {
          get: vi.fn(async () => ({
            path: process.cwd(),
            assets: { get: vi.fn(), put: vi.fn(), clear: vi.fn() },
            artifacts: { forTool: vi.fn(() => ({ put: vi.fn() })) },
          })),
        },
        model: { getDefaultChatModelId: vi.fn(), resolveChatModel: vi.fn() },
      },
    };

    const plugin = new StickerManagerPlugin(ctx as never, config);
    expect(model.extend).toHaveBeenCalledOnce();
    expect(commands).toHaveLength(0);
    await ready[0]?.();

    expect(ctx.yesimbot.agent.use).toHaveBeenCalledOnce();
    expect(commands.length).toBeGreaterThan(0);
    expect(commands.map((record) => record.name)).toContain("yesimbot.sticker.reclassify");

    const agentPlugin = await plugins[0]!.setup({ type: "guild", platform: "test", channelId: "room", guildId: "room" }, { selfId: "bot" } as never);
    const tools = typeof agentPlugin?.tools === "function" ? ((await agentPlugin.tools({} as never)) ?? []) : [];
    expect(tools.map((tool) => tool.name)).toEqual(["sticker_steal", "sticker_send", "sticker_categories", "sticker_search"]);

    await dispose[0]?.();
    expect(disposeAgent).toHaveBeenCalledOnce();
    expect(commands.every((record) => record.disposed)).toBe(true);
    void plugin;
  });
});
