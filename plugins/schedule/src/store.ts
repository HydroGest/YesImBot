import { randomUUID } from "node:crypto";

import type { Context, Field, Types } from "koishi";
import type { ChannelScope } from "koishi-plugin-yesimbot";

import {
  MAX_ENABLED_SCHEDULES,
  MAX_PROMPT_LENGTH,
  MAX_TITLE_LENGTH,
  nextRunAt,
  validateCreate,
  validateRule,
  type ScheduleRule,
  type ScheduleRuleShape,
} from "./time";
import type {
  Schedule,
  ScheduleCreateInput,
  ScheduleLastResult,
  ScheduleRow,
  ScheduleState,
  ScheduleUpdateInput,
} from "./types";

export const SCHEDULE_TABLE = "yesimbot_schedule";

const SCHEDULE_FIELDS = {
  id: "string",
  type: "string",
  platform: "string",
  selfId: "string",
  channelId: "string",
  title: "string",
  prompt: "text",
  kind: "string",
  at: { type: "string", nullable: true, initial: null },
  cron: { type: "string", nullable: true, initial: null },
  state: "string",
  nextRunAt: { type: "string", nullable: true, initial: null },
  lastResult: { type: "json", nullable: true, initial: null },
  createdAt: "string",
  updatedAt: "string",
} satisfies Field.Extension<ScheduleRow, Types>;

/** The database surface the Store needs: the raw Minato model service. */
export type ScheduleModel = Pick<Context["model"], "extend" | "get" | "create" | "set" | "remove">;

/**
 * Single-table, channel-scoped Schedule persistence. Every mutation is
 * serialized through a private promise tail so create/update/pause/resume/
 * cancel cannot interleave within one process; reads wait on the same tail
 * for read-your-writes behavior.
 */
export class ScheduleStore {
  private mutationTail: Promise<void> = Promise.resolve();

  constructor(private readonly model: ScheduleModel) {}

  private mutate<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.mutationTail.then(operation, operation);
    this.mutationTail = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  public create(scope: ChannelScope, input: ScheduleCreateInput): Promise<Schedule> {
    return this.mutate(async () => {
      const now = new Date(Date.now());
      validateCreate(input, now);
      const query = scopeQuery(scope);
      const enabled = await this.model.get(SCHEDULE_TABLE, {
        ...query,
        state: "enabled",
      });
      if (enabled.length >= MAX_ENABLED_SCHEDULES) {
        throw new Error(`channel already has ${MAX_ENABLED_SCHEDULES} enabled schedules`);
      }
      const rule: ScheduleRule =
        input.kind === "once" ? { kind: "once", at: input.at } : { kind: "cron", cron: input.cron };
      const row: ScheduleRow = {
        id: randomUUID(),
        type: scope.type,
        platform: scope.platform,
        selfId: scope.selfId,
        channelId: scope.channelId,
        title: input.title,
        prompt: input.prompt,
        kind: rule.kind,
        at: rule.kind === "once" ? rule.at : null,
        cron: rule.kind === "cron" ? rule.cron : null,
        state: "enabled",
        nextRunAt: nextRunAt(rule, now),
        lastResult: null,
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      };
      await this.model.create(SCHEDULE_TABLE, row);
      return toSchedule(row);
    });
  }

  public list(scope: ChannelScope): Promise<Schedule[]> {
    return this.mutate(async () => {
      const rows = await this.model.get(SCHEDULE_TABLE, scopeQuery(scope));
      return rows.map(toSchedule).sort(compareByNextRun);
    });
  }

  public update(scope: ChannelScope, id: string, input: ScheduleUpdateInput): Promise<Schedule> {
    return this.mutate(async () => {
      const row = await this.fetchRow(scope, id);
      const ruleChanged =
        input.kind !== undefined || input.at !== undefined || input.cron !== undefined;
      if (ruleChanged && (row.state === "cancelled" || row.state === "completed")) {
        throw new Error(`schedule ${id} cannot change its rule`);
      }
      const title = input.title ?? row.title;
      const prompt = input.prompt ?? row.prompt;
      if (title.length > MAX_TITLE_LENGTH) {
        throw new Error(`title must not exceed ${MAX_TITLE_LENGTH} characters`);
      }
      if (prompt.length > MAX_PROMPT_LENGTH) {
        throw new Error(`prompt must not exceed ${MAX_PROMPT_LENGTH} characters`);
      }
      const now = new Date(Date.now());
      let kind: "once" | "cron" = row.kind;
      let at: string | null = row.at;
      let cron: string | null = row.cron;
      let next: string | null = row.nextRunAt;
      if (ruleChanged) {
        const rule: ScheduleRuleShape =
          input.at !== undefined
            ? { kind: input.kind ?? row.kind, at: input.at }
            : input.cron !== undefined
              ? { kind: input.kind ?? row.kind, cron: input.cron }
              : {
                  kind: input.kind ?? row.kind,
                  at: row.at ?? undefined,
                  cron: row.cron ?? undefined,
                };
        validateRule(rule, now);
        kind = rule.kind;
        at = rule.kind === "once" ? rule.at : null;
        cron = rule.kind === "cron" ? rule.cron : null;
        if (row.state === "enabled") next = nextRunAt(rule, now);
      }
      const updatedAt = new Date(Date.now()).toISOString();
      await this.model.set(
        SCHEDULE_TABLE,
        { ...scopeQuery(scope), id },
        { title, prompt, kind, at, cron, nextRunAt: next, updatedAt },
      );
      return toSchedule({
        ...row,
        title,
        prompt,
        kind,
        at,
        cron,
        nextRunAt: next,
        updatedAt,
      });
    });
  }

