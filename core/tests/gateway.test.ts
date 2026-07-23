import { describe, expect, it, vi } from "vitest";

vi.mock("koishi", async () => import("@koishijs/core"));

import { h, Universal } from "koishi";

import type { EventRecord } from "../src/event/index.js";
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
    elements: "hello",
    ...overrides,
  };
}

function record(): EventRecord<"message"> {
  return {
    type: "message",
    platform: "test",
    selfId: "bot-1",
    timestamp: 1,
    channel: { id: "room-1", type: 0 },
    user: { id: "user-1", name: "User" },
    message: { id: "message-1", content: "hello" },
    content: "hello",
  } as EventRecord<"message">;
}

function createGateway() {
  const runtime = { route: vi.fn(async () => ({ kind: "wait", eventId: "event-1" })) };
  const logger = { warn: vi.fn() };
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
  };
  const assets = { put: vi.fn(async () => ({ assetId: "asset_image", mime: "image/png" })) };
  const storage = new ChannelStorage("/tmp/yesimbot-gateway-test");
  return {
    gateway: new Gateway({
      ctx: ctx as never,
      runtime: runtime as never,
      assets,
      storage,
      ready: () => storage.start(),
      logger,
    }),
    runtime,
    logger,
    middleware: () => middleware!,
    internal: () => internal!,
  };
}

describe("Gateway", () => {
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
      expect(context.base).toMatchObject({ type: "message", message: { id: "message-1" } });
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

  it("creates a normalized and sealed fallback EventRecord for an unregistered message platform", async () => {
    const { gateway, runtime } = createGateway();

    await gateway.handle(
      session({ elements: h.parse('hello <img src="https://example.test/a.png"/>') }) as never,
    );

    expect(runtime.route).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "message",
        message: expect.objectContaining({ elements: expect.any(Array) }),
        content: 'hello <img unavailable="true"/>',
      }),
    );
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

    const routed = runtime.route.mock.calls[0]?.[0] as EventRecord<"message">;
    expect(routed).toMatchObject({
      type: "message",
      platform: "test",
      selfId: "bot-1",
      timestamp: 1,
      channel: { id: "room-1", type: 1, name: "Direct channel" },
      guild: { id: "guild-1", name: "Guild" },
      member: { nick: "Member" },
      user: { id: "user-1", name: "Event user" },
      message: { id: "message-1", content: 'hello <at id="bot-1"/>' },
    });
    expect((routed.message as { elements?: unknown }).elements).toEqual(
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
    ["platform", (value: EventRecord<"message">) => ({ ...value, platform: "other" })],
    ["selfId", (value: EventRecord<"message">) => ({ ...value, selfId: "other" })],
    [
      "channel.id",
      (value: EventRecord<"message">) => ({ ...value, channel: { ...value.channel, id: "other" } }),
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
      resolve: async () =>
        ({
          ...record(),
          platform: "notice",
          type: "delivery.failed",
          delivery: {
            turnId: "turn-1",
            messageId: "message-1",
            error: { name: "Error", message: "notice" },
          },
        }) as EventRecord,
    });
    const message = session();
    await middleware()(message as never, async () => undefined);
    internal()(message as never);
    internal()(
      session({ platform: "notice", event: { type: "notice" }, type: "notice" }) as never,
    );
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
