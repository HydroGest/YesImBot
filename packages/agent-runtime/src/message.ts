import type {
  AssistantModelMessage,
  SystemModelMessage,
  ToolModelMessage,
  UserModelMessage,
} from "@ai-sdk/provider-utils";
import type { AssistantContent, LanguageModelUsage, ModelMessage, ToolContent, UserContent } from "ai";

import { createRandomId } from "./id.js";
import { PluginHost } from "./plugin.js";
import { ModelMessageContext } from "./plugin.js";

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

export type AgentCustomMessage<T extends keyof AgentCustomMessages = keyof AgentCustomMessages> =
  AgentCustomMessages[T];

type AgentCustomMessageKey = Extract<keyof AgentCustomMessages, string>;

export type AgentCustomMessageType = {
  [K in AgentCustomMessageKey]: AgentCustomMessages[K] extends CustomMessageBase<K, unknown> ? K : never;
}[AgentCustomMessageKey];

export type AgentCustomMessageData<T extends AgentCustomMessageType> =
  AgentCustomMessages[T] extends CustomMessageBase<T, infer D> ? D : never;

export type AgentMessage =
  | AgentUserMessage
  | AgentSystemMessage
  | AgentAssistantMessage
  | AgentToolMessage
  | AgentCustomMessage;

export interface AgentUserMessage extends AgentMessageBase, UserModelMessage {}

export interface AgentSystemMessage extends AgentMessageBase, SystemModelMessage {}

export interface AgentAssistantMessage extends AgentMessageBase, AssistantModelMessage {
  usage?: Partial<LanguageModelUsage>;
  finishReason?: string;
}

export interface AgentToolMessage extends AgentMessageBase, ToolModelMessage {}

export type CreateMessageOptions = Partial<Pick<AgentMessageBase, "id" | "timestamp">>;

function createMessageBase(options: CreateMessageOptions = {}): AgentMessageBase {
  return {
    id: options.id ?? createRandomId(),
    timestamp: options.timestamp ?? Date.now(),
  };
}

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

export function createToolMessage(content: ToolContent, options: CreateMessageOptions = {}): AgentToolMessage {
  return { ...createMessageBase(options), role: "tool", content };
}

export function createCustomMessage<T extends AgentCustomMessageType>(
  type: T,
  data: AgentCustomMessageData<T>,
  options: CreateMessageOptions = {},
): AgentCustomMessages[T] {
  return {
    ...createMessageBase(options),
    role: "custom",
    type,
    data,
  } as unknown as AgentCustomMessages[T];
}

function isModelMessageRole(role: AgentMessage["role"]): role is Exclude<AgentMessage["role"], "custom"> {
  return role === "system" || role === "user" || role === "assistant" || role === "tool";
}

function toPlainModelMessage(
  message: AgentUserMessage | AgentAssistantMessage | AgentToolMessage | Extract<AgentMessage, { role: "system" }>,
): ModelMessage {
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

  return result;
}
