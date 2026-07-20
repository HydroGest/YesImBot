import { Schema } from "koishi";

import { PlatformConfigSchema, type PlatformConfig } from "./platform/config.js";

export type { PlatformConfig } from "./platform/config.js";
export { DEFAULT_PLATFORM } from "./platform/config.js";

export interface Config {
  basePath: string;
  chatModel: string;
  logLevel?: number;
  platform?: PlatformConfig;
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
]) as Schema<Config>;
