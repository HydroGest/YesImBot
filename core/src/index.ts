import { Context } from "koishi";

import type { Config } from "./config.js";
import { ModelService } from "./model/service.js";
import { PlatformService } from "./platform/service.js";
import { YesImBotService } from "./runtime/service.js";

export const name = "yesimbot";
export const usage = ``;
export const inject = [];

export * from "./channel.js";
export { ModelService } from "./model/service.js";
export { PlatformService } from "./platform/service.js";
export { YesImBotService } from "./runtime/service.js";

export function apply(ctx: Context, config: Config) {
  ctx.plugin(PlatformService, config);
  ctx.plugin(ModelService, config);
  ctx.plugin(YesImBotService, config);
}
