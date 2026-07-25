import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { createEntry, createUserMessage } from "@yesimbot/agent-runtime";
import { describe, expect, it, vi } from "vitest";

vi.mock("koishi", async () => import("@koishijs/core"));

import type { ChannelScope } from "../src/channel/index.js";
import { createJsonlStorage } from "../src/runtime/storage.js";
import { ChannelStorage } from "../src/storage/index.js";

describe("jsonl storage", () => {
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
