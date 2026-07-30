import { Schema } from "koishi";

import type { ChannelAllowRule } from "./gateway.js";
import { WillConfig } from "./runtime/will.js";

export interface ImageBudget {
  readonly maxCount: number;
  readonly maxBytesPerImage: number;
  readonly maxTotalBytes: number;
}

export type ImageInputConfig =
  | false
  | {
      readonly maxCount?: number;
      readonly maxBytesPerImage?: number;
      readonly maxTotalBytes?: number;
    };

export interface PacingConfig {
  charactersPerSecond: number;
  maxTotalDelayMs: number;
}

export interface Config {
  basePath: string;
  chatModel: string;
  logLevel: number;
  allowedChannels: ChannelAllowRule[];
  imageInput: ImageInputConfig;
  will: WillConfig;
  reply: {
    pacing: PacingConfig;
  };
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
    )
      .role("table")
      .default([]),
  }).description("基础配置"),
  Schema.object({
    imageInput: Schema.union([
      Schema.const(false).description("禁用"),
      Schema.object({
        maxCount: Schema.number().default(3),
        maxBytesPerImage: Schema.number().default(5 * 1024 * 1024),
        maxTotalBytes: Schema.number().default(10 * 1024 * 1024),
      }).description("启用"),
    ]),
  }).description("模型图片输入"),
  Schema.object({
    will: Schema.intersect([
      Schema.object({
        engine: Schema.union([Schema.const("routing"), Schema.const("willingness")]).default(
          "routing",
        ),
      }),
      Schema.union([
        Schema.object({
          engine: Schema.const("routing"),
          direct: Schema.union(["wait", "trigger"]).default("trigger"),
          mention: Schema.union(["wait", "trigger"]).default("trigger"),
          group: Schema.union(["wait", "trigger"]).default("wait"),
        }),
        Schema.object({
          engine: Schema.const("willingness"),
          probabilityThreshold: Schema.number().default(55),
          decayHalfLifeSeconds: Schema.number().default(600),
          replyCost: Schema.number().default(35),
        }),
      ]),
    ]),
  }).description("消息路由"),
  Schema.object({
    reply: Schema.object({
      pacing: Schema.object({
        charactersPerSecond: Schema.number().min(1).default(8),
        maxTotalDelayMs: Schema.number().min(1).default(60_000),
      }),
    }),
  }).description("回复分段与节奏"),
]) as Schema<Config>;
