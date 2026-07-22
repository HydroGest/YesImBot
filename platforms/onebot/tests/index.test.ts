import { describe, expect, it, vi } from "vitest";

vi.mock("koishi", async () => import("@koishijs/core"));

import { h, type Session } from "koishi";
import type { EventRecord, ResolveContext, SessionResolver } from "koishi-plugin-yesimbot";

import { apply, createResolver } from "../src/index.js";

function messageBase(): Omit<EventRecord<"message">, "content"> {
  return {
    type: "message",
    platform: "onebot",
    selfId: "bot",
    timestamp: 1,
    channel: { id: "room", type: 0, name: "room" },
    user: { id: "user", name: "Alice" },
    member: { nick: "Alice" },
    guild: { id: "guild", name: "Guild" },
    message: { id: "message", content: "hello", elements: [h.text("hello")] },
  } as Omit<EventRecord<"message">, "content">;
}

function context(overrides: Partial<ResolveContext> = {}): ResolveContext {
  return {
    session: { platform: "onebot", selfId: "bot", event: { type: "message" } } as Session,
    base: messageBase(),
    freezeImage: vi.fn(async (element) => element),
    ...overrides,
  };
}

describe("createResolver", () => {
  it("preserves the complete generic message base while freezing OneBot images", async () => {
    const resolver = createResolver({ http: { file: vi.fn() } } as never);
    const base = messageBase();
    const result = await resolver.resolve(context({ base }));

    expect(result).toMatchObject({
      type: "message",
      channel: base.channel,
      user: base.user,
      member: base.member,
      guild: base.guild,
      message: { id: base.message.id, elements: [h.text("hello")] },
    });
    expect(result?.content).toBe("hello");
  });

  it("resolves a supported notice before considering the optional message base", async () => {
    const resolver = createResolver({ http: { file: vi.fn() } } as never);
    const result = await resolver.resolve(
      context({
        session: {
          platform: "onebot",
          selfId: "bot",
          event: { type: "message" },
          onebot: {
            post_type: "notice",
            notice_type: "message_reactions_updated",
            group_id: "room",
            message_id: "message",
            user_id: "user",
            reactions: [],
          },
        } as unknown as Session,
      }),
    );

    expect(result).toMatchObject({
      type: "onebot.message-reactions-updated",
      channel: { id: "room" },
    });
  });

  it("returns null for an unsupported non-message session", async () => {
    const resolver = createResolver({ http: { file: vi.fn() } } as never);
    await expect(
      resolver.resolve(
        context({
          session: { platform: "onebot", selfId: "bot", event: {} } as Session,
          base: undefined,
        }),
      ),
    ).resolves.toBeNull();
  });
});

describe("apply", () => {
  it("registers one resolver and disposes that exact registration", () => {
    const dispose = vi.fn();
    const registerResolver = vi.fn(() => dispose);
    const on = vi.fn();
    const ctx = { http: { file: vi.fn() }, yesimbot: { registerResolver }, on };

    apply(ctx as never);

    expect(registerResolver).toHaveBeenCalledOnce();
    expect(registerResolver.mock.calls[0][0]).toMatchObject({ platform: "onebot" } satisfies Pick<
      SessionResolver,
      "platform"
    >);
    expect(on).toHaveBeenCalledWith("dispose", dispose);
  });
});
