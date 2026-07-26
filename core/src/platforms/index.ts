import { Context } from "koishi";

import { createResolver as createOnebotResolver } from "./onebot/index.js";

export class Platform {
  static inject = ["yesimbot"];
  constructor(public ctx: Context) {
    const resolvers = [createOnebotResolver];
    for (const createResolver of resolvers) {
      const dispose = ctx.yesimbot.registerResolver(createResolver(ctx));
      ctx.on("dispose", dispose);
    }
  }
}
