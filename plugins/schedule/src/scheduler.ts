import { Universal, type Context } from "koishi";
import type { EventRecord } from "koishi-plugin-yesimbot";

import { ScheduleStore } from "./store.js";
import type { Schedule } from "./types.js";

/** Upper bound on concurrent Core trigger calls the scheduler admits. */
export const MAX_CONCURRENT_TRIGGERS = 5;

/** Node's largest reliable timeout delay; longer waits are re-evaluated in chunks. */
const MAX_TIMER_DELAY = 0x7fffffff;

/**
 * Earliest-due timer scheduler over the durable ScheduleStore. It arms one
 * timer for the earliest enabled `nextRunAt`, and on wake claims every
 * currently due occurrence through the Store before submitting a complete
 * `schedule.due` EventRecord via `Messenger.post()`. Post calls are bounded
 * to `MAX_CONCURRENT_TRIGGERS`; a due occurrence without a free slot is
 * recorded as missed instead of entering a backlog. Production time APIs are
 * the direct global `Date.now()`, `setTimeout()`, and `clearTimeout()`.
 */
export class ScheduleScheduler {
  private readonly store: ScheduleStore;
  private readonly ctx: Context;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private activeTriggers = 0;
  private running = false;

  public constructor(store: ScheduleStore, ctx: Context) {
    this.store = store;
    this.ctx = ctx;
  }

  /** Recovers persisted schedules, then arms the earliest due timer. */
  public async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    await this.store.recover(new Date(Date.now()));
    await this.arm();
  }

  /**
   * Prevents new due submissions and clears the pending timer. Persisted rows
   * stay intact, and already admitted trigger calls remain owned by the
   * existing Core trigger drain and runtime stop behavior.
   */
  public stop(): void {
    this.running = false;
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  /** Re-evaluates persisted earliest work after a successful management mutation. */
  public async rearm(): Promise<void> {
    await this.arm();
  }

  private async arm(): Promise<void> {
    if (!this.running) return;
    const rows = await this.store.listEnabled();
    const earliest = rows[0];
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (!earliest?.nextRunAt) return;
    const delay = Math.max(0, Date.parse(earliest.nextRunAt) - Date.now());
    this.timer = setTimeout(
      () => {
        this.timer = null;
        void this.wake();
      },
      Math.min(delay, MAX_TIMER_DELAY),
    );
  }

  private async wake(): Promise<void> {
    if (!this.running) return;
    const now = Date.now();
    const rows = await this.store.listEnabled();
    for (const row of rows) {
      if (!this.running) break;
      const occurrenceAt = row.nextRunAt;
      if (occurrenceAt === null || Date.parse(occurrenceAt) > now) break;
      const claimed = await this.store.claim(row.id, occurrenceAt);
      if (!claimed) continue;
      if (!this.running) {
        await this.store.finish(claimed.id, occurrenceAt, "interrupted");
        continue;
      }
      if (this.activeTriggers >= MAX_CONCURRENT_TRIGGERS) {
        await this.store.finish(claimed.id, occurrenceAt, "missed");
        continue;
      }
      this.activeTriggers++;
      void this.runTrigger(claimed, occurrenceAt)
        .catch(() => undefined)
        .finally(() => {
          this.activeTriggers--;
        });
    }
    await this.arm();
  }

  private async runTrigger(row: Schedule, occurrenceAt: string): Promise<void> {
    const event = buildDueEvent(row, occurrenceAt);
    try {
      await this.ctx.yesimbot.messenger.post(event);
      await this.store.finish(row.id, occurrenceAt, "accepted");
    } catch (cause) {
      const error = cause instanceof Error ? { name: cause.name, message: cause.message } : { name: "Error", message: String(cause) };
      await this.store.finish(row.id, occurrenceAt, "failed", error);
    }
  }
}

function toUniversalChannelType(type: string): Universal.Channel.Type {
  return type === "direct" ? Universal.Channel.Type.DIRECT : Universal.Channel.Type.TEXT;
}

function buildDueEvent(row: Schedule, occurrenceAt: string): EventRecord<"schedule.due"> {
  return {
    eventType: "schedule.due",
    platform: row.platform,
    selfId: row.selfId,
    timestamp: Date.now(),
    channel: { id: row.channelId, type: toUniversalChannelType(row.type) },
    text: `Schedule "${row.title}" is due.\n${row.prompt}`,
    schedule: { id: row.id, title: row.title, kind: row.kind, scheduledFor: occurrenceAt },
  };
}
