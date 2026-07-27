import {
  access,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createMessageEntry } from "@yesimbot/agent-runtime";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("koishi", async () => import("@koishijs/core"));

import { h } from "koishi";

import { channelIdentity, type ChannelScope } from "../src/channel/index.js";
import { createEvent, createMessage } from "../src/event/index.js";
import { detectImageMime } from "../src/media/index.js";
import { parseReply } from "../src/reply/parse.js";
import { createJsonlStorage } from "../src/runtime/storage.js";
import { ChannelStorage } from "../src/storage/index.js";

const shared: ChannelScope = {
  platform: "onebot",
  selfId: "10000",
  channelId: "123456",
  isDirect: false,
};

const sharedDirectoryName = "v1-shared-onebot-123456";

describe("detectImageMime", () => {
  it.each([
    [new Uint8Array([0xff, 0xd8, 0xff]), "image/jpeg"],
    [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), "image/png"],
    [new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]), "image/gif"],
    [new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]), "image/webp"],
  ])("recognizes %s byte signatures", (bytes, mime) => {
    expect(detectImageMime(bytes)).toBe(mime);
  });

  it("rejects bytes without an allowed image signature", () => {
    expect(detectImageMime(new Uint8Array([0x3c, 0x73, 0x76, 0x67]))).toBeUndefined();
  });
});

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
    expect(path).toBe(join(basePath, "channels", sharedDirectoryName, "workspace"));

    const manifest = JSON.parse(
      await readFile(join(basePath, "channels", sharedDirectoryName, "channel.json"), "utf8"),
    );
    expect(manifest).toEqual({
      formatVersion: 1,
      identityVersion: 1,
      directoryVersion: 1,
      identity: channelIdentity(shared),
      directoryName: sharedDirectoryName,
      isDirect: false,
      platform: "onebot",
      selfId: null,
      channelId: "123456",
    });

    await expect(access(join(basePath, "channels.json"))).rejects.toMatchObject({ code: "ENOENT" });
    dispose();
  });

  it.each([
    [
      { platform: "one-bot", selfId: "bot", channelId: "room/1", isDirect: false },
      "v1-shared-one_bot-room_1",
    ],
    [
      { platform: "sandbox:node", selfId: "bot-1", channelId: "@Alice", isDirect: true },
      "v1-direct-sandbox_node-_Alice-bot_1",
    ],
    [
      { platform: "A__B", selfId: "bot", channelId: "X--Y😀", isDirect: false },
      "v1-shared-A__B-X__Y_",
    ],
  ] satisfies ReadonlyArray<readonly [ChannelScope, string]>)(
    "uses the readable directory name %#",
    async (scope, directoryName) => {
      const path = await storage.ensure(scope, "sessions");

      expect(path).toBe(join(basePath, "channels", directoryName, "sessions"));
    },
  );

  it("accepts a 200-character directory basename and rejects 201 characters", async () => {
    const prefix = "v1-shared-p-";
    const maxScope = {
      platform: "p",
      selfId: "bot",
      channelId: "x".repeat(200 - prefix.length),
      isDirect: false,
    } satisfies ChannelScope;
    const oversizedScope = { ...maxScope, channelId: `${maxScope.channelId}x` };

    await expect(storage.ensure(maxScope, "sessions")).resolves.toBeDefined();
    await expect(storage.ensure(oversizedScope, "sessions")).rejects.toThrow(/200/);
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

  it("keeps a later namespace registration active when an earlier disposer runs", async () => {
    const disposeFirst = storage.register("workspace");
    disposeFirst();
    storage.register("workspace");

    disposeFirst();

    await expect(storage.ensure(shared, "workspace")).resolves.toBeDefined();
  });

  it.each(["", ".", "..", "/absolute", "a/b", "a\\b", "a\0b", "con", "con.txt", "a:b"])(
    "rejects unsafe segment %j",
    async (segment) => {
      storage.register("workspace");
      await expect(storage.ensure(shared, "workspace", segment)).rejects.toThrow();
    },
  );

  it("scans valid Manifests and preserves their names", async () => {
    const direct: ChannelScope = { ...shared, selfId: "20000", isDirect: true };
    const directDirectoryName = "v1-direct-onebot-123456-20000";
    const manifests = [
      {
        formatVersion: 1,
        identityVersion: 1,
        directoryVersion: 1,
        identity: channelIdentity(shared),
        directoryName: sharedDirectoryName,
        isDirect: false,
        platform: "onebot",
        selfId: null,
        channelId: "123456",
        name: "Room",
      },
      {
        formatVersion: 1,
        identityVersion: 1,
        directoryVersion: 1,
        identity: channelIdentity(direct),
        directoryName: directDirectoryName,
        isDirect: true,
        platform: "onebot",
        selfId: "20000",
        channelId: "123456",
        name: "Direct",
      },
    ];
    for (const manifest of manifests) {
      const root = join(basePath, "channels", manifest.directoryName);
      await mkdir(root, { recursive: true });
      await writeFile(join(root, "channel.json"), `${JSON.stringify(manifest)}\n`, "utf8");
    }

    const restarted = new ChannelStorage(basePath);
    await restarted.start();

    await expect(restarted.ensure(shared, "sessions")).resolves.toBe(
      join(basePath, "channels", sharedDirectoryName, "sessions"),
    );
    await expect(restarted.ensure(direct, "sessions")).resolves.toBe(
      join(basePath, "channels", directDirectoryName, "sessions"),
    );
    await expect(
      readFile(join(basePath, "channels", sharedDirectoryName, "channel.json"), "utf8"),
    ).resolves.toContain('"name":"Room"');
    await expect(
      readFile(join(basePath, "channels", directDirectoryName, "channel.json"), "utf8"),
    ).resolves.toContain('"name":"Direct"');
    await expect(access(join(basePath, "channels.json"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("preserves and excludes a malformed Manifest", async () => {
    const root = join(basePath, "channels", sharedDirectoryName);
    await mkdir(root, { recursive: true });
    await writeFile(join(root, "channel.json"), "{broken", "utf8");

    const warn = vi.fn();
    const restarted = new ChannelStorage(basePath, warn);
    await restarted.start();

    expect(warn).toHaveBeenCalledWith("storage.manifest_invalid", {
      directoryName: sharedDirectoryName,
      cause: expect.any(SyntaxError),
    });
    expect(await readFile(join(root, "channel.json"), "utf8")).toBe("{broken");
  });

  it("rejects an identity mismatch without changing the existing directory data", async () => {
    const manifestPath = join(basePath, "channels", sharedDirectoryName, "channel.json");
    const namespacePath = join(basePath, "channels", sharedDirectoryName, "workspace", "keep.txt");
    const mismatchedManifest = {
      formatVersion: 1,
      identityVersion: 1,
      directoryVersion: 1,
      identity: channelIdentity({ ...shared, channelId: "other" }),
      directoryName: sharedDirectoryName,
      isDirect: false,
      platform: "onebot",
      selfId: null,
      channelId: "123456",
    };
    await mkdir(join(basePath, "channels", sharedDirectoryName, "workspace"), { recursive: true });
    await writeFile(manifestPath, `${JSON.stringify(mismatchedManifest)}\n`, "utf8");
    await writeFile(namespacePath, "keep", "utf8");

    storage.register("workspace");
    await expect(storage.ensure(shared, "workspace")).rejects.toThrow(/integrity|identity/i);
    await expect(readFile(manifestPath, "utf8")).resolves.toBe(
      `${JSON.stringify(mismatchedManifest)}\n`,
    );
    await expect(readFile(namespacePath, "utf8")).resolves.toBe("keep");
  });

  it("preserves old hash directories without reading them as current storage", async () => {
    const oldDirectory = join(basePath, "channels", "a5vnf2ijd75c2ibyo2s5czdir4");
    await mkdir(oldDirectory, { recursive: true });
    await writeFile(join(oldDirectory, "channel.json"), "{old", "utf8");

    const warn = vi.fn();
    const restarted = new ChannelStorage(basePath, warn);
    await restarted.start();

    expect(await readFile(join(oldDirectory, "channel.json"), "utf8")).toBe("{old");
    expect(warn).toHaveBeenCalledWith("storage.directory_invalid", {
      entry: "a5vnf2ijd75c2ibyo2s5czdir4",
    });
  });

  it("retains closed input payloads and raw private reply text in JSONL", async () => {
    const sessions = await storage.ensure(shared, "sessions");
    const jsonl = createJsonlStorage(join(sessions, "messages.jsonl"));
    const rawReply = "<inner_thought>private reasoning</inner_thought>first<sep/>second";
    const message = createMessage({
      schemaVersion: 3,
      platform: shared.platform,
      selfId: shared.selfId,
      channel: { id: shared.channelId },
      user: { id: "user-1" },
      messageId: "message-1",
      elements: [],
      timestamp: 1,
    });
    const event = createEvent({
      schemaVersion: 3,
      platform: shared.platform,
      selfId: shared.selfId,
      channel: { id: shared.channelId },
      eventType: "delivery.failed",
      text: "Delivery failed",
      timestamp: 2,
      delivery: {
        turnId: "turn-1",
        messageId: "assistant-1",
        segmentIndex: 1,
        segmentTotal: 1,
        error: { name: "Error", message: "offline" },
      },
    });
    const assistant = {
      id: "assistant-1",
      timestamp: 3,
      role: "assistant" as const,
      content: rawReply,
    };

    await jsonl.append(createMessageEntry(message, { id: "entry-message", timestamp: 1 }));
    await jsonl.append(createMessageEntry(event, { id: "entry-event", timestamp: 2 }));
    await jsonl.append(createMessageEntry(assistant, { id: "entry-assistant", timestamp: 3 }));

    const entries = await jsonl.read();
    const storedMessage = entries[0]?.type === "message" ? entries[0].data : undefined;
    const storedEvent = entries[1]?.type === "message" ? entries[1].data : undefined;
    const storedAssistant = entries[2]?.type === "message" ? entries[2].data : undefined;
    expect(storedMessage).toMatchObject({
      type: "yesimbot.message",
      data: { messageId: "message-1" },
    });
    expect(storedEvent).toMatchObject({
      type: "yesimbot.event",
      data: { eventType: "delivery.failed" },
    });
    expect(storedAssistant).toMatchObject({ content: rawReply });
    expect(parseReply(rawReply)).toEqual([[h.text("first")], [h.text("second")]]);
  });

  it("preserves and reports unknown namespace directories during startup", async () => {
    const sessions = await storage.ensure(shared, "sessions");
    const unknown = join(sessions, "..", "unknown-module");
    await mkdir(unknown);
    await writeFile(join(unknown, "keep.txt"), "keep", "utf8");

    const warn = vi.fn();
    const restarted = new ChannelStorage(basePath, warn);
    await restarted.start();

    expect(await readFile(join(unknown, "keep.txt"), "utf8")).toBe("keep");
    expect(warn).toHaveBeenCalledWith("storage.namespace_unregistered", {
      directoryName: sharedDirectoryName,
      namespace: "unknown-module",
    });
  });

  it("refreshes only non-empty names", async () => {
    storage.register("workspace");
    await storage.ensure(shared, "workspace");
    await storage.updateName(shared, "Room 123456");
    await storage.updateName(shared, "");

    expect(
      JSON.parse(
        await readFile(join(basePath, "channels", sharedDirectoryName, "channel.json"), "utf8"),
      ),
    ).toEqual(expect.objectContaining({ name: "Room 123456" }));
  });

  it("rejects a pre-existing symlink as a key directory", async () => {
    const keyPath = join(basePath, "channels", sharedDirectoryName);
    const fakePath = join(basePath, "external-target");
    await mkdir(fakePath, { recursive: true });
    // Remove the real directory (created by start()) and replace with symlink
    await rm(keyPath, { recursive: true, force: true });
    await symlink(fakePath, keyPath);

    const warn = vi.fn();
    const symStorage = new ChannelStorage(basePath, warn);
    await symStorage.start();
    symStorage.register("workspace");
    await expect(symStorage.ensure(shared, "workspace")).rejects.toThrow(/symbolic link/i);
  });

  it("rejects a symlink as a registered namespace root", async () => {
    storage.register("workspace");
    await storage.ensure(shared, "workspace");
    // Replace the namespace directory with a symlink
    const nsPath = join(basePath, "channels", sharedDirectoryName, "workspace");
    const external = join(basePath, "external-target");
    await mkdir(external, { recursive: true });
    await rm(nsPath, { recursive: true, force: true });
    await symlink(external, nsPath);

    await expect(storage.ensure(shared, "workspace", "test.txt")).rejects.toThrow(/symbolic link/i);
  });

  it("rejects an existing symlink as an intermediate path segment", async () => {
    storage.register("workspace");
    const basePath = await storage.ensure(shared, "workspace");
    const nested = join(basePath, "nested");
    const external = join(basePath, "..", "external-target");
    await mkdir(external, { recursive: true });
    await symlink(external, nested);

    await expect(storage.ensure(shared, "workspace", "nested", "file.txt")).rejects.toThrow(
      /symbolic link/i,
    );
  });

  it("rejects an existing symlink as the final path segment", async () => {
    storage.register("workspace");
    const basePath = await storage.ensure(shared, "workspace");
    const leaf = join(basePath, "leaf.txt");
    const external = join(basePath, "..", "external-file");
    await writeFile(external, "data");
    await symlink(external, leaf);

    await expect(storage.ensure(shared, "workspace", "leaf.txt")).rejects.toThrow(/symbolic link/i);
  });

  it("rejects a key-directory symlink before creating the namespace root externally", async () => {
    // Create a valid channel and a workspace namespace within it
    storage.register("workspace");
    await storage.ensure(shared, "workspace");

    // Replace the key directory with a symlink to an empty external path
    const keyDir = join(basePath, "channels", sharedDirectoryName);
    const external = join(basePath, "external-storage");
    await mkdir(external, { recursive: true });
    await rm(keyDir, { recursive: true, force: true });
    await symlink(external, keyDir);

    // Register a namespace that doesn't exist yet. ensure() must reject
    // BEFORE mkdir creates it under the external target.
    storage.register("external-ns");
    await expect(storage.ensure(shared, "external-ns")).rejects.toThrow(/symbolic link/i);
    // The external directory must not contain the namespace
    expect(await readdir(external)).not.toContain("external-ns");
  });
});
