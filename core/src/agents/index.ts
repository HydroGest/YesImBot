import type { AgentPlugin } from "@yesimbot/agent-runtime";
import type { Awaitable, Bot, Session } from "koishi";

import type { ChannelScope } from "../channels/index.js";
import { defaultWill, type Will, type WillPlugin } from "./will.js";

export type Disposer = () => void;

export interface ChannelPlugin {
  init(scope: ChannelScope, bot: Bot): Awaitable<AgentPlugin | null>;
}

export class Agents {
  private readonly plugins = new Set<ChannelPlugin>();
  private readonly willPlugins = new Set<WillPlugin>();

  public use(plugin: ChannelPlugin): Disposer {
    this.plugins.add(plugin);
    return () => this.plugins.delete(plugin);
  }

  public will(plugin: WillPlugin): Disposer {
    this.willPlugins.add(plugin);
    return () => this.willPlugins.delete(plugin);
  }

  public async init(scope: ChannelScope, bot: Bot): Promise<AgentPlugin[]> {
    const initialized: AgentPlugin[] = [];
    try {
      for (const plugin of this.plugins) {
        const result = await plugin.init(scope, bot);
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

  public async initWill(scope: ChannelScope, session?: Session): Promise<Will> {
    if (!session) return defaultWill;
    const plugins = [...this.willPlugins].map((plugin, index) => ({ plugin, index }));
    plugins.sort((left, right) => left.plugin.priority - right.plugin.priority || left.index - right.index);
    for (const { plugin } of plugins) {
      if (plugin.match(session)) return plugin.init(scope);
    }
    return defaultWill;
  }
}

export type { Will, WillPlugin } from "./will.js";
