import { access, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ChannelStorage, type ChannelScope } from "../src/channel.js";

const shared = {
  platform: "onebot",
  selfId: "10000",
  channelId: "123456",
  isDirect: false,
} satisfies ChannelScope;

const direct = { ...shared, isDirect: true } satisfies ChannelScope;

describe("ChannelStorage", () => {
  let basePath: string;
  let storage: ChannelStorage;

  beforeEach(async () => {
    basePath = await mkdtemp(join(tmpdir(), "yesimbot-storage-"));
    storage = new ChannelStorage(basePath);
    await storage.start();
  });

  afterEach(async () => {
    await rm(basePath, { recursive: true, force: true });
  });

  it("commits a versionless shared Manifest before returning the channel root", async () => {
    const root = await storage.getStoragePath(shared);

    expect(root).toBe(join(basePath, "channels", "shared-onebot-123456"));
    expect(JSON.parse(await readFile(join(root, "channel.json"), "utf8"))).toEqual({
      platform: "onebot",
      channelId: "123456",
      createdAt: expect.any(String),
    });
    await expect(access(join(basePath, "channels.json"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("uses persistent tuple semantics for shared and direct channel roots", async () => {
    const otherShared = { ...shared, selfId: "20000" };
    const otherDirect = { ...direct, selfId: "20000" };

    await expect(storage.getStoragePath(otherShared)).resolves.toBe(
      await storage.getStoragePath(shared),
    );
    expect(await storage.getStoragePath(otherDirect)).not.toBe(await storage.getStoragePath(direct));
  });

  it("uses collision-free readable names for unsafe raw coordinates", async () => {
    const traversal = { ...shared, platform: "one/bot", channelId: "room/../alpha" };
    const lookalike = { ...shared, platform: "one~2f~bot", channelId: "room~2f~~2e~~2e~alpha" };
    const traversalRoot = await storage.getStoragePath(traversal);
    const lookalikeRoot = await storage.getStoragePath(lookalike);

    expect(traversalRoot).not.toBe(lookalikeRoot);
    expect(relative(join(basePath, "channels"), traversalRoot).startsWith("..")).toBe(false);
    expect(relative(join(basePath, "channels"), lookalikeRoot).startsWith("..")).toBe(false);
  });

  it("scans valid versionless Manifests and ignores legacy directories", async () => {
    const root = join(basePath, "channels", "shared-onebot-123456");
    const legacyName = `v${1}-shared-onebot-123456`;
    const legacy = join(basePath, "channels", legacyName);
    await mkdir(root, { recursive: true });
    await writeFile(
      join(root, "channel.json"),
      JSON.stringify({ platform: "onebot", channelId: "123456", createdAt: "2026-07-29T00:00:00.000Z" }),
    );
    await mkdir(legacy, { recursive: true });
    await writeFile(join(legacy, "channel.json"), "{old", "utf8");

    const warn = vi.fn();
    const restarted = new ChannelStorage(basePath, warn);
    await restarted.start();

    await expect(restarted.getStoragePath(shared)).resolves.toBe(root);
    expect(warn).toHaveBeenCalledWith("storage.directory_invalid", { entry: legacyName });
  });

  it("rejects a mismatched Manifest without overwriting existing data", async () => {
    const root = join(basePath, "channels", "shared-onebot-123456");
    const manifestPath = join(root, "channel.json");
    const manifest = {
      platform: "onebot",
      channelId: "other",
      createdAt: "2026-07-29T00:00:00.000Z",
    };
    await mkdir(root, { recursive: true });
    await writeFile(manifestPath, JSON.stringify(manifest));

    await expect(storage.getStoragePath(shared)).rejects.toThrow(/integrity/i);
    await expect(readFile(manifestPath, "utf8")).resolves.toBe(JSON.stringify(manifest));
  });

  it("rejects a channel root symlink", async () => {
    const root = join(basePath, "channels", "shared-onebot-123456");
    const external = join(basePath, "external");
    await mkdir(external);
    await symlink(external, root);

    await expect(storage.getStoragePath(shared)).rejects.toThrow(/directory|symbolic link/i);
  });
});
