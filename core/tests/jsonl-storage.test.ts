import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { createEntry, createUserMessage } from "@yesimbot/agent-runtime";
import { describe, expect, it } from "vitest";

import { createJsonlStorage } from "../src/runtime/storage.js";
import { channelPath } from "../src/channel/index.js";

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
    const scope = { platform: "test", selfId: "bot", channelId: "room" };
    const legacyPath = join(dir, "channels", "ch_v1_2lgdyhmnfri2bdu7", "sessions", "messages.jsonl");
    const eventPath = channelPath(dir, scope);
    const legacyEntry = {
      type: "message",
      data: {
        type: ["athena", "platform", "message"].join("."),
        role: "custom",
      },
    };

    expect(eventPath).not.toBe(legacyPath);
    await mkdir(dirname(legacyPath), { recursive: true });
    await writeFile(legacyPath, `${JSON.stringify(legacyEntry)}\n`, "utf8");

    await expect(createJsonlStorage(eventPath).read()).resolves.toEqual([]);
  });
});
