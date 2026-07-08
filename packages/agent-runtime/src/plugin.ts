import type { ModelMessage, SystemModelMessage } from "ai";

import { createDiagnostic, createInternalEvent } from "./event.js";
import type { AgentToolSet, ToolDecision } from "./tools.js";
import { TurnResult } from "./turn.js";
import { Awaitable } from "./types/base.js";
import type { AgentEntry } from "./types/entry.js";
import type { AgentInternalEventInit } from "./types/event.js";
import type { AgentMessage } from "./types/message.js";
import type {
  AgentPlugin,
  AgentPluginRuntime,
  AppendHookContext,
  MessageTransformContext,
  ModelMessageContext,
  PromptContext,
  SystemPromptAppend,
  ToolCallContext,
  ToolExtensionContext,
  ToolHookContext,
  ToolResultContext,
  TurnFinishContext,
} from "./types/plugin.js";
import type { AgentStorage } from "./types/storage.js";

export function orderPlugins(plugins: readonly AgentPlugin[]): AgentPlugin[] {
  const pre = plugins.filter((plugin) => plugin.enforce === "pre");
  const normal = plugins.filter((plugin) => plugin.enforce !== "pre" && plugin.enforce !== "post");
  const post = plugins.filter((plugin) => plugin.enforce === "post");
  return [...pre, ...normal, ...post];
}

export interface PluginHostRuntime extends AgentPluginRuntime {
  readonly storage: AgentStorage<AgentEntry>;
}

export interface PluginHostHelpers {
  onAppend(entries: AgentEntry[], context: AppendHookContext): Promise<AgentEntry[]>;
  transformMessages(
    messages: AgentMessage[],
    context: MessageTransformContext,
  ): Promise<AgentMessage[]>;
  toModelMessages(message: AgentMessage, context: ModelMessageContext): Promise<ModelMessage[]>;
  extendSystemPrompt(prompt: string, context: PromptContext): Promise<string>;
  appendSystemPrompt(context: PromptContext): Promise<SystemModelMessage[]>;
  extendTools(tools: AgentToolSet, context: ToolExtensionContext): Promise<AgentToolSet>;
  beforeToolCall(
    decision: ToolDecision,
    call: ToolCallContext,
    context: ToolHookContext,
  ): Promise<ToolDecision>;
  afterToolCall(result: ToolResultContext, context: ToolHookContext): Promise<ToolResultContext>;
  onTurnFinish(result: TurnResult, context: TurnFinishContext): Promise<void>;
}

export interface PluginHost {
  readonly plugins: readonly AgentPlugin[];
  readonly activePlugins: readonly AgentPlugin[];
  readonly stableTools: Readonly<AgentToolSet>;
  readonly hasDynamicToolExtensions: boolean;
  readonly helpers: PluginHostHelpers;
  init(): Promise<void>;
  stop(): Promise<void>;
  emitPluginError(pluginName: string, error: unknown): void;
}

function normalizeSystemPromptAppend(value: SystemPromptAppend): SystemModelMessage[] {
  const blocks = Array.isArray(value) ? value : [value];
  return blocks.map((block) =>
    typeof block === "string" ? { role: "system", content: block } : block,
  );
}

