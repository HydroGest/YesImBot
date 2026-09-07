import type { AgentTool } from "@yesimbot/agent-runtime";
import Ajv from "ajv";
import { describe, expect, it, vi, type Mock } from "vitest";

import type { ScheduleStore, ScheduleScope } from "../src/store.js";
import { createScheduleTools } from "../src/tools.js";
import type { Schedule, ScheduleProjection } from "../src/types.js";

const ajv = new Ajv({ strict: false, allErrors: true });

const TOOL_NAMES = ["schedule_create", "schedule_list", "schedule_update", "schedule_pause", "schedule_resume", "schedule_cancel"] as const;

const scope = { type: "guild", platform: "test", channelId: "room-1", guildId: "room-1", selfId: "bot-1" } satisfies ScheduleScope;

type StoreDouble = { create: Mock; list: Mock; update: Mock; pause: Mock; resume: Mock; cancel: Mock };

function createStoreDouble() {
  return { create: vi.fn(), list: vi.fn(), update: vi.fn(), pause: vi.fn(), resume: vi.fn(), cancel: vi.fn() };
}

function createTools(store: StoreDouble): AgentTool[] {
  return createScheduleTools(scope, store as unknown as ScheduleStore);
}

function makeSchedule(overrides: Partial<Schedule> = {}): Schedule {
  return {
    id: "s-1",
    type: "shared",
    platform: "test",
    selfId: "bot-1",
    channelId: "room-1",
    title: "Standup",
    prompt: "Run the daily standup.",
    delivery: "channel",
    kind: "once",
    at: "2030-01-01T00:00:00.000Z",
    state: "enabled",
    nextRunAt: "2030-01-01T00:00:00.000Z",
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
    ...overrides,
  } as Schedule;
}

function schemaOf(tool: AgentTool): object {
  const inputSchema = tool.inputSchema;
  // Every schema in this plugin is built with ai's jsonSchema(), which returns
  // a Schema wrapper holding the raw JSON Schema under the `jsonSchema` key.
  if (typeof inputSchema !== "object" || inputSchema === null || !("jsonSchema" in inputSchema)) {
    throw new Error("tool inputSchema is not an ai Schema wrapper");
  }
  return inputSchema.jsonSchema as object;
}

async function execute(tool: AgentTool, input: unknown): Promise<unknown> {
  return tool.execute!(input, {} as never);
}

