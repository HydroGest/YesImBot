import { describe, expect, it, vi } from "vitest";

vi.mock("koishi", async () => import("@koishijs/core"));

import { h, type Session, Universal, Context } from "koishi";

import type { AssetStore } from "../src/asset.js";
import { Config } from "../src/config.js";
import {
  Gateway,
  matchesAllowedChannel,
  type ChannelAllowRule,
  type PlatformTranslator,
} from "../src/gateway/index.js";
import { assembleEvent, type RecordBase, type EventRecord, type MessageRecord } from "../src/messages.js";
import type { ChannelScope } from "../src/runtime/storage.js";

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

function messageRecord(base: RecordBase, overrides: Partial<MessageRecord> = {}): MessageRecord {
  return { ...base, messageId: "message-1", elements: [h.text("hello")], ...overrides };
}

function createGateway(
  options: {
    readonly allowedChannels?: readonly ChannelAllowRule[];
    readonly ready?: () => Promise<void>;
  } = {},
) {
  const runtime = { route: vi.fn(async () => ({ kind: "wait", eventId: "event-1" })) };
  const store: AssetStore = {
    put: vi.fn(async () => h("img", { id: "0123456789abcdef0123456789abcdef" })),
    get: vi.fn(),
    clear: vi.fn(async () => undefined),
  };
  const assets = { createStore: vi.fn(() => store) };
  const database = { get: vi.fn(async () => [{ assignee: "bot-1" }]) };
  const gatewayLogger = { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() };
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
    logger: vi.fn().mockReturnValue(gatewayLogger),
  };
  return {
    gateway: new Gateway(
      ctx as never,
      {
        allowedChannels: options.allowedChannels ?? [{ platform: "*", channelId: "*" }],
        pacing: { charactersPerSecond: 10, maxTotalDelayMs: 1000 },
        logLevel: 2,
      },
      {
        runtime: runtime as never,
        assets,
        ready: options.ready ?? (async () => undefined),
      },
    ),
    runtime,
    store,
    assets,
    database,
    logger: gatewayLogger,
    middleware: () => middleware!,
    internal: () => internal!,
  };
}

describe("Channel allowlist", () => {
  const shared: ChannelScope = {
    type: "shared",
    platform: "test",
    selfId: "bot-1",
    channelId: "room-1",
  };
  const direct: ChannelScope = { ...shared, type: "direct" };

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
    expect(
      matchesAllowedChannel(shared, [
        { platform: "other", channelId: "room-1" },
        { platform: "test", channelId: "room-1" },
      ]),
    ).toBe(true);
    expect(Config({ basePath: "data", chatModel: "model" }).allowedChannels).toEqual([]);
  });
});

