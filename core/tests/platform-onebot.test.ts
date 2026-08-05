import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { describe, expect, it, vi } from "vitest";

vi.mock("koishi", async () => import("@koishijs/core"));

import { h, Universal, type Session } from "koishi";

import type { AssetStore } from "../src/asset.js";
import { translateOneBotEvent, createOneBotTranslator } from "../src/gateway/onebot.js";

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

function base() {
  return {
    platform: "onebot",
    selfId: "10000",
    channel: { id: "20000", type: Universal.Channel.Type.TEXT, name: "Room" },
    user: { id: "30000", name: "Alice" },
    timestamp: 1,
  } as const;
}

function store(put: AssetStore["put"] = vi.fn(async () => ID)): AssetStore {
  return { put, get: vi.fn(), clear: vi.fn(async () => undefined) };
}

function headers(values: Record<string, string> = {}): { get(name: string): string | null } {
  return { get: (name) => values[name.toLowerCase()] ?? null };
}

describe("translateOneBotEvent", () => {
  it.each([
    { post_type: "notice", notice_type: "group_increase" },
    { post_type: "notice", notice_type: "message_reactions_updated", group_id: "20000" },
  ])("returns null for unsupported or incomplete notices", (onebot) => {
    expect(translateOneBotEvent(base(), makeSession({ onebot }))).toBeNull();
  });

  it("produces the typed poke event without raw platform residue", () => {
    const result = translateOneBotEvent(
      base(),
      makeSession({
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
      }),
    );

    expect(result).toEqual({
      platform: "onebot",
      selfId: "10000",
      channel: { id: "20000", type: Universal.Channel.Type.TEXT, name: "Room" },
      timestamp: 1,
      eventType: "notice.poke",
      targetId: "10000",
      action: "拍了拍",
      text: "30000 拍了拍 10000",
    });
    expect(result).not.toHaveProperty("user");
    expect(result).not.toHaveProperty("_data");
    expect(result).not.toHaveProperty("guild");
  });
});