  public pause(scope: ChannelScope, id: string): Promise<Schedule> {
    return this.mutate(async () => {
      const row = await this.fetchRow(scope, id);
      if (row.state !== "enabled") throw new Error(`schedule ${id} is not enabled`);
      const updatedAt = new Date(Date.now()).toISOString();
      await this.model.set(
        SCHEDULE_TABLE,
        { ...scopeQuery(scope), id },
        { state: "paused", nextRunAt: null, updatedAt },
      );
      return toSchedule({
        ...row,
        state: "paused",
        nextRunAt: null,
        updatedAt,
      });
    });
  }

  public resume(scope: ChannelScope, id: string): Promise<Schedule> {
    return this.mutate(async () => {
      const row = await this.fetchRow(scope, id);
      if (row.state !== "paused") throw new Error(`schedule ${id} is not paused`);
      const enabled = await this.model.get(SCHEDULE_TABLE, {
        ...scopeQuery(scope),
        state: "enabled",
      });
      if (enabled.length >= MAX_ENABLED_SCHEDULES) {
        throw new Error(`channel already has ${MAX_ENABLED_SCHEDULES} enabled schedules`);
      }
      const now = new Date(Date.now());
      const rule = ruleOfRow(row);
      if (rule.kind === "once" && Date.parse(rule.at) <= now.getTime()) {
        throw new Error(`schedule ${id} has no future occurrence`);
      }
      const next = nextRunAt(rule, now);
      const updatedAt = new Date(Date.now()).toISOString();
      await this.model.set(
        SCHEDULE_TABLE,
        { ...scopeQuery(scope), id },
        { state: "enabled", nextRunAt: next, updatedAt },
      );
      return toSchedule({
        ...row,
        state: "enabled",
        nextRunAt: next,
        updatedAt,
      });
    });
  }

  public cancel(scope: ChannelScope, id: string): Promise<Schedule> {
    return this.mutate(async () => {
      const row = await this.fetchRow(scope, id);
      if (row.state !== "enabled" && row.state !== "paused") {
        throw new Error(`schedule ${id} cannot be cancelled`);
      }
      const updatedAt = new Date(Date.now()).toISOString();
      await this.model.set(
        SCHEDULE_TABLE,
        { ...scopeQuery(scope), id },
        { state: "cancelled", nextRunAt: null, updatedAt },
      );
      return toSchedule({
        ...row,
        state: "cancelled",
        nextRunAt: null,
        updatedAt,
      });
    });
  }

  /** Enabled rows across every channel, earliest next run first. */
  public listEnabled(): Promise<Schedule[]> {
    return this.mutate(async () => {
      const rows = await this.model.get(SCHEDULE_TABLE, { state: "enabled" });
      return rows.map(toSchedule).sort(compareByNextRun);
    });
  }

  /**
   * Durably claims the due occurrence `occurrenceAt` of `id`: the row must
   * still be enabled with a matching `nextRunAt`. The claim writes the
   * `submitting` latest result and advances the rule before returning the
   * claimed row — a once schedule is completed, a cron schedule moves to its
   * next occurrence. Returns null when the occurrence is not claimable, so
   * duplicate wakes can never claim the same occurrence twice.
   */
  public claim(id: string, occurrenceAt: string): Promise<Schedule | null> {
    return this.mutate(async () => {
      const rows = await this.model.get(SCHEDULE_TABLE, { id });
      const row = rows[0];
      if (!row || row.state !== "enabled" || row.nextRunAt !== occurrenceAt) return null;
      const now = new Date(Date.now());
      const rule = ruleOfRow(row);
      const state: ScheduleState = rule.kind === "once" ? "completed" : "enabled";
      const next = rule.kind === "once" ? null : nextRunAt(rule, now);
      const lastResult: ScheduleLastResult = {
        occurrenceAt,
        status: "submitting",
      };
      const updatedAt = now.toISOString();
      await this.model.set(
        SCHEDULE_TABLE,
        { id },
        { state, nextRunAt: next, lastResult, updatedAt },
      );
      return toSchedule({
        ...row,
        state,
        nextRunAt: next,
        lastResult,
        updatedAt,
      });
    });
  }

