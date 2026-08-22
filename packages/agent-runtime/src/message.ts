import type { AssistantModelMessage, SystemModelMessage, ToolModelMessage, UserModelMessage } from "@ai-sdk/provider-utils";
import type { AssistantContent, ImagePart, LanguageModelUsage, ModelMessage, ToolContent, UserContent } from "ai";

import { createRandomId } from "./id.js";
import { PluginHost } from "./plugin.js";
import { ModelMessageContext } from "./plugin.js";

export type AgentCustomMessage<T extends keyof AgentCustomMessages = keyof AgentCustomMessages> = AgentCustomMessages[T];

export type AgentCustomMessageType = {
  [K in AgentCustomMessageKey]: AgentCustomMessages[K] extends CustomMessageBase<K, unknown> ? K : never;
}[AgentCustomMessageKey];

export type AgentCustomMessageData<T extends AgentCustomMessageType> = AgentCustomMessages[T] extends CustomMessageBase<T, infer D> ? D : never;

export type AgentMessage = AgentUserMessage | AgentSystemMessage | AgentAssistantMessage | AgentToolMessage | AgentCustomMessage;

export type CreateMessageOptions = Partial<Pick<AgentMessageBase, "id" | "timestamp">>;

type AgentCustomMessageKey = Extract<keyof AgentCustomMessages, string>;

export interface AgentMessageBase {
  id: string;
  timestamp: number;
}

export interface CustomMessageBase<T extends string = string, D = unknown> extends AgentMessageBase {
  role: "custom";
  type: T;
  data: D;
}

export interface AgentCustomMessages {
  custom: CustomMessageBase<"custom", unknown>;
}

export interface AgentUserMessage extends AgentMessageBase, UserModelMessage {}

export interface AgentSystemMessage extends AgentMessageBase, SystemModelMessage {}

export interface AgentAssistantMessage extends AgentMessageBase, AssistantModelMessage {
  usage?: Partial<LanguageModelUsage>;
  finishReason?: string;
}

export interface AgentToolMessage extends AgentMessageBase, ToolModelMessage {}

export function createUserMessage(content: UserContent, options: CreateMessageOptions = {}): AgentUserMessage {
  return { ...createMessageBase(options), role: "user", content };
}

export function createSystemMessage(content: string, options: CreateMessageOptions = {}): AgentSystemMessage {
  return { ...createMessageBase(options), role: "system", content };
}

export function createAssistantMessage(
  content: AssistantContent,
  options: Omit<Partial<AgentAssistantMessage>, "role" | "content"> = {},
): AgentAssistantMessage {
  const { id, timestamp, ...rest } = options;
  return { ...createMessageBase({ id, timestamp }), role: "assistant", content, ...rest };
}

export function createToolMessage(content: ToolContent, options: Omit<Partial<AgentToolMessage>, "role" | "content"> = {}): AgentToolMessage {
  const { id, timestamp, ...rest } = options;
  return { ...createMessageBase({ id, timestamp }), role: "tool", content, ...rest };
}

export function createCustomMessage<T extends AgentCustomMessageType>(
  type: T,
  data: AgentCustomMessageData<T>,
  options: CreateMessageOptions = {},
): AgentCustomMessages[T] {
  return { ...createMessageBase(options), role: "custom", type, data } as unknown as AgentCustomMessages[T];
}

export async function buildModelMessages(options: {
  history: AgentMessage[];
  current: AgentMessage[];
  pluginHost: PluginHost;
  context: Omit<ModelMessageContext, "history" | "current">;
}): Promise<ModelMessage[]> {
  const history = await options.pluginHost.helpers.transformMessages(options.history, options.context);
  const context: ModelMessageContext = Object.freeze({
    ...options.context,
    history: Object.freeze([...history]),
    current: Object.freeze([...options.current]),
  });
  const allMessages = [...context.history, ...context.current];
  const result: ModelMessage[] = [];

  for (const message of allMessages) {
    if (message.role === "custom") {
      const converted = await options.pluginHost.helpers.toModelMessages(message, context);
      if (converted.length > 0) {
        result.push(...(converted as ModelMessage[]));
      }
      continue;
    }

    if (isModelMessageRole(message.role)) {
      result.push(toPlainModelMessage(message));
    }
  }

  return extractToolImages(result);
}

/**
 * Extract image-data/image-url parts from tool-result content and emit them
 * as a following user message with proper ImagePart format.
 * This ensures providers that cannot handle multimodal tool results (e.g. OpenAI Chat)
 * still deliver images to the model via the user-role image path.
 */
function extractToolImages(messages: ModelMessage[]): ModelMessage[] {
  const out: ModelMessage[] = [];

  for (const msg of messages) {
    if (msg.role !== "tool") {
      out.push(msg);
      continue;
    }

    const images: ImagePart[] = [];
    const toolNames: string[] = [];
    let modified = false;

    const newContent: ToolContent = (msg.content as ToolContent).map((part) => {
      if (part.type !== "tool-result") return part;
      const output = part.output;
      if (output.type !== "content") return part;

      const imageItems: ImagePart[] = [];
      const remaining = output.value.filter((item) => {
        if (item.type === "image-data") {
          imageItems.push({ type: "image", image: item.data, mediaType: item.mediaType });
          return false;
        }
        if (item.type === "image-url") {
          imageItems.push({ type: "image", image: new URL(item.url), mediaType: undefined });
          return false;
        }
        return true;
      });

      if (imageItems.length === 0) return part;

      modified = true;
      images.push(...imageItems);
      toolNames.push(part.toolName);

      // Rewrite tool result to keep only non-image content
      const newOutput = remaining.length > 0 ? { ...output, value: remaining } : { type: "text" as const, value: `[${part.toolName}: 图片已通过视觉输入]` };
      return { ...part, output: newOutput };
    });

    if (!modified) {
      out.push(msg);
      continue;
    }

    out.push({ ...msg, content: newContent });
    // Append user message with extracted images
    const label = toolNames.length === 1 ? `[以下是工具 ${toolNames[0]} 返回的图片]` : `[以下是工具返回的图片]`;
    out.push({ role: "user", content: [{ type: "text", text: label }, ...images] });
  }

  return out;
}

function createMessageBase(options: CreateMessageOptions = {}): AgentMessageBase {
  return { id: options.id ?? createRandomId(), timestamp: options.timestamp ?? Date.now() };
}

function isModelMessageRole(role: AgentMessage["role"]): role is Exclude<AgentMessage["role"], "custom"> {
  return role === "system" || role === "user" || role === "assistant" || role === "tool";
}

function toPlainModelMessage(message: AgentUserMessage | AgentAssistantMessage | AgentToolMessage | Extract<AgentMessage, { role: "system" }>): ModelMessage {
  switch (message.role) {
    case "system":
      return { role: "system", content: message.content };
    case "user":
      return { role: "user", content: message.content };
    case "assistant": {
      const next: ModelMessage = { role: "assistant", content: message.content };
      if ("providerOptions" in message && message.providerOptions !== undefined) {
        (next as { providerOptions?: unknown }).providerOptions = message.providerOptions;
      }
      return next;
    }
    case "tool": {
      const next: ModelMessage = { role: "tool", content: message.content };
      if ("providerOptions" in message && message.providerOptions !== undefined) {
        (next as { providerOptions?: unknown }).providerOptions = message.providerOptions;
      }
      return next;
    }
  }
}