describe("Gateway", () => {
  it("rejects an unmatched scope before readiness or downstream work", async () => {
    const ready = vi.fn(async () => undefined);
    const { gateway, assets, runtime, database } = createGateway({ allowedChannels: [], ready });
    const translate = vi.fn(async (base: RecordBase) => messageRecord(base));
    gateway.registerTranslator({ platform: "test", translate });

    await gateway.handle(session());

    expect(ready).not.toHaveBeenCalled();
    expect(database.get).not.toHaveBeenCalled();
    expect(assets.createStore).not.toHaveBeenCalled();
    expect(translate).not.toHaveBeenCalled();
    expect(runtime.route).not.toHaveBeenCalled();
  });

  it("routes an admitted empty-element message as a complete host record", async () => {
    const { gateway, runtime } = createGateway();
    gateway.registerTranslator({
      platform: "test",
      translate: async (base) => messageRecord(base, { elements: [] }),
    });

    await gateway.handle(session());

    expect(runtime.route).toHaveBeenCalledWith(
      expect.objectContaining({
        messageId: "message-1",
        elements: [],
        platform: "test",
        selfId: "bot-1",
        channel: expect.objectContaining({ id: "room-1", type: Universal.Channel.Type.TEXT }),
        user: { id: "user-1", name: "User" },
      }),
    );
  });

  it("waits for readiness before shared admission and resolver work", async () => {
    let release!: () => void;
    const ready = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { gateway, database, assets, runtime } = createGateway({ ready: () => ready });
    const translate = vi.fn(async (base: RecordBase) => messageRecord(base));
    gateway.registerTranslator({ platform: "test", translate });

    const handling = gateway.handle(session());
    await Promise.resolve();
    expect(database.get).not.toHaveBeenCalled();
    expect(assets.createStore).not.toHaveBeenCalled();
    expect(translate).not.toHaveBeenCalled();
    expect(runtime.route).not.toHaveBeenCalled();

    release();
    await handling;
  });

  it("queries the shared assignee once before resolving", async () => {
    const { gateway, database } = createGateway();
    const translate = vi.fn(async (base: RecordBase) => messageRecord(base));
    gateway.registerTranslator({ platform: "test", translate });

    await gateway.handle(session());

    expect(database.get).toHaveBeenCalledOnce();
    expect(database.get.mock.invocationCallOrder[0]).toBeLessThan(translate.mock.invocationCallOrder[0] ?? Infinity);
  });

  it.each([[], [{ assignee: "" }], [{ assignee: "other" }]])(
    "rejects an unavailable shared assignee before resolver work",
    async (rows) => {
      const { gateway, assets, runtime, database } = createGateway();
      const translate = vi.fn(async (base: RecordBase) => messageRecord(base));
      gateway.registerTranslator({ platform: "test", translate });
      database.get.mockResolvedValue(rows);

      await gateway.handle(session());

      expect(assets.createStore).not.toHaveBeenCalled();
      expect(translate).not.toHaveBeenCalled();
      expect(runtime.route).not.toHaveBeenCalled();
    },
  );

  it("rejects shared database failures before resolver work", async () => {
    const { gateway, assets, runtime, database } = createGateway();
    const translate = vi.fn(async (base: RecordBase) => messageRecord(base));
    gateway.registerTranslator({ platform: "test", translate });
    database.get.mockRejectedValue(new Error("database unavailable"));

    await gateway.handle(session());

    expect(assets.createStore).not.toHaveBeenCalled();
    expect(translate).not.toHaveBeenCalled();
    expect(runtime.route).not.toHaveBeenCalled();
  });

  it("skips assignee lookup for direct Sessions and preserves direct classification", async () => {
    const { gateway, database, assets, runtime } = createGateway();
    gateway.registerTranslator({
      platform: "test",
      translate: async (base) => messageRecord({ ...base, channel: { ...base.channel, name: "Direct room" } }),
    });

    await gateway.handle(session({ isDirect: true }));

    expect(database.get).not.toHaveBeenCalled();
    expect(assets.createStore).toHaveBeenCalledWith(expect.objectContaining({ type: "direct" }));
    expect(runtime.route).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: { id: "room-1", type: Universal.Channel.Type.DIRECT, name: "Direct room" },
      }),
    );
  });

  it("passes the admitted Scope Store to exactly one translator call without rewriting elements", async () => {
    const { gateway, assets, store, runtime } = createGateway();
    const image = h("img", { src: "https://resolver.example/original.png" });
    const translate = vi.fn(async (base: RecordBase, input: Session, received: AssetStore) => {
      expect(input.messageId).toBe("message-1");
      expect(received).toBe(store);
      return messageRecord(base, { elements: [image] });
    });
    gateway.registerTranslator({ platform: "test", translate });

    await gateway.handle(session());

    expect(assets.createStore).toHaveBeenCalledWith({
      platform: "test",
      selfId: "bot-1",
      channelId: "room-1",
      type: "shared",
    });
    expect(translate).toHaveBeenCalledOnce();
    expect(runtime.route).toHaveBeenCalledWith(expect.objectContaining({ elements: [image] }));
  });

  it("preserves a translator-provided channel name while keeping envelope fields host-owned", async () => {
    const { gateway, runtime } = createGateway();
    gateway.registerTranslator({
      platform: "test",
      translate: async (base) => messageRecord(base, { channel: { ...base.channel, name: "Room" } }),
    });

    await gateway.handle(session());

    expect(runtime.route).toHaveBeenCalledWith(
      expect.objectContaining({
        platform: "test",
        selfId: "bot-1",
        channel: expect.objectContaining({ id: "room-1", name: "Room" }),
      }),
    );
  });

  it("disposes only the translator instance it registered and closes admission", async () => {
    const { gateway, runtime } = createGateway();
    const first = {
      platform: "test",
      translate: vi.fn(async (base: RecordBase) => messageRecord(base)),
    } satisfies PlatformTranslator;
    const second = {
      platform: "test",
      translate: vi.fn(async (base: RecordBase) => messageRecord(base)),
    } satisfies PlatformTranslator;
    const disposeFirst = gateway.registerTranslator(first);

    expect(() => gateway.registerTranslator(second)).toThrow('Translator for platform "test" is already registered');
    disposeFirst();
    const disposeSecond = gateway.registerTranslator(second);
    disposeFirst();
    expect(() => gateway.registerTranslator(first)).toThrow('Translator for platform "test" is already registered');
    disposeSecond();
    expect(() => gateway.registerTranslator(first)).not.toThrow();

    gateway.close();
    await gateway.handle(session());
    expect(runtime.route).not.toHaveBeenCalled();
  });

  it("constructs declaration-merged event records without Session residue", async () => {
    const { gateway, runtime } = createGateway();
    gateway.registerTranslator({
      platform: "test",
      translate: async (base) =>
        assembleEvent(base, {
          eventType: "test.notice",
          text: "Notice",
          targetId: "target",
        }),
    });

    await gateway.handle(
      session({
        type: "notice",
        messageId: undefined,
        event: { type: "notice", _data: { raw: true }, guild: { id: "guild-1" } },
      }),
    );

    const routed = runtime.route.mock.calls[0]?.[0];
    expect(routed).toMatchObject({ eventType: "test.notice", text: "Notice", targetId: "target" });
    expect(routed).not.toHaveProperty("user");
    expect(routed).not.toHaveProperty("guild");
  });

  it("uses Session resources while Scope owns envelope fields", async () => {
    const { gateway, runtime } = createGateway();
    gateway.registerTranslator({
      platform: "test",
      translate: async (base) => messageRecord(base),
    });
    await gateway.handle(
      session({
        isDirect: true,
        event: {
          type: "message",
          channel: { id: "stale", type: Universal.Channel.Type.DIRECT, name: "Direct channel" },
          user: { name: "Event user" },
        },
      }),
    );

    expect(runtime.route).toHaveBeenCalledWith(
      expect.objectContaining({
        platform: "test",
        selfId: "bot-1",
        channel: { id: "room-1", type: Universal.Channel.Type.DIRECT, name: "Direct channel" },
        user: { id: "user-1", name: "Event user" },
      }),
    );
  });

  it("uses default pass-through for unregistered message platforms and skips unsupported sessions", async () => {
    const missing = createGateway();
    const image = h("img", { src: "https://default.example/image" });
    await missing.gateway.handle(session({ platform: "missing", elements: [image] }));
    expect(missing.runtime.route).toHaveBeenCalledWith(
      expect.objectContaining({ platform: "missing", messageId: "message-1", elements: [image] }),
    );
    expect(missing.store.put).not.toHaveBeenCalled();

    const nonMessage = createGateway();
    await nonMessage.gateway.handle(session({ platform: "missing", type: "notice", messageId: undefined }));
    expect(nonMessage.runtime.route).not.toHaveBeenCalled();

    const missingId = createGateway();
    await missingId.gateway.handle(session({ platform: "missing", messageId: "" }));
    expect(missingId.runtime.route).not.toHaveBeenCalled();
  });

  it("selects exact platform before explicit wildcard and built-in default", async () => {
    const exact = createGateway();
    exact.gateway.registerTranslator({
      platform: "*",
      translate: async (base) => messageRecord(base, { elements: [h.text("wildcard")] }),
    });
    const exactTranslate = vi.fn(async (base: RecordBase) => messageRecord(base, { elements: [h.text("exact")] }));
    exact.gateway.registerTranslator({
      platform: "test",
      translate: exactTranslate,
    });
    await exact.gateway.handle(session());
    expect(exactTranslate).toHaveBeenCalledWith(
      expect.objectContaining({
        platform: "test",
        selfId: "bot-1",
        channel: { id: "room-1", type: Universal.Channel.Type.TEXT },
        user: { id: "user-1", name: "User" },
        timestamp: 1,
      }),
      expect.anything(),
      expect.anything(),
    );
    expect(exact.runtime.route).toHaveBeenCalledWith(expect.objectContaining({ elements: [h.text("exact")] }));

    const wildcard = createGateway();
    wildcard.gateway.registerTranslator({
      platform: "*",
      translate: async (base) => messageRecord(base, { elements: [h.text("wildcard")] }),
    });
    await wildcard.gateway.handle(session({ platform: "other" }));
    expect(wildcard.runtime.route).toHaveBeenCalledWith(expect.objectContaining({ elements: [h.text("wildcard")] }));
  });

  it("does not fall back after selected translator null or throw", async () => {
    const skipped = createGateway();
    skipped.gateway.registerTranslator({
      platform: "*",
      translate: async (base) => messageRecord(base),
    });
    skipped.gateway.registerTranslator({ platform: "test", translate: async () => null });
    await skipped.gateway.handle(session());
    expect(skipped.runtime.route).not.toHaveBeenCalled();

    const failed = createGateway();
    failed.gateway.registerTranslator({
      platform: "*",
      translate: async (base) => messageRecord(base),
    });
    failed.gateway.registerTranslator({
      platform: "test",
      translate: async () => {
        throw new Error("broken");
      },
    });
    await failed.gateway.handle(session());
    expect(failed.runtime.route).not.toHaveBeenCalled();
    expect(failed.logger.warn).toHaveBeenCalledWith(expect.objectContaining({ code: "gateway.route_failed" }));
  });

  it("deduplicates middleware and internal message admission while routing non-message internally", async () => {
    const { gateway, middleware, internal, runtime } = createGateway();
    gateway.registerTranslator({
      platform: "test",
      translate: async (base, input) =>
        input.type === "notice"
          ? assembleEvent(base, { eventType: "test.notice", text: "Notice", targetId: "target" })
          : messageRecord(base),
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
    gateway.registerTranslator({
      platform: "test",
      translate: async (base) => messageRecord(base),
    });

    await gateway.handle(input);

    expect(containsReference(runtime.route.mock.calls[0]?.[0], input)).toBe(false);
  });
});
