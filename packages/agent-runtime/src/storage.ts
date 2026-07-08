import type { AgentEntry } from "./types/entry.js";
import type { AgentStorage } from "./types/storage.js";

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
