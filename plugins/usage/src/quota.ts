import { resolve } from "node:path";

import type { AgentPlugin, TurnResult } from "@yesimbot/agent-runtime";
import type { Context, Logger, Session } from "koishi";
import type { ChannelScope, UsageReport } from "koishi-plugin-yesimbot";

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
      this.disposers.push(this.ctx.yesimbot.agent.model((scope) => this.resolveModel(scope)));
      this.disposers.push(this.ctx.yesimbot.agent.use({ setup: (scope, _bot, context) => this.createMeter(scope, context?.modelId) }));
      this.disposers.push(this.ctx.yesimbot.agent.usage((scope, report) => this.recordReport(scope, report)));
      this.disposers.push(this.ctx.yesimbot.agent.guard((scope) => this.allow(scope)));
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

  public async resolveModel(scope: ChannelScope): Promise<string | void> {
    const override = await this.store.getOverride(scopeKey(scope));
    if (override?.model) return override.model;
    for (const rule of this.config.quotaRules) {
      if (matchesQuotaRule(scope, rule) && rule.model) return rule.model;
    }
    return this.config.defaultModel || undefined;
  }

  public async resolveLimit(scope: ChannelScope): Promise<number | undefined> {
    const override = await this.store.getOverride(scopeKey(scope));
    if (override?.dailyLimit !== undefined) return override.dailyLimit > 0 ? override.dailyLimit : undefined;
    for (const rule of this.config.quotaRules) {
      if (matchesQuotaRule(scope, rule) && rule.dailyLimit !== undefined) return rule.dailyLimit > 0 ? rule.dailyLimit : undefined;
    }
    return this.config.defaultDailyLimit > 0 ? this.config.defaultDailyLimit : undefined;
  }

  private createMeter(scope: ChannelScope, modelId?: string): AgentPlugin {
    return { name: "usage.quota-meter", onTurnFinish: (result) => this.recordTurn(scope, modelId, result) };
  }

  private async recordTurn(scope: ChannelScope, modelId: string | undefined, result: TurnResult): Promise<void> {
    const usage = normalizeLanguageUsage(result.usage);
    await this.appendUsage(scope, "turn", modelId ?? this.ctx.yesimbot.config.chatModel, usage);
  }

  private async recordReport(scope: ChannelScope, report: UsageReport): Promise<void> {
    await this.appendUsage(scope, report.kind, report.modelId ?? report.kind, normalizeLanguageUsage(report.usage));
  }

  private async appendUsage(
    scope: ChannelScope,
    kind: "turn" | "compact" | "vision",
    model: string,
    usage: ReturnType<typeof normalizeLanguageUsage>,
  ): Promise<void> {
    const totalTokens = usage.inputTokens + usage.outputTokens;
    if (totalTokens <= 0) return;
    await this.store.append({
      t: Date.now(),
      scope: scopeKey(scope),
      platform: scope.platform,
      channelId: scope.channelId,
      isDirect: scope.type === "direct",
      model,
      kind,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      totalTokens,
    });
  }

  private async allow(scope: ChannelScope): Promise<boolean> {
    if (!this.config.quotaEnabled) return true;
    const limit = await this.resolveLimit(scope);
    if (!limit) return true;
    const used = (await this.store.cachedToday()).get(scopeKey(scope))?.totalTokens ?? 0;
    if (used < limit) return true;
    await this.notifyBlocked(scope, used, limit);
    return false;
  }

  private async notifyBlocked(scope: ChannelScope, used: number, limit: number): Promise<void> {
    if (!this.config.sendBlockMessage) return;
    const key = scopeKey(scope);
    const now = Date.now();
    if (now - (this.lastBlockedNotify.get(key) ?? 0) < this.config.notifyIntervalMs) return;
    if (this.pendingBlockedNotify.has(key)) return;
    this.pendingBlockedNotify.add(key);
    try {
      const maxDaily = Math.max(0, Math.floor(this.config.maxDailyBlockNotifications));
      if (maxDaily > 0 && (await this.store.getTodayNotificationCount(key)) >= maxDaily) return;
      const selfId = scope.type === "direct" ? scope.selfId : undefined;
      const bot = this.ctx.bots.find((candidate) => candidate.platform === scope.platform && (!selfId || candidate.selfId === selfId));
      if (!bot) return;
      const text = this.config.blockMessage
        .replaceAll("{used}", formatTokens(used))
        .replaceAll("{limit}", formatTokens(limit))
        .replaceAll("{percent}", `${Math.min(100, Math.round((used / limit) * 100))}%`);
      await bot.sendMessage(scope.channelId, text);
      this.lastBlockedNotify.set(key, now);
      await this.store.appendNotification({ t: now, scope: key, platform: scope.platform, channelId: scope.channelId, isDirect: scope.type === "direct" });
    } catch (cause) {
      this.logger.warn("quota.notify_failed", { cause: cause instanceof Error ? cause.message : String(cause), scope });
    } finally {
      this.pendingBlockedNotify.delete(key);
    }
  }

  private registerCommands(): Disposer {
    const commands = [
      this.ctx.command("额度", "查看当前会话今日 token 消耗与限额", { authority: 0 }).action(async ({ session }) => {
        if (!session) return "请在会话中使用该指令。";
        const scope = this.scopeOf(session);
        if (!scope) return "无法识别当前会话。";
        return this.isManagementGroup(session) ? this.renderEnabledGroups() : this.renderCurrent(scope);
      }),
      this.ctx.command("额度.all", "查看所有会话今日 token 消耗排行", { authority: this.config.quotaAdminAuthority }).action(() => this.renderAll()),
      this.ctx
        .command("额度.set <target:string> <field:string> <value:string>", "设置会话限额或模型", { authority: this.config.quotaAdminAuthority })
        .action(async ({ session }, target, field, value) => {
          if (!session) return "请在会话中使用该指令。";
          const scope = this.parseTarget(target);
          if (!scope) return "目标格式错误：群号或 private:账号";
          if (field === "limit" || field === "dailyLimit") {
            const parsed = Number(value);
            if (!Number.isInteger(parsed) || parsed < 0) return "限额必须是 >= 0 的整数（0 = 不限额）。";
            await this.store.setOverride(scopeKey(scope), { dailyLimit: parsed });
            return `已设置 ${this.describeScope(scope)} 每日限额为 ${parsed > 0 ? `${formatTokens(parsed)} tokens` : "不限额"}。`;
          }
          if (field === "model") {
            if (!/^\S+:\S+$/.test(value)) return "模型格式错误，应为 provider:model。";
            await this.store.setOverride(scopeKey(scope), { model: value });
            return `已设置 ${this.describeScope(scope)} 模型为 ${value}（新会话运行时创建后生效）。`;
          }
          return "字段必须是 limit 或 model。";
        }),
      this.ctx
        .command("额度.clear <target:string> [field:string]", "清除会话的动态额度或模型覆盖", { authority: this.config.quotaAdminAuthority })
        .action(async ({ session }, target, field) => {
          if (!session) return "请在会话中使用该指令。";
          const scope = this.parseTarget(target);
          if (!scope) return "目标格式错误：群号或 private:账号";
          const key = scopeKey(scope);
          if (field === "limit" || field === "dailyLimit") await this.store.clearOverride(key, "dailyLimit");
          else if (field === "model") await this.store.clearOverride(key, "model");
          else await this.store.clearOverride(key);
          return "已清除对应动态覆盖。";
        }),
      this.ctx
        .command("额度.history <target:string> [days:number]", "查看会话最近几天的消耗", { authority: this.config.quotaAdminAuthority })
        .action(async ({ session }, target, days) => {
          if (!session) return "请在会话中使用该指令。";
          const scope = this.parseTarget(target);
          if (!scope) return "目标格式错误：群号或 private:账号";
          const count = Math.min(30, Math.max(1, days || 7));
          const lines = [`${this.describeScope(scope)} 最近 ${count} 天消耗：`];
          for (let index = count - 1; index >= 0; index -= 1) {
            const day = quotaDayKey(new Date(Date.now() - index * 86_400_000));
            const usage = (await this.store.readDay(day)).get(scopeKey(scope));
            lines.push(`${day}：${usage ? `${formatTokens(usage.totalTokens)} tokens（${usage.calls} 次调用）` : "无记录"}`);
          }
          return lines.join("\n");
        }),
    ];
    return () => commands.forEach((command) => command.dispose());
  }

  private async renderCurrent(scope: ChannelScope): Promise<string> {
    const usage = (await this.store.cachedToday()).get(scopeKey(scope));
    const used = usage?.totalTokens ?? 0;
    const limit = await this.resolveLimit(scope);
    const model = (await this.resolveModel(scope)) ?? this.ctx.yesimbot.config.chatModel;
    const lines = [
      `【今日额度】${this.describeScope(scope)}`,
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
      for (const scope of this.scopesFromRule(rule)) {
        const key = scopeKey(scope);
        if (!scopes.has(key)) {
          scopes.set(key, {
            scope: key,
            platform: scope.platform,
            channelId: scope.channelId,
            isDirect: scope.type === "direct",
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
      const scope = this.scopeFromUsage(usage);
      const limit = await this.resolveLimit(scope);
      const model = ((await this.resolveModel(scope)) ?? usage.model) || this.ctx.yesimbot.config.chatModel;
      lines.push(
        `${index + 1}. ${this.describeScope(scope)}：${formatTokens(usage.totalTokens)} / ${limit ? formatTokens(limit) : "不限"} · ${usage.calls} 次 · ${model}`,
      );
    }
    return lines.join("\n");
  }

  private async renderEnabledGroups(): Promise<string> {
    const today = await this.store.cachedToday();
    const groups = new Map<string, { scope: ChannelScope; name?: string }>();
    const add = (scope: ChannelScope, name?: string) => {
      const key = scopeKey(scope);
      const current = groups.get(key);
      if (!current) groups.set(key, { scope, name });
      else if (!current.name && name) current.name = name;
    };
    for (const rule of this.ctx.yesimbot.config.allowedChannels ?? []) {
      if (rule.isDirect === true) continue;
      const bots = this.ctx.bots.filter((bot) => rule.platform === "*" || bot.platform === rule.platform);
      if (rule.channelId === "*") {
        for (const bot of bots) {
          try {
            for await (const guild of bot.getGuildIter()) {
              if (bot.platform && guild.id) add({ platform: bot.platform, type: "shared", channelId: guild.id }, guild.name);
            }
          } catch (cause) {
            this.logger.warn("quota.list_guilds_failed", { platform: bot.platform, cause: cause instanceof Error ? cause.message : String(cause) });
          }
        }
      } else {
        const platforms = rule.platform === "*" ? [...new Set(bots.map((bot) => bot.platform))] : [rule.platform];
        for (const platform of platforms) {
          if (platform) add({ platform, type: "shared", channelId: rule.channelId });
        }
      }
    }
    for (const usage of today.values()) {
      if (!usage.isDirect) add(this.scopeFromUsage(usage));
    }
    if (!groups.size) return "没有找到已启用 YesImBot 的群。";
    const rows = await Promise.all(
      [...groups.values()].map(async (group) => ({ ...group, usage: today.get(scopeKey(group.scope)), limit: await this.resolveLimit(group.scope) })),
    );
    rows.sort((left, right) => (right.usage?.totalTokens ?? 0) - (left.usage?.totalTokens ?? 0));
    const lines = [`【YesImBot 群额度总览】${quotaDayKey()}`, `共 ${rows.length} 个群`, ""];
    for (const [index, row] of rows.entries()) {
      const title = row.name ? `${row.name}（${row.scope.channelId}）` : `群 ${row.scope.channelId}`;
      lines.push(
        `${index + 1}. ${title} [${row.scope.platform}]：${formatTokens(row.usage?.totalTokens ?? 0)} / ${row.limit ? formatTokens(row.limit) : "不限"}`,
      );
    }
    return lines.join("\n");
  }

  private scopeOf(session: Session): ChannelScope | undefined {
    if (!session.platform || !session.channelId) return;
    return session.isDirect
      ? session.selfId
        ? { platform: session.platform, selfId: session.selfId, type: "direct", channelId: session.channelId }
        : undefined
      : { platform: session.platform, type: "shared", channelId: session.channelId };
  }

  private parseTarget(target: string): ChannelScope | undefined {
    const value = target.trim();
    if (!value) return;
    if (value.startsWith("private:")) {
      const channelId = value.slice("private:".length);
      const bot = this.ctx.bots.find((candidate) => candidate.platform === "onebot");
      return channelId && bot ? { platform: "onebot", selfId: bot.selfId, type: "direct", channelId } : undefined;
    }
    return { platform: "onebot", type: "shared", channelId: value };
  }

  private isManagementGroup(session: Session): boolean {
    return Boolean(
      this.config.managementGroupId &&
      !session.isDirect &&
      session.channelId === this.config.managementGroupId &&
      (this.config.managementGroupPlatform === "*" || session.platform === this.config.managementGroupPlatform),
    );
  }

  private scopeFromUsage(usage: ScopeUsage): ChannelScope {
    if (usage.isDirect) {
      const selfId = this.ctx.bots.find((bot) => bot.platform === usage.platform)?.selfId ?? "unknown";
      return { platform: usage.platform, selfId, type: "direct", channelId: usage.channelId };
    }
    return { platform: usage.platform, type: "shared", channelId: usage.channelId };
  }

  private scopesFromRule(rule: QuotaRule): ChannelScope[] {
    const platform = rule.platform === "*" ? "onebot" : rule.platform;
    if (rule.isDirect === true) {
      const selfId = this.ctx.bots.find((bot) => bot.platform === platform)?.selfId;
      return selfId ? [{ platform, selfId, type: "direct", channelId: rule.channelId }] : [];
    }
    if (rule.isDirect === false) return [{ platform, type: "shared", channelId: rule.channelId }];
    const shared: ChannelScope = { platform, type: "shared", channelId: rule.channelId };
    const selfId = this.ctx.bots.find((bot) => bot.platform === platform)?.selfId;
    return selfId ? [shared, { platform, selfId, type: "direct", channelId: rule.channelId }] : [shared];
  }

  private describeScope(scope: ChannelScope): string {
    return `${scope.type === "direct" ? "私聊" : "群"} ${scope.channelId}`;
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
