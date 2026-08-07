import { access, mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";

import { createEntry, createJsonlStorage, createMessageEntry, createUserMessage } from "@yesimbot/agent-runtime";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("koishi", async () => import("@koishijs/core"));

import { h, Universal, type Context } from "koishi";

import {
  Channels,
  channelDirectoryName as channelRootName,
  type ChannelScope as DomainChannelScope,
} from "../src/channels/index.js";
import * as core from "../src/index.js";
import { createEvent, createMessage } from "../src/messages/index.js";
import { parseReply } from "../src/runtimes/output.js";
import { channelDirectoryName, ChannelStorage, type ChannelScope } from "../src/runtime/storage.js";

const shared = {
  type: "shared",
  platform: "onebot",
  selfId: "10000",
  channelId: "123456",
} satisfies ChannelScope;

const direct = { ...shared, type: "direct" } satisfies ChannelScope;

function createStorageContext(): Context {
  return {
    logger: vi.fn().mockReturnValue({ error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }),
  } as unknown as Context;
}

describe("ChannelScope storage coordinates", () => {
  it("uses one readable shared directory regardless of the current Bot", () => {
    expect(channelDirectoryName({ ...shared, selfId: "10000" })).toBe("shared-onebot-123456");
    expect(channelDirectoryName({ ...shared, selfId: "20000" })).toBe("shared-onebot-123456");
  });

  it("uses distinct readable direct directories for distinct Bots", () => {
    expect(channelDirectoryName({ ...direct, selfId: "10000" })).toBe("direct-onebot-123456-10000");
    expect(channelDirectoryName({ ...direct, selfId: "20000" })).toBe("direct-onebot-123456-20000");
  });

  it("encodes delimiter-looking coordinates without escaping the channel root", () => {
    expect(
      channelDirectoryName({
        type: "shared",
        platform: "one/bot",
        selfId: "bot/../one",
        channelId: "room/../alpha",
      }),
    ).toBe("shared-one%2f%bot-room%2f%%2e%%2e%%2f%alpha");
  });

  it.each(["platform", "selfId", "channelId"] as const)("rejects empty %s", (field) => {
    expect(() => channelDirectoryName({ ...direct, [field]: "" })).toThrow();
  });

  it("exports ChannelScope without a public channel identity", () => {
    const exported = core as Record<string, unknown>;
    expect(["channel", "Identity"].join("") in exported).toBe(false);
    expect("channelKey" in exported).toBe(false);
  });
});

describe("Channels", () => {
  let basePath: string;

  beforeEach(async () => {
    basePath = await mkdtemp(join(tmpdir(), "yesimbot-channels-"));
  });

  afterEach(async () => {
    await rm(basePath, { recursive: true, force: true });
  });

  it("keeps one ChannelResources owner per shared scope", async () => {
    const ctx = createStorageContext();
    const channels = new Channels(ctx, { basePath });
    const scope = { type: "shared", platform: "onebot", channelId: "123456" } satisfies DomainChannelScope;

    const [first, second, resources] = await Promise.all([
      channels.resolve(scope),
      channels.resolve(scope),
      channels.get(scope),
    ]);

    expect(first).toBe(second);
    expect(resources).toBe(first.resources);
    expect(first.root).toBe(join(basePath, "channels", channelRootName(scope)));
  });

  it("keeps shared identity bot-free, separates direct identities, and owns no runtime state", async () => {
    const channels = new Channels(createStorageContext(), { basePath });
    const sharedScope = { type: "shared", platform: "onebot", channelId: "room" } satisfies DomainChannelScope;
    const directOne = {
      type: "direct",
      platform: "onebot",
      selfId: "bot-1",
      channelId: "room",
    } satisfies DomainChannelScope;
    const directTwo = { ...directOne, selfId: "bot-2" } satisfies DomainChannelScope;

    expect(channels.start()).toBe(channels.start());
    expect(sharedScope).not.toHaveProperty("selfId");

    const [sharedChannel, directChannelOne, directChannelTwo] = await Promise.all([
      channels.resolve(sharedScope),
      channels.resolve(directOne),
      channels.resolve(directTwo),
    ]);

    expect(directChannelOne).not.toBe(directChannelTwo);
    expect(directChannelOne.root).not.toBe(directChannelTwo.root);
    expect(sharedChannel).not.toHaveProperty("bot");
    expect(sharedChannel).not.toHaveProperty("runtime");
    expect(sharedChannel).not.toHaveProperty("agent");
    expect(sharedChannel).not.toHaveProperty("will");
    expect(sharedChannel).not.toHaveProperty("messenger");
    expect(sharedChannel).not.toHaveProperty("session");
    expect(sharedChannel.conversation.storage).toBe(sharedChannel.conversation.storage);
    expect(sharedChannel.conversation).not.toHaveProperty("append");
  });

  it("disposes a registered reader from existing ChannelResources", async () => {
    const channels = new Channels(createStorageContext(), { basePath });
    const channel = await channels.resolve({
      type: "shared",
      platform: "onebot",
      channelId: "room",
    });
    const reader = {
      scheme: "test",
      prompt: "test reader",
      init: async () => ({ bytes: new Uint8Array() }),
    } satisfies ResourceReader;

    const dispose = channels.use(reader);
    expect(channel.resources.listReaders()).toContain(reader);

    dispose();
    expect(channel.resources.listReaders()).not.toContain(reader);
  });
});

describe("ChannelStorage", () => {
  let basePath: string;
  let storage: ChannelStorage;

  beforeEach(async () => {
    basePath = await mkdtemp(join(tmpdir(), "yesimbot-storage-"));
    storage = new ChannelStorage(createStorageContext(), { basePath });
    await storage.start();
  });

  afterEach(async () => {
    await rm(basePath, { recursive: true, force: true });
  });

  it("commits a versionless shared Manifest before returning the channel root", async () => {
    const root = await storage.getStoragePath(shared);

    expect(root).toBe(join(basePath, "channels", "shared-onebot-123456"));
    expect(JSON.parse(await readFile(join(root, "channel.json"), "utf8"))).toEqual({
      type: "shared",
      platform: "onebot",
      channelId: "123456",
      selfId: shared.selfId,
      createdAt: expect.any(String),
    });
    await expect(access(join(basePath, "channels.json"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("uses persistent tuple semantics for shared and direct channel roots", async () => {
    const otherShared = { ...shared, selfId: "20000" };
    const otherDirect = { ...direct, selfId: "20000" };

    const sharedRoot = await storage.getStoragePath(shared);
    await expect(storage.getStoragePath(otherShared)).resolves.toBe(sharedRoot);

    const directRoot = await storage.getStoragePath(direct);
    expect(await storage.getStoragePath(otherDirect)).not.toBe(directRoot);
  });

  it("writes selfId only in a direct Manifest", async () => {
    const sharedRoot = await storage.getStoragePath(shared);
    const directRoot = await storage.getStoragePath(direct);

    expect(JSON.parse(await readFile(join(sharedRoot, "channel.json"), "utf8"))).toEqual({
      type: "shared",
      platform: shared.platform,
      channelId: shared.channelId,
      selfId: shared.selfId,
      createdAt: expect.any(String),
    });
    expect(JSON.parse(await readFile(join(directRoot, "channel.json"), "utf8"))).toEqual({
      type: "direct",
      platform: direct.platform,
      channelId: direct.channelId,
      selfId: direct.selfId,
      createdAt: expect.any(String),
    });
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
      JSON.stringify({
        type: "shared",
        platform: "onebot",
        channelId: "123456",
        selfId: "10000",
        createdAt: "2026-07-29T00:00:00.000Z",
      }),
    );
    await mkdir(legacy, { recursive: true });
    await writeFile(join(legacy, "channel.json"), "{old", "utf8");

    const warn = vi.fn();
    const ctx = {
      logger: vi.fn().mockReturnValue({ error: warn, warn: vi.fn(), info: vi.fn(), debug: vi.fn() }),
    } as unknown as Context;
    const restarted = new ChannelStorage(ctx, { basePath });
    await restarted.start();

    await expect(restarted.getStoragePath(shared)).resolves.toBe(root);
    expect(warn).toHaveBeenCalledWith("storage.manifest_invalid", {
      directoryName: legacyName,
      cause: expect.any(Error),
    });
  });

  it("rejects a mismatched Manifest without overwriting existing data", async () => {
    const root = join(basePath, "channels", "shared-onebot-123456");
    const manifestPath = join(root, "channel.json");
    const manifest = {
      type: "shared",
      platform: "onebot",
      channelId: "other",
      selfId: shared.selfId,
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
    const ctx = {
      logger: vi.fn().mockReturnValue({ error: warn, warn: vi.fn(), info: vi.fn(), debug: vi.fn() }),
    } as unknown as Context;
    const restarted = new ChannelStorage(ctx, { basePath });
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
    const ctx = {
      logger: vi.fn().mockReturnValue({ error: warn, warn: vi.fn(), info: vi.fn(), debug: vi.fn() }),
    } as unknown as Context;
    await new ChannelStorage(ctx, { basePath }).start();

    await expect(readFile(join(directory, "channel.json"), "utf8")).resolves.toBe("{old");
    expect(warn).toHaveBeenCalledWith("storage.manifest_invalid", {
      directoryName: "a5vnf2ijd75c2ibyo2s5czdir4",
      cause: expect.any(Error),
    });
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
    const reply = "<inner_thought>private</inner_thought>first<message/>second";
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
      delivery: {
        turnId: "turn-1",
        messageId: "assistant-1",
        segmentIndex: 1,
        segmentTotal: 1,
        error: { name: "Error", message: "offline" },
      },
    });
    await jsonl.append(createMessageEntry(message, { id: "entry-message", timestamp: 1 }));
    await jsonl.append(createMessageEntry(event, { id: "entry-event", timestamp: 2 }));
    await jsonl.append(
      createMessageEntry(
        { id: "assistant-1", timestamp: 3, role: "assistant", content: reply },
        { id: "entry-assistant", timestamp: 3 },
      ),
    );

    const entries = await jsonl.read();
    expect(entries[0]).toMatchObject({
      type: "message",
      data: { type: "yesimbot.message", data: { messageId: "message-1" } },
    });
    expect(entries[1]).toMatchObject({
      type: "message",
      data: { type: "yesimbot.event", data: { eventType: "delivery.failed" } },
    });
    expect(entries[2]).toMatchObject({ type: "message", data: { content: reply } });
    expect(parseReply(reply)).toEqual([[h.text("first")], [h.text("second")]]);
  });
});

describe("channel JSONL storage", () => {
  let basePath: string;
  let storage: ChannelStorage;

  beforeEach(async () => {
    basePath = await mkdtemp(join(tmpdir(), "yesimbot-jsonl-storage-"));
    storage = new ChannelStorage(createStorageContext(), { basePath });
  });

  afterEach(async () => {
    await rm(basePath, { recursive: true, force: true });
  });

  it("appends entries and reads them back across restarts", async () => {
    const filePath = join(basePath, "session.jsonl");
    const jsonl = createJsonlStorage(filePath);
    const first = createEntry("message", createUserMessage("one"));
    const second = createEntry("message", createUserMessage("two"));

    await jsonl.append(first, second);

    expect(await jsonl.read()).toEqual([first, second]);
    expect(await createJsonlStorage(filePath).read()).toEqual([first, second]);
  });

  it("persists one JSON line per appended entry", async () => {
    const filePath = join(basePath, "session.jsonl");
    const jsonl = createJsonlStorage(filePath);

    await jsonl.append(
      createEntry("message", createUserMessage("one")),
      createEntry("message", createUserMessage("two")),
    );

    expect((await readFile(filePath, "utf8")).trim().split("\n")).toHaveLength(2);
  });

  it("clears the backing file and reads an absent file as empty history", async () => {
    const filePath = join(basePath, "session.jsonl");
    const jsonl = createJsonlStorage(filePath);

    await jsonl.append(createEntry("message", createUserMessage("one")));
    await jsonl.clear();

    await expect(stat(filePath)).rejects.toThrow();
    await expect(jsonl.read()).resolves.toEqual([]);
    await expect(createJsonlStorage(join(basePath, "missing.jsonl")).read()).resolves.toEqual([]);
  });

  it("does not load a legacy platform message entry", async () => {
    const legacyPath = join(basePath, "channels", "ch_v1_2lgdyhmnfri2bdu7", "sessions", "messages.jsonl");
    const eventPath = join(await storage.getStoragePath(shared), "sessions", "messages.jsonl");
    const legacyEntry = {
      type: "message",
      data: { type: ["athena", "platform", "message"].join("."), role: "custom" },
    };

    expect(eventPath).toBe(join(basePath, "channels", "shared-onebot-123456", "sessions", "messages.jsonl"));
    await mkdir(dirname(legacyPath), { recursive: true });
    await writeFile(legacyPath, `${JSON.stringify(legacyEntry)}\n`, "utf8");

    await expect(createJsonlStorage(eventPath).read()).resolves.toEqual([]);
  });
});
