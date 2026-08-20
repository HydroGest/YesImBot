import { Schema } from "koishi";

export const Config: Schema<Config> = Schema.intersect([
  Schema.object({
    basePath: Schema.path({ filters: ["directory"], allowCreate: true })
      .default("data/yesimbot")
      .description("数据存储目录"),
    chatModel: Schema.dynamic("registry.chatModels").description("默认对话模型"),
    visionModel: Schema.dynamic("registry.chatModels").description("识图工具使用的模型，留空则不启用该工具"),
    logLevel: Schema.union([
      Schema.const(0).description("None"),
      Schema.const(1).description("Error"),
      Schema.const(2).description("Info"),
      Schema.const(3).description("Debug"),
    ])
      .default(2)
      .description("日志级别") as Schema<number>,
    allowedChannels: Schema.array(
      Schema.object({
        platform: Schema.string().description("平台名称；* 匹配任意平台"),
        channelId: Schema.string().description("频道 ID；* 匹配任意频道"),
        isDirect: Schema.boolean().description("是否仅匹配私聊；留空则不限制"),
      }),
    )
      .role("table")
      .default([])
      .description("允许接收消息的频道；默认拒绝全部频道"),
  }).description("基础配置"),
  Schema.object({
    imageInput: Schema.boolean().default(true).description("允许支持图片输入的模型通过 read 工具读取图片"),
    resourceReadTimeout: Schema.number().min(1).default(30).description("资源读取超时时间（秒）"),
  }).description("模型输入与资源读取"),
  Schema.object({
    pacing: Schema.object({
      charactersPerSecond: Schema.number().min(1).default(8).description("send_message 相邻消息之间的发送速度（字符/秒）"),
      maxTotalDelayMs: Schema.number().min(1).default(60_000).description("单次 send_message 调用的最大累计延迟（毫秒）"),
    }).description("消息发送节奏"),
    customInnerThought: Schema.boolean().default(true).description("为 send_message 提供 inner_thought 字段，记录不发送的内心独白"),
  }),
  Schema.object({
    session: Schema.object({
      compact: Schema.object({
        responseIdleMinutes: Schema.number().min(0).default(120).description("BOT 响应后的压缩等待时长（分钟）；0 = 禁用"),
        minMessages: Schema.number().min(1).default(20).description("自动压缩所需的最少消息数"),
        maxFailures: Schema.number().min(1).default(3).description("自动压缩连续失败上限"),
        model: Schema.dynamic("registry.chatModels").description("压缩模型；留空则使用默认对话模型"),
      }).description("自动压缩"),
      archive: Schema.object({
        maxKB: Schema.number()
          .min(0)
          .default(5 * 1024)
          .description("单个会话文件归档上限（KB）；0 = 禁用"),
      }).description("自动归档"),
    }).description("会话管理"),
  }),
]) as Schema<Config>;

export interface ChannelAllowRule {
  readonly platform: string;
  readonly channelId: string;
  readonly isDirect?: boolean;
}

export interface PacingConfig {
  charactersPerSecond: number;
  maxTotalDelayMs: number;
}

export interface SessionCompactConfig {
  responseIdleMinutes: number;
  minMessages: number;
  maxFailures: number;
  model: string | undefined;
}

export interface SessionArchiveConfig {
  maxKB: number;
}

export interface SessionConfig {
  compact: SessionCompactConfig;
  archive: SessionArchiveConfig;
}

export interface Config {
  basePath: string;
  chatModel: string;
  visionModel: string | undefined;
  logLevel: number;
  allowedChannels: ChannelAllowRule[];
  imageInput: boolean;
  resourceReadTimeout: number;
  pacing: PacingConfig;
  customInnerThought: boolean;
  session: SessionConfig;
}
