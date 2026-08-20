import { type Tool, type ToolExecutionOptions, type ToolSet } from "ai";

import type { AgentChannel } from "./channel.js";
import type { AgentEntry } from "./entry.js";
import { ToolConflictError } from "./errors.js";
import type { AgentMessage } from "./message.js";
import type { AgentPlugin, ToolCallContext, ToolHookContext, ToolResultContext } from "./plugin.js";
import type { AgentStateManager } from "./state.js";
import type { AgentStorage } from "./storage.js";
// eslint-disable-next-line typescript/no-explicit-any
export type AgentTool<IN = any, OUT = any> = Omit<Tool<IN, OUT>, "execute"> & {
  name: string;
  /**
   * Marks the tool as able to end the current turn. `true` always ends it; a predicate decides per
   * call from the model-generated input. A turn stops only when every tool call in the final step
   * is terminal.
   */
  terminal?: boolean | ((input: IN) => boolean);
  execute: (input: IN, options: AgentToolExecuteContext) => Promise<OUT> | OUT;
};

export type AgentToolSet = AgentTool[];

export type ToolDecision = { type: "allow" } | { type: "block"; reason: string } | { type: "replace"; args: unknown };

export interface AgentToolExecuteContext extends Omit<ToolExecutionOptions, "messages"> {
  readonly runtime: { id: string };
  readonly channel: AgentChannel;
  readonly state: AgentStateManager;
  readonly storage: AgentStorage<AgentEntry>;
  readonly turnId: string;
  readonly messages: readonly AgentMessage[];
}

export function mergeTools(toolSets: readonly AgentToolSet[]): AgentToolSet {
  const merged: AgentToolSet = [];
  const seen = new Set<string>();

  for (const tools of toolSets) {
    for (const tool of tools) {
      if (seen.has(tool.name)) {
        throw new ToolConflictError(tool.name);
      }
      seen.add(tool.name);
      merged.push({ ...tool });
    }
  }

  return merged;
}

export async function runBeforeToolHooks(plugins: readonly AgentPlugin[], call: ToolCallContext, context: ToolHookContext): Promise<ToolDecision> {
  let current = call;
  let currentDecision: ToolDecision = { type: "allow" };

  for (const plugin of plugins) {
    const decision = await plugin?.beforeToolCall?.(current, context);
    if (!decision || decision.type === "allow") {
      continue;
    }

    if (decision.type === "block") {
      return decision;
    }

    current = { ...current, args: decision.args };
    currentDecision = decision;
  }

  return currentDecision;
}

export async function runAfterToolHooks(plugins: readonly AgentPlugin[], result: ToolResultContext, context: ToolHookContext): Promise<ToolResultContext> {
  let current = result;

  for (const plugin of plugins) {
    const patch = await plugin?.afterToolCall?.(current, context);
    if (patch) {
      current = { ...current, ...patch };
    }
  }

  return current;
}

export function toAiToolSet(tools: AgentToolSet): ToolSet {
  const result: ToolSet = {};
  for (const tool of tools) {
    if (tool.name in result) {
      throw new ToolConflictError(tool.name);
    }

    const { name: _name, ...aiTool } = tool;
    result[tool.name] = aiTool as unknown as Tool;
  }
  return result;
}
