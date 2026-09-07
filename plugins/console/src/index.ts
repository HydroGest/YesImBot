import path from "node:path";

import {} from "@koishijs/plugin-console";
import { Context } from "koishi";

import { ConversationsProvider } from "./conversations.js";
import { PanelProvider } from "./panel.js";

export const name = "yesimbot-console";

const PACKAGE_NAME = "koishi-plugin-yesimbot-console";

export function apply(ctx: Context): void {
  ctx.inject(["console", "yesimbot", "loader"], (ctx) => {
    ctx.plugin(PanelProvider);
    ctx.plugin(ConversationsProvider);
    ctx.console.addEntry({ dev: path.resolve(__dirname, "../client/index.ts"), prod: path.resolve(ctx.baseDir, "node_modules", PACKAGE_NAME, "dist") });
  });
}
