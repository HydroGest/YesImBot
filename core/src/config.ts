import { Schema } from "koishi";

export interface Config {
  basePath: string;
  chatModel: string;
  logLevel?: number;
}

export const Config: Schema<Config> = Schema.object({
  basePath: Schema.path({ filters: ["directory"], allowCreate: true }).default("data/yesimbot"),
  chatModel: Schema.dynamic("registry.chatModels"),
  logLevel: Schema.union([0, 1, 2, 3]).default(2) as Schema<number>,
});
