import type { AgentPlugin } from "@yesimbot/agent-runtime";
import type { LanguageModelUsage } from "ai";
import type { Awaitable, Bot, Session } from "koishi";

import type { ChannelScope } from "../channels/index.js";
import { defaultWillEngine, type WillEngine, type WillPlugin } from "./will.js";

export type Disposer = () => void;

export type ChannelModelResolver = (scope: ChannelScope) => Awaitable<string | void>;
export type UsageReporter = (scope: ChannelScope, report: UsageReport) => Awaitable<void>;
export type TriggerGuard = (scope: ChannelScope) => Awaitable<boolean>;

export interface ChannelPluginContext {
  readonly modelId: string;
}

export interface UsageReport {
  readonly kind: "compact" | "vision";
  readonly modelId?: string;
  readonly usage: Partial<LanguageModelUsage>;
}

export interface ChannelPlugin {
  setup(scope: ChannelScope, bot: Bot, context?: ChannelPluginContext): Awaitable<AgentPlugin | null>;
}

export class Agents {
  private readonly plugins = new Set<ChannelPlugin>();
  private readonly willPlugins = new Set<WillPlugin>();
  private readonly modelResolvers = new Set<ChannelModelResolver>();
  private readonly usageReporters = new Set<UsageReporter>();
  private readonly triggerGuards = new Set<TriggerGuard>();

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

  public async resolveModel(scope: ChannelScope, fallback: string): Promise<string> {
    for (const resolver of this.modelResolvers) {
      const model = await resolver(scope);
      if (model?.trim()) return model.trim();
    }
    return fallback;
  }

  public async reportUsage(scope: ChannelScope, report: UsageReport): Promise<void> {
    await Promise.allSettled([...this.usageReporters].map((reporter) => reporter(scope, report)));
  }

  public async allowTrigger(scope: ChannelScope): Promise<boolean> {
    for (const guard of this.triggerGuards) {
      if (!(await guard(scope))) return false;
    }
    return true;
  }

  public async setup(scope: ChannelScope, bot: Bot, context?: ChannelPluginContext): Promise<AgentPlugin[]> {
    const initialized: AgentPlugin[] = [];
    try {
      for (const plugin of this.plugins) {
        const result = await plugin.setup(scope, bot, context);
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

  public async setupWill(scope: ChannelScope, session?: Session): Promise<WillEngine> {
    if (!session) return defaultWillEngine;
    const plugins = [...this.willPlugins].map((plugin, index) => ({ plugin, index }));
    plugins.sort((left, right) => left.plugin.priority - right.plugin.priority || left.index - right.index);
    for (const { plugin } of plugins) {
      if (plugin.match(session)) return plugin.setup(scope);
    }
    return defaultWillEngine;
  }
}

export type { WillEngine, WillPlugin } from "./will.js";
