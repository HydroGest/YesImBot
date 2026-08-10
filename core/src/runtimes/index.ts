import type { Bot, Context, Logger, Session } from "koishi";

import { Agents } from "../agents/index.js";
import type { Channel, Channels } from "../channels/index.js";
import { type ChannelContext, type ChannelKey, deriveChannelKey } from "../channels/index.js";
import type { Config } from "../config.js";
import { ModelService } from "../models/index.js";
import { ChannelRuntime } from "./channel.js";
import { readPersona } from "./prompt.js";

export class Runtimes {
  private readonly logger: Logger;
  private readonly runtimes = new Map<string, ChannelRuntime>();
  private readonly tails = new Map<string, Promise<void>>();
  private stopped = false;
  private stopTask: Promise<void> | undefined;

  public constructor(
    private readonly ctx: Context,
    private readonly channels: Channels,
    private readonly model: ModelService,
    private readonly config: Config,
    private readonly agents: Agents,
  ) {
    this.logger = ctx.logger("yesimbot.runtimes");
    this.logger.level = config.logLevel ?? 2;
  }

  public async get(channel: Channel, bot: Bot, session?: Session): Promise<ChannelRuntime> {
    const key = runtimeKey(channel.context);
    let value!: ChannelRuntime;
    await this.serialize(key, async () => {
      this.assertOpen();
      const current = this.runtimes.get(key);
      if (current && (channel.context.type === "direct" || current.selfId === bot.selfId)) {
        value = current;
        return;
      }
      if (current) {
        this.logger.debug("runtimes.get.recreate", { key, oldSelfId: current.selfId, newSelfId: bot.selfId });
        await current.stop();
      }
      const chat = this.model.resolveChatModel(this.config.chatModel);
      const vision = this.resolveVision();
      const runtime = new ChannelRuntime(this.ctx, {
        channel,
        bot,
        will: await this.agents.setupWill(channel.context, session),
        model: chat.model,
        visionModel: vision,
        imageOutputSupported: chat.entry.modalities?.input?.includes("image") ?? false,
        config: this.config,
        plugins: await this.agents.setup(channel.context, bot),
        idleTimeout: this.config.session.idle.timeout,
      });
      try {
        await runtime.init();
      } catch (cause) {
        await runtime.stop().catch(() => undefined);
        throw cause;
      }
      this.runtimes.set(key, runtime);
      this.logger.debug("runtimes.get.created", { key, selfId: bot.selfId, runtimeCount: this.runtimeCount() });
      value = runtime;
    });
    return value;
  }

  public async reset(ctx: ChannelContext): Promise<void> {
    const key = runtimeKey(ctx);
    await this.serialize(key, async () => {
      const current = this.runtimes.get(key);
      if (current) {
        this.logger.debug("runtimes.reset", { key });
        await current.stop();
      }
      this.runtimes.delete(key);
      await this.channels.reset(ctx);
    });
  }

  public stop(): Promise<void> {
    if (this.stopTask) return this.stopTask;
    this.stopped = true;
    this.logger.debug("runtimes.stop", { runtimeCount: this.runtimes.size });
    this.stopTask = Promise.allSettled([...this.runtimes.values()].map((runtime) => runtime.stop())).then(() => {
      this.runtimes.clear();
      this.tails.clear();
    });
    return this.stopTask;
  }

  public async compact(ctx: ChannelContext): Promise<string> {
    const runtime = this.runtimes.get(runtimeKey(ctx));
    if (!runtime) throw new Error("No active Runtime is available to compact this conversation");
    const result = (await runtime.compact("manual")) as { compacted: boolean };
    return result.compacted ? "已压缩当前会话。" : "消息不足，未压缩。";
  }

  public async archive(ctx: ChannelContext, noSummary = false): Promise<string> {
    const key = runtimeKey(ctx);
    await this.serialize(key, async () => {
      const runtime = this.runtimes.get(key);
      if (runtime) await runtime.stop();
      this.runtimes.delete(key);
      const channel = await this.channels.resolve(ctx);
      const input = noSummary
        ? undefined
        : {
            model: this.model.resolveChatModel(this.config.chatModel).model,
            personaName: "Athena",
            persona: await readPersona(this.config.basePath, this.ctx.logger("yesimbot/archive")),
          };
      await channel.conversation.archive(noSummary, input);
    });
    return "已归档当前会话。";
  }

  public clear(ctx: ChannelContext): Promise<void> {
    return this.reset(ctx);
  }

  public async status(ctx: ChannelContext): Promise<string> {
    const active = await (await this.channels.resolve(ctx)).conversation.status();
    return active.active ? `活动会话：${active.active.filename}` : "无会话记录。";
  }

  public async list(ctx: ChannelContext): Promise<string> {
    const sessions = await (await this.channels.resolve(ctx)).conversation.list();
    return sessions.length ? sessions.map((session) => `${session.isActive ? "→ " : "  "}${session.filename}`).join("\n") : "无会话记录。";
  }

  private resolveVision() {
    if (!this.config.visionModel) return undefined;
    const vision = this.model.resolveChatModel(this.config.visionModel);
    return vision.entry.modalities?.input?.includes("image") ? vision.model : undefined;
  }

  private async serialize(key: string, task: () => Promise<void>): Promise<void> {
    const previous = this.tails.get(key) ?? Promise.resolve();
    const next = previous.then(task, task);
    const settled = next.then(
      () => undefined,
      () => undefined,
    );
    this.tails.set(key, settled);
    try {
      await next;
    } finally {
      if (this.tails.get(key) === settled) this.tails.delete(key);
    }
  }

  private assertOpen(): void {
    if (this.stopped) throw new Error("Runtimes are stopped");
  }

  private runtimeCount(): number {
    return [...this.runtimes.values()].length;
  }
}

function runtimeKey(ctx: ChannelContext): ChannelKey {
  return deriveChannelKey(ctx);
}

export { type RuntimeResult, type PostOptions, type ChannelOutput, ChannelRuntime } from "./channel.js";
