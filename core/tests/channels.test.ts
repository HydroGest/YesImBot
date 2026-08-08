import { mkdtemp, rm } from "node:fs/promises";
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
    const shared = { type: "shared", platform: "test", channelId: "room" } as const;
    const direct = { type: "direct", platform: "test", selfId: "bot", channelId: "room" } as const;

    const [first, second] = await Promise.all([channels.get(shared), channels.get(shared)]);

    expect(first).toBe(second);
    expect(await channels.get(direct)).not.toBe(first);
  });
});
