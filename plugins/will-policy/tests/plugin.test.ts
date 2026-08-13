import { createMessage, type WillPlugin } from "koishi-plugin-yesimbot";
import { describe, expect, it, vi } from "vitest";

vi.mock("koishi", async () => import("@koishijs/core"));

import WillPolicyPlugin, { resolveWillingnessForChannel } from "../src/index.js";
import { defaultRoutingConfig, defaultWillingnessConfig, type PolicyWillingnessConfig } from "../src/types.js";

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

  it("applies the first matching channel willingness override", async () => {
    const { plugin } = await createInstance(() => true);
    const config: PolicyWillingnessConfig = {
      ...plugin.config.willingness!,
      channelOverrides: [
        { platform: "test", channelId: "room-1", textGain: 1, keywordMultiplier: 2 },
        { platform: "*", channelId: "*", textGain: 99 },
      ],
    };

    const resolved = resolveWillingnessForChannel(config, { type: "guild", platform: "test", channelId: "room-1", guildId: "room-1" });

    expect(resolved.textGain).toBe(1);
    expect(resolved.keywordMultiplier).toBe(2);
  });

  it("preserves omitted override fields from the global configuration", () => {
    const config = { ...defaultWillingnessConfig(), keywordMultiplier: 7, channelOverrides: [{ platform: "test", channelId: "room-1", textGain: 2 }] };

    const resolved = resolveWillingnessForChannel(config, { type: "guild", platform: "test", channelId: "room-1", guildId: "room-1" });

    expect(resolved.textGain).toBe(2);
    expect(resolved.keywordMultiplier).toBe(7);
  });

  it("matches guild channels when isDirect is omitted", () => {
    const config = { ...defaultWillingnessConfig(), channelOverrides: [{ platform: "test", channelId: "room-1", textGain: 4 }] };

    const resolved = resolveWillingnessForChannel(config, { type: "guild", platform: "test", channelId: "room-1", guildId: "room-1" });

    expect(resolved.textGain).toBe(4);
  });

  it("matches wildcard platforms", () => {
    const config = { ...defaultWillingnessConfig(), channelOverrides: [{ platform: "*", channelId: "room-1", textGain: 5 }] };

    const resolved = resolveWillingnessForChannel(config, { type: "guild", platform: "another-platform", channelId: "room-1", guildId: "room-1" });

    expect(resolved.textGain).toBe(5);
  });

  it("keeps global willingness values when no channel override matches", async () => {
    const config = { ...defaultWillingnessConfig(), channelOverrides: [{ platform: "test", channelId: "other-room", textGain: 1 }] };

    const resolved = resolveWillingnessForChannel(config, { type: "guild", platform: "test", channelId: "room-1", guildId: "room-1" });

    expect(resolved.textGain).toBe(defaultWillingnessConfig().textGain);
  });

  it("normalizes direct account ids before matching overrides", async () => {
    const config = { ...defaultWillingnessConfig(), channelOverrides: [{ platform: "test", channelId: "user-1", isDirect: true, textGain: 3 }] };

    const resolved = resolveWillingnessForChannel(config, { type: "direct", platform: "test", channelId: "private:user-1", selfId: "bot-1", userId: "user-1" });

    expect(resolved.textGain).toBe(3);
  });

  it("normalizes direct account ids when isDirect is omitted", () => {
    const config = { ...defaultWillingnessConfig(), channelOverrides: [{ platform: "test", channelId: "user-1", textGain: 6 }] };

    const resolved = resolveWillingnessForChannel(config, { type: "direct", platform: "test", channelId: "private:user-1", selfId: "bot-1", userId: "user-1" });

    expect(resolved.textGain).toBe(6);
  });

  it("applies channel overrides through plugin setup", async () => {
    const { plugin } = await createInstance(() => true);
    const configured = new WillPolicyPlugin(plugin.ctx, {
      engine: "willingness",
      willingness: { ...defaultWillingnessConfig(), channelOverrides: [{ platform: "test", channelId: "room-1", textGain: 8 }] },
    });

    const engine = configured.setup({ type: "guild", platform: "test", channelId: "room-1", guildId: "room-1" });
    await engine.decide(
      createMessage({
        platform: "test",
        selfId: "bot-1",
        timestamp: Date.now(),
        channel: { id: "room-1", type: 0 },
        user: { id: "user-1" },
        messageId: "m-1",
        elements: [],
      }),
      { activeTurnId: null },
    );

    expect(engine.getCurrentWillingness?.()).toBe(8);
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
