import { Universal } from "koishi";
import type { EventRecord } from "koishi-plugin-yesimbot";

import { ScheduleStore } from "./store";
import type { Schedule } from "./types";

/** Upper bound on concurrent Core trigger calls the scheduler admits. */
export const MAX_CONCURRENT_TRIGGERS = 5;

/** The single Core surface the scheduler consumes: the real `yesimbot.trigger` facade. */
export interface SchedulerFacade {
  trigger(event: EventRecord): Promise<void>;
}

function toUniversalChannelType(type: "shared" | "direct"): Universal.Channel.Type {
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

/**
 * Earliest-due timer scheduler over the durable ScheduleStore. It arms one
 * timer for the earliest enabled `nextRunAt`, and on wake claims every
 * currently due occurrence through the Store before submitting a complete
 * `schedule.due` EventRecord via `ctx.yesimbot.trigger()`. Trigger calls are
 * bounded to `MAX_CONCURRENT_TRIGGERS`; a due occurrence without a free slot
 * is recorded as missed instead of entering a backlog. Production time APIs
 * are the direct global `Date.now()`, `setTimeout()`, and `clearTimeout()`.
 */
export class ScheduleScheduler {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private activeTriggers = 0;
  private running = false;

  constructor(
    private readonly store: ScheduleStore,
    private readonly facade: SchedulerFacade,
  ) {}

  /** Recovers persisted schedules, then arms the earliest due timer. */
  async start(): Promise<void> {
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
  stop(): void {
    this.running = false;
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
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
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.wake();
    }, delay);
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
      await this.facade.trigger(event);
      await this.store.finish(row.id, occurrenceAt, "accepted");
    } catch (cause) {
      const error =
        cause instanceof Error ? { name: cause.name, message: cause.message } : { name: "Error", message: String(cause) };
      await this.store.finish(row.id, occurrenceAt, "failed", error);
    }
  }
}
