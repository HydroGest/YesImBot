import { appendFile, mkdir, readFile, rm } from "node:fs/promises";
import { dirname } from "node:path";

import type { AgentEntry, AgentStorage } from "@yesimbot/agent-runtime";

import { channelPath, type ChannelScope } from "../channel/index.js";

export function createJsonlStorage<T extends AgentEntry = AgentEntry>(
  filePath: string,
): AgentStorage<T> {
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
        return content
          .split("\n")
          .filter(Boolean)
          .map((line) => JSON.parse(line) as T)
          .filter(
            (entry) =>
              (entry as { data?: { type?: unknown } }).data?.type !== "athena.platform.message",
          );
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

export function createChannelStorage<T extends AgentEntry = AgentEntry>(
  basePath: string,
  scope: ChannelScope,
): AgentStorage<T> {
  return createJsonlStorage(channelPath(basePath, scope));
}
