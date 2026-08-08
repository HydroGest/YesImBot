import type { AgentPlugin } from "@yesimbot/agent-runtime";
import { type Bot, h, type Session, type Universal } from "koishi";
import { describe, expect, it, vi } from "vitest";

vi.mock("koishi", async () => import("@koishijs/core"));

import { Agents, ChannelPlugin } from "../src/agents/index.js";
import { type Will, WillPlugin } from "../src/agents/will.js";
import type { ChannelScope } from "../src/channels/index.js";
import { createMessage, type MessageRecord } from "../src/messages/index.js";

const scope: ChannelScope = {
  type: "shared",
  platform: "test",
  channelId: "room-1",
};

const directScope: ChannelScope = {
  type: "direct",
  platform: "test",
  selfId: "bot-1",
  channelId: "room-1",
};

function message(channelType: Universal.Channel.Type, elements = [h.text("hello")]) {
  return createMessage({
    platform: "test",
    selfId: "bot-1",
    timestamp: 1,
    channel: { id: "room-1", type: channelType },
    user: { id: "user-1", name: "User" },
    messageId: "message-1",
    elements,
  } satisfies MessageRecord);
}

class TestChannelPlugin extends ChannelPlugin {
  public constructor(
    private readonly plugin: AgentPlugin | null,
    private readonly failure?: Error,
  ) {
    super();
  }

  public init(): AgentPlugin | null {
    if (this.failure) throw this.failure;
    return this.plugin;
  }
}

class TestWillPlugin extends WillPlugin {
  public constructor(
    public readonly priority: number,
    private readonly matches: boolean,
    private readonly will: Will,
  ) {
    super();
  }

  public match(_session: Session): boolean {
    return this.matches;
  }

  public init(_scope: ChannelScope): Will {
    return this.will;
  }
}

describe("Agents", () => {
  it("registers and disposes channel plugins in stable order", async () => {
    const agents = new Agents();
    const first = { name: "first" } satisfies AgentPlugin;
    const second = { name: "second" } satisfies AgentPlugin;
    const disposeFirst = agents.use(new TestChannelPlugin(first));
    agents.use(new TestChannelPlugin(second));

    await expect(agents.init(scope, {} as Bot)).resolves.toEqual([first, second]);
    disposeFirst();
    await expect(agents.init(scope, {} as Bot)).resolves.toEqual([second]);
  });

  it("rolls back initialized plugins in reverse order while preserving the primary error", async () => {
    const agents = new Agents();
    const firstStop = vi.fn(async () => undefined);
    const secondStop = vi.fn(async () => undefined);
    const primary = new Error("third failed");
    agents.use(new TestChannelPlugin({ name: "first", stop: firstStop }));
    agents.use(new TestChannelPlugin({ name: "second", stop: secondStop }));
    agents.use(new TestChannelPlugin(null, primary));

    await expect(agents.init(scope, {} as Bot)).rejects.toBe(primary);
    expect(secondStop).toHaveBeenCalledBefore(firstStop);
  });

  it("selects the first matching WillPlugin by priority then registration order", async () => {
    const agents = new Agents();
    const first = { decide: vi.fn(async () => "wait" as const) } satisfies Will;
    const second = { decide: vi.fn(async () => "trigger" as const) } satisfies Will;
    const lowerPriority = { decide: vi.fn(async () => "wait" as const) } satisfies Will;
    agents.will(new TestWillPlugin(10, true, first));
    agents.will(new TestWillPlugin(10, true, second));
    agents.will(new TestWillPlugin(5, true, lowerPriority));

    await expect(agents.initWill(scope, {} as Session)).resolves.toBe(lowerPriority);
  });

  it("uses the fixed stateless Core default without a Session", async () => {
    const agents = new Agents();
    const will = await agents.initWill(scope);
    const directWill = await agents.initWill(directScope);

    expect(will.decide(message(1), { activeTurnId: null })).toBe("trigger");
    expect(will.decide(message(0, [h.at("bot-1")]), { activeTurnId: null })).toBe("trigger");
    expect(will.decide(message(0), { activeTurnId: null })).toBe("wait");
    expect(directWill.decide(message(0), { activeTurnId: null })).toBe("wait");
    expect(Object.keys(will)).toEqual([]);
  });
});
