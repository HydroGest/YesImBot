import type { Awaitable, Element, Universal } from "koishi";

import type { ChannelScope } from "../channel/index.js";
import type { Event } from "../event/index.js";
import type { WillingnessConfigInput } from "./willingness.js";

export {
  createWillingnessConfig,
  decayScore,
  WillingnessWill,
  type WillingnessConfig,
  type WillingnessConfigInput,
} from "./willingness.js";

const DIRECT_CHANNEL_TYPE = 1 satisfies Universal.Channel.Type;

export interface Will {
  decide(event: Event, state: Will.State): Awaitable<Will.Decision>;
  onReply?(): Awaitable<void>;
  stop?(): Awaitable<void>;
}

export namespace Will {
  export type Decision = "wait" | "trigger";

  export interface State {
    readonly activeTurnId: string | null;
    readonly pending: readonly Event[];
    readonly recent: readonly Event[];
    readonly lastActivityAt: number | null;
  }

  export type Factory = (channel: ChannelScope) => Awaitable<Will>;
}

export interface WillObservation {
  readonly event: Event;
  readonly decision: Will.Decision;
}

export interface DefaultWillConfig {
  readonly direct: Will.Decision;
  readonly mention: Will.Decision;
  readonly group: Will.Decision;
}

export interface WillConfig extends Partial<DefaultWillConfig>, WillingnessConfigInput {
  readonly engine?: "routing" | "willingness";
}

const DEFAULT_CONFIG: DefaultWillConfig = {
  direct: "trigger",
  mention: "trigger",
  group: "wait",
};

export class DefaultWill implements Will {
  private readonly config: DefaultWillConfig;

  constructor(config: Partial<DefaultWillConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  async decide(event: Event, _state: Will.State): Promise<Will.Decision> {
    if (event.data.type !== "message") return "wait";
    if (event.data.channel.type === DIRECT_CHANNEL_TYPE) return this.config.direct;
    if (event.data.message.elements?.some(isSelfMention.bind(null, event.data.selfId))) {
      return this.config.mention;
    }
    return this.config.group;
  }
}

function isSelfMention(selfId: string, element: Element): boolean {
  return element.type === "at" && String(element.attrs.id) === selfId;
}

declare module "koishi" {
  interface Events {
    "yesimbot/will": (observation: WillObservation) => void;
  }
}
