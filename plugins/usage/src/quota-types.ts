import type { ChannelScope } from "koishi-plugin-yesimbot";

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

export function scopeKey(scope: ChannelScope): string {
  return `${scope.platform}:${scope.type === "direct" ? "direct" : "group"}:${scope.channelId}`;
}

export function matchesQuotaRule(scope: ChannelScope, rule: QuotaRule): boolean {
  if (rule.platform !== "*" && rule.platform !== scope.platform) return false;
  if (rule.channelId !== "*" && rule.channelId !== scope.channelId) return false;
  return rule.isDirect === undefined || rule.isDirect === (scope.type === "direct");
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
