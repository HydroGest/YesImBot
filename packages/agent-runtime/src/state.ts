import { Awaitable } from "./base.js";
import { createEntry } from "./entry.js";
import type { AgentEntry } from "./entry.js";
import type { AgentStorage } from "./storage.js";

export interface AgentCustomState {}

export interface AgentState extends AgentCustomState {
  version: number;
}

export interface AgentStateManager {
  get(): AgentState;
  set(next: AgentState): Awaitable<void>;
  update(updater: (current: AgentState) => AgentState): Awaitable<AgentState>;
}

export function createStateManager(options: {
  storage: AgentStorage<AgentEntry>;
  initialState?: AgentState;
}): AgentStateManager {
  let current = options.initialState ?? { version: 1 };

  return {
    get() {
      return current;
    },
    async set(next) {
      current = next;
      await options.storage.append(createEntry("state", next));
    },
    async update(updater) {
      const next = updater(current);
      await this.set(next);
      return next;
    },
  };
}

export async function resolveInitialState(options: {
  storage: AgentStorage<AgentEntry>;
  initialState?: AgentState;
  defaultState?: AgentState;
}): Promise<AgentState> {
  if (options.initialState) return options.initialState;
  const entries = await options.storage.read();
  const latest = [...entries].reverse().find((entry) => entry.type === "state");
  if (latest?.type === "state") return latest.data as AgentState;
  return options.defaultState ?? { version: 1 };
}
