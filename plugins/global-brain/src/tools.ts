import { jsonSchema, type AgentTool } from "@yesimbot/agent-runtime";
import type { ArtifactStore, AssetStore, ChannelScope } from "koishi-plugin-yesimbot";

import type { GlobalBrainStore } from "./store.js";
import { BrainStoreError } from "./store.js";
import type { BrainContent, BrainReplySource, BrainThread, BrainThreadStatus, BrainThreadView } from "./types.js";

export interface BrainToolOptions {
  readonly store: GlobalBrainStore;
  readonly scope: ChannelScope;
  readonly assets: AssetStore;
  readonly artifacts: ArtifactStore;
  readonly defaultShareImmediately?: boolean;
  readonly onImmediateShare?: (thread: BrainThread) => Promise<void> | void;
}

interface BrainDepositToolInput {
  readonly kind: "share" | "question" | "insight";
  readonly shareImmediately?: boolean;
  readonly content?: string;
  readonly tags?: string[];
  readonly assetId?: string;
  readonly artifactUri?: string;
  readonly forward?: {
    readonly platform: string;
    readonly forwardId: string;
    readonly summary?: string;
  };
}

export function createBrainTools(options: BrainToolOptions): AgentTool[] {
  return [
    createBrainDepositTool(options),
    createBrainReadTool(options),
    createBrainReplyTool(options),
    createBrainResolveTool(options),
    createBrainStatusTool(options),
  ];
}

function createBrainDepositTool(options: BrainToolOptions): AgentTool {
  const { store, scope } = options;
  return {
    name: "brain_deposit",
    description:
      "向持久化全局脑写入一条内容。支持文本、图片（assetId）、工具产物（artifactUri）和合并转发引用（forward）。asset/artifact 会在读取时物化到目标 session；不要写入完整聊天记录或敏感数据。",
    inputSchema: jsonSchema<BrainDepositToolInput>({
      type: "object",
      properties: {
        shareImmediately: {
          type: "boolean",
          description: "为 true 时立即向其他已知 session 唤起一次请求；默认关闭，除非插件配置开启。",
        },
        kind: {
          type: "string",
          enum: ["share", "question", "insight"],
          description: "内容类型：分享、求助问题、形成的新认知",
        },
        content: {
          type: "string",
          minLength: 1,
          maxLength: 20000,
          description: "全局脑摘要或文本内容；提供 asset/artifact/forward 时可用作摘要",
        },
        tags: {
          type: "array",
          items: { type: "string", minLength: 1, maxLength: 64 },
          maxItems: 20,
          description: "帮助其他 session 判断是否相关的标签",
        },
        assetId: {
          type: "string",
          minLength: 32,
          maxLength: 32,
          description: "当前 scope 中已存在的 asset id，通常从消息里的 asset://xxx 取得",
        },
        artifactUri: {
          type: "string",
          minLength: 1,
          description: "当前 scope 中可读取的 artifact:// URI",
        },
        forward: {
          type: "object",
          properties: {
            platform: { type: "string", minLength: 1 },
            forwardId: { type: "string", minLength: 1 },
            summary: { type: "string" },
          },
          required: ["platform", "forwardId"],
          additionalProperties: false,
        },
      },
      required: ["kind"],
      additionalProperties: false,
    }),
    async execute(input) {
      try {
        const resolved = await resolveDepositInput(input, options);
        const thread = await store.deposit({
          kind: input.kind,
          sourceScope: scope,
          content: resolved.content,
          payload: resolved.payload,
          tags: input.tags,
        });
        if (input.shareImmediately ?? options.defaultShareImmediately ?? false) {
          await options.onImmediateShare?.(thread);
        }
        return { outcome: "created", thread };
      } catch (cause) {
        return fail(cause);
      }
    },
  };
}

function createBrainReadTool(options: BrainToolOptions): AgentTool {
  const { store, scope, assets } = options;
  return {
    name: "brain_read",
    description:
      "读取全局脑 thread 的完整内容、回复和可发送资源；asset/artifact 会物化到当前 session 并返回 localAssetUri。读取后该 thread 对当前 session 不再重复出现在摘要中。",
    inputSchema: jsonSchema<{ threadId: string }>({
      type: "object",
      properties: {
        threadId: { type: "string", minLength: 1, description: "全局脑 thread id" },
      },
      required: ["threadId"],
      additionalProperties: false,
    }),
    async execute(input) {
      try {
        const view = await store.read(input.threadId, scope);
        if (!view) return { outcome: "failed", error: { code: "thread_not_found", message: "Thread does not exist" } };
        const localized = await materializeView(view, store, assets);
        return { outcome: "ok", ...localized };
      } catch (cause) {
        return fail(cause);
      }
    },
  };
}

