import { jsonSchema, type AgentTool } from "@yesimbot/agent-runtime";
import { generateText, type LanguageModel } from "ai";
import type { Bot } from "koishi";

import { parseReply } from "../messages/index.js";
import { prepareOutputSegments, ResourceReadError, type ChannelResources } from "../resources/index.js";

const READ_MAX_TEXT_CHARS = 30_000;

type ResourceReadInput = { uri: string };

type ResourceReadResult = { uri: string; filename?: string; mediaType?: string; text?: string; error?: string };

type DescribeImageInput = { uri: string; question: string };

type DescribeImageOutput = { text: string } | { error: string };

type SendMessageInput = { channelId: string; content: string };

type SendMessageOutput = { ok: true; messageIds: string[] } | { ok: false; error: { name: string; message: string } };

export function createSendMessageTool(bot: Bot, currentChannelId: string, resources: ChannelResources): AgentTool<SendMessageInput, SendMessageOutput> {
  return {
    name: "sendMessage",
    description: [
      "向当前频道以外的指定频道发送一条消息。不要使用本工具回复当前频道；直接输出文本即可。",
      "content 使用与直接输出相同的元素语法。",
      "返回 {ok:true,messageIds} 或 {ok:false,error}；必须检查 ok，失败时不会发出消息。",
    ].join("\n"),
    inputSchema: jsonSchema<SendMessageInput>({
      type: "object",
      properties: { channelId: { type: "string", minLength: 1 }, content: { type: "string" } },
      required: ["channelId", "content"],
    }),
    execute: async ({ channelId, content }, execution) => {
      if (channelId === currentChannelId) {
        return { ok: false, error: { name: "InvalidChannel", message: "sendMessage cannot target the current channel" } };
      }
      try {
        const messageIds: string[] = [];
        const segments = await prepareOutputSegments(parseReply(content), resources, execution.abortSignal);
        for (const segment of segments) messageIds.push(...(await bot.sendMessage(channelId, segment)));
        return { ok: true, messageIds };
      } catch (cause) {
        if (cause instanceof ResourceReadError) return { ok: false, error: { name: cause.code, message: cause.message } };
        return { ok: false, error: { name: cause instanceof Error ? cause.name : "Error", message: cause instanceof Error ? cause.message : String(cause) } };
      }
    },
  };
}

export function createReadTool(resources: ChannelResources, imageOutputSupported: boolean): AgentTool<{ uri: string }, ResourceReadResult> {
  const pendingImages = new Map<string, { bytes: Uint8Array; mediaType: string }>();
  const imageEnabled = imageOutputSupported && resources.imageInput;
  const lines = [
    "读取资源内容。仅在确实需要内容时读取精确 URI，不要猜测或拼造 URI。",
    "URI 形如 scheme://authority[/path]，不能包含 ?、#、%，也不能有 . 或 .. 路径段。",
    "- asset://<32位十六进制id>：平台输入的不可变资源，包括图片与文本文件。消息里看到的 [图片：asset://xxx] 和 [文件：名字 asset://xxx] 就是它；路径部分必须为空。",
    "- artifact://<tool>/<uuid>：工具输出的不可变工件，uuid 由工具返回，原样传入。",
  ];
  for (const reader of resources
    .listReaders()
    .slice()
    .sort((a, b) => a.scheme.localeCompare(b.scheme))) {
    lines.push(`- ${reader.scheme}://：${reader.prompt}`);
  }
  lines.push(
    "",
    "返回 {uri, filename?, mediaType?, text?, error?}。",
    "- 文本资源在 text 中直接给出内容，过长会被截断并以 [内容已截断] 结尾。",
    imageEnabled
      ? "- 图片资源：读取后图片字节将随结果返回，你可以直接查看图片内容。查看图片必须使用本工具读取。"
      : "- 图片资源只给出占位描述，不包含图片字节，当前无法查看图片内容。",
  );
  if (!imageEnabled) lines.push("- 需要图片内容时，使用 describe_image 工具获取图片描述。");
  lines.push(
    "- 其他二进制只给出类型与大小，无法查看内容。",
    "- error 存在时不会有 text：invalid_resource_uri 表示 URI 形状不合法，检查后重写而不是原样重试；resource_not_found 表示资源不存在，换来源；resource_unavailable 表示该方案当前未启用；resource_too_large 表示超出读取上限，无法读取；timeout 与 resource_read_aborted 可以重试一次；resource_read_failed 表示读取失败。",
  );
  return {
    name: "read",
    description: lines.join("\n"),
    inputSchema: jsonSchema<ResourceReadInput>({ type: "object", properties: { uri: { type: "string", description: "要读取的资源 URI" } }, required: ["uri"] }),
    execute: async ({ uri }, execution) => {
      let opened: Awaited<ReturnType<ChannelResources["openStrict"]>>;
      try {
        opened = await resources.openStrict(uri, execution.abortSignal);
      } catch (cause) {
        if (cause instanceof ResourceReadError) return { uri, error: cause.code };
        return { uri, error: "resource_read_failed" };
      }
      const mediaType = detectedMediaType(opened.bytes) ?? opened.mediaType;
      if (imageOutputSupported && resources.imageInput && mediaType?.startsWith("image/")) {
        pendingImages.set(execution.toolCallId, { bytes: opened.bytes, mediaType });
      }
      return { uri, filename: opened.filename, mediaType, text: describeBytes(opened.bytes, mediaType) };
    },
    toModelOutput: ({ toolCallId, output }) => {
      const image = pendingImages.get(toolCallId);
      if (!image) return { type: "json", value: output };
      return {
        type: "content",
        value: [
          ...(output.text ? [{ type: "text" as const, text: output.text }] : []),
          { type: "image-data" as const, data: Buffer.from(image.bytes).toString("base64"), mediaType: image.mediaType },
        ],
      };
    },
  };
}