describe("schedule agent tools", () => {
  it("exposes exactly the six schedule management tools in order", () => {
    expect(createTools(createStoreDouble()).map((tool) => tool.name)).toEqual([...TOOL_NAMES]);
  });

  it("create schema accepts exactly one canonical rule and rejects channel targets", () => {
    const [createTool] = createTools(createStoreDouble());
    const validate = ajv.compile(schemaOf(createTool));
    expect(validate({ title: "Standup", prompt: "Run it.", at: "2030-01-01T00:00:00Z" })).toBe(true);
    expect(validate({ title: "Standup", prompt: "Run it.", cron: "0 9 * * 1" })).toBe(true);
    expect(validate({ title: "Standup", prompt: "Run it.", delivery: "silent", cron: "0 9 * * 1" })).toBe(true);
    expect(validate({ title: "Standup", prompt: "Run it.", delivery: "unknown", cron: "0 9 * * 1" })).toBe(false);
    expect(validate({ title: "Standup", prompt: "Run it." })).toBe(false);
    expect(validate({ title: "Standup", prompt: "Run it.", at: "2030-01-01T00:00:00Z", cron: "0 9 * * 1" })).toBe(false);
    expect(validate({ title: "Standup", prompt: "Run it.", at: "2030-01-01T00:00:00Z", channelId: "room-1" })).toBe(false);
    expect(validate({ title: "Standup", prompt: "Run it.", at: "2030-01-01T00:00:00Z", platform: "onebot" })).toBe(false);
    expect(validate({ title: "Standup", prompt: "Run it.", at: "2030-01-01T00:00:00Z", selfId: "bot-1" })).toBe(false);
  });

  it("update schema permits a rule replacement or none and rejects channel targets", () => {
    const [, , updateTool] = createTools(createStoreDouble());
    const validate = ajv.compile(schemaOf(updateTool));
    expect(validate({ id: "s-1" })).toBe(true);
    expect(validate({ id: "s-1", title: "New" })).toBe(true);
    expect(validate({ id: "s-1", at: "2030-01-01T00:00:00Z" })).toBe(true);
    expect(validate({ id: "s-1", cron: "0 9 * * 1" })).toBe(true);
    expect(validate({ id: "s-1", title: "New", cron: "0 9 * * 1" })).toBe(true);
    expect(validate({ id: "s-1", delivery: "silent" })).toBe(true);
    expect(validate({ id: "s-1", delivery: "unknown" })).toBe(false);
    expect(validate({ id: "s-1", at: "2030-01-01T00:00:00Z", cron: "0 9 * * 1" })).toBe(false);
    expect(validate({ id: "s-1", channelId: "room-1" })).toBe(false);
    expect(validate({ id: "s-1", at: "2030-01-01T00:00:00Z", platform: "onebot" })).toBe(false);
  });

  it.each(["schedule_pause", "schedule_resume", "schedule_cancel"])("%s schema accepts only an id", (name) => {
    const tools = createTools(createStoreDouble());
    const tool = tools.find((candidate) => candidate.name === name)!;
    const validate = ajv.compile(schemaOf(tool));
    expect(validate({ id: "s-1" })).toBe(true);
    expect(validate({})).toBe(false);
    expect(validate({ id: "s-1", channelId: "room-1" })).toBe(false);
  });

  it("list schema accepts an empty object only", () => {
    const [, listTool] = createTools(createStoreDouble());
    const validate = ajv.compile(schemaOf(listTool));
    expect(validate({})).toBe(true);
    expect(validate({ id: "s-1" })).toBe(false);
  });

  it("create persists a once schedule through the captured scope and returns its projection", async () => {
    const store = createStoreDouble();
    store.create.mockResolvedValue(makeSchedule());
    const [createTool] = createTools(store);
    const result = await execute(createTool, { title: "Standup", prompt: "Run the daily standup.", at: "2030-01-01T00:00:00.000Z" });
    expect(store.create).toHaveBeenCalledWith(scope, { title: "Standup", prompt: "Run the daily standup.", kind: "once", at: "2030-01-01T00:00:00.000Z" });
    expect(result).toEqual({ id: "s-1", title: "Standup", delivery: "channel", kind: "once", state: "enabled", nextRunAt: "2030-01-01T00:00:00.000Z" });
  });

  it("create maps a cron input to a recurring schedule", async () => {
    const store = createStoreDouble();
    store.create.mockResolvedValue(makeSchedule({ kind: "cron", cron: "0 9 * * 1" }));
    const [createTool] = createTools(store);
    const result = await execute(createTool, { title: "Standup", prompt: "Run the daily standup.", cron: "0 9 * * 1" });
    expect(store.create).toHaveBeenCalledWith(scope, { title: "Standup", prompt: "Run the daily standup.", kind: "cron", cron: "0 9 * * 1" });
    expect(result).toEqual({ id: "s-1", title: "Standup", delivery: "channel", kind: "cron", state: "enabled", nextRunAt: "2030-01-01T00:00:00.000Z" });
  });

  it("create persists silent delivery and exposes it in the projection", async () => {
    const store = createStoreDouble();
    store.create.mockResolvedValue(makeSchedule({ delivery: "silent" }));
    const [createTool] = createTools(store);
    const result = await execute(createTool, {
      title: "Memory maintenance",
      prompt: "Update memory without replying.",
      delivery: "silent",
      cron: "0 0 * * *",
    });
    expect(store.create).toHaveBeenCalledWith(scope, {
      title: "Memory maintenance",
      prompt: "Update memory without replying.",
      delivery: "silent",
      kind: "cron",
      cron: "0 0 * * *",
    });
    expect(result).toMatchObject({ id: "s-1", delivery: "silent" });
  });

  it("list returns compact projections for the captured scope", async () => {
    const store = createStoreDouble();
    store.list.mockResolvedValue([
      makeSchedule(),
      makeSchedule({
        id: "s-2",
        title: "Digest",
        kind: "cron",
        cron: "0 9 * * 1",
        nextRunAt: "2030-01-02T00:00:00.000Z",
        lastResult: { occurrenceAt: "2030-01-01T00:00:00.000Z", status: "accepted", finishedAt: "2030-01-01T00:00:01.000Z" },
      }),
    ]);
    const [, listTool] = createTools(store);
    const result = (await execute(listTool, {})) as ScheduleProjection[];
    expect(store.list).toHaveBeenCalledWith(scope);
    expect(result).toEqual([
      { id: "s-1", title: "Standup", delivery: "channel", kind: "once", state: "enabled", nextRunAt: "2030-01-01T00:00:00.000Z" },
      {
        id: "s-2",
        title: "Digest",
        delivery: "channel",
        kind: "cron",
        state: "enabled",
        nextRunAt: "2030-01-02T00:00:00.000Z",
        lastResult: { occurrenceAt: "2030-01-01T00:00:00.000Z", status: "accepted", finishedAt: "2030-01-01T00:00:01.000Z" },
      },
    ]);
  });

  it("update routes a title replacement through the captured scope", async () => {
    const store = createStoreDouble();
    store.update.mockResolvedValue(makeSchedule({ title: "New title" }));
    const [, , updateTool] = createTools(store);
    const result = await execute(updateTool, { id: "s-1", title: "New title" });
    expect(store.update).toHaveBeenCalledWith(scope, "s-1", { title: "New title" });
    expect(result).toEqual({ id: "s-1", title: "New title", delivery: "channel", kind: "once", state: "enabled", nextRunAt: "2030-01-01T00:00:00.000Z" });
  });

  it("update routes a cron rule replacement through the captured scope", async () => {
    const store = createStoreDouble();
    store.update.mockResolvedValue(makeSchedule({ kind: "cron", cron: "0 9 * * 1" }));
    const [, , updateTool] = createTools(store);
    const result = await execute(updateTool, { id: "s-1", cron: "0 9 * * 1" });
    expect(store.update).toHaveBeenCalledWith(scope, "s-1", { kind: "cron", cron: "0 9 * * 1" });
    expect(result).toEqual({ id: "s-1", title: "Standup", delivery: "channel", kind: "cron", state: "enabled", nextRunAt: "2030-01-01T00:00:00.000Z" });
  });

  it("update changes delivery without replacing the schedule rule", async () => {
    const store = createStoreDouble();
    store.update.mockResolvedValue(makeSchedule({ delivery: "silent" }));
    const [, , updateTool] = createTools(store);
    const result = await execute(updateTool, { id: "s-1", delivery: "silent" });
    expect(store.update).toHaveBeenCalledWith(scope, "s-1", { delivery: "silent" });
    expect(result).toMatchObject({ id: "s-1", delivery: "silent" });
  });

  it.each([
    ["schedule_pause", "pause", "paused"],
    ["schedule_resume", "resume", "enabled"],
    ["schedule_cancel", "cancel", "cancelled"],
  ] as const)("%s calls the store with the captured scope", async (name, method, state) => {
    const store = createStoreDouble();
    store[method].mockResolvedValue(makeSchedule({ state }));
    const tools = createTools(store);
    const tool = tools.find((candidate) => candidate.name === name)!;
    const result = await execute(tool, { id: "s-1" });
    expect(store[method]).toHaveBeenCalledWith(scope, "s-1");
    expect(result).toEqual({ id: "s-1", title: "Standup", delivery: "channel", kind: "once", state, nextRunAt: "2030-01-01T00:00:00.000Z" });
  });
});
