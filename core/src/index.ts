import { Context } from "koishi";

import type { Config } from "./config.js";
import { ModelService } from "./model/index.js";
import { Platform } from "./platforms/index.js";
import { YesImBotService } from "./service.js";

export const name = "yesimbot";
export const usage = ``;
export const inject = ["database"];
export { Config } from "./config.js";

export type { ChannelScope } from "./channel.js";
export type { AssetService, AssetStore } from "./asset.js";
export * from "./input.js";
export type { SessionResolver } from "./gateway.js";
export type { AgentPluginFactory } from "./runtime/index.js";
export type { YesImBotService } from "./service.js";

export function apply(ctx: Context, config: Config) {
  ctx.plugin(ModelService, config);
  ctx.plugin(YesImBotService, config);
  ctx.plugin(Platform, config);
}
