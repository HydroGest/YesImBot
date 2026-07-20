import { describe, expect, it, vi } from "vitest";

vi.mock("koishi", async () => import("@koishijs/core"));

import { h, type Session } from "koishi";

import type { Platform } from "../src/platform/types.js";
import { createTestPlatformService } from "./platform-service-helper.js";

declare module "../src/platform/types.js" {
  interface PlatformEventVariants {
    "test.action": { value: number };
  }
}

function session(overrides: Record<string, unknown> = {}): Session {
  return {
    platform: "test",
    selfId: "bot",
    channelId: "room",
    userId: "user",
    messageId: "m1",
    content: "hello",
    event: { type: "message" },
    bot: { adapterName: "test", sid: "test:bot" },
    ...overrides,
  } as unknown as Session;
}

function testEvent(): Platform.Event<"test.action"> {
  return {
    source: { platform: "test", selfId: "bot" },
    scope: { type: "account" },
    type: "test.action",
    data: { value: 1 },
    content: "updated",
  };
}

function replacementMessage(receivedAt = 0): Platform.Message {
  return {
    source: { platform: "test", selfId: "bot" },
    scope: { type: "channel", channelId: "room" },
    sender: { id: "user" },
    messageId: "replacement",
    receivedAt,
    elements: [h.text("replacement")],
  };
}