function createBrainReplyTool(options: BrainToolOptions): AgentTool {
  const { store, scope } = options;
  return {
    name: "brain_reply",
    description:
      "回复全局脑中的一条 thread。replySource 为 agent 时表示这是本 session agent 自己的回答；为 human 时表示这是当前 session 中群友提供的信息，应尽量提供 author。",
    inputSchema: jsonSchema<{
      threadId: string;
      content: string;
      replySource?: BrainReplySource;
      author?: { id: string; name?: string };
    }>({
      type: "object",
      properties: {
        threadId: { type: "string", minLength: 1, description: "要回复的全局脑 thread id" },
        content: { type: "string", minLength: 1, maxLength: 20000, description: "回复内容" },
        replySource: {
          type: "string",
          enum: ["agent", "human"],
          description: "回复来源，默认 agent",
        },
        author: {
          type: "object",
          properties: {
            id: { type: "string", minLength: 1 },
            name: { type: "string" },
          },
          required: ["id"],
          additionalProperties: false,
        },
      },
      required: ["threadId", "content"],
      additionalProperties: false,
    }),
    async execute(input) {
      try {
        const reply = await store.reply({
          threadId: input.threadId,
          sourceScope: scope,
          content: input.content,
          replySource: input.replySource,
          author: input.author,
        });
        return { outcome: "created", reply };
      } catch (cause) {
        return fail(cause);
      }
    },
  };
}

function createBrainResolveTool(options: BrainToolOptions): AgentTool {
  const { store, scope } = options;
  return {
    name: "brain_resolve",
    description: "由发起 thread 的 session 将问题标记为已解决；其他 session 不能调用。",
    inputSchema: jsonSchema<{ threadId: string }>({
      type: "object",
      properties: {
        threadId: { type: "string", minLength: 1, description: "要解决的全局脑 thread id" },
      },
      required: ["threadId"],
      additionalProperties: false,
    }),
    async execute(input) {
      try {
        await store.resolve(input.threadId, scope);
        return { outcome: "resolved" };
      } catch (cause) {
        return fail(cause);
      }
    },
  };
}

function createBrainStatusTool(options: BrainToolOptions): AgentTool {
  const { store, scope } = options;
  return {
    name: "brain_status",
    description: "查看当前 session 发布到全局脑的 thread、状态和回复数。",
    inputSchema: jsonSchema<Record<string, never>>({
      type: "object",
      properties: {},
      additionalProperties: false,
    }),
    async execute() {
      try {
        const threads: BrainThreadStatus[] = await store.status(scope);
        return { outcome: "ok", threads };
      } catch (cause) {
        return fail(cause);
      }
    },
  };
}

async function resolveDepositInput(
  input: BrainDepositToolInput,
  options: BrainToolOptions,
): Promise<{ content: string; payload: BrainContent }> {
  if (input.assetId) {
    const bytes = await options.assets.get(input.assetId);
    const blobId = await options.store.putBlob(bytes);
    return {
      content: input.content ?? "[图片]",
      payload: { kind: "asset", blobId, mediaType: detectMediaType(bytes) },
    };
  }
  if (input.artifactUri) {
    const opened = await options.artifacts.open(input.artifactUri);
    const blobId = await options.store.putBlob(opened.bytes);
    return {
      content: input.content ?? "[工具产物]",
      payload: {
        kind: "artifact",
        blobId,
        ...(opened.mediaType === undefined ? {} : { mediaType: opened.mediaType }),
        ...(opened.filename === undefined ? {} : { filename: opened.filename }),
      },
    };
  }
  if (input.forward) {
    return {
      content: input.content ?? input.forward.summary ?? "[合并转发]",
      payload: {
        kind: "forward",
        platform: input.forward.platform,
        forwardId: input.forward.forwardId,
        ...(input.forward.summary === undefined ? {} : { summary: input.forward.summary }),
      },
    };
  }
  if (!input.content) throw new BrainStoreError("invalid_content", "Content must be a non-empty string");
  return { content: input.content, payload: { kind: "text", text: input.content } };
}

async function materializeView(
  view: BrainThreadView,
  store: GlobalBrainStore,
  assets: AssetStore,
): Promise<BrainThreadView> {
  const payload = view.thread.payload;
  if (payload?.kind !== "asset" && payload?.kind !== "artifact") return view;
  try {
    const bytes = await store.getBlob(payload.blobId);
    const id = await assets.put(bytes);
    return { ...view, localAssetUri: `asset://${id}` };
  } catch {
    return view;
  }
}

function fail(cause: unknown): { outcome: "failed"; error: { code: string; message: string } } {
  if (cause instanceof BrainStoreError) {
    return { outcome: "failed", error: { code: cause.code, message: cause.message } };
  }
  return {
    outcome: "failed",
    error: {
      code: "brain_failed",
      message: cause instanceof Error ? cause.message : String(cause),
    },
  };
}

function detectMediaType(bytes: Uint8Array): string | undefined {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return "image/png";
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 6 &&
    bytes[0] === 0x47 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x38 &&
    (bytes[4] === 0x37 || bytes[4] === 0x39) &&
    bytes[5] === 0x61
  ) {
    return "image/gif";
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "image/webp";
  }
  return undefined;
}
