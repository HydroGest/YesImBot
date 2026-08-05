import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Context } from "@koishijs/core";
import { describe, expect, it, vi } from "vitest";

vi.mock("koishi", async () => import("@koishijs/core"));

import "./helpers/setup.js";
import { createJsonlStorage } from "@yesimbot/agent-runtime";
import { h } from "koishi";

import type { PacingConfig } from "../src/config.js";
import { deliverOutput } from "../src/delivery.js";
import { Gateway } from "../src/gateway/index.js";
import type { MessageRecord } from "../src/messages.js";
import { RuntimeManager } from "../src/runtime/index.js";
import { ChannelStorage } from "../src/runtime/storage.js";
import { deferred, defaultMessageRecord, delivery, outputs, session } from "./helpers/index.js";

function runResult(...content: string[]) {
  const localDelivery = {
    signal: new AbortController().signal,
    onDelivered: vi.fn(async () => undefined),
    fail: vi.fn(async () => undefined),
  };
  return {
    result: {
      kind: "run" as const,
      eventId: "event-1",
      turnId: "turn-1",
      output: (async function* () {
        yield {
          turnId: "turn-1",
          messageId: "assistant-1",
          segments: content.map((text) => [h.text(text)]),
        };
      })(),
      delivery: localDelivery,
    },
    delivery: localDelivery,
  };
}

describe("deliverOutput", () => {
  it("sends structured segments in produced order and acknowledges the first success", async () => {
    const { result, delivery: localDelivery } = runResult("first", "second");
    const send = vi.fn(async () => []);
    await deliverOutput({
      record: defaultMessageRecord(),
      result,
      pacing: { charactersPerSecond: 8, maxTotalDelayMs: 60_000 },
      send,
      warn: vi.fn(),
    });
    expect(send).toHaveBeenNthCalledWith(1, [h.text("first")]);
    expect(send).toHaveBeenNthCalledWith(2, [h.text("second")]);
    expect(localDelivery.onDelivered).toHaveBeenCalledOnce();
  });

  it("writes one delivery.failed feedback and stops after the first rejected send", async () => {
    const { result, delivery: localDelivery } = runResult("first", "second");
    const send = vi.fn().mockRejectedValueOnce(new Error("offline"));
    await deliverOutput({
      record: defaultMessageRecord(),
      result,
      pacing: { charactersPerSecond: 8, maxTotalDelayMs: 60_000 },
      send,
      warn: vi.fn(),
    });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith([h.text("first")]);
    expect(localDelivery.onDelivered).not.toHaveBeenCalled();
    expect(localDelivery.fail).toHaveBeenCalledOnce();
    expect(localDelivery.fail.mock.calls[0]?.[0]).toMatchObject({
      eventType: "delivery.failed",
      platform: "test",
      selfId: "bot-1",
      channel: { id: "room-1" },
      delivery: {
        turnId: "turn-1",
        messageId: "assistant-1",
        segmentIndex: 1,
        segmentTotal: 2,
        error: { name: "Error", message: "offline" },
      },
      text: expect.stringContaining("offline"),
    });
  });

  it("does not send or fail when the signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const { result, delivery: localDelivery } = runResult("first");
    result.delivery.signal = controller.signal;
    const send = vi.fn(async () => []);
    await deliverOutput({
      record: defaultMessageRecord(),
      result,
      pacing: { charactersPerSecond: 8, maxTotalDelayMs: 60_000 },
      send,
      warn: vi.fn(),
    });
    expect(send).not.toHaveBeenCalled();
    expect(localDelivery.onDelivered).not.toHaveBeenCalled();
    expect(localDelivery.fail).not.toHaveBeenCalled();
  });

  it("paces one-character segments at the 250 ms minimum after the budget is exhausted", async () => {
    vi.useFakeTimers();
    try {
      const { result, delivery: localDelivery } = runResult("a", "a");
      const send = vi.fn(async () => []);
      const delivering = deliverOutput({
        record: defaultMessageRecord(),
        result,
        pacing: { charactersPerSecond: 10, maxTotalDelayMs: 150 },
        send,
        warn: vi.fn(),
      });

      await vi.advanceTimersByTimeAsync(249);
      expect(send).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(send).toHaveBeenCalledOnce();
      await vi.advanceTimersByTimeAsync(249);
      expect(send).toHaveBeenCalledOnce();
      await vi.advanceTimersByTimeAsync(1);
      await delivering;

      expect(send).toHaveBeenCalledTimes(2);
      expect(localDelivery.onDelivered).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });
});

