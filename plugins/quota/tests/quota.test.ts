import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Context } from "koishi";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("koishi", async () => import("@koishijs/core"));

import QuotaPlugin, { Config as QuotaConfig, QuotaStore, matchesQuotaRule, normalizeRuleChannelId, quotaDayKey, scopeKey } from "../src/index.js";

const roots: string[] = [];

afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

describe("quota helpers", () => {
  it("derives scope keys for guild, channel, and direct contexts", () => {
    const guild = { type: "guild", platform: "onebot", channelId: "123", guildId: "123" } as const;
    const channel = { type: "channel", platform: "onebot", channelId: "456", guildId: "123" } as const;
    const direct = { type: "direct", platform: "onebot", selfId: "bot", channelId: "private:user", userId: "user" } as const;

    expect(scopeKey(guild)).toBe("onebot:group:123");
    expect(scopeKey(channel)).toBe("onebot:group:456");
    expect(scopeKey(direct)).toBe("onebot:direct:private:user");
  });

  it("matches wildcard, group, and direct rules with private: prefix", () => {
    const guild = { type: "guild", platform: "onebot", channelId: "123", guildId: "123" } as const;
    const direct = { type: "direct", platform: "onebot", selfId: "bot", channelId: "private:user", userId: "user" } as const;

    expect(matchesQuotaRule(guild, { platform: "*", channelId: "*" })).toBe(true);
    expect(matchesQuotaRule(guild, { platform: "onebot", channelId: "123", isDirect: false })).toBe(true);
    expect(matchesQuotaRule(guild, { platform: "onebot", channelId: "123", isDirect: true })).toBe(false);
    expect(matchesQuotaRule(direct, { platform: "onebot", channelId: "private:user", isDirect: true })).toBe(true);
    expect(matchesQuotaRule(direct, { platform: "onebot", channelId: "private:user", isDirect: false })).toBe(false);
  });

  it("normalizes bare account ids in direct rules to private: prefix", () => {
    const direct = { type: "direct", platform: "onebot", selfId: "bot", channelId: "private:888888", userId: "888888" } as const;

    expect(normalizeRuleChannelId({ isDirect: true, channelId: "888888", platform: "onebot" })).toBe("private:888888");
    expect(normalizeRuleChannelId({ isDirect: true, channelId: "private:888888", platform: "onebot" })).toBe("private:888888");
    expect(normalizeRuleChannelId({ isDirect: false, channelId: "888888", platform: "onebot" })).toBe("888888");
    // 裸账号规则应能匹配真实 private: 会话
    expect(matchesQuotaRule(direct, { isDirect: true, channelId: "888888", platform: "onebot" })).toBe(true);
  });

  it("computes day keys in Asia/Shanghai regardless of host timezone", () => {
    // 2026-08-10 16:30 UTC = 2026-08-11 00:30 上海
    const utcTime = new Date("2026-08-10T16:30:00Z");
    expect(quotaDayKey(utcTime)).toBe("2026-08-11");
    // 2026-08-10 15:30 UTC = 2026-08-10 23:30 上海
    const utcEvening = new Date("2026-08-10T15:30:00Z");
    expect(quotaDayKey(utcEvening)).toBe("2026-08-10");
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
      kind: "chat",
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
      kind: "embedding",
      inputTokens: 3,
      outputTokens: 2,
      totalTokens: 5,
    });

    await expect(store.cachedToday()).resolves.toMatchObject(
      new Map([["onebot:group:123", { totalTokens: 20, calls: 2, kindTokens: { chat: 15, embedding: 5 } }]]),
    );

    await store.setOverride("onebot:group:123", { dailyLimit: 100, model: "provider:other" });
    await expect(store.getOverride("onebot:group:123")).resolves.toEqual({ dailyLimit: 100, model: "provider:other" });
    await store.clearOverride("onebot:group:123", "model");
    await expect(store.getOverride("onebot:group:123")).resolves.toEqual({ dailyLimit: 100 });

    await store.appendNotification({ t: Date.now(), scope: "onebot:group:123", platform: "onebot", channelId: "123", isDirect: false });
    await expect(store.getTodayNotificationCount("onebot:group:123")).resolves.toBe(1);
    expect(await readFile(join(root, `usage-${day}.jsonl`), "utf8")).toContain('"kind":"embedding"');
  });
});

describe("QuotaPlugin", () => {
  it("records channel-scoped model usage events", async () => {
    const root = await mkdtemp(join(tmpdir(), "yesimbot-quota-"));
    roots.push(root);
    const ctx = new Context();
    ctx.baseDir = "/";
    (ctx as unknown as { yesimbot: { agent: { use: () => () => void } } }).yesimbot = { agent: { use: () => () => undefined } };
    const plugin = new QuotaPlugin(ctx as never, QuotaConfig({ quotaStorageDir: root }));

    await plugin.start();
    ctx.emit("yesimbot/model-usage", {
      context: { type: "guild", platform: "onebot", channelId: "123", guildId: "123" },
      modelId: "provider:model",
      providerId: "provider",
      providerModelId: "model",
      kind: "chat",
      usage: { inputTokens: 10, outputTokens: 5 },
      timestamp: Date.now(),
    });

    await expect((plugin as unknown as { store: QuotaStore }).store.cachedToday()).resolves.toMatchObject(
      new Map([["onebot:group:123", { totalTokens: 15, calls: 1, kindTokens: { chat: 15 } }]]),
    );
    plugin.stop();
  });
});
