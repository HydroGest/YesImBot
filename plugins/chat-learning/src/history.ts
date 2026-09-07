import { appendFile, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import type { AgentEntry } from "@yesimbot/agent-runtime";

export interface ChatHistoryStore {
  init(): Promise<void>;
  read(): Promise<readonly AgentEntry[]>;
  append(entries: readonly AgentEntry[]): Promise<void>;
  trim(maxAgeMs: number, maxEntries: number): Promise<readonly AgentEntry[]>;
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
        await mkdir(path.dirname(filePath), { recursive: true });
        const payload = nextEntries.map((entry) => JSON.stringify(entry)).join("\n");
        await appendFile(filePath, `${payload}\n`, "utf8");
      });
    },
    trim(maxAgeMs, maxEntries) {
      return serialize(async () => {
        const cutoff = Date.now() - maxAgeMs;
        let retained = entries.filter((entry) => entry.timestamp >= cutoff);
        if (retained.length > maxEntries) retained = retained.slice(-maxEntries);
        if (retained.length === entries.length) return [...entries];

        entries = [...retained];
        if (entries.length === 0) {
          await rm(filePath, { force: true });
          return [];
        }

        await mkdir(path.dirname(filePath), { recursive: true });
        const temporary = `${filePath}.${Date.now()}.tmp`;
        await writeFile(temporary, `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`, { encoding: "utf8", flag: "wx" });
        try {
          await rename(temporary, filePath);
        } finally {
          await rm(temporary, { force: true });
        }
        return [...entries];
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
