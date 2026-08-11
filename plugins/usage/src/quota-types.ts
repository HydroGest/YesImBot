import type { ChannelContext } from "koishi-plugin-yesimbot";

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
  kind: "turn" | "compact" | "vision";
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
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return formatter.format(now);
}

export function formatTokens(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return String(value);
}
