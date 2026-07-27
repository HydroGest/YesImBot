import type { Awaitable, Universal } from "koishi";

import type { Config } from "../config.js";
import { isMessage, type Input } from "../event/index.js";
import {
  createWillingnessConfig,
  isSelfMention,
  WillingnessWillEngine,
  type WillingnessConfigInput,
  type WillingnessWillOptions,
} from "./willingness.js";

export {
  createWillingnessConfig,
  decayScore,
  WillingnessWillEngine,
  type WillingnessConfig,
  type WillingnessConfigInput,
} from "./willingness.js";

const DIRECT_CHANNEL_TYPE = 1 satisfies Universal.Channel.Type;

export interface WillEngine {
  decide(input: Input, state: WillEngine.State): Awaitable<WillEngine.Decision>;
  onReply?(): Awaitable<void>;
  stop?(): Awaitable<void>;
}

export namespace WillEngine {
  export type Decision = "wait" | "trigger";

  export interface State {
    readonly activeTurnId: string | null;
  }
}

export interface WillEngineObservation {
  readonly event: Input;
  readonly decision: WillEngine.Decision;
}

export interface DefaultWillConfig {
  readonly direct: WillEngine.Decision;
  readonly mention: WillEngine.Decision;
  readonly group: WillEngine.Decision;
}

export interface WillConfig extends Partial<DefaultWillConfig>, WillingnessConfigInput {
  readonly engine?: "routing" | "willingness";
}

const DEFAULT_CONFIG: DefaultWillConfig = {
  direct: "trigger",
  mention: "trigger",
  group: "wait",
};

export interface WillEngineDiagnostics extends Pick<
  WillingnessWillOptions,
  "now" | "random" | "warn"
> {}

export function createWillEngine(
  config: Config["will"] | undefined,
  diagnostics: WillEngineDiagnostics,
): WillEngine {
  if (config?.engine === "willingness") {
    return new WillingnessWillEngine({
      config: createWillingnessConfig(config),
      ...diagnostics,
    });
  }
  return new RoutingWillEngine(config);
}

export class RoutingWillEngine implements WillEngine {
  private readonly config: DefaultWillConfig;

  constructor(config: Partial<DefaultWillConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  async decide(input: Input, _state: WillEngine.State): Promise<WillEngine.Decision> {
    if (!isMessage(input)) return "wait";
    if (input.data.channel.type === DIRECT_CHANNEL_TYPE) return this.config.direct;
    if (isSelfMention(input.data.selfId, input.data.elements)) {
      return this.config.mention;
    }
    return this.config.group;
  }
}

declare module "koishi" {
  interface Events {
    "yesimbot/will": (observation: WillEngineObservation) => void;
  }
}
