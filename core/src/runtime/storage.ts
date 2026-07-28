import { appendFile, mkdir, readFile, rm } from "node:fs/promises";
import { dirname } from "node:path";

import type { AgentEntry, AgentStorage } from "@yesimbot/agent-runtime";
import { z } from "zod";

const channelSchema = z
  .object({
    id: z.string().min(1),
    type: z.number().int(),
    name: z.string().optional(),
  })
  .passthrough();

const userSchema = z
  .object({
    id: z.string(),
    name: z.string().optional(),
  })
  .passthrough();

const elementSchema: z.ZodType<unknown> = z.lazy(() =>
  z
    .object({
      type: z.string().min(1),
      attrs: z.record(z.string(), z.unknown()).optional(),
      children: z.array(elementSchema).optional(),
    })
    .passthrough(),
);

const messageDataSchema = z
  .object({
    schemaVersion: z.literal(3),
    platform: z.string().min(1),
    selfId: z.string().min(1),
    channel: channelSchema,
    user: userSchema,
    messageId: z.string().min(1),
    elements: z.array(elementSchema),
    timestamp: z.number(),
  })
  .passthrough();

const eventBaseSchema = z
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

const deliveryFailedEventSchema = eventBaseSchema.extend({
  eventType: z.literal("delivery.failed"),
  delivery: z.object({
    turnId: z.string(),
    messageId: z.string(),
    segmentIndex: z.number().int().nonnegative(),
    segmentTotal: z.number().int().positive(),
    error: z.object({
      name: z.string(),
      message: z.string(),
      code: z.string().optional(),
    }),
  }),
});

const extensionEventSchema = eventBaseSchema
  .extend({ eventType: z.string().min(1) })
  .refine(({ eventType }) => eventType !== "delivery.failed");

const eventDataSchema = z.union([deliveryFailedEventSchema, extensionEventSchema]);

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
