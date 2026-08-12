import { describe, expect, it } from "vitest";

import { MemoryStore } from "../src/store/memory.js";

class Model {
  public readonly rows: Record<string, unknown>[] = [];
  public extend(): void {}
  public async get(_table: string, query: Record<string, unknown>): Promise<Record<string, unknown>[]> {
    return this.rows.filter((row) => Object.entries(query).every(([key, value]) => row[key] === value));
  }
  public async set(_table: string, query: Record<string, unknown>, patch: Record<string, unknown>): Promise<void> {
    for (const row of this.rows) if (Object.entries(query).every(([key, value]) => row[key] === value)) Object.assign(row, patch);
  }
  public async remove(_table: string, query: Record<string, unknown>): Promise<void> {
    for (let index = this.rows.length - 1; index >= 0; index--)
      if (Object.entries(query).every(([key, value]) => this.rows[index]![key] === value)) this.rows.splice(index, 1);
  }
}

function row(id: string, status: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    content: id,
    scope: "shared",
    channelType: null,
    platform: null,
    guildId: null,
    channelId: null,
    selfId: null,
    userId: null,
    importance: 0.1,
    confidence: 1,
    tags: [],
    status,
    createdAt: 0,
    updatedAt: 0,
    lastAccessedAt: 0,
    accessCount: 0,
    forgottenAt: status === "forgotten" ? 0 : null,
    embedding: null,
    embeddingModel: null,
    ...overrides,
  };
}

describe("MemoryStore.sweep", () => {
  it("soft-forgets low-retention records and removes expired forgotten records only after evidence removal", async () => {
    const model = new Model();
    model.rows.push(row("low", "active"), row("expired", "forgotten"));
    const store = new MemoryStore(model as never);
    const removed: string[] = [];

    await store.sweep(365 * 24 * 60 * 60 * 1_000, { halfLifeDays: 90, forgottenGraceDays: 30, maxActivePerScope: 1000 }, async (id) => removed.push(id));

    expect((await store.get("low"))?.status).toBe("forgotten");
    expect(await store.get("expired")).toBeUndefined();
    expect(removed).toEqual(["expired"]);
  });
});
