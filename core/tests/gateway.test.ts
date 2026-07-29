import { describe, expect, it, vi } from "vitest";

vi.mock("koishi", async () => import("@koishijs/core"));

import { h, type Session, Universal } from "koishi";

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

function containsReference(value: unknown, target: object, seen = new WeakSet<object>()): boolean {
  if (value === target) return true;
  if (typeof value !== "object" || value === null || seen.has(value)) return false;
  seen.add(value);
  return Object.values(value).some((child) => containsReference(child, target, seen));
}

function messageDraft(overrides: Partial<ResolvedMessageDraft> = {}): ResolvedMessageDraft {
  return { kind: "message", messageId: "message-1", elements: [h.text("hello")], ...overrides };
}

function createGateway(
  options: { readonly allowedChannels?: readonly ChannelAllowRule[]; readonly ready?: () => Promise<void> } = {},
) {
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
      ready: options.ready ?? (async () => undefined),
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
  const direct: ChannelScope = { ...shared, isDirect: true };

  it("denies missing and empty rules", () => {
    expect(matchesAllowedChannel(shared, undefined)).toBe(false);
    expect(matchesAllowedChannel(shared, [])).toBe(false);
  });

  it("matches exact platform and channel values", () => {
    expect(matchesAllowedChannel(shared, [{ platform: "test", channelId: "room-1" }])).toBe(true);
    expect(matchesAllowedChannel(shared, [{ platform: "test", channelId: "other" }])).toBe(false);
  });

  it("matches platform and channel wildcards", () => {
    expect(matchesAllowedChannel(shared, [{ platform: "*", channelId: "room-1" }])).toBe(true);
    expect(matchesAllowedChannel(shared, [{ platform: "test", channelId: "*" }])).toBe(true);
  });

  it("matches omitted directness for direct and shared channels", () => {
    const rules = [{ platform: "test", channelId: "room-1" }];
    expect(matchesAllowedChannel(shared, rules)).toBe(true);
    expect(matchesAllowedChannel(direct, rules)).toBe(true);
  });

  it("matches direct-only and shared-only rules", () => {
    expect(matchesAllowedChannel(direct, [{ platform: "test", channelId: "*", isDirect: true }])).toBe(true);
    expect(matchesAllowedChannel(shared, [{ platform: "test", channelId: "*", isDirect: true }])).toBe(false);
    expect(matchesAllowedChannel(shared, [{ platform: "test", channelId: "*", isDirect: false }])).toBe(true);
    expect(matchesAllowedChannel(direct, [{ platform: "test", channelId: "*", isDirect: false }])).toBe(false);
  });

  it("uses OR semantics across rules and defaults configuration to no access", () => {
    expect(matchesAllowedChannel(shared, [
      { platform: "other", channelId: "room-1" },
      { platform: "test", channelId: "room-1" },
    ])).toBe(true);
    expect(Config({ basePath: "data", chatModel: "model" }).allowedChannels).toEqual([]);
  });
});

