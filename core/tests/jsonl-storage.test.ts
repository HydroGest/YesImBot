import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { Context } from "@koishijs/core";
import { createEntry, createUserMessage } from "@yesimbot/agent-runtime";
import { Universal } from "koishi";
import { describe, expect, it, vi } from "vitest";

vi.mock("koishi", async () => import("@koishijs/core"));

import type { ChannelScope } from "../src/channel.js";
import { ChannelStorage } from "../src/channel.js";
import { createEvent, createMessage, type EventRecord, type MessageRecord } from "../src/messages.js";
import { createJsonlStorage } from "../src/runtime/storage.js";

describe("jsonl storage", () => {
  const messageRecord: MessageRecord = {
    platform: "test",
    selfId: "bot-1",
    channel: { id: "channel-1", type: Universal.Channel.Type.TEXT },
    user: { id: "user-1" },
    messageId: "message-1",
    elements: [],
    timestamp: 1,
  };
  const eventRecord: EventRecord<"delivery.failed"> = {
    platform: "test",
    selfId: "bot-1",
    channel: { id: "channel-1", type: Universal.Channel.Type.TEXT },
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

  it("skips a syntactically invalid line and warns while retaining adjacent entries", async () => {
    const dir = await mkdtemp(join(tmpdir(), "athena-core-storage-"));
    const filePath = join(dir, "session.jsonl");
    const first = createEntry("message", createMessage(messageRecord));
    const second = createEntry("message", createEvent(eventRecord));
    const warn = vi.fn();
    await writeFile(filePath, `${JSON.stringify(first)}\n{"broken":\n${JSON.stringify(second)}\n`, "utf8");

    await expect(createJsonlStorage(filePath, warn).read()).resolves.toEqual([first, second]);
    expect(warn).toHaveBeenCalledOnce();
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

  it("returns an empty history when the file is absent", async () => {
    const dir = await mkdtemp(join(tmpdir(), "athena-core-storage-"));

    await expect(createJsonlStorage(join(dir, "missing.jsonl")).read()).resolves.toEqual([]);
  });

  it("does not load a legacy platform message entry", async () => {
    const dir = await mkdtemp(join(tmpdir(), "athena-core-storage-"));
    const scope: ChannelScope = {
      platform: "onebot",
      selfId: "10000",
      channelId: "123456",
      type: "shared",
    };
    const legacyPath = join(dir, "channels", "ch_v1_2lgdyhmnfri2bdu7", "sessions", "messages.jsonl");
    const eventPath = join(
      await new ChannelStorage(new Context(), dir).getStoragePath(scope),
      "sessions",
      "messages.jsonl",
    );
    const legacyEntry = {
      type: "message",
      data: {
        type: ["athena", "platform", "message"].join("."),
        role: "custom",
      },
    };

    expect(eventPath).toBe(join(dir, "channels", "shared-onebot-123456", "sessions", "messages.jsonl"));
    await mkdir(dirname(legacyPath), { recursive: true });
    await writeFile(legacyPath, `${JSON.stringify(legacyEntry)}\n`, "utf8");

    await expect(createJsonlStorage(eventPath).read()).resolves.toEqual([]);
  });
});