export function createDescribeImageTool(model: LanguageModel, resources: ChannelResources): AgentTool<DescribeImageInput, DescribeImageOutput> {
  return {
    name: "describe_image",
    description:
      "当你需要了解图片内容、但当前无法直接查看图片时，使用本工具调用外部视觉模型生成图片描述。uri 必须是 asset://<32位十六进制id>。返回 {text} 或 {error}：invalid_uri 表示 URI 形状不合法；asset_not_found 表示资源不存在；not_an_image 表示该资源不是已知格式的图片；vision_call_failed 表示外部模型调用失败，可重试一次。",
    inputSchema: jsonSchema<DescribeImageInput>({
      type: "object",
      properties: {
        uri: { type: "string", description: "要描述的图片资源 URI，形如 asset://<32位十六进制id>" },
        question: { type: "string", description: "要从图片中获取的信息" },
      },
      required: ["uri", "question"],
    }),
    execute: async ({ uri, question }, execution) => {
      if (!/^asset:\/\/[a-f0-9]{32}$/.test(uri)) return { error: "invalid_uri" };
      const id = uri.slice("asset://".length);
      let bytes: Uint8Array;
      try {
        bytes = await resources.assets.get(id);
      } catch {
        return { error: "asset_not_found" };
      }
      const mediaType = detectedMediaType(bytes);
      if (!mediaType) return { error: "not_an_image" };
      try {
        const result = await generateText({
          model,
          temperature: 0.2,
          abortSignal: execution.abortSignal,
          messages: [
            {
              role: "user",
              content: [
                { type: "text", text: `请详细描述这张图片，并回答问题：${question}\n\n图片内容：` },
                { type: "file", data: bytes, mediaType },
              ],
            },
          ],
        });
        return { text: result.text };
      } catch (cause) {
        return { error: `vision_call_failed: ${cause instanceof Error ? cause.message : String(cause)}` };
      }
    },
  };
}

function describeBytes(bytes: Uint8Array, mediaType?: string): string {
  const image = detectedMediaType(bytes);
  if (image) return `[图片资源，${image}，${formatBytes(bytes.byteLength)}]`;
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    if (text.length <= READ_MAX_TEXT_CHARS) return text;
    const marker = "\n[内容已截断]";
    return `${text.slice(0, READ_MAX_TEXT_CHARS - marker.length)}${marker}`;
  } catch {
    return `[资源，${mediaType ?? "未知类型"}，${formatBytes(bytes.byteLength)}]`;
  }
}

function detectedMediaType(bytes: Uint8Array): string | undefined {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (
    bytes.length >= 6 &&
    bytes[0] === 0x47 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x38 &&
    (bytes[4] === 0x37 || bytes[4] === 0x39) &&
    bytes[5] === 0x61
  )
    return "image/gif";
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  )
    return "image/webp";
  return undefined;
}

function formatBytes(length: number): string {
  if (length >= 1024 * 1024) return `${(length / (1024 * 1024)).toFixed(1)} MiB`;
  if (length >= 1024) return `${(length / 1024).toFixed(1)} KiB`;
  return `${length} B`;
}
