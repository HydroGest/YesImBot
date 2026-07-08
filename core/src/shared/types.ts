import type { Bot } from "koishi";

import type { ChannelScope } from "../channel.js";

export type { ChannelScope, ChannelScopeId, ChannelScopeRecord } from "../channel.js";

export interface ChannelAgentContext {
  readonly channel: ChannelScope & {
    readonly type: "private" | "group";
  };
  readonly platform: {
    readonly name: string;
    readonly unsafeBot?: Bot;
  };
}