describe("PlatformService collection", () => {
  it.each([
    ["keep", { kind: "keep" }],
    ["ignore", { kind: "ignore" }],
  ] as const)("handles the %s refine result", (_label, result) => {
    const service = createTestPlatformService({ now: () => 10 });
    service.register({ id: "test", platform: "test", refine: () => result });

    const message = service.collectIfNeeded(session());
    expect(message === undefined).toBe(result.kind === "ignore");
  });

  it("preserves core receivedAt when refine replaces a base message", () => {
    const service = createTestPlatformService({ now: () => 10 });
    service.register({
      id: "test",
      platform: "test",
      refine: ({ base }) => ({
        kind: "message",
        message: { ...base!, receivedAt: 999, elements: [h.text("refined")] },
      }),
    });

    expect(service.collectIfNeeded(session())?.receivedAt).toBe(10);
  });

  it("never sends ordinary messages to event subscribers", () => {
    const service = createTestPlatformService({ now: () => 10 });
    const listener = vi.fn();
    service.subscribe(listener);

    expect(service.collectIfNeeded(session())).toBeDefined();
    expect(listener).not.toHaveBeenCalled();
  });

  it("publishes complete semantic events without receipt time", () => {
    const service = createTestPlatformService({ now: () => 10 });
    const listener = vi.fn();
    service.subscribe(listener);
    const event = testEvent();

    expect(service.publish(event)).toBe(event);
    expect(listener).toHaveBeenCalledWith(event);
    expect(listener.mock.calls[0]?.[0]).not.toHaveProperty("receivedAt");
  });

  it("does not try another adapter after accepts throws", () => {
    const diagnostics: Platform.Diagnostic[] = [];
    const second = vi.fn(() => true);
    const service = createTestPlatformService({
      platform: { profiles: { "test:bot": "primary" } },
      diagnostic: (d) => diagnostics.push(d as Platform.Diagnostic),
    });
    service.register({
      id: "first",
      profile: "primary",
      accepts: () => {
        throw new Error("boom");
      },
    });
    service.register({ id: "second", platform: "test", accepts: second });

    expect(service.collectIfNeeded(session())).toBeDefined();
    expect(second).not.toHaveBeenCalled();
    expect(diagnostics).toContainEqual(
      expect.objectContaining({ code: "platform.adapter_accept_failed" }),
    );
  });

  it("prefers profile, then adapter, then platform", () => {
    const calls: string[] = [];
    const service = createTestPlatformService({
      platform: { profiles: { "test:bot": "primary" } },
    });
    service.register({
      id: "platform",
      platform: "test",
      refine: () => {
        calls.push("platform");
        return { kind: "keep" };
      },
    });
    service.register({
      id: "adapter",
      adapter: "test",
      refine: () => {
        calls.push("adapter");
        return { kind: "keep" };
      },
    });
    service.register({
      id: "profile",
      profile: "primary",
      refine: () => {
        calls.push("profile");
        return { kind: "keep" };
      },
    });

    service.collectIfNeeded(session());
    expect(calls).toEqual(["profile"]);
  });

  it("falls to the next rank after an explicit decline", () => {
    const refine = vi.fn(() => ({ kind: "keep" }) as const);
    const service = createTestPlatformService({
      platform: { profiles: { "test:bot": "primary" } },
    });
    service.register({ id: "profile", profile: "primary", accepts: () => false });
    service.register({ id: "platform", platform: "test", refine });

    service.collectIfNeeded(session());
    expect(refine).toHaveBeenCalledOnce();
  });

  it("throws a stable same-rank conflict", () => {
    const service = createTestPlatformService();
    service.register({ id: "b", platform: "test" });
    service.register({ id: "a", platform: "test" });
    expect(() => service.collectIfNeeded(session())).toThrow(
      "Platform adapter conflict at rank 1: a, b",
    );
  });

  it("delivers an Event result when no base exists", () => {
    const service = createTestPlatformService();
    const listener = vi.fn();
    service.subscribe(listener);
    service.register({
      id: "event",
      platform: "test",
      refine: () => ({ kind: "event", event: testEvent() }),
    });

    expect(
      service.collectIfNeeded(session({ channelId: undefined, content: undefined })),
    ).toBeUndefined();
    expect(listener).toHaveBeenCalledWith(testEvent());
  });

  it("rejects a Message result when no base exists", () => {
    const diagnostics: Platform.Diagnostic[] = [];
    const service = createTestPlatformService({
      diagnostic: (d) => diagnostics.push(d as Platform.Diagnostic),
    });
    service.register({
      id: "bad",
      platform: "test",
      refine: () => ({ kind: "message", message: replacementMessage() }),
    });

    expect(
      service.collectIfNeeded(session({ channelId: undefined, content: undefined })),
    ).toBeUndefined();
    expect(diagnostics).toContainEqual(
      expect.objectContaining({ code: "platform.invalid_refine_result" }),
    );
  });

  it("keeps the base and skips prepare after refine throws", async () => {
    const prepare = vi.fn();
    const service = createTestPlatformService();
    service.register({
      id: "broken",
      platform: "test",
      refine: () => {
        throw new Error("boom");
      },
      prepare,
    });
    const input = session();
    const base = service.collectIfNeeded(input)!;

    await service.prepareMessage(input, base);
    expect(base.elements[0]?.toString()).toContain("hello");
    expect(prepare).not.toHaveBeenCalled();
  });

  it("reuses the adapter selected during collection", async () => {
    const prepareA = vi.fn(async ({ message }: Platform.PrepareContext) => message.elements);
    const prepareB = vi.fn(async ({ message }: Platform.PrepareContext) => message.elements);
    const service = createTestPlatformService();
    const disposeA = service.register({ id: "a", platform: "test", prepare: prepareA });
    const input = session();
    const base = service.collectIfNeeded(input)!;
    disposeA();
    service.register({ id: "b", platform: "test", prepare: prepareB });

    await service.prepareMessage(input, base);
    expect(prepareA).toHaveBeenCalledOnce();
    expect(prepareB).not.toHaveBeenCalled();
  });

  it("collects one Session object only once", () => {
    const refine = vi.fn(() => ({ kind: "keep" }) as const);
    const service = createTestPlatformService();
    service.register({ id: "test", platform: "test", refine });
    const input = session();

    service.collectIfNeeded(input);
    service.collectIfNeeded(input);
    expect(refine).toHaveBeenCalledOnce();
  });
});
