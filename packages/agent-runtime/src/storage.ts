import { appendFile, mkdir, readFile, rm } from "node:fs/promises";
import { dirname } from "node:path";

import type { AgentEntry } from "./entry.js";

export interface AgentStorage<T = AgentEntry> {
  append: (...items: T[]) => Promise<void> | void;
  clear: () => Promise<void> | void;
  read: () => Promise<Readonly<T[]>> | Readonly<T[]>;
}

export function createMemoryStorage<T extends AgentEntry = AgentEntry>(initialEntries: readonly T[] = []): AgentStorage<T> {
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

export function createJsonlStorage(filePath: string): AgentStorage<AgentEntry> {
  return {
    async append(...entries) {
      if (!entries.length) {
        return;
      }

      await mkdir(dirname(filePath), { recursive: true });
      const payload = entries.map((entry) => JSON.stringify(entry)).join("\n");
      await appendFile(filePath, `${payload}\n`, "utf8");
    },
    async read() {
      try {
        const content = await readFile(filePath, "utf8");
        const entries: AgentEntry[] = [];
        const lines = content.split("\n");
        for (const [i, line] of lines.entries()) {
          if (!line) continue;
          try {
            entries.push(JSON.parse(line) as AgentEntry);
          } catch (error) {
            throw new SyntaxError(`Invalid JSON at line ${i + 1}: ${error instanceof Error ? error.message : String(error)}`);
          }
        }
        return entries;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          return [];
        }
        throw error;
      }
    },
    async clear() {
      await rm(filePath, { force: true });
    },
  };
}
