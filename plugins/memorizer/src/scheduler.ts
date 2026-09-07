import type { ChannelContext } from "koishi-plugin-yesimbot";

import type { PendingStore } from "./store/pending.js";
import type { PendingMemory } from "./types.js";

type Timer = NodeJS.Timeout;

export interface MemorySchedulerOptions {
  readonly maxPending: number;
  readonly maxMessages: number;
}

export class MemoryScheduler {
  private timer?: Timer;
  private sweepTimer?: Timer;
  private stopped = false;
  private running?: Promise<void>;

  public constructor(
    private readonly pending: Pick<PendingStore, "nextDueAt" | "list" | "nextBatch" | "complete" | "fail">,
    private readonly run: (channel: ChannelContext, batch: readonly PendingMemory[]) => Promise<void>,
    private readonly options: MemorySchedulerOptions,
    private readonly sweep?: () => Promise<void>,
  ) {}

  public async start(): Promise<void> {
    this.stopped = false;
    await this.arm();
    if (this.sweep) {
      await this.sweep();
      this.sweepTimer = setInterval(() => void this.sweep!().catch(() => undefined), 24 * 60 * 60 * 1_000);
    }
  }

  public async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    if (this.sweepTimer) {
      clearInterval(this.sweepTimer);
      this.sweepTimer = undefined;
    }
    await this.running;
  }

  public async runDue(now = Date.now()): Promise<void> {
    if (this.running) return this.running;
    this.running = this.runDueInner(now).finally(() => {
      this.running = undefined;
    });
    return this.running;
  }

  public async arm(): Promise<void> {
    if (this.stopped) return;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    const due = await this.pending.nextDueAt();
    if (due === undefined) return;
    this.timer = setTimeout(() => void this.runDue(), Math.max(0, due - Date.now()));
  }

  private async runDueInner(now: number): Promise<void> {
    const channels = new Map<string, ChannelContext>();
    for (const item of await this.pending.list()) {
      if (!item.suspended && item.nextAttemptAt <= now) channels.set(channelKey(item.channel), item.channel);
    }
    for (const channel of channels.values()) {
      const batch = await this.pending.nextBatch(channel, this.options.maxPending, this.options.maxMessages);
      if (!batch.length) continue;
      try {
        await this.run(channel, batch);
        await this.pending.complete(batch.map((item) => item.id));
      } catch (error) {
        await this.pending.fail(
          batch.map((item) => item.id),
          error,
          Date.now(),
        );
      }
    }
    await this.arm();
  }
}

function channelKey(context: ChannelContext): string {
  return context.type === "direct"
    ? `${context.type}\u0000${context.platform}\u0000${context.selfId}\u0000${context.channelId}`
    : `${context.type}\u0000${context.platform}\u0000${context.guildId}\u0000${context.channelId}`;
}
