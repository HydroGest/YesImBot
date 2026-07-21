import { Schema } from "koishi";

import { PlatformConfigSchema, type PlatformConfig } from "./platform/config.js";

export type { PlatformConfig } from "./platform/config.js";
export { DEFAULT_PLATFORM } from "./platform/config.js";

export type MessageRoutingAction = "append" | "reply";

export interface MessageRoutingConfig {
  direct: MessageRoutingAction;
  mention: MessageRoutingAction;
  group: MessageRoutingAction;
}

export interface Config {
  basePath: string;
  chatModel: string;
  logLevel?: number;
  platform?: PlatformConfig;
  routing?: Partial<MessageRoutingConfig>;
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
    routing: Schema.object({
      direct: Schema.union(["append", "reply"]).default("reply"),
      mention: Schema.union(["append", "reply"]).default("reply"),
      group: Schema.union(["append", "reply"]).default("append"),
    }),
  }).description("消息路由"),
]) as Schema<Config>;
