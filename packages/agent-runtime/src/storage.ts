import { Awaitable } from "./base.js";
import type { AgentEntry } from "./entry.js";

export interface AgentStorage<T = AgentEntry> {
  append: (...items: T[]) => Awaitable<void>;
  clear: () => Awaitable<void>;
  read: () => Awaitable<Readonly<T[]>>;
}

export function createMemoryStorage<T extends AgentEntry = AgentEntry>(
  initialEntries: readonly T[] = [],
): AgentStorage<T> {
  const entries: T[] = [...initialEntries];

  return {
    async append(...nextEntries) {
      entries.push(...nextEntries);
    },
    async read() {
      return [...entries];
    },
    async clear() {
      entries.length = 0;
    },
  };
}
