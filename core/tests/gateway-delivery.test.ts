import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Context } from "@koishijs/core";
import { describe, expect, it, vi } from "vitest";

vi.mock("koishi", async () => import("@koishijs/core"));

import { h } from "koishi";

import { formatInput } from "../src/event/formatter.js";
import { isInput, type InputRecord, type MessageRecord } from "../src/event/index.js";
import { Gateway } from "../src/gateway/index.js";
import { RuntimeManager } from "../src/runtime/manager.js";
import { createJsonlStorage } from "../src/runtime/storage.js";
import { ChannelStorage } from "../src/storage/index.js";

function session(send = vi.fn(async () => ["receipt-1"])) {
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
    send,
  };
}

function record(): MessageRecord {
  return {
    schemaVersion: 1,
    platform: "test",
    selfId: "bot-1",
    timestamp: 1,
    channel: { id: "room-1", type: 0 },
    user: { id: "user-1" },
    messageId: "message-1",
    elements: [h.text("hello")],
    text: "hello",
  };
}

function outputs(...content: string[]) {
  return (async function* () {
    for (const [index, value] of content.entries()) {
      yield { turnId: "turn-1", messageId: `assistant-${index + 1}`, content: value };
    }
  })();
}

function delivery() {
  return {
    fail: vi.fn(async () => ({ kind: "wait" as const, eventId: "failure-1" })),
    release: vi.fn(),
  };
}

function createGateway(route: ReturnType<typeof vi.fn>, logger = { warn: vi.fn() }) {
  const ctx = {
    middleware: vi.fn(() => vi.fn()),
    on: vi.fn(() => vi.fn()),
    database: { get: vi.fn(async () => [{ assignee: "bot-1" }]) },
  };
  const storage = new ChannelStorage("/tmp/yesimbot-gateway-delivery-test");
  return {
    gateway: new Gateway({
      ctx: ctx as never,
      runtime: { route } as never,
      assets: { put: vi.fn() },
      storage,
      allowedChannels: [{ platform: "*", channelId: "*" }],
      ready: () => storage.start(),
      logger,
    }),
    logger,
  };
}

