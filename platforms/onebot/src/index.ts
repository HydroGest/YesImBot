import type { Context } from "koishi";
import type {} from "koishi-plugin-adapter-onebot";
import type {} from "koishi-plugin-yesimbot";
import type { Platform } from "koishi-plugin-yesimbot/platform";

import { refineMessageReactionsUpdated } from "./events.js";
import { prepareOneBotMessage } from "./prepare.js";

export const name = "yesimbot-platform-onebot";
export const inject = ["yesimbot"];

export function createOneBotAdapter(ctx: Context): Platform.Adapter {
  return {
    id: "yesimbot.onebot",
    adapter: "onebot",
    refine: ({ session }) => {
      const event = refineMessageReactionsUpdated(session);
      return event ? { kind: "event", event } : { kind: "keep" };
    },
    prepare: (prepareCtx) => prepareOneBotMessage(ctx, prepareCtx),
  };
}

export function apply(ctx: Context): void {
  const dispose = ctx.yesimbot.platform.register(createOneBotAdapter(ctx));
  ctx.on("dispose", dispose);
}

export { refineMessageReactionsUpdated } from "./events.js";
export { prepareOneBotMessage } from "./prepare.js";
