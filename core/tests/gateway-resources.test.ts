import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { describe, expect, it, vi } from "vitest";

vi.mock("koishi", async () => import("@koishijs/core"));

import { h, Universal, type Session } from "koishi";

import type { AssetStore } from "../src/asset.js";
import { createDefaultTranslator } from "../src/gateway/default.js";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
const ID = "0123456789abcdef0123456789abcdef";
const TEXT = new TextEncoder().encode("# title\nbody");

function makeSession(overrides: Record<string, unknown> = {}): Session {
  return {
    platform: "test",
    selfId: "bot-1",
    channelId: "room-1",
    userId: "user-1",
    timestamp: 1,
    type: "message-created",
    messageId: "message-1",
    event: { type: "message", user: { name: "User" } },
    elements: [h.text("hello")],
    ...overrides,
  } as unknown as Session;
}

function base() {
  return {
    platform: "test",
    selfId: "bot-1",
    channel: { id: "room-1", type: Universal.Channel.Type.TEXT },
    user: { id: "user-1", name: "User" },
    timestamp: 1,
  } as const;
}

function store(put: AssetStore["put"] = vi.fn(async () => ID)): AssetStore {
  return { put, get: vi.fn(), clear: vi.fn(async () => undefined) };
}

function headers(values: Record<string, string> = {}): { get(name: string): string | null } {
  return { get: (name) => values[name.toLowerCase()] ?? null };
}

function remoteMock(body: Uint8Array = PNG, type = "image/png") {
  return Object.assign(
    vi.fn(async () => ({
      data: new ReadableStream({
        start(controller) {
          controller.enqueue(body);
          controller.close();
        },
      }),
    })),
    {
      head: vi.fn(async () => headers({ "content-type": type, "content-length": String(body.byteLength) })),
    },
  );
}

describe("Gateway default translator resource persistence", () => {
  it("persists remote images through the shared pipeline", async () => {
    const http = remoteMock();
    const assets = store();
    const translator = createDefaultTranslator({ http } as never);

    const result = await translator.translate(
      base(),
      makeSession({ elements: [h("img", { src: "https://example.test/a.png" })] }),
      assets,
    );

    expect(http).toHaveBeenCalledWith(
      "https://example.test/a.png",
      expect.objectContaining({ responseType: "stream", signal: expect.any(AbortSignal) }),
    );
    expect(assets.put).toHaveBeenCalledWith(PNG);
    expect(result).toMatchObject({ platform: "test", elements: [h("img", { id: ID })] });
  });

  it("preserves image subtype and summary attrs after persistence", async () => {
    const translator = createDefaultTranslator({ http: remoteMock() } as never);

    const result = await translator.translate(
      base(),
      makeSession({ elements: [h("img", { src: "https://example.test/a.gif", subType: 1, summary: "大笑" })] }),
      store(),
    );

    expect(result).toMatchObject({ elements: [h("img", { id: ID, subType: 1, summary: "大笑" })] });
  });

  it("decodes data URLs and local files without network access", async () => {
    const http = vi.fn();
    const translator = createDefaultTranslator({ http } as never);
    const dataSource = `data:image/png;base64,${Buffer.from(PNG).toString("base64")}`;

    const dataResult = await translator.translate(
      base(),
      makeSession({ elements: [h("img", { src: dataSource })] }),
      store(),
    );
    expect(dataResult).toMatchObject({ elements: [h("img", { id: ID })] });

    const directory = await mkdtemp(join(tmpdir(), "yesimbot-default-image-"));
    try {
      const path = join(directory, "local.png");
      await writeFile(path, PNG);
      const fileResult = await translator.translate(
        base(),
        makeSession({ elements: [h("img", { src: pathToFileURL(path).href })] }),
        store(),
      );
      expect(fileResult).toMatchObject({ elements: [h("img", { id: ID })] });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
    expect(http).not.toHaveBeenCalled();
  });

  it("persists restricted text files and rejects non-text payloads", async () => {
    const http = remoteMock(TEXT, "text/markdown");
    const translator = createDefaultTranslator({ http } as never);

    const result = await translator.translate(
      base(),
      makeSession({ elements: [h("file", { src: "https://example.test/a.md", title: "a.md" })] }),
      store(),
    );
    expect(result).toMatchObject({ elements: [h("file", { id: ID, title: "a.md" })] });

    const binary = Object.assign(
      vi.fn(async () => ({
        data: new ReadableStream({
          start(controller) {
            controller.enqueue(PNG);
            controller.close();
          },
        }),
      })),
      { head: vi.fn(async () => headers({ "content-type": "application/octet-stream" })) },
    );
    const original = h("file", { src: "https://example.test/b.md", title: "b.md" });
    const kept = await createDefaultTranslator({ http: binary } as never).translate(
      base(),
      makeSession({ elements: [original] }),
      store(),
    );
    expect(kept).toMatchObject({ elements: [original] });
    expect(binary).toHaveBeenCalled();
  });
});

describe("resource HEAD pre-check", () => {
  it("skips oversized resources without downloading", async () => {
    const http = Object.assign(vi.fn(), {
      head: vi.fn(async () => headers({ "content-type": "image/png", "content-length": String(5 * 1024 * 1024 + 1) })),
    });
    const original = h("img", { src: "https://example.test/huge.png" });

    const result = await createDefaultTranslator({ http } as never).translate(
      base(),
      makeSession({ elements: [original] }),
      store(),
    );
    expect(result).toMatchObject({ elements: [original] });
    expect(http).not.toHaveBeenCalled();
  });

  it("skips images whose content type is not an image", async () => {
    const http = Object.assign(vi.fn(), {
      head: vi.fn(async () => headers({ "content-type": "text/html", "content-length": "4" })),
    });
    const original = h("img", { src: "https://example.test/error.html" });

    const result = await createDefaultTranslator({ http } as never).translate(
      base(),
      makeSession({ elements: [original] }),
      store(),
    );
    expect(result).toMatchObject({ elements: [original] });
    expect(http).not.toHaveBeenCalled();
  });

  it("skips text files whose content type is binary", async () => {
    const http = Object.assign(vi.fn(), {
      head: vi.fn(async () => headers({ "content-type": "image/png", "content-length": "4" })),
    });
    const original = h("file", { src: "https://example.test/c.md", title: "c.md" });

    const result = await createDefaultTranslator({ http } as never).translate(
      base(),
      makeSession({ elements: [original] }),
      store(),
    );
    expect(result).toMatchObject({ elements: [original] });
    expect(http).not.toHaveBeenCalled();
  });

  it("falls back to streaming download when HEAD fails", async () => {
    const http = Object.assign(
      vi.fn(async () => ({
        data: new ReadableStream({
          start(controller) {
            controller.enqueue(PNG);
            controller.close();
          },
        }),
      })),
      { head: vi.fn(async () => Promise.reject(new Error("head unsupported"))) },
    );

    const result = await createDefaultTranslator({ http } as never).translate(
      base(),
      makeSession({ elements: [h("img", { src: "https://example.test/x.png" })] }),
      store(),
    );
    expect(result).toMatchObject({ elements: [h("img", { id: ID })] });
    expect(http).toHaveBeenCalledTimes(1);
  });
});
