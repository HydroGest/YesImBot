import { Context } from "koishi";

import type { Config } from "./config.js";
import { ModelService } from "./model/service.js";
import { YesImBotService } from "./service.js";

export const name = "yesimbot";
export const usage = ``;
export const inject = [];
export { Config } from "./config.js";

export * from "./channel/index.js";
export * from "./event/index.js";
export type { ResolveContext, SessionResolver } from "./gateway/index.js";
export { YesImBotService, type AgentPluginFactory } from "./service.js";
export type { ChannelFilter, ChannelRecord } from "./storage/index.js";
export { DefaultWill, type Will, type WillObservation } from "./will/index.js";

export function apply(ctx: Context, config: Config) {
  ctx.plugin(ModelService, config);
  ctx.plugin(YesImBotService, config);
}
