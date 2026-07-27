import { appendFile, mkdir, readFile, rm } from "node:fs/promises";
import { dirname } from "node:path";

import type { AgentEntry, AgentStorage } from "@yesimbot/agent-runtime";
import { z } from "zod";

const channelSchema = z.object({ id: z.string().min(1) }).passthrough();

const messageDataSchema = z
  .object({
    schemaVersion: z.literal(3),
    platform: z.string().min(1),
    selfId: z.string().min(1),
    channel: channelSchema,
    user: z.object({ id: z.string().min(1) }).passthrough(),
    messageId: z.string().min(1),
    elements: z.array(z.unknown()),
    timestamp: z.number(),
  })
  .passthrough();

const eventDataSchema = z
  .object({
    schemaVersion: z.literal(3),
    platform: z.string().min(1),
    selfId: z.string().min(1),
    channel: channelSchema,
    eventType: z.string().min(1),
    text: z.string(),
    timestamp: z.number(),
  })
  .passthrough();

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
          .map((line) => validateEntry(JSON.parse(line)) as T);
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

function validateEntry(entry: unknown): unknown {
  if (!isRecord(entry) || entry.type !== "message" || !isRecord(entry.data)) return entry;
  const message = entry.data;
  if (message.role !== "custom") return entry;
  if (message.type !== "yesimbot.message" && message.type !== "yesimbot.event") return entry;

  const data = isRecord(message.data)
    ? { ...message.data, timestamp: message.timestamp }
    : message.data;
  if (message.type === "yesimbot.message") messageDataSchema.parse(data);
  if (message.type === "yesimbot.event") eventDataSchema.parse(data);
  return entry;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
