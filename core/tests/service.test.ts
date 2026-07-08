import { Context } from "@koishijs/core";
import { describe, expect, it, vi } from "vitest";

vi.mock("koishi", async () => import("@koishijs/core"));

import { type Config } from "../src/config.js";
import { apply } from "../src/index.js";
import { type AgentPluginFactory, YesImBotService } from "../src/service.js";
import { type ChannelAgentContext } from "../src/shared/types.js";

class TestYesImBotService extends YesImBotService {
  public snapshotFactories() {
    return this.getAgentPluginFactories();
  }

  public buildExternalPlugins(context: ChannelAgentContext) {
    return this.createExternalAgentPlugins(context);
  }

  public buildRuntimePlugins(context: ChannelAgentContext) {
    return this.createRuntimePlugins(context);
  }
}

const config: Config = {
  basePath: "data/yesimbot-core",
  chatModel: "mock:model",
  logLevel: 2,
};

function createFactory(name: string): AgentPluginFactory {
  return () => ({ name });
}

function createChannelContext(): ChannelAgentContext {
  return {
    channel: {
      platform: "discord",
      selfId: "bot",
      channelId: "channel",
      type: "group",
    },
    platform: {
      name: "discord",
    },
  };
}

describe("yesimbot service", () => {
  it("keeps factory registration order and supports disposal", () => {
    const service = new TestYesImBotService(new Context(), config);
    const disposeA = service.registerAgentPlugin(createFactory("a"));
    service.registerAgentPlugin(createFactory("b"));

    expect(service.snapshotFactories()).toHaveLength(2);
    expect(
      service.buildExternalPlugins(createChannelContext()).map((plugin) => plugin.name),
    ).toEqual(["a", "b"]);

    disposeA();

    expect(
      service.buildExternalPlugins(createChannelContext()).map((plugin) => plugin.name),
    ).toEqual(["b"]);
  });

  it("keeps previously captured snapshots unchanged", () => {
    const service = new TestYesImBotService(new Context(), config);
    service.registerAgentPlugin(createFactory("a"));

    const snapshot = service.snapshotFactories();

    service.registerAgentPlugin(createFactory("b"));

    expect(snapshot).toHaveLength(1);
    expect(snapshot.map((factory) => factory(createChannelContext()).name)).toEqual(["a"]);
    expect(
      service.buildExternalPlugins(createChannelContext()).map((plugin) => plugin.name),
    ).toEqual(["a", "b"]);
  });

  it("places core built-in plugins before externally registered plugins", () => {
    const service = new TestYesImBotService(new Context(), config);
    service.registerAgentPlugin(createFactory("external-a"));
    service.registerAgentPlugin(createFactory("external-b"));

    expect(
      service.buildRuntimePlugins(createChannelContext()).map((plugin) => plugin.name),
    ).toEqual(["core.platform-message", "core.prompt-files", "external-a", "external-b"]);
  });

  it("passes platform metadata through external plugin factories", () => {
    const service = new TestYesImBotService(new Context(), config);
    const seen: ChannelAgentContext[] = [];

    service.registerAgentPlugin((context) => {
      seen.push(context);
      return { name: "observer" };
    });

    expect(
      service.buildExternalPlugins(createChannelContext()).map((plugin) => plugin.name),
    ).toEqual(["observer"]);
    expect(seen[0]?.platform.name).toBe("discord");
    expect(seen[0]?.platform.unsafeBot).toBeUndefined();
  });

  it("exposes ctx.yesimbot without runtime handles when applied", () => {
    const ctx = new Context();

    apply(ctx as never, config);

    expect(ctx.yesimbot).toBeInstanceOf(YesImBotService);
    expect("getRuntime" in ctx.yesimbot).toBe(false);
    expect("createRuntime" in ctx.yesimbot).toBe(false);
    expect("send" in ctx.yesimbot).toBe(false);
    expect("append" in ctx.yesimbot).toBe(false);
  });
});
