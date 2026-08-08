import { appendFile, mkdir, readFile, rm } from "node:fs/promises";
import { dirname } from "node:path";

import type { AgentEntry } from "@yesimbot/agent-runtime";

export interface ChatHistoryStore {
  init(): Promise<void>;
  read(): Promise<readonly AgentEntry[]>;
  append(entries: readonly AgentEntry[]): Promise<void>;
  clear(): Promise<void>;
}

export function createChatHistoryStore(filePath: string): ChatHistoryStore {
  let entries: AgentEntry[] = [];
  let tail: Promise<void> = Promise.resolve();

  const serialize = <T>(task: () => Promise<T>): Promise<T> => {
    const next = tail.then(task, task);
    tail = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  };

  return {
    async init() {
      await serialize(async () => {
        try {
          const content = await readFile(filePath, "utf8");
          entries = [];
          for (const line of content.split("\n")) {
            if (!line.trim()) continue;
            try {
              entries.push(JSON.parse(line) as AgentEntry);
            } catch {}
          }
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
      });
    },
    async read() {
      return [...entries];
    },
    append(nextEntries) {
      return serialize(async () => {
        if (nextEntries.length === 0) return;
        entries.push(...nextEntries);
        await mkdir(dirname(filePath), { recursive: true });
        const payload = nextEntries.map((entry) => JSON.stringify(entry)).join("\n");
        await appendFile(filePath, `${payload}\n`, "utf8");
      });
    },
    clear() {
      return serialize(async () => {
        entries = [];
        await rm(filePath, { force: true });
      });
    },
  };
}
