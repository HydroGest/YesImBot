import { randomUUID } from "node:crypto";

import type { Context, Field, Types } from "koishi";
import type { ChannelContext } from "koishi-plugin-yesimbot";

import {
  retentionScore,
  type Memory,
  type MemoryCreateInput,
  type MemoryQuery,
  type MemoryRow,
  type MemoryScope,
  type MemoryType,
  type MemoryUpdateInput,
} from "../types.js";

export const MEMORY_TABLE = "yesimbot_memory";

const MEMORY_FIELDS = {
  id: "string",
  type: "string",
  content: "text",
  scope: "string",
  channelType: { type: "string", nullable: true, initial: null },
  platform: { type: "string", nullable: true, initial: null },
  guildId: { type: "string", nullable: true, initial: null },
  channelId: { type: "string", nullable: true, initial: null },
  selfId: { type: "string", nullable: true, initial: null },
  userId: { type: "string", nullable: true, initial: null },
  importance: "double",
  confidence: "double",
  tags: "json",
  status: "string",
  createdAt: "unsigned",
  updatedAt: "unsigned",
  lastAccessedAt: "unsigned",
  accessCount: "unsigned",
  forgottenAt: { type: "unsigned", nullable: true, initial: null },
  embedding: { type: "json", nullable: true, initial: null },
  embeddingModel: { type: "string", nullable: true, initial: null },
} satisfies Field.Extension<MemoryRow, Types>;

type MemoryModel = Pick<Context["model"], "extend" | "get" | "create" | "set" | "remove">;

export class MemoryStore {
  private mutationTail: Promise<void> = Promise.resolve();

  public constructor(private readonly model: MemoryModel) {}
  public create(input: MemoryCreateInput, id = randomUUID()): Promise<Memory> {
    return this.mutate(async () => {
      const now = Date.now();
      const row = toRow({ id, ...input, status: "active", createdAt: now, updatedAt: now, lastAccessedAt: now, accessCount: 0 });
      await this.model.create(MEMORY_TABLE, row);
      return fromRow(row);
    });
  }

  public get(id: string): Promise<Memory | undefined> {
    return this.mutate(async () => {
      const row = ((await this.model.get(MEMORY_TABLE, { id })) as MemoryRow[])[0];
      return row && fromRow(row);
    });
  }

  public update(id: string, input: MemoryUpdateInput): Promise<Memory> {
    return this.mutate(async () => {
      const existing = await this.require(id);
      const next = toRow({
        ...existing,
        ...input,
        id,
        status: existing.status,
        createdAt: existing.createdAt,
        updatedAt: Date.now(),
        lastAccessedAt: existing.lastAccessedAt,
        accessCount: existing.accessCount,
      });
      await this.model.set(MEMORY_TABLE, { id }, next);
      return fromRow(next);
    });
  }

  public merge(canonicalId: string, mergedId: string, input: MemoryUpdateInput): Promise<Memory> {
    return this.mutate(async () => {
      await this.require(mergedId);
      const canonical = await this.require(canonicalId);
      const next = toRow({
        ...canonical,
        ...input,
        id: canonicalId,
        status: canonical.status,
        createdAt: canonical.createdAt,
        updatedAt: Date.now(),
        lastAccessedAt: canonical.lastAccessedAt,
        accessCount: canonical.accessCount,
      });
      await this.model.set(MEMORY_TABLE, { id: canonicalId }, next);
      await this.model.remove(MEMORY_TABLE, { id: mergedId });
      return fromRow(next);
    });
  }

  public forget(id: string, _reason: string, now = Date.now()): Promise<Memory> {
    return this.mutate(async () => {
      const memory = await this.require(id);
      const next = { ...memory, status: "forgotten" as const, forgottenAt: now, updatedAt: now };
      await this.model.set(MEMORY_TABLE, { id }, toRow(next));
      return next;
    });
  }

  public restore(id: string, now = Date.now()): Promise<Memory> {
    return this.mutate(async () => {
      const memory = await this.require(id);
      const next = { ...memory, status: "active" as const, forgottenAt: undefined, updatedAt: now };
      await this.model.set(MEMORY_TABLE, { id }, toRow(next));
      return next;
    });
  }

  public queryVisible(context: ChannelContext, userIds: readonly string[], query: MemoryQuery = {}): Promise<Memory[]> {
    return this.mutate(async () => {
      const scopes = query.scopes ?? ["channel", "user", "shared"];
      const terms = query.query?.toLocaleLowerCase();
      const requiredTags = query.tags ?? [];
      const rows = (await this.model.get(MEMORY_TABLE, {})) as MemoryRow[];
      const memories = rows
        .map(fromRow)
        .filter((memory) => {
          if (memory.status !== "active" || !scopes.includes(memory.scope) || !isVisible(memory, context, userIds)) return false;
          if (query.types && !query.types.includes(memory.type)) return false;
          if (terms && !`${memory.content}\n${memory.tags.join("\n")}`.toLocaleLowerCase().includes(terms)) return false;
          return requiredTags.every((tag) => memory.tags.includes(tag));
        })
        .sort((left, right) => retentionScore(right, Date.now(), 90) * right.confidence - retentionScore(left, Date.now(), 90) * left.confidence);
      return query.limit === undefined ? memories : memories.slice(0, query.limit);
    });
  }

  public touch(ids: readonly string[], now = Date.now()): Promise<void> {
    return this.mutate(async () => {
      for (const id of ids) {
        const memory = await this.require(id);
        await this.model.set(MEMORY_TABLE, { id }, { lastAccessedAt: now, accessCount: memory.accessCount + 1, updatedAt: now });
      }
    });
  }

