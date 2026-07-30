import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { describe, expect, it, vi } from "vitest";

vi.mock("koishi", async () => import("@koishijs/core"));

import { h, type Session } from "koishi";

import type { AssetStore } from "../../src/asset.js";
import { resolveOneBotEvent } from "../../src/platforms/onebot/events.js";
import { createResolver } from "../../src/platforms/onebot/index.js";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
const ID = "0123456789abcdef0123456789abcdef";

function makeSession(overrides: Record<string, unknown> = {}): Session {
  return {
    platform: "onebot",
    selfId: "10000",
    channelId: "20000",
    userId: "30000",
    timestamp: 1,
    type: "message-created",
    messageId: "40000",
    event: { type: "message", user: { name: "Alice" }, channel: { name: "Room" } },
    elements: [h.text("hello")],
    onebot: {},
    ...overrides,
  } as unknown as Session;
}

function store(put: AssetStore["put"] = vi.fn(async () => h("img", { id: ID }))): AssetStore {
  return { put, get: vi.fn(), clear: vi.fn(async () => undefined) };
}

describe("resolveOneBotEvent", () => {
  it("produces a typed reaction event from a valid reactions-updated notice", () => {
    const result = resolveOneBotEvent(makeSession({
      onebot: {
        post_type: "notice", notice_type: "message_reactions_updated", group_id: "20000",
        message_id: "40000", user_id: "30000", reactions: [{ emoji_id: "100", emoji_type: "1", count: 5 }],
      },
    }));

    expect(result).toMatchObject({
      kind: "event", eventType: "onebot.message-reactions-updated",
      reaction: { messageId: "40000", userId: "30000", reactions: [{ id: "100", type: "1", count: 5 }] },
    });
  });

  it.each([
    {},
    { post_type: "notice", notice_type: "group_increase" },
    { post_type: "notice", notice_type: "message_reactions_updated", group_id: "20000" },
  ])("returns null for unsupported or incomplete notices", (onebot) => {
    expect(resolveOneBotEvent(makeSession({ onebot }))).toBeNull();
  });

  it("preserves numeric identifiers and zero reaction counts", () => {
    const result = resolveOneBotEvent(makeSession({
      onebot: {
        post_type: "notice", notice_type: "message_reactions_updated", group_id: 20000,
        message_id: 40000, user_id: 30000, reactions: [{ emoji_id: 100, emoji_type: 1, count: 0 }],
      },
    }));

    expect(result?.reaction).toMatchObject({ messageId: "40000", reactions: [{ id: "100", count: 0 }] });
  });

  it("produces the typed poke event without raw platform residue", () => {
    const result = resolveOneBotEvent(makeSession({
      type: "notice",
      event: {
        sn: 7,
        type: "notice",
        login: { sn: 1, adapter: "onebot", status: 1, features: [] },
        referrer: { source: "test" },
        subtype: "poke",
        channel: { id: "20000", type: 0 },
        user: { id: "30000", name: "Alice" },
        _data: { user_id: 30000, target_id: 10000 },
      },
    }));

    expect(result).toEqual({
      kind: "event", eventType: "notice.poke", targetId: "10000", action: "拍了拍", text: "30000 拍了拍 10000",
    });
  });
});

