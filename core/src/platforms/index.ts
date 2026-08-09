import type { Context } from "koishi";

import type { Messenger } from "../messengers/index.js";
import { OneBotTranslator } from "./onebot.js";

export function registerPlatforms(ctx: Context, messenger: Messenger): () => void {
  return messenger.use(new OneBotTranslator(ctx));
}