  public sweep(now: number, options: PruneOptions, removeEvidence: (memoryId: string) => Promise<void>): Promise<void> {
    return this.mutate(async () => {
      const memories = ((await this.model.get(MEMORY_TABLE, {})) as MemoryRow[]).map(fromRow);
      const plan = planPrune(memories, now, options);
      for (const id of plan.forgetIds) {
        await this.model.set(MEMORY_TABLE, { id }, { status: "forgotten", forgottenAt: now, updatedAt: now });
      }
      for (const id of plan.removeIds) {
        await removeEvidence(id);
        await this.model.remove(MEMORY_TABLE, { id });
      }
    });
  }

  private mutate<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.mutationTail.then(operation, operation);
    this.mutationTail = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  private async require(id: string): Promise<Memory> {
    const row = ((await this.model.get(MEMORY_TABLE, { id })) as MemoryRow[])[0];
    if (!row) throw new Error(`memory ${id} not found`);
    return fromRow(row);
  }
}

export interface PruneOptions {
  readonly halfLifeDays: number;
  readonly forgottenGraceDays: number;
  readonly maxActivePerScope: number;
}

export interface PrunePlan {
  readonly forgetIds: string[];
  readonly removeIds: string[];
}

export function planPrune(memories: readonly Memory[], now: number, options: PruneOptions): PrunePlan {
  const forgetIds = new Set<string>();
  const removeIds: string[] = [];
  const grace = options.forgottenGraceDays * 24 * 60 * 60 * 1_000;
  const activeByScope = new Map<string, Memory[]>();
  for (const memory of memories) {
    if (memory.status === "forgotten") {
      if (memory.forgottenAt !== undefined && memory.forgottenAt + grace <= now) removeIds.push(memory.id);
      continue;
    }
    const score = retentionScore(memory, now, options.halfLifeDays) * memory.confidence;
    if (score < 0.05) forgetIds.add(memory.id);
    const key = `${memory.scope}\u0000${memory.platform ?? ""}\u0000${memory.channelId ?? ""}\u0000${memory.selfId ?? ""}\u0000${memory.userId ?? ""}`;
    const group = activeByScope.get(key) ?? [];
    group.push(memory);
    activeByScope.set(key, group);
  }
  for (const group of activeByScope.values()) {
    group.sort(
      (left, right) => retentionScore(right, now, options.halfLifeDays) * right.confidence - retentionScore(left, now, options.halfLifeDays) * left.confidence,
    );
    for (const memory of group.slice(options.maxActivePerScope)) forgetIds.add(memory.id);
  }
  return { forgetIds: [...forgetIds], removeIds };
}

function toRow(input: (MemoryCreateInput & Pick<Memory, "id" | "status" | "createdAt" | "updatedAt" | "lastAccessedAt" | "accessCount">) | Memory): MemoryRow {
  validateMemory(input);
  const context = "context" in input ? input.context : undefined;
  const existing = "channelType" in input ? input : undefined;
  const channel = input.scope === "channel" ? context : undefined;
  return {
    id: input.id,
    type: input.type,
    content: input.content,
    scope: input.scope,
    channelType: channel?.type ?? existing?.channelType ?? null,
    platform: input.scope === "user" ? (input.platform ?? null) : (channel?.platform ?? existing?.platform ?? null),
    guildId: channel?.type === "channel" || channel?.type === "guild" ? channel.guildId : (existing?.guildId ?? null),
    channelId: channel?.channelId ?? existing?.channelId ?? null,
    selfId: channel?.type === "direct" ? channel.selfId : (existing?.selfId ?? null),
    userId: input.scope === "user" ? (input.userId ?? null) : null,
    importance: input.importance,
    confidence: input.confidence,
    tags: [...input.tags],
    status: input.status,
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
    lastAccessedAt: input.lastAccessedAt,
    accessCount: input.accessCount,
    forgottenAt: "forgottenAt" in input ? (input.forgottenAt ?? null) : null,
    embedding: input.embedding ?? null,
    embeddingModel: input.embeddingModel ?? null,
  };
}

function fromRow(row: MemoryRow): Memory {
  return {
    ...row,
    type: (row.type ?? "fact") as MemoryType,
    channelType: row.channelType ?? undefined,
    platform: row.platform ?? undefined,
    guildId: row.guildId ?? undefined,
    channelId: row.channelId ?? undefined,
    selfId: row.selfId ?? undefined,
    userId: row.userId ?? undefined,
    forgottenAt: row.forgottenAt ?? undefined,
    embedding: row.embedding ?? undefined,
    embeddingModel: row.embeddingModel ?? undefined,
  };
}

function validateMemory(input: MemoryCreateInput | Memory): void {
  if (!input.content.trim()) throw new Error("memory content must not be empty");
  if (input.importance < 0 || input.importance > 1 || input.confidence < 0 || input.confidence > 1)
    throw new Error("memory importance and confidence must be between 0 and 1");
  if (input.scope === "channel" && !("context" in input ? input.context : "channelId" in input && input.channelId && input.platform))
    throw new Error("channel memory requires a channel context");
  if (input.scope === "user" && !(input.platform && input.userId)) throw new Error("user memory requires platform and userId");
  if (input.scope === "shared" && (("context" in input && input.context) || input.platform || input.userId))
    throw new Error("shared memory cannot have scope targets");
}

function isVisible(memory: Memory, context: ChannelContext, userIds: readonly string[]): boolean {
  if (memory.scope === "shared") return true;
  if (memory.scope === "user") return memory.platform === context.platform && memory.userId !== undefined && userIds.includes(memory.userId);
  return (
    memory.platform === context.platform &&
    memory.channelId === context.channelId &&
    memory.channelType === context.type &&
    memory.guildId === (context.type === "direct" ? undefined : context.guildId) &&
    memory.selfId === (context.type === "direct" ? context.selfId : undefined)
  );
}
