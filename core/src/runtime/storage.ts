import { appendFile, mkdir, readFile, rm } from "node:fs/promises";
import { dirname } from "node:path";

import type { AgentEntry, AgentStorage } from "@yesimbot/agent-runtime";

export function createJsonlStorage(
  filePath: string,
  warn: (cause: unknown) => void = () => undefined,
): AgentStorage<AgentEntry> {
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
        for (const line of content.split("\n")) {
          if (!line) continue;
          try {
            entries.push(JSON.parse(line));
          } catch (cause) {
            warn(cause);
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
