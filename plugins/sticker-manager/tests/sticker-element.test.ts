import type { AgentEntry } from "@yesimbot/agent-runtime";
import { createAssistantMessage, createMessageEntry } from "@yesimbot/agent-runtime";
import { describe, expect, it, vi } from "vitest";

vi.mock("koishi", async () => import("@koishijs/core"));

import { projectStickerElements } from "../src/sticker-element.js";
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

function assistantEntry(content: string): AgentEntry {
  return createMessageEntry(createAssistantMessage(content));
}

describe("sticker output element", () => {
  it("resolves fuzzy tags to a sticker and replaces the element with an image", async () => {
    const store = createStore();
    const [projected] = await projectStickerElements([assistantEntry('<sticker tags="猫"/>')], {
      store,
      scopeKey: "global",
      config: config(),
    });
    const message = projected.data as { content: string };

    expect(message.content).toContain(`<img src="sticker:///${"a".repeat(64)}"/>`);
    expect(store.markUsed).toHaveBeenCalledWith("global", "a".repeat(64));
  });

  it("resolves an exact sticker id", async () => {
    const store = createStore({
      get: vi.fn(async () => projection({ id: "b".repeat(64), mime: "image/gif" })),
    });
    const [projected] = await projectStickerElements([assistantEntry(`<sticker id="${"b".repeat(64)}"/>`)], {
      store,
      scopeKey: "global",
      config: config(),
    });
    const message = projected.data as { content: string };

    expect(store.get).toHaveBeenCalledWith("global", "b".repeat(64));
    expect(message.content).toContain(`<img src="sticker:///${"b".repeat(64)}"/>`);
  });

  it("leaves sticker elements untouched when disabled", async () => {
    const store = createStore();
    const raw = '<sticker tags="猫"/>';
    const [projected] = await projectStickerElements([assistantEntry(raw)], {
      store,
      scopeKey: "global",
      config: config({ stickerElement: false }),
    });
    const message = projected.data as { content: string };

    expect(message.content).toBe(raw);
    expect(store.markUsed).not.toHaveBeenCalled();
  });
});
