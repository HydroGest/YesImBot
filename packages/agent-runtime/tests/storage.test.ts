import { describe, expect, it } from "vitest";

import { createEntry } from "../src/entry.js";
import { createMemoryStorage } from "../src/storage.js";

describe("memory storage", () => {
  it("appends, reads, and clears entries", async () => {
    const storage = createMemoryStorage();
    const entry = createEntry("state", { version: 2 }, { parentId: "tree-parent" });

    await storage.append(entry);
    expect(await storage.read()).toEqual([entry]);
    expect(entry.type).toBe("state");
    expect(entry.parentId).toBe("tree-parent");

    await storage.clear();
    expect(await storage.read()).toEqual([]);
  });
});
