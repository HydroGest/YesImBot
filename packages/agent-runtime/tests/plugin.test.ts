import { describe, expect, it } from "vitest";
import { z } from "zod";

import { createAgentChannel } from "../src/channel.js";
import { createPluginHost } from "../src/plugin.js";
import { createStateManager } from "../src/state.js";
import { createMemoryStorage } from "../src/storage.js";
import { AgentPlugin } from "../src/types/plugin.js";

function createRuntime() {
  const storage = createMemoryStorage();
  const channel = createAgentChannel();
  return {
    id: "runtime_1",
    channel,
    state: createStateManager({ storage }),
    storage,
  };
}

describe("plugin host", () => {
  it("orders plugins by pre, normal, then post", () => {
    const plugins: AgentPlugin[] = [
      { name: "normal-1" },
      { name: "post", enforce: "post" },
      { name: "pre", enforce: "pre" },
      { name: "normal-2" },
    ];

    const host = createPluginHost({ plugins, runtime: createRuntime() });

    expect(host.plugins.map((plugin) => plugin.name)).toEqual([
      "pre",
      "normal-1",
      "normal-2",
      "post",
    ]);
  });

  it("resolves stable plugin tools once during initialization in plugin order", async () => {
    const calls: string[] = [];
    const runtime = createRuntime();
    const host = createPluginHost({
      runtime,
      plugins: [
        {
          name: "normal",
          tools: () => {
            calls.push("tools:normal");
            return [{ name: "normal_tool", inputSchema: z.object({}), execute: async () => "ok" }];
          },
        },
        {
          name: "pre",
          enforce: "pre",
          tools: () => {
            calls.push("tools:pre");
            return [{ name: "pre_tool", inputSchema: z.object({}), execute: async () => "ok" }];
          },
        },
        {
          name: "post",
          enforce: "post",
          tools: [{ name: "post_tool", inputSchema: z.object({}), execute: async () => "ok" }],
        },
      ],
    });

    await host.init();
    await host.init();

    expect(calls).toEqual(["tools:pre", "tools:normal"]);
    expect(host.stableTools.map((tool) => tool.name)).toEqual([
      "pre_tool",
      "normal_tool",
      "post_tool",
    ]);
    expect(host.hasDynamicToolExtensions).toBe(false);
  });

  it("reports whether any active plugin has dynamic tool extensions", async () => {
    const host = createPluginHost({
      runtime: createRuntime(),
      plugins: [
        {
          name: "dynamic",
          extendTools(tools) {
            return tools;
          },
        },
      ],
    });

    await host.init();

    expect(host.hasDynamicToolExtensions).toBe(true);
  });

  it("initializes plugins once and stops initialized plugins in reverse order on failure", async () => {
    const calls: string[] = [];
    const plugins: AgentPlugin[] = [
      {
        name: "a",
        init: () => {
          calls.push("init:a");
        },
        stop: () => {
          calls.push("stop:a");
        },
      },
      {
        name: "b",
        init: () => {
          calls.push("init:b");
          throw new Error("boom");
        },
      },
    ];

    const host = createPluginHost({ plugins, runtime: createRuntime() });

    await expect(host.init()).rejects.toThrow("boom");
    expect(calls).toEqual(["init:a", "init:b", "stop:a"]);

    calls.length = 0;
    await expect(host.init()).rejects.toThrow("boom");
    expect(calls).toEqual(["init:a", "init:b", "stop:a"]);
  });

  it("disables optional plugins, emits diagnostics, and continues initialization", async () => {
    const runtime = createRuntime();
    const disabled: string[] = [];
    const errors: string[] = [];

    runtime.channel.subscribe("internal", (event) => {
      if (event.type === "plugin.disabled") disabled.push(event.plugin);
      if (event.type === "plugin.error") errors.push(event.plugin);
    });

    const calls: string[] = [];
    const host = createPluginHost({
      plugins: [
        {
          name: "optional",
          optional: true,
          init: () => {
            throw new Error("skip");
          },
        },
        {
          name: "required",
          init: () => {
            calls.push("init:required");
          },
          stop: () => {
            calls.push("stop:required");
          },
        },
      ],
      runtime,
    });

    await host.init();
    await host.stop();

    expect(disabled).toEqual(["optional"]);
    expect(errors).toEqual([]);
    expect(calls).toEqual(["init:required", "stop:required"]);
  });

  it("emits plugin.error diagnostics for fail-open hook helpers", async () => {
    const runtime = createRuntime();
    const seen: string[] = [];

    runtime.channel.subscribe("internal", (event) => {
      if (event.type === "plugin.error") {
        seen.push(`${event.plugin}:${event.error.name}:${event.error.message}`);
      }
    });

    const host = createPluginHost({
      runtime,
      plugins: [
        {
          name: "broken-transform",
          transformMessages() {
            throw new Error("bad transform");
          },
        },
      ],
    });

    await host.init();
    const result = await host.helpers.transformMessages([], {
      runtime: { id: runtime.id },
      channel: runtime.channel,
      state: runtime.state,
    });

    expect(result).toEqual([]);
    expect(seen).toEqual(["broken-transform:Error:bad transform"]);
  });

  it("fails closed when beforeToolCall throws while still emitting plugin.error", async () => {
    const runtime = createRuntime();
    const seen: string[] = [];

    runtime.channel.subscribe("internal", (event) => {
      if (event.type === "plugin.error") seen.push(event.plugin);
    });

    const host = createPluginHost({
      runtime,
      plugins: [
        {
          name: "broken-before",
          beforeToolCall() {
            throw new Error("bad before");
          },
        },
      ],
    });

    await host.init();
    const result = await host.helpers.beforeToolCall(
      { type: "allow" },
      { toolCallId: "call_1", toolName: "search", args: {} },
      {
        runtime: { id: runtime.id },
        channel: runtime.channel,
        state: runtime.state,
        turnId: "turn_1",
      },
    );

    expect(result).toEqual({ type: "block", reason: "plugin-error" });
    expect(seen).toEqual(["broken-before"]);
  });

  it("appends structured system prompt blocks in plugin order after legacy prompt hooks", async () => {
    const runtime = createRuntime();
    const host = createPluginHost({
      runtime,
      plugins: [
        {
          name: "legacy",
          extendSystemPrompt(prompt) {
            return `${prompt}\nlegacy`;
          },
        },
        {
          name: "structured-a",
          appendSystemPrompt() {
            return "structured a";
          },
        },
        {
          name: "structured-b",
          appendSystemPrompt() {
            return [
              {
                role: "system",
                content: "structured b",
                providerOptions: { mock: { cache: true } },
              },
              "structured c",
            ];
          },
        },
      ],
    });

    await host.init();

    const context = {
      runtime: { id: runtime.id },
      channel: runtime.channel,
      state: runtime.state,
    };

    await expect(host.helpers.extendSystemPrompt("base", context)).resolves.toBe("base\nlegacy");
    await expect(host.helpers.appendSystemPrompt(context)).resolves.toEqual([
      { role: "system", content: "structured a" },
      {
        role: "system",
        content: "structured b",
        providerOptions: { mock: { cache: true } },
      },
      { role: "system", content: "structured c" },
    ]);
  });

  it("keeps structured system prompt append hooks fail-open", async () => {
    const runtime = createRuntime();
    const seen: string[] = [];

    runtime.channel.subscribe("internal", (event) => {
      if (event.type === "plugin.error") {
        seen.push(`${event.plugin}:${event.error.name}:${event.error.message}`);
      }
    });

    const host = createPluginHost({
      runtime,
      plugins: [
        {
          name: "broken-structured",
          appendSystemPrompt() {
            throw new Error("bad structured prompt");
          },
        },
        {
          name: "later-structured",
          appendSystemPrompt() {
            return "later";
          },
        },
      ],
    });

    await host.init();

    const result = await host.helpers.appendSystemPrompt({
      runtime: { id: runtime.id },
      channel: runtime.channel,
      state: runtime.state,
    });

    expect(result).toEqual([{ role: "system", content: "later" }]);
    expect(seen).toEqual(["broken-structured:Error:bad structured prompt"]);
  });
});
