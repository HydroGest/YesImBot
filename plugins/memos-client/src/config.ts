import { Schema } from "koishi";

import type { MemosClientConfig } from "./types.js";

export const DEFAULT_MEMOS_BASE_URL = "https://memos.memtensor.cn/api/openmem/v1";

export const memosConfigSchema: Schema<MemosClientConfig> = Schema.object({
  baseUrl: Schema.string().default(DEFAULT_MEMOS_BASE_URL).description("MemOS Cloud API base URL"),
  apiKey: Schema.string().role("secret").required().description("MemOS Cloud API key"),
  memoryScope: Schema.union([
    Schema.const("auto").description("Group chats use channel memory, private chats use user memory"),
    Schema.const("channel").description("Always use channel-scoped MemOS user_id"),
    Schema.const("user").description("Always use user-scoped MemOS user_id"),
  ])
    .default("auto")
    .description("MemOS memory identity scope"),
  timeoutMs: Schema.number().default(10000).description("MemOS HTTP timeout in milliseconds"),
  searchMemoryLimit: Schema.number().default(6).description("Maximum fact memories returned"),
  searchPreferenceLimit: Schema.number().default(6).description("Maximum preference memories returned"),
  searchRelativity: Schema.number().default(0.45).description("MemOS relevance threshold"),
  includePreference: Schema.boolean().default(true).description("Include preference memories"),
  searchFilterMode: Schema.union([
    Schema.const("off").description("Do not add MemOS filter"),
    Schema.const("context").description("Filter by runtime context fields"),
    Schema.const("strict").description("Filter by context, agent, configured tags, and import source"),
  ])
    .default("context")
    .description("MemOS runtime-owned search filter mode"),
  searchTags: Schema.array(Schema.string())
    .default(["yesimbot"])
    .description("MemOS search tags enforced by runtime code"),
  searchImportSources: Schema.array(Schema.string())
    .default([])
    .description("Allowed MemOS import sources enforced by runtime code"),
  asyncMode: Schema.boolean().default(true).description("Use async MemOS writes"),
  tags: Schema.array(Schema.string()).default(["yesimbot"]).description("Default MemOS tags"),
  includeRawIdentityInfo: Schema.boolean().default(false).description("Include raw platform ids in MemOS info"),
});
