import type { TextStreamPart, ToolSet } from "ai";

import { createRandomId } from "./id.js";
import type { AgentMessage } from "./message.js";

interface TurnScoped {
  turnId: string;
}

export interface AgentCustomChannelEvents {
  internal: AgentInternalEvent;
  stream: TextStreamPart<ToolSet>;
}

export interface AgentDiagnostic {
  name: string;
  message: string;
  cause?: string;
}

export interface AgentInitEvent {
  type: "agent.init";
}

export interface AgentStopEvent {
  type: "agent.stop";
}

export interface AgentErrorEvent {
  type: "agent.error";
  error: AgentDiagnostic;
}

export interface TurnQueuedEvent extends TurnScoped {
  type: "turn.queued";
}

export interface TurnStartEvent extends TurnScoped {
  type: "turn.start";
}

export interface TurnStepEvent extends TurnScoped {
  type: "turn.step";
  step: number;
}

export interface TurnDeltaEvent extends TurnScoped {
  type: "turn.delta";
  delta: string;
}

export interface TurnDoneEvent extends TurnScoped {
  type: "turn.done";
}

export interface TurnFailedEvent extends TurnScoped {
  type: "turn.failed";
  error: AgentDiagnostic;
}

export interface TurnAbortedEvent extends TurnScoped {
  type: "turn.aborted";
  reason?: string;
}

export type MessageAppendedEvent =
  | {
      type: "message.appended";
      message: AgentMessage;
    }
  | ({
      type: "message.appended";
      message: AgentMessage;
    } & TurnScoped);

export interface ToolStartEvent extends TurnScoped {
  type: "tool.start";
  toolName: string;
  toolCallId?: string;
}

export interface ToolDoneEvent extends TurnScoped {
  type: "tool.done";
  toolName: string;
  toolCallId?: string;
}

export interface ToolFailedEvent extends TurnScoped {
  type: "tool.failed";
  toolName: string;
  toolCallId?: string;
  error: AgentDiagnostic;
}

export interface ToolBlockedEvent extends TurnScoped {
  type: "tool.blocked";
  toolName: string;
  toolCallId?: string;
  reason?: string;
}

export interface PluginErrorEvent {
  type: "plugin.error";
  plugin: string;
  error: AgentDiagnostic;
}

export interface PluginDisabledEvent {
  type: "plugin.disabled";
  plugin: string;
  reason?: AgentDiagnostic;
}

export type AgentInternalEventInit =
  | AgentInitEvent
  | AgentStopEvent
  | AgentErrorEvent
  | TurnQueuedEvent
  | TurnStartEvent
  | TurnStepEvent
  | TurnDeltaEvent
  | TurnDoneEvent
  | TurnFailedEvent
  | TurnAbortedEvent
  | MessageAppendedEvent
  | ToolStartEvent
  | ToolDoneEvent
  | ToolFailedEvent
  | ToolBlockedEvent
  | PluginErrorEvent
  | PluginDisabledEvent;

export interface AgentInternalEventMeta {
  id: string;
  timestamp: number;
}

export type AgentInternalEvent<T extends AgentInternalEventInit = AgentInternalEventInit> = T & AgentInternalEventMeta;

export type AgentCustomChannelEvent<T extends keyof AgentCustomChannelEvents = keyof AgentCustomChannelEvents> =
  AgentCustomChannelEvents[T];

function formatDiagnosticCause(cause: unknown): string | undefined {
  if (cause === undefined) {
    return undefined;
  }

  if (cause instanceof Error) {
    return `${cause.name}: ${cause.message}`;
  }

  return String(cause);
}

export function createDiagnostic(error: unknown): AgentDiagnostic {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      cause: formatDiagnosticCause(error.cause),
    };
  }

  return {
    name: "UnknownError",
    message: String(error),
  };
}

export function createInternalEvent<T extends AgentInternalEventInit>(event: T): AgentInternalEvent<T> {
  return {
    id: createRandomId(),
    timestamp: Date.now(),
    ...event,
  };
}
