import { describe, expect, it, vi } from "vitest";

vi.mock("koishi", async () => import("@koishijs/core"));

import type { Platform } from "koishi-plugin-yesimbot/platform";

import { createOneBotAdapter } from "../src/index.js";

function mockCtx(): { ctx: Record<string, unknown>; httpGet: ReturnType<typeof vi.fn> } {
  const httpGet = vi.fn();
  const ctx = {
    http: { get: httpGet },
  };
  return { ctx, httpGet };
}

describe("createOneBotAdapter", () => {
  it("creates an adapter with flat id/adapter/refine/prepare", () => {
    const { ctx } = mockCtx();
    const adapter = createOneBotAdapter(ctx as never);

    expect(adapter.id).toBe("yesimbot.onebot");
    expect(adapter.adapter).toBe("onebot");
    expect(typeof adapter.refine).toBe("function");
    expect(typeof adapter.prepare).toBe("function");
    // No nested readers/extensions/events/version
    expect((adapter as Record<string, unknown>).version).toBeUndefined();
    expect((adapter as Record<string, unknown>).events).toBeUndefined();
    expect((adapter as Record<string, unknown>).readers).toBeUndefined();
    expect((adapter as Record<string, unknown>).extensions).toBeUndefined();
  });

  it("refine keeps non-onebot sessions", () => {
    const { ctx } = mockCtx();
    const adapter = createOneBotAdapter(ctx as never);
    const result = adapter.refine?.({
      session: { platform: "discord", selfId: "bot", event: {} } as never,
    });
    expect(result).toEqual({ kind: "keep" });
  });

  it("prepare function is callable", async () => {
    const { ctx } = mockCtx();
    const adapter = createOneBotAdapter(ctx as never);
    expect(adapter.prepare).toBeDefined();
    // Actual prepare logic tested in prepare.test.ts
  });
});
