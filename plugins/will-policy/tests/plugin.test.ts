import type { WillEngineFactory, WillEngineFactoryContext } from "koishi-plugin-yesimbot";
import { describe, expect, it, vi } from "vitest";

vi.mock("koishi", async () => import("@koishijs/core"));

import WillPolicyPlugin from "../src/index.js";
import { defaultRoutingConfig, defaultWillingnessConfig } from "../src/types.js";

interface CommandAction {
  (argv: { session?: { send: ReturnType<typeof vi.fn> } }): Promise<unknown>;
}

interface TestShared {
  readonly root: { readonly command: ReturnType<typeof vi.fn> };
  readonly command: {
    readonly ctx: object | undefined;
    readonly action: ReturnType<typeof vi.fn>;
    readonly dispose: ReturnType<typeof vi.fn>;
  };
  readonly actions: CommandAction[];
}

function createShared(): TestShared {
  const actions: CommandAction[] = [];
  const command = {
    ctx: undefined as object | undefined,
    action: vi.fn((callback: CommandAction) => {
      actions.push(callback);
      return command;
    }),
    dispose: vi.fn(),
  };
  const root = { command: vi.fn(() => command) };
  root.command.mockImplementation(() => {
    command.ctx = root;
    return command;
  });
  return { root, command, actions };
}

async function createInstance(filter: () => boolean, shared = createShared()) {
  const ctx = {
    root: shared.root,
    logger: vi.fn(() => ({ debug: vi.fn(), success: vi.fn() })),
    on: vi.fn(),
    filter,
    yesimbot: { registerWillEngineFactory: vi.fn(() => () => undefined) },
    command: vi.fn(() => shared.command),
  };
  const plugin = new WillPolicyPlugin(ctx as never, {
    engine: "routing",
    routing: defaultRoutingConfig(),
    willingness: defaultWillingnessConfig(),
  });
  await plugin.start();
  return {
    plugin,
    register: ctx.yesimbot.registerWillEngineFactory,
    shared,
  };
}

function factoryContext(): WillEngineFactoryContext {
  return {
    scope: {
      type: "shared",
      platform: "test",
      selfId: "bot-1",
      channelId: "room-1",
    },
    config: {} as never,
    session: { guildId: "room-1" } as never,
    createDefault: () => null as never,
  };
}

describe("WillPolicyPlugin", () => {
  it("returns an engine when its Koishi filter matches", async () => {
    const { register } = await createInstance(() => true);
    const factory = register.mock.calls[0]![0] as WillEngineFactory;

    const engine = await factory.create(factoryContext());

    expect(engine).toBeTruthy();
  });

  it("declines when its Koishi filter does not match", async () => {
    const { register } = await createInstance(() => false);
    const factory = register.mock.calls[0]![0] as WillEngineFactory;

    const engine = await factory.create(factoryContext());

    expect(engine).toBeUndefined();
  });

  it("registers one root debug command for all cloned instances", async () => {
    const shared = createShared();
    await createInstance(() => true, shared);
    await createInstance(() => true, shared);

    expect(shared.command.ctx).toBe(shared.root);
    expect(shared.command.action).toHaveBeenCalledOnce();
  });

  it("reports every matching instance when the debug command runs", async () => {
    const shared = createShared();
    await createInstance(() => true, shared);
    await createInstance(() => true, shared);

    const result = await shared.actions[0]?.({ session: {} } as never);

    expect(result?.split("\n")).toHaveLength(2);
    expect(result).toContain("WillPolicy[");
    expect(result).toContain("priority=1000");
  });

  it("ignores the debug command when the instance filter does not match", async () => {
    const shared = createShared();
    await createInstance(() => false, shared);

    const result = await shared.actions[0]?.({ session: {} } as never);

    expect(result).toBeUndefined();
  });
});
