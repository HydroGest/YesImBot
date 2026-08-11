import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Context } from "@koishijs/core";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("koishi", async () => import("@koishijs/core"));

import { Channels } from "../src/channels/index.js";

const roots: string[] = [];

afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

describe("Channels", () => {
  it("keeps one stable resources owner for each canonical scope", async () => {
    const root = await mkdtemp(join(tmpdir(), "yesimbot-channels-"));
    roots.push(root);
    const channels = new Channels(new Context(), { basePath: root });
    const shared = { type: "guild", platform: "test", channelId: "room", guildId: "room" } as const;
    const direct = { type: "direct", platform: "test", selfId: "bot", channelId: "room" } as const;

    const [first, second] = await Promise.all([channels.get(shared), channels.get(shared)]);

    expect(first).toBe(second);
    expect(await channels.get(direct)).not.toBe(first);
  });
  it("passes image input and read timeout to newly created resources", async () => {
    const root = await mkdtemp(join(tmpdir(), "yesimbot-channels-config-"));
    roots.push(root);
    const channels = new Channels(new Context(), { basePath: root, imageInput: true, readTimeoutMs: 5 });
    channels.use({
      scheme: "slow",
      prompt: "slow reader",
      setup: async (_resources, _uri, { signal }) =>
        new Promise<never>((_resolve, reject) => signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true })),
    });
    const resources = await channels.get({ type: "guild", platform: "test", channelId: "room", guildId: "room" });

    expect(resources.imageInput).toBe(true);
    await expect(resources.open("slow:///file")).resolves.toBeUndefined();
  });
  it("migrates a legacy shared guild directory during startup", async () => {
    const root = await mkdtemp(join(tmpdir(), "yesimbot-channels-legacy-guild-"));
    roots.push(root);
    const legacyRoot = join(root, "channels", "shared-onebot-101");
    await mkdir(legacyRoot, { recursive: true });
    await Promise.all([
      writeFile(join(legacyRoot, "channel.json"), '{"type":"shared","platform":"onebot","channelId":"101","createdAt":"2026-08-01T00:00:00.000Z"}\n'),
      writeFile(join(legacyRoot, "legacy.txt"), "legacy guild data\n"),
    ]);

    const channels = new Channels(new Context(), { basePath: root });
    await channels.start();
    const channel = await channels.resolve({ type: "guild", platform: "onebot", channelId: "101", guildId: "101" });
    const canonicalRoot = join(root, "channels", "guild-onebot-101");

    expect(channel.root).toBe(canonicalRoot);
    await expect(readFile(join(canonicalRoot, "legacy.txt"), "utf8")).resolves.toBe("legacy guild data\n");
    await expect(readFile(join(legacyRoot, "legacy.txt"), "utf8")).rejects.toThrow();
    expect(JSON.parse(await readFile(join(canonicalRoot, "channel.json"), "utf8"))).toMatchObject({
      type: "guild",
      platform: "onebot",
      channelId: "101",
      guildId: "101",
      createdAt: "2026-08-01T00:00:00.000Z",
    });
  });

  it("migrates a legacy shared channel directory during startup", async () => {
    const root = await mkdtemp(join(tmpdir(), "yesimbot-channels-legacy-channel-"));
    roots.push(root);
    const legacyRoot = join(root, "channels", "shared-onebot-101");
    await mkdir(legacyRoot, { recursive: true });
    await Promise.all([
      writeFile(
        join(legacyRoot, "channel.json"),
        '{"type":"shared","platform":"onebot","channelId":"101","guildId":"202","createdAt":"2026-08-01T00:00:00.000Z"}\n',
      ),
      writeFile(join(legacyRoot, "legacy.txt"), "legacy channel data\n"),
    ]);

    const channels = new Channels(new Context(), { basePath: root });
    await channels.start();
    const channel = await channels.resolve({ type: "channel", platform: "onebot", channelId: "101", guildId: "202" });
    const canonicalRoot = join(root, "channels", "channel-onebot-202-101");

    expect(channel.root).toBe(canonicalRoot);
    await expect(readFile(join(canonicalRoot, "legacy.txt"), "utf8")).resolves.toBe("legacy channel data\n");
    await expect(readFile(join(legacyRoot, "legacy.txt"), "utf8")).rejects.toThrow();
    expect(JSON.parse(await readFile(join(canonicalRoot, "channel.json"), "utf8"))).toMatchObject({
      type: "channel",
      platform: "onebot",
      channelId: "101",
      guildId: "202",
      createdAt: "2026-08-01T00:00:00.000Z",
    });
  });

  it("refuses a legacy migration when its canonical directory already exists", async () => {
    const root = await mkdtemp(join(tmpdir(), "yesimbot-channels-legacy-conflict-"));
    roots.push(root);
    const legacyRoot = join(root, "channels", "shared-onebot-101");
    const canonicalRoot = join(root, "channels", "guild-onebot-101");
    await Promise.all([mkdir(legacyRoot, { recursive: true }), mkdir(canonicalRoot, { recursive: true })]);
    await Promise.all([
      writeFile(join(legacyRoot, "channel.json"), '{"type":"shared","platform":"onebot","channelId":"101","createdAt":"2026-08-01T00:00:00.000Z"}\n'),
      writeFile(join(legacyRoot, "legacy.txt"), "legacy data\n"),
      writeFile(
        join(canonicalRoot, "channel.json"),
        '{"type":"guild","platform":"onebot","channelId":"101","guildId":"101","createdAt":"2026-08-02T00:00:00.000Z"}\n',
      ),
      writeFile(join(canonicalRoot, "current.txt"), "current data\n"),
    ]);

    const channels = new Channels(new Context(), { basePath: root });

    await expect(channels.start()).rejects.toThrow(/migration destination already exists/i);
    await expect(readFile(join(legacyRoot, "legacy.txt"), "utf8")).resolves.toBe("legacy data\n");
    await expect(readFile(join(canonicalRoot, "current.txt"), "utf8")).resolves.toBe("current data\n");
  });
});
