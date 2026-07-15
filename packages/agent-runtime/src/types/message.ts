import type {
  AssistantModelMessage,
  SystemModelMessage,
  ToolModelMessage,
  UserModelMessage,
} from "@ai-sdk/provider-utils";
import type { LanguageModelUsage } from "ai";

export interface AgentMessageBase {
  id: string;
  timestamp: number;
}

export interface CustomMessageBase<
  T extends string = string,
  D = unknown,
> extends AgentMessageBase {
  role: "custom";
  type: T;
  data: D;
}

export interface AgentCustomMessages {
  "custom": CustomMessageBase<"custom", unknown>;
}

export type AgentCustomMessage<T extends keyof AgentCustomMessages = keyof AgentCustomMessages> =
  AgentCustomMessages[T];

type AgentCustomMessageKey = Extract<keyof AgentCustomMessages, string>;

export type AgentCustomMessageType = {
  [K in AgentCustomMessageKey]: AgentCustomMessages[K] extends CustomMessageBase<K, unknown>
    ? K
    : never;
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
