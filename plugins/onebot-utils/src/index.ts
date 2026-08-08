import { jsonSchema, type AgentTool } from "@yesimbot/agent-runtime";
import { Context, h, Logger, Schema, type Bot, type Element } from "koishi";
import { persistElements, type AssetStore, type ChannelPluginContext, type ChannelPluginFactory, type ChannelScope } from "koishi-plugin-yesimbot";

import { projectAnimatedImages } from "./animated-image.js";
import { createForwardReader, type ForwardImageRequest, type ForwardResult, type ForwardToolInput } from "./forward.js";
import type { OneBotCQCode, OneBotForwardSendNode, OneBotInternal, OneBotSenderInfo } from "./onebot.js";

const ONEBOT_INTERNAL_UNAVAILABLE_ERROR = "当前频道适配器不支持 OneBot 协议内部接口";
const ONEBOT_REQUEST_UNAVAILABLE_ERROR = "当前频道适配器不支持 OneBot 请求接口";
const MAX_FORWARD_IMAGES_PER_PERSIST_BATCH = 4;
const TOOLS = {
  GET_FORWARD_MESSAGE: "onebot_get_forward_message",
  SEND_FORWARD_MESSAGE: "onebot_send_forward_message",
  CREATE_REACTION: "onebot_create_reaction",
  SET_ESSENCE: "onebot_set_essence",
  BAN_USER: "onebot_ban_user",
  UNBAN_USER: "onebot_unban_user",
  KICK_USER: "onebot_kick_user",
  OCR_IMAGE: "onebot_ocr_image",
  SET_QQ_PROFILE: "onebot_set_qq_profile",
  SET_QQ_AVATAR: "onebot_set_qq_avatar",
};
const TOOL_SCHEMA = Object.entries(TOOLS).map(([key, value]) => Schema.const(value).description(key));

export interface OnebotUtilsConfig {
  enabledTools: (typeof TOOLS)[keyof typeof TOOLS][];
  parseImages: boolean;
  attachImageSummary: boolean;
  maxForwardPageChars: number;
}

interface OcrImageToolInput {
  image: string;
}

interface OcrImageToolOutput {
  status: "ok" | "failed";
  retcode: number;
  data: unknown | null;
  message: string;
  wording: string;
  echo: unknown | null;
  stream: "normal-action" | "normal-event" | "normal-response";
}

type GroupToolResult = { success: true } | { error: string };
type GroupUserInput = { userId: string };
type BanUserInput = GroupUserInput & { duration: number };
type KickUserInput = GroupUserInput & { rejectAddRequest?: boolean };
type ForwardSendResult = { ok: true; messageId: string } | { ok: false; error: { name: string; message: string } };

export default class OnebotUtilsPlugin {
  public static name = "yesimbot-onebot-utils";
  public static inject = ["yesimbot"];
  public static usage = "OneBot 工具插件，提供获取合并转发消息、表态和设置精华等功能";
  public static Config: Schema<OnebotUtilsConfig> = Schema.object({
    enabledTools: Schema.array(Schema.union(TOOL_SCHEMA)).default([]).role("checkbox").description("启用的工具列表"),
    parseImages: Schema.boolean().default(false).description("解析转发消息中的图片元数据"),
    attachImageSummary: Schema.boolean().default(true).description("动画表情占位符附带图片 summary"),
    maxForwardPageChars: Schema.number().min(1).default(6000).description("合并转发消息每页的最大文本字符数"),
  });

  public readonly ctx: Context;
  public readonly config: OnebotUtilsConfig;
  public readonly logger: Logger;

  private dispose?: () => void;

  constructor(ctx: Context, config: OnebotUtilsConfig) {
    this.ctx = ctx;
    this.config = config;
    this.logger = ctx.logger("yesimbot.onebot-utils");
    ctx.on("ready", this.start.bind(this));
    ctx.on("dispose", this.stop.bind(this));
  }

  public async start(): Promise<void> {
    this.dispose = this.ctx.yesimbot.registerChannelPlugin(createOneBotPluginFactory(this.ctx, this.config));
  }

  public async stop(): Promise<void> {
    this.dispose?.();
  }
}

function getOneBotInternal(bot: Bot): OneBotInternal {
  const internal = (bot as unknown as { internal?: OneBotInternal }).internal;
  if (!internal) throw new Error(ONEBOT_INTERNAL_UNAVAILABLE_ERROR);
  return internal;
}

