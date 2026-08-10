import type { Logger, Universal } from "koishi";
import { isMessage, type Event, type Message, type WillEngine } from "koishi-plugin-yesimbot";

import { hasImage, hasQuote, mentionKind } from "./message-context.js";
import type { PolicyRoutingConfig } from "./types.js";

const DIRECT_CHANNEL_TYPE = 1 satisfies Universal.Channel.Type;

export class PolicyRoutingEngine implements WillEngine {
  public constructor(
    private readonly config: PolicyRoutingConfig,
    private readonly logger?: Pick<Logger, "debug">,
  ) {}

  public async decide(input: Message | Event, _state: Parameters<WillEngine["decide"]>[1]): Promise<"wait" | "trigger"> {
    const decision: "wait" | "trigger" = this.resolve(input);
    this.logger?.debug("will_policy.routing", {
      messageId: input.id,
      channelId: input.data.channel.id,
      decision,
    });
    return decision;
  }

  private resolve(input: Message | Event): "wait" | "trigger" {
    if (!isMessage(input)) {
      return isPokeEvent(input) ? this.config.poke : "wait";
    }
    if (input.data.channel.type === DIRECT_CHANNEL_TYPE) return this.config.direct;

    const mention = mentionKind(input.data.selfId, input.data.elements);
    if (mention === "self") return this.config.mention;
    if (mention === "all") return this.config.mentionAll;
    if (mention === "here") return this.config.mentionHere;
    if (hasQuote(input.data.elements)) return this.config.quote;
    if (hasImage(input.data.elements)) return this.config.image;
    return this.config.group;
  }
}

function isPokeEvent(input: Event): boolean {
  return input.role === "custom" && input.type === "yesimbot.event" && (input.data as { eventType?: string }).eventType === "notice.poke";
}
