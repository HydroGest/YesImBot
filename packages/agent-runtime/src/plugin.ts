import type { ModelMessage, SystemModelMessage } from "ai";

import { Awaitable } from "./base.js";
import type { AgentChannel } from "./channel.js";
import type { AgentEntry } from "./entry.js";
import { createDiagnostic, createInternalEvent } from "./event.js";
import type { AgentInternalEventInit } from "./event.js";
import type { AgentMessage } from "./message.js";
import type { AgentStateManager } from "./state.js";
import type { AgentStorage } from "./storage.js";
import { mergeTools, type AgentToolSet, type ToolDecision } from "./tools.js";
import { TurnResult } from "./turn.js";

export interface AgentPluginRuntime {
  readonly id: string;
  readonly channel: AgentChannel;
  readonly state: AgentStateManager;
}

export type SystemPromptBlock = string | SystemModelMessage;
export type SystemPromptAppend = SystemPromptBlock | readonly SystemPromptBlock[];

export interface AgentPlugin {
  name: string;
  version?: string;
  enforce?: "pre" | "post";
  optional?: boolean;
  tools?: AgentToolSet | ((runtime: AgentPluginRuntime) => Awaitable<AgentToolSet | void>);
  init?(runtime: AgentPluginRuntime): Awaitable<void>;
  stop?(): Awaitable<void>;
  onAppend?(entries: AgentEntry[], context: AppendHookContext): Awaitable<AgentEntry[] | void>;
  /** @deprecated Define an explicit cache lifecycle before adding historical projection behavior. */
  transformMessages?(messages: AgentMessage[], context: MessageTransformContext): Awaitable<AgentMessage[]>;
  toModelMessages?(
    message: AgentMessage,
    context: ModelMessageContext,
  ): Awaitable<ModelMessage[] | ModelMessage | void>;
  /** @deprecated Use structured `systemPrompt` input and `appendSystemPrompt`. */
  extendSystemPrompt?(prompt: string, context: PromptContext): Awaitable<string | void>;
  appendSystemPrompt?(context: PromptContext): Awaitable<SystemPromptAppend | void>;
  /** @deprecated Declare stable tools through `AgentPlugin.tools`. */
  extendTools?(tools: AgentToolSet, context: ToolExtensionContext): Awaitable<AgentToolSet | void>;
  beforeToolCall?(call: ToolCallContext, context: ToolHookContext): Awaitable<ToolDecision | void>;
  afterToolCall?(result: ToolResultContext, context: ToolHookContext): Awaitable<Partial<ToolResultContext> | void>;
  onTurnFinish?(result: TurnResult, context: TurnFinishContext): Awaitable<void>;
}

export interface HookContextBase {
  readonly runtime: { id: string };
  readonly channel: AgentChannel;
  readonly state: AgentStateManager;
  readonly signal?: AbortSignal;
  readonly pluginName?: string;
}

export interface AppendHookContext extends HookContextBase {
  readonly storage: AgentStorage;
}

export interface MessageTransformContext extends HookContextBase {
  readonly turnId?: string;
}

export interface ModelMessageContext extends HookContextBase {
  readonly turnId?: string;
  readonly history: readonly AgentMessage[];
  readonly current: readonly AgentMessage[];
}

export interface PromptContext extends HookContextBase {
  readonly turnId?: string;
}

export interface ToolExtensionContext extends HookContextBase {
  readonly turnId?: string;
}

export interface ToolHookContext extends HookContextBase {
  readonly turnId: string;
}

export interface TurnFinishContext extends HookContextBase {
  readonly turnId: string;
}

export interface ToolCallContext {
  toolCallId: string;
  toolName: string;
  args: unknown;
}

export interface ToolResultContext extends ToolCallContext {
  result: unknown;
  isError: boolean;
}

export interface PluginHostRuntime extends AgentPluginRuntime {
  readonly storage: AgentStorage<AgentEntry>;
}

export interface PluginHostHelpers {
  onAppend(entries: AgentEntry[], context: AppendHookContext): Promise<AgentEntry[]>;
  transformMessages(messages: AgentMessage[], context: MessageTransformContext): Promise<AgentMessage[]>;
  toModelMessages(message: AgentMessage, context: ModelMessageContext): Promise<ModelMessage[]>;
  beforeToolCall(decision: ToolDecision, call: ToolCallContext, context: ToolHookContext): Promise<ToolDecision>;
  afterToolCall(result: ToolResultContext, context: ToolHookContext): Promise<ToolResultContext>;
  onTurnFinish(result: TurnResult, context: TurnFinishContext): Promise<void>;
}

export interface PluginHostInitOptions {
  legacySystemPrompt?: string;
  baseTools?: AgentToolSet;
  terminalTools?: AgentToolSet;
}

export interface PluginHost {
  readonly plugins: readonly AgentPlugin[];
  readonly activePlugins: readonly AgentPlugin[];
  readonly stableLegacySystemPrompt: string | undefined;
  readonly stablePromptBlocks: readonly SystemModelMessage[];
  readonly stableTools: Readonly<AgentToolSet>;
  readonly helpers: PluginHostHelpers;
  init(options?: PluginHostInitOptions): Promise<void>;
  stop(): Promise<void>;
  emitPluginError(pluginName: string, error: unknown): void;
}

