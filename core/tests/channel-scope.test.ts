import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  createChannelScopeId,
  createChannelScopePath,
  ensureChannelScopeRecord,
  normalizeChannelScope,
  readChannelScopeRecord,
  resolveChannelScope,
  type ChannelScope,
} from "../src/channel.js";

describe("channel scope identity", () => {
  const scope: ChannelScope = {
    platform: "onebot",
    selfId: "bot:1000",
    channelId: "group/2000",
  };

  it("normalizes valid channel scopes without rewriting ids", () => {
    expect(normalizeChannelScope(scope)).toEqual(scope);
  });

  it("rejects empty channel scope fields", () => {
    expect(() => normalizeChannelScope({ ...scope, platform: "" })).toThrow(/platform/);
    expect(() => normalizeChannelScope({ ...scope, selfId: "" })).toThrow(/selfId/);
    expect(() => normalizeChannelScope({ ...scope, channelId: "" })).toThrow(/channelId/);
  });

  it("creates stable compact path-safe ids", () => {
    const id = createChannelScopeId(scope);

    expect(id).toMatch(/^ch_v1_[a-z2-7]{16}$/);
    expect(createChannelScopeId(scope)).toBe(id);
    expect(createChannelScopeId({ ...scope, channelId: "group/2001" })).not.toBe(id);
    expect(id).not.toContain(scope.selfId);
    expect(id).not.toContain(scope.channelId);
  });

  it("creates canonical channel paths", () => {
    const id = createChannelScopeId(scope);

    expect(createChannelScopePath("/tmp/athena", id, "sessions", "messages.jsonl")).toBe(
      join("/tmp/athena", "channels", id, "sessions", "messages.jsonl"),
    );
  });

  it("persists and resolves channel scope metadata", async () => {
    const basePath = await mkdtemp(join(tmpdir(), "athena-channel-scope-"));
    try {
      const record = await ensureChannelScopeRecord(basePath, scope);
      const expectedPath = join(basePath, "channels", record.id, "scope.json");

      expect(record).toMatchObject({
        version: 1,
        id: createChannelScopeId(scope),
        scope,
      });
      expect(JSON.parse(await readFile(expectedPath, "utf8"))).toMatchObject(record);
      await expect(readChannelScopeRecord(basePath, record.id)).resolves.toMatchObject(record);
      await expect(resolveChannelScope(basePath, record.id)).resolves.toEqual(scope);
    } finally {
      await rm(basePath, { recursive: true, force: true });
    }
  });
});
