import type { AgentPlugin } from "@yesimbot/agent-runtime";
import { Context, Logger } from "koishi";
import type { Command, Session } from "koishi";
import type { ChannelScope } from "koishi-plugin-yesimbot";

import { ScheduleScheduler } from "./scheduler.js";
import { registerScheduleModel, ScheduleStore } from "./store.js";
import { createScheduleTools } from "./tools.js";
import type { Schedule, ScheduleCreateInput, ScheduleUpdateInput } from "./types.js";

/**
 * The optional Koishi plugin that wires the Schedule capability into Core
 * lifecycle. It registers the single plugin-owned table and Store once,
 * recovers and arms the earliest-due timer on ready, registers one
 * current-channel AgentPlugin factory, and exposes `yesimbot.schedule`
 * commands with `authority: 4`. Every command derives its scope only from the
 * active Session for the immediate Store operation and never retains the
 * Session. Disposal closes scheduler admission and clears timers while
 * leaving persisted rows intact.
 */
export default class SchedulePlugin {
  public static name = "yesimbot-schedule";
  public static usage = "为当前频道提供持久化的定时事件触发能力";
  public static inject = ["yesimbot", "database"];
  private readonly ctx: Context;
  private readonly logger: Logger;
  private readonly store: ScheduleStore;

  private scheduler?: ScheduleScheduler;
  private disposeAgentPlugin?: () => void;
  private readonly commandDisposers = new Set<() => unknown>();
  private started = false;

  public constructor(ctx: Context) {
    this.ctx = ctx;
    this.logger = ctx.logger("yesimbot-schedule");
    registerScheduleModel(ctx.model);
    this.store = new ScheduleStore(ctx.model);
    ctx.on("ready", this.start.bind(this));
    ctx.on("dispose", this.stop.bind(this));
  }

