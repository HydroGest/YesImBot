import { Schema } from "koishi";

import type { ChannelAllowRule } from "./gateway.js";

export type WillConfig =
  | {
      readonly engine?: "routing";
      readonly direct?: "wait" | "trigger";
      readonly mention?: "wait" | "trigger";
      readonly group?: "wait" | "trigger";
    }
  | {
      readonly engine: "willingness";
      readonly probabilityThreshold?: number;
      readonly decayHalfLifeSeconds?: number;
      readonly replyCost?: number;
    };

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

export const DEFAULT_IMAGE_BUDGET: ImageBudget = {
  maxCount: 4,
  maxBytesPerImage: 5 * 1024 * 1024,
  maxTotalBytes: 10 * 1024 * 1024,
};

export interface PacingConfig {
  charactersPerSecond: number;
  maxTotalDelayMs: number;
}

export const DEFAULT_REPLY_PACING_CONFIG: PacingConfig = {
  charactersPerSecond: 8,
  maxTotalDelayMs: 60_000,
};

export function resolveReplyPacingConfig(pacing?: Partial<PacingConfig>): PacingConfig {
  return { ...DEFAULT_REPLY_PACING_CONFIG, ...pacing };
}

export interface Config {
  basePath: string;
  chatModel: string;
  logLevel?: number;
  allowedChannels?: ChannelAllowRule[];
  imageInput?: ImageInputConfig;
  will?: WillConfig;
  reply?: {
    pacing?: Partial<PacingConfig>;
  };
}

export function resolveImageBudget(
  imageInput: ImageInputConfig | undefined,
  modelSupportsImages: boolean,
): ImageBudget | null {
  if (imageInput === false || !modelSupportsImages) return null;
  return {
    maxCount: imageInput?.maxCount ?? DEFAULT_IMAGE_BUDGET.maxCount,
    maxBytesPerImage: imageInput?.maxBytesPerImage ?? DEFAULT_IMAGE_BUDGET.maxBytesPerImage,
    maxTotalBytes: imageInput?.maxTotalBytes ?? DEFAULT_IMAGE_BUDGET.maxTotalBytes,
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
      Schema.const(false),
      Schema.object({
        maxCount: Schema.number(),
        maxBytesPerImage: Schema.number(),
        maxTotalBytes: Schema.number(),
      }),
    ]),
  }).description("模型图片输入"),
  Schema.object({
    will: Schema.union([
      Schema.object({
        engine: Schema.const("routing").default("routing"),
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
    ]).default({
      engine: "routing",
      direct: "trigger",
      mention: "trigger",
      group: "wait",
    }) as Schema<WillConfig>,
  }).description("消息路由"),
  Schema.object({
    reply: Schema.object({
      pacing: Schema.object({
        charactersPerSecond: Schema.number()
          .min(1)
          .default(DEFAULT_REPLY_PACING_CONFIG.charactersPerSecond),
        maxTotalDelayMs: Schema.number()
          .min(1)
          .default(DEFAULT_REPLY_PACING_CONFIG.maxTotalDelayMs),
      }),
    }),
  }).description("回复分段与节奏"),
]) as Schema<Config>;
