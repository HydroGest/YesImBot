import { describe, expect, it, vi } from "vitest";

vi.mock("koishi", async () => import("@koishijs/core"));

import { h } from "koishi";

import { elementsToLiteral } from "../src/platform/message.js";
import type { Platform } from "../src/platform/types.js";
import { createTestPlatformService } from "./platform-service-helper.js";

const PNG_1x1 = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);

function session(overrides: Record<string, unknown> = {}) {
  return {
    platform: "test",
    selfId: "bot",
    channelId: "room",
    userId: "user",
    messageId: "m1",
    content: "hello",
    timestamp: 1,
    event: { type: "message", message: { id: "m1", content: "hello" }, user: { id: "user" } },
    bot: { adapterName: "test" },
    ...overrides,
  };
}

describe("prepareMessage (ImagePrepareSink)", () => {
  it("gives the selected adapter a readonly message and write-only image sink", async () => {
    const service = createTestPlatformService({ now: () => 10 });
    let seen: Platform.PrepareContext | undefined;
    service.register({
      id: "t",
      platform: "test",
      async prepare(ctx) {
        seen = ctx;
        const { assetId, mime } = await ctx.images.put(PNG_1x1);
        return [h("img", { id: assetId, mime }), h.text("hi")];
      },
    });
    const input = session();
    const draft = service.collectIfNeeded(input as never)!;
    const prepared = await service.prepareMessage(input as never, draft);

    expect(seen).toBeDefined();
    expect(elementsToLiteral(prepared.elements)).toContain("asset_");
  });

  it("applies only replacement elements", async () => {
    const service = createTestPlatformService({ now: () => 10 });
    service.register({
      id: "t",
      platform: "test",
      async prepare() {
        return [h.text("b")];
      },
    });
    const input = session();
    const draft = service.collectIfNeeded(input as never)!;
    const prepared = await service.prepareMessage(input as never, draft);

    expect(prepared.messageId).toBe(draft.messageId);
    expect(prepared.receivedAt).toBe(draft.receivedAt);
    expect(prepared.scope.channelType).toBe("group");
    expect(elementsToLiteral(prepared.elements)).toContain("b");
  });

  it("ignores void-return mutations to elements and nested metadata", async () => {
    const service = createTestPlatformService({ now: () => 10 });
    service.register({
      id: "t",
      platform: "test",
      async prepare({ message }) {
        const mutable = message as unknown as Platform.Message;
        mutable.elements.push(h.text("mutated"));
        mutable.scope.channelId = "other";
        mutable.sender.id = "other-user";
      },
    });
    const input = session();
    const draft = service.collectIfNeeded(input as never)!;
    const prepared = await service.prepareMessage(input as never, draft);

    expect(elementsToLiteral(prepared.elements)).toBe("hello");
    expect(prepared.scope.channelId).toBe("room");
    expect(prepared.sender.id).toBe("user");
  });

  it("seals unprepared remote images", async () => {
    const service = createTestPlatformService({ now: () => 10 });
    const input = session({ elements: h.parse('hi <img src="https://evil/x.png"/>') });
    const draft = service.collectIfNeeded(input as never)!;
    const prepared = await service.prepareMessage(input as never, draft);
    const literal = elementsToLiteral(prepared.elements);

    expect(literal).toContain("hi");
    expect(literal).toContain('unavailable="true"');
    expect(literal).not.toContain("https://");
  });

  it("clears channel assets", async () => {
    const service = createTestPlatformService({ now: () => 10 });
    await service.clearChannel({ platform: "test", selfId: "bot", channelId: "room" });
  });
});
