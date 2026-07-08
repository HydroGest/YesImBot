import { describe, expect, it } from "vitest";

import { createMemoryStorage } from "../src/storage.js";
import { createStateManager } from "../src/state.js";

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe("state manager", () => {
  it("persists JSON state snapshots as state entries", async () => {
    const storage = createMemoryStorage();
    const state = createStateManager({ storage, initialState: { version: 1 } });

    await state.update((current) => ({ ...current, version: current.version + 1 }));

    expect(state.get()).toEqual({ version: 2 });
    const entries = await storage.read();

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      type: "state",
      data: { version: 2 },
    });
    expect(entries[0].id).toMatch(UUID_REGEX);
    expect(entries[0].parentId).toBeUndefined();
  });
});
