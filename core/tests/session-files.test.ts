import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  formatSessionTimestamp,
  resolveActiveSession,
  createNewSession,
  listSessions,
  migrateOldSession,
} from "../src/runtime/session-files.js";

describe("formatSessionTimestamp", () => {
  it("formats a date as YYYYMMDDTHHmmssZ", () => {
    const date = new Date("2026-08-03T14:30:22.000Z");
    expect(formatSessionTimestamp(date)).toBe("20260803T143022Z");
  });
});

describe("resolveActiveSession", () => {
  let dir: string;

  beforeEach(async () => {
    dir = join(tmpdir(), `session-test-${Date.now()}`);
    await fs.mkdir(dir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("returns null for empty directory", async () => {
    expect(await resolveActiveSession(dir)).toBeNull();
  });

  it("returns the lexicographically largest .jsonl file", async () => {
    await fs.writeFile(join(dir, "20260801T090000Z.jsonl"), "");
    await fs.writeFile(join(dir, "20260803T143022Z.jsonl"), "");
    await fs.writeFile(join(dir, "20260802T120000Z.jsonl"), "");
    const result = await resolveActiveSession(dir);
    expect(result).toBe(join(dir, "20260803T143022Z.jsonl"));
  });

  it("ignores non-jsonl files", async () => {
    await fs.writeFile(join(dir, "20260803T143022Z.jsonl"), "");
    await fs.writeFile(join(dir, "sessions.json"), "");
    await fs.writeFile(join(dir, "README.md"), "");
    const result = await resolveActiveSession(dir);
    expect(result).toBe(join(dir, "20260803T143022Z.jsonl"));
  });
});

describe("createNewSession", () => {
  let dir: string;

  beforeEach(async () => {
    dir = join(tmpdir(), `session-test-${Date.now()}`);
    await fs.mkdir(dir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("creates a new .jsonl file with timestamp name", async () => {
    const path = await createNewSession(dir);
    expect(path).toMatch(/\/\d{8}T\d{6}Z\.jsonl$/);
    const stat = await fs.stat(path);
    expect(stat.isFile()).toBe(true);
  });
});

describe("listSessions", () => {
  let dir: string;

  beforeEach(async () => {
    dir = join(tmpdir(), `session-test-${Date.now()}`);
    await fs.mkdir(dir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("lists sessions in descending order with active marker", async () => {
    await fs.writeFile(join(dir, "20260801T090000Z.jsonl"), '{"id":"a"}\n');
    await fs.writeFile(join(dir, "20260803T143022Z.jsonl"), '{"id":"b"}\n{"id":"c"}\n');
    const sessions = await listSessions(dir);
    expect(sessions).toHaveLength(2);
    expect(sessions[0].filename).toBe("20260803T143022Z.jsonl");
    expect(sessions[0].isActive).toBe(true);
    expect(sessions[1].filename).toBe("20260801T090000Z.jsonl");
    expect(sessions[1].isActive).toBe(false);
  });
});

describe("migrateOldSession", () => {
  let dir: string;

  beforeEach(async () => {
    dir = join(tmpdir(), `session-test-${Date.now()}`);
    await fs.mkdir(dir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("renames messages.jsonl using first entry timestamp", async () => {
    const content = '{"id":"x","timestamp":1722470400000,"type":"message","data":{}}\n';
    await fs.writeFile(join(dir, "messages.jsonl"), content);
    const mockLogger = { error: () => {} };
    await migrateOldSession(dir, mockLogger);
    const files = await fs.readdir(dir);
    expect(files).not.toContain("messages.jsonl");
    expect(files.some((f) => f.endsWith(".jsonl") && f !== "messages.jsonl")).toBe(true);
  });

  it("does nothing if messages.jsonl does not exist", async () => {
    const mockLogger = { error: () => {} };
    await migrateOldSession(dir, mockLogger);
    const files = await fs.readdir(dir);
    expect(files).toHaveLength(0);
  });
});
