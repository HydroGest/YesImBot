import { h } from "koishi";
import { describe, expect, it, vi } from "vitest";

vi.mock("koishi", async () => {
  const { default: h } = await import("@satorijs/element");
  return { h };
});

import { CommandExecution } from "../src/execution.js";
import type { CommandActor, InteractiveMode } from "../src/types.js";

type FakeSession = {
  bot: { sendMessage: (...args: unknown[]) => Promise<string[]> };
  execute: (command: string, next?: unknown) => Promise<unknown>;
  send: (fragment: unknown) => Promise<string[]>;
  sendQueued: (fragment: unknown) => Promise<string[]>;
  prompt: () => Promise<string | undefined>;
  observeUser: (fields: readonly string[]) => Promise<{ authority: number; permissions: string[] }>;
};

type Element = ReturnType<typeof h.normalize>[number];

function createFakeBot(session: FakeSession) {
  const bot = { platform: "test", selfId: "bot", sendMessage: vi.fn(async () => []), session: vi.fn(() => session) };
  session.bot = bot;
  return bot;
}

function createOptions(overrides: {
  command?: string;
  actor?: CommandActor;
  interactive?: InteractiveMode;
  session: FakeSession;
  bot?: ReturnType<typeof createFakeBot>;
  persistElements?: (elements: readonly Element[]) => Promise<Element[]>;
}) {
  return {
    id: "exec-1",
    command: overrides.command ?? "echo",
    bot: (overrides.bot ?? createFakeBot(overrides.session)) as never,
    scope: { type: "shared" as const, platform: "test", channelId: "room" },
    actor: overrides.actor ?? { kind: "agent" as const },
    interactive: overrides.interactive ?? "reject",
    timeoutMs: 1000,
    maxTranscriptChars: 1000,
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn() },
    ...(overrides.persistElements === undefined ? {} : { persistElements: overrides.persistElements }),
  };
}

describe("CommandExecution", () => {
  it("captures command output and return value without sending", async () => {
    const session: FakeSession = {
      execute: async () => {
        await session.send(h.text("partial"));
        return [h.text("done")];
      },
      send: vi.fn(async () => []),
      sendQueued: vi.fn(async () => []),
      prompt: vi.fn(async () => undefined),
      observeUser: vi.fn(async () => ({ authority: 0, permissions: [] })),
    };
    const execution = new CommandExecution(createOptions({ session }));
    execution.start();

    const event = await execution.next();
    expect(event.status).toBe("done");
    expect(event.transcript).toContain("partial");
    expect(event.returnValue).toContain("done");
  });

  it("captures direct bot.sendMessage output", async () => {
    const session: FakeSession = {
      bot: undefined as never,
      execute: async () => {
        await session.bot.sendMessage("room", h.text("direct"));
        return [];
      },
      send: vi.fn(async () => []),
      sendQueued: vi.fn(async () => []),
      prompt: vi.fn(async () => undefined),
      observeUser: vi.fn(async () => ({ authority: 0, permissions: [] })),
    };
    const execution = new CommandExecution(createOptions({ session }));
    execution.start();

    const event = await execution.next();
    expect(event.status).toBe("done");
    expect(event.transcript).toContain("direct");
  });

  it("renders captured output images through the core asset projection", async () => {
    const assetId = "a".repeat(32);
    const session: FakeSession = {
      execute: async () => {
        await session.send(h("img", { src: "data:image/png;base64,AA==" }));
        return [];
      },
      send: vi.fn(async () => []),
      sendQueued: vi.fn(async () => []),
      prompt: vi.fn(async () => undefined),
      observeUser: vi.fn(async () => ({ authority: 0, permissions: [] })),
    };
    const execution = new CommandExecution(
      createOptions({
        session,
        persistElements: async (elements) => elements.map((element) => (element.type === "img" ? h("img", { ...element.attrs, id: assetId }) : element)),
      }),
    );
    execution.start();

    const event = await execution.next();
    expect(event.status).toBe("done");
    expect(event.transcript).toContain(`[图片：asset://${assetId}]`);
  });

  it("treats shared channels as guild chats", async () => {
    let capturedEvent: Record<string, unknown> | undefined;
    const session: FakeSession = {
      bot: undefined as never,
      execute: async () => [],
      send: vi.fn(async () => []),
      sendQueued: vi.fn(async () => []),
      prompt: vi.fn(async () => undefined),
      observeUser: vi.fn(async () => ({ authority: 0, permissions: [] })),
    };
    const bot = {
      platform: "test",
      selfId: "bot",
      sendMessage: vi.fn(async () => []),
      session: vi.fn((event: Record<string, unknown>) => {
        capturedEvent = event;
        return session;
      }),
    };
    session.bot = bot;
    const execution = new CommandExecution(createOptions({
      session,
      command: "ccb",
      bot,
    }));
    execution.start();

    await execution.next();
    expect(capturedEvent).toMatchObject({
      type: "message-created",
      subtype: "group",
      channel: { id: "room", type: 0 },
      guild: { id: "room" },
      user: { id: "yesimbot:agent:bot", name: "yesimbot:agent:bot" },
      member: { name: "yesimbot:agent:bot" },
      message: { id: "yesimbot:exec-1" },
    });
  });

  it("returns awaiting_prompt and resumes with koishi_prompt_answer", async () => {
    const session: FakeSession = {
      execute: async () => {
        const answer = await session.prompt();
        await session.send(h.text(`answer:${answer}`));
        return [h.text("finished")];
      },
      send: vi.fn(async () => []),
      sendQueued: vi.fn(async () => []),
      prompt: vi.fn(async () => undefined),
      observeUser: vi.fn(async () => ({ authority: 0, permissions: [] })),
    };
    const execution = new CommandExecution(createOptions({ session, interactive: "ask" }));
    execution.start();

    const first = await execution.next();
    expect(first.status).toBe("awaiting_prompt");
    expect(first.prompt).toBeDefined();
    expect(first.prompt).toContain("koishi_prompt_answer");

    const second = await execution.answer("yes");
    expect(second.status).toBe("done");
    expect(second.transcript).toContain("answer:yes");
  });

  it("rejects interactive commands in reject mode", async () => {
    const session: FakeSession = {
      execute: async () => {
        await session.prompt();
        return [];
      },
      send: vi.fn(async () => []),
      sendQueued: vi.fn(async () => []),
      prompt: vi.fn(async () => undefined),
      observeUser: vi.fn(async () => ({ authority: 0, permissions: [] })),
    };
    const execution = new CommandExecution(createOptions({ session }));
    execution.start();

    const event = await execution.next();
    expect(event.status).toBe("done");
    expect(event.error).toContain("interactive command is not allowed");
  });
});
