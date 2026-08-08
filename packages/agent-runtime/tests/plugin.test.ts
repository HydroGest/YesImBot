import { describe, expect, it } from "vitest";
import { z } from "zod";

import { createAgentChannel } from "../src/channel.js";
import { createPluginHost } from "../src/plugin.js";
import { AgentPlugin } from "../src/plugin.js";
import { createStateManager } from "../src/state.js";
import { createMemoryStorage } from "../src/storage.js";

function createRuntime() {
  const storage = createMemoryStorage();
  const channel = createAgentChannel();
  return { id: "runtime_1", channel, state: createStateManager({ storage }), storage };
}

describe("plugin host", () => {
  it("orders plugins by pre, normal, then post", () => {
    const plugins: AgentPlugin[] = [{ name: "normal-1" }, { name: "post", enforce: "post" }, { name: "pre", enforce: "pre" }, { name: "normal-2" }];

    const host = createPluginHost({ plugins, runtime: createRuntime() });

    expect(host.plugins.map((plugin) => plugin.name)).toEqual(["pre", "normal-1", "normal-2", "post"]);
  });

  it("resolves stable prompt and tool resources once in plugin order", async () => {
    const runtime = createRuntime();
    const calls: string[] = [];
    const host = createPluginHost({
      runtime,
      plugins: [
        {
          name: "pre",
          enforce: "pre",
          tools: () => {
            calls.push("tools:pre");
            return [{ name: "pre_tool", inputSchema: z.object({}) }] as never;
          },
          appendSystemPrompt: () => {
            calls.push("prompt:pre");
            return "pre prompt";
          },
        },
        {
          name: "normal",
          tools: [{ name: "normal_tool", inputSchema: z.object({}) }] as never,
          extendSystemPrompt(prompt) {
            calls.push("legacy-prompt:normal");
            return `${prompt}\nlegacy`;
          },
          extendTools(tools) {
            calls.push("legacy-tools:normal");
            return [...tools, { name: "legacy_tool", inputSchema: z.object({}) }] as never;
          },
          appendSystemPrompt: () => ({ role: "system", content: "normal prompt", providerOptions: { mock: { cache: true } } }),
        },
      ],
    });

    await host.init({
      legacySystemPrompt: "base",
      baseTools: [{ name: "base", inputSchema: z.object({}) }] as never,
      terminalTools: [{ name: "finalize_response", inputSchema: z.object({}) }] as never,
    });
    await host.init({ legacySystemPrompt: "ignored", baseTools: [], terminalTools: [] });

    expect(calls).toEqual(["tools:pre", "prompt:pre", "legacy-prompt:normal", "legacy-tools:normal"]);
    expect(host.stableLegacySystemPrompt).toBe("base\nlegacy");
    expect(host.stablePromptBlocks).toEqual([
      { role: "system", content: "pre prompt" },
      { role: "system", content: "normal prompt", providerOptions: { mock: { cache: true } } },
    ]);
    expect(host.stableTools.map((tool) => tool.name)).toEqual(["base", "pre_tool", "normal_tool", "legacy_tool", "finalize_response"]);
  });

  it("fails initialization when a required stable resource throws", async () => {
    const calls: string[] = [];
    const host = createPluginHost({
      runtime: createRuntime(),
      plugins: [
        { name: "first", init: () => void calls.push("init:first"), stop: () => void calls.push("stop:first") },
        {
          name: "broken",
          init: () => calls.push("init:broken"),
          appendSystemPrompt: () => {
            throw new Error("bad prompt");
          },
          stop: () => void calls.push("stop:broken"),
        },
      ],
    });

    await expect(host.init({ baseTools: [], terminalTools: [] })).rejects.toThrow("bad prompt");
    expect(calls).toEqual(["init:first", "init:broken", "stop:broken", "stop:first"]);
  });

  it("continues required-plugin rollback after cleanup failures and preserves the resource error", async () => {
    const calls: string[] = [];
    const primaryError = new Error("stable resource failed");
    const host = createPluginHost({
      runtime: createRuntime(),
      plugins: [
        { name: "first", init: () => void calls.push("init:first"), stop: () => void calls.push("stop:first") },
        {
          name: "intermediate",
          init: () => void calls.push("init:intermediate"),
          stop: () => {
            calls.push("stop:intermediate");
            throw new Error("cleanup failed");
          },
        },
        {
          name: "broken",
          init: () => void calls.push("init:broken"),
          appendSystemPrompt: () => {
            throw primaryError;
          },
          stop: () => void calls.push("stop:broken"),
        },
      ],
    });

    await expect(host.init()).rejects.toBe(primaryError);
    expect(calls).toEqual(["init:first", "init:intermediate", "init:broken", "stop:broken", "stop:intermediate", "stop:first"]);
    expect(host.activePlugins).toEqual([]);
  });

  it("disables an optional plugin without retaining partial resources", async () => {
    const runtime = createRuntime();
    const disabled: string[] = [];
    runtime.channel.subscribe("internal", (event) => {
      if (event.type === "plugin.disabled") disabled.push(event.plugin);
    });
    const host = createPluginHost({
      runtime,
      plugins: [
        {
          name: "optional",
          optional: true,
          tools: [{ name: "must_disappear", inputSchema: z.object({}) }] as never,
          appendSystemPrompt: () => {
            throw new Error("bad optional prompt");
          },
        },
        { name: "required", tools: [{ name: "kept", inputSchema: z.object({}) }] as never, appendSystemPrompt: () => "kept prompt" },
      ],
    });

    await host.init({ baseTools: [], terminalTools: [] });

    expect(disabled).toEqual(["optional"]);
    expect(host.activePlugins.map((plugin) => plugin.name)).toEqual(["required"]);
    expect(host.stableTools.map((tool) => tool.name)).toEqual(["kept"]);
    expect(host.stablePromptBlocks).toEqual([{ role: "system", content: "kept prompt" }]);
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
    const result = await host.helpers.transformMessages([], { runtime: { id: runtime.id }, channel: runtime.channel, state: runtime.state });

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
      { runtime: { id: runtime.id }, channel: runtime.channel, state: runtime.state, turnId: "turn_1" },
    );

    expect(result).toEqual({ type: "block", reason: "plugin-error" });
    expect(seen).toEqual(["broken-before"]);
  });
});
