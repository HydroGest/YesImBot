import { Context } from "@koishijs/core";
import { describe, expect, it, vi } from "vitest";

vi.mock("koishi", async () => import("@koishijs/core"));

import type { Config } from "../src/config.js";
import { DeliveryService } from "../src/delivery/index.js";

const config: Config = { basePath: "data/yesimbot-core", chatModel: "mock:model" };

function createService() {
  const ctx = new Context();
  return { ctx, service: new DeliveryService(ctx, config) };
}

describe("DeliveryService", () => {
  it("replies through the original Session in fragment order and preserves returned ids", async () => {
    const { service } = createService();
    const send = vi.fn(async () => ["m1"]);

    const receipt = await service.reply({ send } as never, ["first", "second"]);

    expect(send).toHaveBeenNthCalledWith(1, "first");
    expect(send).toHaveBeenNthCalledWith(2, "second");
    expect(receipt).toMatchObject({
      mode: "reply",
      status: "sent",
      sentCount: 2,
      messageIds: ["m1", "m1"],
    });
  });

  it("resolves a target bot by platform and self id", async () => {
    const { ctx, service } = createService();
    const sendMessage = vi.fn(async () => ["target-1"]);
    ctx.bots.push({ platform: "test", selfId: "bot", sendMessage } as never);

    const receipt = await service.send(
      { platform: "test", selfId: "bot" },
      { type: "channel", channelId: "room", channelType: "group" },
      ["hello"],
    );

    expect(sendMessage).toHaveBeenCalledWith("room", "hello");
    expect(receipt.messageIds).toEqual(["target-1"]);
  });

  it("uses the initially resolved target bot for every fragment", async () => {
    const { ctx, service } = createService();
    const replacementSend = vi.fn(async () => ["replacement"]);
    const originalSend = vi.fn(async () => {
      ctx.bots.splice(0, 1, {
        platform: "test",
        selfId: "bot",
        sendMessage: replacementSend,
      } as never);
      return ["original"];
    });
    ctx.bots.push({ platform: "test", selfId: "bot", sendMessage: originalSend } as never);

    const receipt = await service.send(
      { platform: "test", selfId: "bot" },
      { type: "channel", channelId: "room", channelType: "group" },
      ["first", "second"],
    );

    expect(originalSend).toHaveBeenNthCalledWith(1, "room", "first");
    expect(originalSend).toHaveBeenNthCalledWith(2, "room", "second");
    expect(replacementSend).not.toHaveBeenCalled();
    expect(receipt.messageIds).toEqual(["original", "original"]);
  });

  it("stops after a later failure and returns a partial receipt", async () => {
    const { service } = createService();
    const send = vi
      .fn<() => Promise<string[]>>()
      .mockResolvedValueOnce(["m1"])
      .mockRejectedValueOnce(new Error("offline"));

    const receipt = await service.reply({ send } as never, ["one", "two", "three"]);

    expect(receipt).toMatchObject({
      status: "partial",
      sentCount: 1,
      messageIds: ["m1"],
      error: { code: "delivery.send_failed", retryable: false },
    });
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("returns a failed receipt when no matching target bot is available", async () => {
    const { service } = createService();

    const receipt = await service.send(
      { platform: "test", selfId: "bot" },
      { type: "channel", channelId: "room", channelType: "group" },
      ["hello"],
    );

    expect(receipt).toMatchObject({
      status: "failed",
      sentCount: 0,
      messageIds: [],
      error: { code: "delivery.target_unavailable", retryable: false },
    });
  });

  it("preserves an empty successful message id array", async () => {
    const { service } = createService();

    const receipt = await service.reply({ send: vi.fn(async () => []) } as never, ["hello"]);

    expect(receipt).toMatchObject({ status: "sent", sentCount: 1, messageIds: [] });
  });

  it("publishes one started event before one terminal event", async () => {
    const { service } = createService();
    const events: unknown[] = [];
    service.subscribe((event) => events.push(event));

    const receipt = await service.reply({ send: vi.fn(async () => ["m1"]) } as never, ["hello"]);

    expect(events).toMatchObject([
      { type: "delivery.started", deliveryId: receipt.deliveryId },
      { type: "delivery.sent", receipt: { deliveryId: receipt.deliveryId } },
    ]);
  });

  it("isolates listener throws and rejections without delaying the receipt", async () => {
    const { service } = createService();
    const warn = vi.spyOn(service.logger, "warn").mockImplementation(() => undefined);
    service.subscribe(() => {
      throw new Error("sync observer failed");
    });
    service.subscribe(() => Promise.reject(new Error("async observer failed")));

    const receipt = await service.reply({ send: vi.fn(async () => ["m1"]) } as never, ["hello"]);

    expect(receipt.status).toBe("sent");
    await vi.waitFor(() =>
      expect(warn).toHaveBeenCalledWith(
        expect.objectContaining({ event: "delivery.listener_failed" }),
      ),
    );
  });

  it("does not recursively send an error when the first fragment fails", async () => {
    const { service } = createService();
    const events: unknown[] = [];
    const send = vi.fn(async () => {
      throw new Error("offline");
    });
    service.subscribe((event) => events.push(event));

    const receipt = await service.reply({ send } as never, ["hello"]);

    expect(receipt).toMatchObject({ status: "failed", sentCount: 0, messageIds: [] });
    expect(send).toHaveBeenCalledTimes(1);
    expect(events).toMatchObject([{ type: "delivery.started" }, { type: "delivery.failed" }]);
  });

  it("reports one normalized diagnostic when the first fragment fails", async () => {
    const { service } = createService();
    const warn = vi.spyOn(service.logger, "warn").mockImplementation(() => undefined);

    const receipt = await service.reply(
      {
        send: vi.fn(async () => {
          throw new Error("offline");
        }),
      } as never,
      ["hello"],
    );

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "delivery.send_failed",
        cause: "offline",
        receipt: expect.objectContaining({ deliveryId: receipt.deliveryId, status: "failed" }),
      }),
    );
  });

  it("resolves the target after publishing started", async () => {
    const { ctx, service } = createService();
    const sendMessage = vi.fn(async () => ["target-1"]);
    const events: unknown[] = [];
    service.subscribe((event) => {
      events.push(event);
      if (event.type === "delivery.started") {
        ctx.bots.push({ platform: "test", selfId: "bot", sendMessage } as never);
      }
    });

    const receipt = await service.send(
      { platform: "test", selfId: "bot" },
      { type: "channel", channelId: "room", channelType: "group" },
      ["hello"],
    );

    expect(sendMessage).toHaveBeenCalledWith("room", "hello");
    expect(receipt).toMatchObject({ status: "sent", messageIds: ["target-1"] });
    expect(events).toMatchObject([{ type: "delivery.started" }, { type: "delivery.sent" }]);
  });

  it("fails an empty target delivery when no matching bot is available", async () => {
    const { service } = createService();
    const events: unknown[] = [];
    const warn = vi.spyOn(service.logger, "warn").mockImplementation(() => undefined);
    service.subscribe((event) => events.push(event));

    const receipt = await service.send(
      { platform: "test", selfId: "bot" },
      { type: "channel", channelId: "room", channelType: "group" },
      [],
    );

    expect(receipt).toMatchObject({
      status: "failed",
      sentCount: 0,
      messageIds: [],
      error: { code: "delivery.target_unavailable" },
    });
    expect(events).toMatchObject([{ type: "delivery.started" }, { type: "delivery.failed" }]);
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
