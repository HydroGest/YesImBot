import path from "node:path";

import { DataService } from "@koishijs/console";
import { Context, Logger, Schema, Time, type Field, type Types } from "koishi";
import type { ModelUsageEvent } from "koishi-plugin-yesimbot";

import { JsonlUsageHistory } from "./jsonl.js";
import { normalizeLanguageUsage } from "./middleware.js";
import { DatabaseUsageHistory, UsageStore } from "./store.js";
import type { UsageConfig, UsagePayload, UsageRow } from "./types.js";

export const Config: Schema<UsageConfig> = Schema.object({
  historySource: Schema.union([Schema.const("jsonl"), Schema.const("database")])
    .default("jsonl")
    .description("历史 Token 数据源：jsonl 从 session 文件扫描，database 使用聚合表"),
  recentDayCount: Schema.natural().default(30).description("首页统计最近天数"),
  refreshInterval: Schema.natural()
    .role("ms")
    .default(Time.second * 5)
    .description("状态栏和首页刷新间隔"),
  rateWindowSeconds: Schema.natural().default(60).description("Token 速率统计窗口（秒）"),
});

const USAGE_TABLE = "yesimbot.usage";

const PACKAGE_NAME = "koishi-plugin-yesimbot-usage";

const USAGE_FIELDS = {
  date: "integer",
  hour: "integer",
  provider: "string(63)",
  model: "string(127)",
  kind: "string(31)",
  calls: "integer",
  inputTokens: "integer",
  outputTokens: "integer",
  noCacheTokens: "integer",
  cacheReadTokens: "integer",
  cacheWriteTokens: "integer",
} satisfies Field.Extension<UsageRow, Types>;

declare module "koishi" {
  interface Tables {
    [USAGE_TABLE]: UsageRow;
  }
}

declare module "@koishijs/console" {
  namespace Console {
    interface Services {
      yesimbotUsage: UsagePlugin;
    }
  }
}

export default class UsagePlugin extends DataService<UsagePayload> {
  public static readonly name = "yesimbot-usage";
  public static readonly inject = ["console", "database", "yesimbot"];
  public static readonly Config = Config;
  public static readonly usage = "统计 YesImBot 模型调用 Token 消耗并注入 Koishi 首页和状态栏";

  public readonly logger: Logger;

  private readonly store: UsageStore;
  private readonly refreshSoon: () => void;
  private timer: (() => void) | undefined;
  private rateTimer: (() => void) | undefined;
  private started = false;

  public constructor(
    public readonly ctx: Context,
    private readonly usageConfig: UsageConfig,
  ) {
    super(ctx, "yesimbotUsage");
    this.logger = ctx.logger("yesimbot-usage");
    const history =
      usageConfig.historySource === "jsonl" ? new JsonlUsageHistory(path.resolve(ctx.baseDir, "data", "yesimbot")) : new DatabaseUsageHistory(ctx.database);
    this.store = new UsageStore(ctx.database, usageConfig.rateWindowSeconds, history);
    ctx.model.extend(USAGE_TABLE, USAGE_FIELDS, { primary: ["date", "hour", "provider", "model", "kind"] });
    this.refreshSoon = ctx.debounce(() => this.refresh(), 1000);
    ctx.on("yesimbot/model-usage", (event: ModelUsageEvent) => {
      this.store.record({
        providerId: event.providerId,
        modelId: event.providerModelId,
        timestamp: event.timestamp,
        kind: event.kind,
        usage: normalizeLanguageUsage(event.usage),
      });
      this.refreshSoon();
    });

    ctx.console.addEntry({ dev: path.resolve(__dirname, "../client/index.ts"), prod: path.resolve(ctx.baseDir, "node_modules", PACKAGE_NAME, "dist") });

    ctx.on("ready", this.setup.bind(this));
    ctx.on("dispose", this.stop.bind(this));
  }

  public async get(): Promise<UsagePayload> {
    return this.store.snapshot(this.usageConfig);
  }

  public async setup(): Promise<void> {
    if (this.started) return;
    this.started = true;
    this.timer = this.ctx.setInterval(() => this.refresh(), this.usageConfig.refreshInterval);
    this.rateTimer = this.ctx.setInterval(() => this.store.tickRate(), Time.second);
    this.logger.success("yesimbot-usage started");
  }

  public async stop(): Promise<void> {
    if (!this.started) return;
    this.started = false;
    if (this.timer) {
      this.timer();
      this.timer = undefined;
    }
    if (this.rateTimer) {
      this.rateTimer();
      this.rateTimer = undefined;
    }
    this.logger.info("yesimbot-usage stopped");
  }
}

export type { NormalizedUsage, RateSnapshot, TokenCounts, UsageByModel, UsageConfig, UsagePayload, UsageRecordInput, UsageRow } from "./types.js";
