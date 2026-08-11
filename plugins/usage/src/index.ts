import { resolve } from "node:path";

import { DataService } from "@koishijs/console";
import { Context, Logger, Schema, Time, type Field, type Types } from "koishi";

import { JsonlUsageHistory } from "./jsonl.js";
import { installModelUsagePatch } from "./middleware.js";
import { QuotaManager } from "./quota.js";
import { DatabaseUsageHistory, UsageStore } from "./store.js";
import type { UsageConfig, UsagePayload, UsageRow } from "./types.js";

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
  quotaEnabled: Schema.boolean().default(false).description("启用按会话每日额度拦截"),
  quotaStorageDir: Schema.string().default("data/yesimbot/quota").description("按会话额度记录与动态覆盖的存储目录"),
  defaultDailyLimit: Schema.natural().default(1_000_000).description("默认每日 Token 限额；0 表示不限额"),
  defaultModel: Schema.dynamic("registry.chatModels").default("").description("默认会话模型覆盖；留空使用 YesImBot 默认模型"),
  quotaRules: Schema.array(
    Schema.object({
      platform: Schema.string().default("*").description("平台；* 表示任意"),
      channelId: Schema.string().default("*").description("群号或账号；* 表示任意"),
      isDirect: Schema.boolean().description("是否私聊；留空同时匹配群聊与私聊"),
      model: Schema.dynamic("registry.chatModels").description("会话模型覆盖；留空继承默认模型"),
      dailyLimit: Schema.natural().description("每日 Token 限额；留空继承默认值，0 表示不限额"),
    }),
  )
    .role("table")
    .default([]),
  managementGroupId: Schema.string().default("").description("管理群 ID；在该群使用 /额度 显示已启用群总览，留空关闭"),
  managementGroupPlatform: Schema.string().default("onebot").description("管理群平台；* 表示任意"),
  sendBlockMessage: Schema.boolean().default(true).description("额度耗尽时发送提示；关闭后仍会拦截模型调用"),
  maxDailyBlockNotifications: Schema.natural().default(3).description("每个会话每天最多发送的超额提示数；0 表示不限制"),
  blockMessage: Schema.string()
    .role("textarea")
    .default("今日额度已用完（{used} / {limit}），明天 0 点重置后再聊哦~")
    .description("超额提示，支持 {used}、{limit}、{percent}"),
  notifyIntervalMs: Schema.natural().role("ms").default(Time.minute).description("同一会话超额提示的最小间隔"),
  quotaAdminAuthority: Schema.natural().default(2).description("额度管理命令所需权限等级"),
});

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
  private readonly quota: QuotaManager;
  private timer: (() => void) | undefined;
  private rateTimer: (() => void) | undefined;
  private disposePatch: (() => void) | undefined;
  private started = false;

  public constructor(
    public readonly ctx: Context,
    private readonly usageConfig: UsageConfig,
  ) {
    super(ctx, "yesimbotUsage");
    this.logger = ctx.logger("yesimbot-usage");
    const history =
      usageConfig.historySource === "jsonl" ? new JsonlUsageHistory(resolve(ctx.baseDir, "data", "yesimbot")) : new DatabaseUsageHistory(ctx.database);
    this.store = new UsageStore(ctx.database, usageConfig.rateWindowSeconds, history);
    this.quota = new QuotaManager(ctx, usageConfig, this.logger);

    ctx.model.extend(USAGE_TABLE, USAGE_FIELDS, { primary: ["date", "hour", "provider", "model", "kind"] });
    this.refreshSoon = ctx.debounce(() => this.refresh(), 1000);
    this.disposePatch = installModelUsagePatch(this.ctx.yesimbot.model, (record) => {
      this.store.record(record);
      this.refreshSoon();
    });

    ctx.console.addEntry({ dev: resolve(__dirname, "../client/index.ts"), prod: resolve(ctx.baseDir, "node_modules", PACKAGE_NAME, "dist") });

    ctx.on("ready", this.setup.bind(this));
    ctx.on("dispose", this.stop.bind(this));
  }

  public async get(): Promise<UsagePayload> {
    return this.store.snapshot(this.usageConfig);
  }

  public async setup(): Promise<void> {
    if (this.started) return;
    await this.quota.start();
    this.started = true;

    this.disposePatch ??= installModelUsagePatch(this.ctx.yesimbot.model, (record) => {
      this.store.record(record);
      this.refreshSoon();
    });
    this.timer = this.ctx.setInterval(() => this.refresh(), this.usageConfig.refreshInterval);
    this.rateTimer = this.ctx.setInterval(() => this.store.tickRate(), Time.second);
    this.logger.success("yesimbot-usage started");
  }

  public async stop(): Promise<void> {
    this.quota.stop();
    this.disposePatch?.();
    this.disposePatch = undefined;
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
