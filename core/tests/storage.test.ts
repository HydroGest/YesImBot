import { mkdir, mkdtemp, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("koishi", async () => import("@koishijs/core"));

import type { ChannelScope } from "../src/channel/index.js";
import { ChannelStorage } from "../src/storage/index.js";

const shared: ChannelScope = {
  platform: "onebot",
  selfId: "10000",
  channelId: "123456",
  isDirect: false,
};

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

  it("commits a channel Manifest before returning a namespace path", async () => {
    const dispose = storage.register("workspace");
    const path = await storage.ensure(shared, "workspace");
    expect(path).toBe(join(basePath, "channels", "a5vnf2ijd75c2ibyo2s5czdir4", "workspace"));

    const manifest = JSON.parse(await readFile(join(
      basePath,
      "channels",
      "a5vnf2ijd75c2ibyo2s5czdir4",
      "channel.json",
    ), "utf8"));
    expect(manifest).toEqual({
      formatVersion: 1,
      keyVersion: 1,
      key: "a5vnf2ijd75c2ibyo2s5czdir4",
      isDirect: false,
      platform: "onebot",
      selfId: null,
      channelId: "123456",
    });

    const catalog = JSON.parse(await readFile(join(basePath, "channels.json"), "utf8"));
    expect(catalog.channels).toEqual([manifest]);
    dispose();
  });

  it.each(["", "Workspace", "a/../b", "con", "name-"])(
    "rejects invalid namespace %j",
    (namespace) => expect(() => storage.register(namespace)).toThrow(),
  );

  it("rejects duplicate namespace registration without deleting data", () => {
    const dispose = storage.register("workspace");
    expect(() => storage.register("workspace")).toThrow("already registered");
    dispose();
    expect(() => storage.register("workspace")).not.toThrow();
  });

  it.each(["", ".", "..", "/absolute", "a/b", "a\\b", "a\0b", "con", "con.txt", "a:b"])(
    "rejects unsafe segment %j",
    async (segment) => {
      storage.register("workspace");
      await expect(storage.ensure(shared, "workspace", segment)).rejects.toThrow();
    },
  );

  it("rebuilds a missing Catalog from valid Manifests", async () => {
    storage.register("workspace");
    await storage.ensure(shared, "workspace");
    await unlink(join(basePath, "channels.json"));

    const restarted = new ChannelStorage(basePath);
    await restarted.start();

    const catalog = JSON.parse(await readFile(join(basePath, "channels.json"), "utf8"));
    expect(catalog.channels).toEqual([
      expect.objectContaining({ key: "a5vnf2ijd75c2ibyo2s5czdir4" }),
    ]);
  });

  it("preserves and excludes a malformed Manifest", async () => {
    const key = "a5vnf2ijd75c2ibyo2s5czdir4";
    const root = join(basePath, "channels", key);
    await mkdir(root, { recursive: true });
    await writeFile(join(root, "channel.json"), "{broken", "utf8");

    const restarted = new ChannelStorage(basePath);
    await restarted.start();

    expect(restarted.list()).toEqual([]);
    expect(await readFile(join(root, "channel.json"), "utf8")).toBe("{broken");
  });

  it("rejects an identity mismatch in an existing Key directory", async () => {
    storage.register("workspace");
    await storage.ensure(shared, "workspace");
    const path = join(
      basePath,
      "channels",
      "a5vnf2ijd75c2ibyo2s5czdir4",
      "channel.json",
    );
    const manifest = JSON.parse(await readFile(path, "utf8"));
    await writeFile(path, `${JSON.stringify({ ...manifest, channelId: "other" }, null, 2)}\n`);

    const restarted = new ChannelStorage(basePath);
    await restarted.start();
    restarted.register("workspace");
    await expect(restarted.ensure(shared, "workspace")).rejects.toThrow(/integrity|identity/i);
  });

  it("sorts Catalog records by ASCII Key", async () => {
    storage.register("workspace");
    await storage.ensure(shared, "workspace");
    await storage.ensure({ ...shared, selfId: "20000", isDirect: true }, "workspace");

    const catalog = JSON.parse(await readFile(join(basePath, "channels.json"), "utf8"));
    const keys = catalog.channels.map((record: { key: string }) => record.key);
    expect(keys).toEqual([...keys].sort());
  });

  it("preserves unknown namespace directories", async () => {
    storage.register("workspace");
    const workspace = await storage.ensure(shared, "workspace");
    const unknown = join(workspace, "..", "unknown-module");
    await mkdir(unknown);
    await writeFile(join(unknown, "keep.txt"), "keep", "utf8");

    const restarted = new ChannelStorage(basePath);
    await restarted.start();

    expect(await readFile(join(unknown, "keep.txt"), "utf8")).toBe("keep");
  });

  it("shares one startup scan across concurrent callers", async () => {
    const pending = new ChannelStorage(basePath);
    await Promise.all([pending.start(), pending.start(), pending.start()]);
    expect(pending.list()).toEqual([]);
  });

  it("returns frozen filtered records and refreshes only non-empty names", async () => {
    storage.register("workspace");
    await storage.ensure(shared, "workspace");
    await storage.updateName(shared, "Room 123456");
    await storage.updateName(shared, "");

    const records = storage.list({ platform: "onebot", name: "Room 123456" });
    expect(records).toEqual([expect.objectContaining({ key: "a5vnf2ijd75c2ibyo2s5czdir4" })]);
    expect(Object.isFrozen(records[0])).toBe(true);
    expect(JSON.parse(await readFile(join(basePath, "channels.json"), "utf8")).channels[0])
      .toEqual(expect.objectContaining({ name: "Room 123456" }));
  });
});
