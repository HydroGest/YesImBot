import { describe, expect, it, vi } from "vitest";

vi.mock("koishi", async () => import("@koishijs/core"));

import { getLocalDateNumber, RateWindow, UsageStore } from "../src/store.js";
import type { UsageRow } from "../src/types.js";

function usageRow(overrides: Partial<UsageRow>): UsageRow {
  return {
    date: getLocalDateNumber(),
    hour: 0,
    provider: "openai",
    model: "gpt-4o",
    kind: "chat",
    calls: 1,
    inputTokens: 10,
    outputTokens: 5,
    noCacheTokens: 6,
    cacheReadTokens: 4,
    cacheWriteTokens: 0,
    ...overrides,
  };
}

describe("UsageStore", () => {
  it("only counts today rows in the today aggregate", async () => {
    const today = getLocalDateNumber();
    const rows = [usageRow({ calls: 2, inputTokens: 20, outputTokens: 10 }), usageRow({ date: today - 1, calls: 5, inputTokens: 50, outputTokens: 25 })];
    const database = { select: vi.fn(() => ({ execute: async () => rows })), upsert: vi.fn() };
    const store = new UsageStore(database as never, 60);

    const payload = await store.snapshot({ historySource: "database", recentDayCount: 7, refreshInterval: 5000, rateWindowSeconds: 60 });

    expect(payload.today.calls).toBe(2);
    expect(payload.today.inputTokens).toBe(20);
    expect(payload.recent[0].calls).toBe(2);
    expect(payload.recent[1].calls).toBe(5);
    expect(payload.byHour[0].inputTokens).toBeCloseTo(70 / 7);
  });
});

describe("RateWindow", () => {
  it("keeps a rolling per-minute sum", () => {
    const rate = new RateWindow(3);
    rate.add({ inputTokens: 10, outputTokens: 5, noCacheTokens: 10, cacheReadTokens: 0, cacheWriteTokens: 0 });
    rate.tick();
    rate.add({ inputTokens: 2, outputTokens: 1, noCacheTokens: 0, cacheReadTokens: 2, cacheWriteTokens: 0 });

    expect(rate.snapshot()).toMatchObject({ inputPerMinute: 12, outputPerMinute: 6, noCachePerMinute: 10, cacheReadPerMinute: 2 });
  });
});
