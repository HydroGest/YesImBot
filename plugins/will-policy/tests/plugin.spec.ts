import type { WillPlugin } from "koishi-plugin-yesimbot";
import { describe, expect, it, vi } from "vitest";

vi.mock("koishi", async () => import("@koishijs/core"));

import WillPolicyPlugin from "../src/index.js";
import { defaultRoutingConfig, defaultWillingnessConfig } from "../src/types.js";

interface CommandAction {
  (argv: { session?: { send: ReturnType<typeof vi.fn> } }): Promise<unknown>;
}

function createShared() {
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
  const registered: WillPlugin[] = [];
  const disposeWill = vi.fn();
  const ctx = {
    root: shared.root,
    logger: vi.fn(() => ({ debug: vi.fn(), success: vi.fn() })),
    on: vi.fn(),
    filter,
    yesimbot: {
      config: { logLevel: 3 },
      agent: {
        will: vi.fn((plugin: WillPlugin) => {
          registered.push(plugin);
          return disposeWill;
        }),
      },
    },
    command: vi.fn(() => shared.command),
  };
  const plugin = new WillPolicyPlugin(ctx as never, { engine: "routing", routing: defaultRoutingConfig(), willingness: defaultWillingnessConfig() });
  await plugin.start();
  return { plugin, registered, disposeWill, shared };
}

describe("WillPolicyPlugin", () => {
  it("registers a named WillEngine and initializes it when its filter matches", async () => {
    const { plugin, registered } = await createInstance(() => true);

    expect(registered).toHaveLength(1);
    expect(plugin.match({} as never)).toBe(true);
    expect(plugin.setup({ type: "guild", platform: "test", channelId: "room-1", guildId: "room-1" } as never)).toBeTruthy();
  });

  it("declines when its Koishi filter does not match", async () => {
    const { plugin, registered } = await createInstance(() => false);

    expect(registered).toHaveLength(1);
    expect(plugin.match({} as never)).toBe(false);
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
