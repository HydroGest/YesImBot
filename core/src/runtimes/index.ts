import type { Bot, Context, Session } from "koishi";
import { Universal } from "koishi";

import { Agents } from "../agents/index.js";
import type { Channel, Channels, ChannelScope } from "../channels/index.js";
import type { Config } from "../config.js";
import type { EventRecord, MessageRecord } from "../messages/index.js";
import { ModelService } from "../models/index.js";
import { ChannelRuntime, type RuntimeResult } from "./channel.js";

export class Runtimes {
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
  ) {}

  public async get(channel: Channel, bot: Bot, session?: Session): Promise<ChannelRuntime> {
    const key = runtimeKey(channel.scope);
    let value!: ChannelRuntime;
    await this.serialize(key, async () => {
      this.assertOpen();
      const current = this.runtimes.get(key);
      if (current && (channel.scope.type === "direct" || current.selfId === bot.selfId)) { value = current; return; }
      if (current) await current.stop();
      const chat = this.model.resolveChatModel(this.config.chatModel);
      const vision = this.resolveVision();
      const runtime = new ChannelRuntime(this.ctx, {
        channel,
        bot,
        will: await this.agents.initWill(channel.scope, session),
        model: chat.model,
        visionModel: vision,
        imageOutputSupported: chat.entry.modalities?.input?.includes("image") ?? false,
        config: this.config,
        plugins: await this.agents.init(channel.scope, bot),
        idleTimeout: this.config.session.idle.timeout,
        compact: async () => { await channel.conversation.compact("idle"); },
      });
      try { await runtime.init(); } catch (cause) { await runtime.stop().catch(() => undefined); throw cause; }
      this.runtimes.set(key, runtime);
      value = runtime;
    });
    return value;
  }

  public async route(record: MessageRecord | EventRecord, bot: Bot, session?: Session): Promise<RuntimeResult> {
    const channel = await this.channels.resolve(scopeFromRecord(record));
    return (await this.get(channel, bot, session)).handle(record);
  }

  public async post(event: EventRecord, bot: Bot): Promise<RuntimeResult> {
    const channel = await this.channels.resolve(scopeFromRecord(event));
    return (await this.get(channel, bot)).post(event);
  }

  public async reset(scope: ChannelScope): Promise<void> {
    const key = runtimeKey(scope);
    await this.serialize(key, async () => {
      const current = this.runtimes.get(key);
      if (current) await current.stop();
      this.runtimes.delete(key);
      await this.channels.reset(scope);
    });
  }

  public stop(): Promise<void> {
    if (this.stopTask) return this.stopTask;
    this.stopped = true;
    this.stopTask = Promise.allSettled([...this.runtimes.values()].map((runtime) => runtime.stop())).then(() => {
      this.runtimes.clear();
      this.tails.clear();
    });
    return this.stopTask;
  }

  public async compact(scope: ChannelScope): Promise<string> {
    const result = await (await this.channels.resolve(scope)).conversation.compact("manual");
    return result.compacted ? "已压缩当前会话。" : "消息不足，未压缩。";
  }

  public async archive(scope: ChannelScope): Promise<string> {
    const key = runtimeKey(scope);
    await this.serialize(key, async () => {
      const runtime = this.runtimes.get(key);
      if (runtime) await runtime.stop();
      this.runtimes.delete(key);
      await (await this.channels.resolve(scope)).conversation.archive();
    });
    return "已归档当前会话。";
  }

  public clear(scope: ChannelScope): Promise<void> {
    return this.reset(scope);
  }

  public async status(scope: ChannelScope): Promise<string> {
    const active = await (await this.channels.resolve(scope)).conversation.status();
    return active.active ? `活动会话：${active.active.filename}` : "无会话记录。";
  }

  public async list(scope: ChannelScope): Promise<string> {
    const sessions = await (await this.channels.resolve(scope)).conversation.list();
    return sessions.length
      ? sessions.map((session) => `${session.isActive ? "→ " : "  "}${session.filename}`).join("\n")
      : "无会话记录。";
  }

  private resolveVision() {
    if (!this.config.visionModel) return undefined;
    const vision = this.model.resolveChatModel(this.config.visionModel);
    return vision.entry.modalities?.input?.includes("image") ? vision.model : undefined;
  }

  private async serialize(key: string, task: () => Promise<void>): Promise<void> {
    const previous = this.tails.get(key) ?? Promise.resolve();
    const next = previous.then(task, task);
    const settled = next.then(() => undefined, () => undefined);
    this.tails.set(key, settled);
    try {
      await next;
    } finally {
      if (this.tails.get(key) === settled) this.tails.delete(key);
    }
  }

  private assertOpen(): void { if (this.stopped) throw new Error("Runtimes are stopped"); }
}

function scopeFromRecord(record: MessageRecord | EventRecord): ChannelScope {
  return record.channel.type === Universal.Channel.Type.DIRECT
    ? { type: "direct", platform: record.platform, selfId: record.selfId, channelId: record.channel.id }
    : { type: "shared", platform: record.platform, channelId: record.channel.id };
}

function runtimeKey(scope: ChannelScope): string {
  return scope.type === "direct" ? `direct:${scope.platform}:${scope.selfId}:${scope.channelId}` : `shared:${scope.platform}:${scope.channelId}`;
}

export { type RuntimeResult, type PostOptions, type ChannelOutput, ChannelRuntime } from "./channel.js";
