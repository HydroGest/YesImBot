import { appendFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import type { AgentPlugin } from "@yesimbot/agent-runtime";
import { Schema, Time } from "koishi";
import type { Context, Logger, Session } from "koishi";
import type { ChannelContext, ModelUsageEvent } from "koishi-plugin-yesimbot";

export const Config: Schema<Config> = Schema.object({
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

type OverridesData = Record<string, QuotaOverride>;

type Disposer = () => unknown;

export interface Config {
  quotaStorageDir: string;
  defaultDailyLimit: number;
  defaultModel: string;
  quotaRules: QuotaRule[];
  managementGroupId: string;
  managementGroupPlatform: string;
  sendBlockMessage: boolean;
  maxDailyBlockNotifications: number;
  blockMessage: string;
  notifyIntervalMs: number;
  quotaAdminAuthority: number;
}

export interface QuotaRule {
  platform: string;
  channelId: string;
  isDirect?: boolean;
  model?: string;
  dailyLimit?: number;
}

export interface QuotaOverride {
  dailyLimit?: number;
  model?: string;
}

export interface QuotaUsageRecord {
  t: number;
  scope: string;
  platform: string;
  channelId: string;
  isDirect: boolean;
  model: string;
  kind: "chat" | "embedding";
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface QuotaNotificationRecord {
  t: number;
  scope: string;
  platform: string;
  channelId: string;
  isDirect: boolean;
}

export interface ScopeUsage {
  scope: string;
  platform: string;
  channelId: string;
  isDirect: boolean;
  model: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  calls: number;
  kindTokens: Record<string, number>;
}

interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

export class QuotaStore {
  private queue: Promise<unknown> = Promise.resolve();
  private readonly overrides = new Map<string, QuotaOverride>();
  private overridesLoaded = false;
  private readonly dayCache = new Map<string, Map<string, ScopeUsage>>();
  private readonly notificationCounts = new Map<string, Map<string, number>>();

  public constructor(
    private readonly directory: string,
    private readonly logger: Logger,
  ) {}

  public async init(): Promise<void> {
    await mkdir(this.directory, { recursive: true });
  }

  public append(record: QuotaUsageRecord): Promise<void> {
    return this.serialize(async () => {
      const day = quotaDayKey(new Date(record.t));
      this.dayCache.delete(day);
      await mkdir(this.directory, { recursive: true });
      await appendFile(this.usagePath(day), `${JSON.stringify(record)}\n`, "utf8");
    });
  }

  public async cachedToday(): Promise<Map<string, ScopeUsage>> {
    const day = quotaDayKey();
    const cached = this.dayCache.get(day);
    if (cached) return cached;
    const fresh = await this.readDay(day);
    this.dayCache.set(day, fresh);
    return fresh;
  }

  public readDay(day = quotaDayKey()): Promise<Map<string, ScopeUsage>> {
    return this.serialize(async () => {
      const result = new Map<string, ScopeUsage>();
      let content = "";
      try {
        content = await readFile(this.usagePath(day), "utf8");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return result;
        throw error;
      }
      for (const line of content.split("\n")) {
        if (!line.trim()) continue;
        try {
          const record = JSON.parse(line) as QuotaUsageRecord;
          const current = result.get(record.scope);
          if (current) {
            current.inputTokens += record.inputTokens;
            current.outputTokens += record.outputTokens;
            current.totalTokens += record.totalTokens;
            current.calls += 1;
            current.model = record.model || current.model;
            current.kindTokens[record.kind] = (current.kindTokens[record.kind] ?? 0) + record.totalTokens;
          } else {
            result.set(record.scope, {
              scope: record.scope,
              platform: record.platform,
              channelId: record.channelId,
              isDirect: record.isDirect,
              model: record.model,
              inputTokens: record.inputTokens,
              outputTokens: record.outputTokens,
              totalTokens: record.totalTokens,
              calls: 1,
              kindTokens: { [record.kind]: record.totalTokens },
            });
          }
        } catch {
          this.logger.warn("quota.skip_bad_line", { day, line: line.slice(0, 200) });
        }
      }
      return result;
    });
  }

  public getOverride(scope: string): Promise<QuotaOverride | undefined> {
    return this.serialize(async () => {
      await this.loadOverrides();
      return this.overrides.get(scope);
    });
  }

  public setOverride(scope: string, patch: QuotaOverride): Promise<QuotaOverride> {
    return this.serialize(async () => {
      await this.loadOverrides();
      const current = { ...this.overrides.get(scope), ...patch };
      this.overrides.set(scope, current);
      await this.saveOverrides();
      return current;
    });
  }

  public clearOverride(scope: string, field?: keyof QuotaOverride): Promise<void> {
    return this.serialize(async () => {
      await this.loadOverrides();
      if (!field) {
        this.overrides.delete(scope);
      } else {
        const current = this.overrides.get(scope);
        if (!current) return;
        delete current[field];
        if (Object.keys(current).length === 0) this.overrides.delete(scope);
      }
      await this.saveOverrides();
    });
  }

  public getTodayNotificationCount(scope: string): Promise<number> {
    return this.serialize(async () => (await this.loadNotificationCounts(quotaDayKey())).get(scope) ?? 0);
  }

  public appendNotification(record: QuotaNotificationRecord): Promise<void> {
    return this.serialize(async () => {
      const day = quotaDayKey(new Date(record.t));
      const counts = await this.loadNotificationCounts(day);
      await appendFile(this.notificationPath(day), `${JSON.stringify(record)}\n`, "utf8");
      counts.set(record.scope, (counts.get(record.scope) ?? 0) + 1);
    });
  }

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.queue.then(operation, operation);
    this.queue = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  private usagePath(day: string): string {
    return path.join(this.directory, `usage-${day}.jsonl`);
  }

  private notificationPath(day: string): string {
    return path.join(this.directory, `notifications-${day}.jsonl`);
  }

  private overridesPath(): string {
    return path.join(this.directory, "overrides.json");
  }

  private async loadOverrides(): Promise<void> {
    if (this.overridesLoaded) return;
    try {
      const parsed = JSON.parse(await readFile(this.overridesPath(), "utf8")) as OverridesData;
      for (const [key, value] of Object.entries(parsed)) {
        if (value && typeof value === "object") this.overrides.set(key, value);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        this.logger.warn("quota.load_overrides_failed", { cause: error instanceof Error ? error.message : String(error) });
      }
    }
    this.overridesLoaded = true;
  }

  private async saveOverrides(): Promise<void> {
    const path = this.overridesPath();
    const temporary = `${path}.tmp`;
    await writeFile(temporary, `${JSON.stringify(Object.fromEntries(this.overrides), null, 2)}\n`, "utf8");
    await rename(temporary, path);
  }

  private async loadNotificationCounts(day: string): Promise<Map<string, number>> {
    const cached = this.notificationCounts.get(day);
    if (cached) return cached;
    const counts = new Map<string, number>();
    const content = await readFile(this.notificationPath(day), "utf8").catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return "";
      throw error;
    });
    for (const line of content.split("\n")) {
      if (!line.trim()) continue;
      try {
        const record = JSON.parse(line) as QuotaNotificationRecord;
        if (record.scope) counts.set(record.scope, (counts.get(record.scope) ?? 0) + 1);
      } catch {
        this.logger.warn("quota.skip_bad_notification_line", { day, line: line.slice(0, 200) });
      }
    }
    this.notificationCounts.set(day, counts);
    return counts;
  }
}

export default class QuotaPlugin {
  public static readonly name = "yesimbot-quota";
  public static readonly inject = ["yesimbot"];
  public static readonly Config = Config;
  public static readonly usage = "为 YesImBot 提供按会话模型额度、模型覆盖和 /额度 命令";

  private readonly store: QuotaStore;
  private readonly logger: Logger;
  private readonly disposers: Disposer[] = [];
  private readonly lastBlockedNotify = new Map<string, number>();
  private readonly pendingBlockedNotify = new Set<string>();
  private started = false;

  public constructor(
    private readonly ctx: Context,
    private readonly config: Config,
  ) {
    this.logger = ctx.logger("yesimbot-quota");
    this.store = new QuotaStore(path.resolve(ctx.baseDir, config.quotaStorageDir), this.logger);
    ctx.on("ready", this.start.bind(this));
    ctx.on("dispose", this.stop.bind(this));
  }

  public async start(): Promise<void> {
    if (this.started) return;
    await this.store.init();
    try {
      this.disposers.push(this.ctx.yesimbot.agent.use({ setup: (context) => this.createMeter(context) }));
      this.disposers.push(
        this.ctx.on("yesimbot/model-usage", (event) =>
          this.recordModelUsage(event).catch((error) =>
            this.logger.warn("quota.record_failed", { cause: error instanceof Error ? error.message : String(error) }),
          ),
        ),
      );
      this.disposers.push(this.registerCommands());
      this.started = true;
    } catch (error) {
      this.stop();
      throw error;
    }
  }

  public stop(): void {
    for (const dispose of this.disposers.splice(0).reverse()) {
      try {
        dispose();
      } catch {}
    }
    this.lastBlockedNotify.clear();
    this.pendingBlockedNotify.clear();
    this.started = false;
  }

  public async resolveModel(context: ChannelContext): Promise<string | void> {
    const override = await this.store.getOverride(scopeKey(context));
    if (override?.model) return override.model;
    for (const rule of this.config.quotaRules) {
      if (matchesQuotaRule(context, rule) && rule.model) return rule.model;
    }
    return this.config.defaultModel || undefined;
  }

  public async resolveLimit(context: ChannelContext): Promise<number | undefined> {
    const override = await this.store.getOverride(scopeKey(context));
    if (override?.dailyLimit !== undefined) return override.dailyLimit > 0 ? override.dailyLimit : undefined;
    for (const rule of this.config.quotaRules) {
      if (matchesQuotaRule(context, rule) && rule.dailyLimit !== undefined) return rule.dailyLimit > 0 ? rule.dailyLimit : undefined;
    }
    return this.config.defaultDailyLimit > 0 ? this.config.defaultDailyLimit : undefined;
  }

  private createMeter(context: ChannelContext): AgentPlugin {
    return {
      name: "quota.meter",
      init: async (runtime) => {
        const modelId = await this.resolveModel(context);
        if (modelId) runtime.setModel(this.ctx.yesimbot.model.resolveChatModel(modelId, context).model);
      },
      prepareStep: async (messages) => {
        if (!(await this.allow(context))) throw new Error("Quota exceeded");
        return messages;
      },
    };
  }

  private async recordModelUsage(event: ModelUsageEvent): Promise<void> {
    if (!event.context) return;
    await this.appendUsage(event.context, event.kind, event.modelId, normalizeUsage(event.usage));
  }

  private async appendUsage(context: ChannelContext, kind: QuotaUsageRecord["kind"], model: string, usage: TokenUsage): Promise<void> {
    const totalTokens = usage.inputTokens + usage.outputTokens;
    if (totalTokens <= 0) return;
    await this.store.append({
      t: Date.now(),
      scope: scopeKey(context),
      platform: context.platform,
      channelId: context.channelId,
      isDirect: context.type === "direct",
      model,
      kind,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      totalTokens,
    });
  }

  private async allow(context: ChannelContext): Promise<boolean> {
    const limit = await this.resolveLimit(context);
    if (!limit) return true;
    const used = (await this.store.cachedToday()).get(scopeKey(context))?.totalTokens ?? 0;
    if (used < limit) return true;
    await this.notifyBlocked(context, used, limit);
    return false;
  }

  private async notifyBlocked(context: ChannelContext, used: number, limit: number): Promise<void> {
    if (!this.config.sendBlockMessage) return;
    const key = scopeKey(context);
    const now = Date.now();
    if (now - (this.lastBlockedNotify.get(key) ?? 0) < this.config.notifyIntervalMs) return;
    if (this.pendingBlockedNotify.has(key)) return;
    this.pendingBlockedNotify.add(key);
    try {
      const maxDaily = Math.max(0, Math.floor(this.config.maxDailyBlockNotifications));
      if (maxDaily > 0 && (await this.store.getTodayNotificationCount(key)) >= maxDaily) return;
      const bot =
        context.type === "direct"
          ? this.ctx.bots.find((candidate) => candidate.platform === context.platform && candidate.selfId === context.selfId)
          : (this.ctx.bots.find((candidate) => candidate.platform === context.platform && (!context.selfId || candidate.selfId === context.selfId)) ??
            this.ctx.bots.find((candidate) => candidate.platform === context.platform));
      if (!bot) return;
      const text = this.config.blockMessage
        .replaceAll("{used}", formatTokens(used))
        .replaceAll("{limit}", formatTokens(limit))
        .replaceAll("{percent}", `${Math.min(100, Math.round((used / limit) * 100))}%`);
      await bot.sendMessage(context.channelId, text);
      this.lastBlockedNotify.set(key, now);
      await this.store.appendNotification({
        t: now,
        scope: key,
        platform: context.platform,
        channelId: context.channelId,
        isDirect: context.type === "direct",
      });
    } catch (error) {
      this.logger.warn("quota.notify_failed", { cause: error instanceof Error ? error.message : String(error), context });
    } finally {
      this.pendingBlockedNotify.delete(key);
    }
  }

  private registerCommands(): Disposer {
    const commands = [
      this.ctx.command("额度", "查看当前会话今日 token 消耗与限额", { authority: 0 }).action(async ({ session }) => {
        if (!session) return "请在会话中使用该指令。";
        const context = this.contextOf(session);
        if (!context) return "无法识别当前会话。";
        return this.isManagementGroup(session) ? this.renderEnabledGroups() : this.renderCurrent(context);
      }),
      this.ctx.command("额度.all", "查看所有会话今日 token 消耗排行", { authority: this.config.quotaAdminAuthority }).action(() => this.renderAll()),
      this.ctx
        .command("额度.set <target:string> <field:string> <value:string>", "设置会话限额或模型", { authority: this.config.quotaAdminAuthority })
        .action(async ({ session }, target, field, value) => {
          if (!session) return "请在会话中使用该指令。";
          const context = this.parseTarget(target);
          if (!context) return "目标格式错误：群号或 private:账号";
          if (field === "limit" || field === "dailyLimit") {
            const parsed = Number(value);
            if (!Number.isInteger(parsed) || parsed < 0) return "限额必须是 >= 0 的整数（0 = 不限额）。";
            await this.store.setOverride(scopeKey(context), { dailyLimit: parsed });
            return `已设置 ${this.describeScope(context)} 每日限额为 ${parsed > 0 ? `${formatTokens(parsed)} tokens` : "不限额"}。`;
          }
          if (field === "model") {
            if (!/^\S+:\S+$/.test(value)) return "模型格式错误，应为 provider:model。";
            await this.store.setOverride(scopeKey(context), { model: value });
            return `已设置 ${this.describeScope(context)} 模型为 ${value}（新会话运行时创建后生效）。`;
          }
          return "字段必须是 limit 或 model。";
        }),
      this.ctx
        .command("额度.clear <target:string> [field:string]", "清除会话的动态额度或模型覆盖", { authority: this.config.quotaAdminAuthority })
        .action(async ({ session }, target, field) => {
          if (!session) return "请在会话中使用该指令。";
          const context = this.parseTarget(target);
          if (!context) return "目标格式错误：群号或 private:账号";
          const key = scopeKey(context);
          if (field === "limit" || field === "dailyLimit") await this.store.clearOverride(key, "dailyLimit");
          else if (field === "model") await this.store.clearOverride(key, "model");
          else await this.store.clearOverride(key);
          return "已清除对应动态覆盖。";
        }),
      this.ctx
        .command("额度.history <target:string> [days:number]", "查看会话最近几天的消耗", { authority: this.config.quotaAdminAuthority })
        .action(async ({ session }, target, days) => {
          if (!session) return "请在会话中使用该指令。";
          const context = this.parseTarget(target);
          if (!context) return "目标格式错误：群号或 private:账号";
          const count = Math.min(30, Math.max(1, days || 7));
          const lines = [`${this.describeScope(context)} 最近 ${count} 天消耗：`];
          for (let index = count - 1; index >= 0; index -= 1) {
            const day = quotaDayKey(new Date(Date.now() - index * 86_400_000));
            const usage = (await this.store.readDay(day)).get(scopeKey(context));
            lines.push(`${day}：${usage ? `${formatTokens(usage.totalTokens)} tokens（${usage.calls} 次调用）` : "无记录"}`);
          }
          return lines.join("\n");
        }),
    ];
    return () => commands.forEach((command) => command.dispose());
  }

  private async renderCurrent(context: ChannelContext): Promise<string> {
    const usage = (await this.store.cachedToday()).get(scopeKey(context));
    const used = usage?.totalTokens ?? 0;
    const limit = await this.resolveLimit(context);
    const model = (await this.resolveModel(context)) ?? this.ctx.yesimbot.config.chatModel;
    const lines = [
      `【今日额度】${this.describeScope(context)}`,
      `已用：${formatTokens(used)}${limit ? ` / ${formatTokens(limit)}` : ""} tokens`,
      `模型：${model}`,
    ];
    const breakdown = usage ? this.kindBreakdown(usage) : "";
    if (breakdown) lines.splice(2, 0, breakdown);
    if (!limit) lines.push("本会话未设置限额。");
    else lines.push(`剩余：${formatTokens(Math.max(0, limit - used))} tokens · 今日 ${usage?.calls ?? 0} 次模型调用`);
    if (limit && used >= limit) lines.push("⚠ 今日额度已用完，明天 0 点重置。");
    return lines.join("\n");
  }

  private async renderAll(): Promise<string> {
    const today = await this.store.cachedToday();
    const scopes = new Map<string, ScopeUsage>();
    for (const usage of today.values()) scopes.set(usage.scope, usage);
    for (const rule of this.config.quotaRules) {
      if (rule.channelId === "*") continue;
      for (const context of this.contextsFromRule(rule)) {
        const key = scopeKey(context);
        if (!scopes.has(key)) {
          scopes.set(key, {
            scope: key,
            platform: context.platform,
            channelId: context.channelId,
            isDirect: context.type === "direct",
            model: "",
            inputTokens: 0,
            outputTokens: 0,
            totalTokens: 0,
            calls: 0,
            kindTokens: {},
          });
        }
      }
    }
    if (!scopes.size) return "今天还没有任何 token 消耗记录，也没有显式额度规则。";
    const lines = [`【今日额度总览】${quotaDayKey()}`, ""];
    const sorted = [...scopes.values()].sort((left, right) => right.totalTokens - left.totalTokens);
    for (const [index, usage] of sorted.entries()) {
      const context = this.contextFromUsage(usage);
      const limit = await this.resolveLimit(context);
      const model = ((await this.resolveModel(context)) ?? usage.model) || this.ctx.yesimbot.config.chatModel;
      lines.push(
        `${index + 1}. ${this.describeScope(context)}：${formatTokens(usage.totalTokens)} / ${limit ? formatTokens(limit) : "不限"} · ${usage.calls} 次 · ${model}`,
      );
    }
    return lines.join("\n");
  }

  private async renderEnabledGroups(): Promise<string> {
    const today = await this.store.cachedToday();
    const groups = new Map<string, { context: ChannelContext; name?: string }>();
    const add = (context: ChannelContext, name?: string) => {
      const key = scopeKey(context);
      const current = groups.get(key);
      if (!current) groups.set(key, { context, name });
      else if (!current.name && name) current.name = name;
    };
    for (const rule of this.ctx.yesimbot.config.allowedChannels ?? []) {
      if (rule.isDirect === true) continue;
      const bots = this.ctx.bots.filter((bot) => rule.platform === "*" || bot.platform === rule.platform);
      if (rule.channelId === "*") {
        for (const bot of bots) {
          try {
            for await (const guild of bot.getGuildIter()) {
              if (bot.platform && guild.id) add({ platform: bot.platform, type: "guild", channelId: guild.id, guildId: guild.id }, guild.name);
            }
          } catch (error) {
            this.logger.warn("quota.list_guilds_failed", { platform: bot.platform, cause: error instanceof Error ? error.message : String(error) });
          }
        }
      } else {
        const platforms = rule.platform === "*" ? [...new Set(bots.map((bot) => bot.platform))] : [rule.platform];
        for (const platform of platforms) {
          if (platform) add({ platform, type: "guild", channelId: rule.channelId, guildId: rule.channelId });
        }
      }
    }
    for (const usage of today.values()) {
      if (!usage.isDirect) add(this.contextFromUsage(usage));
    }
    if (!groups.size) return "没有找到已启用 YesImBot 的群。";
    const rows = await Promise.all(
      [...groups.values()].map(async (group) => ({ ...group, usage: today.get(scopeKey(group.context)), limit: await this.resolveLimit(group.context) })),
    );
    rows.sort((left, right) => (right.usage?.totalTokens ?? 0) - (left.usage?.totalTokens ?? 0));
    const lines = [`【YesImBot 群额度总览】${quotaDayKey()}`, `共 ${rows.length} 个群`, ""];
    for (const [index, row] of rows.entries()) {
      const title = row.name ? `${row.name}（${row.context.channelId}）` : `群 ${row.context.channelId}`;
      lines.push(
        `${index + 1}. ${title} [${row.context.platform}]：${formatTokens(row.usage?.totalTokens ?? 0)} / ${row.limit ? formatTokens(row.limit) : "不限"}`,
      );
    }
    return lines.join("\n");
  }

  private contextOf(session: Session): ChannelContext | undefined {
    if (!session.platform || !session.channelId) return undefined;
    if (session.isDirect) {
      if (!session.selfId || !session.userId) return undefined;
      return {
        type: "direct",
        platform: session.platform,
        channelId: session.channelId,
        selfId: session.selfId,
        userId: session.userId,
        userName: session.username,
      };
    }
    const guildId = session.guildId ?? session.channelId;
    return {
      type: guildId !== session.channelId ? "channel" : "guild",
      platform: session.platform,
      channelId: session.channelId,
      guildId,
      selfId: session.selfId,
    };
  }

  private parseTarget(target: string): ChannelContext | undefined {
    const value = target.trim();
    if (!value) return undefined;
    if (value.startsWith("private:")) {
      const userId = value.slice("private:".length);
      const bot = this.ctx.bots.find((candidate) => candidate.platform === "onebot");
      if (!userId || !bot) return undefined;
      return { type: "direct", platform: "onebot", channelId: value, selfId: bot.selfId, userId };
    }
    return { platform: "onebot", type: "guild", channelId: value, guildId: value };
  }

  private isManagementGroup(session: Session): boolean {
    return Boolean(
      this.config.managementGroupId &&
      !session.isDirect &&
      session.channelId === this.config.managementGroupId &&
      (this.config.managementGroupPlatform === "*" || session.platform === this.config.managementGroupPlatform),
    );
  }

  private contextFromUsage(usage: ScopeUsage): ChannelContext {
    if (usage.isDirect) {
      const selfId = this.ctx.bots.find((bot) => bot.platform === usage.platform)?.selfId ?? "unknown";
      return { type: "direct", platform: usage.platform, channelId: usage.channelId, selfId, userId: usage.channelId.replace(/^private:/, "") };
    }
    return { platform: usage.platform, type: "guild", channelId: usage.channelId, guildId: usage.channelId };
  }

  private contextsFromRule(rule: QuotaRule): ChannelContext[] {
    const platform = rule.platform === "*" ? "onebot" : rule.platform;
    if (rule.isDirect === true) {
      const selfId = this.ctx.bots.find((bot) => bot.platform === platform)?.selfId;
      if (!selfId) return [];
      const channelId = normalizeRuleChannelId(rule);
      const userId = channelId.replace(/^private:/, "");
      return [{ platform, type: "direct", channelId, selfId, userId }];
    }
    if (rule.isDirect === false) return [{ platform, type: "guild", channelId: rule.channelId, guildId: rule.channelId }];
    const shared: ChannelContext = { platform, type: "guild", channelId: rule.channelId, guildId: rule.channelId };
    const selfId = this.ctx.bots.find((bot) => bot.platform === platform)?.selfId;
    return selfId
      ? [shared, { platform, type: "direct", channelId: normalizeRuleChannelId(rule), selfId, userId: rule.channelId.replace(/^private:/, "") }]
      : [shared];
  }

  private describeScope(context: ChannelContext): string {
    const channelId = context.type === "direct" ? context.channelId.replace(/^private:/, "") : context.channelId;
    return `${context.type === "direct" ? "私聊" : "群"} ${channelId}`;
  }

  private kindBreakdown(usage: ScopeUsage): string {
    const labels: Record<string, string> = { chat: "对话", embedding: "嵌入" };
    const parts = Object.entries(usage.kindTokens)
      .filter(([, tokens]) => tokens > 0)
      .map(([kind, tokens]) => `${labels[kind] ?? kind} ${formatTokens(tokens)}`);
    return parts.length ? `明细：${parts.join(" · ")}` : "";
  }
}

export function scopeKey(context: ChannelContext): string {
  return `${context.platform}:${context.type === "direct" ? "direct" : "group"}:${context.channelId}`;
}

export function normalizeRuleChannelId(rule: QuotaRule): string {
  // direct 规则允许填裸账号（如 888888），规范化为平台实际使用的 private:<userId>
  if (rule.isDirect === true && rule.channelId !== "*" && !rule.channelId.startsWith("private:")) {
    return `private:${rule.channelId}`;
  }
  return rule.channelId;
}

export function matchesQuotaRule(context: ChannelContext, rule: QuotaRule): boolean {
  if (rule.platform !== "*" && rule.platform !== context.platform) return false;
  const ruleChannelId = context.type === "direct" ? normalizeRuleChannelId(rule) : rule.channelId;
  if (ruleChannelId !== "*" && ruleChannelId !== context.channelId) return false;
  return rule.isDirect === undefined || rule.isDirect === (context.type === "direct");
}

export function quotaDayKey(now = new Date()): string {
  // 与旧版一致：固定按上海时区计算每日边界
  const formatter = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" });
  return formatter.format(now);
}

export function formatTokens(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return String(value);
}

function normalizeUsage(usage: unknown): TokenUsage {
  const value = usage && typeof usage === "object" ? usage : {};
  const input = "inputTokens" in value ? value.inputTokens : undefined;
  const output = "outputTokens" in value ? value.outputTokens : undefined;
  const inputTotal = input && typeof input === "object" && "total" in input ? input.total : input;
  const outputTotal = output && typeof output === "object" && "total" in output ? output.total : output;
  return {
    inputTokens: typeof inputTotal === "number" && Number.isFinite(inputTotal) ? inputTotal : 0,
    outputTokens: typeof outputTotal === "number" && Number.isFinite(outputTotal) ? outputTotal : 0,
  };
}
