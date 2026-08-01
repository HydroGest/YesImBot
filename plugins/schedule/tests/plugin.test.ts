import type { AgentPlugin } from "@yesimbot/agent-runtime";
import type { ChannelScope } from "koishi-plugin-yesimbot";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

vi.mock("koishi", () => ({
  Context: class {},
  Logger: class {},
  Universal: {
    Channel: {
      Type: { TEXT: 0, DIRECT: 1, CATEGORY: 2, VOICE: 3 },
    },
  },
}));

import SchedulePlugin from "../src/index.js";
import { ScheduleScheduler } from "../src/scheduler.js";
import type { ScheduleRow } from "../src/types.js";

type Factory = (scope: ChannelScope, bot: unknown) => AgentPlugin;

type CommandRecord = {
  name: string;
  options?: Record<string, unknown>;
  optionCalls: Array<{ name: string; config: unknown }>;
  action?: (argv: Record<string, unknown>, ...args: unknown[]) => unknown;
  disposed: boolean;
};

type TestModel = {
  tables: Map<string, ScheduleRow[]>;
  extend: Mock;
  get: Mock<(table: string, query: Record<string, unknown>) => Promise<ScheduleRow[]>>;
  create: Mock<(table: string, row: ScheduleRow) => Promise<ScheduleRow>>;
  set: Mock<
    (table: string, query: Record<string, unknown>, patch: Partial<ScheduleRow>) => Promise<void>
  >;
  remove: Mock<() => Promise<void>>;
};

function createCommandMock() {
  const commands: CommandRecord[] = [];
  const command = vi.fn((def: string, _description?: string, options?: Record<string, unknown>) => {
    const record: CommandRecord = {
      name: def.split(/\s+/, 1)[0] ?? def,
      options,
      optionCalls: [],
      disposed: false,
    };
    commands.push(record);
    const api = {
      option: (name: string, config: unknown) => {
        record.optionCalls.push({ name, config });
        return api;
      },
      action: (fn: CommandRecord["action"]) => {
        record.action = fn;
        return api;
      },
      dispose: () => {
        record.disposed = true;
      },
    };
    return api;
  });
  return { commands, command };
}

function matches(row: ScheduleRow, query: Record<string, unknown>): boolean {
  return Object.entries(query).every(
    ([key, value]) => (row as unknown as Record<string, unknown>)[key] === value,
  );
}

function createModel(): TestModel {
  const tables = new Map<string, ScheduleRow[]>();
  return {
    tables,
    extend: vi.fn(),
    get: vi.fn(async (table: string, query: Record<string, unknown>) =>
      (tables.get(table) ?? []).filter((row) => matches(row, query)),
    ),
    create: vi.fn(async (table: string, row: ScheduleRow) => {
      const rows = tables.get(table) ?? [];
      rows.push(row);
      tables.set(table, rows);
      return row;
    }),
    set: vi.fn(
      async (table: string, query: Record<string, unknown>, patch: Partial<ScheduleRow>) => {
        for (const row of tables.get(table) ?? []) {
          if (matches(row, query)) Object.assign(row, patch);
        }
      },
    ),
    remove: vi.fn(async () => undefined),
  };
}

function createContext(model: TestModel) {
  const ready: Array<() => Promise<void> | void> = [];
  const dispose: Array<() => Promise<void> | void> = [];
  const factories: Factory[] = [];
  const { commands, command } = createCommandMock();
  const trigger = vi.fn(async () => undefined);
  const registerAgentPlugin = vi.fn((factory: Factory) => {
    factories.push(factory);
    return vi.fn();
  });
  const ctx = {
    logger: () => ({
      info: vi.fn(),
      success: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    }),
    on: vi.fn((event: string, callback: () => Promise<void> | void) => {
      if (event === "ready") ready.push(callback);
      if (event === "dispose") dispose.push(callback);
    }),
    command,
    model,
    yesimbot: { trigger, registerAgentPlugin },
  };
  return { ctx, ready, dispose, factories, commands, trigger, registerAgentPlugin };
}

async function toolNames(plugin: AgentPlugin): Promise<string[]> {
  const set =
    typeof plugin.tools === "function"
      ? ((await plugin.tools({} as never)) ?? [])
      : (plugin.tools ?? []);
  return set.map((tool) => tool.name);
}

