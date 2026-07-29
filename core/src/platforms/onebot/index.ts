import type { Context } from "koishi";
import type {} from "koishi-plugin-adapter-onebot";

import type { SessionResolver } from "../../gateway.js";
import { resolveOneBotEvent } from "./events.js";
import { resolveOneBotMessage } from "./message.js";

export function createResolver(ctx: Context): SessionResolver {
  return {
    platform: "onebot",
    async resolve(session, store) {
      const event = resolveOneBotEvent(session);
      if (event) return event;
      return resolveOneBotMessage(ctx, session, store);
    },
  };
}

export { resolveOneBotEvent } from "./events.js";
export { resolveOneBotMessage } from "./message.js";
