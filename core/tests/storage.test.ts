import { access, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";

import { createMessageEntry } from "@yesimbot/agent-runtime";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("koishi", async () => import("@koishijs/core"));

import { h, Universal } from "koishi";

import { ChannelStorage, type ChannelScope } from "../src/channel.js";
import { createEvent, createMessage } from "../src/input.js";
import { detectImageMime } from "../src/media/index.js";
import { parseReply } from "../src/runtime/reply.js";
import { createJsonlStorage } from "../src/runtime/storage.js";

const shared = {
  platform: "onebot",
  selfId: "10000",
  channelId: "123456",
  isDirect: false,
} satisfies ChannelScope;

const direct = { ...shared, isDirect: true } satisfies ChannelScope;

describe("detectImageMime", () => {
  it.each([
    [new Uint8Array([0xff, 0xd8, 0xff]), "image/jpeg"],
    [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), "image/png"],
    [new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]), "image/gif"],
    [new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]), "image/webp"],
  ])("recognizes allowed image signatures", (bytes, mime) => {
    expect(detectImageMime(bytes)).toBe(mime);
  });

  it("rejects unsupported bytes", () => {
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

  it("writes selfId only in a direct Manifest", async () => {
    const sharedRoot = await storage.getStoragePath(shared);
    const directRoot = await storage.getStoragePath(direct);

    expect(JSON.parse(await readFile(join(sharedRoot, "channel.json"), "utf8"))).toEqual({
      platform: shared.platform,
      channelId: shared.channelId,
      createdAt: expect.any(String),
    });
    expect(JSON.parse(await readFile(join(directRoot, "channel.json"), "utf8"))).toEqual({
      platform: direct.platform,
      channelId: direct.channelId,
      selfId: direct.selfId,
      createdAt: expect.any(String),
    });
  });

  it("accepts a 200-character basename and rejects 201 characters", async () => {
    const prefix = "shared-p-";
    const maximum = {
      platform: "p",
      selfId: "bot",
      channelId: "x".repeat(200 - prefix.length),
      isDirect: false,
    } satisfies ChannelScope;

    await expect(storage.getStoragePath(maximum)).resolves.toBeDefined();
    await expect(storage.getStoragePath({ ...maximum, channelId: `${maximum.channelId}x` })).rejects.toThrow(/200/);
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

  it("warns about and preserves a malformed current Manifest", async () => {
    const root = join(basePath, "channels", "shared-onebot-123456");
    await mkdir(root, { recursive: true });
    await writeFile(join(root, "channel.json"), "{broken", "utf8");

    const warn = vi.fn();
    const restarted = new ChannelStorage(basePath, warn);
    await restarted.start();

    expect(warn).toHaveBeenCalledWith("storage.manifest_invalid", {
      directoryName: "shared-onebot-123456",
      cause: expect.any(SyntaxError),
    });
    await expect(readFile(join(root, "channel.json"), "utf8")).resolves.toBe("{broken");
  });

  it("preserves an old hash directory without reading it", async () => {
    const directory = join(basePath, "channels", "a5vnf2ijd75c2ibyo2s5czdir4");
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, "channel.json"), "{old", "utf8");

    const warn = vi.fn();
    await new ChannelStorage(basePath, warn).start();

    await expect(readFile(join(directory, "channel.json"), "utf8")).resolves.toBe("{old");
    expect(warn).toHaveBeenCalledWith("storage.directory_invalid", { entry: "a5vnf2ijd75c2ibyo2s5czdir4" });
  });

  it("rejects a channel root symlink", async () => {
    const root = join(basePath, "channels", "shared-onebot-123456");
    const external = join(basePath, "external");
    await mkdir(external);
    await symlink(external, root);

    await expect(storage.getStoragePath(shared)).rejects.toThrow(/directory|symbolic link/i);
  });

  it("round-trips Message, Event, and raw assistant reply JSONL entries", async () => {
    const root = await storage.getStoragePath(shared);
    const jsonl = createJsonlStorage(join(root, "sessions", "messages.jsonl"));
    const reply = "<inner_thought>private</inner_thought>first<sep/>second";
    const message = createMessage({
      platform: shared.platform,
      selfId: shared.selfId,
      channel: { id: shared.channelId, type: Universal.Channel.Type.TEXT },
      user: { id: "user-1" },
      messageId: "message-1",
      elements: [],
      timestamp: 1,
    });
    const event = createEvent({
      platform: shared.platform,
      selfId: shared.selfId,
      channel: { id: shared.channelId, type: Universal.Channel.Type.TEXT },
      eventType: "delivery.failed",
      text: "Delivery failed",
      timestamp: 2,
      delivery: { turnId: "turn-1", messageId: "assistant-1", segmentIndex: 1, segmentTotal: 1, error: { name: "Error", message: "offline" } },
    });
    await jsonl.append(createMessageEntry(message, { id: "entry-message", timestamp: 1 }));
    await jsonl.append(createMessageEntry(event, { id: "entry-event", timestamp: 2 }));
    await jsonl.append(createMessageEntry({ id: "assistant-1", timestamp: 3, role: "assistant", content: reply }, { id: "entry-assistant", timestamp: 3 }));

    const entries = await jsonl.read();
    expect(entries[0]).toMatchObject({ type: "message", data: { type: "yesimbot.message", data: { messageId: "message-1" } } });
    expect(entries[1]).toMatchObject({ type: "message", data: { type: "yesimbot.event", data: { eventType: "delivery.failed" } } });
    expect(entries[2]).toMatchObject({ type: "message", data: { content: reply } });
    expect(parseReply(reply)).toEqual([[h.text("first")], [h.text("second")]]);
  });
});
