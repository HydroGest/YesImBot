import { Schema } from "koishi";

export interface HistoryConfig {
    ignoreSelfMessage?: boolean;
}

export const HistoryConfig: Schema<HistoryConfig> = Schema.object({
    ignoreSelfMessage: Schema.boolean().default(true).description("是否忽略由智能体自身发送的消息。"),
});