  public async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    try {
      this.scheduler = new ScheduleScheduler(this.store, (event) => this.ctx.yesimbot.trigger(event));
      await this.scheduler.start();
      this.disposeAgentPlugin = this.ctx.yesimbot.registerChannelPlugin(({ scope }) => {
        return {
          name: "schedule",
          tools: () => createScheduleTools(scope, this.store, () => this.scheduler?.rearm() ?? Promise.resolve()),
        } satisfies AgentPlugin;
      });
      this.registerCommands();
      this.logger.success("Schedule plugin started");
    } catch (cause) {
      this.started = false;
      this.scheduler?.stop();
      this.scheduler = undefined;
      throw cause;
    }
  }

  public async stop(): Promise<void> {
    this.started = false;
    this.disposeAgentPlugin?.();
    this.disposeAgentPlugin = undefined;
    this.scheduler?.stop();
    this.scheduler = undefined;
    for (const dispose of this.commandDisposers) {
      try {
        dispose();
      } catch {}
    }
    this.commandDisposers.clear();
    this.logger.info("Schedule plugin stopped");
  }

  private registerCommands(): void {
    const track = (command: Command): void => {
      if (typeof command.dispose === "function") {
        this.commandDisposers.add(() => command.dispose());
      }
    };

    track(
      this.ctx
        .command("yesimbot.schedule", "查看当前频道的定时任务", { authority: 4 })
        .action(async ({ session }) => this.listText(scopeOf(session))),
    );

    track(
      this.ctx
        .command("yesimbot.schedule.create <title> <prompt>", "创建定时任务", { authority: 4 })
        .option("at", "<at> 一次性执行的 RFC 3339 时刻（如 2030-01-01T08:00:00+08:00）")
        .option("cron", "<cron> Asia/Shanghai 时区的五段式 cron 表达式（相邻两次执行至少间隔 15 分钟）")
        .action(async ({ session, options }, title, prompt) => {
          const scope = scopeOf(session);
          if (!scope) return "无法获取当前频道信息";
          if (typeof title !== "string" || !title || typeof prompt !== "string" || !prompt) {
            return "用法：yesimbot.schedule.create <标题> <提示词> --at <时刻> 或 --cron <表达式>";
          }
          const at = (options ?? {}).at;
          const cron = (options ?? {}).cron;
          if (at === undefined && cron === undefined) {
            return "必须提供 --at 或 --cron 之一";
          }
          if (at !== undefined && cron !== undefined) {
            return "只能提供 --at 或 --cron 之一";
          }
          const input: ScheduleCreateInput =
            at !== undefined ? { title, prompt, kind: "once", at } : { title, prompt, kind: "cron", cron };
          try {
            const schedule = await this.store.create(scope, input);
            await this.scheduler?.rearm();
            return `已创建定时任务 ${schedule.id}（${schedule.kind}，下次执行 ${schedule.nextRunAt}）`;
          } catch (cause) {
            return `创建失败：${messageOf(cause)}`;
          }
        }),
    );

    track(
      this.ctx
        .command("yesimbot.schedule.list", "列出当前频道的定时任务", { authority: 4 })
        .action(async ({ session }) => this.listText(scopeOf(session))),
    );

    track(
      this.ctx
        .command("yesimbot.schedule.update <id>", "更新定时任务", { authority: 4 })
        .option("title", "<title> 新标题，最长 120 字符")
        .option("prompt", "<prompt> 新提示词，最长 2000 字符")
        .option("at", "<at> 新的一次性执行时刻（RFC 3339，需在未来）")
        .option("cron", "<cron> 新的五段式 cron 表达式（Asia/Shanghai）")
        .action(async ({ session, options }, id) => {
          const scope = scopeOf(session);
          if (!scope) return "无法获取当前频道信息";
          if (typeof id !== "string" || !id) {
            return "用法：yesimbot.schedule.update <id> [--title <标题>] [--prompt <提示词>] [--at <时刻>|--cron <表达式>]";
          }
          const at = (options ?? {}).at;
          const cron = (options ?? {}).cron;
          if (at !== undefined && cron !== undefined) {
            return "只能提供 --at 或 --cron 之一";
          }
          let patch: ScheduleUpdateInput = {};
          if (at !== undefined) patch = { kind: "once", at };
          else if (cron !== undefined) patch = { kind: "cron", cron };
          if (options !== undefined && options.title !== undefined) {
            patch = { ...patch, title: options.title };
          }
          if (options !== undefined && options.prompt !== undefined) {
            patch = { ...patch, prompt: options.prompt };
          }
          try {
            const schedule = await this.store.update(scope, id, patch);
            await this.scheduler?.rearm();
            return `已更新定时任务 ${schedule.id}（${schedule.kind}，下次执行 ${schedule.nextRunAt}）`;
          } catch (cause) {
            return `更新失败：${messageOf(cause)}`;
          }
        }),
    );

    track(
      this.ctx
        .command("yesimbot.schedule.pause <id>", "暂停定时任务", { authority: 4 })
        .action(async ({ session }, id) => this.stateAction("已暂停", "暂停失败", scopeOf(session), id, "pause")),
    );

    track(
      this.ctx
        .command("yesimbot.schedule.resume <id>", "恢复定时任务", { authority: 4 })
        .action(async ({ session }, id) => this.stateAction("已恢复", "恢复失败", scopeOf(session), id, "resume")),
    );

    track(
      this.ctx
        .command("yesimbot.schedule.cancel <id>", "取消定时任务", { authority: 4 })
        .action(async ({ session }, id) => this.stateAction("已取消", "取消失败", scopeOf(session), id, "cancel")),
    );
  }

  private async stateAction(
    okPrefix: string,
    errorPrefix: string,
    scope: ChannelScope | null,
    id: unknown,
    operation: "pause" | "resume" | "cancel",
  ): Promise<string> {
    if (!scope) return "无法获取当前频道信息";
    if (typeof id !== "string" || !id) return `用法：yesimbot.schedule.${operation} <id>`;
    try {
      const schedule = await this.store[operation](scope, id);
      await this.scheduler?.rearm();
      return `${okPrefix}定时任务 ${schedule.id}`;
    } catch (cause) {
      return `${errorPrefix}：${messageOf(cause)}`;
    }
  }

  private async listText(scope: ChannelScope | null): Promise<string> {
    if (!scope) return "无法获取当前频道信息";
    const schedules = await this.store.list(scope);
    if (!schedules.length) return "当前频道没有定时任务";
    return schedules.map(formatSchedule).join("\n");
  }
}

/** Builds the current ChannelScope from the live Session fields only. */
function scopeOf(session: Session | undefined): ChannelScope | null {
  if (!session?.platform || !session.selfId || !session.channelId) return null;
  return {
    type: session.isDirect ? "direct" : "shared",
    platform: session.platform,
    selfId: session.selfId,
    channelId: session.channelId,
  };
}

function formatSchedule(schedule: Schedule): string {
  const parts = [`${schedule.id} ${schedule.title}`, schedule.kind, schedule.state];
  if (schedule.nextRunAt !== null) parts.push(`下次 ${schedule.nextRunAt}`);
  return parts.join("，");
}

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
