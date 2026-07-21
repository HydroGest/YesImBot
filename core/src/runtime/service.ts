import type { AgentPlugin } from "@yesimbot/agent-runtime";
import { Context, Service, Session } from "koishi";

import type { ChannelScope } from "../channel.js";
import type { Config } from "../config.js";
import type { DeliveryService } from "../delivery/service.js";
import type { ModelService } from "../model/service.js";
import type { PlatformService } from "../platform/service.js";
import type { ChannelAgentContext } from "../shared/types.js";
import { ChannelRuntime } from "./channel-runtime.js";

export type AgentPluginFactory = (context: ChannelAgentContext) => AgentPlugin;

declare module "koishi" {
  interface Context {
    yesimbot: YesImBotService;
  }
}

export class YesImBotService extends Service<Config> {
  static readonly inject = ["yesimbot.model", "yesimbot.platform", "yesimbot.delivery"];

  public readonly model: ModelService;
  public readonly platform: PlatformService;
  public readonly delivery: DeliveryService;

  private readonly agentPluginFactories: AgentPluginFactory[] = [];
  private readonly cleanup: Array<() => unknown> = [];
  private readonly channelRuntime: ChannelRuntime;
  private stopTask: Promise<void> | undefined;

  constructor(ctx: Context, config: Config) {
    super(ctx, "yesimbot", true);
    this.config = config;
    this.logger.level = config.logLevel ?? 2;

    this.model = ctx["yesimbot.model"];
    this.platform = ctx["yesimbot.platform"];
    this.delivery = ctx["yesimbot.delivery"];
    this.channelRuntime = new ChannelRuntime({
      ctx,
      config,
      logger: this.logger,
      platform: this.platform,
      delivery: this.delivery,
      getAgentPlugins: (context) => this.createExternalAgentPlugins(context),
    });

    const command = ctx.command("yesimbot.reset", { authority: 4 });
    command.action(async ({ session }) => {
      if (!session?.platform || !session.selfId || !session.channelId) return;
      await this.resetChannel({
        platform: session.platform,
        selfId: session.selfId,
        channelId: session.channelId,
      });
    });
    if (typeof command.dispose === "function") this.cleanup.push(() => command.dispose());

    const disposeMiddleware = ctx.middleware(
      (session, next) => this.handleSession(session, next),
      true,
    );
    if (typeof disposeMiddleware === "function") this.cleanup.push(disposeMiddleware);
  }

  registerAgentPlugin(factory: AgentPluginFactory): () => void {
    this.agentPluginFactories.push(factory);
    return () => {
      const index = this.agentPluginFactories.indexOf(factory);
      if (index >= 0) this.agentPluginFactories.splice(index, 1);
    };
  }

  async resetChannel(scope: ChannelScope): Promise<void> {
    await this.channelRuntime.reset(scope);
  }

  override stop(): Promise<void> {
    if (this.stopTask) return this.stopTask;
    this.stopTask = this.stopInternal();
    return this.stopTask;
  }

  private async stopInternal(): Promise<void> {
    for (const dispose of this.cleanup.splice(0)) {
      try {
        dispose();
      } catch {
        // Koishi lifecycle disposers are best-effort during service shutdown.
      }
    }
    await this.channelRuntime.stop();
  }

  private createExternalAgentPlugins(context: ChannelAgentContext): AgentPlugin[] {
    return this.agentPluginFactories.map((factory) => factory(context));
  }

  async handleSession(session: Session, next?: () => Promise<unknown>): Promise<void> {
    try {
      const message = this.platform.getMessage(session) ?? this.platform.collectIfNeeded(session);
      if (message) await this.channelRuntime.handle(message, session);
    } finally {
      await next?.();
    }
  }
}
