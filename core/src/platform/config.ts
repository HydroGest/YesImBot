import { Schema } from "koishi";

export interface PlatformConfig {
  profiles: Record<string, string>;
}

export const DEFAULT_PLATFORM: PlatformConfig = {
  profiles: {},
};

export const PlatformConfigSchema: Schema<PlatformConfig> = Schema.object({
  profiles: Schema.dict(Schema.string()).default({}),
}).default(DEFAULT_PLATFORM);