describe("Gateway", () => {
  it("rejects an unmatched scope before readiness or downstream work", async () => {
    const ready = vi.fn(async () => undefined);
    const { gateway, assets, runtime, database } = createGateway({ allowedChannels: [], ready });
    const resolve = vi.fn(async () => messageDraft());
    gateway.register({ platform: "test", resolve });

    await gateway.handle(session());

    expect(ready).not.toHaveBeenCalled();
    expect(database.get).not.toHaveBeenCalled();
    expect(assets.createStore).not.toHaveBeenCalled();
    expect(resolve).not.toHaveBeenCalled();
    expect(runtime.route).not.toHaveBeenCalled();
  });

  it("routes an admitted empty-element message as a complete host record", async () => {
    const { gateway, runtime } = createGateway();
    gateway.register({ platform: "test", resolve: async () => messageDraft({ elements: [] }) });

    await gateway.handle(session());

    expect(runtime.route).toHaveBeenCalledWith(expect.objectContaining({
      messageId: "message-1",
      elements: [],
      platform: "test",
      selfId: "bot-1",
      channel: expect.objectContaining({ id: "room-1", type: Universal.Channel.Type.TEXT }),
      user: { id: "user-1", name: "User" },
    }));
  });

  it("waits for readiness before shared admission and resolver work", async () => {
    let release!: () => void;
    const ready = new Promise<void>((resolve) => { release = resolve; });
    const { gateway, database, assets, runtime } = createGateway({ ready: () => ready });
    const resolve = vi.fn(async () => messageDraft());
    gateway.register({ platform: "test", resolve });

    const handling = gateway.handle(session());
    await Promise.resolve();
    expect(database.get).not.toHaveBeenCalled();
    expect(assets.createStore).not.toHaveBeenCalled();
    expect(resolve).not.toHaveBeenCalled();
    expect(runtime.route).not.toHaveBeenCalled();

    release();
    await handling;
  });

  it("queries the shared assignee once before resolving", async () => {
    const { gateway, database } = createGateway();
    const resolve = vi.fn(async () => messageDraft());
    gateway.register({ platform: "test", resolve });

    await gateway.handle(session());

    expect(database.get).toHaveBeenCalledOnce();
    expect(database.get.mock.invocationCallOrder[0]).toBeLessThan(resolve.mock.invocationCallOrder[0] ?? Infinity);
  });

  it.each([[], [{ assignee: "" }], [{ assignee: "other" }]])(
    "rejects an unavailable shared assignee before resolver work",
    async (rows) => {
      const { gateway, assets, runtime, database } = createGateway();
      const resolve = vi.fn(async () => messageDraft());
      gateway.register({ platform: "test", resolve });
      database.get.mockResolvedValue(rows);

      await gateway.handle(session());

      expect(assets.createStore).not.toHaveBeenCalled();
      expect(resolve).not.toHaveBeenCalled();
      expect(runtime.route).not.toHaveBeenCalled();
    },
  );

  it("rejects shared database failures before resolver work", async () => {
    const { gateway, assets, runtime, database } = createGateway();
    const resolve = vi.fn(async () => messageDraft());
    gateway.register({ platform: "test", resolve });
    database.get.mockRejectedValue(new Error("database unavailable"));

    await gateway.handle(session());

    expect(assets.createStore).not.toHaveBeenCalled();
    expect(resolve).not.toHaveBeenCalled();
    expect(runtime.route).not.toHaveBeenCalled();
  });

  it("skips assignee lookup for direct Sessions and preserves direct classification", async () => {
    const { gateway, database, assets, runtime } = createGateway();
    gateway.register({ platform: "test", resolve: async () => messageDraft({ channel: { name: "Direct room" } }) });

    await gateway.handle(session({ isDirect: true }));

    expect(database.get).not.toHaveBeenCalled();
    expect(assets.createStore).toHaveBeenCalledWith(expect.objectContaining({ isDirect: true }));
    expect(runtime.route).toHaveBeenCalledWith(expect.objectContaining({
      channel: { id: "room-1", type: Universal.Channel.Type.DIRECT, name: "Direct room" },
    }));
  });

  it("passes the admitted Scope Store to exactly one resolver call without rewriting Draft elements", async () => {
    const { gateway, assets, store, runtime } = createGateway();
    const image = h("img", { src: "https://resolver.example/original.png" });
    const resolve = vi.fn(async (input: Session, received: AssetStore) => {
      expect(input.messageId).toBe("message-1");
      expect(received).toBe(store);
      return messageDraft({ elements: [image] });
    });
    gateway.register({ platform: "test", resolve });

    await gateway.handle(session());

    expect(assets.createStore).toHaveBeenCalledWith({
      platform: "test", selfId: "bot-1", channelId: "room-1", isDirect: false,
    });
    expect(resolve).toHaveBeenCalledOnce();
    expect(runtime.route).toHaveBeenCalledWith(expect.objectContaining({ elements: [image] }));
  });

  it("preserves a resolver-provided channel name while keeping envelope fields host-owned", async () => {
    const { gateway, runtime } = createGateway();
    gateway.register({
      platform: "test",
      resolve: async () => ({ ...messageDraft({ channel: { name: "Room" } }), platform: "other", selfId: "other" }) as never,
    });

    await gateway.handle(session());

    expect(runtime.route).toHaveBeenCalledWith(expect.objectContaining({
      platform: "test", selfId: "bot-1", channel: expect.objectContaining({ id: "room-1", name: "Room" }),
    }));
  });

  it("disposes only the resolver instance it registered and closes admission", async () => {
    const { gateway, runtime } = createGateway();
    const first = { platform: "test", resolve: vi.fn(async () => messageDraft()) } satisfies SessionResolver;
    const second = { platform: "test", resolve: vi.fn(async () => messageDraft()) } satisfies SessionResolver;
    const disposeFirst = gateway.register(first);

    expect(() => gateway.register(second)).toThrow('Resolver for platform "test" is already registered');
    disposeFirst();
    const disposeSecond = gateway.register(second);
    disposeFirst();
    expect(() => gateway.register(first)).toThrow('Resolver for platform "test" is already registered');
    disposeSecond();
    expect(() => gateway.register(first)).not.toThrow();

    gateway.close();
    await gateway.handle(session());
    expect(runtime.route).not.toHaveBeenCalled();
  });

  it("constructs declaration-merged event records without Session residue", async () => {
    const { gateway, runtime } = createGateway();
    const draft: ResolvedEventDraft<"test.notice"> = {
      kind: "event", eventType: "test.notice", text: "Notice", targetId: "target",
    };
    gateway.register({ platform: "test", resolve: async () => draft });

    await gateway.handle(session({
      type: "notice",
      messageId: undefined,
      event: { type: "notice", _data: { raw: true }, guild: { id: "guild-1" } },
    }));

    const routed = runtime.route.mock.calls[0]?.[0];
    expect(routed).toMatchObject({ eventType: "test.notice", text: "Notice", targetId: "target" });
    expect(routed).not.toHaveProperty("_data");
    expect(routed).not.toHaveProperty("guild");
  });

  it("uses Session resources while Scope owns envelope fields", async () => {
    const { gateway, runtime } = createGateway();
    gateway.register({ platform: "test", resolve: async () => messageDraft() });
    await gateway.handle(session({
      isDirect: true,
      event: { type: "message", channel: { id: "stale", type: Universal.Channel.Type.DIRECT, name: "Direct channel" }, user: { name: "Event user" } },
    }));

    expect(runtime.route).toHaveBeenCalledWith(expect.objectContaining({
      platform: "test", selfId: "bot-1", channel: { id: "room-1", type: Universal.Channel.Type.DIRECT, name: "Direct channel" },
      user: { id: "user-1", name: "Event user" },
    }));
  });

  it("skips an unregistered platform and authoritative null or thrown resolver results", async () => {
    const missing = createGateway();
    await missing.gateway.handle(session());
    expect(missing.assets.createStore).not.toHaveBeenCalled();
    expect(missing.runtime.route).not.toHaveBeenCalled();

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

  it("deduplicates middleware and internal message admission while routing non-message internally", async () => {
    const { gateway, middleware, internal, runtime } = createGateway();
    gateway.register({ platform: "test", resolve: async (input) =>
      input.type === "notice" ? { kind: "event", eventType: "test.notice", text: "Notice", targetId: "target" } : messageDraft(),
    });
    const input = session();

    await middleware()(input, async () => undefined);
    internal()(input);
    internal()(session({ type: "notice", messageId: undefined, event: { type: "notice" } }));
    await gateway.drain();

    expect(runtime.route).toHaveBeenCalledTimes(2);
  });

  it("routes records without retaining the active Session", async () => {
    const { gateway, runtime } = createGateway();
    const input = session();
    gateway.register({ platform: "test", resolve: async () => messageDraft() });

    await gateway.handle(input);

    expect(containsReference(runtime.route.mock.calls[0]?.[0], input)).toBe(false);
  });
});
