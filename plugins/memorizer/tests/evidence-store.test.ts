import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { EvidenceStore } from "../src/store/evidence.js";

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

function message(messageId: string, timestamp: number) {
  return { platform: "test", selfId: "bot", channel: { id: "room", type: 0 }, user: { id: "user" }, messageId, timestamp, elements: [] };
}

describe("EvidenceStore", () => {
  it("persists, deduplicates, merges, and removes message evidence", async () => {
    const root = await mkdtemp(join(tmpdir(), "yesimbot-evidence-"));
    roots.push(root);
    const store = new EvidenceStore(root);

    await store.append("first", [message("one", 1), message("one", 1)]);
    await store.append("second", [message("two", 2)]);
    await expect(store.read("first")).resolves.toEqual([message("one", 1)]);
    await store.merge("first", ["second"]);
    await expect(store.read("first")).resolves.toEqual([message("one", 1), message("two", 2)]);
    await expect(store.read("second")).resolves.toEqual([]);
    await store.remove("first");
    await expect(store.count("first")).resolves.toBe(0);
  });

  it("does not overwrite corrupt evidence JSON", async () => {
    const root = await mkdtemp(join(tmpdir(), "yesimbot-evidence-corrupt-"));
    roots.push(root);
    const path = join(root, "evidence", "broken.json");
    await mkdir(join(root, "evidence"), { recursive: true });
    await writeFile(path, "not json");
    const store = new EvidenceStore(root);

    await expect(store.append("broken", [message("one", 1)])).rejects.toThrow("Invalid evidence JSON");
    await expect(readFile(path, "utf8")).resolves.toBe("not json");
  });
});
