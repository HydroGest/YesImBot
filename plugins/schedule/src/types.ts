export type ScheduleState = "enabled" | "paused" | "cancelled" | "completed";

export type ScheduleLastResult = {
  occurrenceAt: string;
  status: "submitting" | "accepted" | "failed" | "missed" | "interrupted";
  finishedAt?: string;
  error?: { name: string; message: string };
};

export type Schedule = {
  id: string;
  type: "shared" | "direct";
  platform: string;
  selfId: string;
  channelId: string;
  title: string;
  prompt: string;
  state: ScheduleState;
  /** Null while the schedule is paused, cancelled, or completed. */
  nextRunAt: string | null;
  lastResult?: ScheduleLastResult;
  createdAt: string;
  updatedAt: string;
} & ({ kind: "once"; at: string; cron?: never } | { kind: "cron"; cron: string; at?: never });

export type ScheduleCreateInput = {
  title: string;
  prompt: string;
} & ({ kind: "once"; at: string; cron?: never } | { kind: "cron"; cron: string; at?: never });

export type ScheduleUpdateInput = {
  title?: string;
  prompt?: string;
} & ({ kind?: "once"; at?: string; cron?: never } | { kind?: "cron"; cron?: string; at?: never });

/**
 * The compact, tool-facing view of a Schedule: identity, lifecycle, and next
 * execution only. Raw scope coordinates, rule, prompt, and audit fields are
 * intentionally absent so Agent tool output stays small and channel-bound.
 */
export type ScheduleProjection = {
  id: string;
  title: string;
  kind: "once" | "cron";
  state: ScheduleState;
  nextRunAt: string | null;
  lastResult?: ScheduleLastResult;
};

/**
 * The physical row of the plugin-owned `yesimbot_schedule` table. It keeps the
 * raw scope coordinates and both rule columns; exactly one of `at`/`cron` is
 * non-null for a given `kind`.
 */
export type ScheduleRow = {
  id: string;
  type: "shared" | "direct";
  platform: string;
  selfId: string;
  channelId: string;
  title: string;
  prompt: string;
  kind: "once" | "cron";
  at: string | null;
  cron: string | null;
  state: ScheduleState;
  nextRunAt: string | null;
  lastResult: ScheduleLastResult | null;
  createdAt: string;
  updatedAt: string;
};

declare module "koishi-plugin-yesimbot" {
  interface EventMap {
    "schedule.due": {
      schedule: {
        id: string;
        title: string;
        kind: "once" | "cron";
        scheduledFor: string;
      };
    };
  }
}

declare module "koishi" {
  interface Tables {
    yesimbot_schedule: ScheduleRow;
  }
}
