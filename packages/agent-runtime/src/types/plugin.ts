import type { ModelMessage, SystemModelMessage } from "@ai-sdk/provider-utils";

import type { AgentChannel } from "../channel.js";
import type { AgentStateManager } from "../state.js";
import type { AgentToolSet, ToolDecision } from "../tools.js";
import type { TurnResult } from "../turn.js";
import type { Awaitable } from "./base.js";
import type { AgentEntry } from "./entry.js";
import type { AgentMessage } from "./message.js";
import type { AgentStorage } from "./storage.js";

export interface AgentPluginRuntime {
  readonly id: string;
  readonly channel: AgentChannel;
  readonly state: AgentStateManager;
}

export type SystemPromptBlock = string | SystemModelMessage;
export type SystemPromptAppend = SystemPromptBlock | readonly SystemPromptBlock[];

export interface AgentPlugin {
  name: string;
  version?: string;
  enforce?: "pre" | "post";
  optional?: boolean;
  requiresMessageId?: boolean;
  tools?: AgentToolSet | ((runtime: AgentPluginRuntime) => Awaitable<AgentToolSet | void>);
  init?(runtime: AgentPluginRuntime): Awaitable<void>;
  stop?(): Awaitable<void>;
  onAppend?(entries: AgentEntry[], context: AppendHookContext): Awaitable<AgentEntry[] | void>;
  transformMessages?(
    messages: AgentMessage[],
    context: MessageTransformContext,
  ): Awaitable<AgentMessage[]>;
  toModelMessages?(
    message: AgentMessage,
    context: ModelMessageContext,
  ): Awaitable<ModelMessage[] | ModelMessage | void>;
  extendSystemPrompt?(prompt: string, context: PromptContext): Awaitable<string | void>;
  appendSystemPrompt?(context: PromptContext): Awaitable<SystemPromptAppend | void>;
  extendTools?(tools: AgentToolSet, context: ToolExtensionContext): Awaitable<AgentToolSet | void>;
  beforeToolCall?(call: ToolCallContext, context: ToolHookContext): Awaitable<ToolDecision | void>;
  afterToolCall?(
    result: ToolResultContext,
    context: ToolHookContext,
  ): Awaitable<Partial<ToolResultContext> | void>;
  onTurnFinish?(result: TurnResult, context: TurnFinishContext): Awaitable<void>;
}

export interface HookContextBase {
  readonly runtime: { id: string };
  readonly channel: AgentChannel;
  readonly state: AgentStateManager;
  readonly signal?: AbortSignal;
  readonly pluginName?: string;
}

export interface AppendHookContext extends HookContextBase {
  readonly storage: AgentStorage;
}

export interface MessageTransformContext extends HookContextBase {
  readonly turnId?: string;
}

export interface ModelMessageContext extends HookContextBase {
  readonly turnId?: string;
}

export interface PromptContext extends HookContextBase {
  readonly turnId?: string;
}

export interface ToolExtensionContext extends HookContextBase {
  readonly turnId?: string;
}

export interface ToolHookContext extends HookContextBase {
  readonly turnId: string;
}

export interface TurnFinishContext extends HookContextBase {
  readonly turnId: string;
}

export interface ToolCallContext {
  toolCallId: string;
  toolName: string;
  args: unknown;
}

export interface ToolResultContext extends ToolCallContext {
  result: unknown;
  isError: boolean;
}
