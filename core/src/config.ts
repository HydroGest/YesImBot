import { Schema } from "koishi";

import type { ChannelAllowRule } from "./gateway/allowlist.js";
import type { UnifiedImagePolicy } from "./media/index.js";

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

export const DEFAULT_MULTIMEDIA_IMAGE_POLICY: UnifiedImagePolicy = Object.freeze({
  enabled: true,
  maxCount: 4,
  maxBytesPerImage: 5 * 1024 * 1024,
  maxTotalBytes: 10 * 1024 * 1024,
  selection: "current-first",
});

export interface PacingConfig {
  charactersPerSecond: number;
  maxTotalDelayMs: number;
}

export const DEFAULT_REPLY_PACING_CONFIG: PacingConfig = Object.freeze({
  charactersPerSecond: 8,
  maxTotalDelayMs: 60_000,
});

export function resolveReplyPacingConfig(pacing?: Partial<PacingConfig>): PacingConfig {
  return Object.freeze({ ...DEFAULT_REPLY_PACING_CONFIG, ...pacing });
}

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
    )
      .role("table")
      .default([]),
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