/** Walks the plugin object graph looking for a retained reference to `sought`. */
function references(target: unknown, sought: unknown, seen = new Set<unknown>()): boolean {
  if (typeof target !== "object" || target === null) return false;
  if (seen.has(target)) return false;
  seen.add(target);
  if (target === sought) return true;
  for (const key of Object.keys(target)) {
    if (references((target as Record<string, unknown>)[key], sought, seen)) return true;
  }
  return false;
}

function futureRow(overrides: Partial<ScheduleRow> = {}): ScheduleRow {
  return {
    id: "future",
    type: "shared",
    platform: "onebot",
    selfId: "bot",
    channelId: "room",
    title: "未来任务",
    prompt: "到期提示",
    kind: "once",
    at: "2099-01-01T00:00:00Z",
    cron: null,
    state: "enabled",
    nextRunAt: "2099-01-01T00:00:00Z",
    lastResult: null,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("SchedulePlugin", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("registers the model, AgentPlugin factory, and authority-4 commands on ready", async () => {
    const model = createModel();
    const { ctx, ready, factories, commands, registerAgentPlugin } = createContext(model);
    const plugin = new SchedulePlugin(ctx as never);

    expect(model.extend).toHaveBeenCalledOnce();
    expect(registerAgentPlugin).not.toHaveBeenCalled();
    expect(commands).toHaveLength(0);

    await ready[0]?.();

    expect(registerAgentPlugin).toHaveBeenCalledOnce();
    const names = commands.map(({ name }) => name);
    expect(names).toEqual([
      "yesimbot.schedule",
      "yesimbot.schedule.create",
      "yesimbot.schedule.list",
      "yesimbot.schedule.update",
      "yesimbot.schedule.pause",
      "yesimbot.schedule.resume",
      "yesimbot.schedule.cancel",
    ]);
    for (const name of names) {
      expect(commands.find(({ name: n }) => n === name)?.options).toMatchObject({ authority: 4 });
    }
    // No command may offer a cross-channel target option.
    for (const record of commands) {
      expect(record.optionCalls.map(({ name }) => name)).not.toContain("target");
      expect(record.optionCalls.map(({ name }) => name)).not.toContain("channel");
    }

    const agent = factories[0]?.(
      { type: "shared", platform: "onebot", selfId: "bot", channelId: "room" },
      {},
    );
    expect(agent).toBeDefined();
    expect(await toolNames(agent!)).toEqual([
      "schedule_create",
      "schedule_list",
      "schedule_update",
      "schedule_pause",
      "schedule_resume",
      "schedule_cancel",
    ]);
    expect(plugin).toBeDefined();
  });

  it("recovers persisted schedules and arms the earliest due timer on ready", async () => {
    const model = createModel();
    const missed = futureRow({
      id: "missed",
      title: "已错过",
      at: "2020-01-01T00:00:00Z",
      nextRunAt: "2020-01-01T00:00:00Z",
    });
    const upcoming = futureRow({ id: "upcoming" });
    model.tables.set("yesimbot_schedule", [missed, upcoming]);

    const { ctx, ready, trigger } = createContext(model);
    new SchedulePlugin(ctx as never);
    await ready[0]?.();

    expect(missed).toMatchObject({ state: "completed", nextRunAt: null });
    expect(missed.lastResult).toMatchObject({
      occurrenceAt: "2020-01-01T00:00:00Z",
      status: "missed",
    });
    expect(upcoming).toMatchObject({ state: "enabled", nextRunAt: "2099-01-01T00:00:00Z" });
    expect(vi.getTimerCount()).toBe(1);
    expect(trigger).not.toHaveBeenCalled();
  });

  it("derives command scope from the active Session and never retains it", async () => {
    const model = createModel();
    const { ctx, ready, commands } = createContext(model);
    const plugin = new SchedulePlugin(ctx as never);
    await ready[0]?.();

    const create = commands.find(({ name }) => name === "yesimbot.schedule.create")!;
    const update = commands.find(({ name }) => name === "yesimbot.schedule.update")!;
    const pause = commands.find(({ name }) => name === "yesimbot.schedule.pause")!;
    const resume = commands.find(({ name }) => name === "yesimbot.schedule.resume")!;
    const cancel = commands.find(({ name }) => name === "yesimbot.schedule.cancel")!;
    const list = commands.find(({ name }) => name === "yesimbot.schedule.list")!;
    const parent = commands.find(({ name }) => name === "yesimbot.schedule")!;

    const sharedSession = {
      platform: "onebot",
      selfId: "bot",
      channelId: "room",
      isDirect: false,
    };
    expect(
      await create.action!(
        { session: sharedSession, options: { at: "2099-01-01T00:00:00Z" } },
        "日报",
        "每天早上写一份日报",
      ),
    ).toContain("已创建定时任务");

    const rows = model.tables.get("yesimbot_schedule")!;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      type: "shared",
      platform: "onebot",
      selfId: "bot",
      channelId: "room",
      title: "日报",
      prompt: "每天早上写一份日报",
      kind: "once",
      at: "2099-01-01T00:00:00Z",
      state: "enabled",
    });

    const directSession = {
      platform: "onebot",
      selfId: "bot",
      channelId: "user-1",
      isDirect: true,
    };
    expect(
      await create.action!(
        { session: directSession, options: { cron: "0 9 * * 1" } },
        "周报",
        "每周一写周报",
      ),
    ).toContain("已创建定时任务");
    const weekly = rows.find((row) => row.title === "周报")!;
    expect(weekly).toMatchObject({
      type: "direct",
      platform: "onebot",
      selfId: "bot",
      channelId: "user-1",
      kind: "cron",
      cron: "0 9 * * 1",
      state: "enabled",
    });

    const id = rows[0].id;
    expect(
      await update.action!({ session: sharedSession, options: { title: "日报 v2" } }, id),
    ).toContain("已更新定时任务");
    expect(rows.find((row) => row.id === id)).toMatchObject({ title: "日报 v2" });

    expect(await pause.action!({ session: sharedSession, options: {} }, id)).toContain("已暂停");
    expect(rows.find((row) => row.id === id)).toMatchObject({ state: "paused", nextRunAt: null });

    expect(await resume.action!({ session: sharedSession, options: {} }, id)).toContain("已恢复");
    expect(rows.find((row) => row.id === id)).toMatchObject({ state: "enabled" });

    expect(await cancel.action!({ session: sharedSession, options: {} }, id)).toContain("已取消");
    expect(rows.find((row) => row.id === id)).toMatchObject({
      state: "cancelled",
      nextRunAt: null,
    });

    expect(await list.action!({ session: sharedSession, options: {} })).toContain(id);
    expect(await parent.action!({ session: sharedSession, options: {} })).toContain(id);

    // The scope comes from the live Session only: another channel cannot manage it.
    const otherSession = {
      platform: "onebot",
      selfId: "bot",
      channelId: "other-room",
      isDirect: false,
    };
    expect(await cancel.action!({ session: otherSession, options: {} }, id)).toContain("取消失败");
    // A Session-less invocation is rejected before any Store operation.
    expect(
      await create.action!(
        { session: undefined, options: { at: "2099-01-01T00:00:00Z" } },
        "无会话",
        "p",
      ),
    ).toBe("无法获取当前频道信息");

    expect(references(plugin, sharedSession)).toBe(false);
    expect(references(plugin, directSession)).toBe(false);
  });

  it("dispose closes scheduler admission and clears timers while preserving rows", async () => {
    const model = createModel();
    const upcoming = futureRow();
    model.tables.set("yesimbot_schedule", [upcoming]);

    const { ctx, ready, dispose, trigger, registerAgentPlugin } = createContext(model);
    new SchedulePlugin(ctx as never);
    await ready[0]?.();
    expect(vi.getTimerCount()).toBe(1);

    const disposeFactory = registerAgentPlugin.mock.results[0]?.value as () => void;
    const clearSpy = vi.spyOn(globalThis, "clearTimeout");
    await dispose[0]?.();

    expect(disposeFactory).toHaveBeenCalledOnce();
    expect(clearSpy).toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);

    // No wake can submit anything after stop: the row stays enabled and unclaimed.
    vi.advanceTimersByTime(24 * 60 * 60 * 1000);
    expect(trigger).not.toHaveBeenCalled();
    expect(upcoming).toMatchObject({
      state: "enabled",
      nextRunAt: "2099-01-01T00:00:00Z",
      lastResult: null,
    });
    expect(model.tables.get("yesimbot_schedule")).toHaveLength(1);
  });
  it("rearms the running scheduler for Agent creation of earlier work", async () => {
    vi.setSystemTime(new Date("2026-08-01T00:00:00.000Z"));
    const model = createModel();
    model.tables.set("yesimbot_schedule", [
      futureRow({ at: "2026-08-01T03:00:00.000Z", nextRunAt: "2026-08-01T03:00:00.000Z" }),
    ]);
    const { ctx, ready, factories, trigger } = createContext(model);
    new SchedulePlugin(ctx as never);
    await ready[0]?.();
    const agent = factories[0]!(
      { type: "shared", platform: "onebot", selfId: "bot", channelId: "room" },
      {},
    );
    const create = (await agent.tools!({} as never))!.find(
      (tool) => tool.name === "schedule_create",
    )!;

    await create.execute!(
      { title: "agent", prompt: "Run.", at: "2026-08-01T00:01:00.000Z" },
      {} as never,
    );
    await vi.advanceTimersByTimeAsync(60_000);

    expect(trigger).toHaveBeenCalledOnce();
    expect(trigger.mock.calls[0]?.[0]).toMatchObject({ schedule: { title: "agent" } });
  });

  it("rearms the running scheduler for authority-4 command creation of earlier work", async () => {
    vi.setSystemTime(new Date("2026-08-01T00:00:00.000Z"));
    const model = createModel();
    model.tables.set("yesimbot_schedule", [
      futureRow({ at: "2026-08-01T03:00:00.000Z", nextRunAt: "2026-08-01T03:00:00.000Z" }),
    ]);
    const { ctx, ready, commands, trigger } = createContext(model);
    new SchedulePlugin(ctx as never);
    await ready[0]?.();
    const create = commands.find(({ name }) => name === "yesimbot.schedule.create")!;
    const session = { platform: "onebot", selfId: "bot", channelId: "room", isDirect: false };

    await create.action!(
      { session, options: { at: "2026-08-01T00:01:00.000Z" } },
      "command",
      "Run.",
    );
    await vi.advanceTimersByTimeAsync(60_000);

    expect(trigger).toHaveBeenCalledOnce();
    expect(trigger.mock.calls[0]?.[0]).toMatchObject({ schedule: { title: "command" } });
  });
  it("rearms after every Agent management mutation", async () => {
    const model = createModel();
    const { ctx, ready, factories } = createContext(model);
    const rearm = vi.spyOn(ScheduleScheduler.prototype, "rearm");
    new SchedulePlugin(ctx as never);
    await ready[0]?.();
    const agent = factories[0]!(
      { type: "shared", platform: "onebot", selfId: "bot", channelId: "room" },
      {},
    );
    const tools = (await agent.tools!({} as never))!;
    const create = tools.find((tool) => tool.name === "schedule_create")!;
    const update = tools.find((tool) => tool.name === "schedule_update")!;
    const pause = tools.find((tool) => tool.name === "schedule_pause")!;
    const resume = tools.find((tool) => tool.name === "schedule_resume")!;
    const cancel = tools.find((tool) => tool.name === "schedule_cancel")!;
    const created = (await create.execute!(
      { title: "agent", prompt: "Run.", at: "2099-01-01T00:00:00Z" },
      {} as never,
    )) as { id: string };

    await update.execute!({ id: created.id, title: "agent v2" }, {} as never);
    await pause.execute!({ id: created.id }, {} as never);
    await resume.execute!({ id: created.id }, {} as never);
    await cancel.execute!({ id: created.id }, {} as never);

    expect(rearm).toHaveBeenCalledTimes(5);
  });

  it("rearms after every authority-4 command mutation", async () => {
    const model = createModel();
    const { ctx, ready, commands } = createContext(model);
    const rearm = vi.spyOn(ScheduleScheduler.prototype, "rearm");
    new SchedulePlugin(ctx as never);
    await ready[0]?.();
    const session = { platform: "onebot", selfId: "bot", channelId: "room", isDirect: false };
    const create = commands.find(({ name }) => name === "yesimbot.schedule.create")!;
    const update = commands.find(({ name }) => name === "yesimbot.schedule.update")!;
    const pause = commands.find(({ name }) => name === "yesimbot.schedule.pause")!;
    const resume = commands.find(({ name }) => name === "yesimbot.schedule.resume")!;
    const cancel = commands.find(({ name }) => name === "yesimbot.schedule.cancel")!;
    await create.action!({ session, options: { at: "2099-01-01T00:00:00Z" } }, "command", "Run.");
    const id = model.tables.get("yesimbot_schedule")![0]!.id;

    await update.action!({ session, options: { title: "command v2" } }, id);
    await pause.action!({ session, options: {} }, id);
    await resume.action!({ session, options: {} }, id);
    await cancel.action!({ session, options: {} }, id);

    expect(rearm).toHaveBeenCalledTimes(5);
  });
});
