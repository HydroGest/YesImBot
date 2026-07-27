import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import {
  createAssistantMessage,
  createEntry,
  createToolMessage,
  createUserMessage,
} from "@yesimbot/agent-runtime";
import { describe, expect, it, vi } from "vitest";

vi.mock("koishi", async () => import("@koishijs/core"));

import type { ChannelScope } from "../src/channel/index.js";
import { createEvent, createMessage, type EventRecord, type MessageRecord } from "../src/event/index.js";
import { createJsonlStorage } from "../src/runtime/storage.js";
import { ChannelStorage } from "../src/storage/index.js";

describe("jsonl storage", () => {
  const messageRecord: MessageRecord = {
    schemaVersion: 3,
    platform: "test",
    selfId: "bot-1",
    channel: { id: "channel-1" },
    user: { id: "user-1" },
    messageId: "message-1",
    elements: [],
    timestamp: 1,
  };
  const eventRecord: EventRecord<"delivery.failed"> = {
    schemaVersion: 3,
    platform: "test",
    selfId: "bot-1",
    channel: { id: "channel-1" },
    eventType: "delivery.failed",
    text: "Delivery failed",
    timestamp: 1,
    delivery: {
      turnId: "turn-1",
      messageId: "message-1",
      segmentIndex: 1,
      segmentTotal: 1,
      error: { name: "Error", message: "failed" },
    },
  };

  it("round-trips valid yesimbot.message payloads", async () => {
    const dir = await mkdtemp(join(tmpdir(), "athena-core-storage-"));
    const storage = createJsonlStorage(join(dir, "session.jsonl"));
    const entry = createEntry("message", createMessage(messageRecord));

    await storage.append(entry);

    await expect(storage.read()).resolves.toEqual([entry]);
  });

  it.each([
    ["an unsupported schema version", { ...messageRecord, schemaVersion: 2 }],
    ["a missing elements array", { ...messageRecord, elements: undefined }],
  ])("rejects yesimbot.message payload with %s", async (_label, data) => {
    const dir = await mkdtemp(join(tmpdir(), "athena-core-storage-"));
    const filePath = join(dir, "session.jsonl");
    const entry = createEntry("message", createMessage(messageRecord));
    await writeFile(filePath, `${JSON.stringify({ ...entry, data: { ...entry.data, data } })}\n`, "utf8");

    await expect(createJsonlStorage(filePath).read()).rejects.toThrow();
  });

  it("round-trips valid yesimbot.event payloads", async () => {
    const dir = await mkdtemp(join(tmpdir(), "athena-core-storage-"));
    const storage = createJsonlStorage(join(dir, "session.jsonl"));
    const entry = createEntry("message", createEvent(eventRecord));

    await storage.append(entry);

    await expect(storage.read()).resolves.toEqual([entry]);
  });

  it("rejects malformed yesimbot.event payloads", async () => {
    const dir = await mkdtemp(join(tmpdir(), "athena-core-storage-"));
    const filePath = join(dir, "session.jsonl");
    const entry = createEntry("message", createEvent(eventRecord));
    await writeFile(
      filePath,
      `${JSON.stringify({ ...entry, data: { ...entry.data, data: { ...entry.data.data, text: 1 } } })}\n`,
      "utf8",
    );

    await expect(createJsonlStorage(filePath).read()).rejects.toThrow();
  });

  it("passes non-target AgentEntry values through unchanged", async () => {
    const dir = await mkdtemp(join(tmpdir(), "athena-core-storage-"));
    const storage = createJsonlStorage(join(dir, "session.jsonl"));
    const entries = [
      createEntry("message", createUserMessage("user")),
      createEntry("message", createAssistantMessage("assistant")),
      createEntry(
        "message",
        createToolMessage([
          {
            type: "tool-result",
            toolCallId: "call-1",
            toolName: "test",
            output: { type: "text", value: "tool" },
          },
        ]),
      ),
      createEntry("state", { state: "value" }),
      createEntry("event", { name: "internal" }),
    ];

    await storage.append(...entries);

    await expect(storage.read()).resolves.toEqual(entries);
  });

  it("appends entries and reads them back across restarts", async () => {
    const dir = await mkdtemp(join(tmpdir(), "athena-core-storage-"));
    const filePath = join(dir, "session.jsonl");
    const storage = createJsonlStorage(filePath);
    const first = createEntry("message", createUserMessage("one"));
    const second = createEntry("message", createUserMessage("two"));

    await storage.append(first, second);

    expect(await storage.read()).toEqual([first, second]);
    expect(await createJsonlStorage(filePath).read()).toEqual([first, second]);
  });

  it("persists one json line per appended entry", async () => {
    const dir = await mkdtemp(join(tmpdir(), "athena-core-storage-"));
    const filePath = join(dir, "session.jsonl");
    const storage = createJsonlStorage(filePath);

    await storage.append(
      createEntry("message", createUserMessage("one")),
      createEntry("message", createUserMessage("two")),
    );

    const content = await readFile(filePath, "utf8");
    expect(content.trim().split("\n")).toHaveLength(2);
  });

  it("clears the backing file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "athena-core-storage-"));
    const filePath = join(dir, "session.jsonl");
    const storage = createJsonlStorage(filePath);

    await storage.append(createEntry("message", createUserMessage("one")));
    await storage.clear();

    await expect(stat(filePath)).rejects.toThrow();
    expect(await storage.read()).toEqual([]);
  });

  it("does not load a legacy platform message entry", async () => {
    const dir = await mkdtemp(join(tmpdir(), "athena-core-storage-"));
    const scope: ChannelScope = {
      platform: "onebot",
      selfId: "10000",
      channelId: "123456",
      isDirect: false,
    };
    const legacyPath = join(
      dir,
      "channels",
      "ch_v1_2lgdyhmnfri2bdu7",
      "sessions",
      "messages.jsonl",
    );
    const eventPath = await new ChannelStorage(dir).ensure(scope, "sessions", "messages.jsonl");
    const legacyEntry = {
      type: "message",
      data: {
        type: ["athena", "platform", "message"].join("."),
        role: "custom",
      },
    };

    expect(eventPath).toBe(
      join(dir, "channels", "v1-shared-onebot-123456", "sessions", "messages.jsonl"),
    );
    await mkdir(dirname(legacyPath), { recursive: true });
    await writeFile(legacyPath, `${JSON.stringify(legacyEntry)}\n`, "utf8");

    await expect(createJsonlStorage(eventPath).read()).resolves.toEqual([]);
  });
});
