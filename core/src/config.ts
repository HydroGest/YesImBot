import { Schema } from "koishi";

import type { ChannelAllowRule } from "./gateway/types.js";
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

export interface SessionCompactConfig {
  threshold: number;
  charTokenRatio: number;
  minMessages: number;
  maxFailures: number;
  model: string | undefined;
}

export interface SessionIdleConfig {
  timeout: number;
}

export interface SessionConfig {
  compact: SessionCompactConfig;
  idle: SessionIdleConfig;
}

export interface Config {
  basePath: string;
  chatModel: string;
  visionModel: string | undefined;
  logLevel: number;
  allowedChannels: ChannelAllowRule[];
  imageInput: ImageInputConfig;
  resourceReadTimeoutMs: number;
  will: WillConfig;
  reply: {
    pacing: PacingConfig;
    customInnerThought: boolean;
  };
  session: SessionConfig;
}

export const Config: Schema<Config> = Schema.intersect([
  Schema.object({
    basePath: Schema.path({ filters: ["directory"], allowCreate: true }).default("data/yesimbot"),
    chatModel: Schema.dynamic("registry.chatModels"),
    visionModel: Schema.dynamic("registry.chatModels").description(
      "describe_image 工具使用的识图模型（需在 models.json 中声明支持图片输入），留空则不启用该工具",
    ),
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
    resourceReadTimeoutMs: Schema.number().min(1).default(30_000).description("资源读取超时时间(ms)"),
  }).description("模型图片输入"),
  Schema.object({
    will: Schema.intersect([
      Schema.object({
        engine: Schema.union([
          Schema.const("routing").description("按消息场景固定规则触发"),
          Schema.const("willingness").description("按意愿值动态触发"),
        ])
          .default("routing")
          .description("消息触发引擎：routing 按私聊/提及/群聊规则决定，willingness 使用意愿值动态决策"),
      }).description("触发引擎"),
      Schema.union([
        Schema.object({
          engine: Schema.const("routing"),
          direct: Schema.union(["wait", "trigger"]).default("trigger").description("私聊消息是否触发回复"),
          mention: Schema.union(["wait", "trigger"]).default("trigger").description("消息提及机器人时是否触发回复"),
          group: Schema.union(["wait", "trigger"]).default("wait").description("群聊普通消息是否触发回复"),
        }).description("routing 引擎配置"),
        Schema.object({
          engine: Schema.const("willingness"),
          probabilityThreshold: Schema.number().default(55).description("意愿值达到该阈值后才可能触发回复"),
          decayHalfLifeSeconds: Schema.number().default(600).description("意愿值半衰期(秒)，间隔越久衰减越明显"),
          replyCost: Schema.number().default(35).description("每次成功回复后扣除的意愿值"),
        }).description("willingness 引擎配置"),
      ]),
    ]).description("消息触发策略"),
  }).description("消息路由"),
  Schema.object({
    reply: Schema.object({
      pacing: Schema.object({
        charactersPerSecond: Schema.number().min(1).default(8),
        maxTotalDelayMs: Schema.number().min(1).default(60_000),
      }),
      customInnerThought: Schema.boolean()
        .description("在系统提示中加入 Core 自定义 <inner_thought> 内心独白协议")
        .default(false),
    }),
  }).description("回复分段与节奏"),
  Schema.object({
    session: Schema.object({
      compact: Schema.object({
        threshold: Schema.number().min(0.1).max(1).default(0.9),
        charTokenRatio: Schema.number().min(0.5).max(5).default(1.8),
        minMessages: Schema.number().min(1).default(20),
        maxFailures: Schema.number().min(1).default(3),
        model: Schema.dynamic("registry.chatModels"),
      }),
      idle: Schema.object({
        timeout: Schema.number().min(0).default(7_200_000).description("空闲压缩触发时长(ms)，0 = 禁用"),
      }),
    }),
  }).description("会话管理"),
]) as Schema<Config>;
