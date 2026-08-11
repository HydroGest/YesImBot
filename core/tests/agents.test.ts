import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { AgentPlugin } from "@yesimbot/agent-runtime";
import { Context, type Bot, h, type Session, type Universal } from "koishi";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("koishi", async () => import("@koishijs/core"));

vi.mock("ai", async (importOriginal) => {
  const original = await importOriginal<typeof import("ai")>();
  return { ...original, generateText: vi.fn() };
});

import { generateText } from "ai";

import { Agents, type ChannelPlugin } from "../src/agents/index.js";
import { createDescribeImageTool } from "../src/agents/tools.js";
import { type WillEngine, type WillPlugin } from "../src/agents/will.js";
import type { ChannelContext } from "../src/channels/index.js";
import { createMessage, type MessageRecord } from "../src/messages/index.js";
import { ChannelResources } from "../src/resources/index.js";
import { PNG_BYTES } from "./helpers/index.js";

const roots: string[] = [];

afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

// ---------------------------------------------------------------------------
// createDescribeImageTool
// ---------------------------------------------------------------------------

async function createResources(): Promise<ChannelResources> {
  const root = await mkdtemp(join(tmpdir(), "yesimbot-describe-image-"));
  roots.push(root);
  return new ChannelResources(root);
}

const VALID_URI = `asset://${"a".repeat(32)}`;

describe("createDescribeImageTool", () => {
  it("describes an asset image through the vision model", async () => {
    const resources = await createResources();
    const id = await resources.assets.put(PNG_BYTES);
    vi.mocked(generateText).mockResolvedValueOnce({
      text: "一只猫在沙发上",
      steps: [],
      warnings: [],
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
    } as never);
    const onUsage = vi.fn();
    const tool = createDescribeImageTool({} as never, resources, onUsage);

    const result = await tool.execute({ uri: `asset://${id}`, question: "图片里有什么？" }, { toolCallId: "call", abortSignal: undefined } as never);

    expect(result).toEqual({ text: "一只猫在沙发上" });
    const options = vi.mocked(generateText).mock.calls[0]![0] as {
      messages: Array<{ content: Array<{ type: string; text?: string; data?: Uint8Array; mediaType?: string }> }>;
    };
    const parts = options.messages[0]!.content;
    expect(parts[0]).toMatchObject({ type: "text" });
    expect(parts[0]!.text).toContain("图片里有什么？");
    expect(parts[1]).toMatchObject({ type: "file", mediaType: "image/png" });
    expect(parts[1]!.data).toEqual(PNG_BYTES);
    expect(onUsage).toHaveBeenCalledWith({ inputTokens: 1, outputTokens: 1, totalTokens: 2 });
  });

  it("rejects malformed URIs without touching the asset store", async () => {
    const resources = await createResources();
    const get = vi.spyOn(resources.assets, "get");
    const tool = createDescribeImageTool({} as never, resources);

    await expect(tool.execute({ uri: "asset://SHORT", question: "什么" }, { toolCallId: "call", abortSignal: undefined } as never)).resolves.toEqual({
      error: "invalid_uri",
    });
    await expect(tool.execute({ uri: "artifact://mcp/x", question: "什么" }, { toolCallId: "call", abortSignal: undefined } as never)).resolves.toEqual({
      error: "invalid_uri",
    });
    expect(get).not.toHaveBeenCalled();
  });

  it("reports a missing asset", async () => {
    const resources = await createResources();
    const tool = createDescribeImageTool({} as never, resources);

    await expect(tool.execute({ uri: VALID_URI, question: "什么" }, { toolCallId: "call", abortSignal: undefined } as never)).resolves.toEqual({
      error: "asset_not_found",
    });
  });

  it("rejects non-image bytes", async () => {
    const resources = await createResources();
    const id = await resources.assets.put(new Uint8Array([1, 2, 3]));
    const tool = createDescribeImageTool({} as never, resources);

    await expect(tool.execute({ uri: `asset://${id}`, question: "什么" }, { toolCallId: "call", abortSignal: undefined } as never)).resolves.toEqual({
      error: "not_an_image",
    });
  });

  it("surfaces a failed vision call as an error result", async () => {
    const resources = await createResources();
    const id = await resources.assets.put(PNG_BYTES);
    vi.mocked(generateText).mockRejectedValueOnce(new Error("boom"));
    const tool = createDescribeImageTool({} as never, resources);

    await expect(tool.execute({ uri: `asset://${id}`, question: "什么" }, { toolCallId: "call", abortSignal: undefined } as never)).resolves.toEqual({
      error: "vision_call_failed: boom",
    });
  });
});

