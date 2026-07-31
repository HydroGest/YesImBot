import type { ChannelScope, EventMap } from "koishi-plugin-yesimbot";
import { describe, expect, it } from "vitest";

import type {
  Schedule,
  ScheduleCreateInput,
  ScheduleLastResult,
  ScheduleState,
  ScheduleUpdateInput,
} from "../src/types";

// The due extension must carry exactly one top-level field: schedule metadata.
type _dueKeys = [keyof EventMap["schedule.due"]] extends ["schedule"]
  ? ["schedule"] extends [keyof EventMap["schedule.due"]]
    ? true
    : never
  : never;
const _dueKeysCheck: _dueKeys = true;

describe("Schedule domain types", () => {
  it("exposes the schedule domain module", async () => {
    await expect(import("../src/types")).resolves.toBeDefined();
  });

  it("keeps selfId on a direct schedule", () => {
    const schedule = {
      id: "schedule-1",
      type: "direct",
      platform: "test",
      selfId: "bot-1",
      channelId: "user-1",
      title: "Direct reminder",
      prompt: "Remind me to stand up.",
      kind: "once",
      at: "2026-08-01T01:00:00.000Z",
      state: "enabled",
      nextRunAt: "2026-08-01T01:00:00.000Z",
    } satisfies Schedule;

    expect(schedule.type).toBe("direct");
    expect(schedule.selfId).toBe("bot-1");
    expect(schedule.channelId).toBe("user-1");
  });

  it("uses the same raw scope fields on a shared schedule", () => {
    const schedule = {
      id: "schedule-1",
      type: "shared",
      platform: "test",
      selfId: "bot-1",
      channelId: "room-1",
      title: "Standup",
      prompt: "Remind the channel about the standup.",
      kind: "once",
      at: "2026-08-01T01:00:00.000Z",
      state: "enabled",
      nextRunAt: "2026-08-01T01:00:00.000Z",
    } satisfies Schedule;

    expect(schedule.platform).toBe("test");
    expect(schedule.selfId).toBe("bot-1");
    expect(schedule.channelId).toBe("room-1");

    // The raw fields map directly onto Core's ChannelScope vocabulary.
    const scope: ChannelScope = {
      type: schedule.type,
      platform: schedule.platform,
      selfId: schedule.selfId,
      channelId: schedule.channelId,
    };
    expect(scope).toEqual({
      type: "shared",
      platform: "test",
      selfId: "bot-1",
      channelId: "room-1",
    });
  });

  it("limits the due extension to schedule metadata", () => {
    const due: EventMap["schedule.due"] = {
      schedule: {
        id: "schedule-1",
        title: "Standup",
        kind: "once",
        scheduledFor: "2026-08-01T01:00:00.000Z",
      },
    };

    expect(Object.keys(due)).toEqual(["schedule"]);
    expect(due.schedule.id).toBe("schedule-1");
    expect(due.schedule.kind).toBe("once");
  });

  it("keeps the state and result unions narrow", () => {
    const states: readonly ScheduleState[] = ["enabled", "paused", "cancelled", "completed"];
    const result: ScheduleLastResult = {
      occurrenceAt: "2026-08-01T01:00:00.000Z",
      status: "accepted",
    };

    expect(states).toContain("enabled");
    expect(result.status).toBe("accepted");
  });

  it("rejects timeZone and claimedFor on every schedule type", () => {
    const withTimeZone: Schedule = {
      id: "schedule-1",
      type: "shared",
      platform: "test",
      selfId: "bot-1",
      channelId: "room-1",
      title: "Standup",
      prompt: "Remind the channel about the standup.",
      kind: "once",
      at: "2026-08-01T01:00:00.000Z",
      state: "enabled",
      nextRunAt: "2026-08-01T01:00:00.000Z",
      // @ts-expect-error Schedule must not admit a timeZone field
      timeZone: "Asia/Shanghai",
    };

    const withClaimedFor: Schedule = {
      id: "schedule-1",
      type: "shared",
      platform: "test",
      selfId: "bot-1",
      channelId: "room-1",
      title: "Standup",
      prompt: "Remind the channel about the standup.",
      kind: "once",
      at: "2026-08-01T01:00:00.000Z",
      state: "enabled",
      nextRunAt: "2026-08-01T01:00:00.000Z",
      // @ts-expect-error Schedule must not admit a claimedFor field
      claimedFor: "2026-08-01T01:00:00.000Z",
    };

    const createWithTimeZone: ScheduleCreateInput = {
      title: "Standup",
      prompt: "Remind the channel about the standup.",
      kind: "once",
      at: "2026-08-01T01:00:00.000Z",
      // @ts-expect-error create input must not admit a timeZone field
      timeZone: "Asia/Shanghai",
    };

    const updateWithClaimedFor: ScheduleUpdateInput = {
      kind: "once",
      at: "2026-08-01T01:00:00.000Z",
      // @ts-expect-error update input must not admit a claimedFor field
      claimedFor: "2026-08-01T01:00:00.000Z",
    };

    expect(withTimeZone).toBeDefined();
    expect(withClaimedFor).toBeDefined();
    expect(createWithTimeZone).toBeDefined();
    expect(updateWithClaimedFor).toBeDefined();
  });
});
