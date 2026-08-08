import type { AgentEntry } from "@yesimbot/agent-runtime";
import { createAssistantMessage, createMessageEntry } from "@yesimbot/agent-runtime";
import type { ArtifactStore } from "koishi-plugin-yesimbot";
import { describe, expect, it, vi } from "vitest";

vi.mock("koishi", async () => import("@koishijs/core"));

import { projectStickerElements, projectStickerHistoryElements } from "../src/sticker-element.js";
import type { StickerStore } from "../src/store.js";
import type { StickerConfig, StickerProjection } from "../src/types.js";

const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

function projection(overrides: Partial<StickerProjection> = {}): StickerProjection {
  return {
    id: "a".repeat(64),
    category: "meme",
    tags: ["猫"],
    mime: "image/png",
    size: pngBytes.byteLength,
    source: { kind: "steal" },
    usageCount: 0,
    lastUsedAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function config(overrides: Partial<StickerConfig> = {}): StickerConfig {
  return {
    scope: "global",
    storagePath: "data",
    classificationModel: "",
    classificationPrompt: "{{categories}}",
    maxImportFileBytes: 1024 * 1024,
    tagMode: true,
    fuzzyTagMatch: true,
    tagRandomRange: 1,
    sendStaticAsGif: true,
    stickerElement: true,
    ...overrides,
  };
}

function createStore(overrides: Partial<StickerStore> = {}): StickerStore {
  return {
    get: vi.fn(async () => projection()),
    random: vi.fn(async () => projection()),
    listByScopeKey: vi.fn(async () => [projection()]),
    readBytes: vi.fn(async () => pngBytes),
    markUsed: vi.fn(async () => projection()),
    ...overrides,
  } as unknown as StickerStore;
}

function createArtifacts(overrides: Partial<ArtifactStore> = {}): ArtifactStore {
  const put = vi.fn(async () => `artifact://sticker/${"a".repeat(8)}-0000-7000-8000-${"b".repeat(12)}`);
  return {
    forTool: vi.fn(() => ({ put })),
    open: vi.fn(async () => {
      throw new Error("not found");
    }),
    clear: vi.fn(),
    ...overrides,
  } as unknown as ArtifactStore;
}

function assistantEntry(content: string): AgentEntry {
  return createMessageEntry(createAssistantMessage(content));
}

describe("sticker output element", () => {
  it("resolves fuzzy tags to a sticker and replaces the element with an image", async () => {
    const store = createStore();
    const [projected] = await projectStickerElements([assistantEntry('<sticker tags="猫"/>')], {
      store,
      artifacts: createArtifacts(),
      scopeKey: "global",
      config: config(),
    });
    const message = projected.data as { content: string };

    expect(message.content).toContain('<img src="artifact://sticker/');
    expect(store.markUsed).toHaveBeenCalledWith("global", "a".repeat(64));
  });

  it("resolves an exact sticker id", async () => {
    const store = createStore({ get: vi.fn(async () => projection({ id: "b".repeat(64), mime: "image/gif" })) });
    const [projected] = await projectStickerElements([assistantEntry(`<sticker id="${"b".repeat(64)}"/>`)], {
      store,
      artifacts: createArtifacts(),
      scopeKey: "global",
      config: config(),
    });
    const message = projected.data as { content: string };

    expect(store.get).toHaveBeenCalledWith("global", "b".repeat(64));
    expect(message.content).toContain('<img src="artifact://sticker/');
  });

  it("leaves sticker elements untouched when disabled", async () => {
    const store = createStore();
    const raw = '<sticker tags="猫"/>';
    const [projected] = await projectStickerElements([assistantEntry(raw)], {
      store,
      artifacts: createArtifacts(),
      scopeKey: "global",
      config: config({ stickerElement: false }),
    });
    const message = projected.data as { content: string };

    expect(message.content).toBe(raw);
    expect(store.markUsed).not.toHaveBeenCalled();
  });

  it("rewrites sticker artifact images back to sticker elements for model history", async () => {
    const id = "a".repeat(64);
    const artifacts = createArtifacts({ open: vi.fn(async () => ({ bytes: pngBytes, mediaType: "image/png", filename: `${id}.png` })) });
    const [projected] = await projectStickerHistoryElements([assistantEntry(`<img src="artifact://sticker/00000000-0000-7000-8000-000000000000"/>`)], {
      store: createStore(),
      artifacts,
      scopeKey: "global",
      config: config(),
    });
    const message = projected.data as { content: string };

    expect(message.content).toBe(`<sticker id="${id}"/>`);
  });

  it("drops a missing sticker artifact image from model history", async () => {
    const [projected] = await projectStickerHistoryElements([assistantEntry(`<img src="artifact://sticker/00000000-0000-7000-8000-000000000000"/>`)], {
      store: createStore(),
      artifacts: createArtifacts(),
      scopeKey: "global",
      config: config(),
    });
    const message = projected.data as { content: string };

    expect(message.content).toBe("");
  });
});