// ---------------------------------------------------------------------------
// Agents
// ---------------------------------------------------------------------------

const scope: ChannelContext = { type: "guild", platform: "test", channelId: "room-1", guildId: "room-1" };

const directScope: ChannelContext = { type: "direct", platform: "test", selfId: "bot-1", channelId: "room-1", userId: "user-1" };

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

class TestChannelPlugin implements ChannelPlugin {
  public constructor(
    private readonly plugin: AgentPlugin | null,
    private readonly failure?: Error,
  ) {}

  public setup(_scope: ChannelContext, _bot: Bot): AgentPlugin | null {
    if (this.failure) throw this.failure;
    return this.plugin;
  }
}

class TestWillPlugin implements WillPlugin {
  public constructor(
    public readonly priority: number,
    private readonly matches: boolean,
    private readonly will: WillEngine,
  ) {}

  public match(_session: Session): boolean {
    return this.matches;
  }

  public setup(_scope: ChannelContext): WillEngine {
    return this.will;
  }
}

describe("Agents", () => {
  it("resolves channel models, reports scoped usage, and composes trigger guards", async () => {
    const agents = new Agents();
    const report = vi.fn();
    const disposeModel = agents.model(() => "provider:override");
    agents.usage(report);
    agents.guard(() => true);
    agents.guard(() => false);

    await expect(agents.resolveModel(scope, "provider:default")).resolves.toBe("provider:override");
    await agents.reportUsage(scope, { kind: "compact", modelId: "provider:override", usage: { totalTokens: 3 } });
    await expect(agents.allowTrigger(scope)).resolves.toBe(false);
    expect(report).toHaveBeenCalledOnce();

    disposeModel();
    await expect(agents.resolveModel(scope, "provider:default")).resolves.toBe("provider:default");
  });

  it("registers and disposes channel plugins in stable order", async () => {
    const agents = new Agents(new Context());
    const first = { name: "first" } satisfies AgentPlugin;
    const second = { name: "second" } satisfies AgentPlugin;
    const disposeFirst = agents.use(new TestChannelPlugin(first));
    agents.use(new TestChannelPlugin(second));
    await expect(agents.setup(scope, {} as Bot)).resolves.toEqual([first, second]);
    disposeFirst();
    await expect(agents.setup(scope, {} as Bot)).resolves.toEqual([second]);
  });

  it("rolls back initialized plugins in reverse order while preserving the primary error", async () => {
    const agents = new Agents(new Context());
    const firstStop = vi.fn(async () => undefined);
    const secondStop = vi.fn(async () => undefined);
    const primary = new Error("third failed");
    agents.use(new TestChannelPlugin({ name: "first", stop: firstStop }));
    agents.use(new TestChannelPlugin({ name: "second", stop: secondStop }));
    agents.use(new TestChannelPlugin(null, primary));

    await expect(agents.setup(scope, {} as Bot)).rejects.toBe(primary);
    expect(secondStop).toHaveBeenCalledBefore(firstStop);
  });

  it("selects the first matching WillPlugin by priority then registration order", async () => {
    const agents = new Agents(new Context());
    const first = { decide: vi.fn(async () => "wait" as const) } satisfies WillEngine;
    const second = { decide: vi.fn(async () => "trigger" as const) } satisfies WillEngine;
    const lowerPriority = { decide: vi.fn(async () => "wait" as const) } satisfies WillEngine;
    agents.will(new TestWillPlugin(10, true, first));
    agents.will(new TestWillPlugin(10, true, second));
    agents.will(new TestWillPlugin(5, true, lowerPriority));

    await expect(agents.setupWill(scope, {} as Session)).resolves.toBe(lowerPriority);
  });

  it("uses the fixed stateless Core default without a Session", async () => {
    const agents = new Agents(new Context());
    const willEngine = await agents.setupWill(scope);
    const directWillEngine = await agents.setupWill(directScope);

    expect(willEngine.decide(message(1), { activeTurnId: null })).toBe("trigger");
    expect(willEngine.decide(message(0, [h.at("bot-1")]), { activeTurnId: null })).toBe("trigger");
    expect(willEngine.decide(message(0), { activeTurnId: null })).toBe("wait");
    expect(directWillEngine.decide(message(0), { activeTurnId: null })).toBe("wait");
    expect(Object.keys(willEngine)).toEqual(["decide"]);
  });
});
