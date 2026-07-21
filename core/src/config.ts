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

export const DEFAULT_MESSAGE_ROUTING: MessageRoutingConfig = {
  direct: "reply",
  mention: "reply",
  group: "append",
};

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
    logLevel: Schema.union([0, 1, 2, 3]).default(2) as Schema<number>,
  }).description("基础配置"),
  Schema.object({
    platform: PlatformConfigSchema,
  }).description("平台适配"),
  Schema.object({
    routing: Schema.object({
      direct: Schema.union(["append", "reply"]).default(DEFAULT_MESSAGE_ROUTING.direct),
      mention: Schema.union(["append", "reply"]).default(DEFAULT_MESSAGE_ROUTING.mention),
      group: Schema.union(["append", "reply"]).default(DEFAULT_MESSAGE_ROUTING.group),
    }),
  }).description("消息路由"),
]) as Schema<Config>;