  /**
   * Finalizes the claimed occurrence `occurrenceAt` of `id`. Only a latest
   * result still in `submitting` for that exact occurrence can be finalized;
   * any other state is left untouched so a stale finish can never overwrite a
   * newer claim. `status` is the durable outcome: `accepted` after a trigger
   * resolution, `failed` after a trigger rejection, or `missed` when no
   * concurrent trigger slot was available.
   */
  public finish(
    id: string,
    occurrenceAt: string,
    status: "accepted" | "failed" | "missed" | "interrupted",
    error?: { name: string; message: string },
  ): Promise<Schedule | null> {
    return this.mutate(async () => {
      const rows = await this.model.get(SCHEDULE_TABLE, { id });
      const row = rows[0];
      const result = row?.lastResult;
      if (!row || result?.status !== "submitting" || result.occurrenceAt !== occurrenceAt)
        return null;
      const now = new Date(Date.now());
      const lastResult: ScheduleLastResult = {
        ...result,
        status,
        finishedAt: now.toISOString(),
      };
      if (error !== undefined) lastResult.error = error;
      const updatedAt = now.toISOString();
      await this.model.set(SCHEDULE_TABLE, { id }, { lastResult, updatedAt });
      return toSchedule({ ...row, lastResult, updatedAt });
    });
  }

  /**
   * Startup repair for every persisted row. A latest result left in
   * `submitting` for a past occurrence becomes `interrupted` and is never
   * resubmitted. An enabled row whose next run lies in the past becomes one
   * `missed` result: a once schedule is completed, a cron schedule advances
   * directly to its first future occurrence. No occurrence is replayed.
   */
  public recover(now: Date): Promise<void> {
    return this.mutate(async () => {
      const rows = await this.model.get(SCHEDULE_TABLE, {});
      const nowMs = now.getTime();
      const updatedAt = now.toISOString();
      for (const row of rows) {
        const result = row.lastResult;
        if (result?.status === "submitting" && Date.parse(result.occurrenceAt) < nowMs) {
          const lastResult: ScheduleLastResult = {
            ...result,
            status: "interrupted",
            finishedAt: updatedAt,
          };
          if (
            row.state === "enabled" &&
            row.nextRunAt !== null &&
            Date.parse(row.nextRunAt) < nowMs
          ) {
            await this.model.set(
              SCHEDULE_TABLE,
              { id: row.id },
              {
                nextRunAt: nextRunAt(ruleOfRow(row), now),
                lastResult,
                updatedAt,
              },
            );
          } else {
            await this.model.set(SCHEDULE_TABLE, { id: row.id }, { lastResult, updatedAt });
          }
          continue;
        }
        if (row.state !== "enabled" || row.nextRunAt === null || Date.parse(row.nextRunAt) >= nowMs)
          continue;
        const lastResult: ScheduleLastResult = {
          occurrenceAt: row.nextRunAt,
          status: "missed",
          finishedAt: updatedAt,
        };
        if (row.kind === "once") {
          await this.model.set(
            SCHEDULE_TABLE,
            { id: row.id },
            { state: "completed", nextRunAt: null, lastResult, updatedAt },
          );
        } else {
          await this.model.set(
            SCHEDULE_TABLE,
            { id: row.id },
            {
              nextRunAt: nextRunAt(ruleOfRow(row), now),
              lastResult,
              updatedAt,
            },
          );
        }
      }
    });
  }

  private async fetchRow(scope: ChannelScope, id: string): Promise<ScheduleRow> {
    const rows = await this.model.get(SCHEDULE_TABLE, {
      ...scopeQuery(scope),
      id,
    });
    if (!rows.length) throw new Error(`schedule ${id} not found`);
    return rows[0];
  }
}

/** Registers the plugin-owned single table; called once from the plugin initialization path. */
export function registerScheduleModel(model: ScheduleModel): void {
  model.extend(SCHEDULE_TABLE, SCHEDULE_FIELDS, {
    primary: "id",
    autoInc: false,
  });
}

function scopeQuery(scope: ChannelScope) {
  return {
    type: scope.type,
    platform: scope.platform,
    selfId: scope.selfId,
    channelId: scope.channelId,
  };
}

function ruleOfRow(row: ScheduleRow): ScheduleRule {
  return row.kind === "once" ? { kind: "once", at: row.at! } : { kind: "cron", cron: row.cron! };
}

function toSchedule(row: ScheduleRow): Schedule {
  const base = {
    id: row.id,
    type: row.type,
    platform: row.platform,
    selfId: row.selfId,
    channelId: row.channelId,
    title: row.title,
    prompt: row.prompt,
    state: row.state,
    nextRunAt: row.nextRunAt,
    lastResult: row.lastResult ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
  return row.kind === "once"
    ? { ...base, kind: "once", at: row.at! }
    : { ...base, kind: "cron", cron: row.cron! };
}

function compareByNextRun(a: Schedule, b: Schedule): number {
  if (a.nextRunAt === null && b.nextRunAt === null) return a.id.localeCompare(b.id);
  if (a.nextRunAt === null) return 1;
  if (b.nextRunAt === null) return -1;
  return a.nextRunAt.localeCompare(b.nextRunAt) || a.id.localeCompare(b.id);
}
