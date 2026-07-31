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
  nextRunAt: string;
  lastResult?: ScheduleLastResult;
} & (
  | { kind: "once"; at: string; cron?: never }
  | { kind: "cron"; cron: string; at?: never }
);

export type ScheduleCreateInput = {
  title: string;
  prompt: string;
} & (
  | { kind: "once"; at: string; cron?: never }
  | { kind: "cron"; cron: string; at?: never }
);

export type ScheduleUpdateInput = Partial<ScheduleCreateInput>;

// Compile-time witness that the merged due extension carries only schedule metadata.
type _dueKind = EventMap["schedule.due"]["schedule"]["kind"];

// Anchors the module augmentation to the resolved koishi-plugin-yesimbot types.
import type { EventMap } from "koishi-plugin-yesimbot";

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
