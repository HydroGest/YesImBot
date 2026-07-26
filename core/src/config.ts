import { Schema } from "koishi";

import type { ChannelAllowRule } from "./gateway/allowlist.js";
import type { UnifiedImagePolicy } from "./media/index.js";
import type { WillConfig } from "./will/index.js";

export type { DefaultWillConfig, WillConfig } from "./will/index.js";

export const DEFAULT_MULTIMEDIA_IMAGE_POLICY: UnifiedImagePolicy = Object.freeze({
  enabled: true,
  maxCount: 4,
  maxBytesPerImage: 5 * 1024 * 1024,
  maxTotalBytes: 10 * 1024 * 1024,
  selection: "current-first",
});

export interface ReplySegmentationConfig {
  maxSegments: number;
}

export interface PacingConfig {
  minDelayMs: number;
  maxSegmentDelayMs: number;
  maxTotalDelayMs: number;
  cjkCharactersPerSecond: number;
  latinCharactersPerSecond: number;
  randomFactorMin: number;
  randomFactorMax: number;
  firstSegmentResidualMinMs: number;
  firstSegmentResidualMaxMs: number;
}

export const DEFAULT_REPLY_SEGMENTATION_CONFIG: ReplySegmentationConfig = Object.freeze({
  maxSegments: 8,
});

export const DEFAULT_REPLY_PACING_CONFIG: PacingConfig = Object.freeze({
  minDelayMs: 250,
  maxSegmentDelayMs: 10_000,
  maxTotalDelayMs: 60_000,
  cjkCharactersPerSecond: 5,
  latinCharactersPerSecond: 8,
  randomFactorMin: 0.85,
  randomFactorMax: 1.15,
  firstSegmentResidualMinMs: 150,
  firstSegmentResidualMaxMs: 450,
});

export interface Config {
  basePath: string;
  chatModel: string;
  logLevel?: number;
  allowedChannels?: ChannelAllowRule[];
  multimedia?: {
    enabled?: boolean;
    image?: {
      selection?: "current-first" | "fifo" | "lifo";
      maxCount?: number;
      maxBytesPerImage?: number;
      maxTotalBytes?: number;
    };
  };
  will?: WillConfig;
  reply?: {
    segmentation?: Partial<ReplySegmentationConfig>;
    pacing?: Partial<PacingConfig>;
  };
}

export function resolveMultimediaImagePolicy(multimedia: Config["multimedia"]): UnifiedImagePolicy {
  const image = multimedia?.image;
  return Object.freeze({
    enabled: multimedia?.enabled ?? DEFAULT_MULTIMEDIA_IMAGE_POLICY.enabled,
    maxCount: image?.maxCount ?? DEFAULT_MULTIMEDIA_IMAGE_POLICY.maxCount,
    maxBytesPerImage: image?.maxBytesPerImage ?? DEFAULT_MULTIMEDIA_IMAGE_POLICY.maxBytesPerImage,
    maxTotalBytes: image?.maxTotalBytes ?? DEFAULT_MULTIMEDIA_IMAGE_POLICY.maxTotalBytes,
    selection: image?.selection ?? DEFAULT_MULTIMEDIA_IMAGE_POLICY.selection,
  });
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
      enabled: Schema.boolean().default(DEFAULT_MULTIMEDIA_IMAGE_POLICY.enabled),
      image: Schema.object({
        selection: Schema.union(["current-first", "fifo", "lifo"]).default(
          DEFAULT_MULTIMEDIA_IMAGE_POLICY.selection,
        ),
        maxCount: Schema.number().default(DEFAULT_MULTIMEDIA_IMAGE_POLICY.maxCount),
        maxBytesPerImage: Schema.number().default(DEFAULT_MULTIMEDIA_IMAGE_POLICY.maxBytesPerImage),
        maxTotalBytes: Schema.number().default(DEFAULT_MULTIMEDIA_IMAGE_POLICY.maxTotalBytes),
      }),
    }),
  }).description("模型多媒体输入"),
  Schema.object({
    will: Schema.object({
      engine: Schema.union(["routing", "willingness"]).default("routing"),
      direct: Schema.union(["wait", "trigger"]).default("trigger"),
      mention: Schema.union(["wait", "trigger"]).default("trigger"),
      group: Schema.union(["wait", "trigger"]).default("wait"),
      base: Schema.object({
        text: Schema.number().default(12),
      }),
      attribute: Schema.object({
        atMention: Schema.number().default(100),
        isDirectMessage: Schema.number().default(40),
      }),
      interest: Schema.object({
        keywords: Schema.array(Schema.string()).default([]),
        keywordMultiplier: Schema.number().default(1.2),
        defaultMultiplier: Schema.number().default(1),
      }),
      lifecycle: Schema.object({
        maxWillingness: Schema.number().default(100),
        decayHalfLifeSeconds: Schema.number().default(600),
        probabilityThreshold: Schema.number().default(55),
        probabilityAmplifier: Schema.number().default(0.04),
        replyCost: Schema.number().default(35),
      }),
    }) as Schema<WillConfig>,
  }).description("消息路由"),
  Schema.object({
    reply: Schema.object({
      segmentation: Schema.object({
        maxSegments: Schema.number().min(1).step(1).default(DEFAULT_REPLY_SEGMENTATION_CONFIG.maxSegments),
      }),
      pacing: Schema.object({
        minDelayMs: Schema.number().min(0).default(DEFAULT_REPLY_PACING_CONFIG.minDelayMs),
        maxSegmentDelayMs: Schema.number().min(1).default(DEFAULT_REPLY_PACING_CONFIG.maxSegmentDelayMs),
        maxTotalDelayMs: Schema.number().min(1).default(DEFAULT_REPLY_PACING_CONFIG.maxTotalDelayMs),
        cjkCharactersPerSecond: Schema.number().min(1).default(DEFAULT_REPLY_PACING_CONFIG.cjkCharactersPerSecond),
        latinCharactersPerSecond: Schema.number().min(1).default(DEFAULT_REPLY_PACING_CONFIG.latinCharactersPerSecond),
        randomFactorMin: Schema.number().min(0).default(DEFAULT_REPLY_PACING_CONFIG.randomFactorMin),
        randomFactorMax: Schema.number().min(0).default(DEFAULT_REPLY_PACING_CONFIG.randomFactorMax),
        firstSegmentResidualMinMs: Schema.number().min(0).default(DEFAULT_REPLY_PACING_CONFIG.firstSegmentResidualMinMs),
        firstSegmentResidualMaxMs: Schema.number().min(0).default(DEFAULT_REPLY_PACING_CONFIG.firstSegmentResidualMaxMs),
      }),
    }),
  }).description("回复分段与节奏"),
]) as Schema<Config>;
