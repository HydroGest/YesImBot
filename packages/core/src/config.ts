import { Schema } from "koishi";

import { AgentBehaviorConfig } from "@/agent";
import { AssetServiceConfig } from "@/services/assets";
import { HistoryConfig } from "@/services/horizon";
import { MemoryConfig } from "@/services/memory";
import { ModelServiceConfig } from "@/services/model";
import { ToolServiceConfig } from "@/services/plugin";
import { PromptServiceConfig } from "@/services/prompt";

export const CONFIG_VERSION = "2.0.2";

export type Config = ModelServiceConfig
    & AgentBehaviorConfig
    & MemoryConfig
    & HistoryConfig
    & ToolServiceConfig
    & AssetServiceConfig
    & PromptServiceConfig;

export const Config: Schema<Config> = Schema.intersect([
    ModelServiceConfig.description("模型服务"),
    AgentBehaviorConfig,

    MemoryConfig.description("记忆能力配置"),
    HistoryConfig.description("历史记录管理"),
    ToolServiceConfig.description("工具能力配置"),

    AssetServiceConfig.description("资源服务配置"),
    PromptServiceConfig,
]);
