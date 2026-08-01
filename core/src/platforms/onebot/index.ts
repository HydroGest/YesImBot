import type { Context } from "koishi";
import type {} from "koishi-plugin-adapter-onebot";

import type { PlatformTranslator } from "../../gateway.js";
import { translateOneBotEvent } from "./events.js";
import { translateOneBotMessage } from "./message.js";

export function createTranslator(ctx: Context): PlatformTranslator {
  return {
    platform: "onebot",
    async translate(base, session, store) {
      const event = translateOneBotEvent(base, session);
      if (event) return event;
      return translateOneBotMessage(ctx, base, session, store);
    },
  };
}

export { translateOneBotEvent } from "./events.js";
export { translateOneBotMessage } from "./message.js";
