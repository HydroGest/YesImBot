import { describe, expect, it, vi } from "vitest";

vi.mock("koishi", async () => import("@koishijs/core"));

import { h, type Session } from "koishi";

import type { AssetStore } from "../src/asset.js";
import type { ChannelScope } from "../src/channel.js";
import { Config } from "../src/config.js";
import {
  Gateway,
  matchesAllowedChannel,
  type ChannelAllowRule,
  type SessionResolver,
} from "../src/gateway.js";
import type { ResolvedEventDraft, ResolvedMessageDraft } from "../src/input.js";

declare module "koishi-plugin-yesimbot" {
  interface EventMap {
    "test.notice": { targetId: string };
  }
}

function session(overrides: Record<string, unknown> = {}): Session {
  return {
    platform: "test",
    selfId: "bot-1",
    channelId: "room-1",
    isDirect: false,
    type: "message-created",
    userId: "user-1",
    messageId: "message-1",
    timestamp: 1,
    event: { type: "message", user: { name: "User" } },
    elements: [h.text("hello")],
    ...overrides,
  } as Session;
}

function messageDraft(): ResolvedMessageDraft {
  return { kind: "message", messageId: "message-1", elements: [h.text("hello")] };
}

function createGateway(options: { readonly allowedChannels?: readonly ChannelAllowRule[] } = {}) {
  const runtime = { route: vi.fn(async () => ({ kind: "wait", eventId: "event-1" })) };
  const store: AssetStore = {
    put: vi.fn(async () => h("img", { id: "0123456789abcdef0123456789abcdef" })),
    get: vi.fn(),
    clear: vi.fn(async () => undefined),
  };
  const assets = { createStore: vi.fn(() => store) };
  const database = { get: vi.fn(async () => [{ assignee: "bot-1" }]) };
  const logger = { warn: vi.fn() };
  let middleware: ((input: Session, next: () => Promise<unknown>) => Promise<void>) | undefined;
  let internal: ((input: Session) => void) | undefined;
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
  return {
    gateway: new Gateway({
      ctx: ctx as never,
      runtime: runtime as never,
      assets,
      ready: async () => undefined,
      allowedChannels: options.allowedChannels ?? [{ platform: "*", channelId: "*" }],
      logger,
    }),
    runtime,
    store,
    assets,
    database,
    logger,
    middleware: () => middleware!,
    internal: () => internal!,
  };
}

describe("Channel allowlist", () => {
  const shared: ChannelScope = { platform: "test", selfId: "bot-1", channelId: "room-1", isDirect: false };

  it("denies missing rules and matches exact or wildcard rules", () => {
    expect(matchesAllowedChannel(shared, undefined)).toBe(false);
    expect(matchesAllowedChannel(shared, [{ platform: "test", channelId: "room-1" }])).toBe(true);
    expect(matchesAllowedChannel(shared, [{ platform: "*", channelId: "*" }])).toBe(true);
    expect(matchesAllowedChannel(shared, [{ platform: "test", channelId: "other" }])).toBe(false);
    expect(Config({ basePath: "data", chatModel: "model" }).allowedChannels).toEqual([]);
  });
});

describe("Gateway", () => {
  it("rejects an unmatched Session before creating a Store or resolving", async () => {
    const { gateway, assets, runtime, database } = createGateway({ allowedChannels: [] });
    const resolve = vi.fn(async () => messageDraft());
    gateway.register({ platform: "test", resolve });

    await gateway.handle(session());

    expect(database.get).not.toHaveBeenCalled();
    expect(assets.createStore).not.toHaveBeenCalled();
    expect(resolve).not.toHaveBeenCalled();
    expect(runtime.route).not.toHaveBeenCalled();
  });

  it("passes the admitted Scope Store to one resolver call and seals its message draft", async () => {
    const { gateway, assets, store, runtime, database } = createGateway();
    const resolve = vi.fn(async (input: Session, received: AssetStore) => {
      expect(input.messageId).toBe("message-1");
      expect(received).toBe(store);
      return { ...messageDraft(), elements: [h("img", { id: "0123456789abcdef0123456789abcdef" })] };
    });
    gateway.register({ platform: "test", resolve });

    await gateway.handle(session());

    expect(database.get).toHaveBeenCalledOnce();
    expect(assets.createStore).toHaveBeenCalledWith({
      platform: "test", selfId: "bot-1", channelId: "room-1", isDirect: false,
    });
    expect(resolve).toHaveBeenCalledOnce();
    expect(runtime.route).toHaveBeenCalledWith(expect.objectContaining({
      platform: "test", selfId: "bot-1", messageId: "message-1",
      elements: [h("img", { id: "0123456789abcdef0123456789abcdef" })],
    }));
  });

  it("does not route when a platform has no resolver", async () => {
    const { gateway, runtime, assets } = createGateway();
    await gateway.handle(session());
    expect(assets.createStore).not.toHaveBeenCalled();
    expect(runtime.route).not.toHaveBeenCalled();
  });

  it("does not route resolver null or thrown results", async () => {
    const skipped = createGateway();
    skipped.gateway.register({ platform: "test", resolve: async () => null });
    await skipped.gateway.handle(session());
    expect(skipped.runtime.route).not.toHaveBeenCalled();

    const failed = createGateway();
    failed.gateway.register({ platform: "test", resolve: async () => { throw new Error("broken"); } });
    await failed.gateway.handle(session());
    expect(failed.runtime.route).not.toHaveBeenCalled();
    expect(failed.logger.warn).toHaveBeenCalledWith(expect.objectContaining({ code: "gateway.resolver_failed" }));
  });

  it("keeps Gateway ownership of canonical event fields", async () => {
    const { gateway, runtime } = createGateway();
    const draft: ResolvedEventDraft<"test.notice"> = {
      kind: "event", eventType: "test.notice", text: "Notice", targetId: "target",
    };
    gateway.register({ platform: "test", resolve: async () => draft });

    await gateway.handle(session({ type: "notice", messageId: undefined, event: { type: "notice" } }));

    expect(runtime.route).toHaveBeenCalledWith(expect.objectContaining({
      platform: "test", selfId: "bot-1", channel: expect.objectContaining({ id: "room-1" }),
      eventType: "test.notice", text: "Notice", targetId: "target",
    }));
  });

  it("skips assignee lookup for direct Sessions", async () => {
    const { gateway, database, runtime } = createGateway();
    gateway.register({ platform: "test", resolve: async () => messageDraft() });
    await gateway.handle(session({ isDirect: true }));
    expect(database.get).not.toHaveBeenCalled();
    expect(runtime.route).toHaveBeenCalledOnce();
  });

  it("resolves middleware messages and internal non-message Sessions once", async () => {
    const { gateway, middleware, internal, runtime } = createGateway();
    gateway.register({ platform: "test", resolve: async () => messageDraft() });
    const input = session();
    await middleware()(input, async () => undefined);
    internal()(input);
    await gateway.drain();
    expect(runtime.route).toHaveBeenCalledOnce();
  });

  it("enforces one resolver registration per platform", () => {
    const { gateway } = createGateway();
    const resolver = { platform: "test", resolve: vi.fn(async () => messageDraft()) } satisfies SessionResolver;
    gateway.register(resolver);
    expect(() => gateway.register(resolver)).toThrow('Resolver for platform "test" is already registered');
  });
});
