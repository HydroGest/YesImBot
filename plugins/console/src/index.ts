import { resolve } from "node:path";

import {} from "@koishijs/plugin-console";
import { Context, Schema } from "koishi";

import { PanelProvider } from "./panel.js";

const PACKAGE_NAME = "koishi-plugin-yesimbot-console";

export interface Config {
  title: string;
  description: string;
}

export const Config: Schema<Config> = Schema.object({
  title: Schema.string().default("YesImBot").description("首页标题。"),
  description: Schema.string().default("让 AI 更像人类，让聊天更有温度").description("首页副标题。"),
});

export const name = "yesimbot-console";

export function apply(ctx: Context, config: Config): void {
  ctx.inject(["console", "yesimbot", "loader"], (ctx) => {
    ctx.plugin(PanelProvider);
    ctx.console.addEntry({ dev: resolve(__dirname, "../client/index.ts"), prod: resolve(ctx.baseDir, "node_modules", PACKAGE_NAME, "dist") });
  });
}
