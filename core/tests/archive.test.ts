import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

import { createEntry, createJsonlStorage } from "@yesimbot/agent-runtime";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { archiveSession } from "../src/runtime/compact/archive.js";

const logger = { warn: () => undefined };

async function sessionFiles(dir: string): Promise<string[]> {
  return (await fs.readdir(dir)).filter((name) => name.endsWith(".jsonl")).sort();
}

describe("archiveSession", () => {
  let dir: string;

  beforeEach(async () => {
    dir = join(tmpdir(), `yesimbot-archive-${randomUUID()}`);
    await fs.mkdir(dir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("writes a compact entry that references the active source session", async () => {
    const oldPath = join(dir, "20260801T090000Z.jsonl");
    const oldStorage = createJsonlStorage(oldPath);
    await oldStorage.append(
      createEntry("message", { role: "user", id: "m1", timestamp: 1, content: "hello" }, { id: "e1" }),
      createEntry("message", { role: "assistant", id: "m2", timestamp: 2, content: "hi" }, { id: "e2" }),
    );

    const newPath = await archiveSession({
      sessionsDir: dir,
      currentStorage: oldStorage,
      executeCompactFn: async () => "Summary of prior conversation.",
      logger,
    });

    const entries = await createJsonlStorage(newPath).read();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      type: "compact",
      data: {
        summary: "Summary of prior conversation.",
        lastEntryId: "e2",
        sourceSession: "20260801T090000Z",
      },
    });
    expect(basename(newPath)).not.toBe(basename(oldPath));
  });

  it("creates a blank session without summarizing when noSummary is set", async () => {
    const oldStorage = createJsonlStorage(join(dir, "20260801T090000Z.jsonl"));
    await oldStorage.append(createEntry("message", { role: "user", id: "m1", timestamp: 1, content: "hello" }));

    const newPath = await archiveSession({
      sessionsDir: dir,
      currentStorage: oldStorage,
      noSummary: true,
      executeCompactFn: async () => {
        throw new Error("must not summarize");
      },
      logger,
    });

    expect(await createJsonlStorage(newPath).read()).toEqual([]);
  });

  it("rejects an empty session without creating a new file", async () => {
    const oldStorage = createJsonlStorage(join(dir, "20260801T090000Z.jsonl"));

    await expect(
      archiveSession({ sessionsDir: dir, currentStorage: oldStorage, executeCompactFn: async () => "summary", logger }),
    ).rejects.toThrow(/empty/i);
    expect(await sessionFiles(dir)).toEqual([]);
  });

  it("does not create a new session when compaction fails", async () => {
    const oldFilename = "20260801T090000Z.jsonl";
    const oldStorage = createJsonlStorage(join(dir, oldFilename));
    await oldStorage.append(createEntry("message", { role: "user", id: "m1", timestamp: 1, content: "hello" }));

    await expect(
      archiveSession({
        sessionsDir: dir,
        currentStorage: oldStorage,
        executeCompactFn: async () => {
          throw new Error("model unavailable");
        },
        logger,
      }),
    ).rejects.toThrow("model unavailable");
    expect(await sessionFiles(dir)).toEqual([oldFilename]);
  });
  it("does not activate an empty destination when its full write fails", async () => {
    const oldFilename = "20260801T090000Z.jsonl";
    const oldStorage = createJsonlStorage(join(dir, oldFilename));
    await oldStorage.append(createEntry("message", { role: "user", id: "m1", timestamp: 1, content: "hello" }));
    const writeFile = vi.spyOn(fs, "writeFile").mockRejectedValueOnce(new Error("disk full"));

    await expect(
      archiveSession({
        sessionsDir: dir,
        currentStorage: oldStorage,
        executeCompactFn: async () => "summary",
        logger,
      }),
    ).rejects.toThrow("disk full");

    expect(await sessionFiles(dir)).toEqual([oldFilename]);
    writeFile.mockRestore();
  });
});
