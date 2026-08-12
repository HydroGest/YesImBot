import type { ChannelContext, MessageRecord } from "koishi-plugin-yesimbot";

export type MemoryScope = "channel" | "user" | "shared";

export type MemoryType = "fact" | "preference" | "event" | "relationship" | "knowledge" | "experience";

export type MemoryStatus = "active" | "forgotten";

export interface Memory {
  readonly id: string;
  readonly type: MemoryType;
  readonly content: string;
  readonly scope: MemoryScope;
  readonly channelType?: ChannelContext["type"];
  readonly platform?: string;
  readonly guildId?: string;
  readonly channelId?: string;
  readonly selfId?: string;
  readonly userId?: string;
  readonly importance: number;
  readonly confidence: number;
  readonly tags: string[];
  readonly status: MemoryStatus;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly lastAccessedAt: number;
  readonly accessCount: number;
  readonly forgottenAt?: number;
  readonly embedding?: number[];
  readonly embeddingModel?: string;
}

export interface MemoryRow extends Omit<
  Memory,
  "channelType" | "platform" | "guildId" | "channelId" | "selfId" | "userId" | "forgottenAt" | "embedding" | "embeddingModel"
> {
  readonly channelType: ChannelContext["type"] | null;
  readonly platform: string | null;
  readonly guildId: string | null;
  readonly channelId: string | null;
  readonly selfId: string | null;
  readonly userId: string | null;
  readonly forgottenAt: number | null;
  readonly embedding: number[] | null;
  readonly embeddingModel: string | null;
}

export interface MemoryCreateInput {
  readonly type: MemoryType;
  readonly content: string;
  readonly scope: MemoryScope;
  readonly context?: ChannelContext;
  readonly platform?: string;
  readonly userId?: string;
  readonly importance: number;
  readonly confidence: number;
  readonly tags: string[];
  readonly embedding?: number[];
  readonly embeddingModel?: string;
}

export interface MemoryUpdateInput extends Partial<Omit<MemoryCreateInput, "scope" | "context">> {
  readonly scope?: MemoryScope;
  readonly context?: ChannelContext;
}

export interface MemoryQuery {
  readonly query?: string;
  readonly tags?: string[];
  readonly scopes?: MemoryScope[];
  readonly types?: MemoryType[];
  readonly limit?: number;
}

declare module "koishi" {
  interface Tables {
    yesimbot_memory: MemoryRow;
  }
}

export interface MemoryEvidence {
  readonly memoryId: string;
  readonly messages: MessageRecord[];
}

export interface PendingMemory {
  readonly id: string;
  readonly content: string;
  readonly sources: string[];
  readonly scope?: MemoryScope;
  readonly channel: ChannelContext;
  readonly turnId: string;
  readonly messageCount: number;
  readonly queuedAt: number;
  readonly attempts: number;
  readonly nextAttemptAt: number;
  readonly lastError?: string;
  readonly suspended: boolean;
}

export interface MemoryRecall {
  readonly id: string;
  readonly type: MemoryType;
  readonly content: string;
  readonly scope: MemoryScope;
  readonly importance: number;
  readonly confidence: number;
  readonly updatedAt: number;
  readonly relativeTime: string;
  readonly evidenceCount: number;
}

export interface MemorySearchReport {
  readonly answer: string;
  readonly memories: MemoryRecall[];
  readonly unresolved: string[];
}

export interface MemorizerConfig {
  readonly model: string;
  readonly embeddingModel?: string;
  readonly storageDir?: string;
  readonly batchDelayMs?: number;
  readonly maxPendingPerBatch?: number;
  readonly maxMessagesPerBatch?: number;
  readonly searchTimeoutMs?: number;
  readonly halfLifeDays?: number;
  readonly forgottenGraceDays?: number;
  readonly maxActivePerScope?: number;
}

export function toMemoryRecall(memory: Memory, now: number, evidenceCount: number): MemoryRecall {
  return {
    id: memory.id,
    type: memory.type,
    content: memory.content,
    scope: memory.scope,
    importance: memory.importance,
    confidence: memory.confidence,
    updatedAt: memory.updatedAt,
    relativeTime: formatRelativeTime(now - memory.updatedAt),
    evidenceCount,
  };
}

/** Per-type decay multiplier applied to halfLifeDays. Higher = slower decay. */
export const TYPE_DECAY_FACTOR: Record<MemoryType, number> = {
  fact: 1.0,
  preference: 1.2,
  event: 0.6,
  relationship: 1.5,
  knowledge: 2.0,
  experience: 1.0,
};

export function retentionScore(memory: Pick<Memory, "type" | "importance" | "lastAccessedAt" | "accessCount">, now: number, halfLifeDays: number): number {
  const factor = TYPE_DECAY_FACTOR[memory.type] ?? 1.0;
  const effectiveHalfLife = halfLifeDays * factor;
  const age = Math.max(0, now - memory.lastAccessedAt);
  const decay = 2 ** (-age / (effectiveHalfLife * 24 * 60 * 60 * 1_000));
  const frequency = Math.min(2, 1 + Math.log(1 + memory.accessCount) / 4);
  return memory.importance * decay * frequency;
}

function formatRelativeTime(age: number): string {
  const seconds = Math.max(0, Math.floor(age / 1_000));
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}