function createIntegratedGateway(basePath: string) {
  const ctx = new Context();
  const storage = new ChannelStorage(basePath);
  const assets = { clear: vi.fn(async () => undefined), put: vi.fn(), readByAssetId: vi.fn() };
  const model = { modelId: "test-model" };
  const database = { get: vi.fn(async () => [{ assignee: "bot-1" }]) };
  Object.assign(ctx, {
    database,
    "yesimbot.model": { resolveChatModel: vi.fn(() => ({ model, entry: {} })) },
  });
  ctx.bots.push({ platform: "test", selfId: "bot-1", sendMessage: vi.fn() } as never);
  const manager = new RuntimeManager({
    ctx,
    config: { basePath, chatModel: "test:model" },
    logger: { debug: vi.fn(), warn: vi.fn() } as never,
    assets: assets as never,
    storage,
    getAgentPluginFactories: () => [],
  });
  manager.setWill(async () => ({ decide: async () => "wait" as const }));
  const gateway = new Gateway({
    ctx,
    runtime: manager,
    assets: assets as never,
    storage,
    allowedChannels: [{ platform: "test", channelId: "room-1" }],
    ready: () => storage.start(),
    logger: { warn: vi.fn() } as never,
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
      schemaVersion: 1,
      eventType: "delivery.failed",
      platform: "test",
      selfId: "bot-1",
      timestamp: 2,
      channel: { id: "room-1", type: 0 },
      delivery: {
        turnId: "turn-1",
        messageId: "assistant-1",
        error: { name: "Error", message: "offline" },
      },
      text: "Delivery failed",
    });
    await first.manager.stop();

    const readableDirectory = join(basePath, "channels", "v1-shared-test-room_1");
    const currentJsonl = join(readableDirectory, "sessions", "messages.jsonl");
    const firstEntries = await createJsonlStorage(currentJsonl).read();
    const firstInput = firstEntries[0]?.type === "message" ? firstEntries[0].data : undefined;
    const eventInput = firstEntries[1]?.type === "message" ? firstEntries[1].data : undefined;

    expect(firstInput).toMatchObject({
      type: "yesimbot.message",
      data: { messageId: "message-1", elements: expect.any(Array), text: "hello" },
    });
    expect(eventInput).toMatchObject({
      type: "yesimbot.event",
      data: { eventType: "delivery.failed", text: "Delivery failed" },
    });
    expect(eventInput?.data).not.toHaveProperty("messageId");
    expect(eventInput?.data).not.toHaveProperty("elements");
    expect(await readFile(oldJsonl, "utf8")).toBe(oldPayload);
    expect(first.storage.list()).toHaveLength(1);
    await expect(readFile(join(basePath, "channels.json"), "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });

    const restarted = createIntegratedGateway(basePath);
    await restarted.gateway.handle(session() as never);
    const replay = await createJsonlStorage(currentJsonl).read();
    const persistedMessage = replay[0]?.type === "message" ? replay[0].data : undefined;
    if (!persistedMessage || !isInput(persistedMessage))
      throw new Error("Expected persisted input");

    expect(formatInput(persistedMessage, { includeMessageId: true }).content).toBe(
      '[time="1970/1/1 08:00" sender="user-1" id="message-1"]\nhello',
    );
    expect(replay).toHaveLength(3);
    expect(await readFile(oldJsonl, "utf8")).toBe(oldPayload);
    await restarted.manager.stop();
    await rm(basePath, { recursive: true, force: true });
  });

  it("sends complete outputs in yield order and accepts empty receipts", async () => {
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

    const inbound = session(send);
    await gateway.handle(inbound as never);

    expect(send).toHaveBeenNthCalledWith(1, "first");
    expect(send).toHaveBeenNthCalledWith(2, "second");
    expect(route).toHaveBeenCalledOnce();
    expect(binding.release).toHaveBeenCalledOnce();
  });

  it("continues later outputs and persists one normalized failure through the bound delivery", async () => {
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

    const inbound = session(send);
    await gateway.handle(inbound as never);

    expect(send).toHaveBeenNthCalledWith(1, "first");
    expect(send).toHaveBeenNthCalledWith(2, "second");
    expect(route).toHaveBeenCalledOnce();
    expect(route.mock.calls[0]?.[0]).not.toHaveProperty("send");
    expect(route.mock.calls[0]?.[0]).not.toBe(inbound);
    expect(binding.fail.mock.calls[0]?.[0]).toMatchObject({
      schemaVersion: 1,
      eventType: "delivery.failed",
      platform: "test",
      selfId: "bot-1",
      channel: { id: "room-1" },
      delivery: {
        turnId: "turn-1",
        messageId: "assistant-1",
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

    await gateway.handle(session(send) as never);

    expect(send).toHaveBeenCalledTimes(1);
    expect(route).toHaveBeenCalledOnce();
    expect(binding.fail).toHaveBeenCalledOnce();
  });

  it("keeps consuming later outputs when bound failure diagnostics fail", async () => {
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

    await expect(gateway.handle(session(send) as never)).resolves.toBeUndefined();

    expect(send).toHaveBeenNthCalledWith(1, "first");
    expect(send).toHaveBeenNthCalledWith(2, "second");
    expect(route).toHaveBeenCalledOnce();
    expect(binding.release).toHaveBeenCalledOnce();
  });

  it("releases the Session when a handover queue is full and logs the rejection", async () => {
    const route = vi.fn(async () => {
      throw new Error("Channel handover queue is full");
    });
    const logger = { warn: vi.fn() };
    const send = vi.fn(async () => []);
    const { gateway } = createGateway(route, logger);

    await gateway.handle(session(send) as never);

    expect(send).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ code: "gateway.route_failed" }),
    );
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
        yield { turnId: "turn-1", messageId: "assistant-1", content: "first" };
        await finished;
      })(),
      delivery: delivery(),
    }));
    const send = vi.fn(async () => []);
    const { gateway } = createGateway(route);
    const handling = gateway.handle(session(send) as never);
    await vi.waitFor(() => expect(send).toHaveBeenCalledWith("first"));
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
