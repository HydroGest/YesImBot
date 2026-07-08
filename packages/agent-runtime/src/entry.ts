import { createRandomId } from "./id.js";
import type { AgentCustomEntries, AgentCustomEntryData, AgentEntry } from "./types/entry.js";
import type { AgentInternalEvent } from "./types/event.js";
import type { AgentMessage } from "./types/message.js";
import type { AgentState } from "./types/state.js";

export interface CreateEntryOptions {
  id?: string;
  timestamp?: number;
  parentId?: string;
}

export function createEntry<T extends keyof AgentCustomEntries>(
  type: T,
  data: AgentCustomEntryData<T>,
  options: CreateEntryOptions = {},
): AgentEntry<T> {
  return {
    id: options.id ?? createRandomId(),
    type,
    data,
    timestamp: options.timestamp ?? Date.now(),
    parentId: options.parentId,
  } as AgentEntry<T>;
}

export function createMessageEntry(
  message: AgentMessage,
  options: CreateEntryOptions = {},
): AgentEntry<"message"> {
  return createEntry("message", message, options);
}

export function createStateEntry(
  state: AgentState,
  options: CreateEntryOptions = {},
): AgentEntry<"state"> {
  return createEntry("state", state, options);
}

export function createEventEntry(
  event: AgentInternalEvent,
  options: CreateEntryOptions = {},
): AgentEntry<"event"> {
  return createEntry("event", event, options);
}
