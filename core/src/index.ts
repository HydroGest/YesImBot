import { Context } from "koishi";

import type { Config } from "./config.js";
import { ModelService } from "./model/index.js";
import { YesImBotService } from "./service.js";

export const name = "yesimbot";
export const usage = ``;
export const inject = ["database"];

export function apply(ctx: Context, config: Config) {
  ctx.plugin(ModelService, config);
  ctx.plugin(YesImBotService, config);
}

export { Config } from "./config.js";

export type { AssetService, AssetStore } from "./asset.js";
export type { ChannelScope } from "./channel.js";
export type { PlatformTranslator } from "./gateway.js";
export * from "./messages.js";
export * from "./model/index.js";
export type { AgentPluginFactory } from "./runtime/index.js";
export type { YesImBotService } from "./service.js";
