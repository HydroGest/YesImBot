import { Context } from "koishi";

import type { Config } from "./config.js";
import { ModelService } from "./model/service.js";
import { YesImBotService } from "./service.js";

export const name = "yesimbot";
export const usage = ``;
export const inject = [];

export * from "./channel.js";
export { YesImBotService } from "./service.js";

export function apply(ctx: Context, config: Config) {
  ctx.plugin(ModelService, config);
  ctx.plugin(YesImBotService, config);
}
