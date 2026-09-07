import type { AgentPlugin } from "@yesimbot/agent-runtime";
import type { Awaitable, Bot, Context, Logger, Session } from "koishi";

import type { ChannelContext } from "../channels/index.js";
import { defaultWillEngine, type WillEngine, type WillPlugin } from "./will.js";

type Disposer = () => void;

export interface ChannelPlugin {
  setup(context: ChannelContext, bot: Bot): Awaitable<AgentPlugin | null>;
}

export class Agents {
  private readonly ctx: Context;
  private readonly logger: Logger;

  private readonly plugins = new Set<ChannelPlugin>();
  private readonly willPlugins = new Set<WillPlugin>();

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

  public async setup(context: ChannelContext, bot: Bot): Promise<AgentPlugin[]> {
    const initialized: AgentPlugin[] = [];
    try {
      for (const plugin of this.plugins) {
        const result = await plugin.setup(context, bot);
        if (result) initialized.push(result);
      }
      return initialized;
    } catch (error) {
      for (const plugin of initialized.reverse()) {
        try {
          await plugin.stop?.();
        } catch {}
      }
      throw error;
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

export type { WillDebug, WillEngine, WillPlugin, WillState } from "./will.js";
