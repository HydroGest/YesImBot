import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createEntry } from "@yesimbot/agent-runtime";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";

import { registerSessionCommands } from "../src/commands/index.js";
import { Conversation } from "../src/conversations/index.js";

const roots: string[] = [];

afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

describe("session commands", () => {
  it("delegates conversation mutations to Runtimes with a flat shared scope", async () => {
    const commands = new Map<string, { action: Mock }>();
    const ctx = {
      command: vi.fn((name: string) => {
        const command = { subcommand: (child: string) => ctx.command(`${name}${child}`), option: () => command, action: vi.fn(), dispose: vi.fn() };
        commands.set(name, command);
        return command;
      }),
    };
    const runtimes = {
      compact: vi.fn(async () => "ok"),
      archive: vi.fn(async () => "ok"),
      clear: vi.fn(),
      status: vi.fn(async () => "ok"),
      list: vi.fn(async () => "ok"),
    };
    registerSessionCommands(ctx as never, runtimes as never, { authority: 4 });
    const action = commands.get("yesimbot.session.compact")!.action.mock.calls[0]![0];
    await expect(action({ session: { platform: "test", selfId: "bot", channelId: "room", isDirect: false } })).resolves.toBe("ok");
    expect(runtimes.compact).toHaveBeenCalledWith({ type: "shared", platform: "test", channelId: "room" });
  });

  it("lists the active session and switches to a persisted session", async () => {
    const root = await mkdtemp(join(tmpdir(), "yesimbot-session-"));
    roots.push(root);
    const conversation = new Conversation(root);
    await conversation.init();
    await conversation.storage.append(createEntry("message", { id: "m1", timestamp: 1, role: "user", content: "hello" }));
    const first = (await conversation.list()).find((item) => item.isActive)!;

    await conversation.archive(true);
    const second = (await conversation.list()).find((item) => item.isActive)!;
    expect(second.filename).not.toBe(first.filename);
    expect((await conversation.status()).active?.filename).toBe(second.filename);

    await conversation.switch(first.filename);
    expect((await conversation.status()).active?.filename).toBe(first.filename);
    expect(await conversation.storage.read()).toHaveLength(1);
    expect((await conversation.storage.read())[0]).toMatchObject({ type: "message", data: expect.objectContaining({ content: "hello" }) });
  });

  it("rejects invalid session identifiers without changing active storage", async () => {
    const root = await mkdtemp(join(tmpdir(), "yesimbot-session-"));
    roots.push(root);
    const conversation = new Conversation(root);
    await conversation.init();
    const active = (await conversation.status()).active?.filename;
    await expect(conversation.switch("../messages.jsonl")).rejects.toThrow("Invalid session id");
    expect((await conversation.status()).active?.filename).toBe(active);
  });
});
