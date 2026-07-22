import { Schema } from "koishi";

import type { DefaultWillConfig } from "./will/index.js";

export type { DefaultWillConfig } from "./will/index.js";

export interface Config {
  basePath: string;
  chatModel: string;
  logLevel?: number;
  will?: Partial<DefaultWillConfig>;
}

export const Config: Schema<Config> = Schema.intersect([
  Schema.object({
    basePath: Schema.path({ filters: ["directory"], allowCreate: true }).default("data/yesimbot"),
    chatModel: Schema.dynamic("registry.chatModels"),
    logLevel: Schema.union([
      Schema.const(0).description("None"),
      Schema.const(1).description("Error"),
      Schema.const(2).description("Info"),
      Schema.const(3).description("Debug"),
    ]).default(2) as Schema<number>,
  }).description("基础配置"),
  Schema.object({
    will: Schema.object({
      direct: Schema.union(["wait", "trigger"]),
      mention: Schema.union(["wait", "trigger"]),
      group: Schema.union(["wait", "trigger"]),
    }),
  }).description("消息路由"),
]) as Schema<Config>;