describe("OneBot resolver", () => {
  it("passes an AbortSignal to streaming HTTP and persists a complete image ID", async () => {
    const http = vi.fn(async () => ({
      data: new ReadableStream({ start(controller) { controller.enqueue(PNG); controller.close(); } }),
    }));
    const assets = store();
    const resolver = createResolver({ http } as never);

    const result = await resolver.resolve(makeSession({ elements: [h("img", { src: "https://onebot.example/image" })] }), assets);

    expect(http).toHaveBeenCalledWith("https://onebot.example/image", expect.objectContaining({
      responseType: "stream", signal: expect.any(AbortSignal),
    }));
    expect(assets.put).toHaveBeenCalledWith(PNG);
    expect(result).toMatchObject({ kind: "message", elements: [h("img", { id: ID })] });
  });

  it("loads a bounded NapCat file without using HTTP", async () => {
    const directory = await mkdtemp(join(tmpdir(), "yesimbot-onebot-image-"));
    const path = join(directory, "napcat.png");
    await writeFile(path, PNG);
    const http = vi.fn();
    const assets = store();
    try {
      const resolver = createResolver({ http } as never);
      await resolver.resolve(makeSession({ elements: [h("img", { src: pathToFileURL(path).href })] }), assets);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }

    expect(http).not.toHaveBeenCalled();
    expect(assets.put).toHaveBeenCalledWith(PNG);
  });

  it("decodes a data URL without network access", async () => {
    const http = vi.fn();
    const assets = store();
    const resolver = createResolver({ http } as never);
    const source = `data:image/png;base64,${Buffer.from(PNG).toString("base64")}`;

    await resolver.resolve(makeSession({ elements: [h("img", { src: source })] }), assets);

    expect(http).not.toHaveBeenCalled();
    expect(assets.put).toHaveBeenCalledWith(PNG);
  });

  it("keeps the original image when a remote stream exceeds the per-image limit", async () => {
    const original = h("img", { src: "https://onebot.example/oversized" });
    const http = vi.fn(async () => ({
      data: new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(5 * 1024 * 1024 + 1)); } }),
    }));
    const assets = store();

    const result = await createResolver({ http } as never).resolve(makeSession({ elements: [original] }), assets);

    expect(result).toMatchObject({ kind: "message", elements: [original] });
    expect(assets.put).not.toHaveBeenCalled();
  });

  it("keeps original oversized data URLs and files without starting unrelated transport", async () => {
    const http = vi.fn();
    const largeData = `data:image/png;base64,${"a".repeat(7 * 1024 * 1024)}`;
    const dataOriginal = h("img", { src: largeData });
    const assets = store();
    const resolver = createResolver({ http } as never);

    const dataResult = await resolver.resolve(makeSession({ elements: [dataOriginal] }), assets);
    expect(dataResult).toMatchObject({ kind: "message", elements: [dataOriginal] });

    const directory = await mkdtemp(join(tmpdir(), "yesimbot-onebot-large-"));
    const path = join(directory, "large.png");
    await writeFile(path, new Uint8Array(5 * 1024 * 1024 + 1));
    const fileOriginal = h("img", { src: pathToFileURL(path).href });
    try {
      const fileResult = await resolver.resolve(makeSession({ elements: [fileOriginal] }), assets);
      expect(fileResult).toMatchObject({ kind: "message", elements: [fileOriginal] });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
    expect(http).not.toHaveBeenCalled();
    expect(assets.put).not.toHaveBeenCalled();
  });

  it("keeps source-less and local persisted images unchanged", async () => {
    const sourceLess = h("img");
    const local = h("img", { id: ID });
    const assets = store();
    const result = await createResolver({ http: vi.fn() } as never).resolve(
      makeSession({ elements: [sourceLess, local] }),
      assets,
    );

    expect(result).toMatchObject({ kind: "message", elements: [sourceLess, local] });
    expect(assets.put).not.toHaveBeenCalled();
  });

  it("preserves unknown non-image element structure", async () => {
    const text = h("p", { class: "copy" }, [h.text("before"), h("at", { id: "42" }), h.text("after")]);
    const result = await createResolver({ http: vi.fn() } as never).resolve(
      makeSession({ elements: [text] }),
      store(),
    );

    expect(result).toMatchObject({ kind: "message", elements: [text] });
  });

  it("preserves quote and forward elements unchanged", async () => {
    const quote = h("quote", { id: 42, content: "preserve" }, [h.text("preserve")]);
    const forward = h("forward", { id: "f-1", summary: "untrusted", extra: "preserve" }, [h.text("preserve")]);
    const legacyForward = h("message", { forward: true, id: 7 }, [h.text("preserve")]);
    const result = await createResolver({ http: vi.fn() } as never).resolve(
      makeSession({ elements: [quote, forward, legacyForward] }),
      store(),
    );

    expect(result).toMatchObject({
      kind: "message",
      elements: [quote, forward, legacyForward],
    });
  });

  it("persists nested images in document order and returns a host-envelope-free Draft", async () => {
    const first = h("img", { id: "11111111111111111111111111111111" });
    const second = h("img", { id: "22222222222222222222222222222222" });
    const put = vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(second);
    const assets = store(put);
    const resolver = createResolver({ http: vi.fn() } as never);

    const result = await resolver.resolve(makeSession({ elements: [h("p", {}, [
      h("img", { src: "data:image/png;base64,iVBORw==" }),
      h("span", {}, [h("img", { src: "data:image/png;base64,iVBORw==" })]),
    ])] }), assets);

    expect(put).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({ kind: "message", elements: [h("p", {}, [first, h("span", {}, [second])])] });
    expect(result).not.toHaveProperty("platform");
    expect(result).not.toHaveProperty("selfId");
  });

  it("retains one failed image and continues processing sibling images", async () => {
    const failed = h("img", { src: "https://onebot.example/fail" });
    const saved = h("img", { id: ID });
    const http = vi.fn(async (url: string) => {
      if (url.includes("fail")) throw new Error("offline");
      return { data: new ReadableStream({ start(controller) { controller.enqueue(PNG); controller.close(); } }) };
    });
    const assets = store(vi.fn(async () => saved));

    const result = await createResolver({ http } as never).resolve(makeSession({ elements: [
      failed,
      h("img", { src: "https://onebot.example/saved" }),
    ] }), assets);

    expect(result).toMatchObject({ kind: "message", elements: [failed, saved] });
    expect(assets.put).toHaveBeenCalledOnce();
  });

  it("returns supported notice Drafts and skips unsupported Sessions", async () => {
    const resolver = createResolver({ http: vi.fn() } as never);
    const notice = await resolver.resolve(makeSession({
      type: "notice",
      elements: undefined,
      onebot: {
        post_type: "notice", notice_type: "message_reactions_updated", group_id: "20000",
        message_id: "40000", user_id: "30000", reactions: [],
      },
    }), store());
    expect(notice).toMatchObject({ kind: "event", eventType: "onebot.message-reactions-updated" });
    await expect(resolver.resolve(makeSession({ type: "notice", elements: undefined }), store())).resolves.toBeNull();
  });
});
