import { describe, expect, it, vi } from "vitest";

vi.mock("koishi", async () => import("@koishijs/core"));

import { mkdtemp, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { pathToFileURL } from "url";

import { h, type Session, type Element } from "koishi";
import { EventRecord, ResolveContext } from "koishi-plugin-yesimbot";

import { resolveOneBotEvent } from "../../src/platforms/onebot/events.js";
import { freezeOneBotImages } from "../../src/platforms/onebot/image.js";
import { createResolver } from "../../src/platforms/onebot/index.js";

function makeSession(onebot: Record<string, unknown> = {}): Session {
  return {
    platform: "onebot",
    selfId: "10000",
    channelId: "20000",
    userId: "30000",
    timestamp: 1,
    event: {},
    onebot,
  } as unknown as Session;
}

describe("resolveOneBotEvent", () => {
  it("produces a typed reaction event from a valid reactions-updated notice", () => {
    const result = resolveOneBotEvent(
      makeSession({
        post_type: "notice",
        notice_type: "message_reactions_updated",
        group_id: "20000",
        message_id: "40000",
        user_id: "30000",
        reactions: [{ emoji_id: "100", emoji_type: "1", count: 5 }],
      }),
    );

    expect(result).toMatchObject({
      type: "onebot.message-reactions-updated",
      platform: "onebot",
      selfId: "10000",
      channel: { id: "20000" },
      reaction: {
        messageId: "40000",
        userId: "30000",
        reactions: [{ id: "100", type: "1", count: 5 }],
      },
    });
    expect(result).not.toHaveProperty("content");
  });

  it.each([
    {},
    { post_type: "notice", notice_type: "group_increase" },
    { post_type: "notice", notice_type: "message_reactions_updated", group_id: "20000" },
  ])("returns null for unsupported or incomplete input", (onebot) => {
    expect(resolveOneBotEvent(makeSession(onebot))).toBeNull();
  });

  it("preserves numeric protocol identifiers and zero reaction counts", () => {
    const result = resolveOneBotEvent(
      makeSession({
        post_type: "notice",
        notice_type: "message_reactions_updated",
        group_id: 20000,
        message_id: 40000,
        user_id: 30000,
        reactions: [{ emoji_id: 100, emoji_type: 1, count: 0 }],
      }),
    );
    expect(result?.reaction).toMatchObject({
      messageId: "40000",
      reactions: [{ id: "100", count: 0 }],
    });
  });
});

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);

function freezer(): ResolveContext["freezeImage"] & { mock: ReturnType<typeof vi.fn>["mock"] } {
  return vi.fn(async (element, load) => {
    const loaded = await load(new AbortController().signal, 16);
    return h("img", { id: "asset_abc", mime: loaded.mime });
  }) as never;
}

function boundedFreezer(maxBytes: number): ResolveContext["freezeImage"] {
  return vi.fn(async (_element, load) => {
    await load(new AbortController().signal, maxBytes);
    return h("img", { unavailable: "true" });
  }) as never;
}

