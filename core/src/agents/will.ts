import type { TurnResult } from "@yesimbot/agent-runtime";
import type { Awaitable, Session, Universal } from "koishi";

import type { ChannelScope } from "../channels/index.js";
import { isMessage, type Event, type Message } from "../messages/index.js";

export interface WillState {
  readonly activeTurnId: string | null;
}

export interface Will {
  decide(input: Message | Event, state: WillState): Awaitable<"wait" | "trigger">;
  observe?(result: TurnResult): Awaitable<void>;
}

export interface WillPlugin {
  readonly priority: number;
  match(session: Session): boolean;
  init(scope: ChannelScope): Awaitable<Will>;
}

export const defaultWill: Will = {
  decide(input: Message | Event, _state: WillState): "wait" | "trigger" {
    if (!isMessage(input)) return "wait";
    if (input.data.channel.type === (1 satisfies Universal.Channel.Type)) return "trigger";
    return input.data.elements.some((element) => element.type === "at" && String(element.attrs.id) === input.data.selfId) ? "trigger" : "wait";
  },
};
