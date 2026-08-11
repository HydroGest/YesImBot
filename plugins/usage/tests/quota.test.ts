import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("koishi", async () => import("@koishijs/core"));

import { QuotaStore } from "../src/quota-store.js";
import { matchesQuotaRule, quotaDayKey, scopeKey } from "../src/quota-types.js";

const roots: string[] = [];

afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

describe("quota helpers", () => {
  it("matches wildcard and direct-message rules", () => {
    const shared = { type: "shared", platform: "onebot", channelId: "group" } as const;
    const direct = { type: "direct", platform: "onebot", selfId: "bot", channelId: "user" } as const;

    expect(matchesQuotaRule(shared, { platform: "*", channelId: "*" })).toBe(true);
    expect(matchesQuotaRule(shared, { platform: "onebot", channelId: "group", isDirect: false })).toBe(true);
    expect(matchesQuotaRule(direct, { platform: "onebot", channelId: "user", isDirect: false })).toBe(false);
    expect(scopeKey(direct)).toBe("onebot:direct:user");
  });
});

describe("QuotaStore", () => {
  it("persists and aggregates scoped usage, overrides, and notification counts", async () => {
    const root = await mkdtemp(join(tmpdir(), "yesimbot-quota-"));
    roots.push(root);
    const logger = { warn: vi.fn() } as never;
    const store = new QuotaStore(root, logger);
    await store.init();
    const day = quotaDayKey();

    await store.append({
      t: Date.now(),
      scope: "onebot:group:123",
      platform: "onebot",
      channelId: "123",
      isDirect: false,
      model: "provider:model",
      kind: "turn",
      inputTokens: 10,
      outputTokens: 5,
      totalTokens: 15,
    });
    await store.append({
      t: Date.now(),
      scope: "onebot:group:123",
      platform: "onebot",
      channelId: "123",
      isDirect: false,
      model: "provider:model",
      kind: "vision",
      inputTokens: 3,
      outputTokens: 2,
      totalTokens: 5,
    });

    await expect(store.cachedToday()).resolves.toMatchObject(
      new Map([["onebot:group:123", { totalTokens: 20, calls: 2, kindTokens: { turn: 15, vision: 5 } }]]),
    );

    await store.setOverride("onebot:group:123", { dailyLimit: 100, model: "provider:other" });
    await expect(store.getOverride("onebot:group:123")).resolves.toEqual({ dailyLimit: 100, model: "provider:other" });
    await store.clearOverride("onebot:group:123", "model");
    await expect(store.getOverride("onebot:group:123")).resolves.toEqual({ dailyLimit: 100 });

    await store.appendNotification({ t: Date.now(), scope: "onebot:group:123", platform: "onebot", channelId: "123", isDirect: false });
    await expect(store.getTodayNotificationCount("onebot:group:123")).resolves.toBe(1);
    expect(await readFile(join(root, `usage-${day}.jsonl`), "utf8")).toContain('"kind":"vision"');
  });
});
