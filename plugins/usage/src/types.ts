export interface NormalizedUsage {
  inputTokens: number;
  outputTokens: number;
  noCacheTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export interface TokenCounts extends NormalizedUsage {
  calls: number;
}

export interface RateSnapshot {
  inputPerMinute: number;
  outputPerMinute: number;
  totalPerMinute: number;
  noCachePerMinute: number;
  cacheReadPerMinute: number;
}

export interface UsageByModel {
  model: string;
  kind: "chat" | "embedding";
  counts: TokenCounts;
}

export interface UsagePayload {
  today: TokenCounts;
  recent: Array<TokenCounts & { date: number }>;
  byHour: Array<TokenCounts & { hour: number }>;
  byModel: UsageByModel[];
  rate: RateSnapshot;
}

export interface UsageHistorySnapshot {
  recent: Array<TokenCounts & { date: number }>;
  byHour: Array<TokenCounts & { hour: number }>;
}

export interface UsageHistorySource {
  scan(config: UsageConfig): Promise<UsageHistorySnapshot>;
}

export interface UsageRow {
  date: number;
  hour: number;
  provider: string;
  model: string;
  kind: "chat" | "embedding";
  calls: number;
  inputTokens: number;
  outputTokens: number;
  noCacheTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export interface UsageRecordInput {
  providerId: string;
  modelId: string;
  timestamp: number;
  kind: "chat" | "embedding";
  usage: NormalizedUsage;
}

export interface UsageConfig {
  historySource: "jsonl" | "database";
  recentDayCount: number;
  refreshInterval: number;
  rateWindowSeconds: number;
  quotaEnabled: boolean;
  quotaStorageDir: string;
  defaultDailyLimit: number;
  defaultModel: string;
  quotaRules: import("./quota-types.js").QuotaRule[];
  managementGroupId: string;
  managementGroupPlatform: string;
  sendBlockMessage: boolean;
  maxDailyBlockNotifications: number;
  blockMessage: string;
  notifyIntervalMs: number;
  quotaAdminAuthority: number;
}