describe("freezeOneBotImages", () => {
  it("passes the AbortSignal into streaming Koishi HTTP transport", async () => {
    const http = vi.fn(async () => ({
      data: new ReadableStream({
        start(controller) {
          controller.enqueue(PNG);
          controller.close();
        },
      }),
      headers: new Headers({ "content-type": "image/png" }),
    }));
    const freezeImage = freezer();

    const result = await freezeOneBotImages(
      { http } as never,
      [h("p", {}, [h.text("before"), h("img", { src: "https://lagrange.example/image" })])],
      freezeImage,
    );

    expect(http).toHaveBeenCalledWith(
      "https://lagrange.example/image",
      expect.objectContaining({ responseType: "stream", signal: expect.any(AbortSignal) }),
    );
    expect(freezeImage).toHaveBeenCalledOnce();
    expect(result[0].children[1].attrs).toEqual({ id: "asset_abc", mime: "image/png" });
  });

  it("loads a NapCat file URL after its size is checked before reading", async () => {
    const path = await mkdtemp(join(tmpdir(), "yesimbot-onebot-image-"));
    const imagePath = join(path, "napcat.png");
    await writeFile(imagePath, PNG);
    const freezeImage = freezer();

    try {
      await freezeOneBotImages(
        { http: vi.fn() } as never,
        [h("img", { src: pathToFileURL(imagePath).href })],
        freezeImage,
      );
    } finally {
      await rm(path, { recursive: true, force: true });
    }
  });

  it("decodes a data image without a network request", async () => {
    const file = vi.fn();
    const freezeImage = freezer();
    const src = `data:image/png;base64,${Buffer.from(PNG).toString("base64")}`;

    const result = await freezeOneBotImages(
      { http: { file } } as never,
      [h("img", { src })],
      freezeImage,
    );

    expect(file).not.toHaveBeenCalled();
    expect(result[0].attrs).toEqual({ id: "asset_abc", mime: "image/png" });
  });

  it("cancels an oversized remote stream before buffering its complete body", async () => {
    const cancel = vi.fn();
    const http = vi.fn(async () => ({
      data: new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array(5));
        },
        cancel,
      }),
      headers: new Headers(),
    }));

    await expect(
      freezeOneBotImages(
        { http } as never,
        [h("img", { src: "https://lagrange.example/oversized" })],
        boundedFreezer(4),
      ),
    ).rejects.toThrow("Image exceeds byte limit");
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("rejects oversized data URLs before decoding and oversized files before reading", async () => {
    const http = vi.fn();
    const dataSrc = `data:image/png;base64,${"a".repeat(24)}`;
    await expect(
      freezeOneBotImages({ http } as never, [h("img", { src: dataSrc })], boundedFreezer(4)),
    ).rejects.toThrow("Image exceeds byte limit");

    const path = await mkdtemp(join(tmpdir(), "yesimbot-onebot-large-"));
    const imagePath = join(path, "large.png");
    await writeFile(imagePath, new Uint8Array(5));
    try {
      await expect(
        freezeOneBotImages(
          { http } as never,
          [h("img", { src: pathToFileURL(imagePath).href })],
          boundedFreezer(4),
        ),
      ).rejects.toThrow("Image exceeds byte limit");
    } finally {
      await rm(path, { recursive: true, force: true });
    }
    expect(http).not.toHaveBeenCalled();
  });

  it("rejects an aborted image load without waiting for the OneBot file API", async () => {
    const http = vi.fn();
    const controller = new AbortController();
    controller.abort(new Error("stopped"));
    const freezeImage = vi.fn(async (element, load) => {
      const loaded = await load(controller.signal);
      return h("img", { id: "asset_abc", mime: loaded.mime });
    });

    await expect(
      freezeOneBotImages(
        { http } as never,
        [h("img", { src: "https://lagrange.example/image" })],
        freezeImage,
      ),
    ).rejects.toThrow("stopped");
    expect(http).not.toHaveBeenCalled();
  });

  it("seals an image without a source or frozen asset as unavailable", async () => {
    const file = vi.fn();
    const freezeImage = freezer();

    const result = await freezeOneBotImages({ http: { file } } as never, [h("img")], freezeImage);

    expect(result[0].attrs).toEqual({ unavailable: "true" });
    expect(file).not.toHaveBeenCalled();
    expect(freezeImage).not.toHaveBeenCalled();
  });

  it("leaves local assets, quotes, and forwards untouched", async () => {
    const file = vi.fn();
    const freezeImage = freezer();
    const elements: Element[] = [
      h("img", { id: "asset_local", mime: "image/png" }),
      h("quote", { id: "quoted" }),
      h("forward", { id: "forward", summary: "fixed" }),
    ];

    await expect(
      freezeOneBotImages({ http: { file } } as never, elements, freezeImage),
    ).resolves.toEqual(elements);
    expect(file).not.toHaveBeenCalled();
    expect(freezeImage).not.toHaveBeenCalled();
  });
});

function messageBase(): Omit<EventRecord<"message">, "content"> {
  return {
    type: "message",
    platform: "onebot",
    selfId: "bot",
    timestamp: 1,
    channel: { id: "room", type: 0, name: "room" },
    user: { id: "user", name: "Alice" },
    member: { nick: "Alice" },
    guild: { id: "guild", name: "Guild" },
    message: { id: "message", content: "hello", elements: [h.text("hello")] },
  } as Omit<EventRecord<"message">, "content">;
}

function context(overrides: Partial<ResolveContext> = {}): ResolveContext {
  return {
    session: { platform: "onebot", selfId: "bot", event: { type: "message" } } as Session,
    base: messageBase(),
    freezeImage: vi.fn(async (element) => element),
    ...overrides,
  };
}

describe("createResolver", () => {
  it("preserves the complete generic message base while freezing OneBot images", async () => {
    const resolver = createResolver({ http: { file: vi.fn() } } as never);
    const base = messageBase();
    const result = await resolver.resolve(context({ base }));

    expect(result).toMatchObject({
      type: "message",
      channel: base.channel,
      user: base.user,
      member: base.member,
      guild: base.guild,
      message: { id: base.message.id, elements: [h.text("hello")] },
    });
    expect(result?.content).toBe("hello");
  });

  it("resolves a supported notice before considering the optional message base", async () => {
    const resolver = createResolver({ http: { file: vi.fn() } } as never);
    const result = await resolver.resolve(
      context({
        session: {
          platform: "onebot",
          selfId: "bot",
          event: { type: "message" },
          onebot: {
            post_type: "notice",
            notice_type: "message_reactions_updated",
            group_id: "room",
            message_id: "message",
            user_id: "user",
            reactions: [],
          },
        } as unknown as Session,
      }),
    );

    expect(result).toMatchObject({
      type: "onebot.message-reactions-updated",
      channel: { id: "room" },
    });
  });

  it("returns null for an unsupported non-message session", async () => {
    const resolver = createResolver({ http: { file: vi.fn() } } as never);
    await expect(
      resolver.resolve(
        context({
          session: { platform: "onebot", selfId: "bot", event: {} } as Session,
          base: undefined,
        }),
      ),
    ).resolves.toBeNull();
  });
});
