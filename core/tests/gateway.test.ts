import { describe, expect, it, vi } from "vitest";

vi.mock("koishi", async () => import("@koishijs/core"));

import { h, Universal } from "koishi";

import type { ChannelScope } from "../src/channel/index.js";
import { Config } from "../src/config.js";
import type { InputRecord, MessageRecord } from "../src/event/index.js";
import { matchesAllowedChannel, type ChannelAllowRule } from "../src/gateway/allowlist.js";
import { Gateway, type SessionResolver } from "../src/gateway/index.js";
import { ChannelStorage } from "../src/storage/index.js";

function session(overrides: Record<string, unknown> = {}) {
  return {
    platform: "test",
    selfId: "bot-1",
    channelId: "room-1",
    isDirect: false,
    type: "message-created",
    userId: "user-1",
    messageId: "message-1",
    timestamp: 1,
    event: { type: "message" },
    elements: [h.text("hello")],
    ...overrides,
  };
}

function record(): MessageRecord {
  return {
    schemaVersion: 1,
    platform: "test",
    selfId: "bot-1",
    timestamp: 1,
    channel: { id: "room-1", type: 0 },
    user: { id: "user-1", name: "User" },
    messageId: "message-1",
    elements: [h.text("hello")],
    text: "hello",
  };
}

function eventRecord(): InputRecord {
  return {
    schemaVersion: 1,
    eventType: "delivery.failed",
    platform: "test",
    selfId: "bot-1",
    timestamp: 1,
    channel: { id: "room-1", type: 0 },
    user: { id: "user-1" },
    text: "Delivery failed",
    delivery: {
      turnId: "turn-1",
      messageId: "message-1",
      error: { name: "Error", message: "notice" },
    },
  };
}

function createGateway(
  options: {
    readonly ready?: () => Promise<void>;
    readonly allowedChannels?: readonly ChannelAllowRule[];
  } = {},
) {
  const runtime = { route: vi.fn(async () => ({ kind: "wait", eventId: "event-1" })) };
  const logger = { warn: vi.fn() };
  const database = { get: vi.fn(async () => [{ assignee: "bot-1" }]) };
  let middleware: ((input: never, next: () => Promise<unknown>) => Promise<void>) | undefined;
  let internal: ((input: never) => void) | undefined;
  const ctx = {
    middleware: vi.fn((callback) => {
      middleware = callback;
      return vi.fn();
    }),
    on: vi.fn((_event, listener) => {
      internal = listener;
      return vi.fn();
    }),
    database,
  };
  const assets = { put: vi.fn(async () => ({ assetId: "asset_image", mime: "image/png" })) };
  const storage = new ChannelStorage("/tmp/yesimbot-gateway-test");
  return {
    gateway: new Gateway({
      ctx: ctx as never,
      runtime: runtime as never,
      assets,
      storage,
      ready: options.ready ?? (() => storage.start()),
      allowedChannels: options.allowedChannels ?? [{ platform: "*", channelId: "*" }],
      logger,
    }),
    runtime,
    assets,
    database,
    storage,
    logger,
    middleware: () => middleware!,
    internal: () => internal!,
  };
}

describe("Channel allowlist", () => {
  const sharedScope: ChannelScope = {
    platform: "test",
    selfId: "bot-1",
    channelId: "room-1",
    isDirect: false,
  };
  const directScope: ChannelScope = { ...sharedScope, isDirect: true };

  it("denies missing and empty rules", () => {
    expect(matchesAllowedChannel(sharedScope, undefined)).toBe(false);
    expect(matchesAllowedChannel(sharedScope, [])).toBe(false);
  });

  it("matches exact platform and channel values", () => {
    expect(matchesAllowedChannel(sharedScope, [{ platform: "test", channelId: "room-1" }])).toBe(
      true,
    );
    expect(matchesAllowedChannel(sharedScope, [{ platform: "test", channelId: "room-2" }])).toBe(
      false,
    );
  });

  it("matches platform and channel wildcards", () => {
    expect(matchesAllowedChannel(sharedScope, [{ platform: "*", channelId: "room-1" }])).toBe(true);
    expect(matchesAllowedChannel(sharedScope, [{ platform: "test", channelId: "*" }])).toBe(true);
  });

  it("matches omitted directness for both channel scopes", () => {
    const rule = [{ platform: "test", channelId: "room-1" }];

    expect(matchesAllowedChannel(sharedScope, rule)).toBe(true);
    expect(matchesAllowedChannel(directScope, rule)).toBe(true);
  });

  it("matches direct-only and shared-only rules", () => {
    expect(
      matchesAllowedChannel(directScope, [{ platform: "test", channelId: "*", isDirect: true }]),
    ).toBe(true);
    expect(
      matchesAllowedChannel(sharedScope, [{ platform: "test", channelId: "*", isDirect: true }]),
    ).toBe(false);
    expect(
      matchesAllowedChannel(sharedScope, [{ platform: "test", channelId: "*", isDirect: false }]),
    ).toBe(true);
    expect(
      matchesAllowedChannel(directScope, [{ platform: "test", channelId: "*", isDirect: false }]),
    ).toBe(false);
  });

  it("uses OR semantics across rules", () => {
    expect(
      matchesAllowedChannel(sharedScope, [
        { platform: "other", channelId: "room-1" },
        { platform: "test", channelId: "room-1" },
      ]),
    ).toBe(true);
  });

  it("defaults the configured allowlist to an empty array", () => {
    const config = Config({ basePath: "data/yesimbot", chatModel: "test-model" });

    expect(config.allowedChannels).toEqual([]);
  });
});

