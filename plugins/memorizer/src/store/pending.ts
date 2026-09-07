import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import type { ChannelContext } from "koishi-plugin-yesimbot";

import type { PendingMemory } from "../types.js";

export class PendingStore {
  private readonly path: string;
  private pending: PendingMemory[] = [];
  private tail: Promise<void> = Promise.resolve();

  public constructor(root: string) {
    this.path = path.join(root, "memory-pending.json");
  }

  public init(): Promise<void> {
    return this.serialize(async () => {
      try {
        const raw = await readFile(this.path, "utf8");
        const parsed = JSON.parse(raw) as unknown;
        if (!Array.isArray(parsed)) throw new Error("must be an array");
        this.pending = parsed as PendingMemory[];
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
        throw new Error(`Invalid pending JSON: ${error instanceof Error ? error.message : String(error)}`);
      }
    });
  }

  public list(): Promise<readonly PendingMemory[]> {
    return this.serialize(async () => [...this.pending]);
  }

  public enqueue(input: Omit<PendingMemory, "id" | "attempts" | "nextAttemptAt" | "suspended">, delayMs = 0): Promise<PendingMemory> {
    return this.serialize(async () => {
      const now = input.queuedAt;
      for (const item of this.pending) {
        if (sameChannel(item.channel, input.channel) && item.suspended) Object.assign(item, { suspended: false, nextAttemptAt: now });
      }
      const item: PendingMemory = { ...input, id: randomUUID(), attempts: 0, nextAttemptAt: now + delayMs, suspended: false };
      this.pending.push(item);
      await this.write();
      return item;
    });
  }

  public nextBatch(channel: ChannelContext, maxPending: number, maxMessages: number): Promise<PendingMemory[]> {
    return this.serialize(async () => {
      const batch: PendingMemory[] = [];
      let messages = 0;
      for (const item of this.pending
        .filter((item) => !item.suspended && sameChannel(item.channel, channel))
        .sort((left, right) => left.queuedAt - right.queuedAt)) {
        if (batch.length >= maxPending) break;
        batch.push(item);
        messages += item.messageCount;
        if (messages > maxMessages) break;
      }
      return batch;
    });
  }

  public complete(ids: readonly string[]): Promise<void> {
    return this.serialize(async () => {
      const selected = new Set(ids);
      this.pending = this.pending.filter((item) => !selected.has(item.id));
      await this.write();
    });
  }

  public fail(ids: readonly string[], error: unknown, now: number, maxAttempts = 8): Promise<void> {
    return this.serialize(async () => {
      const selected = new Set(ids);
      const message = error instanceof Error ? error.message : String(error);
      for (const item of this.pending) {
        if (!selected.has(item.id)) continue;
        const attempts = item.attempts + 1;
        Object.assign(item, {
          attempts,
          lastError: message,
          nextAttemptAt: now + Math.min(60 * 60 * 1_000, 30_000 * 2 ** attempts),
          suspended: attempts >= maxAttempts,
        });
      }
      await this.write();
    });
  }

  public nextDueAt(): Promise<number | undefined> {
    return this.serialize(async () =>
      this.pending
        .filter((item) => !item.suspended)
        .reduce<number | undefined>((next, item) => (next === undefined || item.nextAttemptAt < next ? item.nextAttemptAt : next), undefined),
    );
  }

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.tail.then(operation, operation);
    this.tail = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  private async write(): Promise<void> {
    await mkdir(path.dirname(this.path), { recursive: true });
    const temporary = `${this.path}.${crypto.randomUUID()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(this.pending)}\n`, { encoding: "utf8", flag: "wx" });
    try {
      await rename(temporary, this.path);
    } finally {
      await rm(temporary, { force: true });
    }
  }
}

function sameChannel(left: ChannelContext, right: ChannelContext): boolean {
  return (
    left.type === right.type &&
    left.platform === right.platform &&
    left.channelId === right.channelId &&
    (left.type === "direct" ? right.type === "direct" && left.selfId === right.selfId : right.type !== "direct" && left.guildId === right.guildId)
  );
}