export function orderPlugins(plugins: readonly AgentPlugin[]): AgentPlugin[] {
  const pre = plugins.filter((plugin) => plugin.enforce === "pre");
  const normal = plugins.filter((plugin) => plugin.enforce !== "pre" && plugin.enforce !== "post");
  const post = plugins.filter((plugin) => plugin.enforce === "post");
  return [...pre, ...normal, ...post];
}
export function normalizeSystemPromptAppend(value: SystemPromptAppend): SystemModelMessage[] {
  const blocks = Array.isArray(value) ? value : [value];
  return blocks.map((block) =>
    typeof block === "string"
      ? { role: "system", content: block }
      : {
          ...block,
          content: structuredClone(block.content),
          ...(block.providerOptions === undefined ? {} : { providerOptions: structuredClone(block.providerOptions) }),
        },
  );
}
export function createPluginHost(options: { plugins: readonly AgentPlugin[]; runtime: PluginHostRuntime }): PluginHost {
  const plugins = orderPlugins(options.plugins);
  const activePlugins: AgentPlugin[] = [];
  const stableTools: AgentToolSet = [];
  const stablePromptBlocks: SystemModelMessage[] = [];
  let stableLegacySystemPrompt: string | undefined;
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

  const stopPlugin = async (plugin: AgentPlugin) => {
    try {
      await plugin.stop?.();
    } catch (error) {
      emitPluginError(plugin.name, error);
    }
  };

  const rollbackPlugins = async (currentPlugin?: AgentPlugin) => {
    const pluginsToStop = currentPlugin
      ? [currentPlugin, ...[...activePlugins].reverse()]
      : [...activePlugins].reverse();

    for (const plugin of pluginsToStop) {
      await stopPlugin(plugin);
    }

    activePlugins.length = 0;
    stableTools.length = 0;
    stablePromptBlocks.length = 0;
    stableLegacySystemPrompt = undefined;
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
    get stableLegacySystemPrompt() {
      return stableLegacySystemPrompt;
    },
    get stablePromptBlocks() {
      return stablePromptBlocks;
    },
    get stableTools() {
      return stableTools;
    },
    helpers,
    async init(initOptions: PluginHostInitOptions = {}) {
      if (didInit) return;
      activePlugins.length = 0;
      stablePromptBlocks.length = 0;
      stableTools.length = 0;
      stableLegacySystemPrompt = undefined;

      const initializationContext: PromptContext & ToolExtensionContext = {
        runtime: { id: options.runtime.id },
        channel: options.runtime.channel,
        state: options.runtime.state,
      };
      let nextLegacy = initOptions.legacySystemPrompt;
      let nextTools = [...(initOptions.baseTools ?? [])];
      const nextBlocks: SystemModelMessage[] = [];

      for (const plugin of plugins) {
        let didStartPlugin = false;
        try {
          await plugin.init?.(options.runtime);
          didStartPlugin = true;

          const declared = typeof plugin.tools === "function" ? await plugin.tools(options.runtime) : plugin.tools;
          let candidateTools = mergeTools([nextTools, declared ?? []]);
          let candidateLegacy = nextLegacy;
          const appended = await plugin.appendSystemPrompt?.(initializationContext);
          const candidateBlocks = appended === undefined ? [] : normalizeSystemPromptAppend(appended);

          if (candidateLegacy !== undefined && plugin.extendSystemPrompt) {
            candidateLegacy =
              (await plugin.extendSystemPrompt(candidateLegacy, initializationContext)) ?? candidateLegacy;
          }
          if (plugin.extendTools) {
            candidateTools = mergeTools([
              (await plugin.extendTools([...candidateTools], initializationContext)) ?? candidateTools,
            ]);
          }

          activePlugins.push(plugin);
          nextLegacy = candidateLegacy;
          nextTools = candidateTools;
          nextBlocks.push(...candidateBlocks);
        } catch (error) {
          if (didStartPlugin && plugin.optional) {
            await stopPlugin(plugin);
          }
          if (plugin.optional) {
            emitInternal({
              type: "plugin.disabled",
              plugin: plugin.name,
              reason: createDiagnostic(error),
            });
            continue;
          }
          await rollbackPlugins(didStartPlugin ? plugin : undefined);
          throw error;
        }
      }

      stableLegacySystemPrompt = nextLegacy;
      stablePromptBlocks.push(...nextBlocks);
      try {
        stableTools.push(...mergeTools([nextTools, initOptions.terminalTools ?? []]));
      } catch (error) {
        await rollbackPlugins();
        throw error;
      }
      didInit = true;
    },
    async stop() {
      for (const plugin of [...activePlugins].reverse()) {
        await plugin.stop?.();
      }

      activePlugins.length = 0;
      stableTools.length = 0;
      stablePromptBlocks.length = 0;
      stableLegacySystemPrompt = undefined;
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
