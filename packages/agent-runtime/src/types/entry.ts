import type { AgentInternalEvent } from "./event.js";
import type { AgentMessage } from "./message.js";
import type { AgentState } from "./state.js";

export interface AgentCustomEntries {
  event: AgentInternalEvent;
  message: AgentMessage;
  state: AgentState;
}

export type AgentCustomEntryData<T extends keyof AgentCustomEntries = keyof AgentCustomEntries> =
  AgentCustomEntries[T];

export type AgentEntry<T extends keyof AgentCustomEntries = keyof AgentCustomEntries> =
  T extends keyof AgentCustomEntries
    ? {
        data: AgentCustomEntryData<T>;
        id: string;
        parentId?: string;
        timestamp: number;
        type: T;
      }
    : never;