async function loadForwardSendNodes(internal: OneBotInternal, forwardId: string): Promise<readonly OneBotForwardSendNode[] | undefined> {
  const response = await internal.getForwardMsg(forwardId);
  if (!Array.isArray(response)) return undefined;
  const nodes = response as unknown as readonly {
    readonly sender: OneBotSenderInfo;
    readonly time: number;
    readonly message: readonly OneBotCQCode[];
  }[];
  return Promise.all(
    nodes.map(async (node) => ({
      type: "node" as const,
      data: {
        name: node.sender.card || node.sender.nickname || String(node.sender.user_id),
        uin: String(node.sender.user_id),
        content: await resolveForwardSendContent(internal, node.message),
        time: String(node.time),
      },
    })),
  );
}

async function resolveForwardSendContent(internal: OneBotInternal, segments: readonly OneBotCQCode[]): Promise<readonly OneBotCQCode[]> {
  return Promise.all(
    segments.map(async (segment) => {
      if (segment.type !== "image") return { ...segment, data: { ...segment.data } };
      const data = { ...segment.data };
      const source = data.src ?? data.url ?? data.file;
      if (source) {
        data.file = source;
      } else {
        try {
          const resolved = await internal.getImage(typeof data.file === "string" ? data.file : "");
          if (resolved?.url) data.file = resolved.url;
        } catch {
          // Keep the original file reference when the adapter cannot resolve it.
        }
      }
      delete data.src;
      delete data.url;
      delete data.summary;
      delete data.sub_type;
      delete data.subType;
      delete data.file_size;
      return { ...segment, data };
    }),
  );
}

function directChannelId(channelId: string): string {
  return channelId.startsWith("private:") ? channelId.slice("private:".length) : channelId;
}

async function persistForwardImages(
  ctx: Context,
  internal: OneBotInternal,
  assets: AssetStore,
  images: readonly ForwardImageRequest[],
): Promise<ReadonlyMap<string, string>> {
  const resolved = await Promise.all(
    images.map(async ({ file, url }) => {
      try {
        const imageUrl = url ?? (await internal.getImage(file))?.url;
        return imageUrl ? { file, url: imageUrl } : undefined;
      } catch {
        return undefined;
      }
    }),
  );
  const assetIds = new Map<string, string>();
  for (let offset = 0; offset < resolved.length; offset += MAX_FORWARD_IMAGES_PER_PERSIST_BATCH) {
    const batch = resolved.slice(offset, offset + MAX_FORWARD_IMAGES_PER_PERSIST_BATCH);
    const elements = batch.filter((item): item is { file: string; url: string } => item !== undefined).map(({ url }) => h("img", { src: url }));
    if (elements.length === 0) continue;
    let persisted: Element[];
    try {
      persisted = await persistElements(ctx, elements, assets);
    } catch {
      continue;
    }
    let index = 0;
    for (const item of batch) {
      if (!item) continue;
      const element = persisted[index++];
      const id = element?.attrs.id;
      if (typeof id === "string") assetIds.set(item.file, id);
    }
  }
  return assetIds;
}