type Route = (record: MessageRecord) => Promise<unknown>;

function createGateway(
  route: Route,
  logger = { warn: vi.fn() },
  deliveryOptions: {
    readonly pacing?: PacingConfig;
  } = {},
) {
  const ctx = new Context();
  Object.assign(ctx, { database: { get: vi.fn(async () => [{ assignee: "bot-1" }]) } });
  vi.spyOn(ctx, "middleware").mockReturnValue(vi.fn() as never);
  vi.spyOn(ctx, "on").mockReturnValue(vi.fn() as never);
  vi.spyOn(ctx, "logger").mockReturnValue(logger as never);
  const gateway = new Gateway(
    ctx,
    {
      allowedChannels: [{ platform: "*", channelId: "*" }],
      pacing: deliveryOptions.pacing ?? { charactersPerSecond: 8, maxTotalDelayMs: 60_000 },
      logLevel: 2,
    },
    {
      runtime: { route } as never,
      assets: { createStore: vi.fn(() => ({ get: vi.fn(), put: vi.fn(), clear: vi.fn() })) },
      ready: async () => undefined,
    },
  );
  gateway.registerTranslator({
    platform: "test",
    translate: async (base, input) => ({
      ...base,
      messageId: input.messageId,
      elements: input.elements ?? [],
    }),
  });
  return { gateway, logger };
}

function createIntegratedGateway(basePath: string) {
  const ctx = new Context();
  const storage = new ChannelStorage(ctx, { basePath });
  const assets = {
    createStore: vi.fn(() => ({ clear: vi.fn(async () => undefined), get: vi.fn(), put: vi.fn() })),
  };
  const artifacts = {
    createStore: vi.fn(() => ({ clear: vi.fn(async () => undefined), forTool: vi.fn(), open: vi.fn() })),
  };
  const model = { modelId: "test-model" };
  const resolveChatModel = vi.fn(() => ({ model, providerId: "test", entry: {} }));
  const modelService = { resolveChatModel } as never;
  const database = { get: vi.fn(async () => [{ assignee: "bot-1" }]) };
  Object.assign(ctx, { database });
  ctx.bots.push({ platform: "test", selfId: "bot-1", sendMessage: vi.fn() } as never);
  const config = {
    basePath,
    chatModel: "test:model",
    visionModel: undefined,
    logLevel: 2,
    allowedChannels: [],
    imageInput: false,
    will: { engine: "routing", direct: "trigger", mention: "trigger", group: "wait" },
    reply: {
      pacing: { charactersPerSecond: 8, maxTotalDelayMs: 60_000 },
      customInnerThought: false,
    },
    session: {
      compact: { threshold: 0.9, charTokenRatio: 1.8, minMessages: 20, maxFailures: 3, model: undefined },
      idle: { timeout: 0 },
    },
  };
  const manager = new RuntimeManager(
    ctx,
    modelService,
    assets as never,
    artifacts as never,
    storage,
    config,
    new Set(),
    new Map(),
  );
  const gateway = new Gateway(
    ctx,
    {
      allowedChannels: [{ platform: "test", channelId: "room-1" }],
      pacing: { charactersPerSecond: 8, maxTotalDelayMs: 60_000 },
      logLevel: 2,
    },
    { runtime: manager, assets: assets as never, ready: () => storage.start() },
  );
  gateway.registerTranslator({
    platform: "test",
    translate: async (base, input) => ({
      ...base,
      messageId: input.messageId,
      elements: input.elements ?? [],
    }),
  });
  return { gateway, manager, storage };
}

