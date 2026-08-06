/* eslint-disable vitest/require-mock-type-parameters */
import type { AgentTool } from "@yesimbot/agent-runtime";
import type { AssetStore, ChannelScope } from "koishi-plugin-yesimbot";
import { describe, expect, it, vi } from "vitest";

import type { StickerClassifier } from "../src/classifier.js";
import type { StickerSender } from "../src/sender.js";
import type { StickerStore } from "../src/store.js";
import { createStickerTools } from "../src/tools.js";
import type { StickerConfig, StickerProjection } from "../src/types.js";

const scope: ChannelScope = {
  type: "shared",
  platform: "test",
  selfId: "bot-1",
  channelId: "room-1",
};

const config: StickerConfig = {
  scope: "global",
  storagePath: "data",
  classificationModel: "",
  classificationPrompt: "{{categories}}",
  maxImportFileBytes: 1024 * 1024,
  tagMode: false,
  fuzzyTagMatch: true,
  stickerElement: true,
};

const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

function projection(overrides: Partial<StickerProjection> = {}): StickerProjection {
  return {
    id: "a".repeat(64),
    category: "meme",
    tags: [],
    mime: "image/png",
    size: pngBytes.byteLength,
    source: { kind: "steal" },
    usageCount: 0,
    lastUsedAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function createDeps(overrides: Partial<StickerConfig> = {}) {
  const effectiveConfig = { ...config, ...overrides };
  const store = {
    listCategories: vi.fn(async () => []),
    listTags: vi.fn(async () => []),
    save: vi.fn(async (input: { tags?: readonly string[] }) => ({
      status: "created",
      sticker: projection({ tags: [...(input.tags ?? [])] }),
    })),
    get: vi.fn(async () => projection()),
    search: vi.fn(async () => [projection()]),
    listByScopeKey: vi.fn(async () => [projection()]),
    random: vi.fn(async () => projection()),
    readBytes: vi.fn(async () => pngBytes),
    markUsed: vi.fn(async () => projection({ usageCount: 1 })),
  };
  const classifier: StickerClassifier = {
    classify: vi.fn(async () => ({ category: "meme", tags: ["搞笑"] })),
  };
  const sender: StickerSender = { send: vi.fn(async () => undefined) };
  const assets: AssetStore = {
    put: vi.fn(async () => "a".repeat(32)),
    get: vi.fn(async () => pngBytes),
    clear: vi.fn(async () => undefined),
  };
  const tools = createStickerTools({
    store: store as unknown as StickerStore,
    classifier,
    sender,
    assets,
    scope,
    config: effectiveConfig,
  });
  return { store, classifier, sender, assets, tools };
}

async function execute(tool: AgentTool, input: unknown): Promise<unknown> {
  return tool.execute!(input, { abortSignal: undefined } as never);
}

describe("sticker agent tools", () => {
  it("exposes the expected sticker tool names", () => {
    const { tools } = createDeps();
    expect(tools.map((tool) => tool.name)).toEqual([
      "sticker_steal",
      "sticker_send",
      "sticker_categories",
      "sticker_search",
    ]);
  });

  it("exposes sticker_tags only in experimental tag mode", () => {
    const disabled = createDeps();
    expect(disabled.tools.some((tool) => tool.name === "sticker_tags")).toBe(false);

    const enabled = createDeps({ tagMode: true });
    expect(enabled.tools.some((tool) => tool.name === "sticker_tags")).toBe(true);
  });

  it("sticker_steal reads the asset and saves with classified category", async () => {
    const deps = createDeps();
    const [tool] = deps.tools;
    const result = await execute(tool, { asset_id: "a".repeat(32) });
    expect(deps.assets.get).toHaveBeenCalledWith("a".repeat(32));
    expect(deps.classifier.classify).toHaveBeenCalled();
    expect(deps.store.save).toHaveBeenCalledWith(
      expect.objectContaining({
        scopeKey: "global",
        category: "meme",
        mediaType: "image/png",
      }),
    );
    expect(result).toMatchObject({ ok: true, status: "created", id: "a".repeat(64) });
  });

  it("sticker_steal auto-tags the classified category in tag mode", async () => {
    const deps = createDeps({ tagMode: true });
    const [tool] = deps.tools;
    const result = await execute(tool, { asset_id: "a".repeat(32) });
    expect(deps.store.save).toHaveBeenCalledWith(expect.objectContaining({ tags: ["meme", "搞笑"] }));
    expect(result).toMatchObject({ ok: true, tags: ["meme", "搞笑"] });
  });

  it("sticker_send with fuzzy tags scores multiple tag matches on one sticker", async () => {
    const deps = createDeps({ tagMode: true });
    deps.store.listByScopeKey.mockResolvedValue([
      projection({ id: "a".repeat(64), tags: ["可爱猫猫", "工作"] }),
      projection({ id: "b".repeat(64), tags: ["猫"] }),
    ]);
    const [, sendTool] = deps.tools;
    const result = await execute(sendTool, { tags: ["猫", "可爱"] });
    expect(deps.store.listByScopeKey).toHaveBeenCalledWith("global");
    expect(deps.sender.send).toHaveBeenCalledWith({ bytes: pngBytes, mediaType: "image/png" });
    expect(deps.store.markUsed).toHaveBeenCalledWith("global", "a".repeat(64));
    expect(result).toMatchObject({ ok: true, tags: ["可爱猫猫", "工作"] });
  });

  it("sticker_send with one fuzzy tag can match multiple stickers", async () => {
    const deps = createDeps({ tagMode: true });
    const first = projection({ id: "a".repeat(64), tags: ["猫猫"] });
    const second = projection({ id: "b".repeat(64), tags: ["猫"] });
    deps.store.listByScopeKey.mockResolvedValue([first, second]);
    const [, sendTool] = deps.tools;

    await execute(sendTool, { tags: ["猫"] });

    expect(deps.sender.send).toHaveBeenCalledOnce();
    expect(deps.store.markUsed).toHaveBeenCalledWith("global", expect.stringMatching(/^(a{64}|b{64})$/));
  });

  it("sticker_send keeps exact tag matching when fuzzy matching is disabled", async () => {
    const deps = createDeps({ tagMode: true, fuzzyTagMatch: false });
    deps.store.listByScopeKey.mockResolvedValue([
      projection({ id: "a".repeat(64), tags: ["猫猫"] }),
      projection({ id: "b".repeat(64), tags: ["猫"] }),
    ]);
    const [, sendTool] = deps.tools;

    const result = await execute(sendTool, { tags: ["猫"] });

    expect(deps.store.markUsed).toHaveBeenCalledWith("global", "b".repeat(64));
    expect(result).toMatchObject({ ok: true, tags: ["猫"] });
  });

  it("sticker_send sends the selected sticker and records usage", async () => {
    const deps = createDeps();
    const [, sendTool] = deps.tools;
    const result = await execute(sendTool, { sticker_id: "a".repeat(64) });
    expect(deps.sender.send).toHaveBeenCalledWith({ bytes: pngBytes, mediaType: "image/png" });
    expect(deps.store.markUsed).toHaveBeenCalledWith("global", "a".repeat(64));
    expect(result).toMatchObject({ ok: true, category: "meme" });
  });

  it("sticker_categories returns category summaries", async () => {
    const deps = createDeps();
    deps.store.listCategories.mockResolvedValue([{ category: "meme", count: 2 }]);
    const [, , categoriesTool] = deps.tools;
    const result = await execute(categoriesTool, {});
    expect(result).toMatchObject({ ok: true, categories: [{ category: "meme", count: 2 }] });
  });

  it("sticker_tags returns tag summaries in tag mode", async () => {
    const deps = createDeps({ tagMode: true });
    deps.store.listTags.mockResolvedValue([{ tag: "猫猫", count: 2 }]);
    const tagsTool = deps.tools.find((tool) => tool.name === "sticker_tags");
    const result = await execute(tagsTool!, {});
    expect(result).toMatchObject({ ok: true, tags: [{ tag: "猫猫", count: 2 }] });
  });
});
