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

export function matchesQuotaRule(context: ChannelContext, rule: QuotaRule): boolean {
  if (rule.platform !== "*" && rule.platform !== context.platform) return false;
  if (rule.channelId !== "*" && rule.channelId !== context.channelId) return false;
  return rule.isDirect === undefined || rule.isDirect === (context.type === "direct");
}

export function quotaDayKey(now = new Date()): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function formatTokens(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return String(value);
}