describe("Gateway", () => {
  it("rejects an unmatched valid scope before readiness or downstream admission work", async () => {
    const ready = vi.fn(async () => undefined);
    const { gateway, runtime, assets, database, storage } = createGateway({
      ready,
      allowedChannels: [],
    });
    const updateName = vi.spyOn(storage, "updateName");
    const resolve = vi.fn(async () => record());
    gateway.register({ platform: "test", resolve });

    await gateway.handle(session() as never);

    expect(ready).not.toHaveBeenCalled();
    expect(database.get).not.toHaveBeenCalled();
    expect(resolve).not.toHaveBeenCalled();
    expect(assets.put).not.toHaveBeenCalled();
    expect(updateName).not.toHaveBeenCalled();
    expect(runtime.route).not.toHaveBeenCalled();
  });

  it.each([
    ["missing elements", { elements: undefined, messageId: "m1" }],
    ["missing message id", { elements: [h.text("hi")], messageId: undefined }],
    ["empty message id", { elements: [h.text("hi")], messageId: "" }],
  ])("skips message-created session with %s", async (_label, patch) => {
    const { gateway, runtime } = createGateway();
    // No resolver registered - admission rejection is tested on fallback path

    await gateway.handle(session(patch) as never);

    expect(runtime.route).not.toHaveBeenCalled();
  });

  it("admits a message session with empty elements and produces a complete MessageRecord", async () => {
    const { gateway, runtime } = createGateway();
    // No resolver registered - use fallback path

    await gateway.handle(session({ elements: [] }) as never);

    expect(runtime.route).toHaveBeenCalledWith(
      expect.objectContaining({
        schemaVersion: 1,
        messageId: "message-1",
        elements: [],
        text: "",
        timestamp: expect.any(Number),
      }),
    );
    const routed = runtime.route.mock.calls[0]?.[0] as MessageRecord;
    expect(routed).not.toHaveProperty("type");
    expect(routed).not.toHaveProperty("content");
    expect(routed).not.toHaveProperty("message");
  });

  it.each([
    [[{ platform: "*", channelId: "room-1", isDirect: false }], {}, 0],
    [[{ platform: "test", channelId: "*", isDirect: true }], { isDirect: true }, 1],
  ])(
    "admits Sessions matching a directness-specific wildcard rule",
    async (allowedChannels, overrides, type) => {
      const { gateway, runtime } = createGateway({ allowedChannels });
      gateway.register({
        platform: "test",
        resolve: async () => ({ ...record(), channel: { ...record().channel, type } }),
      });

      await gateway.handle(session(overrides) as never);

      expect(runtime.route).toHaveBeenCalledOnce();
    },
  );

  it("waits for storage readiness before shared admission and later side effects", async () => {
    let release!: () => void;
    const ready = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { gateway, runtime, assets, database, storage } = createGateway({ ready: () => ready });
    const updateName = vi.spyOn(storage, "updateName");
    const resolve = vi.fn(async () => record());
    gateway.register({ platform: "test", resolve });

    const handling = gateway.handle(session() as never);

    await Promise.resolve();
    expect(database.get).not.toHaveBeenCalled();
    expect(resolve).not.toHaveBeenCalled();
    expect(assets.put).not.toHaveBeenCalled();
    expect(updateName).not.toHaveBeenCalled();
    expect(runtime.route).not.toHaveBeenCalled();

    release();
    await handling;
  });

  it.each([
    [[], "missing"],
    [[{ assignee: "" }], "empty"],
    [[{ assignee: "other" }], "mismatch"],
  ])("rejects shared admission before resolver %#", async (rows) => {
    const { gateway, runtime, assets, database } = createGateway();
    const resolve = vi.fn(async () => record());
    gateway.register({ platform: "test", resolve });
    database.get.mockResolvedValue(rows);

    await gateway.handle(session() as never);

    expect(resolve).not.toHaveBeenCalled();
    expect(assets.put).not.toHaveBeenCalled();
    expect(runtime.route).not.toHaveBeenCalled();
  });

  it("rejects a shared database failure before resolver work", async () => {
    const { gateway, runtime, assets, database } = createGateway();
    const resolve = vi.fn(async () => record());
    gateway.register({ platform: "test", resolve });
    database.get.mockRejectedValue(new Error("database unavailable"));

    await gateway.handle(session() as never);

    expect(resolve).not.toHaveBeenCalled();
    expect(assets.put).not.toHaveBeenCalled();
    expect(runtime.route).not.toHaveBeenCalled();
  });

  it.each([[{ atSelf: true }], [{ content: "yesimbot.reset", prefix: "yesimbot" }]])(
    "does not let shared routing hints bypass non-assignee admission",
    async (overrides) => {
      const { gateway, runtime, database } = createGateway();
      const resolve = vi.fn(async () => record());
      gateway.register({ platform: "test", resolve });
      database.get.mockResolvedValue([{ assignee: "other" }]);

      await gateway.handle(session(overrides) as never);

      expect(resolve).not.toHaveBeenCalled();
      expect(runtime.route).not.toHaveBeenCalled();
    },
  );

  it("routes direct Sessions without a Database assignee lookup", async () => {
    const { gateway, runtime, database } = createGateway();
    gateway.register({
      platform: "test",
      resolve: async () => ({ ...record(), channel: { ...record().channel, type: 1 } }),
    });

    await gateway.handle(session({ isDirect: true }) as never);

    expect(database.get).not.toHaveBeenCalled();
    expect(runtime.route).toHaveBeenCalledOnce();
  });

  it("updates a resolved non-empty channel name before runtime submission", async () => {
    const { gateway, runtime, storage } = createGateway();
    const updateName = vi.spyOn(storage, "updateName");
    gateway.register({
      platform: "test",
      resolve: async () => ({ ...record(), channel: { ...record().channel, name: "Room" } }),
    });

    await gateway.handle(session() as never);

    expect(updateName).toHaveBeenCalledWith(
      { platform: "test", selfId: "bot-1", channelId: "room-1", isDirect: false },
      "Room",
    );
    expect(runtime.route).toHaveBeenCalledOnce();
  });

  it("allows one resolver per platform and returns an exact disposer", () => {
    const { gateway } = createGateway();
    const first = {
      platform: "test",
      resolve: vi.fn(async () => record()),
    } satisfies SessionResolver;
    const second = {
      platform: "test",
      resolve: vi.fn(async () => record()),
    } satisfies SessionResolver;
    const disposeFirst = gateway.register(first);

    expect(() => gateway.register(second)).toThrow(
      'Resolver for platform "test" is already registered',
    );
    disposeFirst();
    const disposeSecond = gateway.register(second);
    disposeFirst();
    expect(() => gateway.register(first)).toThrow(
      'Resolver for platform "test" is already registered',
    );
    disposeSecond();
    expect(() => gateway.register(first)).not.toThrow();
  });

  it("does not admit or route a Session after close", async () => {
    const { gateway, runtime } = createGateway();

    gateway.close();
    await expect(gateway.handle(session() as never)).resolves.toBeUndefined();

    expect(runtime.route).not.toHaveBeenCalled();
  });

  it("calls the registered resolver once with the optional Satori message base", async () => {
    const { gateway, runtime } = createGateway();
    const resolve = vi.fn(async (context: Parameters<SessionResolver["resolve"]>[0]) => {
      expect(context.session).toMatchObject({ messageId: "message-1" });
      expect(context.base).toMatchObject({ schemaVersion: 1, messageId: "message-1" });
      expect(context).toHaveProperty("freezeImage");
      expect(context).not.toHaveProperty("putImage");
      return record();
    });
    gateway.register({ platform: "test", resolve });

    await gateway.handle(session() as never);

    expect(resolve).toHaveBeenCalledOnce();
    expect(runtime.route).toHaveBeenCalledWith(record());
  });

  it("rejects a resolver that changes direct classification", async () => {
    const { gateway, logger, runtime } = createGateway();
    const resolver = {
      platform: "test",
      resolve: vi.fn(async () => ({
        ...record(),
        channel: { ...record().channel, type: Universal.Channel.Type.TEXT },
        content: "mismatch",
      })),
    } satisfies SessionResolver;
    gateway.register(resolver);

    await gateway.handle(session({ isDirect: true, type: "message-created" }) as never);

    expect(runtime.route).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ code: "gateway.invalid_record" }),
    );
  });

  it("creates a normalized and sealed fallback MessageRecord for an unregistered message platform", async () => {
    const { gateway, runtime } = createGateway();

    await gateway.handle(
      session({ elements: h.parse('hello <img src="https://example.test/a.png"/>') }) as never,
    );

    const routed = runtime.route.mock.calls[0]?.[0] as MessageRecord;
    expect(routed).toMatchObject({
      schemaVersion: 1,
      messageId: "message-1",
      elements: expect.any(Array),
      text: 'hello <img unavailable="true"/>',
    });
    expect(routed).not.toHaveProperty("type");
    expect(routed).not.toHaveProperty("content");
    expect(routed).not.toHaveProperty("message");
  });

  it("preserves Satori resources while filling the fallback message identity from Session", async () => {
    const { gateway, runtime } = createGateway();
    const input = session({
      isDirect: true,
      elements: h.parse('hello <at id="bot-1"/>'),
      event: {
        type: "message",
        platform: "stale-platform",
        selfId: "stale-self",
        timestamp: 99,
        channel: { type: 1, name: "Direct channel" },
        guild: { id: "guild-1", name: "Guild" },
        member: { nick: "Member" },
        user: { name: "Event user" },
        message: { content: "stale content" },
      },
    });

    await gateway.handle(input as never);

    const routed = runtime.route.mock.calls[0]?.[0] as MessageRecord;
    expect(routed).toMatchObject({
      schemaVersion: 1,
      platform: "test",
      selfId: "bot-1",
      timestamp: 1,
      channel: { id: "room-1", type: 1, name: "Direct channel" },
      guild: { id: "guild-1", name: "Guild" },
      member: { nick: "Member" },
      user: { id: "user-1", name: "Event user" },
      messageId: "message-1",
    });
    expect(routed.elements).toEqual(
      h.parse('hello <at id="bot-1"/>'),
    );
    expect(routed).not.toBe(input);
  });

  it("uses the Session channel id while preserving the Satori channel resources", async () => {
    const { gateway, runtime } = createGateway();
    const input = session({
      isDirect: true,
      event: {
        type: "message",
        channel: { id: "event-room", type: 1, name: "Direct channel" },
        user: { id: "user-1" },
        message: { id: "message-1" },
      },
    });

    await gateway.handle(input as never);

    expect(runtime.route).toHaveBeenCalledWith(
      expect.objectContaining({ channel: { id: "room-1", type: 1, name: "Direct channel" } }),
    );
  });

  it.each([
    ["platform", (value: MessageRecord) => ({ ...value, platform: "other" })],
    ["selfId", (value: MessageRecord) => ({ ...value, selfId: "other" })],
    [
      "channel.id",
      (value: MessageRecord) => ({ ...value, channel: { ...value.channel, id: "other" } }),
    ],
  ])("rejects a resolver record with a mismatched %s", async (_field, change) => {
    const { gateway, runtime, logger } = createGateway();
    gateway.register({ platform: "test", resolve: async () => change(record()) });

    await gateway.handle(session() as never);

    expect(runtime.route).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ code: "gateway.invalid_record" }),
    );
  });

  it("skips an unregistered non-message Session", async () => {
    const { gateway, runtime } = createGateway();

    await gateway.handle(
      session({ event: { type: "notice" }, messageId: undefined, type: "notice" }) as never,
    );

    expect(runtime.route).not.toHaveBeenCalled();
  });

  it("does not fall back when a registered resolver returns null or throws", async () => {
    const skipped = createGateway();
    skipped.gateway.register({ platform: "test", resolve: async () => null });
    await skipped.gateway.handle(session() as never);
    expect(skipped.runtime.route).not.toHaveBeenCalled();

    const failed = createGateway();
    failed.gateway.register({
      platform: "test",
      resolve: async () => {
        throw new Error("broken resolver");
      },
    });
    await failed.gateway.handle(session() as never);
    expect(failed.runtime.route).not.toHaveBeenCalled();
    expect(failed.logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ code: "gateway.resolver_failed" }),
    );
  });

  it("handles message middleware and non-message internal sessions exactly once", async () => {
    const { gateway, runtime, middleware, internal } = createGateway();
    gateway.register({
      platform: "notice",
      resolve: async () => ({ ...eventRecord(), platform: "notice" }),
    });
    const message = session();
    await middleware()(message as never, async () => undefined);
    internal()(message as never);
    internal()(session({ platform: "notice", event: { type: "notice" }, type: "notice" }) as never);
    await gateway.drain();

    expect(runtime.route).toHaveBeenCalledTimes(2);
  });

  it("does not retain the Session below Gateway after accepted resolution", async () => {
    const { gateway, runtime } = createGateway();
    const input = session();
    gateway.register({ platform: "test", resolve: async () => record() });

    await gateway.handle(input as never);

    expect(runtime.route).toHaveBeenCalledWith(record());
    expect(Object.values(gateway)).not.toContain(input);
  });
});
