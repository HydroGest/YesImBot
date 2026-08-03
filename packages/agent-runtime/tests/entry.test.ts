import { describe, expect, it } from "vitest";

import { createEntry } from "../src/entry.js";

describe("compact entry", () => {
  it("creates a compact entry with correct type and data", () => {
    const entry = createEntry("compact", {
      summary: "Test summary",
      lastEntryId: "entry-123",
    });
    expect(entry.type).toBe("compact");
    expect(entry.data.summary).toBe("Test summary");
    expect(entry.data.lastEntryId).toBe("entry-123");
    expect(entry.id).toBeDefined();
    expect(entry.timestamp).toBeGreaterThan(0);
  });

  it("supports optional sourceSession field", () => {
    const entry = createEntry("compact", {
      summary: "Archived summary",
      lastEntryId: "entry-456",
      sourceSession: "20260801T090000Z",
    });
    expect(entry.data.sourceSession).toBe("20260801T090000Z");
  });
});
