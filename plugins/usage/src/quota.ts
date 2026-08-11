import { resolve } from "node:path";

import type { AgentPlugin, TurnResult } from "@yesimbot/agent-runtime";
import type { Context, Logger, Session } from "koishi";
import type { ChannelContext, UsageReport } from "koishi-plugin-yesimbot";

import { normalizeLanguageUsage } from "./middleware.js";
import { QuotaStore } from "./quota-store.js";
import { formatTokens, matchesQuotaRule, quotaDayKey, scopeKey, type QuotaRule, type ScopeUsage } from "./quota-types.js";
import type { UsageConfig } from "./types.js";

type Disposer = () => unknown;

export class QuotaManager {
  private readonly store: QuotaStore;
  private readonly disposers: Disposer[] = [];
  private readonly lastBlockedNotify = new Map<string, number>();
  private readonly pendingBlockedNotify = new Set<string>();
  private started = false;

  public constructor(
    private readonly ctx: Context,
    private readonly config: UsageConfig,
    private readonly logger: Logger,
  ) {
    this.store = new QuotaStore(resolve(ctx.baseDir, config.quotaStorageDir || "data/yesimbot/quota"), logger);
  }

  public async start(): Promise<void> {
    if (this.started) return;
    await this.store.init();
    try {
      this.disposers.push(this.ctx.yesimbot.agent.model((context) => this.resolveModel(context)));
      this.disposers.push(this.ctx.yesimbot.agent.use({ setup: (context, _bot, pluginContext) => this.createMeter(context, pluginContext?.modelId) }));
      this.disposers.push(this.ctx.yesimbot.agent.usage((context, report) => this.recordReport(context, report)));
      this.disposers.push(this.ctx.yesimbot.agent.guard((context) => this.allow(context)));
      this.disposers.push(this.registerCommands());
      this.started = true;
    } catch (cause) {
      this.stop();
      throw cause;
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

  private createMeter(context: ChannelContext, modelId?: string): AgentPlugin {
    return { name: "usage.quota-meter", onTurnFinish: (result) => this.recordTurn(context, modelId, result) };
  }

  private async recordTurn(context: ChannelContext, modelId: string | undefined, result: TurnResult): Promise<void> {
    const usage = normalizeLanguageUsage(result.usage);
    await this.appendUsage(context, "turn", modelId ?? this.ctx.yesimbot.config.chatModel, usage);
  }

  private async recordReport(context: ChannelContext, report: UsageReport): Promise<void> {
    await this.appendUsage(context, report.kind, report.modelId ?? report.kind, normalizeLanguageUsage(report.usage));
  }

  private async appendUsage(
    context: ChannelContext,
    kind: "turn" | "compact" | "vision",
    model: string,
    usage: ReturnType<typeof normalizeLanguageUsage>,
  ): Promise<void> {
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
    if (!this.config.quotaEnabled) return true;
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
      const bot = context.type === "direct"
        ? this.ctx.bots.find((candidate) => candidate.platform === context.platform && candidate.selfId === context.selfId)
        : this.ctx.bots.find((candidate) => candidate.platform === context.platform);
      if (!bot) return;
      const text = this.config.blockMessage
        .replaceAll("{used}", formatTokens(used))
        .replaceAll("{limit}", formatTokens(limit))
        .replaceAll("{percent}", `${Math.min(100, Math.round((used / limit) * 100))}%`);
      await bot.sendMessage(context.channelId, text);
      this.lastBlockedNotify.set(key, now);
      await this.store.appendNotification({ t: now, scope: key, platform: context.platform, channelId: context.channelId, isDirect: context.type === "direct" });
    } catch (cause) {
      this.logger.warn("quota.notify_failed", { cause: cause instanceof Error ? cause.message : String(cause), context });
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
          } catch (cause) {
            this.logger.warn("quota.list_guilds_failed", { platform: bot.platform, cause: cause instanceof Error ? cause.message : String(cause) });
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
      return { type: "direct", platform: session.platform, channelId: session.channelId, selfId: session.selfId, userId: session.userId, userName: session.username };
    }
    const guildId = session.guildId ?? session.channelId;
    return {
      type: guildId !== session.channelId ? "channel" : "guild",
      platform: session.platform,
      channelId: session.channelId,
      guildId,
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
      const userId = rule.channelId.replace(/^private:/, "");
      return [{ platform, type: "direct", channelId: rule.channelId, selfId, userId }];
    }
    if (rule.isDirect === false) return [{ platform, type: "guild", channelId: rule.channelId, guildId: rule.channelId }];
    const shared: ChannelContext = { platform, type: "guild", channelId: rule.channelId, guildId: rule.channelId };
    const selfId = this.ctx.bots.find((bot) => bot.platform === platform)?.selfId;
    return selfId ? [shared, { platform, type: "direct", channelId: rule.channelId, selfId, userId: rule.channelId.replace(/^private:/, "") }] : [shared];
  }

  private describeScope(context: ChannelContext): string {
    const channelId = context.type === "direct" ? context.channelId.replace(/^private:/, "") : context.channelId;
    return `${context.type === "direct" ? "私聊" : "群"} ${channelId}`;
  }

  private kindBreakdown(usage: ScopeUsage): string {
    const labels: Record<string, string> = { turn: "对话", compact: "压缩", vision: "识图" };
    const parts = Object.entries(usage.kindTokens)
      .filter(([, tokens]) => tokens > 0)
      .map(([kind, tokens]) => `${labels[kind] ?? kind} ${formatTokens(tokens)}`);
    return parts.length ? `明细：${parts.join(" · ")}` : "";
  }
}

export type { QuotaRule };