describe("OneBot translator", () => {
  it("passes an AbortSignal to streaming HTTP and persists a complete image ID", async () => {
    const http = Object.assign(
      vi.fn(async () => ({
        data: new ReadableStream({
          start(controller) {
            controller.enqueue(PNG);
            controller.close();
          },
        }),
      })),
      { head: vi.fn(async () => headers({ "content-type": "image/png", "content-length": "4" })) },
    );
    const assets = store();
    const resolver = createOneBotTranslator({ http } as never);

    const result = await resolver.translate(
      base(),
      makeSession({ elements: [h("img", { src: "https://onebot.example/image" })] }),
      assets,
    );

    expect(http).toHaveBeenCalledWith(
      "https://onebot.example/image",
      expect.objectContaining({
        responseType: "stream",
        signal: expect.any(AbortSignal),
      }),
    );
    expect(http.head).toHaveBeenCalledWith(
      "https://onebot.example/image",
      expect.objectContaining({ timeout: 10_000 }),
    );
    expect(assets.put).toHaveBeenCalledWith(PNG);
    expect(result).toMatchObject({ elements: [h("img", { id: ID })], platform: "onebot" });
  });

  it("loads a bounded NapCat file without using HTTP", async () => {
    const directory = await mkdtemp(join(tmpdir(), "yesimbot-onebot-image-"));
    const path = join(directory, "napcat.png");
    await writeFile(path, PNG);
    const http = vi.fn();
    const assets = store();
    try {
      const resolver = createOneBotTranslator({ http } as never);
      await resolver.translate(
        base(),
        makeSession({ elements: [h("img", { src: pathToFileURL(path).href })] }),
        assets,
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }

    expect(http).not.toHaveBeenCalled();
    expect(assets.put).toHaveBeenCalledWith(PNG);
  });

  it("decodes a data URL without network access", async () => {
    const http = vi.fn();
    const assets = store();
    const resolver = createOneBotTranslator({ http } as never);
    const source = `data:image/png;base64,${Buffer.from(PNG).toString("base64")}`;

    await resolver.translate(base(), makeSession({ elements: [h("img", { src: source })] }), assets);

    expect(http).not.toHaveBeenCalled();
    expect(assets.put).toHaveBeenCalledWith(PNG);
  });

  it("keeps the original image when a remote stream exceeds the per-image limit", async () => {
    const original = h("img", { src: "https://onebot.example/oversized" });
    const http = Object.assign(
      vi.fn(async () => ({
        data: new ReadableStream({
          start(controller) {
            controller.enqueue(new Uint8Array(5 * 1024 * 1024 + 1));
          },
        }),
      })),
      { head: vi.fn(async () => headers()) },
    );
    const assets = store();

    const result = await createOneBotTranslator({ http } as never).translate(
      base(),
      makeSession({ elements: [original] }),
      assets,
    );
    expect(result).toMatchObject({ elements: [original] });
    expect(assets.put).not.toHaveBeenCalled();
  });

  it("keeps original oversized data URLs and files without starting unrelated transport", async () => {
    const http = vi.fn();
    const largeData = `data:image/png;base64,${"a".repeat(7 * 1024 * 1024)}`;
    const dataOriginal = h("img", { src: largeData });
    const assets = store();
    const resolver = createOneBotTranslator({ http } as never);

    const dataResult = await resolver.translate(base(), makeSession({ elements: [dataOriginal] }), assets);
    expect(dataResult).toMatchObject({ elements: [dataOriginal] });

    const directory = await mkdtemp(join(tmpdir(), "yesimbot-onebot-large-"));
    try {
      const path = join(directory, "large.png");
      await writeFile(path, new Uint8Array(5 * 1024 * 1024 + 1));
      const fileOriginal = h("img", { src: pathToFileURL(path).href });
      const fileResult = await resolver.translate(base(), makeSession({ elements: [fileOriginal] }), assets);
      expect(fileResult).toMatchObject({ elements: [fileOriginal] });
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
    const result = await createOneBotTranslator({ http: vi.fn() } as never).translate(
      base(),
      makeSession({ elements: [sourceLess, local] }),
      assets,
    );

    expect(assets.put).not.toHaveBeenCalled();
  });

  it("preserves unknown non-image element structure", async () => {
    const text = h("p", { class: "copy" }, [h.text("before"), h("at", { id: "42" }), h.text("after")]);
    const result = await createOneBotTranslator({ http: vi.fn() } as never).translate(
      base(),
      makeSession({ elements: [text] }),
      store(),
    );

    expect(result).toMatchObject({ elements: [text] });
  });

  it("preserves quote and forward elements unchanged", async () => {
    const quote = h("quote", { id: 42, content: "preserve" }, [h.text("preserve")]);
    const forward = h("forward", { id: "f-1", summary: "untrusted", extra: "preserve" }, [h.text("preserve")]);
    const legacyForward = h("message", { forward: true, id: 7 }, [h.text("preserve")]);
    const result = await createOneBotTranslator({ http: vi.fn() } as never).translate(
      base(),
      makeSession({ elements: [quote, forward, legacyForward] }),
      store(),
    );

    expect(result).toMatchObject({
      elements: [quote, forward, legacyForward],
    });
  });

  it("persists nested images in document order and returns a final host record", async () => {
    const firstId = "11111111111111111111111111111111";
    const secondId = "22222222222222222222222222222222";
    const put = vi.fn().mockResolvedValueOnce(firstId).mockResolvedValueOnce(secondId);
    const assets = store(put);
    const resolver = createOneBotTranslator({ http: vi.fn() } as never);

    const result = await resolver.translate(
      base(),
      makeSession({
        elements: [
          h("p", {}, [
            h("img", { src: "data:image/png;base64,iVBORw==" }),
            h("span", {}, [h("img", { src: "data:image/png;base64,iVBORw==" })]),
          ]),
        ],
      }),
      assets,
    );

    expect(put).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({
      platform: "onebot",
      selfId: "10000",
      elements: [h("p", {}, [h("img", { id: firstId }), h("span", {}, [h("img", { id: secondId })])])],
    });
  });

  it("retains one failed image and continues processing sibling images", async () => {
    const failed = h("img", { src: "https://onebot.example/fail" });
    const savedId = ID;
    const http = Object.assign(
      vi.fn(async (url: string) => {
        if (url.includes("fail")) throw new Error("offline");
        return {
          data: new ReadableStream({
            start(controller) {
              controller.enqueue(PNG);
              controller.close();
            },
          }),
        };
      }),
      {
        head: vi.fn(async (url: string) => {
          if (url.includes("fail")) throw new Error("offline");
          return headers({ "content-type": "image/png", "content-length": "4" });
        }),
      },
    );
    const assets = store(vi.fn(async () => savedId));

    const result = await createOneBotTranslator({ http } as never).translate(
      base(),
      makeSession({ elements: [failed, h("img", { src: "https://onebot.example/saved" })] }),
      assets,
    );

    expect(result).toMatchObject({ elements: [failed, h("img", { id: savedId })] });
    expect(assets.put).toHaveBeenCalledOnce();
  });

  it("returns a poke event and skips unsupported notices", async () => {
    const resolver = createOneBotTranslator({ http: vi.fn() } as never);
    const notice = await resolver.translate(
      base(),
      makeSession({
        type: "notice",
        elements: undefined,
        event: {
          type: "notice",
          subtype: "poke",
          _data: { user_id: "30000", target_id: "10000" },
        },
      }),
      store(),
    );
    expect(notice).toMatchObject({ platform: "onebot", eventType: "notice.poke" });
    await expect(
      resolver.translate(base(), makeSession({ type: "notice", elements: undefined }), store()),
    ).resolves.toBeNull();
  });
});