export function createPluginHost(options: {
  plugins: readonly AgentPlugin[];
  runtime: PluginHostRuntime;
}): PluginHost {
  const plugins = orderPlugins(options.plugins);
  const activePlugins: AgentPlugin[] = [];
  const stableTools: AgentToolSet = [];
  let didInit = false;

  const emitInternal = (event: AgentInternalEventInit) => {
    void options.runtime.channel.emit("internal", createInternalEvent(event));
  };

  const emitPluginError = (pluginName: string, error: unknown) => {
    emitInternal({
      type: "plugin.error",
      plugin: pluginName,
      error: createDiagnostic(error),
    });
  };

  const helpers: PluginHostHelpers = {
    async onAppend(entries, context) {
      let current = entries;

      for (const plugin of activePlugins) {
        const hook = plugin?.onAppend;
        if (!hook) continue;

        try {
          const next = await hook(current, context);
          if (next) current = next;
        } catch (error) {
          emitPluginError(plugin.name, error);
        }
      }

      return current;
    },

    async transformMessages(messages, context) {
      let current = messages;

      for (const plugin of activePlugins) {
        const hook = plugin?.transformMessages;
        if (!hook) continue;

        try {
          current = await hook(current, context);
        } catch (error) {
          emitPluginError(plugin.name, error);
        }
      }

      return current;
    },

    async toModelMessages(message, context) {
      for (const plugin of activePlugins) {
        const hook = plugin?.toModelMessages;
        if (!hook) continue;

        try {
          const converted = await hook(message, context);
          const messages = Array.isArray(converted) ? converted : converted ? [converted] : [];
          if (messages.length > 0) {
            return messages;
          }
        } catch (error) {
          emitPluginError(plugin.name, error);
        }
      }

      return [];
    },

    async extendSystemPrompt(prompt, context) {
      let current = prompt;

      for (const plugin of activePlugins) {
        const hook = plugin?.extendSystemPrompt;
        if (!hook) continue;

        try {
          const next = await hook(current, context);
          if (next !== undefined) current = next;
        } catch (error) {
          emitPluginError(plugin.name, error);
        }
      }

      return current;
    },

    async appendSystemPrompt(context) {
      const current: SystemModelMessage[] = [];

      for (const plugin of activePlugins) {
        const hook = plugin?.appendSystemPrompt;
        if (!hook) continue;

        try {
          const next = await hook(context);
          if (next !== undefined) current.push(...normalizeSystemPromptAppend(next));
        } catch (error) {
          emitPluginError(plugin.name, error);
        }
      }

      return current;
    },

    async extendTools(tools, context) {
      let current = tools;

      for (const plugin of activePlugins) {
        const hook = plugin?.extendTools;
        if (!hook) continue;

        try {
          const next = await hook(current, context);
          if (next) current = next;
        } catch (error) {
          emitPluginError(plugin.name, error);
        }
      }

      return current;
    },

    async beforeToolCall(decision, call, context) {
      let currentDecision = decision;
      let currentCall = call;

      for (const plugin of activePlugins) {
        const hook = plugin?.beforeToolCall;
        if (!hook) continue;

        try {
          const next = await hook(currentCall, context);
          if (!next) continue;

          if (next.type === "allow") {
            continue;
          }

          if (next.type === "replace") {
            currentDecision = next;
            currentCall = { ...currentCall, args: next.args };
            continue;
          }

          if (next.type === "block") {
            return next;
          }
        } catch (error) {
          emitPluginError(plugin.name, error);
          return { type: "block", reason: "plugin-error" };
        }
      }

      return currentDecision;
    },

    async afterToolCall(result, context) {
      let current = result;

      for (const plugin of activePlugins) {
        const hook = plugin?.afterToolCall;
        if (!hook) continue;

        try {
          const next = await hook(current, context);
          if (next) current = { ...current, ...next };
        } catch (error) {
          emitPluginError(plugin.name, error);
        }
      }

      return current;
    },

    async onTurnFinish(result, context) {
      for (const plugin of activePlugins) {
        const hook = plugin?.onTurnFinish;
        if (!hook) continue;

        try {
          await hook(result, context);
        } catch (error) {
          emitPluginError(plugin.name, error);
        }
      }
    },
  };

  return {
    plugins,
    get activePlugins() {
      return activePlugins;
    },
    get stableTools() {
      return stableTools;
    },
    get hasDynamicToolExtensions() {
      return activePlugins.some((plugin) => typeof plugin.extendTools === "function");
    },
    helpers,
    async init() {
      if (didInit) return;

      activePlugins.length = 0;
      stableTools.length = 0;

      for (const plugin of plugins) {
        let didStartPlugin = false;
        try {
          await plugin.init?.(options.runtime);
          didStartPlugin = true;

          const declaredTools =
            typeof plugin.tools === "function" ? await plugin.tools(options.runtime) : plugin.tools;
          if (declaredTools) {
            stableTools.push(...declaredTools);
          }

          activePlugins.push(plugin);
        } catch (error) {
          if (didStartPlugin) {
            await Promise.resolve(plugin.stop?.()).catch(() => undefined);
          }

          if (plugin.optional) {
            emitInternal({
              type: "plugin.disabled",
              plugin: plugin.name,
              reason: createDiagnostic(error),
            });
            continue;
          }

          for (const initializedPlugin of [...activePlugins].reverse()) {
            await initializedPlugin.stop?.();
          }
          activePlugins.length = 0;
          stableTools.length = 0;
          throw error;
        }
      }

      didInit = true;
    },
    async stop() {
      for (const plugin of [...activePlugins].reverse()) {
        await plugin.stop?.();
      }

      activePlugins.length = 0;
      stableTools.length = 0;
      didInit = false;
    },
    emitPluginError,
  };
}

export async function runHookPipeline<T>(
  items: readonly AgentPlugin[],
  runner: (plugin: AgentPlugin) => Awaitable<T | undefined>,
  fallback: T,
): Promise<T> {
  let current = fallback;

  for (const plugin of items) {
    const next = await runner(plugin);
    if (next !== undefined) {
      current = next;
    }
  }

  return current;
}
