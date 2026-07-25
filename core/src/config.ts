import { Schema } from "koishi";

import type { ChannelAllowRule } from "./gateway/allowlist.js";
import type { DefaultWillConfig } from "./will/index.js";

export type { DefaultWillConfig } from "./will/index.js";

export interface Config {
  basePath: string;
  chatModel: string;
  logLevel?: number;
  allowedChannels?: ChannelAllowRule[];
  multimedia?: {
    enabled?: boolean;
    image?: {
      selection?: "current-first" | "fifo" | "lifo";
      maxCountPerCall?: number;
      maxBytesPerImage?: number;
      maxBytesPerCall?: number;
    };
  };
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
    allowedChannels: Schema.array(
      Schema.object({
        platform: Schema.string(),
        channelId: Schema.string(),
        isDirect: Schema.boolean(),
      }),
    ).default([]),
  }).description("基础配置"),
  Schema.object({
    multimedia: Schema.object({
      enabled: Schema.boolean().default(true),
      image: Schema.object({
        selection: Schema.union(["current-first", "fifo", "lifo"]).default("current-first"),
        maxCountPerCall: Schema.number().default(4),
        maxBytesPerImage: Schema.number().default(5 * 1024 * 1024),
        maxBytesPerCall: Schema.number().default(10 * 1024 * 1024),
      }),
    }),
  }).description("模型多媒体输入"),
  Schema.object({
    will: Schema.object({
      direct: Schema.union(["wait", "trigger"]).default("trigger"),
      mention: Schema.union(["wait", "trigger"]).default("trigger"),
      group: Schema.union(["wait", "trigger"]).default("wait"),
    }),
  }).description("消息路由"),
]) as Schema<Config>;
