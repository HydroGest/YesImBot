import { jsonSchema, type AgentTool } from "@yesimbot/agent-runtime";
import { generateText, type LanguageModel } from "ai";
import type { Bot } from "koishi";

import type { ChannelResources } from "../resources/index.js";
import { parseReply } from "../runtimes/output.js";

interface SendMessageInput {
  readonly channelId: string;
  readonly content: string;
}

type SendMessageResult = { ok: true; messageIds: string[] } | { ok: false; error: { name: string; message: string } };
type ResourceReadResult = { uri: string; filename?: string; mediaType?: string; text?: string; error?: string };
type DescribeImageInput = { uri: string; question: string };
type DescribeImageOutput = { description?: string; error?: string };

export function createSendMessageTool(bot: Bot): AgentTool<SendMessageInput, SendMessageResult> {
  return {
    name: "sendMessage",
    description: "向指定频道发送一条消息。回复当前频道请直接输出文本即可。",
    inputSchema: jsonSchema<SendMessageInput>({ type: "object", properties: { channelId: { type: "string", minLength: 1 }, content: { type: "string" } }, required: ["channelId", "content"] }),
    execute: async ({ channelId, content }) => {
      try {
        const messageIds: string[] = [];
        for (const segment of parseReply(content)) messageIds.push(...(await bot.sendMessage(channelId, segment)));
        return { ok: true, messageIds };
      } catch (cause) {
        return { ok: false, error: { name: cause instanceof Error ? cause.name : "Error", message: cause instanceof Error ? cause.message : String(cause) } };
      }
    },
  };
}

export function createReadTool(resources: ChannelResources, imageOutputSupported: boolean): AgentTool<{ uri: string }, ResourceReadResult> {
  const pendingImages = new Map<string, { bytes: Uint8Array; mediaType: string }>();
  return {
    name: "read",
    description: readDescription(resources, imageOutputSupported),
    inputSchema: jsonSchema<{ uri: string }>({ type: "object", properties: { uri: { type: "string", description: "要读取的资源 URI" } }, required: ["uri"] }),
    execute: async ({ uri }, execution) => {
      const opened = await resources.open(uri, execution.abortSignal);
      if (!opened) return { uri, error: "resource_unavailable" };
      const mediaType = detectedMediaType(opened.bytes) ?? opened.mediaType;
      if (imageOutputSupported && resources.imageBudget && mediaType?.startsWith("image/") && withinBudget(opened.bytes, resources)) {
        pendingImages.set(execution.toolCallId, { bytes: opened.bytes, mediaType });
      }
      return { uri, filename: opened.filename, mediaType, text: describeBytes(opened.bytes, mediaType) };
    },
    toModelOutput: ({ toolCallId, output }) => {
      const image = pendingImages.get(toolCallId);
      if (!image) return { type: "json", value: output };
      return { type: "content", value: [...(output.text ? [{ type: "text" as const, text: output.text }] : []), { type: "image-data" as const, data: Buffer.from(image.bytes).toString("base64"), mediaType: image.mediaType }] };
    },
  };
}

export function createDescribeImageTool(model: LanguageModel, resources: ChannelResources): AgentTool<DescribeImageInput, DescribeImageOutput> {
  return {
    name: "describe_image",
    description: "读取图片资源并回答关于图片的问题。",
    inputSchema: jsonSchema<DescribeImageInput>({ type: "object", properties: { uri: { type: "string" }, question: { type: "string" } }, required: ["uri", "question"] }),
    execute: async ({ uri, question }, execution) => {
      const opened = await resources.open(uri, execution.abortSignal);
      const mediaType = opened && detectedMediaType(opened.bytes);
      if (!opened || !mediaType) return { error: "resource_not_found" };
      try {
        const result = await generateText({ model, prompt: [{ role: "user", content: [{ type: "image", image: opened.bytes, mediaType }, { type: "text", text: question }] }], abortSignal: execution.abortSignal });
        return { description: result.text };
      } catch (cause) {
        return { error: cause instanceof Error ? cause.message : String(cause) };
      }
    },
  };
}

function withinBudget(bytes: Uint8Array, resources: ChannelResources): boolean {
  const budget = resources.imageBudget!;
  return budget.maxCount > 0 && bytes.byteLength <= budget.maxBytesPerImage && bytes.byteLength <= budget.maxTotalBytes;
}

function describeBytes(bytes: Uint8Array, mediaType?: string): string {
  const image = detectedMediaType(bytes);
  if (image) return `[图片资源，${image}，${bytes.byteLength} B]`;
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return text.length <= 30_000 ? text : `${text.slice(0, 29_991)}\n[内容已截断]`;
  } catch {
    return `[资源，${mediaType ?? "未知类型"}，${bytes.byteLength} B]`;
  }
}

function detectedMediaType(bytes: Uint8Array): string | undefined {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 6 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return "image/gif";
  if (bytes.length >= 12 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return "image/webp";
}

function readDescription(resources: ChannelResources, imageOutputSupported: boolean): string {
  const schemes = resources.listReaders().slice().sort((a, b) => a.scheme.localeCompare(b.scheme)).map((reader) => `- ${reader.scheme}://：${reader.prompt}`);
  return ["读取资源内容。仅使用消息或工具提供的精确 URI。", "- asset://<32位十六进制id>：平台输入资源。", "- artifact://<tool>/<uuid>：工具输出工件。", ...schemes, imageOutputSupported && resources.imageBudget ? "图片会随读取结果返回。" : "图片只返回占位描述。"].join("\n");
}
