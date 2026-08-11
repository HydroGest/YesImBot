import type { AgentPlugin } from "@yesimbot/agent-runtime";
import type { LanguageModelUsage } from "ai";
import type { Awaitable, Bot, Context, Logger, Session } from "koishi";

import type { ChannelContext } from "../channels/index.js";
import { defaultWillEngine, type WillEngine, type WillPlugin } from "./will.js";

type Disposer = () => void;

export type ChannelModelResolver = (context: ChannelContext) => Awaitable<string | void>;
export type UsageReporter = (context: ChannelContext, report: UsageReport) => Awaitable<void>;
export type TriggerGuard = (context: ChannelContext) => Awaitable<boolean>;

export interface ChannelPluginContext {
  readonly modelId: string;
}

export interface UsageReport {
  readonly kind: "compact" | "vision";
  readonly modelId?: string;
  readonly usage: Partial<LanguageModelUsage>;
}

export interface ChannelPlugin {
  setup(context: ChannelContext, bot: Bot, pluginContext?: ChannelPluginContext): Awaitable<AgentPlugin | null>;
}

export class Agents {
  private readonly ctx: Context;
  private readonly logger: Logger;

  private readonly plugins = new Set<ChannelPlugin>();
  private readonly willPlugins = new Set<WillPlugin>();
  private readonly modelResolvers = new Set<ChannelModelResolver>();
  private readonly usageReporters = new Set<UsageReporter>();
  private readonly triggerGuards = new Set<TriggerGuard>();

  public constructor(ctx: Context, config: { logLevel?: number } = {}) {
    this.ctx = ctx;
    this.logger = ctx.logger("yesimbot.agents");
    this.logger.level = config.logLevel ?? 2;
  }

  public use(plugin: ChannelPlugin): Disposer {
    this.plugins.add(plugin);
    return () => this.plugins.delete(plugin);
  }

  public will(plugin: WillPlugin): Disposer {
    this.willPlugins.add(plugin);
    return () => this.willPlugins.delete(plugin);
  }

  public model(resolver: ChannelModelResolver): Disposer {
    this.modelResolvers.add(resolver);
    return () => this.modelResolvers.delete(resolver);
  }

  public usage(reporter: UsageReporter): Disposer {
    this.usageReporters.add(reporter);
    return () => this.usageReporters.delete(reporter);
  }

  public guard(guard: TriggerGuard): Disposer {
    this.triggerGuards.add(guard);
    return () => this.triggerGuards.delete(guard);
  }

  public async resolveModel(context: ChannelContext, fallback: string): Promise<string> {
    for (const resolver of this.modelResolvers) {
      const model = await resolver(context);
      if (model?.trim()) return model.trim();
    }
    return fallback;
  }

  public async reportUsage(context: ChannelContext, report: UsageReport): Promise<void> {
    await Promise.allSettled([...this.usageReporters].map((reporter) => reporter(context, report)));
  }

  public async allowTrigger(context: ChannelContext): Promise<boolean> {
    for (const guard of this.triggerGuards) {
      if (!(await guard(context))) return false;
    }
    return true;
  }

  public async setup(context: ChannelContext, bot: Bot, pluginContext?: ChannelPluginContext): Promise<AgentPlugin[]> {
    const initialized: AgentPlugin[] = [];
    try {
      for (const plugin of this.plugins) {
        const result = await plugin.setup(context, bot, pluginContext);
        if (result) initialized.push(result);
      }
      return initialized;
    } catch (cause) {
      for (const plugin of initialized.reverse()) {
        try {
          await plugin.stop?.();
        } catch {}
      }
      throw cause;
    }
  }

  public async setupWill(context: ChannelContext, session?: Session): Promise<WillEngine> {
    const plugins = [...this.willPlugins].map((plugin, index) => ({ plugin, index }));
    plugins.sort((left, right) => left.plugin.priority - right.plugin.priority || left.index - right.index);
    this.logger.debug("agents.setup_will", {
      hasSession: session !== undefined,
      pluginCount: plugins.length,
      platform: context.platform,
      channelId: context.channelId,
    });
    for (const { plugin } of plugins) {
      if ((session && plugin.match(session)) || plugin.matchContext?.(context)) {
        const engine = await plugin.setup(context);
        this.logger.debug("agents.will_selected", { engine: engine.constructor?.name ?? "plugin", plugin: plugin.constructor?.name ?? "will-plugin" });
        return engine;
      }
    }
    this.logger.debug("agents.will_selected", { engine: "default" });
    return defaultWillEngine;
  }
}

export type { WillEngine, WillPlugin } from "./will.js";
