import { jsonSchema, type AgentTool } from "@yesimbot/agent-runtime";
import type { ChannelScope } from "koishi-plugin-yesimbot";

import type { ScheduleStore } from "./store.js";
import type { Schedule, ScheduleCreateInput, ScheduleProjection, ScheduleUpdateInput } from "./types.js";

const CREATE_SCHEMA = jsonSchema<CreateToolInput>({
  type: "object",
  properties: {
    title: { type: "string", minLength: 1, maxLength: 120, description: "任务标题，最长 120 字符" },
    prompt: { type: "string", minLength: 1, maxLength: 2000, description: "到期时交给 Agent 的提示词，最长 2000 字符" },
    at: { type: "string", format: "date-time", description: "一次性执行：一个未来的 RFC 3339 时刻，如 2030-01-01T08:00:00+08:00" },
    cron: { type: "string", description: "周期执行：Asia/Shanghai 时区的五段式 cron 表达式（分 时 日 月 周），相邻两次执行至少间隔 15 分钟" },
  },
  required: ["title", "prompt"],
  oneOf: [
    { type: "object", required: ["at"] },
    { type: "object", required: ["cron"] },
  ],
  additionalProperties: false,
});

const LIST_SCHEMA = jsonSchema<Record<string, never>>({ type: "object", additionalProperties: false });

const UPDATE_SCHEMA = jsonSchema<UpdateToolInput>({
  type: "object",
  properties: {
    id: { type: "string", description: "要更新的定时任务 ID" },
    title: { type: "string", minLength: 1, maxLength: 120, description: "新标题，最长 120 字符" },
    prompt: { type: "string", minLength: 1, maxLength: 2000, description: "新提示词，最长 2000 字符" },
    at: { type: "string", format: "date-time", description: "新的一次性执行时刻（RFC 3339，需在未来）" },
    cron: { type: "string", description: "新的五段式 cron 表达式（Asia/Shanghai，最小间隔 15 分钟）" },
  },
  required: ["id"],
  // Rule replacement is optional, but at most one of at/cron may be present.
  not: { allOf: [{ required: ["at"] }, { required: ["cron"] }] },
  additionalProperties: false,
});

const ID_SCHEMA = jsonSchema<IdToolInput>({
  type: "object",
  properties: { id: { type: "string", description: "定时任务 ID" } },
  required: ["id"],
  additionalProperties: false,
});

/** Flat create input: title, prompt, and exactly one canonical rule form. */
type CreateToolInput = { title: string; prompt: string } & ({ at: string; cron?: never } | { at?: never; cron: string });

/** Flat update input: id plus optional title/prompt and at most one rule form. */
type UpdateToolInput = { id: string; title?: string; prompt?: string } & (
  | { at: string; cron?: never }
  | { at?: never; cron: string }
  | { at?: never; cron?: never }
);

/** The id-only input shared by pause, resume, and cancel. */
type IdToolInput = { id: string };

function toProjection(schedule: Schedule): ScheduleProjection {
  return { id: schedule.id, title: schedule.title, kind: schedule.kind, state: schedule.state, nextRunAt: schedule.nextRunAt, lastResult: schedule.lastResult };
}

function createTool(scope: ChannelScope, store: ScheduleStore, rearm: (() => Promise<void>) | undefined): AgentTool<CreateToolInput, ScheduleProjection> {
  return {
    name: "schedule_create",
    description:
      "在当前频道创建一个定时任务：at（一次性执行）或 cron（周期执行）二选一。时间统一按 Asia/Shanghai 解释；at 使用 RFC 3339 时刻，cron 使用五段式表达式。",
    inputSchema: CREATE_SCHEMA,
    execute: async (input) => {
      const createInput: ScheduleCreateInput =
        input.at !== undefined
          ? { title: input.title, prompt: input.prompt, kind: "once", at: input.at }
          : { title: input.title, prompt: input.prompt, kind: "cron", cron: input.cron };
      const schedule = await store.create(scope, createInput);
      await rearm?.();
      return toProjection(schedule);
    },
  };
}

function listTool(scope: ChannelScope, store: ScheduleStore): AgentTool<Record<string, never>, ScheduleProjection[]> {
  return {
    name: "schedule_list",
    description: "列出当前频道的全部定时任务，返回每个任务的紧凑信息：id、标题、类型（once/cron）、状态、下次执行时间和最近结果。",
    inputSchema: LIST_SCHEMA,
    execute: async () => (await store.list(scope)).map(toProjection),
  };
}

function updateTool(scope: ChannelScope, store: ScheduleStore, rearm: (() => Promise<void>) | undefined): AgentTool<UpdateToolInput, ScheduleProjection> {
  return {
    name: "schedule_update",
    description: "更新当前频道一个定时任务的标题、提示词或执行规则。规则替换时 at 与 cron 至多提供一个；未提供的字段保持不变。",
    inputSchema: UPDATE_SCHEMA,
    execute: async ({ id, title, prompt, at, cron }) => {
      let patch: ScheduleUpdateInput = {};
      if (at !== undefined) patch = { kind: "once", at };
      else if (cron !== undefined) patch = { kind: "cron", cron };
      if (title !== undefined) patch = { ...patch, title };
      if (prompt !== undefined) patch = { ...patch, prompt };
      const schedule = await store.update(scope, id, patch);
      await rearm?.();
      return toProjection(schedule);
    },
  };
}

function pauseTool(scope: ChannelScope, store: ScheduleStore, rearm: (() => Promise<void>) | undefined): AgentTool<IdToolInput, ScheduleProjection> {
  return {
    name: "schedule_pause",
    description: "暂停当前频道一个启用的定时任务：保留规则与最近结果，不再触发。",
    inputSchema: ID_SCHEMA,
    execute: async ({ id }) => {
      const schedule = await store.pause(scope, id);
      await rearm?.();
      return toProjection(schedule);
    },
  };
}

function resumeTool(scope: ChannelScope, store: ScheduleStore, rearm: (() => Promise<void>) | undefined): AgentTool<IdToolInput, ScheduleProjection> {
  return {
    name: "schedule_resume",
    description: "恢复当前频道一个已暂停的定时任务，并计算其下一个未来执行时刻。",
    inputSchema: ID_SCHEMA,
    execute: async ({ id }) => {
      const schedule = await store.resume(scope, id);
      await rearm?.();
      return toProjection(schedule);
    },
  };
}

function cancelTool(scope: ChannelScope, store: ScheduleStore, rearm: (() => Promise<void>) | undefined): AgentTool<IdToolInput, ScheduleProjection> {
  return {
    name: "schedule_cancel",
    description: "取消当前频道一个启用或暂停的定时任务：本次及以后都不会再触发，记录保留为已取消。",
    inputSchema: ID_SCHEMA,
    execute: async ({ id }) => {
      const schedule = await store.cancel(scope, id);
      await rearm?.();
      return toProjection(schedule);
    },
  };
}

/**
 * Builds the six current-channel Schedule management tools for an AgentPlugin
 * runtime. Every tool operates on the factory's captured ChannelScope only:
 * no schema accepts a scope, channel, or Session parameter, and every Store
 * call passes the captured scope.
 */
export function createScheduleTools(scope: ChannelScope, store: ScheduleStore, rearm?: () => Promise<void>): AgentTool[] {
  return [
    createTool(scope, store, rearm),
    listTool(scope, store),
    updateTool(scope, store, rearm),
    pauseTool(scope, store, rearm),
    resumeTool(scope, store, rearm),
    cancelTool(scope, store, rearm),
  ];
}
