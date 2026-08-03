import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createAgentChannel, createMemoryStorage, createPluginHost, createStateManager } from "@yesimbot/agent-runtime";
import type { Context } from "koishi";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("koishi", async () => import("@koishijs/core"));

import RoleplayPlugin from "../src/index.js";

const roots: string[] = [];

function createPng(card: unknown): Buffer {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const data = Buffer.from(`ccv3\0${Buffer.from(JSON.stringify(card)).toString("base64")}`);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  return Buffer.concat([signature, length, Buffer.from("tEXt"), data, Buffer.alloc(4)]);
}

async function createCardFile(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "yesimbot-roleplay-plugin-"));
  roots.push(root);
  const path = join(root, "card.png");
  await writeFile(
    path,
    createPng({
      spec: "chara_card_v3",
      spec_version: "3.0",
      data: {
        name: "Athena",
        description: "",
        personality: "",
        scenario: "",
        first_mes: "First {{user}}",
        mes_example: "",
        alternate_greetings: ["Alternate {{user}}"],
        group_only_greetings: [],
        character_version: "1",
        creator_notes: "",
        system_prompt: "",
        post_history_instructions: "",
        tags: [],
        creator: "",
        extensions: {},
      },
    }),
  );
  return path;
}

async function greeting(plugin: Parameters<typeof createPluginHost>[0]["plugins"][number]): Promise<string> {
  const storage = createMemoryStorage();
  const channel = createAgentChannel();
  const state = createStateManager({ storage });
  const host = createPluginHost({ plugins: [plugin], runtime: { id: "channel", channel, state, storage } });
  await host.init();
  const [entry] = await storage.read();
  if (entry?.type !== "message" || entry.data.role !== "assistant" || typeof entry.data.content !== "string") {
    throw new Error("Expected an assistant greeting");
  }
  return entry.data.content;
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

describe("RoleplayPlugin", () => {
  it("chooses one random greeting for the card snapshot and renders scope-specific users", async () => {
    const path = await createCardFile();
    const factories: Array<(context: { scope: { type: "direct" | "shared"; channelId: string } }) => unknown> = [];
    const ctx = {
      baseDir: join(path, ".."),
      logger: vi.fn(() => ({ error: vi.fn(), info: vi.fn(), success: vi.fn() })),
      on: vi.fn(),
      yesimbot: {
        registerChannelPlugin: vi.fn((factory) => {
          factories.push(factory);
          return vi.fn();
        }),
      },
    } as unknown as Context;
    vi.spyOn(Math, "random").mockReturnValue(0.99);
    const plugin = new RoleplayPlugin(ctx, { characterCard: "card.png", useRandomGreeting: true });

    await plugin.start();

    const direct = await factories[0]!({ scope: { type: "direct", channelId: "direct-user" } });
    const shared = await factories[0]!({ scope: { type: "shared", channelId: "group" } });

    await expect(greeting(direct as never)).resolves.toBe("Alternate direct-user");
    await expect(greeting(shared as never)).resolves.toBe("Alternate User");
    expect(Math.random).toHaveBeenCalledOnce();
  });
});