function createOneBotTools(ctx: Context, bot: Bot, config: Readonly<OnebotUtilsConfig>, scope: ChannelScope, assets: AssetStore): AgentTool[] {
  let forwardReader: ReturnType<typeof createForwardReader> | undefined;

  const isGroupScope = scope.type === "shared";

  const getForwardMessageTool: AgentTool<ForwardToolInput, ForwardResult> = {
    name: TOOLS.GET_FORWARD_MESSAGE,
    description: "分页获取合并转发消息的紧凑元组。使用 forwardId；若返回 tips，表示还有剩余内容，可按其中的 nextOffset 使用相同 forwardId 继续读取。",
    inputSchema: jsonSchema<ForwardToolInput>({
      type: "object",
      properties: {
        forwardId: {
          type: "string",
          description: "合并转发消息的 ID",
        },
        offset: {
          type: "integer",
          minimum: 0,
          description: "分页偏移，默认 0",
        },
        limit: {
          type: "integer",
          minimum: 1,
          maximum: 60,
          description: "每页条数，默认 30，最大 60",
        },
      },
      required: ["forwardId"],
      additionalProperties: false,
    }),
    execute: async (input) => {
      const internal = getOneBotInternal(bot);
      forwardReader ??= createForwardReader(internal, {
        ...config,
        persistImages: (images) => persistForwardImages(ctx, internal, assets, images),
      });
      return forwardReader(input);
    },
  };

  const sendForwardMessageTool: AgentTool<{ forwardId: string }, ForwardSendResult> = {
    name: TOOLS.SEND_FORWARD_MESSAGE,
    description: "将合并转发消息原样发送到当前频道。传入与 onebot_get_forward_message 相同的 forwardId；不要根据摘要逐条粘贴或重建消息。",
    inputSchema: jsonSchema<{ forwardId: string }>({
      type: "object",
      properties: {
        forwardId: {
          type: "string",
          description: "要原样发送的合并转发消息 ID",
        },
      },
      required: ["forwardId"],
      additionalProperties: false,
    }),
    execute: async ({ forwardId }) => {
      try {
        const internal = getOneBotInternal(bot);
        const nodes = await loadForwardSendNodes(internal, forwardId);
        if (!nodes) {
          return {
            ok: false,
            error: { name: "ForwardNotFound", message: `未找到合并转发消息: ${forwardId}` },
          };
        }
        const target = directChannelId(scope.channelId);
        const messageId = scope.type === "direct" ? await internal.sendPrivateForwardMsg(target, nodes) : await internal.sendGroupForwardMsg(target, nodes);
        return { ok: true, messageId: String(messageId) };
      } catch (cause) {
        return {
          ok: false,
          error: {
            name: cause instanceof Error ? cause.name : "Error",
            message: errorMessage(cause),
          },
        };
      }
    },
  };

  const createReactionTool: AgentTool<{ messageId: string; emojiId: string }, unknown> = {
    name: TOOLS.CREATE_REACTION,
    description: "对消息进行表态",
    inputSchema: jsonSchema<{ messageId: string; emojiId: string }>({
      type: "object",
      properties: {
        messageId: {
          type: "string",
          description: "要表态的消息 ID",
        },
        emojiId: {
          type: "string",
          description: "表情 ID",
        },
      },
      required: ["messageId", "emojiId"],
      additionalProperties: false,
    }),
    execute: async ({ messageId, emojiId }) => {
      const internal = getOneBotInternal(bot);
      if (!internal._request) throw new Error(ONEBOT_REQUEST_UNAVAILABLE_ERROR);
      return internal._request("set_msg_emoji_like", {
        message_id: messageId,
        emoji_id: emojiId,
      });
    },
  };

  const setEssenceTool: AgentTool<{ messageId: string }, { success: true }> = {
    name: TOOLS.SET_ESSENCE,
    description: "将消息设置为精华",
    inputSchema: jsonSchema<{ messageId: string }>({
      type: "object",
      properties: {
        messageId: {
          type: "string",
          description: "要设置为精华的消息 ID",
        },
      },
      required: ["messageId"],
      additionalProperties: false,
    }),
    execute: async ({ messageId }) => {
      await getOneBotInternal(bot).setEssenceMsg(messageId);
      return { success: true };
    },
  };

  const ocrImageTool: AgentTool<OcrImageToolInput, OcrImageToolOutput> = {
    name: TOOLS.OCR_IMAGE,
    description: "对图片进行 OCR 识别",
    inputSchema: jsonSchema<OcrImageToolInput>({
      type: "object",
      properties: {
        image: { type: "string" },
      },
      required: ["image"],
    }),
    outputSchema: jsonSchema<OcrImageToolOutput>({
      type: "object",
      properties: {
        status: { type: "string", enum: ["ok", "failed"] },
        retcode: { type: "number" },
        data: { type: ["object", "null"] },
        message: { type: "string" },
        wording: { type: "string" },
        echo: { type: ["object", "null"] },
        stream: { type: "string", enum: ["normal-action", "normal-event", "normal-response"] },
      },
      required: ["status", "retcode", "data", "message", "wording", "echo", "stream"],
    }),
    execute: async (input) => {
      const internal = getOneBotInternal(bot);
      if (!internal._request) throw new Error(ONEBOT_REQUEST_UNAVAILABLE_ERROR);
      const result = await internal._request("ocr_image", input);
      return result as OcrImageToolOutput;
    },
  };

  const setQqProfileTool: AgentTool<{ nickname?: string; personal_note?: string; sex?: number }, { success: true }> = {
    name: TOOLS.SET_QQ_PROFILE,
    description: "设置 QQ 个人资料",
    inputSchema: jsonSchema<{ nickname?: string; personal_note?: string }>({
      type: "object",
      properties: {
        nickname: { type: "string" },
        personal_note: { type: "string" },
        sex: { type: "number" },
      },
      additionalProperties: false,
    }),
    execute: async (input) => {
      const internal = getOneBotInternal(bot);
      if (!internal._request) throw new Error(ONEBOT_REQUEST_UNAVAILABLE_ERROR);
      await internal._request("set_qq_profile", input);
      return { success: true };
    },
  };

  const setQqAvatarTool: AgentTool<{ file: string }, { success: true }> = {
    name: TOOLS.SET_QQ_AVATAR,
    description: "设置 QQ 头像",
    inputSchema: jsonSchema<{ file: string }>({
      type: "object",
      properties: {
        file: { type: "string" },
      },
      required: ["file"],
      additionalProperties: false,
    }),
    execute: async (input) => {
      const internal = getOneBotInternal(bot);
      if (!internal._request) throw new Error(ONEBOT_REQUEST_UNAVAILABLE_ERROR);
      await internal._request("set_qq_avatar", input);
      return { success: true };
    },
  };

  const banUserTool: AgentTool<BanUserInput, GroupToolResult> = {
    name: TOOLS.BAN_USER,
    description: "禁言当前群内的指定成员，duration 单位秒",
    inputSchema: jsonSchema<BanUserInput>({
      type: "object",
      properties: {
        userId: { type: "string" },
        duration: { type: "number", minimum: 0 },
      },
      required: ["userId", "duration"],
      additionalProperties: false,
    }),
    execute: async ({ userId, duration }) => {
      try {
        await requestOneBot(bot, "set_group_ban", {
          group_id: Number(scope.channelId),
          user_id: toOneBotUserId(userId),
          duration: Math.floor(duration),
        });
        return { success: true };
      } catch (cause) {
        return { error: errorMessage(cause) };
      }
    },
  };

  const unbanUserTool: AgentTool<GroupUserInput, GroupToolResult> = {
    name: TOOLS.UNBAN_USER,
    description: "解除当前群内指定成员的禁言",
    inputSchema: jsonSchema<GroupUserInput>({
      type: "object",
      properties: { userId: { type: "string" } },
      required: ["userId"],
      additionalProperties: false,
    }),
    execute: async ({ userId }) => {
      try {
        await requestOneBot(bot, "set_group_ban", {
          group_id: Number(scope.channelId),
          user_id: toOneBotUserId(userId),
          duration: 0,
        });
        return { success: true };
      } catch (cause) {
        return { error: errorMessage(cause) };
      }
    },
  };

  const kickUserTool: AgentTool<KickUserInput, GroupToolResult> = {
    name: TOOLS.KICK_USER,
    description: "将指定成员移出当前群",
    inputSchema: jsonSchema<KickUserInput>({
      type: "object",
      properties: {
        userId: { type: "string" },
        rejectAddRequest: { type: "boolean" },
      },
      required: ["userId"],
      additionalProperties: false,
    }),
    execute: async ({ userId, rejectAddRequest }) => {
      try {
        await requestOneBot(bot, "set_group_kick", {
          group_id: Number(scope.channelId),
          user_id: toOneBotUserId(userId),
          reject_add_request: rejectAddRequest ?? false,
        });
        return { success: true };
      } catch (cause) {
        return { error: errorMessage(cause) };
      }
    },
  };

  const enabledTools = new Set(config.enabledTools);
  const tools: AgentTool[] = [];
  if (isGroupScope) {
    if (enabledTools.has(TOOLS.SET_ESSENCE)) tools.push(setEssenceTool);
    if (enabledTools.has(TOOLS.BAN_USER)) tools.push(banUserTool);
    if (enabledTools.has(TOOLS.UNBAN_USER)) tools.push(unbanUserTool);
    if (enabledTools.has(TOOLS.KICK_USER)) tools.push(kickUserTool);
  }
  if (enabledTools.has(TOOLS.GET_FORWARD_MESSAGE)) tools.push(getForwardMessageTool);
  if (enabledTools.has(TOOLS.SEND_FORWARD_MESSAGE)) tools.push(sendForwardMessageTool);
  if (enabledTools.has(TOOLS.CREATE_REACTION)) tools.push(createReactionTool);
  if (enabledTools.has(TOOLS.OCR_IMAGE)) tools.push(ocrImageTool);
  if (enabledTools.has(TOOLS.SET_QQ_PROFILE)) tools.push(setQqProfileTool);
  if (enabledTools.has(TOOLS.SET_QQ_AVATAR)) tools.push(setQqAvatarTool);
  return tools;
}

function requestOneBot(bot: Bot, action: string, params: Record<string, unknown>): Promise<unknown> {
  const internal = getOneBotInternal(bot);
  if (!internal._request) throw new Error(ONEBOT_REQUEST_UNAVAILABLE_ERROR);
  return internal._request(action, params);
}

function toOneBotUserId(userId: string): number {
  const id = Number(userId);
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error(`无效的用户 ID: ${userId}`);
  return id;
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function createOneBotPluginFactory(ctx: Context, config: OnebotUtilsConfig): ChannelPluginFactory {
  return async ({ scope, bot }: ChannelPluginContext) => {
    if (scope.platform !== "onebot") return null;
    return {
      name: "onebot-utils",
      tools: createOneBotTools(ctx, bot, config, scope, ctx.yesimbot.assets.createStore(scope)),
      onAppend: (entries) => projectAnimatedImages(entries, { attachImageSummary: config.attachImageSummary }),
      transformEntries: (entries) => projectAnimatedImages(entries, { attachImageSummary: config.attachImageSummary }),
    };
  };
}
