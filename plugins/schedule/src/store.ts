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
  ScheduleRow,
  ScheduleUpdateInput,
} from "./types";

export const SCHEDULE_TABLE = "yesimbot_schedule";

/** The database surface the Store needs: the raw Minato model service. */
export type ScheduleModel = Pick<Context["model"], "extend" | "get" | "create" | "set" | "remove">;

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

/** Registers the plugin-owned single table; called once from the plugin initialization path. */
export function registerScheduleModel(model: ScheduleModel): void {
  model.extend(SCHEDULE_TABLE, SCHEDULE_FIELDS, { primary: "id", autoInc: false });
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
  return row.kind === "once"
    ? { kind: "once", at: row.at! }
    : { kind: "cron", cron: row.cron! };
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
    this.mutationTail = next.then(() => undefined, () => undefined);
    return next;
  }

  create(scope: ChannelScope, input: ScheduleCreateInput): Promise<Schedule> {
    return this.mutate(async () => {
      const now = new Date(Date.now());
      validateCreate(input, now);
      const query = scopeQuery(scope);
      const enabled = await this.model.get(SCHEDULE_TABLE, { ...query, state: "enabled" });
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

  list(scope: ChannelScope): Promise<Schedule[]> {
    return this.mutate(async () => {
      const rows = await this.model.get(SCHEDULE_TABLE, scopeQuery(scope));
      return rows.map(toSchedule).sort(compareByNextRun);
    });
  }

  update(scope: ChannelScope, id: string, input: ScheduleUpdateInput): Promise<Schedule> {
    return this.mutate(async () => {
      const row = await this.fetchRow(scope, id);
      const ruleChanged = input.kind !== undefined || input.at !== undefined || input.cron !== undefined;
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
              : { kind: input.kind ?? row.kind, at: row.at ?? undefined, cron: row.cron ?? undefined };
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
      return toSchedule({ ...row, title, prompt, kind, at, cron, nextRunAt: next, updatedAt });
    });
  }

  pause(scope: ChannelScope, id: string): Promise<Schedule> {
    return this.mutate(async () => {
      const row = await this.fetchRow(scope, id);
      if (row.state !== "enabled") throw new Error(`schedule ${id} is not enabled`);
      const updatedAt = new Date(Date.now()).toISOString();
      await this.model.set(SCHEDULE_TABLE, { ...scopeQuery(scope), id }, { state: "paused", nextRunAt: null, updatedAt });
      return toSchedule({ ...row, state: "paused", nextRunAt: null, updatedAt });
    });
  }

  resume(scope: ChannelScope, id: string): Promise<Schedule> {
    return this.mutate(async () => {
      const row = await this.fetchRow(scope, id);
      if (row.state !== "paused") throw new Error(`schedule ${id} is not paused`);
      const now = new Date(Date.now());
      const rule = ruleOfRow(row);
      if (rule.kind === "once" && Date.parse(rule.at) <= now.getTime()) {
        throw new Error(`schedule ${id} has no future occurrence`);
      }
      const next = nextRunAt(rule, now);
      const updatedAt = new Date(Date.now()).toISOString();
      await this.model.set(SCHEDULE_TABLE, { ...scopeQuery(scope), id }, { state: "enabled", nextRunAt: next, updatedAt });
      return toSchedule({ ...row, state: "enabled", nextRunAt: next, updatedAt });
    });
  }

  cancel(scope: ChannelScope, id: string): Promise<Schedule> {
    return this.mutate(async () => {
      const row = await this.fetchRow(scope, id);
      if (row.state !== "enabled" && row.state !== "paused") {
        throw new Error(`schedule ${id} cannot be cancelled`);
      }
      const updatedAt = new Date(Date.now()).toISOString();
      await this.model.set(SCHEDULE_TABLE, { ...scopeQuery(scope), id }, { state: "cancelled", nextRunAt: null, updatedAt });
      return toSchedule({ ...row, state: "cancelled", nextRunAt: null, updatedAt });
    });
  }

  private async fetchRow(scope: ChannelScope, id: string): Promise<ScheduleRow> {
    const rows = await this.model.get(SCHEDULE_TABLE, { ...scopeQuery(scope), id });
    if (!rows.length) throw new Error(`schedule ${id} not found`);
    return rows[0];
  }
}