describe("Gateway passive delivery", () => {
  it("persists current messages and sibling events through restart without reading old storage", async () => {
    const basePath = await mkdtemp(join(tmpdir(), "yesimbot-gateway-integration-"));
    const oldDirectory = join(basePath, "channels", "a5vnf2ijd75c2ibyo2s5czdir4");
    const oldJsonl = join(oldDirectory, "sessions", "messages.jsonl");
    const oldPayload = '{"type":"yesimbot.event","data":{"message":{"content":"old"}}}\n';
    await mkdir(join(oldDirectory, "sessions"), { recursive: true });
    await writeFile(oldJsonl, oldPayload, "utf8");

    const first = createIntegratedGateway(basePath);
    await first.gateway.handle(session() as never);
    await first.manager.route({
      eventType: "delivery.failed",
      platform: "test",
      selfId: "bot-1",
      timestamp: 2,
      channel: { id: "room-1", type: 0 },
      delivery: {
        turnId: "turn-1",
        messageId: "assistant-1",
        segmentIndex: 1,
        segmentTotal: 1,
        error: { name: "Error", message: "offline" },
      },
      text: "Delivery failed",
    });
    await first.manager.stop();

    const readableDirectory = join(basePath, "channels", "shared-test-room%2d%1");
    const sessionsDir = join(readableDirectory, "sessions");
    const sessionFiles = (await import("node:fs/promises")).readdir(sessionsDir);
    const activeSessionFile = (await sessionFiles)
      .filter((f) => f.endsWith(".jsonl") && f !== "messages.jsonl")
      .sort()
      .at(-1)!;
    const currentJsonl = join(sessionsDir, activeSessionFile);
    const firstEntries = await createJsonlStorage(currentJsonl).read();
    const firstInput = firstEntries[0]?.type === "message" ? firstEntries[0].data : undefined;
    const eventInput = firstEntries[1]?.type === "message" ? firstEntries[1].data : undefined;

    expect(firstInput).toMatchObject({
      type: "yesimbot.message",
      data: { messageId: "message-1", elements: expect.any(Array) },
    });
    expect(eventInput).toMatchObject({
      type: "yesimbot.event",
      data: { eventType: "delivery.failed", text: "Delivery failed" },
    });
    expect(eventInput?.data).not.toHaveProperty("messageId");
    expect(eventInput?.data).not.toHaveProperty("elements");
    expect(await readFile(oldJsonl, "utf8")).toBe(oldPayload);
    await expect(readFile(join(basePath, "channels.json"), "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });

    const restarted = createIntegratedGateway(basePath);
    await restarted.gateway.handle(session() as never);
    const replay = await createJsonlStorage(currentJsonl).read();
    expect(replay).toHaveLength(3);
    expect(await readFile(oldJsonl, "utf8")).toBe(oldPayload);
    await restarted.manager.stop();
    await rm(basePath, { recursive: true, force: true });
  });

  it("delivers a two-segment ReplyPlan in order through the live Gateway Session", async () => {
    const binding = delivery();
    const route = vi.fn(async () => ({
      kind: "run" as const,
      eventId: "event-1",
      turnId: "turn-1",
      output: outputs("first", "second"),
      delivery: binding,
    }));
    const send = vi.fn().mockResolvedValueOnce(["receipt-1"]).mockResolvedValueOnce([]);
    const { gateway } = createGateway(route);

    const inbound = session({ send });
    await gateway.handle(inbound as never);

    expect(send).toHaveBeenNthCalledWith(1, [h.text("first")]);
    expect(send).toHaveBeenNthCalledWith(2, [h.text("second")]);
    expect(route).toHaveBeenCalledOnce();
    expect(binding.onDelivered).toHaveBeenCalledOnce();
  });

  it("keeps sending at the minimum interval after the host delivery budget is exhausted", async () => {
    vi.useFakeTimers();
    try {
      const binding = delivery();
      const routed = deferred();
      const route = vi.fn(async () => {
        routed.resolve();
        return {
          kind: "run" as const,
          eventId: "event-1",
          turnId: "turn-1",
          output: (async function* () {
            yield { turnId: "turn-1", messageId: "assistant-1", segments: [[h.text("a")]] };
            yield { turnId: "turn-1", messageId: "assistant-2", segments: [[h.text("a")]] };
          })(),
          delivery: binding,
        };
      });
      const send = vi.fn(async () => []);
      const { gateway } = createGateway(route, undefined, {
        pacing: { maxTotalDelayMs: 150, charactersPerSecond: 10 },
      });
      const handling = gateway.handle(session({ send }) as never);

      await routed.promise;

      await vi.advanceTimersByTimeAsync(249);
      expect(send).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(send).toHaveBeenCalledOnce();
      await vi.advanceTimersByTimeAsync(249);
      expect(send).toHaveBeenCalledOnce();
      await vi.advanceTimersByTimeAsync(1);
      await handling;

      expect(send).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("stops at the first rejected segment without retrying or duplicating later sends", async () => {
    const binding = delivery();
    const route = vi.fn(async () => ({
      kind: "run" as const,
      eventId: "event-1",
      turnId: "turn-1",
      output: outputs("first", "second"),
      delivery: binding,
    }));
    const offline = Object.assign(new Error("offline"), { code: "ECONNRESET" });
    const send = vi.fn().mockRejectedValueOnce(offline).mockResolvedValueOnce(["receipt-2"]);
    const { gateway } = createGateway(route);

    const inbound = session({ send });
    await gateway.handle(inbound as never);

    expect(send).toHaveBeenNthCalledWith(1, [h.text("first")]);
    expect(send).toHaveBeenCalledTimes(1);
    expect(route).toHaveBeenCalledOnce();
    expect(binding.onDelivered).not.toHaveBeenCalled();
    expect(route.mock.calls[0]?.[0]).not.toHaveProperty("send");
    expect(route.mock.calls[0]?.[0]).not.toBe(inbound);
    expect(binding.fail.mock.calls[0]?.[0]).toMatchObject({
      eventType: "delivery.failed",
      platform: "test",
      selfId: "bot-1",
      channel: { id: "room-1" },
      delivery: {
        turnId: "turn-1",
        messageId: "assistant-1",
        segmentIndex: 1,
        segmentTotal: 2,
        error: { name: "Error", message: "offline", code: "ECONNRESET" },
      },
      text: expect.stringContaining("offline"),
    });
  });

  it("does not recursively route delivery-failure completion output", async () => {
    const binding = delivery();
    const route = vi.fn(async () => ({
      kind: "run" as const,
      eventId: "event-1",
      turnId: "turn-1",
      output: outputs("first"),
      delivery: binding,
    }));
    const send = vi.fn().mockRejectedValueOnce(new Error("offline"));
    const { gateway } = createGateway(route);

    await gateway.handle(session({ send }) as never);

    expect(send).toHaveBeenCalledTimes(1);
    expect(route).toHaveBeenCalledOnce();
    expect(binding.fail).toHaveBeenCalledOnce();
  });

  it("stops remaining segments when failure persistence rejects", async () => {
    const binding = delivery();
    binding.fail.mockRejectedValueOnce(new Error("history unavailable"));
    const route = vi.fn(async () => ({
      kind: "run" as const,
      eventId: "event-1",
      turnId: "turn-1",
      output: outputs("first", "second"),
      delivery: binding,
    }));
    const send = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce([]);
    const { gateway } = createGateway(route, {
      warn: vi.fn(() => {
        throw new Error("logger unavailable");
      }),
    });

    await expect(gateway.handle(session({ send }) as never)).resolves.toBeUndefined();

    expect(send).toHaveBeenNthCalledWith(1, [h.text("first")]);
    expect(send).toHaveBeenCalledTimes(1);
    expect(route).toHaveBeenCalledOnce();
  });

  it("does not send when the runtime cancelled before the segment delay", async () => {
    const controller = new AbortController();
    controller.abort();
    const binding = delivery(controller.signal);
    const route = vi.fn(async () => ({
      kind: "run" as const,
      eventId: "event-1",
      turnId: "turn-1",
      output: outputs("first"),
      delivery: binding,
    }));
    const send = vi.fn(async () => []);
    vi.useFakeTimers();
    try {
      const { gateway } = createGateway(route);
      await gateway.handle(session({ send }) as never);

      expect(send).not.toHaveBeenCalled();
      expect(binding.onDelivered).not.toHaveBeenCalled();
      expect(binding.fail).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("abandons an in-progress delay when the runtime cancels the turn", async () => {
    const controller = new AbortController();
    const binding = delivery(controller.signal);
    const route = vi.fn(async () => ({
      kind: "run" as const,
      eventId: "event-1",
      turnId: "turn-1",
      output: outputs("first", "second"),
      delivery: binding,
    }));
    const send = vi.fn(async () => []);
    vi.useFakeTimers();
    try {
      const { gateway } = createGateway(route);
      const handling = gateway.handle(session({ send }) as never);

      await vi.advanceTimersByTimeAsync(0);
      controller.abort();
      await handling;

      expect(send).not.toHaveBeenCalled();
      expect(binding.onDelivered).not.toHaveBeenCalled();
      expect(binding.fail).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("checks cancellation again after the delay and before sending", async () => {
    const controller = new AbortController();
    const binding = delivery(controller.signal);
    const route = vi.fn(async () => ({
      kind: "run" as const,
      eventId: "event-1",
      turnId: "turn-1",
      output: outputs("first"),
      delivery: binding,
    }));
    const send = vi.fn(async () => []);
    vi.useFakeTimers();
    try {
      setTimeout(() => controller.abort(), 250);
      const { gateway } = createGateway(route);
      const handling = gateway.handle(session({ send }) as never);

      await vi.advanceTimersByTimeAsync(250);
      await handling;

      expect(send).not.toHaveBeenCalled();
      expect(binding.onDelivered).not.toHaveBeenCalled();
      expect(binding.fail).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps a no-control reply as one unchanged platform send", async () => {
    const binding = delivery();
    const route = vi.fn(async () => ({
      kind: "run" as const,
      eventId: "event-1",
      turnId: "turn-1",
      output: outputs("  ordinary reply\n"),
      delivery: binding,
    }));
    const send = vi.fn(async () => []);
    const { gateway } = createGateway(route);

    await gateway.handle(session({ send }) as never);

    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith([h.text("  ordinary reply\n")]);
    expect(binding.onDelivered).toHaveBeenCalledOnce();
  });

  it("uses Session.send rather than Koishi's queued helper for passive delivery", async () => {
    const binding = delivery();
    const route = vi.fn(async () => ({
      kind: "run" as const,
      eventId: "event-1",
      turnId: "turn-1",
      output: outputs("ordinary reply"),
      delivery: binding,
    }));
    const send = vi.fn(async () => []);
    const sendQueued = vi.fn(async () => []);
    const inbound = { ...session({ send }), sendQueued };
    const { gateway } = createGateway(route);

    await gateway.handle(inbound as never);

    expect(send).toHaveBeenCalledOnce();
    expect(sendQueued).not.toHaveBeenCalled();
  });

  it("retains the originating Session only while consuming its active output", async () => {
    let release!: () => void;
    const finished = new Promise<void>((resolve) => {
      release = resolve;
    });
    const route = vi.fn(async () => ({
      kind: "run" as const,
      eventId: "event-1",
      turnId: "turn-1",
      output: (async function* () {
        yield { turnId: "turn-1", messageId: "assistant-1", segments: [[h.text("first")]] };
        await finished;
      })(),
      delivery: delivery(),
    }));
    const send = vi.fn(async () => []);
    const { gateway } = createGateway(route);
    const handling = gateway.handle(session({ send }) as never);
    await vi.waitFor(() => expect(send).toHaveBeenCalledWith([h.text("first")]));
    let drained = false;
    const draining = gateway.drain().then(() => {
      drained = true;
    });

    await Promise.resolve();
    expect(drained).toBe(false);
    release();
    await handling;
    await draining;
    expect(drained).toBe(true);
  });
});
